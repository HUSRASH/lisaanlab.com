'use strict';
const express = require('express');
const { db, nowISO } = require('../db');
const C = require('../core');
const rt = require('../realtime');

const router = express.Router();

const FULL = `SELECT a.*, c.code AS course_code, c.title AS course_title, c.credit_units, c.level_id, c.semester_id,
                     l.name AS level_name, s.name AS semester_name, s.ordinal AS semester_ordinal,
                     t.full_name AS tutor_name, t.uid AS tutor_uid, t.passport AS tutor_passport,
                     ap.full_name AS approver_name, ap.uid AS approver_uid,
                     (SELECT COUNT(*) FROM questions q WHERE q.assessment_id=a.id) AS question_count,
                     (SELECT COALESCE(SUM(q.marks),0) FROM questions q WHERE q.assessment_id=a.id) AS total_marks,
                     (SELECT COUNT(*) FROM submissions sb WHERE sb.assessment_id=a.id) AS submission_count,
                     (SELECT COUNT(*) FROM enrollments e WHERE e.course_id=a.course_id) AS roster_size,
                     (SELECT ROUND(AVG(sb.percent),2) FROM submissions sb WHERE sb.assessment_id=a.id) AS average_percent
              FROM assessments a
              JOIN courses c ON c.id=a.course_id
              JOIN levels l ON l.id=c.level_id
              JOIN semesters s ON s.id=c.semester_id
              JOIN users t ON t.id=a.tutor_id
              LEFT JOIN users ap ON ap.id=a.approved_by`;

const one = (id) => db.prepare(`${FULL} WHERE a.id=?`).get(id);

function sweep() {
  const due = db.prepare("SELECT id FROM assessments WHERE status='LIVE' AND closes_at IS NOT NULL AND closes_at <= ?").all(nowISO());
  for (const d of due) {
    db.prepare("UPDATE assessments SET status='CLOSED' WHERE id=?").run(d.id);
    rt.broadcast('assessment:closed', { assessment: one(d.id) }, {});
  }
}
setInterval(() => { try { sweep(); } catch {} }, 15000).unref();

function canManage(user, a) {
  return a.tutor_id === user.id || user.role === 'SUPER_ADMIN' || C.can(user, 'assessments.approve');
}

/* --------------------------- RESULTS ------------------------------ *
 * Declared before the /:id routes so that "results" is never captured
 * as an assessment id by patterns such as /:id/publish.
 * ------------------------------------------------------------------ */

router.get('/results/preview', C.requireAuth, C.requirePerm('results.publish'), (req, res) => {
  const level_id = Number(req.query.level_id);
  const semester_id = Number(req.query.semester_id);
  const sem = db.prepare('SELECT * FROM semesters WHERE id=? AND level_id=?').get(semester_id, level_id);
  if (!sem) return res.status(400).json({ error: 'Select a valid level and semester' });
  const students = db.prepare("SELECT id,uid,full_name,passport FROM users WHERE role='STUDENT' AND level_id=? AND status='ACTIVE' ORDER BY uid").all(level_id);
  const rows = students.map((s) => {
    const st = computeStatement(s.id, level_id, semester_id);
    const published = db.prepare('SELECT published_at FROM results WHERE student_id=? AND semester_id=?').get(s.id, semester_id);
    return { student: s, ...st, published_at: published ? published.published_at : null };
  });
  res.json({ semester: sem, students: rows });
});

