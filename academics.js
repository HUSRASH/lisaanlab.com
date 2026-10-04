'use strict';
const express = require('express');
const { db, nowISO } = require('../db');
const C = require('../core');
const rt = require('../realtime');

const router = express.Router();

/* --------------------------- structure ---------------------------- */

router.get('/structure', C.requireAuth, (_req, res) => {
  const levels = db.prepare('SELECT * FROM levels ORDER BY ordinal').all();
  const semesters = db.prepare('SELECT * FROM semesters ORDER BY level_id, ordinal').all();
  const out = levels.map((l) => ({
    ...l,
    students: db.prepare("SELECT COUNT(*) n FROM users WHERE role='STUDENT' AND level_id=?").get(l.id).n,
    courses: db.prepare('SELECT COUNT(*) n FROM courses WHERE level_id=?').get(l.id).n,
    semesters: semesters.filter((s) => s.level_id === l.id).map((s) => ({
      ...s,
      courses: db.prepare('SELECT COUNT(*) n FROM courses WHERE semester_id=?').get(s.id).n,
    })),
  }));
  res.json({ levels: out });
});

/* ---------------------------- courses ----------------------------- */

function courseRows(where = '', params = {}) {
  return db.prepare(`SELECT c.*, l.name AS level_name, l.code AS level_code, s.name AS semester_name, s.ordinal AS semester_ordinal,
                            u.full_name AS tutor_name, u.uid AS tutor_uid, u.passport AS tutor_passport,
                            (SELECT COUNT(*) FROM enrollments e WHERE e.course_id=c.id) AS student_count,
                            (SELECT COUNT(*) FROM assessments a WHERE a.course_id=c.id) AS assessment_count,
                            (SELECT COUNT(*) FROM attendance_sessions t WHERE t.course_id=c.id AND t.status='LIVE') AS live_sessions
                     FROM courses c
                     JOIN levels l ON l.id=c.level_id
                     JOIN semesters s ON s.id=c.semester_id
                     LEFT JOIN users u ON u.id=c.tutor_id
                     ${where}
                     ORDER BY l.ordinal, s.ordinal, c.code`).all(params);
}

router.get('/courses', C.requireAuth, (req, res) => {
  const u = req.user;
  if (u.role === 'TUTOR') return res.json({ courses: courseRows('WHERE c.tutor_id=@id', { id: u.id }) });
  if (u.role === 'STUDENT') {
    return res.json({
      courses: db.prepare(`SELECT c.*, l.name AS level_name, s.name AS semester_name, s.ordinal AS semester_ordinal,
                                  t.full_name AS tutor_name, t.uid AS tutor_uid,
                                  (SELECT COUNT(*) FROM enrollments e2 WHERE e2.course_id=c.id) AS student_count
                           FROM enrollments e JOIN courses c ON c.id=e.course_id
                           JOIN levels l ON l.id=c.level_id JOIN semesters s ON s.id=c.semester_id
                           LEFT JOIN users t ON t.id=c.tutor_id
                           WHERE e.student_id=? ORDER BY l.ordinal, s.ordinal, c.code`).all(u.id),
    });
  }
  const filters = [];
  const params = {};
  if (req.query.level_id) { filters.push('c.level_id=@level_id'); params.level_id = Number(req.query.level_id); }
  if (req.query.semester_id) { filters.push('c.semester_id=@semester_id'); params.semester_id = Number(req.query.semester_id); }
  res.json({ courses: courseRows(filters.length ? 'WHERE ' + filters.join(' AND ') : '', params) });
});

router.post('/courses', C.requireAuth, C.requirePerm('academics.manage'), (req, res) => {
  const b = req.body || {};
  const code = String(b.code || '').trim().toUpperCase();
  const title = String(b.title || '').trim();
  const level_id = Number(b.level_id);
  const semester_id = Number(b.semester_id);
  const credit_units = Number(b.credit_units) || 2;
  const tutor_id = b.tutor_id ? Number(b.tutor_id) : null;

  if (!/^[A-Z]{2,6}[- ]?\d{2,4}$/.test(code)) return res.status(400).json({ error: 'Course code looks like ARB101 or LSL-201' });
  if (title.length < 3) return res.status(400).json({ error: 'Enter the course title' });
  if (db.prepare('SELECT id FROM courses WHERE code=?').get(code)) return res.status(409).json({ error: 'That course code already exists' });
  const sem = db.prepare('SELECT * FROM semesters WHERE id=? AND level_id=?').get(semester_id, level_id);
  if (!sem) return res.status(400).json({ error: 'Select a valid level and semester' });
  if (tutor_id) {
    const t = db.prepare("SELECT id FROM users WHERE id=? AND role='TUTOR'").get(tutor_id);
    if (!t) return res.status(400).json({ error: 'Selected tutor does not exist' });
  }

  const info = db.prepare('INSERT INTO courses (code,title,level_id,semester_id,credit_units,tutor_id,created_at) VALUES (?,?,?,?,?,?,?)')
    .run(code, title, level_id, semester_id, credit_units, tutor_id, nowISO());
  const course = courseRows('WHERE c.id=@id', { id: info.lastInsertRowid })[0];
  C.audit(req.user, 'COURSE_CREATED', 'course:' + info.lastInsertRowid, { code, title }, req.ip);
  rt.broadcast('course:created', { course }, { roles: C.ADMIN_ROLES });
  if (tutor_id) {
    rt.broadcast('course:assigned', { course }, { userIds: [tutor_id] });
    C.notify(tutor_id, 'New course assigned', `${code} — ${title}`, 'info');
  }
  res.status(201).json({ course });
});

