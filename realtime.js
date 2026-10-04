'use strict';
/** Verifies the WebSocket layer actually pushes events to the right people. */
const WebSocket = require('ws');
const BASE = 'http://127.0.0.1:3100';
const WSU = 'ws://127.0.0.1:3100/ws';

let pass = 0, fail = 0;
const log = (ok, name, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? '✓' : '✗'} ${name}${!ok && extra ? ' → ' + extra : ''}`); };

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
    form(p, f) { return this.req('POST', p, f, true); },
  };
}

function socket(cookie, label) {
  const ws = new WebSocket(WSU, { headers: { cookie } });
  const got = [];
  ws.on('message', (raw) => { try { got.push(JSON.parse(raw.toString())); } catch {} });
  return { ws, got, label, waitOpen: () => new Promise((r, j) => { ws.once('open', r); ws.once('error', j); }),
    seen: (ev) => got.filter((m) => m.event === ev),
    wait: (ev, ms = 4000) => new Promise((resolve) => {
      const hit = got.find((m) => m.event === ev);
      if (hit) return resolve(hit);
      const t = setTimeout(() => resolve(null), ms);
      ws.on('message', (raw) => { try { const m = JSON.parse(raw.toString()); if (m.event === ev) { clearTimeout(t); resolve(m); } } catch {} });
    }) };
}

(async () => {
  console.log('\n▌ Real-time transport');
  const su = client();
  await su.post('/api/auth/login', { identifier: 'technicallead@lisaanlab.com', password: 'LisaanLab@2026' });
  await su.post('/api/auth/change-password', { current_password: 'LisaanLab@2026', new_password: 'Supreme@2026x' });

  const mk = async (fields) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, String(v)); return su.form('/api/users', f); };
  const { levels } = (await su.get('/api/academics/structure')).data;
  const t = (await mk({ role: 'TUTOR', full_name: 'RT Tutor', email: 'rt.tutor@lisaanlab.com' })).data;
  const s = (await mk({ role: 'STUDENT', full_name: 'RT Student', email: 'rt.student@lisaanlab.com', level_id: levels[0].id, admission_year: 2026 })).data;
  const course = (await su.post('/api/academics/courses', { code: 'RTX100', title: 'Realtime Course', level_id: levels[0].id, semester_id: levels[0].semesters[0].id, tutor_id: t.user.id })).data.course;
  await su.post(`/api/academics/courses/${course.id}/enroll`, { student_ids: [s.user.id] });

  const tc = client();
  await tc.post('/api/auth/login', { identifier: t.user.email, password: t.initial_password });
  await tc.post('/api/auth/change-password', { current_password: t.initial_password, new_password: 'Tutor@2026x' });
  const sc = client();
  await sc.post('/api/auth/login', { identifier: s.user.uid, password: s.initial_password });
  await sc.post('/api/auth/change-password', { current_password: s.initial_password, new_password: 'Stud@2026x' });

  const adminWs = socket(su.cookie, 'admin');
  const tutorWs = socket(tc.cookie, 'tutor');
  const studWs = socket(sc.cookie, 'student');
  await Promise.all([adminWs.waitOpen(), tutorWs.waitOpen(), studWs.waitOpen()]);
  log(true, 'Three authenticated sockets connected');

  const hello = await studWs.wait('hello');
  log(!!hello && hello.data.role === 'STUDENT', 'Socket handshake identifies the signed-in user');

  await new Promise((r) => setTimeout(r, 400)); // let all three handshakes settle
  const frames = adminWs.seen('presence:update');
  const latest = frames[frames.length - 1];
  log(!!latest && latest.data.count >= 3, 'Presence broadcast reaches administrators',
    latest && `${frames.length} frames, latest count ${latest.data.count}`);
  log(studWs.seen('presence:update').length === 0, 'Students are not sent the presence roster');

  const sess = (await tc.post('/api/attendance/sessions', { course_id: course.id, topic: 'RT session', duration_min: 10 })).data.session;
  const openedStudent = await studWs.wait('attendance:session_opened');
  const openedAdmin = await adminWs.wait('attendance:session_opened');
  log(!!openedStudent, 'Enrolled student is pushed the live register the moment it opens');
  log(!!openedAdmin, 'Super admin is pushed the same event for supervision');

  const notif = await studWs.wait('notification:new');
  log(!!notif && /Attendance/.test(notif.data.title), 'Student receives the attendance notification', notif && notif.data.title);

  await sc.post(`/api/attendance/sessions/${sess.id}/mark`, {});
  const markedTutor = await tutorWs.wait('attendance:marked');
  const markedAdmin = await adminWs.wait('attendance:marked');
  log(!!markedTutor && markedTutor.data.status === 'PRESENT', 'Tutor sheet receives the mark in real time');
  log(!!markedAdmin && markedAdmin.data.student.full_name === 'RT Student', 'Super admin sees the mark in real time');

  const audit = await adminWs.wait('audit:new');
  log(!!audit, 'Audit entries stream to the supervision feed');

  await tc.post(`/api/attendance/sessions/${sess.id}/close`, {});
  const closed = await studWs.wait('attendance:session_closed');
  log(!!closed, 'Register closure is pushed to everyone concerned');

  await su.post(`/api/users/${s.user.id}/permissions`, { key: 'reports.view', enabled: true }).catch(() => {});
  await su.post(`/api/users/${s.user.id}/status`, { status: 'SUSPENDED' });
  const revoked = await studWs.wait('session:revoked');
  log(!!revoked, 'Suspended user is force-disconnected with a reason', revoked && revoked.data.reason);

  [adminWs, tutorWs, studWs].forEach((x) => { try { x.ws.close(); } catch {} });
  console.log(`\n  ${pass} passed · ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
