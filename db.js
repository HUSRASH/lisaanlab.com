'use strict';
/**
 * Lisaan Lab LMS — database layer
 * SQLite (WAL) via better-sqlite3. Synchronous, transactional, durable.
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const ROOT = path.join(__dirname, '..');
// LSL_DATA_DIR lets you run an isolated instance (used by the automated test suite).
const DATA = process.env.LSL_DATA_DIR ? path.resolve(process.env.LSL_DATA_DIR) : path.join(ROOT, 'data');
const VAULT = path.join(DATA, 'vault');
const PASSPORTS = path.join(DATA, 'passports');
const BACKUPS = path.join(DATA, 'backups');
for (const d of [DATA, VAULT, PASSPORTS, BACKUPS]) fs.mkdirSync(d, { recursive: true });

const SUPER_EMAIL = 'technicallead@lisaanlab.com';
const SUPER_ID = 'LSL/ADM/2026/00001';
const SUPER_DEFAULT_PASSWORD = 'LisaanLab@2026';
const VAULT_QUOTA_BYTES = 100 * 1024 ** 4; // 100 TB

const db = new Database(path.join(DATA, 'lms.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                  TEXT UNIQUE NOT NULL,
  role                 TEXT NOT NULL,
  full_name            TEXT NOT NULL,
  email                TEXT UNIQUE NOT NULL,
  phone                TEXT,
  gender               TEXT,
  designation          TEXT,
  password_hash        TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  status               TEXT NOT NULL DEFAULT 'ACTIVE',
  passport             TEXT,
  level_id             INTEGER REFERENCES levels(id) ON DELETE SET NULL,
  semester_id          INTEGER REFERENCES semesters(id) ON DELETE SET NULL,
  admission_year       INTEGER,
  created_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at           TEXT NOT NULL,
  last_login           TEXT,
  login_count          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS permissions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pkey    TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, pkey)
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen  TEXT NOT NULL,
  ip         TEXT,
  agent      TEXT
);

CREATE TABLE IF NOT EXISTS levels (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  code    TEXT UNIQUE NOT NULL,
  name    TEXT NOT NULL,
  ordinal INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS semesters (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  level_id INTEGER NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
  ordinal  INTEGER NOT NULL,
  name     TEXT NOT NULL,
  UNIQUE (level_id, ordinal)
);

CREATE TABLE IF NOT EXISTS courses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT UNIQUE NOT NULL,
  title        TEXT NOT NULL,
  level_id     INTEGER NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
  semester_id  INTEGER NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  credit_units INTEGER NOT NULL DEFAULT 2,
  tutor_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS enrollments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id  INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE (student_id, course_id)
);

CREATE TABLE IF NOT EXISTS attendance_sessions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id      INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  tutor_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic          TEXT NOT NULL,
  opened_at      TEXT NOT NULL,
  closes_at      TEXT NOT NULL,
  closed_at      TEXT,
  late_after_min INTEGER NOT NULL DEFAULT 10,
  status         TEXT NOT NULL DEFAULT 'LIVE'
);

CREATE TABLE IF NOT EXISTS attendance_marks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     TEXT NOT NULL,
  marked_at  TEXT NOT NULL,
  UNIQUE (session_id, student_id)
);

CREATE TABLE IF NOT EXISTS staff_attendance (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_date TEXT NOT NULL,
  clock_in  TEXT,
  clock_out TEXT,
  status    TEXT NOT NULL DEFAULT 'PRESENT',
  minutes   INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, work_date)
);

CREATE TABLE IF NOT EXISTS assessments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id     INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  tutor_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  title         TEXT NOT NULL,
  instructions  TEXT,
  weight        INTEGER NOT NULL DEFAULT 30,
  duration_min  INTEGER NOT NULL DEFAULT 30,
  opens_at      TEXT,
  closes_at     TEXT,
  status        TEXT NOT NULL DEFAULT 'DRAFT',
  approved_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_at   TEXT,
  review_note   TEXT,
  published_at  TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS questions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  ordinal       INTEGER NOT NULL,
  qtype         TEXT NOT NULL,
  prompt        TEXT NOT NULL,
  options       TEXT,
  answer        TEXT NOT NULL,
  marks         INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS submissions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  student_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  answers       TEXT NOT NULL,
  breakdown     TEXT NOT NULL,
  score         REAL NOT NULL,
  max_score     REAL NOT NULL,
  percent       REAL NOT NULL,
  started_at    TEXT,
  submitted_at  TEXT NOT NULL,
  UNIQUE (assessment_id, student_id)
);

CREATE TABLE IF NOT EXISTS results (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level_id     INTEGER NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
  semester_id  INTEGER NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  payload      TEXT NOT NULL,
  gpa          REAL NOT NULL,
  remark       TEXT NOT NULL,
  published_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  published_at TEXT NOT NULL,
  UNIQUE (student_id, semester_id)
);

CREATE TABLE IF NOT EXISTS vault_files (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime        TEXT,
  size        INTEGER NOT NULL,
  folder      TEXT NOT NULL DEFAULT 'General',
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS backups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  filename   TEXT NOT NULL,
  size       INTEGER NOT NULL,
  reason     TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id   INTEGER,
  actor_name TEXT,
  actor_uid  TEXT,
  action     TEXT NOT NULL,
  entity     TEXT,
  detail     TEXT,
  ip         TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  body       TEXT,
  kind       TEXT NOT NULL DEFAULT 'info',
  read_at    TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_role      ON users(role);
CREATE INDEX IF NOT EXISTS idx_marks_session   ON attendance_marks(session_id);
CREATE INDEX IF NOT EXISTS idx_subs_assessment ON submissions(assessment_id);
CREATE INDEX IF NOT EXISTS idx_audit_created   ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_user      ON notifications(user_id, read_at);
`);

/* ------------------------------------------------------------------ *
 * Bootstrap: academic structure + super admin
 * ------------------------------------------------------------------ */
