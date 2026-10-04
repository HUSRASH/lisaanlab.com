'use strict';
/* Lisaan Lab LMS — Tutor portal */
const V3 = (window.V = window.V || {});

V3.tutorDashboard = {
  title: 'Tutor dashboard',
  sub: 'Your courses, registers and assessments',
  async mount(el) {
    const paint = (d) => {
      const k = d.kpis;
      const c = d.clock;
      el.innerHTML = `
        <div class="idcard">
          ${avatar(S.me, 'xl')}
          <div class="info">
            <h2>${esc(S.me.full_name)}</h2>
            <div class="flex flex-wrap" style="gap:8px">
              <span class="id-chip">${esc(S.me.uid)}</span>
              <span class="badge accent">${esc(S.me.designation || 'Tutor')}</span>
            </div>
            <div class="meta">
              <span>Email <b>${esc(S.me.email)}</b></span>
              <span>Courses <b>${k.courses}</b></span>
              <span>Students <b>${k.students}</b></span>
              <span>Today <b>${c && c.clock_in ? fmtTime(c.clock_in) + (c.clock_out ? ' → ' + fmtTime(c.clock_out) : ' · on duty') : 'not clocked in'}</b></span>
            </div>
          </div>
          <div class="spacer"></div>
          <div class="btn-row" style="position:relative;z-index:1">
            ${!c || !c.clock_in ? '<button class="btn btn-accent" id="clockIn">⏱ Clock in</button>' :
              (!c.clock_out ? '<button class="btn btn-accent" id="clockOut">⏹ Clock out</button>' : '<span class="badge ok">Duty completed</span>')}
          </div>
        </div>

        <div class="grid grid-4" style="margin-bottom:18px">
          ${kpi('My courses', k.courses, 'Assigned by the administration')}
          ${kpi('My students', k.students, 'Across all courses', 'accent')}
          ${kpi('Live registers', k.live_sessions, 'Attendance running', k.live_sessions ? 'danger' : '')}
          ${kpi('Submissions today', k.submissions_today, `${k.live_assessments} paper(s) live`, 'ok')}
        </div>

        <div class="grid grid-sb">
          <div>
            ${card('Live registers', table(
              [{ label: 'Course' }, { label: 'Topic' }, { label: 'Marked', cls: 'num' }, { label: 'Closes in', cls: 'num' }, { label: '' }],
              d.live_sessions.map((s) => `<tr>
                <td><span class="id-chip">${esc(s.course_code)}</span></td>
                <td class="t-main">${esc(s.topic)}</td>
                <td class="num"><b>${s.present_count}</b> / ${s.roster_size}</td>
                <td class="num"><span class="countdown" data-until="${s.closes_at}">—</span></td>
                <td class="right"><button class="btn btn-sm" data-watch="${s.id}">Open sheet</button></td></tr>`).join(''),
              { emptyText: 'No register running — open one from Attendance', emptyIcon: '🗒' }),
              '<button class="btn btn-sm" id="openReg">▶ Publish attendance</button>')}

            ${card('My courses', table(
              [{ label: 'Code' }, { label: 'Title' }, { label: 'Level' }, { label: 'Semester' }, { label: 'Students', cls: 'num' }],
              d.courses.map((c2) => `<tr>
                <td><span class="id-chip">${esc(c2.code)}</span></td>
                <td class="t-main">${esc(c2.title)}</td>
                <td class="t-sub">${esc(c2.level_name)}</td>
                <td class="t-sub">${esc(c2.semester_name)}</td>
                <td class="num">${c2.student_count}</td></tr>`).join(''),
              { emptyText: 'No course has been assigned to you yet', emptyIcon: '📚' }))}
          </div>
          <div>
            ${card('My assessments', d.assessments.length ? d.assessments.map((a) => `
              <div class="stat-line"><span class="l"><b>${esc(a.course_code)}</b> ${esc(a.title)}<br>
                <small>${esc(a.type)} · ${a.submission_count} submitted</small></span>
                <span class="r">${statusBadge(a.status)}</span></div>`).join('')
              : '<div class="empty"><span class="big">📝</span>No assessment created yet</div>')}
            ${card('Latest scores', d.recent_submissions.length ? d.recent_submissions.map((s) => `
              <div class="stat-line"><span class="l">${esc(s.full_name)}<br><small>${esc(s.course_code)} · ${esc(s.title)}</small></span>
                <span class="r">${pct(s.percent)}</span></div>`).join('')
              : '<div class="empty"><span class="big">✓</span>No submissions yet</div>', '', 'Marked automatically on submission')}
          </div>
        </div>`;

      const ci = el.querySelector('#clockIn'), co = el.querySelector('#clockOut');
      if (ci) ci.addEventListener('click', async () => { await API.post('/api/attendance/staff/clock-in', {}); toast('Clocked in', 'ok'); load(); });
      if (co) co.addEventListener('click', async () => { const r = await API.post('/api/attendance/staff/clock-out', {}); toast(`Clocked out — ${(r.minutes / 60).toFixed(1)}h on duty`, 'ok'); load(); });
      el.querySelectorAll('[data-watch]').forEach((b) => b.addEventListener('click', () => V.sessionSheet(Number(b.dataset.watch), true)));
      el.querySelector('#openReg').addEventListener('click', () => V3.openRegisterModal(load));
    };
    const load = async () => paint(await API.get('/api/system/dashboard'));
    el.innerHTML = '<div class="loader"><span class="spin"></span> Loading your portal…</div>';
    await load();
    ['attendance:marked', 'attendance:session_opened', 'attendance:session_closed', 'submission:received', 'assessment:changed', 'course:assigned', 'roster:changed']
      .forEach((ev) => onView(ev, debounce(load, 700)));
  },
};

