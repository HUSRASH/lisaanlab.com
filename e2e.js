'use strict';
/**
 * Lisaan Lab LMS — end-to-end test of the real HTTP API.
 * Runs against an isolated instance (LSL_DATA_DIR) so live data is never touched.
 */
const BASE = process.env.BASE || 'http://127.0.0.1:3100';

let pass = 0, fail = 0;
const results = [];
function check(name, cond, extra) {
  if (cond) { pass++; results.push(`  ✓ ${name}`); }
  else { fail++; results.push(`  ✗ ${name}${extra ? ' → ' + extra : ''}`); }
}
function section(t) { results.push(`\n▌ ${t}`); }

/* tiny cookie-aware client */
function client() {
  let cookie = '';
  return {
    get cookie() { return cookie; },
    async req(method, path, body, isForm) {
      const headers = {};
      if (cookie) headers.cookie = cookie;
      let payload;
      if (isForm) payload = body;
      else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
      const res = await fetch(BASE + path, { method, headers, body: payload, redirect: 'manual' });
      const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      for (const c of sc) { const m = /lsl_sid=([^;]*)/.exec(c); if (m) cookie = 'lsl_sid=' + m[1]; }
      const ct = res.headers.get('content-type') || '';
      const data = ct.includes('json') ? await res.json().catch(() => ({})) : await res.text();
      return { status: res.status, data };
    },
    get(p) { return this.req('GET', p); },
    post(p, b) { return this.req('POST', p, b); },
    patch(p, b) { return this.req('PATCH', p, b); },
    del(p) { return this.req('DELETE', p); },
    form(p, fd, method) { return this.req(method || 'POST', p, fd, true); },
  };
}

const pngPixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');