const nowISO = () => new Date().toISOString();

function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key, String(value));
}
function getSetting(key, fallback = null) {
  const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return r ? r.value : fallback;
}

const LEVELS = [
  { code: 'BEG', name: 'Beginners', ordinal: 1 },
  { code: 'INT', name: 'Intermediate', ordinal: 2 },
  { code: 'ADV', name: 'Advance', ordinal: 3 },
];
const SEM_NAMES = ['First Semester', 'Second Semester', 'Third Semester', 'Fourth Semester'];

function seedAcademicStructure() {
  const insLevel = db.prepare('INSERT OR IGNORE INTO levels (code,name,ordinal) VALUES (?,?,?)');
  const insSem = db.prepare('INSERT OR IGNORE INTO semesters (level_id,ordinal,name) VALUES (?,?,?)');
  const tx = db.transaction(() => {
    for (const lv of LEVELS) {
      insLevel.run(lv.code, lv.name, lv.ordinal);
      const row = db.prepare('SELECT id FROM levels WHERE code=?').get(lv.code);
      for (let i = 0; i < SEM_NAMES.length; i++) insSem.run(row.id, i + 1, SEM_NAMES[i]);
    }
  });
  tx();
}

function seedSuperAdmin() {
  const existing = db.prepare('SELECT id FROM users WHERE role=?').get('SUPER_ADMIN');
  if (existing) return;
  db.prepare(`INSERT INTO users (uid,role,full_name,email,designation,password_hash,must_change_password,status,created_at)
              VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(SUPER_ID, 'SUPER_ADMIN', 'Technical Lead', SUPER_EMAIL, 'Super Administrator',
         bcrypt.hashSync(SUPER_DEFAULT_PASSWORD, 10), 1, 'ACTIVE', nowISO());
}

seedAcademicStructure();
seedSuperAdmin();
if (!getSetting('institution')) setSetting('institution', 'Lisaan Lab');
if (!getSetting('vault_quota')) setSetting('vault_quota', VAULT_QUOTA_BYTES);
if (!getSetting('academic_session')) {
  const y = new Date().getFullYear();
  setSetting('academic_session', `${y}/${y + 1}`);
}

module.exports = {
  db, ROOT, DATA, VAULT, PASSPORTS, BACKUPS,
  SUPER_EMAIL, SUPER_ID, SUPER_DEFAULT_PASSWORD, VAULT_QUOTA_BYTES,
  LEVELS, SEM_NAMES,
  setSetting, getSetting, nowISO,
  seedAcademicStructure, seedSuperAdmin,
};
