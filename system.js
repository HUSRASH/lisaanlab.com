'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { db, nowISO, DATA, VAULT, PASSPORTS, BACKUPS, getSetting, setSetting, seedAcademicStructure } = require('../db');
const C = require('../core');
const rt = require('../realtime');

const router = express.Router();
const today = () => new Date().toISOString().slice(0, 10);
const n = (sql, p = []) => db.prepare(sql).get(...p).n;

/* --------------------------- dashboards ---------------------------- */

router.get('/dashboard', C.requireAuth, (req, res) => {
  const u = req.user;
  const online = rt.onlineUsers();

  if (C.ADMIN_ROLES.includes(u.role)) {
    const liveSessions = db.prepare(`SELECT s.id,s.topic,s.opened_at,s.closes_at,c.code AS course_code,c.title AS course_title,
                                            t.full_name AS tutor_name,t.uid AS tutor_uid,
                                            (SELECT COUNT(*) FROM enrollments e WHERE e.course_id=s.course_id) AS roster_size,
                                            (SELECT COUNT(*) FROM attendance_marks m WHERE m.session_id=s.id AND m.status<>'ABSENT') AS present_count
                                     FROM attendance_sessions s JOIN courses c ON c.id=s.course_id JOIN users t ON t.id=s.tutor_id
                                     WHERE s.status='LIVE' ORDER BY s.opened_at DESC`).all();
    const liveAssessments = db.prepare(`SELECT a.id,a.title,a.type,a.closes_at,c.code AS course_code,t.full_name AS tutor_name,
                                               (SELECT COUNT(*) FROM submissions sb WHERE sb.assessment_id=a.id) AS submission_count,
                                               (SELECT COUNT(*) FROM enrollments e WHERE e.course_id=a.course_id) AS roster_size
                                        FROM assessments a JOIN courses c ON c.id=a.course_id JOIN users t ON t.id=a.tutor_id
                                        WHERE a.status='LIVE' ORDER BY a.closes_at`).all();
    const marksToday = db.prepare(`SELECT COUNT(*) n FROM attendance_marks WHERE date(marked_at)=date('now') AND status IN ('PRESENT','LATE')`).get().n;
    const expectedToday = db.prepare(`SELECT COUNT(*) n FROM attendance_marks WHERE date(marked_at)=date('now')`).get().n;

    const vaultVisible = u.role === 'SUPER_ADMIN' || u.role === 'DG_CEO' || C.can(u, 'vault.access');
    const used = db.prepare('SELECT COALESCE(SUM(size),0) n FROM vault_files').get().n;

    return res.json({
      role: u.role,
      kpis: {
        students: n("SELECT COUNT(*) n FROM users WHERE role='STUDENT'"),
        tutors: n("SELECT COUNT(*) n FROM users WHERE role='TUTOR'"),
        admins: n("SELECT COUNT(*) n FROM users WHERE role IN ('ADMIN','DG_CEO')"),
        suspended: n("SELECT COUNT(*) n FROM users WHERE status='SUSPENDED'"),
        courses: n('SELECT COUNT(*) n FROM courses'),
        enrollments: n('SELECT COUNT(*) n FROM enrollments'),
        online: online.length,
        live_sessions: liveSessions.length,
        live_assessments: liveAssessments.length,
        pending_approvals: n("SELECT COUNT(*) n FROM assessments WHERE status='PENDING_APPROVAL'"),
        submissions_today: n("SELECT COUNT(*) n FROM submissions WHERE date(submitted_at)=date('now')"),
        results_published: n('SELECT COUNT(*) n FROM results'),
        attendance_today: expectedToday ? Math.round((marksToday / expectedToday) * 1000) / 10 : 0,
        staff_on_duty: n(`SELECT COUNT(*) n FROM staff_attendance WHERE work_date=? AND clock_in IS NOT NULL AND clock_out IS NULL`, [today()]),
      },
      online,
      live_sessions: liveSessions,
      live_assessments: liveAssessments,
      pending_approvals: db.prepare(`SELECT a.id,a.title,a.type,a.created_at,c.code AS course_code,t.full_name AS tutor_name
                                     FROM assessments a JOIN courses c ON c.id=a.course_id JOIN users t ON t.id=a.tutor_id
                                     WHERE a.status='PENDING_APPROVAL' ORDER BY a.created_at`).all(),
      recent_activity: db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 25').all(),
      enrolment_by_level: db.prepare(`SELECT l.name, l.code, COUNT(u.id) n FROM levels l
                                      LEFT JOIN users u ON u.level_id=l.id AND u.role='STUDENT'
                                      GROUP BY l.id ORDER BY l.ordinal`).all(),
      recent_submissions: db.prepare(`SELECT sb.percent,sb.submitted_at,u.full_name,u.uid,c.code AS course_code,a.title
                                      FROM submissions sb JOIN users u ON u.id=sb.student_id
                                      JOIN assessments a ON a.id=sb.assessment_id JOIN courses c ON c.id=a.course_id
                                      ORDER BY sb.id DESC LIMIT 10`).all(),
      vault: vaultVisible ? { used, quota: Number(getSetting('vault_quota')), files: n('SELECT COUNT(*) n FROM vault_files') } : null,
      server_time: nowISO(),
    });
  }

  if (u.role === 'TUTOR') {
    const courses = db.prepare(`SELECT c.*, l.name AS level_name, s.name AS semester_name,
                                       (SELECT COUNT(*) FROM enrollments e WHERE e.course_id=c.id) AS student_count
                                FROM courses c JOIN levels l ON l.id=c.level_id JOIN semesters s ON s.id=c.semester_id
                                WHERE c.tutor_id=? ORDER BY l.ordinal, s.ordinal, c.code`).all(u.id);
    const clock = db.prepare('SELECT * FROM staff_attendance WHERE user_id=? AND work_date=?').get(u.id, today());
    return res.json({
      role: u.role,
      kpis: {
        courses: courses.length,
        students: n('SELECT COUNT(DISTINCT e.student_id) n FROM enrollments e JOIN courses c ON c.id=e.course_id WHERE c.tutor_id=?', [u.id]),
        live_sessions: n("SELECT COUNT(*) n FROM attendance_sessions WHERE tutor_id=? AND status='LIVE'", [u.id]),
        assessments: n('SELECT COUNT(*) n FROM assessments WHERE tutor_id=?', [u.id]),
        pending_approval: n("SELECT COUNT(*) n FROM assessments WHERE tutor_id=? AND status='PENDING_APPROVAL'", [u.id]),
        live_assessments: n("SELECT COUNT(*) n FROM assessments WHERE tutor_id=? AND status='LIVE'", [u.id]),
        submissions_today: n(`SELECT COUNT(*) n FROM submissions sb JOIN assessments a ON a.id=sb.assessment_id
                              WHERE a.tutor_id=? AND date(sb.submitted_at)=date('now')`, [u.id]),
      },
      courses, clock,
      live_sessions: db.prepare(`SELECT s.*, c.code AS course_code, c.title AS course_title,
                                        (SELECT COUNT(*) FROM enrollments e WHERE e.course_id=s.course_id) AS roster_size,
                                        (SELECT COUNT(*) FROM attendance_marks m WHERE m.session_id=s.id AND m.status<>'ABSENT') AS present_count
                                 FROM attendance_sessions s JOIN courses c ON c.id=s.course_id
                                 WHERE s.tutor_id=? AND s.status='LIVE'`).all(u.id),
      assessments: db.prepare(`SELECT a.*, c.code AS course_code,
                                      (SELECT COUNT(*) FROM submissions sb WHERE sb.assessment_id=a.id) AS submission_count
                               FROM assessments a JOIN courses c ON c.id=a.course_id
                               WHERE a.tutor_id=? ORDER BY a.created_at DESC LIMIT 10`).all(u.id),
      recent_submissions: db.prepare(`SELECT sb.percent,sb.submitted_at,u2.full_name,u2.uid,c.code AS course_code,a.title
                                      FROM submissions sb JOIN assessments a ON a.id=sb.assessment_id
                                      JOIN courses c ON c.id=a.course_id JOIN users u2 ON u2.id=sb.student_id
                                      WHERE a.tutor_id=? ORDER BY sb.id DESC LIMIT 10`).all(u.id),
      server_time: nowISO(),
    });
  }

  // STUDENT
  const courses = db.prepare(`SELECT c.*, l.name AS level_name, s.name AS semester_name, t.full_name AS tutor_name
                              FROM enrollments e JOIN courses c ON c.id=e.course_id
                              JOIN levels l ON l.id=c.level_id JOIN semesters s ON s.id=c.semester_id
                              LEFT JOIN users t ON t.id=c.tutor_id WHERE e.student_id=? ORDER BY c.code`).all(u.id);
  const att = db.prepare(`SELECT COUNT(*) total, SUM(CASE WHEN status IN ('PRESENT','LATE','EXCUSED') THEN 1 ELSE 0 END) present
                          FROM attendance_marks WHERE student_id=?`).get(u.id);
  return res.json({
    role: u.role,
    kpis: {
      courses: courses.length,
      attendance_rate: att && att.total ? Math.round((att.present / att.total) * 1000) / 10 : 0,
      assessments_taken: n('SELECT COUNT(*) n FROM submissions WHERE student_id=?', [u.id]),
      average_score: db.prepare('SELECT ROUND(AVG(percent),2) a FROM submissions WHERE student_id=?').get(u.id).a || 0,
      results_published: n('SELECT COUNT(*) n FROM results WHERE student_id=?', [u.id]),
      live_now: n(`SELECT COUNT(*) n FROM attendance_sessions s WHERE s.status='LIVE'
                   AND s.course_id IN (SELECT course_id FROM enrollments WHERE student_id=?)`, [u.id]),
    },
    courses,
    live_attendance: db.prepare(`SELECT s.id,s.topic,s.opened_at,s.closes_at,s.late_after_min,c.code AS course_code,c.title AS course_title,
                                        t.full_name AS tutor_name,
                                        (SELECT status FROM attendance_marks m WHERE m.session_id=s.id AND m.student_id=@sid) AS my_status
                                 FROM attendance_sessions s JOIN courses c ON c.id=s.course_id JOIN users t ON t.id=s.tutor_id
                                 WHERE s.status='LIVE' AND s.course_id IN (SELECT course_id FROM enrollments WHERE student_id=@sid)
                                 ORDER BY s.opened_at DESC`).all({ sid: u.id }),
    live_assessments: db.prepare(`SELECT a.id,a.title,a.type,a.duration_min,a.closes_at,c.code AS course_code,
                                         (SELECT id FROM submissions sb WHERE sb.assessment_id=a.id AND sb.student_id=@sid) AS my_submission_id
                                  FROM assessments a JOIN courses c ON c.id=a.course_id
                                  WHERE a.status='LIVE' AND a.course_id IN (SELECT course_id FROM enrollments WHERE student_id=@sid)
                                  ORDER BY a.closes_at`).all({ sid: u.id }),
    recent_scores: db.prepare(`SELECT sb.score,sb.max_score,sb.percent,sb.submitted_at,a.title,a.type,c.code AS course_code
                               FROM submissions sb JOIN assessments a ON a.id=sb.assessment_id JOIN courses c ON c.id=a.course_id
                               WHERE sb.student_id=? ORDER BY sb.id DESC LIMIT 8`).all(u.id),
    attendance_recent: db.prepare(`SELECT m.status,m.marked_at,s.topic,c.code AS course_code
                                   FROM attendance_marks m JOIN attendance_sessions s ON s.id=m.session_id
                                   JOIN courses c ON c.id=s.course_id WHERE m.student_id=? ORDER BY m.id DESC LIMIT 8`).all(u.id),
    statements: db.prepare(`SELECT r.id,r.gpa,r.remark,r.published_at,s.name AS semester_name,l.name AS level_name
                            FROM results r JOIN semesters s ON s.id=r.semester_id JOIN levels l ON l.id=r.level_id
                            WHERE r.student_id=? ORDER BY l.ordinal, s.ordinal`).all(u.id),
    server_time: nowISO(),
  });
});