router.patch('/courses/:id', C.requireAuth, C.requirePerm('academics.manage'), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM courses WHERE id=?').get(id);
  if (!existing) return res.status(404).json({ error: 'Course not found' });
  const b = req.body || {};
  const sets = [];
  const vals = [];
  if (b.title) { sets.push('title=?'); vals.push(String(b.title).trim()); }
  if (b.credit_units) { sets.push('credit_units=?'); vals.push(Number(b.credit_units)); }
  if (b.tutor_id !== undefined) {
    const tid = b.tutor_id ? Number(b.tutor_id) : null;
    if (tid && !db.prepare("SELECT id FROM users WHERE id=? AND role='TUTOR'").get(tid)) {
      return res.status(400).json({ error: 'Selected tutor does not exist' });
    }
    sets.push('tutor_id=?'); vals.push(tid);
  }
  if (b.level_id && b.semester_id) {
    const sem = db.prepare('SELECT * FROM semesters WHERE id=? AND level_id=?').get(Number(b.semester_id), Number(b.level_id));
    if (!sem) return res.status(400).json({ error: 'Select a valid level and semester' });
    sets.push('level_id=?', 'semester_id=?'); vals.push(Number(b.level_id), Number(b.semester_id));
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(id);
  db.prepare(`UPDATE courses SET ${sets.join(', ')} WHERE id=?`).run(...vals);
  const course = courseRows('WHERE c.id=@id', { id })[0];
  C.audit(req.user, 'COURSE_UPDATED', 'course:' + id, { code: course.code }, req.ip);
  rt.broadcast('course:updated', { course }, { roles: C.ADMIN_ROLES });
  if (course.tutor_id) rt.broadcast('course:updated', { course }, { userIds: [course.tutor_id] });
  res.json({ course });
});

router.delete('/courses/:id', C.requireAuth, C.requirePerm('academics.manage'), (req, res) => {
  const id = Number(req.params.id);
  const course = db.prepare('SELECT * FROM courses WHERE id=?').get(id);
  if (!course) return res.status(404).json({ error: 'Course not found' });
  db.prepare('DELETE FROM courses WHERE id=?').run(id);
  C.audit(req.user, 'COURSE_DELETED', 'course:' + id, { code: course.code }, req.ip);
  rt.broadcast('course:deleted', { id, code: course.code }, { roles: C.ADMIN_ROLES });
  res.json({ ok: true });
});

/* -------------------------- enrolments ---------------------------- */

router.get('/courses/:id/students', C.requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const course = db.prepare('SELECT * FROM courses WHERE id=?').get(id);
  if (!course) return res.status(404).json({ error: 'Course not found' });
  const privileged = C.ADMIN_ROLES.includes(req.user.role) || course.tutor_id === req.user.id;
  if (!privileged) return res.status(403).json({ error: 'Not permitted' });
  const students = db.prepare(`SELECT u.id,u.uid,u.full_name,u.email,u.passport,u.status,u.level_id,l.name AS level_name
                               FROM enrollments e JOIN users u ON u.id=e.student_id
                               LEFT JOIN levels l ON l.id=u.level_id
                               WHERE e.course_id=? ORDER BY u.uid`).all(id);
  const online = new Set(rt.onlineUsers().map((o) => o.id));
  res.json({ course, students: students.map((s) => ({ ...s, online: online.has(s.id) })) });
});