(async function run() {
  const su = client();

  /* ---------------------------------------------------------------- */
  section('Authentication & forced password change');
  let r = await su.post('/api/auth/login', { identifier: 'technicallead@lisaanlab.com', password: 'wrongpass' });
  check('Wrong password is rejected', r.status === 401, `got ${r.status}`);

  r = await su.post('/api/auth/login', { identifier: 'technicallead@lisaanlab.com', password: 'LisaanLab@2026' });
  check('Super admin signs in with the seeded credentials', r.status === 200 && r.data.user.role === 'SUPER_ADMIN', JSON.stringify(r.data).slice(0, 120));
  check('Staff ID is LSL/ADM/2026/00001', r.data.user && r.data.user.uid === 'LSL/ADM/2026/00001', r.data.user && r.data.user.uid);
  check('Password change is demanded on first sign-in', r.data.must_change_password === true);

  r = await su.get('/api/users');
  check('Protected endpoints are blocked until the password changes', r.status === 428, `got ${r.status}`);

  r = await su.post('/api/auth/change-password', { current_password: 'LisaanLab@2026', new_password: 'short' });
  check('Weak password is refused', r.status === 400);

  r = await su.post('/api/auth/change-password', { current_password: 'LisaanLab@2026', new_password: 'Supreme@2026x' });
  check('Super admin sets a new password', r.status === 200);

  r = await su.get('/api/auth/me');
  check('Session survives the password change', r.status === 200 && r.data.user.uid === 'LSL/ADM/2026/00001');

  r = await su.post('/api/auth/login', { identifier: 'LSL/ADM/2026/00001', password: 'Supreme@2026x' });
  check('Sign-in by staff ID works', r.status === 200);

  /* ---------------------------------------------------------------- */
  section('Academic structure (3 levels × 4 semesters)');
  r = await su.get('/api/academics/structure');
  const levels = r.data.levels;
  check('Exactly three levels exist', levels.length === 3, String(levels.length));
  check('Levels are Beginners, Intermediate, Advance',
    levels.map((l) => l.name).join(',') === 'Beginners,Intermediate,Advance', levels.map((l) => l.name).join(','));
  check('Every level has four semesters', levels.every((l) => l.semesters.length === 4));

  /* ---------------------------------------------------------------- */
  section('Account generation & ID series');
  const mkUser = async (fields, withPhoto) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
    if (withPhoto) fd.append('passport', new Blob([pngPixel], { type: 'image/png' }), 'passport.png');
    return su.form('/api/users', fd);
  };

  r = await mkUser({ role: 'TUTOR', full_name: 'Ustadh Musa Bello', email: 'musa.bello@lisaanlab.com', designation: 'Senior Tutor' }, true);
  const tutor = r.data.user, tutorPw = r.data.initial_password;
  check('Tutor account created', r.status === 201, JSON.stringify(r.data).slice(0, 140));
  check('Tutor ID follows LSL/TUT/<year>/00001', /^LSL\/TUT\/\d{4}\/00001$/.test(tutor.uid), tutor.uid);
  check('Passport photograph stored on creation', !!tutor.passport);

  r = await mkUser({ role: 'ADMIN', full_name: 'Hajiya Aisha Sani', email: 'aisha.sani@lisaanlab.com', designation: 'Exams Officer',
    permissions: JSON.stringify({ 'assessments.approve': true, 'assessments.view': true, 'results.publish': true, 'reports.view': true }) });
  const exams = r.data.user, examsPw = r.data.initial_password;
  check('Exams officer created', r.status === 201);
  check('Admin ID continues the ADM series at 00002', exams.uid === 'LSL/ADM/2026/00002', exams.uid);
  check('Granted toggles are applied at creation', exams.permissions['assessments.approve'] === true && exams.permissions['results.publish'] === true);
  check('Ungranted toggles stay off', exams.permissions['users.create'] === false && exams.permissions['system.reset'] === false);

  r = await mkUser({ role: 'DG_CEO', full_name: 'Dr Ibrahim Yusuf', email: 'dg@lisaanlab.com', designation: 'Director General / CEO' });
  const dg = r.data.user, dgPw = r.data.initial_password;
  check('DG/CEO created', r.status === 201);
  check('DG/CEO inherits every privilege by default', dg.permissions['system.reset'] === true && dg.permissions['vault.access'] === true && dg.permissions['results.publish'] === true);
  check('DG/CEO cannot be granted account creation', dg.permissions['users.create'] === false);

  r = await su.post(`/api/users/${dg.id}/permissions`, { key: 'users.create', enabled: true });
  check('Attempting to grant users.create to the DG/CEO is neutralised', r.data.user.permissions['users.create'] === false);

  const students = [];
  for (const [i, nm] of [['Fatima Abdullahi'], ['Zainab Umar'], ['Ahmad Garba']].entries()) {
    const res = await mkUser({ role: 'STUDENT', full_name: nm[0], email: `student${i + 1}@lisaanlab.com`,
      level_id: levels[0].id, semester_id: levels[0].semesters[0].id, admission_year: 2026 }, true);
    students.push({ ...res.data.user, password: res.data.initial_password });
  }
  check('Three students created', students.length === 3 && students.every((s) => s.uid));
  check('Student IDs run LSL/STU/2026/00001-00003',
    students.map((s) => s.uid).join(',') === 'LSL/STU/2026/00001,LSL/STU/2026/00002,LSL/STU/2026/00003',
    students.map((s) => s.uid).join(','));

  r = await mkUser({ role: 'STUDENT', full_name: 'Duplicate Person', email: 'student1@lisaanlab.com', level_id: levels[0].id });
  check('Duplicate email is rejected', r.status === 409);
  r = await mkUser({ role: 'SUPER_ADMIN', full_name: 'Second Super', email: 'super2@lisaanlab.com' });
  check('A second super administrator cannot be created', r.status === 400);

  /* ---------------------------------------------------------------- */
  section('Courses and enrolment');
  r = await su.post('/api/academics/courses', { code: 'ARB101', title: 'Foundations of Arabic Grammar',
    level_id: levels[0].id, semester_id: levels[0].semesters[0].id, credit_units: 3, tutor_id: tutor.id });
  const course = r.data.course;
  check('Course created and tutor assigned', r.status === 201 && course.tutor_id === tutor.id, JSON.stringify(r.data).slice(0, 140));

  r = await su.post('/api/academics/courses', { code: 'bad code!', title: 'Nope', level_id: levels[0].id, semester_id: levels[0].semesters[0].id });
  check('Malformed course code refused', r.status === 400);

  r = await su.post(`/api/academics/courses/${course.id}/enroll`, { student_ids: students.map((s) => s.id) });
  check('Three students enrolled', r.data.added === 3, JSON.stringify(r.data));

  /* ---------------------------------------------------------------- */
  section('Role boundaries');
  const tu = client();
  await tu.post('/api/auth/login', { identifier: tutor.email, password: tutorPw });
  await tu.post('/api/auth/change-password', { current_password: tutorPw, new_password: 'Tutor@2026x' });

  r = await tu.form('/api/users', (() => { const f = new FormData(); f.append('role', 'STUDENT'); f.append('full_name', 'Illegal Student'); f.append('email', 'illegal@lisaanlab.com'); f.append('level_id', String(levels[0].id)); return f; })());
  check('Tutor cannot create accounts', r.status === 403, `got ${r.status}`);
  r = await tu.get('/api/vault');
  check('Tutor cannot reach the storage vault', r.status === 403);
  r = await tu.get('/api/system/audit');
  check('Tutor cannot read the audit trail', r.status === 403);

  const st = client();
  await st.post('/api/auth/login', { identifier: students[0].uid, password: students[0].password });
  await st.post('/api/auth/change-password', { current_password: students[0].password, new_password: 'Student@2026x' });
  r = await st.get('/api/users');
  check('Student cannot list user accounts', r.status === 403);
  r = await st.get('/api/vault');
  check('Student cannot reach the storage vault', r.status === 403);

  const ex = client();
  await ex.post('/api/auth/login', { identifier: exams.email, password: examsPw });
  await ex.post('/api/auth/change-password', { current_password: examsPw, new_password: 'Exams@2026x' });
  r = await ex.form('/api/users', (() => { const f = new FormData(); f.append('role', 'STUDENT'); f.append('full_name', 'X'); f.append('email', 'x@lisaanlab.com'); return f; })());
  check('Exams officer without users.create cannot create accounts', r.status === 403);

  const dgc = client();
  await dgc.post('/api/auth/login', { identifier: dg.email, password: dgPw });
  await dgc.post('/api/auth/change-password', { current_password: dgPw, new_password: 'Director@2026x' });
  r = await dgc.get('/api/vault');
  check('DG/CEO can open the storage vault', r.status === 200);
  r = await dgc.form('/api/users', (() => { const f = new FormData(); f.append('role', 'STUDENT'); f.append('full_name', 'Y'); f.append('email', 'y@lisaanlab.com'); return f; })());
  check('DG/CEO is blocked from creating accounts', r.status === 403, `got ${r.status}`);
  r = await dgc.get('/api/system/dashboard');
  check('DG/CEO sees the supervision dashboard', r.status === 200 && r.data.kpis.students === 3);

  /* ---------------------------------------------------------------- */
  section('Live attendance register');
  r = await tu.post('/api/attendance/sessions', { course_id: course.id, topic: 'Noun cases — al-marfu', duration_min: 30, late_after_min: 1 });
  const sess = r.data.session;
  check('Tutor publishes a live register', r.status === 201 && sess.status === 'LIVE');

  r = await tu.post('/api/attendance/sessions', { course_id: course.id, topic: 'Duplicate', duration_min: 10 });
  check('A second concurrent register on the same course is refused', r.status === 409);

  r = await st.post(`/api/attendance/sessions/${sess.id}/mark`, {});
  check('Student marks themselves present', r.status === 200 && r.data.status === 'PRESENT', JSON.stringify(r.data));
  r = await st.post(`/api/attendance/sessions/${sess.id}/mark`, {});
  check('Double marking is refused', r.status === 409);

  const st2 = client();
  await st2.post('/api/auth/login', { identifier: students[1].uid, password: students[1].password });
  await st2.post('/api/auth/change-password', { current_password: students[1].password, new_password: 'Student2@2026x' });
  r = await st2.post(`/api/attendance/sessions/${sess.id}/mark`, {});
  check('Second student marked', r.status === 200);

  r = await tu.get(`/api/attendance/sessions/${sess.id}`);
  check('Register sheet shows 2 marked and 1 pending',
    r.data.roster.filter((x) => x.status !== 'PENDING').length === 2 && r.data.roster.filter((x) => x.status === 'PENDING').length === 1);

  r = await tu.post(`/api/attendance/sessions/${sess.id}/close`, {});
  check('Tutor closes the register', r.status === 200 && r.data.session.status === 'CLOSED');
  r = await tu.get(`/api/attendance/sessions/${sess.id}`);
  check('Non-markers are recorded ABSENT when the register closes',
    r.data.roster.filter((x) => x.status === 'ABSENT').length === 1);
  r = await st.post(`/api/attendance/sessions/${sess.id}/mark`, {});
  check('Marking after closure is refused', r.status === 409);

  r = await tu.post('/api/attendance/staff/clock-in', {});
  check('Tutor clocks in', r.status === 200);
  r = await tu.post('/api/attendance/staff/clock-in', {});
  check('Double clock-in refused', r.status === 409);
  r = await su.get('/api/attendance/staff');
  check('Super admin sees the staff duty register',
    r.status === 200 && r.data.records.some((x) => x.uid === tutor.uid && x.status === 'ON DUTY'));

  /* ---------------------------------------------------------------- */
  section('Assessment workflow & instant marking');
  r = await tu.post('/api/assessments', { course_id: course.id, type: 'TEST', title: 'Continuous Assessment 1', weight: 40, duration_min: 20, instructions: 'Answer all questions.' });
  const asm = r.data.assessment;
  check('Tutor creates an assessment', r.status === 201 && asm.status === 'DRAFT');

  r = await tu.post(`/api/assessments/${asm.id}/submit-for-approval`, {});
  check('Empty paper cannot be sent for vetting', r.status === 400);

  r = await tu.post(`/api/assessments/${asm.id}/questions`, { questions: [
    { qtype: 'MCQ', prompt: 'Which letter is a sun letter?', options: ['ب', 'ش', 'ق', 'ك'], answer: 'ش', marks: 2 },
    { qtype: 'TRUE_FALSE', prompt: 'Arabic is written right to left.', answer: 'True', marks: 1 },
    { qtype: 'SHORT_ANSWER', prompt: 'Translate: book', answer: 'kitab|kitaab|كتاب', marks: 2 },
  ] });
  check('Three questions added (5 marks)', r.data.assessment.question_count === 3 && r.data.assessment.total_marks === 5, JSON.stringify(r.data.errors));

  r = await tu.post(`/api/assessments/${asm.id}/questions`, { questions: [{ qtype: 'MCQ', prompt: 'Bad', options: ['a', 'b'], answer: 'zzz' }] });
  check('MCQ whose answer matches no option is rejected', r.data.errors && r.data.errors.length === 1);

  r = await st.get(`/api/assessments/${asm.id}/paper`);
  check('Students cannot open an unpublished paper', r.status === 409);

  r = await tu.post(`/api/assessments/${asm.id}/publish`, {});
  check('Publishing before vetting is blocked', r.status === 409);

  r = await tu.post(`/api/assessments/${asm.id}/submit-for-approval`, {});
  check('Paper sent for vetting', r.data.assessment.status === 'PENDING_APPROVAL');

  r = await tu.post(`/api/assessments/${asm.id}/approve`, {});
  check('A tutor cannot approve their own paper', r.status === 403);

  r = await ex.post(`/api/assessments/${asm.id}/approve`, { note: 'Vetted and cleared.' });
  check('Exams officer approves the paper', r.status === 200 && r.data.assessment.status === 'APPROVED');

  r = await tu.post(`/api/assessments/${asm.id}/questions`, { questions: [{ qtype: 'TRUE_FALSE', prompt: 'Sneaky', answer: 'True' }] });
  check('Questions are locked after approval', r.status === 409);

  r = await tu.post(`/api/assessments/${asm.id}/publish`, { window_min: 30 });
  check('Tutor publishes the approved paper', r.status === 200 && r.data.assessment.status === 'LIVE');

  r = await st.get(`/api/assessments/${asm.id}/paper`);
  const paper = r.data;
  check('Student opens the live paper', r.status === 200 && paper.questions.length === 3);
  check('Correct answers are never sent to the candidate', !JSON.stringify(paper.questions).includes('kitaab'));

  const qid = (i) => paper.questions[i].id;
  r = await st.post(`/api/assessments/${asm.id}/submit`, { answers: { [qid(0)]: 'ش', [qid(1)]: 'True', [qid(2)]: 'KITAB' } });
  check('All-correct submission scores 5/5 instantly', r.status === 200 && r.data.submission.score === 5 && r.data.submission.percent === 100, JSON.stringify(r.data.submission));
  check('Grade A returned with the score', r.data.grade.grade === 'A');
  check('Short answer matching is case-insensitive across variants', r.data.breakdown[2].correct === true);

  r = await st.post(`/api/assessments/${asm.id}/submit`, { answers: {} });
  check('Re-sitting the same paper is refused', r.status === 409);

  const p2 = await st2.get(`/api/assessments/${asm.id}/paper`);
  r = await st2.post(`/api/assessments/${asm.id}/submit`, { answers: { [p2.data.questions[0].id]: 'ب', [p2.data.questions[1].id]: 'True' } });
  check('Partial submission scores 1/5 (20%)', r.data.submission.score === 1 && r.data.submission.percent === 20, JSON.stringify(r.data.submission));

  r = await tu.get(`/api/assessments/${asm.id}/submissions`);
  check('Tutor sees both submissions ranked', r.data.submissions.length === 2 && r.data.submissions[0].percent === 100);
  check('Outstanding candidate listed', r.data.pending.length === 1);
  r = await ex.get(`/api/assessments/${asm.id}/submissions`);
  check('Exams officer monitors the same scores', r.status === 200 && r.data.submissions.length === 2);

  /* ---------------------------------------------------------------- */
  section('Statements of result');
  await tu.post(`/api/assessments/${asm.id}/close`, {});
  r = await ex.get(`/api/assessments/results/preview?level_id=${levels[0].id}&semester_id=${levels[0].semesters[0].id}`);
  check('Results preview computes from real submissions', r.status === 200 && r.data.students.length === 3);
  const top = r.data.students.find((x) => x.student.uid === students[0].uid);
  check('Top student scores 100% → grade A → 5.00 GPA', top.gpa === 5 && top.lines[0].grade === 'A', JSON.stringify(top.lines[0]));
  const absentee = r.data.students.find((x) => x.student.uid === students[2].uid);
  check('Student who never sat is scored 0 and graded F', absentee.lines[0].percent === 0 && absentee.lines[0].grade === 'F');
  check('Attendance rate is carried onto the statement', top.lines[0].attendance_rate === 100, String(top.lines[0].attendance_rate));

  r = await st.get('/api/assessments/results/student/' + students[0].id);
  check('Nothing is visible to the student before publication', r.data.statements.length === 0);

  r = await tu.post('/api/assessments/results/publish', { level_id: levels[0].id, semester_id: levels[0].semesters[0].id });
  check('A tutor cannot publish results', r.status === 403);

  r = await ex.post('/api/assessments/results/publish', { level_id: levels[0].id, semester_id: levels[0].semesters[0].id });
  check('Exams officer publishes the semester statements', r.status === 200 && r.data.published === 3);

  r = await st.get('/api/assessments/results/student/' + students[0].id);
  check('Student now sees their statement of result', r.data.statements.length === 1 && r.data.statements[0].gpa === 5);
  check('Statement carries the remark', r.data.statements[0].remark === 'Distinction', r.data.statements[0].remark);
  r = await st.get('/api/assessments/results/student/' + students[1].id);
  check('A student cannot read another student\'s result', r.status === 403);

  /* ---------------------------------------------------------------- */
  section('Storage vault (100 TB)');
  r = await su.get('/api/vault');
  check('Quota is exactly 100 TB', r.data.usage.quota === 100 * 1024 ** 4, String(r.data.usage.quota));
  const blob = Buffer.alloc(256 * 1024, 7);
  const vfd = new FormData();
  vfd.append('folder', 'Governance');
  vfd.append('files', new Blob([blob], { type: 'application/pdf' }), 'board-minutes.pdf');
  r = await su.form('/api/vault/upload', vfd);
  check('File uploads into the vault', r.status === 201 && r.data.saved[0].size === 262144, JSON.stringify(r.data).slice(0, 120));
  r = await su.get('/api/vault');
  check('Usage reflects real measured bytes', r.data.usage.used === 262144, String(r.data.usage.used));
  check('Free space = quota − used', r.data.usage.free === 100 * 1024 ** 4 - 262144);
  const fileId = r.data.files[0].id;
  r = await dgc.get('/api/vault');
  check('DG/CEO sees the same vault contents', r.data.files.length === 1);
  r = await su.del('/api/vault/' + fileId);
  check('Vault object deleted', r.status === 200);
  r = await su.get('/api/vault');
  check('Usage returns to zero after deletion', r.data.usage.used === 0);

  /* ---------------------------------------------------------------- */
  section('Password reset & suspension');
  r = await su.post(`/api/users/${students[0].id}/reset-password`, {});
  const newPw = r.data.new_password;
  check('Super admin resets a student password', r.status === 200 && !!newPw);
  r = await st.get('/api/auth/me');
  check('The reset revokes the student\'s live session', r.status === 401 || r.status === 428, `got ${r.status}`);
  const st3 = client();
  r = await st3.post('/api/auth/login', { identifier: students[0].uid, password: newPw });
  check('Student signs in with the issued password', r.status === 200 && r.data.must_change_password === true);

  r = await ex.post(`/api/users/${students[1].id}/reset-password`, {});
  check('Officer without users.reset_password is blocked', r.status === 403);

  r = await su.post(`/api/users/${students[1].id}/status`, { status: 'SUSPENDED' });
  check('Student suspended', r.data.user.status === 'SUSPENDED');
  r = await client().post('/api/auth/login', { identifier: students[1].uid, password: 'Student2@2026x' });
  check('Suspended account cannot sign in', r.status === 403);
  await su.post(`/api/users/${students[1].id}/status`, { status: 'ACTIVE' });

  r = await su.del(`/api/users/1`);
  check('The super administrator account cannot be deleted', r.status === 400);

  /* ---------------------------------------------------------------- */
  section('Privilege toggles take effect immediately');
  r = await ex.get('/api/vault');
  check('Exams officer starts with no vault access', r.status === 403);
  await su.post(`/api/users/${exams.id}/permissions`, { key: 'vault.access', enabled: true });
  r = await ex.get('/api/vault');
  check('Toggling vault.access on grants it instantly', r.status === 200);
  await su.post(`/api/users/${exams.id}/permissions`, { key: 'vault.access', enabled: false });
  r = await ex.get('/api/vault');
  check('Toggling it off revokes it instantly', r.status === 403);

  /* ---------------------------------------------------------------- */
  section('Audit trail, backup and reset');
  r = await su.get('/api/system/audit?limit=500');
  const actions = r.data.entries.map((e) => e.action);
  check('Audit trail recorded every critical action',
    ['LOGIN', 'USER_CREATED', 'COURSE_CREATED', 'ATTENDANCE_SESSION_OPENED', 'ATTENDANCE_MARKED',
     'ASSESSMENT_APPROVED', 'ASSESSMENT_PUBLISHED', 'ASSESSMENT_SUBMITTED', 'RESULTS_PUBLISHED',
     'VAULT_UPLOAD', 'PASSWORD_RESET', 'USER_SUSPENDED'].every((a) => actions.includes(a)),
    actions.slice(0, 10).join(','));
  check('Failed sign-ins are logged', actions.includes('LOGIN_FAILED'));

  r = await su.post('/api/system/backup', { reason: 'Automated test backup' });
  check('Backup archive created', r.status === 201 && r.data.backup.size > 0, JSON.stringify(r.data).slice(0, 120));
  const backupId = r.data.backup.id;
  r = await su.get(`/api/system/backups/${backupId}/download`);
  check('Backup is downloadable', r.status === 200);

  r = await su.post('/api/system/reset', { confirm: 'wrong phrase', scope: 'FULL' });
  check('Reset without the exact confirmation phrase is refused', r.status === 400);

  r = await su.post('/api/system/reset', { confirm: 'RESET LISAAN LAB LMS', scope: 'FULL' });
  check('Full reset runs and returns its safety backup', r.status === 200 && !!r.data.backup.filename, JSON.stringify(r.data).slice(0, 120));

  r = await su.get('/api/users');
  check('Only the super administrator survives the reset', r.data.users.length === 1 && r.data.users[0].role === 'SUPER_ADMIN', String(r.data.users.length));
  r = await su.get('/api/academics/structure');
  check('Levels and semesters are rebuilt after reset',
    r.data.levels.length === 3 && r.data.levels.every((l) => l.semesters.length === 4));
  r = await su.get('/api/academics/courses');
  check('Courses were cleared', r.data.courses.length === 0);
  r = await su.get('/api/system/backups');
  check('Backup history survives the reset for record purposes', r.data.backups.length >= 2);

  /* ---------------------------------------------------------------- */
  console.log(results.join('\n'));
  console.log(`\n${'─'.repeat(54)}\n  ${pass} passed · ${fail} failed\n${'─'.repeat(54)}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('\nTEST RUNNER CRASHED:', e); console.log(results.join('\n')); process.exit(1); });