/* ----------------------------- audit ------------------------------- */

router.get('/audit', C.requireAuth, C.requirePerm('audit.view'), (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const q = req.query.q ? `%${req.query.q}%` : null;
  const rows = q
    ? db.prepare('SELECT * FROM audit_log WHERE action LIKE ? OR actor_name LIKE ? OR detail LIKE ? ORDER BY id DESC LIMIT ?').all(q, q, q, limit)
    : db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit);
  res.json({ entries: rows, total: n('SELECT COUNT(*) n FROM audit_log') });
});

/* ------------------------- notifications --------------------------- */

router.get('/notifications', C.requireAuth, (req, res) => {
  res.json({
    notifications: db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50').all(req.user.id),
    unread: n('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read_at IS NULL', [req.user.id]),
  });
});

router.post('/notifications/read', C.requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL').run(nowISO(), req.user.id);
  res.json({ ok: true });
});

/* ---------------------------- settings ----------------------------- */

router.get('/settings', C.requireAuth, (req, res) => {
  const rows = db.prepare('SELECT key,value FROM settings').all();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  res.json({ settings: out, me: { role: req.user.role, permissions: req.user.permissions } });
});

router.patch('/settings', C.requireAuth, C.requireRole('SUPER_ADMIN'), (req, res) => {
  const allowed = ['institution', 'academic_session'];
  for (const [k, v] of Object.entries(req.body || {})) if (allowed.includes(k)) setSetting(k, String(v));
  C.audit(req.user, 'SETTINGS_UPDATED', 'settings', req.body, req.ip);
  res.json({ ok: true });
});