V3.openRegisterModal = async function (onDone) {
  const { courses } = await API.get('/api/academics/courses');
  if (!courses.length) return toast('No course is assigned to you yet', 'warn');
  modal({
    title: 'Publish an attendance register',
    body: `
      <div class="alert alert-info">Students enrolled in the course see the register the moment you publish it, and can mark
        themselves until it closes. Whoever has not marked when it ends is recorded absent.</div>
      <div class="field"><label class="label" for="agCourse">Course</label>
        <select class="select" id="agCourse">${courses.map((c) => `<option value="${c.id}">${esc(c.code)} — ${esc(c.title)} (${c.student_count} students)</option>`).join('')}</select></div>
      <div class="field"><label class="label" for="agTopic">Topic of the session</label>
        <input class="input" id="agTopic" placeholder="e.g. Verb conjugation — past tense"></div>
      <div class="field-row">
        <div class="field"><label class="label" for="agDur">Register open for (minutes)</label>
          <input class="input" id="agDur" type="number" value="45" min="5" max="480"></div>
        <div class="field"><label class="label" for="agLate">Mark late after (minutes)</label>
          <input class="input" id="agLate" type="number" value="10" min="1" max="120"></div>
      </div>`,
    actions: [
      { label: 'Cancel' },
      {
        label: '▶ Publish register', kind: 'btn', close: false,
        onClick: async ({ root, close }) => {
          const r = await API.post('/api/attendance/sessions', {
            course_id: Number(root.querySelector('#agCourse').value),
            topic: root.querySelector('#agTopic').value.trim(),
            duration_min: Number(root.querySelector('#agDur').value),
            late_after_min: Number(root.querySelector('#agLate').value),
          });
          toast('Register is live — students have been notified', 'ok');
          close();
          if (onDone) onDone();
          V.sessionSheet(r.session.id, true);
        },
      },
    ],
  });
};

