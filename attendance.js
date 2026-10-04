'use strict';
const express = require('express');
const { db, nowISO } = require('../db');
const C = require('../core');
const rt = require('../realtime');

const router = express.Router();

const todayStr = () => new Date().toISOString().slice(0, 10);

function sessionRow(id) {
  return db.prepare(`SELECT s.*, c.code AS course_code, c.title AS course_title, c.level_id, c.semester_id,
                            l.name AS level_name, u.full_name AS tutor_name, u.uid AS tutor_uid,
                            (SELECT COUNT(*) FROM enrollments e WHERE e.course_id=s.course_id) AS roster_size,
                            (SELECT COUNT(*) FROM attendance_marks m WHERE m.session_id=s.id) AS marked_count
                     FROM attendance_sessions s
                     JOIN courses c ON c.id=s.course_id
                     JOIN levels l ON l.id=c.level_id
                     JOIN users u ON u.id=s.tutor_id
                     WHERE s.id=?`).get(id);
}

/** Auto-close sessions whose window has elapsed. Runs before every read. */
function sweepExpired() {
  const due = db.prepare("SELECT id FROM attendance_sessions WHERE status='LIVE' AND closes_at <= ?").all(nowISO());
  for (const d of due) closeSession(d.id, null, 'auto');
}

function closeSession(id, actor, mode) {
  const s = db.prepare('SELECT * FROM attendance_sessions WHERE id=?').get(id);
  if (!s || s.status !== 'LIVE') return null;
  db.prepare("UPDATE attendance_sessions SET status='CLOSED', closed_at=? WHERE id=?").run(nowISO(), id);
  // Everyone on the roster who never marked is recorded ABSENT — a real, auditable register.
  const roster = db.prepare('SELECT student_id FROM enrollments WHERE course_id=?').all(s.course_id);
  const ins = db.prepare("INSERT OR IGNORE INTO attendance_marks (session_id,student_id,status,marked_at) VALUES (?,?,'ABSENT',?)");
  const tx = db.transaction(() => { for (const r of roster) ins.run(id, r.student_id, nowISO()); });
  tx();
  const full = sessionRow(id);
  rt.broadcast('attendance:session_closed', { session: full, mode: mode || 'manual' }, {});
  if (actor) C.audit(actor, 'ATTENDANCE_SESSION_CLOSED', 'session:' + id, { course: full.course_code, marked: full.marked_count }, null);
  return full;
}
setInterval(() => { try { sweepExpired(); } catch {} }, 15000).unref();

/* ---------------------- student class register --------------------- */

router.post('/sessions', C.requireAuth, (req, res) => {
  const b = req.body || {};
  const course_id = Number(b.course_id);
  const course = db.prepare('SELECT * FROM courses WHERE id=?').get(course_id);
  if (!course) return res.status(404).json({ error: 'Course not found' });
  const isOwner = course.tutor_id === req.user.id;
  if (!isOwner && !C.can(req.user, 'attendance.manage')) return res.status(403).json({ error: 'Only the assigned tutor can open this register' });

  const live = db.prepare("SELECT id FROM attendance_sessions WHERE course_id=? AND status='LIVE'").get(course_id);
  if (live) return res.status(409).json({ error: 'A live register is already running for this course' });

  const topic = String(b.topic || '').trim() || 'Class session';
  const minutes = Math.min(Math.max(Number(b.duration_min) || 45, 5), 480);
  const lateAfter = Math.min(Math.max(Number(b.late_after_min) || 10, 1), minutes);
  const opened = new Date();
  const closes = new Date(opened.getTime() + minutes * 60000);

  const info = db.prepare(`INSERT INTO attendance_sessions (course_id,tutor_id,topic,opened_at,closes_at,late_after_min,status)
                           VALUES (?,?,?,?,?,?,'LIVE')`)
    .run(course_id, req.user.id, topic, opened.toISOString(), closes.toISOString(), lateAfter);

  const session = sessionRow(info.lastInsertRowid);
  const roster = db.prepare('SELECT student_id FROM enrollments WHERE course_id=?').all(course_id).map((r) => r.student_id);
  C.audit(req.user, 'ATTENDANCE_SESSION_OPENED', 'session:' + info.lastInsertRowid, { course: course.code, topic, minutes }, req.ip);
  rt.broadcast('attendance:session_opened', { session }, { roles: C.ADMIN_ROLES, userIds: [...roster, req.user.id] });
  for (const sid of roster) C.notify(sid, 'Attendance is live', `${course.code} — ${topic}. Mark yourself present before the register closes.`, 'success');
  res.status(201).json({ session });
});