/* ----------------------------- backups ------------------------------ */

function makeBackup(actor, reason) {
  db.pragma('wal_checkpoint(TRUNCATE)');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `lisaanlab-backup-${stamp}.tar.gz`;
  const target = path.join(BACKUPS, filename);
  const entries = ['lms.db'];
  for (const d of ['passports', 'vault']) if (fs.existsSync(path.join(DATA, d))) entries.push(d);
  execFileSync('tar', ['-czf', target, '-C', DATA, ...entries], { stdio: 'pipe' });
  const size = fs.statSync(target).size;
  const info = db.prepare('INSERT INTO backups (filename,size,reason,created_by,created_at) VALUES (?,?,?,?,?)')
    .run(filename, size, reason || 'Manual backup', actor ? actor.id : null, nowISO());
  return { id: Number(info.lastInsertRowid), filename, size, created_at: nowISO(), reason };
}

router.get('/backups', C.requireAuth, C.requirePerm('system.backup'), (_req, res) => {
  res.json({
    backups: db.prepare(`SELECT b.*, u.full_name AS created_by_name FROM backups b LEFT JOIN users u ON u.id=b.created_by
                         ORDER BY b.id DESC LIMIT 50`).all(),
  });
});

router.post('/backup', C.requireAuth, C.requirePerm('system.backup'), (req, res) => {
  try {
    const b = makeBackup(req.user, (req.body && req.body.reason) || 'Manual backup');
    C.audit(req.user, 'BACKUP_CREATED', 'backup:' + b.id, { filename: b.filename, size: b.size }, req.ip);
    rt.broadcast('backup:created', b, { roles: C.ADMIN_ROLES });
    res.status(201).json({ backup: b });
  } catch (e) {
    res.status(500).json({ error: 'Backup failed: ' + e.message });
  }
});

