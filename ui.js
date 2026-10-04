'use strict';
/**
 * Headless UI smoke test — boots the real single-page app in jsdom for every role
 * and walks each navigation route, failing on any runtime error or empty view.
 */
const { JSDOM, CookieJar, VirtualConsole } = require('jsdom');
const BASE = process.env.BASE || 'http://127.0.0.1:3100';

let pass = 0, fail = 0;
const line = (ok, name, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? '✓' : '✗'} ${name}${!ok && extra ? ' → ' + String(extra).slice(0, 220) : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
      const res = await fetch(BASE + path, { method, headers, body: payload });
      for (const c of (res.headers.getSetCookie ? res.headers.getSetCookie() : [])) {
        const m = /lsl_sid=([^;]*)/.exec(c); if (m) cookie = 'lsl_sid=' + m[1];
      }
      const ct = res.headers.get('content-type') || '';
      return { status: res.status, data: ct.includes('json') ? await res.json().catch(() => ({})) : {} };
    },
    get(p) { return this.req('GET', p); },
    post(p, b) { return this.req('POST', p, b); },
    form(p, f, m) { return this.req(m || 'POST', p, f, true); },
  };
}

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/** Build a realistic institution so every screen has something to render. */
async function seed() {
  const su = client();
  await su.post('/api/auth/login', { identifier: 'technicallead@lisaanlab.com', password: 'LisaanLab@2026' });
  await su.post('/api/auth/change-password', { current_password: 'LisaanLab@2026', new_password: 'Supreme@2026x' });

  const mk = async (fields, photo) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.append(k, String(v));
    if (photo) f.append('passport', new Blob([png], { type: 'image/png' }), 'p.png');
    const r = await su.form('/api/users', f);
    if (r.status !== 201) throw new Error('seed user failed: ' + JSON.stringify(r.data));
    return r.data;
  };
  const activate = async (user, pw, next) => {
    const c = client();
    await c.post('/api/auth/login', { identifier: user.email, password: pw });
    await c.post('/api/auth/change-password', { current_password: pw, new_password: next });
    return c;
  };

  const { levels } = (await su.get('/api/academics/structure')).data;
  const dgR = await mk({ role: 'DG_CEO', full_name: 'Dr Ibrahim Yusuf', email: 'dg@lisaanlab.com', designation: 'Director General / CEO' }, true);
  const exR = await mk({ role: 'ADMIN', full_name: 'Hajiya Aisha Sani', email: 'exams@lisaanlab.com', designation: 'Exams Officer',
    permissions: JSON.stringify({ 'assessments.approve': true, 'assessments.view': true, 'results.publish': true, 'reports.view': true, 'attendance.view': true, 'audit.view': true }) }, true);
  const tuR = await mk({ role: 'TUTOR', full_name: 'Ustadh Musa Bello', email: 'tutor@lisaanlab.com', designation: 'Senior Tutor' }, true);
  const stR = await mk({ role: 'STUDENT', full_name: 'Fatima Abdullahi', email: 'fatima@lisaanlab.com',
    level_id: levels[0].id, semester_id: levels[0].semesters[0].id, admission_year: 2026 }, true);
  const st2R = await mk({ role: 'STUDENT', full_name: 'Zainab Umar', email: 'zainab@lisaanlab.com',
    level_id: levels[0].id, semester_id: levels[0].semesters[0].id, admission_year: 2026 }, true);

  const dg = await activate(dgR.user, dgR.initial_password, 'Director@2026x');
  const ex = await activate(exR.user, exR.initial_password, 'Exams@2026x');
  const tu = await activate(tuR.user, tuR.initial_password, 'Tutor@2026x');
  const st = await activate(stR.user, stR.initial_password, 'Student@2026x');
  const st2 = await activate(st2R.user, st2R.initial_password, 'Student2@2026x');

  const course = (await su.post('/api/academics/courses', { code: 'ARB101', title: 'Foundations of Arabic Grammar',
    level_id: levels[0].id, semester_id: levels[0].semesters[0].id, credit_units: 3, tutor_id: tuR.user.id })).data.course;
  await su.post('/api/academics/courses', { code: 'ARB102', title: 'Arabic Phonetics',
    level_id: levels[0].id, semester_id: levels[0].semesters[0].id, credit_units: 2, tutor_id: tuR.user.id });
  await su.post(`/api/academics/courses/${course.id}/enroll`, { student_ids: [stR.user.id, st2R.user.id] });

  // closed register + a live one so both states render
  const s1 = (await tu.post('/api/attendance/sessions', { course_id: course.id, topic: 'Noun cases', duration_min: 20 })).data.session;
  await st.post(`/api/attendance/sessions/${s1.id}/mark`, {});
  await tu.post(`/api/attendance/sessions/${s1.id}/close`, {});
  await tu.post('/api/attendance/staff/clock-in', {});
  const live = (await tu.post('/api/attendance/sessions', { course_id: course.id, topic: 'Live lesson — verb forms', duration_min: 90 })).data.session;

  // full assessment lifecycle
  const asm = (await tu.post('/api/assessments', { course_id: course.id, type: 'TEST', title: 'Continuous Assessment 1', weight: 40, duration_min: 20, instructions: 'Answer all questions.' })).data.assessment;
  await tu.post(`/api/assessments/${asm.id}/questions`, { questions: [
    { qtype: 'MCQ', prompt: 'Which letter is a sun letter?', options: ['ب', 'ش', 'ق', 'ك'], answer: 'ش', marks: 2 },
    { qtype: 'TRUE_FALSE', prompt: 'Arabic is written right to left.', answer: 'True', marks: 1 },
    { qtype: 'SHORT_ANSWER', prompt: 'Translate: book', answer: 'kitab|كتاب', marks: 2 },
  ] });
  await tu.post(`/api/assessments/${asm.id}/submit-for-approval`, {});
  await ex.post(`/api/assessments/${asm.id}/approve`, { note: 'Cleared.' });
  await tu.post(`/api/assessments/${asm.id}/publish`, { window_min: 120 });
  const paper = (await st.get(`/api/assessments/${asm.id}/paper`)).data;
  await st.post(`/api/assessments/${asm.id}/submit`, { answers: {
    [paper.questions[0].id]: 'ش', [paper.questions[1].id]: 'True', [paper.questions[2].id]: 'kitab' } });

  // a second paper left awaiting vetting, so the exams queue is not empty
  const asm2 = (await tu.post('/api/assessments', { course_id: course.id, type: 'EXAM', title: 'Semester Examination', weight: 60, duration_min: 90 })).data.assessment;
  await tu.post(`/api/assessments/${asm2.id}/questions`, { questions: [{ qtype: 'TRUE_FALSE', prompt: 'Nouns inflect for case.', answer: 'True', marks: 5 }] });
  await tu.post(`/api/assessments/${asm2.id}/submit-for-approval`, {});

  await ex.post('/api/assessments/results/publish', { level_id: levels[0].id, semester_id: levels[0].semesters[0].id });

  const vfd = new FormData();
  vfd.append('folder', 'Governance');
  vfd.append('files', new Blob([Buffer.alloc(64 * 1024, 3)], { type: 'application/pdf' }), 'board-minutes.pdf');
  await su.form('/api/vault/upload', vfd);
  await su.post('/api/system/backup', { reason: 'Pre-demo snapshot' });

  return { su, dg, ex, tu, st, st2, liveSessionId: live.id, assessmentId: asm2.id };
}

