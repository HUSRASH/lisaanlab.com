'use strict';
/**
 * Lisaan Lab LMS — core services: identity, permissions, sessions, audit, grading.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db, nowISO } = require('./db');
const rt = require('./realtime');

const ROLES = ['SUPER_ADMIN', 'DG_CEO', 'ADMIN', 'TUTOR', 'STUDENT'];
const ADMIN_ROLES = ['SUPER_ADMIN', 'DG_CEO', 'ADMIN'];

/** Permission catalogue — these render as toggle switches in the super admin console. */
const PERMISSIONS = [
  { key: 'users.create',        group: 'User Administration', label: 'Create user accounts',          hint: 'Generate students, tutors and administrative staff' },
  { key: 'users.edit',          group: 'User Administration', label: 'Edit user profiles',            hint: 'Update names, contacts, passports, postings' },
  { key: 'users.reset_password',group: 'User Administration', label: 'Reset user passwords',          hint: 'Issue a new password to any lower-privileged user' },
  { key: 'users.suspend',       group: 'User Administration', label: 'Suspend / restore accounts',    hint: 'Block or restore portal access' },
  { key: 'academics.manage',    group: 'Academics',           label: 'Manage courses & structure',    hint: 'Create courses, assign tutors, enrol students' },
  { key: 'attendance.view',     group: 'Attendance',          label: 'View all attendance',           hint: 'Live student registers and staff clock records' },
  { key: 'attendance.manage',   group: 'Attendance',          label: 'Manage staff attendance',       hint: 'Correct, mark absent, close staff registers' },
  { key: 'assessments.view',    group: 'Examinations',        label: 'View all assessments',          hint: 'Inspect every test and examination' },
  { key: 'assessments.approve', group: 'Examinations',        label: 'Approve assessments (Exams Officer)', hint: 'Vet and release tutor assessments for sitting' },
  { key: 'results.publish',     group: 'Examinations',        label: 'Publish statements of result',  hint: 'Release end-of-semester results to students' },
  { key: 'vault.access',        group: 'Storage',             label: 'Storage vault access',          hint: '100 TB institutional vault — upload, download, delete' },
  { key: 'reports.view',        group: 'Oversight',           label: 'Live supervision dashboard',    hint: 'Real-time KPIs, presence and activity feed' },
  { key: 'audit.view',          group: 'Oversight',           label: 'View audit trail',              hint: 'Full immutable log of system activity' },
  { key: 'system.backup',       group: 'System',              label: 'Create & download backups',     hint: 'Snapshot the entire system for record purposes' },
  { key: 'system.reset',        group: 'System',              label: 'Reset the system',              hint: 'Destructive. Wipes operational data after a backup' },
];
const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

/** Defaults applied when an account is generated. Super admin implicitly holds everything. */
const ROLE_DEFAULTS = {
  SUPER_ADMIN: PERMISSION_KEYS,
  // DG/CEO: everything the super admin can do EXCEPT creating user accounts.
  DG_CEO: PERMISSION_KEYS.filter((k) => k !== 'users.create'),
  ADMIN: ['reports.view'],
  TUTOR: [],
  STUDENT: [],
};

/* ---------------------------- identity ---------------------------- */

const ID_SERIES = { SUPER_ADMIN: 'ADM', DG_CEO: 'ADM', ADMIN: 'ADM', TUTOR: 'TUT', STUDENT: 'STU' };