router.get('/backups/:id/download', C.requireAuth, C.requirePerm('system.backup'), (req, res) => {
  const b = db.prepare('SELECT * FROM backups WHERE id=?').get(Number(req.params.id));
  if (!b) return res.status(404).json({ error: 'Backup not found' });
  const p = path.join(BACKUPS, b.filename);
  if (!fs.existsSync(p)) return res.status(410).json({ error: 'Backup archive no longer on disk' });
  C.audit(req.user, 'BACKUP_DOWNLOADED', 'backup:' + b.id, { filename: b.filename }, req.ip);
  res.download(p, b.filename);
});

/* ------------------------------ reset -------------------------------- */

const RESET_PHRASE = 'RESET LISAAN LAB LMS';

router.post('/reset', C.requireAuth, C.requireRole('SUPER_ADMIN'), (req, res) => {
  const { confirm, scope } = req.body || {};
  if (String(confirm || '').trim().toUpperCase() !== RESET_PHRASE) {
    return res.status(400).json({ error: `Type exactly: ${RESET_PHRASE}` });
  }
  const mode = String(scope || 'FULL').toUpperCase(); // FULL | DATA
  let backup = null;
  try { backup = makeBackup(req.user, `Pre-reset safety backup (${mode})`); }
  catch (e) { return res.status(500).json({ error: 'Reset aborted — the safety backup failed: ' + e.message }); }

  const superAdmin = db.prepare("SELECT * FROM users WHERE role='SUPER_ADMIN'").get();

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM attendance_marks').run();
    db.prepare('DELETE FROM attendance_sessions').run();
    db.prepare('DELETE FROM staff_attendance').run();
    db.prepare('DELETE FROM submissions').run();
    db.prepare('DELETE FROM questions').run();
    db.prepare('DELETE FROM assessments').run();
    db.prepare('DELETE FROM results').run();
    db.prepare('DELETE FROM enrollments').run();
    db.prepare('DELETE FROM courses').run();
    db.prepare('DELETE FROM vault_files').run();
    db.prepare('DELETE FROM notifications').run();
    if (mode === 'FULL') {
      db.prepare('DELETE FROM users WHERE id<>?').run(superAdmin.id);
      db.prepare('DELETE FROM sessions WHERE user_id<>?').run(superAdmin.id);
      db.prepare('DELETE FROM levels').run();
      db.prepare('DELETE FROM semesters').run();
    }
  });
  tx();

  // Clear physical objects
  for (const dir of [VAULT, PASSPORTS]) {
    try {
      for (const f of fs.readdirSync(dir)) {
        if (mode !== 'FULL' && superAdmin.passport === f) continue;
        fs.unlinkSync(path.join(dir, f));
      }
    } catch {}
  }
  if (mode === 'FULL') {
    db.prepare('UPDATE users SET passport=NULL WHERE id=?').run(superAdmin.id);
    seedAcademicStructure();
  }
  db.pragma('wal_checkpoint(TRUNCATE)');

  C.audit(req.user, 'SYSTEM_RESET', 'system', { mode, backup: backup.filename }, req.ip);
  rt.kickAllExcept(req.user.id, 'The system was reset by the Super Administrator.');
  rt.broadcast('system:reset', { mode, backup }, {});
  res.json({ ok: true, mode, backup });
});

router.get('/health', (_req, res) => {
  res.json({
    status: 'ok', time: nowISO(),
    users: n('SELECT COUNT(*) n FROM users'),
    online: rt.onlineUsers().length,
    uptime_s: Math.round(process.uptime()),
  });
});

module.exports = router;