/** Boot the SPA in jsdom under one identity and walk every route. */
async function drive(label, cookie, expectedRoutes, expectCreate) {
  const jar = new CookieJar();
  jar.setCookieSync(`${cookie}; Path=/`, BASE);
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push('jsdomError: ' + e.message));
  vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

  const dom = await JSDOM.fromURL(BASE + '/app', {
    cookieJar: jar, runScripts: 'dangerously', resources: 'usable',
    pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) {
      window.fetch = (input, init = {}) => {
        const url = String(input).startsWith('http') ? String(input) : BASE + String(input);
        return fetch(url, { ...init, headers: { ...(init.headers || {}), cookie } });
      };
      window.alert = () => {};
      window.print = () => {};
      window.addEventListener('error', (e) => errors.push('window.error: ' + (e.error ? e.error.stack : e.message)));
      window.addEventListener('unhandledrejection', (e) => errors.push('unhandled: ' + (e.reason && e.reason.message)));
    },
  });
  const { window } = dom;
  const doc = window.document;

  await sleep(1400); // boot + first view
  const nav = [...doc.querySelectorAll('.sb-link')].map((a) => a.dataset.route);
  line(nav.length > 0, `${label}: navigation rendered (${nav.join(', ')})`, nav.join(','));
  line(expectedRoutes.every((r) => nav.includes(r)), `${label}: expected sections present`, `missing ${expectedRoutes.filter((r) => !nav.includes(r)).join(',')}`);
  if (nav.includes('users')) {
    window.location.hash = '#/users';
    await sleep(900);
    const hasCreateBtn = !!doc.getElementById('newUser');
    line(hasCreateBtn === expectCreate, `${label}: "Create account" button ${expectCreate ? 'available' : 'withheld'}`,
      `button ${hasCreateBtn ? 'present' : 'absent'}`);
  } else {
    line(!expectCreate, `${label}: no access to the user directory`);
  }
  line((doc.getElementById('sbId').textContent || '').startsWith('LSL/'), `${label}: identity shows the issued ID`, doc.getElementById('sbId').textContent);

  for (const route of nav) {
    window.location.hash = '#/' + route;
    await sleep(850);
    const view = doc.getElementById('view');
    const html = view.innerHTML;
    const stillLoading = html.includes('class="loader"');
    const hasError = !!view.querySelector('.view-error');
    line(!stillLoading && !hasError && html.length > 200, `${label} › ${route} rendered`,
      stillLoading ? 'stuck on loader' : hasError ? view.querySelector('.view-error').textContent : `only ${html.length} chars`);
  }

  // real-time link established?
  const conn = doc.getElementById('connBadge').textContent;
  line(/Live/.test(conn), `${label}: websocket reports Live`, conn);

  line(errors.length === 0, `${label}: no runtime errors`, errors.slice(0, 3).join(' | '));
  window.close();
  return errors;
}

(async () => {
  console.log('\n▌ Headless UI walkthrough');
  const s = await seed();
  console.log('  · institution seeded\n');

  await drive('Super Admin', s.su.cookie, ['dashboard', 'users', 'academics', 'attendance', 'exams', 'results', 'vault', 'audit', 'system', 'profile'], true);
  console.log('');
  await drive('DG / CEO', s.dg.cookie, ['dashboard', 'academics', 'attendance', 'exams', 'results', 'vault', 'audit', 'system', 'profile'], false);
  console.log('');
  await drive('Exams Officer', s.ex.cookie, ['dashboard', 'attendance', 'exams', 'results', 'audit', 'profile'], false);
  console.log('');
  await drive('Tutor', s.tu.cookie, ['dashboard', 'courses', 'attendance', 'assessments', 'profile'], false);
  console.log('');
  await drive('Student', s.st.cookie, ['dashboard', 'courses', 'attendance', 'assessments', 'results', 'profile'], false);

  console.log(`\n  ${pass} passed · ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