router.post('/results/publish', C.requireAuth, C.requirePerm('results.publish'), (req, res) => {
  const level_id = Number(req.body.level_id);
  const semester_id = Number(req.body.semester_id);
  const sem = db.prepare('SELECT s.*, l.name AS level_name FROM semesters s JOIN levels l ON l.id=s.level_id WHERE s.id=? AND s.level_id=?').get(semester_id, level_id);
  if (!sem) return res.status(400).json({ error: 'Select a valid level and semester' });
  const only = Array.isArray(req.body.student_ids) && req.body.student_ids.length ? req.body.student_ids.map(Number) : null;
  const students = db.prepare("SELECT id,uid,full_name FROM users WHERE role='STUDENT' AND level_id=? AND status='ACTIVE'").all(level_id)
    .filter((s) => !only || only.includes(s.id));
  if (!students.length) return res.status(400).json({ error: 'No active students at that level' });

  const upsert = db.prepare(`INSERT INTO results (student_id,level_id,semester_id,payload,gpa,remark,published_by,published_at)
                             VALUES (?,?,?,?,?,?,?,?)
                             ON CONFLICT(student_id,semester_id) DO UPDATE SET
                               payload=excluded.payload, gpa=excluded.gpa, remark=excluded.remark,
                               published_by=excluded.published_by, published_at=excluded.published_at`);
  const at = nowISO();
  let published = 0;
  const tx = db.transaction(() => {
    for (const s of students) {
      const st = computeStatement(s.id, level_id, semester_id);
      upsert.run(s.id, level_id, semester_id, JSON.stringify({ ...st, semester: sem.name, level: sem.level_name, student: s }), st.gpa, st.remark, req.user.id, at);
      published += 1;
    }
  });
  tx();
  for (const s of students) {
    C.notify(s.id, 'Statement of result published', `${sem.level_name} — ${sem.name}`, 'success');
    rt.broadcast('result:published', { semester_id, level_id, semester: sem.name, level: sem.level_name }, { userIds: [s.id] });
  }
  C.audit(req.user, 'RESULTS_PUBLISHED', 'semester:' + semester_id, { level: sem.level_name, semester: sem.name, students: published }, req.ip);
  rt.broadcast('results:changed', { semester_id, level_id, published }, { roles: C.ADMIN_ROLES });
  res.json({ ok: true, published, semester: sem.name, level: sem.level_name });
});

router.get('/results/student/:id', C.requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (id !== req.user.id && !C.ADMIN_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Not permitted' });
  const rows = db.prepare(`SELECT r.*, s.name AS semester_name, s.ordinal AS semester_ordinal, l.name AS level_name, l.ordinal AS level_ordinal,
                                  p.full_name AS published_by_name
                           FROM results r JOIN semesters s ON s.id=r.semester_id JOIN levels l ON l.id=r.level_id
                           LEFT JOIN users p ON p.id=r.published_by
                           WHERE r.student_id=? ORDER BY l.ordinal, s.ordinal`).all(id);
  const student = db.prepare('SELECT id,uid,full_name,passport,admission_year,level_id FROM users WHERE id=?').get(id);
  const statements = rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
  const cgpa = statements.length ? Math.round((statements.reduce((a, s) => a + s.gpa, 0) / statements.length) * 100) / 100 : 0;
  res.json({ student, statements, cgpa });
});

/* ----------------------------- create ----------------------------- */

router.post('/', C.requireAuth, (req, res) => {
  const b = req.body || {};
  const course = db.prepare('SELECT * FROM courses WHERE id=?').get(Number(b.course_id));
  if (!course) return res.status(404).json({ error: 'Course not found' });
  if (course.tutor_id !== req.user.id && req.user.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'Only the assigned tutor can create assessments for this course' });
  }
  const type = String(b.type || '').toUpperCase();
  if (!['TEST', 'EXAM'].includes(type)) return res.status(400).json({ error: 'Type must be TEST or EXAM' });
  const title = String(b.title || '').trim();
  if (title.length < 3) return res.status(400).json({ error: 'Enter a title' });

  const info = db.prepare(`INSERT INTO assessments (course_id,tutor_id,type,title,instructions,weight,duration_min,status,created_at)
                           VALUES (?,?,?,?,?,?,?,'DRAFT',?)`)
    .run(course.id, req.user.id, type, title, String(b.instructions || ''),
         Math.min(Math.max(Number(b.weight) || (type === 'EXAM' ? 60 : 20), 1), 100),
         Math.min(Math.max(Number(b.duration_min) || 30, 5), 300), nowISO());

  const assessment = one(info.lastInsertRowid);
  C.audit(req.user, 'ASSESSMENT_CREATED', 'assessment:' + assessment.id, { course: course.code, title, type }, req.ip);
  rt.broadcast('assessment:changed', { assessment }, { roles: C.ADMIN_ROLES });
  res.status(201).json({ assessment });
});