V3.tutorAttendance = {
  title: 'Attendance',
  sub: 'Publish class registers and keep your own duty record',
  async mount(el) {
    const load = async () => {
      const [{ sessions }, mine] = await Promise.all([
        API.get('/api/attendance/sessions'),
        API.get('/api/attendance/staff?mine=1'),
      ]);
      const live = sessions.filter((s) => s.status === 'LIVE');
      const c = mine.today;
      el.innerHTML = `
        <div class="grid grid-4" style="margin-bottom:18px">
          ${kpi('Live now', live.length, 'Registers open', live.length ? 'danger' : '')}
          ${kpi('Sessions held', sessions.length, 'All time')}
          ${kpi('My duty days', mine.days, `${mine.hours} hours logged`, 'accent')}
          ${kpi('Today', c && c.clock_in ? (c.clock_out ? 'Completed' : 'On duty') : 'Not clocked in', c && c.clock_in ? fmtTime(c.clock_in) : '—', c && c.clock_in ? 'ok' : 'warn')}
        </div>
        ${card('Class registers', table(
          [{ label: 'Course' }, { label: 'Topic' }, { label: 'Opened' }, { label: 'Present', cls: 'num' }, { label: 'Status' }, { label: '' }],
          sessions.slice(0, 50).map((s) => `<tr>
            <td><span class="id-chip">${esc(s.course_code)}</span></td>
            <td class="t-main">${esc(s.topic)}</td>
            <td class="t-sub">${fmtDT(s.opened_at)}</td>
            <td class="num">${s.present_count} / ${s.roster_size}</td>
            <td>${s.status === 'LIVE' ? `<span class="badge live">live</span> <span class="countdown" data-until="${s.closes_at}"></span>` : statusBadge(s.status)}</td>
            <td class="right"><button class="btn btn-sm btn-ghost" data-watch="${s.id}">${s.status === 'LIVE' ? 'Open sheet' : 'View sheet'}</button></td></tr>`).join(''),
          { emptyText: 'You have not published a register yet', emptyIcon: '🗒' }),
          '<button class="btn" id="openReg">▶ Publish register</button>')}
        ${card('My duty record', `
          <div class="btn-row" style="margin-bottom:14px">
            ${!c || !c.clock_in ? '<button class="btn btn-accent" id="clockIn">⏱ Clock in</button>' :
              (!c.clock_out ? '<button class="btn btn-accent" id="clockOut">⏹ Clock out</button>' : '<span class="badge ok">Duty completed for today</span>')}
          </div>
          ${table([{ label: 'Date' }, { label: 'Clock in' }, { label: 'Clock out' }, { label: 'Hours', cls: 'num' }, { label: 'Status' }],
            mine.records.map((r) => `<tr><td>${fmtDate(r.work_date)}</td><td>${r.clock_in ? fmtTime(r.clock_in) : '—'}</td>
              <td>${r.clock_out ? fmtTime(r.clock_out) : '—'}</td><td class="num">${r.minutes ? (r.minutes / 60).toFixed(1) : '—'}</td>
              <td>${statusBadge(r.clock_out ? 'COMPLETED' : 'ON DUTY')}</td></tr>`).join(''),
            { emptyText: 'No duty record yet', emptyIcon: '⏱' })}`, '', 'Monitored by the Super Administrator and the DG/CEO')}`;

      el.querySelector('#openReg').addEventListener('click', () => V3.openRegisterModal(load));
      el.querySelectorAll('[data-watch]').forEach((b) => b.addEventListener('click', () => V.sessionSheet(Number(b.dataset.watch), true)));
      const ci = el.querySelector('#clockIn'), co = el.querySelector('#clockOut');
      if (ci) ci.addEventListener('click', async () => { await API.post('/api/attendance/staff/clock-in', {}); toast('Clocked in', 'ok'); load(); });
      if (co) co.addEventListener('click', async () => { await API.post('/api/attendance/staff/clock-out', {}); toast('Clocked out', 'ok'); load(); });
    };
    await load();
    ['attendance:marked', 'attendance:session_closed', 'attendance:session_opened'].forEach((ev) => onView(ev, debounce(load, 800)));
  },
};

V3.tutorCourses = {
  title: 'My courses',
  sub: 'Rosters for the courses assigned to you',
  async mount(el) {
    const { courses } = await API.get('/api/academics/courses');
    el.innerHTML = courses.length ? courses.map((c) => card(
      `${c.code} — ${c.title}`,
      `<div class="flex flex-wrap" style="gap:9px;margin-bottom:12px">
        <span class="badge brand">${esc(c.level_name)}</span><span class="badge accent">${esc(c.semester_name)}</span>
        <span class="badge">${c.credit_units} units</span><span class="badge ok">${c.student_count} students</span></div>
      <button class="btn btn-sm btn-ghost" data-roster="${c.id}">View roster</button>`) ).join('')
      : '<div class="card"><div class="empty"><span class="big">📚</span>No course has been assigned to you yet</div></div>';
    el.querySelectorAll('[data-roster]').forEach((b) => b.addEventListener('click', async () => {
      const { course, students } = await API.get(`/api/academics/courses/${b.dataset.roster}/students`);
      modal({
        title: `${course.code} — roster`,
        size: 'wide',
        body: table([{ label: '' }, { label: 'Student' }, { label: 'ID' }, { label: 'Level' }, { label: 'Status' }],
          students.map((s) => `<tr><td>${avatar(s, 'sm')}</td>
            <td class="t-main">${esc(s.full_name)}</td><td><span class="id-chip">${esc(s.uid)}</span></td>
            <td class="t-sub">${esc(s.level_name || '—')}</td>
            <td>${s.online ? '<span class="badge ok"><span class="dot-online"></span> online</span>' : statusBadge(s.status)}</td></tr>`).join(''),
          { emptyText: 'No student enrolled yet' }),
        actions: [{ label: 'Close' }],
      });
    }));
  },
};

