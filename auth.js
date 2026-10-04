'use strict';
const express = require('express');
const { db, nowISO } = require('../db');
const C = require('../core');
const rt = require('../realtime');

const router = express.Router();

/* Brute-force throttle: 6 failures per identifier+ip in 10 minutes. */
const attempts = new Map();
function throttleKey(req, id) { return `${req.ip}|${String(id || '').toLowerCase()}`; }
function tooMany(key) {
  const rec = attempts.get(key);
  if (!rec) return false;
  if (Date.now() - rec.first > 10 * 60 * 1000) { attempts.delete(key); return false; }
  return rec.count >= 6;
}
function noteFailure(key) {
  const rec = attempts.get(key) || { count: 0, first: Date.now() };
  rec.count += 1;
  attempts.set(key, rec);
}

router.post('/login', (req, res) => {
  const { identifier, password } = req.body || {};
  if (!identifier || !password) return res.status(400).json({ error: 'Enter your email or ID and your password' });

  const key = throttleKey(req, identifier);
  if (tooMany(key)) return res.status(429).json({ error: 'Too many failed attempts. Try again in 10 minutes.' });

  const ident = String(identifier).trim();
  const row = db.prepare(`SELECT * FROM users WHERE lower(email)=lower(?) OR upper(uid)=upper(?)`).get(ident, ident);

  if (!row || !C.verifyPassword(password, row.password_hash)) {
    noteFailure(key);
    C.audit(null, 'LOGIN_FAILED', 'auth', { identifier: ident }, req.ip);
    return res.status(401).json({ error: 'Invalid credentials. Check your email / ID and password.' });
  }
  if (row.status !== 'ACTIVE') {
    C.audit(null, 'LOGIN_BLOCKED', 'auth', { identifier: ident, status: row.status }, req.ip);
    return res.status(403).json({ error: 'This account is suspended. Contact the administrator.' });
  }

  attempts.delete(key);
  const token = C.createSession(row.id, req.ip, req.headers['user-agent']);
  db.prepare('UPDATE users SET last_login=?, login_count=login_count+1 WHERE id=?').run(nowISO(), row.id);

  // Over HTTPS use SameSite=None so the portal also works when embedded (preview frames,
  // intranet portals); plain HTTP falls back to Lax, which browsers require.
  const https = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.cookie('lsl_sid', token, {
    httpOnly: true, path: '/',
    sameSite: https ? 'none' : 'lax',
    secure: https,
    maxAge: C.SESSION_HOURS * 3600 * 1000,
  });

  const user = C.hydrateUser(db.prepare('SELECT * FROM users WHERE id=?').get(row.id));
  C.audit(user, 'LOGIN', 'auth', { role: user.role }, req.ip);
  rt.broadcast('user:login', { id: user.id, uid: user.uid, full_name: user.full_name, role: user.role, at: nowISO() }, { roles: C.ADMIN_ROLES });
  res.json({ user, must_change_password: !!row.must_change_password });
});

router.post('/logout', (req, res) => {
  const token = req.cookies && req.cookies.lsl_sid;
  if (req.user) {
    C.audit(req.user, 'LOGOUT', 'auth', {}, req.ip);
    rt.broadcast('user:logout', { id: req.user.id, full_name: req.user.full_name, role: req.user.role }, { roles: C.ADMIN_ROLES });
  }
  if (token) C.destroySession(token);
  const https = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.clearCookie('lsl_sid', { path: '/', sameSite: https ? 'none' : 'lax', secure: https });
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  res.json({ user: req.user, must_change_password: !!req.user.must_change_password, online: rt.onlineUsers().length });
});

router.post('/change-password', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  const { current_password, new_password } = req.body || {};
  const row = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!C.verifyPassword(current_password || '', row.password_hash)) {
    return res.status(400).json({ error: 'Your current password is incorrect' });
  }
  const problem = C.passwordProblem(new_password);
  if (problem) return res.status(400).json({ error: problem });
  if (C.verifyPassword(new_password, row.password_hash)) {
    return res.status(400).json({ error: 'Choose a password different from the current one' });
  }
  db.prepare('UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?').run(C.hashPassword(new_password), req.user.id);
  C.audit(req.user, 'PASSWORD_CHANGED', 'user:' + req.user.id, { self: true }, req.ip);
  res.json({ ok: true });
});

module.exports = router;