function generateUid(role, year) {
  const series = ID_SERIES[role] || 'ADM';
  const yr = Number(year) || new Date().getFullYear();
  const prefix = `LSL/${series}/${yr}/`;
  const rows = db.prepare('SELECT uid FROM users WHERE uid LIKE ?').all(`${prefix}%`);
  let max = 0;
  for (const r of rows) {
    const n = parseInt(String(r.uid).split('/').pop(), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(5, '0')}`;
}

/* --------------------------- permissions -------------------------- */

function permissionsFor(userId) {
  const rows = db.prepare('SELECT pkey, enabled FROM permissions WHERE user_id=?').all(userId);
  const out = {};
  for (const k of PERMISSION_KEYS) out[k] = false;
  for (const r of rows) out[r.pkey] = !!r.enabled;
  return out;
}

function applyDefaultPermissions(userId, role) {
  const granted = new Set(ROLE_DEFAULTS[role] || []);
  const stmt = db.prepare(`INSERT INTO permissions (user_id,pkey,enabled) VALUES (?,?,?)
                           ON CONFLICT(user_id,pkey) DO UPDATE SET enabled=excluded.enabled`);
  const tx = db.transaction(() => {
    for (const k of PERMISSION_KEYS) stmt.run(userId, k, granted.has(k) ? 1 : 0);
  });
  tx();
}

function setPermission(userId, key, enabled) {
  if (!PERMISSION_KEYS.includes(key)) throw new Error('Unknown permission: ' + key);
  db.prepare(`INSERT INTO permissions (user_id,pkey,enabled) VALUES (?,?,?)
              ON CONFLICT(user_id,pkey) DO UPDATE SET enabled=excluded.enabled`)
    .run(userId, key, enabled ? 1 : 0);
}

/** Super admin always passes; everyone else is checked against their toggles. */
function can(user, key) {
  if (!user) return false;
  if (user.role === 'SUPER_ADMIN') return true;
  if (key === 'users.create' && user.role === 'DG_CEO') return false; // hard constitutional limit
  return !!(user.permissions && user.permissions[key]);
}

/* ---------------------------- sessions ---------------------------- */

const SESSION_HOURS = 12;

function hashPassword(pw) { return bcrypt.hashSync(pw, 10); }
function verifyPassword(pw, hash) { try { return bcrypt.compareSync(pw, hash); } catch { return false; } }

function createSession(userId, ip, agent) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const exp = new Date(now.getTime() + SESSION_HOURS * 3600 * 1000);
  db.prepare('INSERT INTO sessions (token,user_id,created_at,expires_at,last_seen,ip,agent) VALUES (?,?,?,?,?,?,?)')
    .run(token, userId, now.toISOString(), exp.toISOString(), now.toISOString(), ip || '', (agent || '').slice(0, 300));
  return token;
}

function destroySession(token) { db.prepare('DELETE FROM sessions WHERE token=?').run(token); }
function destroyUserSessions(userId) { db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId); }

function hydrateUser(row) {
  if (!row) return null;
  const u = { ...row };
  delete u.password_hash;
  u.permissions = permissionsFor(row.id);
  if (row.level_id) {
    const lv = db.prepare('SELECT code,name FROM levels WHERE id=?').get(row.level_id);
    if (lv) { u.level_code = lv.code; u.level_name = lv.name; }
  }
  if (row.semester_id) {
    const sm = db.prepare('SELECT name,ordinal FROM semesters WHERE id=?').get(row.semester_id);
    if (sm) { u.semester_name = sm.name; u.semester_ordinal = sm.ordinal; }
  }
  return u;
}

function userFromToken(token) {
  if (!token) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE token=?').get(token);
  if (!s) return null;
  if (new Date(s.expires_at) < new Date()) { destroySession(token); return null; }
  const row = db.prepare('SELECT * FROM users WHERE id=?').get(s.user_id);
  if (!row || row.status !== 'ACTIVE') return null;
  db.prepare('UPDATE sessions SET last_seen=? WHERE token=?').run(nowISO(), token);
  return hydrateUser(row);
}

/* --------------------------- middleware --------------------------- */

function attachUser(req, _res, next) {
  req.user = userFromToken(req.cookies && req.cookies.lsl_sid);
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (req.user.must_change_password && !String(req.path).includes('change-password')) {
    return res.status(428).json({ error: 'Password change required', code: 'MUST_CHANGE_PASSWORD' });
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Not permitted for your role' });
    next();
  };
}

function requirePerm(key) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!can(req.user, key)) return res.status(403).json({ error: `Missing privilege: ${key}` });
    next();
  };
}

/* ----------------------------- audit ------------------------------ */

function audit(actor, action, entity, detail, ip) {
  const row = {
    actor_id: actor ? actor.id : null,
    actor_name: actor ? actor.full_name : 'System',
    actor_uid: actor ? actor.uid : 'SYSTEM',
    action, entity: entity || null,
    detail: typeof detail === 'string' ? detail : JSON.stringify(detail || {}),
    ip: ip || null, created_at: nowISO(),
  };
  const info = db.prepare(`INSERT INTO audit_log (actor_id,actor_name,actor_uid,action,entity,detail,ip,created_at)
                           VALUES (@actor_id,@actor_name,@actor_uid,@action,@entity,@detail,@ip,@created_at)`).run(row);
  rt.broadcast('audit:new', { id: info.lastInsertRowid, ...row }, { roles: ADMIN_ROLES });
  return info.lastInsertRowid;
}

function notify(userId, title, body, kind = 'info') {
  const created = nowISO();
  const info = db.prepare('INSERT INTO notifications (user_id,title,body,kind,created_at) VALUES (?,?,?,?,?)')
    .run(userId, title, body || '', kind, created);
  rt.broadcast('notification:new', { id: info.lastInsertRowid, title, body, kind, created_at: created }, { userIds: [userId] });
  return info.lastInsertRowid;
}

/* ---------------------------- grading ----------------------------- */

const GRADE_BANDS = [
  { min: 70, grade: 'A', point: 5, remark: 'Excellent' },
  { min: 60, grade: 'B', point: 4, remark: 'Very Good' },
  { min: 50, grade: 'C', point: 3, remark: 'Good' },
  { min: 45, grade: 'D', point: 2, remark: 'Fair' },
  { min: 40, grade: 'E', point: 1, remark: 'Pass' },
  { min: 0,  grade: 'F', point: 0, remark: 'Fail' },
];
function gradeOf(percent) { return GRADE_BANDS.find((b) => percent >= b.min) || GRADE_BANDS[GRADE_BANDS.length - 1]; }
function classOfGpa(gpa) {
  if (gpa >= 4.5) return 'Distinction';
  if (gpa >= 3.5) return 'Upper Credit';
  if (gpa >= 2.4) return 'Lower Credit';
  if (gpa >= 1.5) return 'Pass';
  return 'Fail — Repeat Semester';
}

const norm = (s) => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');

/** Objective auto-marking: scores are final the instant a student submits. */
function markSubmission(questions, answers) {
  let score = 0, max = 0;
  const breakdown = [];
  for (const q of questions) {
    const given = answers[String(q.id)];
    let correct = false;
    if (q.qtype === 'MCQ') {
      correct = norm(given) === norm(q.answer);
    } else if (q.qtype === 'TRUE_FALSE') {
      correct = norm(given) === norm(q.answer);
    } else { // SHORT_ANSWER — pipe-separated accepted answers
      const accepted = String(q.answer).split('|').map(norm).filter(Boolean);
      correct = accepted.includes(norm(given));
    }
    max += q.marks;
    if (correct) score += q.marks;
    breakdown.push({ question_id: q.id, ordinal: q.ordinal, given: given == null ? '' : String(given), correct, marks: correct ? q.marks : 0, out_of: q.marks });
  }
  const percent = max > 0 ? Math.round((score / max) * 10000) / 100 : 0;
  return { score, max, percent, breakdown };
}

/* ---------------------------- helpers ----------------------------- */

const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
function passwordProblem(pw) {
  if (!pw || pw.length < 8) return 'Password must be at least 8 characters';
  if (!PASSWORD_RULE.test(pw)) return 'Password must contain at least one letter and one number';
  return null;
}

function publicUser(u) {
  if (!u) return null;
  const { password_hash, ...rest } = u;
  return rest;
}

module.exports = {
  ROLES, ADMIN_ROLES, PERMISSIONS, PERMISSION_KEYS, ROLE_DEFAULTS,
  generateUid, permissionsFor, applyDefaultPermissions, setPermission, can,
  hashPassword, verifyPassword, createSession, destroySession, destroyUserSessions,
  userFromToken, hydrateUser, attachUser, requireAuth, requireRole, requirePerm,
  audit, notify, GRADE_BANDS, gradeOf, classOfGpa, markSubmission,
  passwordProblem, publicUser, SESSION_HOURS,
};