V3.tutorAssessments = {
  title: 'Assessments',
  sub: 'Author tests and examinations — vetted by the exams officer, marked automatically',
  async mount(el) {
    const load = async () => {
      const { assessments } = await API.get('/api/assessments');
      el.innerHTML = `
        <div class="toolbar"><div class="spacer"></div><button class="btn" id="newA">＋ New assessment</button></div>
        ${card('My papers', table(
          [{ label: 'Course' }, { label: 'Paper' }, { label: 'Questions', cls: 'num' }, { label: 'Marks', cls: 'num' },
           { label: 'Weight', cls: 'num' }, { label: 'Submitted', cls: 'num' }, { label: 'Status' }, { label: '' }],
          assessments.map((a) => `<tr>
            <td><span class="id-chip">${esc(a.course_code)}</span></td>
            <td><div class="t-main">${esc(a.title)}</div><div class="t-sub">${esc(a.type)} · ${a.duration_min} min</div></td>
            <td class="num">${a.question_count}</td><td class="num">${a.total_marks}</td><td class="num">${a.weight}%</td>
            <td class="num">${a.submission_count}/${a.roster_size}</td>
            <td>${statusBadge(a.status)}${a.status === 'LIVE' ? `<div class="t-sub">closes <span class="countdown" data-until="${a.closes_at}"></span></div>` : ''}
              ${a.review_note && a.status === 'REJECTED' ? `<div class="t-sub text-danger">${esc(a.review_note)}</div>` : ''}</td>
            <td class="right nowrap">
              ${['DRAFT', 'REJECTED'].includes(a.status) ? `<button class="btn btn-sm btn-ghost" data-edit="${a.id}">Questions</button>
                <button class="btn btn-sm" data-submit="${a.id}" ${a.question_count ? '' : 'disabled'}>Send for vetting</button>` : ''}
              ${a.status === 'APPROVED' ? `<button class="btn btn-sm btn-ok" data-publish="${a.id}">Publish</button>` : ''}
              ${a.status === 'LIVE' ? `<button class="btn btn-sm btn-danger" data-close="${a.id}">Close</button>` : ''}
              ${['LIVE', 'CLOSED'].includes(a.status) ? `<button class="btn btn-sm btn-ghost" data-scores="${a.id}">Scores</button>` : ''}
            </td></tr>`).join(''),
          { emptyText: 'No assessment created yet', emptyIcon: '📝' }), '',
          'Flow: draft → vetting by the exams officer → publish → students sit → instant scores')}`;

      el.querySelector('#newA').addEventListener('click', () => V3.newAssessmentModal(load));
      el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => V3.questionsModal(Number(b.dataset.edit), load)));
      el.querySelectorAll('[data-scores]').forEach((b) => b.addEventListener('click', () => V.submissionsModal(Number(b.dataset.scores))));
      el.querySelectorAll('[data-submit]').forEach((b) => b.addEventListener('click', async () => {
        await API.post(`/api/assessments/${b.dataset.submit}/submit-for-approval`, {});
        toast('Sent to the exams officer for vetting', 'ok'); load();
      }));
      el.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', async () => {
        await API.post(`/api/assessments/${b.dataset.close}/close`, {}); toast('Paper closed', 'ok'); load();
      }));
      el.querySelectorAll('[data-publish]').forEach((b) => b.addEventListener('click', () => {
        modal({
          title: 'Publish for sitting',
          body: `<div class="alert alert-info">Enrolled students can sit the paper immediately, for the window you set below.</div>
            <div class="field"><label class="label" for="pWin">Submission window (minutes)</label>
              <input class="input" id="pWin" type="number" value="60" min="5" max="1440"></div>`,
          actions: [{ label: 'Cancel' }, {
            label: 'Publish now', kind: 'btn-ok', close: false,
            onClick: async ({ root, close }) => {
              await API.post(`/api/assessments/${b.dataset.publish}/publish`, { window_min: Number(root.querySelector('#pWin').value) });
              toast('Paper is live — students notified', 'ok'); close(); load();
            },
          }],
        });
      }));
    };
    await load();
    ['assessment:changed', 'submission:received'].forEach((ev) => onView(ev, debounce(load, 700)));
  },
};