router.post('/sessions/:id/close', C.requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const s = db.prepare('SELECT * FROM attendance_sessions WHERE id=?').get(id);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  if (s.tutor_id !== req.user.id && !C.can(req.user, 'attendance.manage')) return res.status(403).json({ error: 'Not permitted' });
  const closed = closeSession(id, req.user, 'manual');
  if (!closed) return res.status(409).json({ error: 'That register is already closed' });
  res.json({ session: closed });
});

router.get('/sessions', C.requireAuth, (req, res) => {
  sweepExpired();
  const u = req.user;
  const scope = String(req.query.scope || '');
  let where = '';
  const params = {};
  if (u.role === 'TUTOR') { where = 'WHERE s.tutor_id=@uid'; params.uid = u.id; }
  else if (u.role === 'STUDENT') { where = 'WHERE s.course_id IN (SELECT course_id FROM enrollments WHERE student_id=@uid)'; params.uid = u.id; }
  else if (!C.can(u, 'attendance.view')) return res.status(403).json({ error: 'Missing privilege: attendance.view' });
  if (scope === 'live') where += (where ? ' AND ' : 'WHERE ') + "s.status='LIVE'";

  const rows = db.prepare(`SELECT s.*, c.code AS course_code, c.title AS course_title, l.name AS level_name,
                                  t.full_name AS tutor_name, t.uid AS tutor_uid,
                                  (SELECT COUNT(*) FROM enrollments e WHERE e.course_id=s.course_id) AS roster_size,
                                  (SELECT COUNT(*) FROM attendance_marks m WHERE m.session_id=s.id AND m.status<>'ABSENT') AS present_count,
                                  (SELECT COUNT(*) FROM attendance_marks m WHERE m.session_id=s.id) AS marked_count
                           FROM attendance_sessions s
                           JOIN courses c ON c.id=s.course_id
                           JOIN levels l ON l.id=c.level_id
                           JOIN users t ON t.id=s.tutor_id
                           ${where}
                           ORDER BY s.opened_at DESC LIMIT 200`).all(params);
  res.json({ sessions: rows, server_time: nowISO() });
});

