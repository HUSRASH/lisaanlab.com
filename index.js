'use strict';
/**
 * Lisaan Lab — Learning Management System
 * Express + SQLite + WebSocket. Single process, no external services.
 */
const express = require('express');
const cookieParser = require('cookie-parser');
const http = require('http');
const path = require('path');
const fs = require('fs');

const { db, PASSPORTS, ROOT, SUPER_EMAIL, SUPER_ID, getSetting } = require('./db');
const C = require('./core');
const rt = require('./realtime');

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store');
  next();
});

app.use(C.attachUser);

/* Passport photographs — authenticated access only. */
app.get('/api/files/passport/:name', C.requireAuth, (req, res) => {
  const name = path.basename(String(req.params.name));
  const p = path.join(PASSPORTS, name);
  if (!fs.existsSync(p)) return res.status(404).end();
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(p);
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/academics', require('./routes/academics'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/assessments', require('./routes/assessments'));
app.use('/api/vault', require('./routes/vault'));
app.use('/api/system', require('./routes/system'));

app.get('/api/public/info', (_req, res) => {
  res.json({
    institution: getSetting('institution', 'Lisaan Lab'),
    academic_session: getSetting('academic_session'),
    levels: db.prepare('SELECT code,name,ordinal FROM levels ORDER BY ordinal').all(),
    semesters_per_level: 4,
    bootstrapped: !!db.prepare("SELECT 1 FROM users WHERE role='SUPER_ADMIN'").get(),
  });
});

app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

app.get('/app', (_req, res) => res.sendFile(path.join(ROOT, 'public', 'app.html')));
app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown endpoint' }));
app.use((_req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));

app.use((err, _req, res, _next) => {
  console.error('[error]', err.message);
  if (res.headersSent) return;
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

const server = http.createServer(app);
rt.init(server, (token) => C.userFromToken(token));

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, '0.0.0.0', () => {
  const superUser = db.prepare("SELECT uid,email,must_change_password FROM users WHERE role='SUPER_ADMIN'").get();
  console.log('──────────────────────────────────────────────');
  console.log('  LISAAN LAB — Learning Management System');
  console.log(`  Listening on http://0.0.0.0:${PORT}`);
  console.log(`  Super admin : ${superUser ? superUser.email : SUPER_EMAIL}`);
  console.log(`  Staff ID    : ${superUser ? superUser.uid : SUPER_ID}`);
  if (superUser && superUser.must_change_password) console.log('  First login : password change will be enforced');
  console.log('──────────────────────────────────────────────');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { try { db.pragma('wal_checkpoint(TRUNCATE)'); db.close(); } catch {} process.exit(0); });
}