router.post('/courses/:id/enroll', C.requireAuth, C.requirePerm('academics.manage'), (req, res) => {
  const id = Number(req.params.id);
  const course = db.prepare('SELECT * FROM courses WHERE id=?').get(id);
  if (!course) return res.status(404).json({ error: 'Course not found' });
  const ids = Array.isArray(req.body && req.body.student_ids) ? req.body.student_ids.map(Number) : [];
  if (!ids.length) return res.status(400).json({ error: 'Select at least one student' });

  const ins = db.prepare('INSERT OR IGNORE INTO enrollments (student_id,course_id,created_at) VALUES (?,?,?)');
  let added = 0;
  const tx = db.transaction(() => {
    for (const sid of ids) {
      const s = db.prepare("SELECT id FROM users WHERE id=? AND role='STUDENT'").get(sid);
      if (!s) continue;
      const r = ins.run(sid, id, nowISO());
      if (r.changes) {
        added += 1;
        C.notify(sid, 'Enrolled in a course', `${course.code} — ${course.title}`, 'success');
        rt.broadcast('enrollment:changed', { course_id: id }, { userIds: [sid] });
      }
    }
  });
  tx();
  C.audit(req.user, 'STUDENTS_ENROLLED', 'course:' + id, { code: course.code, added }, req.ip);
  rt.broadcast('course:updated', { course: courseRows('WHERE c.id=@id', { id })[0] }, { roles: C.ADMIN_ROLES });
  if (course.tutor_id) rt.broadcast('roster:changed', { course_id: id }, { userIds: [course.tutor_id] });
  res.json({ ok: true, added });
});

router.delete('/courses/:id/enroll/:studentId', C.requireAuth, C.requirePerm('academics.manage'), (req, res) => {
  const id = Number(req.params.id);
  const sid = Number(req.params.studentId);
  db.prepare('DELETE FROM enrollments WHERE course_id=? AND student_id=?').run(id, sid);
  C.audit(req.user, 'ENROLLMENT_REMOVED', 'course:' + id, { student_id: sid }, req.ip);
  rt.broadcast('enrollment:changed', { course_id: id }, { userIds: [sid] });
  rt.broadcast('course:updated', { course: courseRows('WHERE c.id=@id', { id })[0] }, { roles: C.ADMIN_ROLES });
  res.json({ ok: true });
});

/** Bulk-enrol every student of a level into every course of a semester. */
router.post('/semesters/:id/auto-enroll', C.requireAuth, C.requirePerm('academics.manage'), (req, res) => {
  const semId = Number(req.params.id);
  const sem = db.prepare('SELECT * FROM semesters WHERE id=?').get(semId);
  if (!sem) return res.status(404).json({ error: 'Semester not found' });
  const courses = db.prepare('SELECT id FROM courses WHERE semester_id=?').all(semId);
  const students = db.prepare("SELECT id FROM users WHERE role='STUDENT' AND level_id=? AND status='ACTIVE'").all(sem.level_id);
  const ins = db.prepare('INSERT OR IGNORE INTO enrollments (student_id,course_id,created_at) VALUES (?,?,?)');
  let added = 0;
  const tx = db.transaction(() => {
    for (const s of students) for (const c of courses) added += ins.run(s.id, c.id, nowISO()).changes;
  });
  tx();
  C.audit(req.user, 'SEMESTER_AUTO_ENROLLED', 'semester:' + semId, { added, students: students.length, courses: courses.length }, req.ip);
  rt.broadcast('academics:changed', { semester_id: semId }, {});
  res.json({ ok: true, added, students: students.length, courses: courses.length });
});

/** Move a student to another level/semester (progression). */
router.post('/students/:id/placement', C.requireAuth, C.requirePerm('academics.manage'), (req, res) => {
  const id = Number(req.params.id);
  const student = db.prepare("SELECT * FROM users WHERE id=? AND role='STUDENT'").get(id);
  if (!student) return res.status(404).json({ error: 'Student not found' });
  const level_id = Number(req.body.level_id);
  const semester_id = Number(req.body.semester_id);
  const sem = db.prepare('SELECT * FROM semesters WHERE id=? AND level_id=?').get(semester_id, level_id);
  if (!sem) return res.status(400).json({ error: 'Select a valid level and semester' });
  db.prepare('UPDATE users SET level_id=?, semester_id=? WHERE id=?').run(level_id, semester_id, id);
  const updated = C.hydrateUser(db.prepare('SELECT * FROM users WHERE id=?').get(id));
  C.audit(req.user, 'STUDENT_PLACEMENT', 'user:' + id, { uid: student.uid, level_id, semester_id }, req.ip);
  C.notify(id, 'Placement updated', `You are now in ${updated.level_name} — ${updated.semester_name}`, 'info');
  rt.broadcast('user:updated', { user: updated }, { roles: C.ADMIN_ROLES });
  rt.broadcast('profile:updated', { user: updated }, { userIds: [id] });
  res.json({ user: updated });
});

module.exports = router;