router.get('/sessions/:id', C.requireAuth, (req, res) => {
  sweepExpired();
  const id = Number(req.params.id);
  const session = sessionRow(id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const u = req.user;
  const enrolled = db.prepare('SELECT 1 FROM enrollments WHERE course_id=? AND student_id=?').get(session.course_id, u.id);
  const allowed = C.ADMIN_ROLES.includes(u.role) || session.tutor_id === u.id || !!enrolled;
  if (!allowed) return res.status(403).json({ error: 'Not permitted' });

  const roster = db.prepare(`SELECT u.id,u.uid,u.full_name,u.passport, m.status, m.marked_at
                             FROM enrollments e JOIN users u ON u.id=e.student_id
                             LEFT JOIN attendance_marks m ON m.session_id=@sid AND m.student_id=u.id
                             WHERE e.course_id=@cid ORDER BY u.uid`).all({ sid: id, cid: session.course_id });
  const online = new Set(rt.onlineUsers().map((o) => o.id));
  res.json({
    session,
    roster: roster.map((r) => ({ ...r, status: r.status || 'PENDING', online: online.has(r.id) })),
    server_time: nowISO(),
    me: u.role === 'STUDENT' ? (roster.find((r) => r.id === u.id) || null) : null,
  });
});

/** Student self-marks while the register is live. */
router.post('/sessions/:id/mark', C.requireAuth, C.requireRole('STUDENT'), (req, res) => {
  sweepExpired();
  const id = Number(req.params.id);
  const s = db.prepare('SELECT * FROM attendance_sessions WHERE id=?').get(id);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  if (s.status !== 'LIVE') return res.status(409).json({ error: 'This register has closed' });
  const enrolled = db.prepare('SELECT 1 FROM enrollments WHERE course_id=? AND student_id=?').get(s.course_id, req.user.id);
  if (!enrolled) return res.status(403).json({ error: 'You are not enrolled in this course' });
  const already = db.prepare('SELECT * FROM attendance_marks WHERE session_id=? AND student_id=?').get(id, req.user.id);
  if (already && already.status !== 'ABSENT') return res.status(409).json({ error: 'You are already marked ' + already.status.toLowerCase() });

  const now = new Date();
  const lateLine = new Date(new Date(s.opened_at).getTime() + s.late_after_min * 60000);
  const status = now > lateLine ? 'LATE' : 'PRESENT';
  db.prepare(`INSERT INTO attendance_marks (session_id,student_id,status,marked_at) VALUES (?,?,?,?)
              ON CONFLICT(session_id,student_id) DO UPDATE SET status=excluded.status, marked_at=excluded.marked_at`)
    .run(id, req.user.id, status, now.toISOString());

  const full = sessionRow(id);
  const payload = { session_id: id, course_code: full.course_code, student: { id: req.user.id, uid: req.user.uid, full_name: req.user.full_name, passport: req.user.passport }, status, marked_at: now.toISOString(), marked_count: full.marked_count, roster_size: full.roster_size };
  rt.broadcast('attendance:marked', payload, { roles: C.ADMIN_ROLES, userIds: [s.tutor_id] });
  rt.broadcast('attendance:self_marked', payload, { userIds: [req.user.id] });
  C.audit(req.user, 'ATTENDANCE_MARKED', 'session:' + id, { course: full.course_code, status }, req.ip);
  res.json({ ok: true, status, marked_at: now.toISOString() });
});

/** Tutor or attendance manager overrides a student's state. */
router.post('/sessions/:id/mark-student', C.requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const s = db.prepare('SELECT * FROM attendance_sessions WHERE id=?').get(id);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  if (s.tutor_id !== req.user.id && !C.can(req.user, 'attendance.manage')) return res.status(403).json({ error: 'Not permitted' });
  const student_id = Number(req.body.student_id);
  const status = String(req.body.status || '').toUpperCase();
  if (!['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  db.prepare(`INSERT INTO attendance_marks (session_id,student_id,status,marked_at) VALUES (?,?,?,?)
              ON CONFLICT(session_id,student_id) DO UPDATE SET status=excluded.status, marked_at=excluded.marked_at`)
    .run(id, student_id, status, nowISO());
  const full = sessionRow(id);
  const st = db.prepare('SELECT id,uid,full_name,passport FROM users WHERE id=?').get(student_id);
  C.audit(req.user, 'ATTENDANCE_OVERRIDE', 'session:' + id, { student: st && st.uid, status }, req.ip);
  rt.broadcast('attendance:marked', { session_id: id, course_code: full.course_code, student: st, status, marked_at: nowISO(), marked_count: full.marked_count, roster_size: full.roster_size }, { roles: C.ADMIN_ROLES, userIds: [s.tutor_id, student_id] });
  res.json({ ok: true });
});

/* --------------------- student attendance record ------------------- */

router.get('/student/:id', C.requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (id !== req.user.id && !C.ADMIN_ROLES.includes(req.user.role) && req.user.role !== 'TUTOR') {
    return res.status(403).json({ error: 'Not permitted' });
  }
  const rows = db.prepare(`SELECT m.status, m.marked_at, s.opened_at, s.topic, c.code AS course_code, c.title AS course_title
                           FROM attendance_marks m
                           JOIN attendance_sessions s ON s.id=m.session_id
                           JOIN courses c ON c.id=s.course_id
                           WHERE m.student_id=? ORDER BY s.opened_at DESC LIMIT 300`).all(id);
  const total = rows.length;
  const present = rows.filter((r) => r.status === 'PRESENT' || r.status === 'LATE').length;
  const byCourse = {};
  for (const r of rows) {
    byCourse[r.course_code] = byCourse[r.course_code] || { course_code: r.course_code, course_title: r.course_title, total: 0, present: 0 };
    byCourse[r.course_code].total += 1;
    if (r.status === 'PRESENT' || r.status === 'LATE') byCourse[r.course_code].present += 1;
  }
  res.json({
    records: rows, total, present,
    rate: total ? Math.round((present / total) * 1000) / 10 : 0,
    by_course: Object.values(byCourse).map((c) => ({ ...c, rate: c.total ? Math.round((c.present / c.total) * 1000) / 10 : 0 })),
  });
});

/* ------------------------ staff attendance ------------------------- */

router.post('/staff/clock-in', C.requireAuth, (req, res) => {
  if (req.user.role === 'STUDENT') return res.status(403).json({ error: 'Staff register only' });
  const date = todayStr();
  const existing = db.prepare('SELECT * FROM staff_attendance WHERE user_id=? AND work_date=?').get(req.user.id, date);
  if (existing && existing.clock_in) return res.status(409).json({ error: 'You already clocked in today at ' + new Date(existing.clock_in).toLocaleTimeString('en-GB') });
  const now = nowISO();
  db.prepare(`INSERT INTO staff_attendance (user_id,work_date,clock_in,status) VALUES (?,?,?,'PRESENT')
              ON CONFLICT(user_id,work_date) DO UPDATE SET clock_in=excluded.clock_in, status='PRESENT'`).run(req.user.id, date, now);
  C.audit(req.user, 'STAFF_CLOCK_IN', 'staff_attendance', { date }, req.ip);
  rt.broadcast('staff_attendance:changed', { user_id: req.user.id, uid: req.user.uid, full_name: req.user.full_name, role: req.user.role, clock_in: now, work_date: date }, { roles: C.ADMIN_ROLES });
  res.json({ ok: true, clock_in: now });
});

router.post('/staff/clock-out', C.requireAuth, (req, res) => {
  const date = todayStr();
  const existing = db.prepare('SELECT * FROM staff_attendance WHERE user_id=? AND work_date=?').get(req.user.id, date);
  if (!existing || !existing.clock_in) return res.status(409).json({ error: 'Clock in first' });
  if (existing.clock_out) return res.status(409).json({ error: 'You already clocked out today' });
  const now = new Date();
  const minutes = Math.round((now - new Date(existing.clock_in)) / 60000);
  db.prepare('UPDATE staff_attendance SET clock_out=?, minutes=? WHERE id=?').run(now.toISOString(), minutes, existing.id);
  C.audit(req.user, 'STAFF_CLOCK_OUT', 'staff_attendance', { date, minutes }, req.ip);
  rt.broadcast('staff_attendance:changed', { user_id: req.user.id, uid: req.user.uid, full_name: req.user.full_name, role: req.user.role, clock_out: now.toISOString(), minutes, work_date: date }, { roles: C.ADMIN_ROLES });
  res.json({ ok: true, clock_out: now.toISOString(), minutes });
});

router.get('/staff', C.requireAuth, (req, res) => {
  const date = String(req.query.date || todayStr());
  const mine = String(req.query.mine || '') === '1';
  if (!mine && !C.can(req.user, 'attendance.view')) return res.status(403).json({ error: 'Missing privilege: attendance.view' });
  if (mine) {
    const rows = db.prepare('SELECT * FROM staff_attendance WHERE user_id=? ORDER BY work_date DESC LIMIT 60').all(req.user.id);
    const minutes = rows.reduce((a, r) => a + r.minutes, 0);
    return res.json({ records: rows, days: rows.length, hours: Math.round((minutes / 60) * 10) / 10, today: rows.find((r) => r.work_date === todayStr()) || null });
  }
  const rows = db.prepare(`SELECT u.id,u.uid,u.full_name,u.role,u.designation,u.passport,
                                  a.clock_in,a.clock_out,a.minutes,a.status,a.work_date
                           FROM users u
                           LEFT JOIN staff_attendance a ON a.user_id=u.id AND a.work_date=?
                           WHERE u.role IN ('TUTOR','ADMIN','DG_CEO','SUPER_ADMIN') AND u.status='ACTIVE'
                           ORDER BY CASE u.role WHEN 'SUPER_ADMIN' THEN 1 WHEN 'DG_CEO' THEN 2 WHEN 'ADMIN' THEN 3 ELSE 4 END, u.full_name`).all(date);
  const online = new Set(rt.onlineUsers().map((o) => o.id));
  res.json({
    date,
    records: rows.map((r) => ({ ...r, status: r.clock_in ? (r.clock_out ? 'COMPLETED' : 'ON DUTY') : 'NOT CLOCKED IN', online: online.has(r.id) })),
  });
});

module.exports = router;