V3.newAssessmentModal = async function (onDone) {
  const { courses } = await API.get('/api/academics/courses');
  if (!courses.length) return toast('No course is assigned to you yet', 'warn');
  modal({
    title: 'New assessment',
    body: `
      <div class="field"><label class="label" for="naCourse">Course</label>
        <select class="select" id="naCourse">${courses.map((c) => `<option value="${c.id}">${esc(c.code)} — ${esc(c.title)}</option>`).join('')}</select></div>
      <div class="field-row">
        <div class="field"><label class="label" for="naType">Type</label>
          <select class="select" id="naType"><option value="TEST">Test</option><option value="EXAM">Examination</option></select></div>
        <div class="field"><label class="label" for="naWeight">Weight toward the course (%)</label>
          <input class="input" id="naWeight" type="number" value="20" min="1" max="100"></div>
      </div>
      <div class="field"><label class="label" for="naTitle">Title</label>
        <input class="input" id="naTitle" placeholder="e.g. Continuous Assessment 1"></div>
      <div class="field"><label class="label" for="naDur">Duration (minutes)</label>
        <input class="input" id="naDur" type="number" value="30" min="5" max="300"></div>
      <div class="field"><label class="label" for="naInstr">Instructions to candidates</label>
        <textarea class="input" id="naInstr" placeholder="Answer all questions."></textarea></div>`,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Create & add questions', kind: 'btn', close: false,
        onClick: async ({ root, close }) => {
          const r = await API.post('/api/assessments', {
            course_id: Number(root.querySelector('#naCourse').value),
            type: root.querySelector('#naType').value,
            title: root.querySelector('#naTitle').value.trim(),
            weight: Number(root.querySelector('#naWeight').value),
            duration_min: Number(root.querySelector('#naDur').value),
            instructions: root.querySelector('#naInstr').value.trim(),
          });
          close();
          V3.questionsModal(r.assessment.id, onDone);
        },
      },
    ],
    onMount: ({ root }) => {
      root.querySelector('#naType').addEventListener('change', (e) => {
        root.querySelector('#naWeight').value = e.target.value === 'EXAM' ? 60 : 20;
        root.querySelector('#naDur').value = e.target.value === 'EXAM' ? 90 : 30;
      });
    },
  });
};