/* ------------------------------ read ------------------------------ */

router.get('/', C.requireAuth, (req, res) => {
  sweep();
  const u = req.user;
  if (u.role === 'STUDENT') {
    const rows = db.prepare(`${FULL}
      WHERE a.course_id IN (SELECT course_id FROM enrollments WHERE student_id=@sid)
        AND a.status IN ('LIVE','CLOSED')
      ORDER BY a.opens_at DESC, a.created_at DESC`).all({ sid: u.id });
    const subs = db.prepare('SELECT assessment_id,score,max_score,percent,submitted_at FROM submissions WHERE student_id=?').all(u.id);
    const map = new Map(subs.map((s) => [s.assessment_id, s]));
    return res.json({
      assessments: rows.map((a) => {
        const mine = map.get(a.id) || null;
        const { average_percent, submission_count, ...safe } = a;
        return { ...safe, my_submission: mine, can_sit: a.status === 'LIVE' && !mine };
      }),
      server_time: nowISO(),
    });
  }
  if (u.role === 'TUTOR') return res.json({ assessments: db.prepare(`${FULL} WHERE a.tutor_id=? ORDER BY a.created_at DESC`).all(u.id), server_time: nowISO() });
  if (!C.can(u, 'assessments.view') && !C.can(u, 'assessments.approve')) return res.status(403).json({ error: 'Missing privilege: assessments.view' });
  const status = req.query.status ? String(req.query.status).toUpperCase() : null;
  const rows = status
    ? db.prepare(`${FULL} WHERE a.status=? ORDER BY a.created_at DESC`).all(status)
    : db.prepare(`${FULL} ORDER BY a.created_at DESC LIMIT 300`).all();
  res.json({ assessments: rows, server_time: nowISO() });
});

router.get('/:id', C.requireAuth, (req, res) => {
  sweep();
  const a = one(Number(req.params.id));
  if (!a) return res.status(404).json({ error: 'Assessment not found' });
  const u = req.user;
  if (u.role === 'STUDENT') {
    const enrolled = db.prepare('SELECT 1 FROM enrollments WHERE course_id=? AND student_id=?').get(a.course_id, u.id);
    if (!enrolled) return res.status(403).json({ error: 'Not enrolled in this course' });
    const mine = db.prepare('SELECT * FROM submissions WHERE assessment_id=? AND student_id=?').get(a.id, u.id);
    return res.json({ assessment: a, my_submission: mine ? { ...mine, breakdown: JSON.parse(mine.breakdown) } : null });
  }
  const allowed = canManage(u, a) || C.can(u, 'assessments.view');
  if (!allowed) return res.status(403).json({ error: 'Not permitted' });
  const questions = db.prepare('SELECT * FROM questions WHERE assessment_id=? ORDER BY ordinal').all(a.id)
    .map((q) => ({ ...q, options: q.options ? JSON.parse(q.options) : null }));
  res.json({ assessment: a, questions });
});

/* ---------------------------- questions --------------------------- */

