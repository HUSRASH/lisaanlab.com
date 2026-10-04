'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { db, nowISO, PASSPORTS } = require('../db');
const C = require('../core');
const rt = require('../realtime');

const router = express.Router();

const RANK = { SUPER_ADMIN: 100, DG_CEO: 80, ADMIN: 60, TUTOR: 40, STUDENT: 20 };
const rank = (r) => RANK[r] || 0;

const passportUpload = multer({
  storage: multer.diskStorage({
    destination: (_r, _f, cb) => cb(null, PASSPORTS),
    filename: (_r, file, cb) => {
      const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
      cb(null, crypto.randomBytes(12).toString('hex') + ext);
    },
  }),
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (_r, file, cb) => {
    if (/^image\/(jpeg|png|webp|jpg)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Passport must be a JPEG, PNG or WEBP image under 6 MB'));
  },
}).single('passport');

function withPassport(req, res, next) {
  passportUpload(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}

function randomPassword() {
  const words = ['Lisaan', 'Arabic', 'Qalam', 'Nahw', 'Sarf', 'Balagha', 'Tajweed', 'Lughah'];
  const w = words[crypto.randomInt(words.length)];
  return `${w}@${crypto.randomInt(1000, 9999)}`;
}

function listQuery(filters) {
  const where = [];
  const params = {};
  if (filters.role) { where.push('u.role = @role'); params.role = filters.role; }
  if (filters.status) { where.push('u.status = @status'); params.status = filters.status; }
  if (filters.level_id) { where.push('u.level_id = @level_id'); params.level_id = Number(filters.level_id); }
  if (filters.q) {
    where.push('(u.full_name LIKE @q OR u.email LIKE @q OR u.uid LIKE @q)');
    params.q = `%${filters.q}%`;
  }
  const sql = `SELECT u.id,u.uid,u.role,u.full_name,u.email,u.phone,u.gender,u.designation,u.status,u.passport,
                      u.level_id,u.semester_id,u.admission_year,u.created_at,u.last_login,u.login_count,u.must_change_password,
                      l.name AS level_name, s.name AS semester_name,
                      (SELECT full_name FROM users c WHERE c.id=u.created_by) AS created_by_name
               FROM users u
               LEFT JOIN levels l ON l.id=u.level_id
               LEFT JOIN semesters s ON s.id=u.semester_id
               ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY CASE u.role WHEN 'SUPER_ADMIN' THEN 1 WHEN 'DG_CEO' THEN 2 WHEN 'ADMIN' THEN 3 WHEN 'TUTOR' THEN 4 ELSE 5 END, u.uid`;
  return db.prepare(sql).all(params);
}

/* ------------------------------ read ------------------------------ */

router.get('/meta/permissions', C.requireAuth, (_req, res) => {
  res.json({ permissions: C.PERMISSIONS, defaults: C.ROLE_DEFAULTS, roles: C.ROLES });
});

router.get('/', C.requireAuth, (req, res) => {
  const u = req.user;
  const privileged = C.ADMIN_ROLES.includes(u.role) && (C.can(u, 'reports.view') || C.can(u, 'users.edit') || C.can(u, 'users.create'));
  if (privileged) {
    const rows = listQuery(req.query || {});
    const online = new Set(rt.onlineUsers().map((o) => o.id));
    return res.json({ users: rows.map((r) => ({ ...r, online: online.has(r.id) })) });
  }
  if (u.role === 'TUTOR') {
    // Tutors see only students enrolled in the courses they teach.
    const rows = db.prepare(`SELECT DISTINCT s.id,s.uid,s.full_name,s.email,s.passport,s.level_id,s.status,l.name AS level_name
                             FROM users s
                             JOIN enrollments e ON e.student_id=s.id
                             JOIN courses c ON c.id=e.course_id
                             LEFT JOIN levels l ON l.id=s.level_id
                             WHERE c.tutor_id=? AND s.role='STUDENT' ORDER BY s.uid`).all(u.id);
    const online = new Set(rt.onlineUsers().map((o) => o.id));
    return res.json({ users: rows.map((r) => ({ ...r, role: 'STUDENT', online: online.has(r.id) })) });
  }
  return res.status(403).json({ error: 'Not permitted' });
});

router.get('/online', C.requireAuth, (req, res) => {
  if (!C.ADMIN_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Not permitted' });
  res.json({ online: rt.onlineUsers() });
});

router.get('/:id', C.requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const isSelf = id === req.user.id;
  if (!isSelf && !C.ADMIN_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Not permitted' });
  const row = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: 'User not found' });
  const user = C.hydrateUser(row);
  const extra = {};
  if (row.role === 'STUDENT') {
    extra.courses = db.prepare(`SELECT c.id,c.code,c.title,c.credit_units,u.full_name AS tutor_name
                                FROM enrollments e JOIN courses c ON c.id=e.course_id
                                LEFT JOIN users u ON u.id=c.tutor_id WHERE e.student_id=? ORDER BY c.code`).all(id);
  }
  if (row.role === 'TUTOR') {
    extra.courses = db.prepare('SELECT id,code,title,credit_units FROM courses WHERE tutor_id=? ORDER BY code').all(id);
  }
  extra.online = rt.isOnline(id);
  res.json({ user, ...extra });
});

/* ----------------------------- create ----------------------------- */

router.post('/', C.requireAuth, C.requirePerm('users.create'), withPassport, (req, res) => {
  const b = req.body || {};
  const role = String(b.role || '').toUpperCase();
  if (!C.ROLES.includes(role)) return res.status(400).json({ error: 'Select a valid role' });
  if (role === 'SUPER_ADMIN') return res.status(400).json({ error: 'The super administrator account is unique and cannot be duplicated' });

  const full_name = String(b.full_name || '').trim();
  const email = String(b.email || '').trim().toLowerCase();
  if (full_name.length < 3) return res.status(400).json({ error: 'Enter the full name' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  if (db.prepare('SELECT id FROM users WHERE lower(email)=?').get(email)) {
    return res.status(409).json({ error: 'That email already belongs to another account' });
  }

  const year = role === 'STUDENT'
    ? (Number(b.admission_year) || new Date().getFullYear())
    : new Date().getFullYear();

  let level_id = b.level_id ? Number(b.level_id) : null;
  let semester_id = b.semester_id ? Number(b.semester_id) : null;
  if (role === 'STUDENT') {
    if (!level_id) return res.status(400).json({ error: 'Select the level the student is admitted into' });
    const lv = db.prepare('SELECT id FROM levels WHERE id=?').get(level_id);
    if (!lv) return res.status(400).json({ error: 'Unknown level' });
    if (!semester_id) {
      const first = db.prepare('SELECT id FROM semesters WHERE level_id=? ORDER BY ordinal LIMIT 1').get(level_id);
      semester_id = first ? first.id : null;
    }
  } else { level_id = null; semester_id = null; }

  const password = String(b.password || '').trim() || randomPassword();
  const problem = C.passwordProblem(password);
  if (problem) return res.status(400).json({ error: problem });

  const uid = C.generateUid(role, year);
  const info = db.prepare(`INSERT INTO users (uid,role,full_name,email,phone,gender,designation,password_hash,must_change_password,status,passport,level_id,semester_id,admission_year,created_by,created_at)
                           VALUES (?,?,?,?,?,?,?,?,1,'ACTIVE',?,?,?,?,?,?)`)
    .run(uid, role, full_name, email, b.phone || null, b.gender || null, b.designation || null,
         C.hashPassword(password), req.file ? req.file.filename : null,
         level_id, semester_id, role === 'STUDENT' ? year : null, req.user.id, nowISO());

  const newId = Number(info.lastInsertRowid);
  C.applyDefaultPermissions(newId, role);

  // Optional explicit toggles supplied at creation time
  let toggles = {};
  try { toggles = b.permissions ? JSON.parse(b.permissions) : {}; } catch {}
  for (const [k, v] of Object.entries(toggles)) {
    if (C.PERMISSION_KEYS.includes(k)) {
      if (role === 'DG_CEO' && k === 'users.create') continue;
      C.setPermission(newId, k, !!v);
    }
  }

  const created = C.hydrateUser(db.prepare('SELECT * FROM users WHERE id=?').get(newId));
  C.audit(req.user, 'USER_CREATED', 'user:' + newId, { uid, role, full_name, email }, req.ip);
  rt.broadcast('user:created', { user: created }, { roles: C.ADMIN_ROLES });
  rt.announcePresence();

  res.status(201).json({ user: created, initial_password: password });
});

/* ----------------------------- update ----------------------------- */

function guard(req, res, targetRow, needSelfOk = true) {
  if (!targetRow) { res.status(404).json({ error: 'User not found' }); return false; }
  if (needSelfOk && targetRow.id === req.user.id) return true;
  if (req.user.role !== 'SUPER_ADMIN' && rank(req.user.role) <= rank(targetRow.role)) {
    res.status(403).json({ error: 'You cannot act on an account at or above your own level' });
    return false;
  }
  if (targetRow.role === 'SUPER_ADMIN' && req.user.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'The super administrator account is protected' });
    return false;
  }
  return true;
}

router.patch('/:id', C.requireAuth, withPassport, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  const isSelf = id === req.user.id;
  if (!isSelf && !C.can(req.user, 'users.edit')) return res.status(403).json({ error: 'Missing privilege: users.edit' });
  if (!guard(req, res, row)) return;

  const b = req.body || {};
  const fields = [];
  const vals = [];
  const allow = isSelf && !C.can(req.user, 'users.edit')
    ? ['full_name', 'phone', 'gender']
    : ['full_name', 'phone', 'gender', 'designation', 'email', 'level_id', 'semester_id', 'admission_year'];

  for (const f of allow) {
    if (b[f] === undefined || b[f] === '') continue;
    if (f === 'email') {
      const email = String(b.email).trim().toLowerCase();
      const clash = db.prepare('SELECT id FROM users WHERE lower(email)=? AND id<>?').get(email, id);
      if (clash) return res.status(409).json({ error: 'That email already belongs to another account' });
      fields.push('email=?'); vals.push(email); continue;
    }
    if (['level_id', 'semester_id', 'admission_year'].includes(f)) { fields.push(`${f}=?`); vals.push(Number(b[f])); continue; }
    fields.push(`${f}=?`); vals.push(String(b[f]));
  }
  if (req.file) {
    if (row.passport) { try { fs.unlinkSync(path.join(PASSPORTS, row.passport)); } catch {} }
    fields.push('passport=?'); vals.push(req.file.filename);
  }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });

  vals.push(id);
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id=?`).run(...vals);
  const updated = C.hydrateUser(db.prepare('SELECT * FROM users WHERE id=?').get(id));
  C.audit(req.user, 'USER_UPDATED', 'user:' + id, { uid: row.uid, fields: fields.map((f) => f.split('=')[0]) }, req.ip);
  rt.broadcast('user:updated', { user: updated }, { roles: C.ADMIN_ROLES });
  rt.broadcast('profile:updated', { user: updated }, { userIds: [id] });
  res.json({ user: updated });
});

/* --------------------- permissions (toggles) ---------------------- */

router.post('/:id/permissions', C.requireAuth, C.requireRole('SUPER_ADMIN'), (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: 'User not found' });
  if (row.role === 'SUPER_ADMIN') return res.status(400).json({ error: 'Super administrator privileges are absolute and cannot be edited' });

  const updates = req.body && req.body.permissions ? req.body.permissions : (req.body && req.body.key ? { [req.body.key]: req.body.enabled } : null);
  if (!updates) return res.status(400).json({ error: 'No permissions supplied' });

  const applied = {};
  for (const [k, v] of Object.entries(updates)) {
    if (!C.PERMISSION_KEYS.includes(k)) continue;
    if (row.role === 'DG_CEO' && k === 'users.create') { applied[k] = false; continue; } // constitutional limit
    C.setPermission(id, k, !!v);
    applied[k] = !!v;
  }
  const updated = C.hydrateUser(db.prepare('SELECT * FROM users WHERE id=?').get(id));
  C.audit(req.user, 'PERMISSIONS_UPDATED', 'user:' + id, { uid: row.uid, applied }, req.ip);
  rt.broadcast('user:updated', { user: updated }, { roles: C.ADMIN_ROLES });
  rt.broadcast('permissions:updated', { permissions: updated.permissions }, { userIds: [id] });
  res.json({ user: updated });
});

/* ------------------- password reset / suspension ------------------ */

router.post('/:id/reset-password', C.requireAuth, C.requirePerm('users.reset_password'), (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!guard(req, res, row, false)) return;

  const supplied = req.body && req.body.password ? String(req.body.password).trim() : '';
  const password = supplied || randomPassword();
  const problem = C.passwordProblem(password);
  if (problem) return res.status(400).json({ error: problem });

  db.prepare('UPDATE users SET password_hash=?, must_change_password=1 WHERE id=?').run(C.hashPassword(password), id);
  C.destroyUserSessions(id);
  rt.kick(id, 'Your password was reset by an administrator. Please sign in again.');
  C.audit(req.user, 'PASSWORD_RESET', 'user:' + id, { uid: row.uid, by: req.user.uid }, req.ip);
  C.notify(id, 'Password reset', 'An administrator issued you a new password.', 'warning');
  res.json({ ok: true, uid: row.uid, full_name: row.full_name, new_password: password });
});

router.post('/:id/status', C.requireAuth, C.requirePerm('users.suspend'), (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!guard(req, res, row, false)) return;
  const status = String(req.body && req.body.status || '').toUpperCase();
  if (!['ACTIVE', 'SUSPENDED'].includes(status)) return res.status(400).json({ error: 'Status must be ACTIVE or SUSPENDED' });

  db.prepare('UPDATE users SET status=? WHERE id=?').run(status, id);
  if (status === 'SUSPENDED') { C.destroyUserSessions(id); rt.kick(id, 'Your account has been suspended.'); }
  const updated = C.hydrateUser(db.prepare('SELECT * FROM users WHERE id=?').get(id));
  C.audit(req.user, status === 'SUSPENDED' ? 'USER_SUSPENDED' : 'USER_RESTORED', 'user:' + id, { uid: row.uid }, req.ip);
  rt.broadcast('user:updated', { user: updated }, { roles: C.ADMIN_ROLES });
  res.json({ user: updated });
});

router.delete('/:id', C.requireAuth, C.requireRole('SUPER_ADMIN'), (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: 'User not found' });
  if (row.role === 'SUPER_ADMIN') return res.status(400).json({ error: 'The super administrator account cannot be deleted' });
  db.prepare('DELETE FROM users WHERE id=?').run(id);
  if (row.passport) { try { fs.unlinkSync(path.join(PASSPORTS, row.passport)); } catch {} }
  rt.kick(id, 'Your account has been removed.');
  C.audit(req.user, 'USER_DELETED', 'user:' + id, { uid: row.uid, role: row.role, full_name: row.full_name }, req.ip);
  rt.broadcast('user:deleted', { id, uid: row.uid }, { roles: C.ADMIN_ROLES });
  res.json({ ok: true });
});

module.exports = router;