V3.questionsModal = async function (id, onDone) {
  const refresh = async () => (await API.get('/api/assessments/' + id));
  let { assessment: a, questions } = await refresh();

  const listHTML = (qs) => qs.length ? qs.map((q) => `
    <div class="question" style="box-shadow:none;border:1px solid var(--line);padding:13px">
      <div class="flex"><div class="qn" style="flex:1">Q${q.ordinal} · ${q.marks} mark${q.marks === 1 ? '' : 's'} · ${esc(q.qtype.replace('_', ' '))}</div>
        <button class="btn-icon" data-delq="${q.id}" title="Remove">🗑</button></div>
      <div class="qp" style="font-size:.93rem;margin-bottom:7px">${esc(q.prompt)}</div>
      <div class="t-sub">Answer: <b>${esc(q.answer)}</b>${q.options ? ' · Options: ' + q.options.map(esc).join(' | ') : ''}</div>
    </div>`).join('') : '<div class="empty"><span class="big">✎</span>No question yet — add the first one below</div>';

  const { root } = modal({
    title: `${a.course_code} — ${a.title}`,
    size: 'wide',
    body: `
      <div class="flex flex-wrap" style="gap:9px;margin-bottom:13px">${statusBadge(a.status)}
        <span class="badge brand">${esc(a.type)}</span><span class="badge accent">${a.weight}%</span>
        <span class="badge" id="qSummary">${a.question_count} questions · ${a.total_marks} marks</span></div>
      <div id="qList">${listHTML(questions)}</div>
      <fieldset style="margin-top:15px"><legend>Add a question</legend>
        <div class="field-row">
          <div class="field"><label class="label" for="qType">Type</label>
            <select class="select" id="qType">
              <option value="MCQ">Multiple choice</option>
              <option value="TRUE_FALSE">True / False</option>
              <option value="SHORT_ANSWER">Short answer</option></select></div>
          <div class="field"><label class="label" for="qMarks">Marks</label>
            <input class="input" id="qMarks" type="number" value="1" min="1" max="100"></div>
        </div>
        <div class="field"><label class="label" for="qPrompt">Question</label>
          <textarea class="input" id="qPrompt" placeholder="Type the question exactly as candidates should see it"></textarea></div>
        <div id="mcqBox">
          <div class="field-row"><div class="field"><label class="label" for="qo1">Option A</label><input class="input" id="qo1"></div>
            <div class="field"><label class="label" for="qo2">Option B</label><input class="input" id="qo2"></div></div>
          <div class="field-row"><div class="field"><label class="label" for="qo3">Option C</label><input class="input" id="qo3"></div>
            <div class="field"><label class="label" for="qo4">Option D</label><input class="input" id="qo4"></div></div>
        </div>
        <div class="field"><label class="label" for="qAnswer">Correct answer</label>
          <input class="input" id="qAnswer" placeholder="Must match one option exactly">
          <div class="hint" id="qHint">For short answers, separate accepted variants with a vertical bar: <b>kitab|book</b></div></div>
        <button class="btn btn-accent" id="qAdd">＋ Add question</button>
      </fieldset>`,
    actions: [
      { label: 'Done', kind: 'btn-ghost', onClick: () => { if (onDone) onDone(); } },
      {
        label: 'Send for vetting', kind: 'btn', close: false,
        onClick: async ({ close }) => {
          await API.post(`/api/assessments/${id}/submit-for-approval`, {});
          toast('Sent to the exams officer', 'ok'); close(); if (onDone) onDone();
        },
      },
    ],
  });

  const sync = () => {
    const t = root.querySelector('#qType').value;
    root.querySelector('#mcqBox').style.display = t === 'MCQ' ? '' : 'none';
    root.querySelector('#qAnswer').placeholder = t === 'MCQ' ? 'Must match one option exactly' : t === 'TRUE_FALSE' ? 'True or False' : 'Accepted answer(s)';
    root.querySelector('#qHint').style.display = t === 'SHORT_ANSWER' ? '' : 'none';
  };
  root.querySelector('#qType').addEventListener('change', sync); sync();

  const bindDel = () => root.querySelectorAll('[data-delq]').forEach((b) => b.addEventListener('click', async () => {
    const r = await API.del(`/api/assessments/${id}/questions/${b.dataset.delq}`);
    const fresh = await refresh();
    questions = fresh.questions;
    root.querySelector('#qList').innerHTML = listHTML(questions);
    root.querySelector('#qSummary').textContent = `${r.assessment.question_count} questions · ${r.assessment.total_marks} marks`;
    bindDel();
  }));
  bindDel();

  root.querySelector('#qAdd').addEventListener('click', async () => {
    const type = root.querySelector('#qType').value;
    const body = {
      qtype: type,
      prompt: root.querySelector('#qPrompt').value.trim(),
      marks: Number(root.querySelector('#qMarks').value),
      answer: root.querySelector('#qAnswer').value.trim(),
      options: type === 'MCQ' ? ['qo1', 'qo2', 'qo3', 'qo4'].map((x) => root.querySelector('#' + x).value.trim()).filter(Boolean) : undefined,
    };
    if (!body.prompt) return toast('Type the question', 'warn');
    if (!body.answer) return toast('Give the correct answer', 'warn');
    try {
      const r = await API.post(`/api/assessments/${id}/questions`, { questions: [body] });
      if (r.errors && r.errors.length) { toast(r.errors[0], 'danger'); return; }
      questions = r.questions;
      root.querySelector('#qList').innerHTML = listHTML(questions);
      root.querySelector('#qSummary').textContent = `${r.assessment.question_count} questions · ${r.assessment.total_marks} marks`;
      ['qPrompt', 'qAnswer', 'qo1', 'qo2', 'qo3', 'qo4'].forEach((x) => { const n = root.querySelector('#' + x); if (n) n.value = ''; });
      root.querySelector('#qPrompt').focus();
      bindDel();
      toast('Question added', 'ok');
    } catch (e) { toast(e.message, 'danger'); }
  });
};