router.post('/:id/questions', C.requireAuth, (req, res) => {
  const a = one(Number(req.params.id));
  if (!a) return res.status(404).json({ error: 'Assessment not found' });
  if (a.tutor_id !== req.user.id && req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Only the owning tutor can edit questions' });
  if (!['DRAFT', 'REJECTED'].includes(a.status)) return res.status(409).json({ error: 'Questions are locked once the paper is submitted for approval' });

  const list = Array.isArray(req.body && req.body.questions) ? req.body.questions : [req.body];
  const ins = db.prepare('INSERT INTO questions (assessment_id,ordinal,qtype,prompt,options,answer,marks) VALUES (?,?,?,?,?,?,?)');
  const start = db.prepare('SELECT COALESCE(MAX(ordinal),0) n FROM questions WHERE assessment_id=?').get(a.id).n;
  let i = start;
  const errors = [];
  const tx = db.transaction(() => {
    for (const q of list) {
      const qtype = String(q.qtype || 'MCQ').toUpperCase();
      const prompt = String(q.prompt || '').trim();
      const marks = Math.min(Math.max(Number(q.marks) || 1, 1), 100);
      if (!prompt) { errors.push('A question has no text'); continue; }
      let options = null;
      let answer = String(q.answer == null ? '' : q.answer).trim();
      if (qtype === 'MCQ') {
        const opts = (q.options || []).map((o) => String(o).trim()).filter(Boolean);
        if (opts.length < 2) { errors.push(`"${prompt.slice(0, 30)}" needs at least two options`); continue; }
        if (!opts.some((o) => o.toLowerCase() === answer.toLowerCase())) { errors.push(`"${prompt.slice(0, 30)}" — the correct answer must match one option`); continue; }
        options = JSON.stringify(opts);
      } else if (qtype === 'TRUE_FALSE') {
        answer = /^t(rue)?$/i.test(answer) ? 'True' : 'False';
        options = JSON.stringify(['True', 'False']);
      } else if (qtype !== 'SHORT_ANSWER') { errors.push('Unsupported question type ' + qtype); continue; }
      if (!answer) { errors.push(`"${prompt.slice(0, 30)}" has no correct answer`); continue; }
      ins.run(a.id, ++i, qtype, prompt, options, answer, marks);
    }
  });
  tx();
  const questions = db.prepare('SELECT * FROM questions WHERE assessment_id=? ORDER BY ordinal').all(a.id)
    .map((q) => ({ ...q, options: q.options ? JSON.parse(q.options) : null }));
  C.audit(req.user, 'QUESTIONS_ADDED', 'assessment:' + a.id, { added: i - start }, req.ip);
  res.json({ questions, assessment: one(a.id), errors });
});

router.delete('/:id/questions/:qid', C.requireAuth, (req, res) => {
  const a = one(Number(req.params.id));
  if (!a) return res.status(404).json({ error: 'Assessment not found' });
  if (a.tutor_id !== req.user.id && req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Not permitted' });
  if (!['DRAFT', 'REJECTED'].includes(a.status)) return res.status(409).json({ error: 'Questions are locked' });
  db.prepare('DELETE FROM questions WHERE id=? AND assessment_id=?').run(Number(req.params.qid), a.id);
  db.prepare('SELECT id FROM questions WHERE assessment_id=? ORDER BY ordinal').all(a.id)
    .forEach((q, idx) => db.prepare('UPDATE questions SET ordinal=? WHERE id=?').run(idx + 1, q.id));
  res.json({ ok: true, assessment: one(a.id) });
});

/* ------------------------ approval workflow ----------------------- */

router.post('/:id/submit-for-approval', C.requireAuth, (req, res) => {
  const a = one(Number(req.params.id));
  if (!a) return res.status(404).json({ error: 'Assessment not found' });
  if (a.tutor_id !== req.user.id && req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Not permitted' });
  if (!['DRAFT', 'REJECTED'].includes(a.status)) return res.status(409).json({ error: 'Already submitted' });
  if (!a.question_count) return res.status(400).json({ error: 'Add at least one question first' });

  db.prepare("UPDATE assessments SET status='PENDING_APPROVAL', review_note=NULL WHERE id=?").run(a.id);
  const updated = one(a.id);
  C.audit(req.user, 'ASSESSMENT_SUBMITTED_FOR_APPROVAL', 'assessment:' + a.id, { course: a.course_code, title: a.title }, req.ip);
  rt.broadcast('assessment:changed', { assessment: updated }, { roles: C.ADMIN_ROLES });
  db.prepare("SELECT u.id FROM users u JOIN permissions p ON p.user_id=u.id WHERE p.pkey='assessments.approve' AND p.enabled=1 AND u.status='ACTIVE'").all()
    .forEach((o) => C.notify(o.id, 'Assessment awaiting vetting', `${a.course_code} — ${a.title} (${a.type})`, 'warning'));
  db.prepare("SELECT id FROM users WHERE role='SUPER_ADMIN'").all()
    .forEach((o) => C.notify(o.id, 'Assessment awaiting vetting', `${a.course_code} — ${a.title} (${a.type})`, 'warning'));
  res.json({ assessment: updated });
});

router.post('/:id/approve', C.requireAuth, C.requirePerm('assessments.approve'), (req, res) => {
  const a = one(Number(req.params.id));
  if (!a) return res.status(404).json({ error: 'Assessment not found' });
  if (a.status !== 'PENDING_APPROVAL') return res.status(409).json({ error: 'This paper is not awaiting approval' });
  db.prepare("UPDATE assessments SET status='APPROVED', approved_by=?, approved_at=?, review_note=? WHERE id=?")
    .run(req.user.id, nowISO(), String(req.body && req.body.note || ''), a.id);
  const updated = one(a.id);
  C.audit(req.user, 'ASSESSMENT_APPROVED', 'assessment:' + a.id, { course: a.course_code, title: a.title }, req.ip);
  rt.broadcast('assessment:changed', { assessment: updated }, { roles: C.ADMIN_ROLES, userIds: [a.tutor_id] });
  C.notify(a.tutor_id, 'Assessment approved', `${a.course_code} — ${a.title} is cleared by the exams officer. You may publish it.`, 'success');
  res.json({ assessment: updated });
});

router.post('/:id/reject', C.requireAuth, C.requirePerm('assessments.approve'), (req, res) => {
  const a = one(Number(req.params.id));
  if (!a) return res.status(404).json({ error: 'Assessment not found' });
  if (a.status !== 'PENDING_APPROVAL') return res.status(409).json({ error: 'This paper is not awaiting approval' });
  const note = String(req.body && req.body.note || '').trim();
  if (!note) return res.status(400).json({ error: 'State why the paper is returned' });
  db.prepare("UPDATE assessments SET status='REJECTED', review_note=? WHERE id=?").run(note, a.id);
  const updated = one(a.id);
  C.audit(req.user, 'ASSESSMENT_REJECTED', 'assessment:' + a.id, { course: a.course_code, note }, req.ip);
  rt.broadcast('assessment:changed', { assessment: updated }, { roles: C.ADMIN_ROLES, userIds: [a.tutor_id] });
  C.notify(a.tutor_id, 'Assessment returned', `${a.course_code} — ${a.title}: ${note}`, 'danger');
  res.json({ assessment: updated });
});

router.post('/:id/publish', C.requireAuth, (req, res) => {
  const a = one(Number(req.params.id));
  if (!a) return res.status(404).json({ error: 'Assessment not found' });
  if (a.tutor_id !== req.user.id && req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Not permitted' });
  if (a.status !== 'APPROVED') return res.status(409).json({ error: 'The exams officer must approve this paper before it goes live' });

  const opens = req.body && req.body.opens_at ? new Date(req.body.opens_at) : new Date();
  const windowMin = Math.min(Math.max(Number(req.body && req.body.window_min) || a.duration_min, 5), 1440);
  const closes = new Date(opens.getTime() + windowMin * 60000);
  db.prepare("UPDATE assessments SET status='LIVE', opens_at=?, closes_at=?, published_at=? WHERE id=?")
    .run(opens.toISOString(), closes.toISOString(), nowISO(), a.id);

  const updated = one(a.id);
  const roster = db.prepare('SELECT student_id FROM enrollments WHERE course_id=?').all(a.course_id).map((r) => r.student_id);
  C.audit(req.user, 'ASSESSMENT_PUBLISHED', 'assessment:' + a.id, { course: a.course_code, title: a.title, closes: closes.toISOString() }, req.ip);
  rt.broadcast('assessment:published', { assessment: updated }, { roles: C.ADMIN_ROLES, userIds: [...roster, a.tutor_id] });
  for (const sid of roster) C.notify(sid, `${a.type === 'EXAM' ? 'Examination' : 'Test'} is live`, `${a.course_code} — ${a.title}. Closes ${closes.toLocaleTimeString('en-GB')}.`, 'success');
  res.json({ assessment: updated });
});

router.post('/:id/close', C.requireAuth, (req, res) => {
  const a = one(Number(req.params.id));
  if (!a) return res.status(404).json({ error: 'Assessment not found' });
  if (!canManage(req.user, a)) return res.status(403).json({ error: 'Not permitted' });
  if (a.status !== 'LIVE') return res.status(409).json({ error: 'Not currently live' });
  db.prepare("UPDATE assessments SET status='CLOSED', closes_at=? WHERE id=?").run(nowISO(), a.id);
  const updated = one(a.id);
  C.audit(req.user, 'ASSESSMENT_CLOSED', 'assessment:' + a.id, { course: a.course_code }, req.ip);
  rt.broadcast('assessment:closed', { assessment: updated }, {});
  res.json({ assessment: updated });
});

/* ------------------------- sitting the paper ----------------------- */

router.get('/:id/paper', C.requireAuth, C.requireRole('STUDENT'), (req, res) => {
  sweep();
  const a = one(Number(req.params.id));
  if (!a) return res.status(404).json({ error: 'Assessment not found' });
  const enrolled = db.prepare('SELECT 1 FROM enrollments WHERE course_id=? AND student_id=?').get(a.course_id, req.user.id);
  if (!enrolled) return res.status(403).json({ error: 'Not enrolled in this course' });
  if (a.status !== 'LIVE') return res.status(409).json({ error: 'This paper is not open' });
  const already = db.prepare('SELECT id FROM submissions WHERE assessment_id=? AND student_id=?').get(a.id, req.user.id);
  if (already) return res.status(409).json({ error: 'You have already submitted this paper' });

  const questions = db.prepare('SELECT id,ordinal,qtype,prompt,options,marks FROM questions WHERE assessment_id=? ORDER BY ordinal').all(a.id)
    .map((q) => ({ ...q, options: q.options ? JSON.parse(q.options) : null })); // answers never leave the server
  res.json({ assessment: a, questions, server_time: nowISO(), closes_at: a.closes_at });
});

router.post('/:id/submit', C.requireAuth, C.requireRole('STUDENT'), (req, res) => {
  sweep();
  const a = one(Number(req.params.id));
  if (!a) return res.status(404).json({ error: 'Assessment not found' });
  if (a.status !== 'LIVE') return res.status(409).json({ error: 'The submission window has closed' });
  const enrolled = db.prepare('SELECT 1 FROM enrollments WHERE course_id=? AND student_id=?').get(a.course_id, req.user.id);
  if (!enrolled) return res.status(403).json({ error: 'Not enrolled in this course' });
  if (db.prepare('SELECT id FROM submissions WHERE assessment_id=? AND student_id=?').get(a.id, req.user.id)) {
    return res.status(409).json({ error: 'You have already submitted this paper' });
  }

  const answers = (req.body && req.body.answers) || {};
  const questions = db.prepare('SELECT * FROM questions WHERE assessment_id=? ORDER BY ordinal').all(a.id);
  if (!questions.length) return res.status(400).json({ error: 'This paper has no questions' });

  const marked = C.markSubmission(questions, answers);
  const submitted_at = nowISO();
  const info = db.prepare(`INSERT INTO submissions (assessment_id,student_id,answers,breakdown,score,max_score,percent,started_at,submitted_at)
                           VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(a.id, req.user.id, JSON.stringify(answers), JSON.stringify(marked.breakdown),
         marked.score, marked.max, marked.percent, (req.body && req.body.started_at) || null, submitted_at);

  const band = C.gradeOf(marked.percent);
  const updated = one(a.id);
  const payload = {
    assessment_id: a.id, course_code: a.course_code, title: a.title,
    student: { id: req.user.id, uid: req.user.uid, full_name: req.user.full_name, passport: req.user.passport },
    score: marked.score, max_score: marked.max, percent: marked.percent, grade: band.grade,
    submitted_at, submission_count: updated.submission_count, roster_size: updated.roster_size, average_percent: updated.average_percent,
  };
  // Score is final and visible to the student the instant they submit.
  rt.broadcast('submission:received', payload, { roles: C.ADMIN_ROLES, userIds: [a.tutor_id] });
  rt.broadcast('submission:mine', payload, { userIds: [req.user.id] });
  C.audit(req.user, 'ASSESSMENT_SUBMITTED', 'assessment:' + a.id, { course: a.course_code, percent: marked.percent }, req.ip);

  res.json({
    submission: { id: info.lastInsertRowid, score: marked.score, max_score: marked.max, percent: marked.percent, submitted_at },
    grade: band, breakdown: marked.breakdown,
  });
});

router.get('/:id/submissions', C.requireAuth, (req, res) => {
  const a = one(Number(req.params.id));
  if (!a) return res.status(404).json({ error: 'Assessment not found' });
  if (!canManage(req.user, a) && !C.can(req.user, 'assessments.view')) return res.status(403).json({ error: 'Not permitted' });
  const rows = db.prepare(`SELECT sb.id,sb.score,sb.max_score,sb.percent,sb.submitted_at,
                                  u.id AS student_id,u.uid,u.full_name,u.passport
                           FROM submissions sb JOIN users u ON u.id=sb.student_id
                           WHERE sb.assessment_id=? ORDER BY sb.percent DESC, sb.submitted_at`).all(a.id);
  const pending = db.prepare(`SELECT u.id,u.uid,u.full_name,u.passport FROM enrollments e JOIN users u ON u.id=e.student_id
                              WHERE e.course_id=? AND u.id NOT IN (SELECT student_id FROM submissions WHERE assessment_id=?)
                              ORDER BY u.uid`).all(a.course_id, a.id);
  res.json({
    assessment: a,
    submissions: rows.map((r) => ({ ...r, grade: C.gradeOf(r.percent).grade })),
    pending,
  });
});

/* --------------------------- RESULTS ------------------------------ */

/** Compute a semester statement for one student from real submissions. */
function computeStatement(studentId, levelId, semesterId) {
  const courses = db.prepare(`SELECT c.* FROM courses c
                              JOIN enrollments e ON e.course_id=c.id
                              WHERE e.student_id=? AND c.semester_id=? AND c.level_id=?
                              ORDER BY c.code`).all(studentId, semesterId, levelId);
  const lines = [];
  let qp = 0, units = 0;
  for (const c of courses) {
    const assessments = db.prepare("SELECT * FROM assessments WHERE course_id=? AND status IN ('LIVE','CLOSED')").all(c.id);
    let weighted = 0, weightTotal = 0;
    const components = [];
    for (const a of assessments) {
      const sub = db.prepare('SELECT * FROM submissions WHERE assessment_id=? AND student_id=?').get(a.id, studentId);
      const pct = sub ? sub.percent : 0;
      weighted += pct * a.weight;
      weightTotal += a.weight;
      components.push({ type: a.type, title: a.title, weight: a.weight, percent: pct, sat: !!sub });
    }
    const percent = weightTotal ? Math.round((weighted / weightTotal) * 100) / 100 : 0;
    const band = C.gradeOf(percent);
    const att = db.prepare(`SELECT COUNT(*) total, SUM(CASE WHEN m.status IN ('PRESENT','LATE','EXCUSED') THEN 1 ELSE 0 END) present
                            FROM attendance_marks m JOIN attendance_sessions s ON s.id=m.session_id
                            WHERE s.course_id=? AND m.student_id=?`).get(c.id, studentId);
    lines.push({
      course_code: c.code, course_title: c.title, credit_units: c.credit_units,
      percent, grade: band.grade, point: band.point, remark: band.remark,
      quality_points: band.point * c.credit_units, components,
      attendance_rate: att && att.total ? Math.round((att.present / att.total) * 1000) / 10 : null,
      assessments_count: assessments.length,
    });
    qp += band.point * c.credit_units;
    units += c.credit_units;
  }
  const gpa = units ? Math.round((qp / units) * 100) / 100 : 0;
  return { lines, gpa, units, quality_points: qp, remark: C.classOfGpa(gpa), courses: lines.length };
}

module.exports = router;
