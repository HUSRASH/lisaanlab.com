'use strict';
/* Lisaan Lab LMS — oversight: attendance, examinations, results, vault, audit, system */
const V2 = (window.V = window.V || {});

/* ====================== ATTENDANCE OVERSIGHT ====================== */
V2.adminAttendance = {
  title: 'Attendance',
  sub: 'Live class registers and staff duty records',
  tab: 'live',
  async mount(el) {
    el.innerHTML = `
      <div class="tabs">
        <button class="tab ${V2.adminAttendance.tab === 'live' ? 'active' : ''}" data-tab="live">Class registers</button>
        <button class="tab ${V2.adminAttendance.tab === 'staff' ? 'active' : ''}" data-tab="staff">Staff register</button>
        <button class="tab ${V2.adminAttendance.tab === 'student' ? 'active' : ''}" data-tab="student">Student record</button>
      </div>
      <div id="attBody"><div class="loader"><span class="spin"></span> Loading…</div></div>`;

    const body = el.querySelector('#attBody');
    const render = {
      live: async () => {
        const { sessions } = await API.get('/api/attendance/sessions');
        const live = sessions.filter((s) => s.status === 'LIVE');
        body.innerHTML =
          card('Running now', table(
            [{ label: 'Course' }, { label: 'Topic' }, { label: 'Tutor' }, { label: 'Opened' }, { label: 'Present', cls: 'num' }, { label: 'Closes in', cls: 'num' }, { label: '' }],
            live.map((s) => `<tr class="row-click" data-sess="${s.id}">
              <td><span class="id-chip">${esc(s.course_code)}</span></td>
              <td class="t-main">${esc(s.topic)}</td>
              <td>${esc(s.tutor_name)}<div class="t-sub">${esc(s.tutor_uid)}</div></td>
              <td class="t-sub">${fmtTime(s.opened_at)}</td>
              <td class="num"><b>${s.present_count}</b> / ${s.roster_size}</td>
              <td class="num"><span class="countdown" data-until="${s.closes_at}">—</span></td>
              <td class="right"><button class="btn btn-sm btn-ghost" data-open="${s.id}">Watch</button></td></tr>`).join(''),
            { emptyText: 'No register is live', emptyIcon: '🗒' }), '', 'Updates as students mark themselves') +
          card('Register history', table(
            [{ label: 'Course' }, { label: 'Topic' }, { label: 'Tutor' }, { label: 'Date' }, { label: 'Attendance', cls: 'num' }, { label: 'Status' }, { label: '' }],
            sessions.filter((s) => s.status !== 'LIVE').slice(0, 60).map((s) => `<tr>
              <td><span class="id-chip">${esc(s.course_code)}</span></td>
              <td class="t-main">${esc(s.topic)}</td>
              <td class="t-sub">${esc(s.tutor_name)}</td>
              <td class="t-sub">${fmtDT(s.opened_at)}</td>
              <td class="num">${s.present_count} / ${s.roster_size} <span class="t-sub">(${s.roster_size ? Math.round((s.present_count / s.roster_size) * 100) : 0}%)</span></td>
              <td>${statusBadge(s.status)}</td>
              <td class="right"><button class="btn btn-sm btn-ghost" data-open="${s.id}">Sheet</button></td></tr>`).join(''),
            { emptyText: 'No sessions recorded yet', emptyIcon: '🗂' }));
        body.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); V2.sessionSheet(Number(b.dataset.open)); }));
        body.querySelectorAll('[data-sess]').forEach((r) => r.addEventListener('click', () => V2.sessionSheet(Number(r.dataset.sess))));
      },
      staff: async () => {
        const date = V2.adminAttendance._date || new Date().toISOString().slice(0, 10);
        const { records } = await API.get('/api/attendance/staff?date=' + date);
        body.innerHTML = `
          <div class="toolbar"><label class="label" style="margin:0">Date</label>
            <input class="input" type="date" id="staffDate" value="${date}" style="width:auto">
            <div class="spacer"></div>
            <span class="badge ok">${records.filter((r) => r.status === 'ON DUTY').length} on duty</span>
            <span class="badge">${records.filter((r) => r.clock_in).length} clocked in</span></div>
          ${card('Staff duty register — ' + fmtDate(date), table(
            [{ label: '' }, { label: 'Staff' }, { label: 'ID' }, { label: 'Role' }, { label: 'Clock in' }, { label: 'Clock out' }, { label: 'Hours', cls: 'num' }, { label: 'Status' }],
            records.map((r) => `<tr>
              <td>${avatar(r, 'sm')}</td>
              <td><div class="t-main">${esc(r.full_name)}</div><div class="t-sub">${esc(r.designation || '')}</div></td>
              <td><span class="id-chip">${esc(r.uid)}</span></td>
              <td>${roleBadge(r.role)}</td>
              <td>${r.clock_in ? fmtTime(r.clock_in) : '—'}</td>
              <td>${r.clock_out ? fmtTime(r.clock_out) : '—'}</td>
              <td class="num">${r.minutes ? (r.minutes / 60).toFixed(1) : '—'}</td>
              <td>${statusBadge(r.status)}${r.online ? ' <span class="dot-online"></span>' : ''}</td></tr>`).join(''),
            { emptyText: 'No staff accounts yet', emptyIcon: '🧑‍🏫' }))}`;
        body.querySelector('#staffDate').addEventListener('change', (e) => { V2.adminAttendance._date = e.target.value; render.staff(); });
      },
      student: async () => {
        const { users } = await API.get('/api/users?role=STUDENT');
        body.innerHTML = `
          <div class="toolbar">
            <select class="select grow" id="stuPick"><option value="">Select a student…</option>
              ${users.map((u) => `<option value="${u.id}">${esc(u.full_name)} — ${esc(u.uid)}</option>`).join('')}</select></div>
          <div id="stuAtt"><div class="empty"><span class="big">🧑‍🎓</span>Choose a student to see their full attendance record</div></div>`;
        body.querySelector('#stuPick').addEventListener('change', async (e) => {
          if (!e.target.value) return;
          const box = body.querySelector('#stuAtt');
          box.innerHTML = '<div class="loader"><span class="spin"></span> Loading…</div>';
          const d = await API.get('/api/attendance/student/' + e.target.value);
          box.innerHTML = `
            <div class="grid grid-3" style="margin-bottom:18px">
              ${kpi('Attendance rate', pct(d.rate), `${d.present} of ${d.total} sessions`, d.rate >= 75 ? 'ok' : 'warn')}
              ${kpi('Sessions recorded', d.total, 'Across all courses')}
              ${kpi('Courses', d.by_course.length, 'With a register history', 'accent')}
            </div>
            ${card('By course', table([{ label: 'Course' }, { label: 'Title' }, { label: 'Present', cls: 'num' }, { label: 'Rate', cls: 'num' }],
              d.by_course.map((c) => `<tr><td><span class="id-chip">${esc(c.course_code)}</span></td><td>${esc(c.course_title)}</td>
                <td class="num">${c.present}/${c.total}</td><td class="num"><b>${pct(c.rate)}</b></td></tr>`).join('')))}
            ${card('Session history', table([{ label: 'Date' }, { label: 'Course' }, { label: 'Topic' }, { label: 'Status' }, { label: 'Marked at' }],
              d.records.map((r) => `<tr><td class="t-sub">${fmtDate(r.opened_at)}</td><td><span class="id-chip">${esc(r.course_code)}</span></td>
                <td>${esc(r.topic)}</td><td>${statusBadge(r.status)}</td><td class="t-sub">${r.status === 'ABSENT' ? '—' : fmtTime(r.marked_at)}</td></tr>`).join('')))}`;
        });
      },
    };

    el.querySelectorAll('[data-tab]').forEach((t) => t.addEventListener('click', () => {
      V2.adminAttendance.tab = t.dataset.tab;
      el.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('active', x === t));
      render[t.dataset.tab]();
    }));
    await render[V2.adminAttendance.tab]();

    const soft = debounce(() => { if (V2.adminAttendance.tab === 'live') render.live(); }, 700);
    ['attendance:session_opened', 'attendance:session_closed', 'attendance:marked'].forEach((ev) => onView(ev, soft));
    onView('staff_attendance:changed', debounce(() => { if (V2.adminAttendance.tab === 'staff') render.staff(); }, 700));
  },
};

/** Live attendance sheet — roster updates in real time while the register is open. */
V2.sessionSheet = async function (sessionId, canMark) {
  const d = await API.get('/api/attendance/sessions/' + sessionId);
  const s = d.session;
  const rowsHtml = (roster) => roster.map((r) => `<tr data-row="${r.id}">
      <td>${avatar(r, 'sm')}</td>
      <td><div class="t-main">${esc(r.full_name)}</div><div class="t-sub">${esc(r.uid)}</div></td>
      <td data-status>${statusBadge(r.status)}</td>
      <td class="t-sub" data-time>${r.status === 'PENDING' || r.status === 'ABSENT' ? '—' : fmtTime(r.marked_at)}</td>
      ${canMark ? `<td class="right nowrap">
        <button class="btn-icon" data-mark="PRESENT" data-sid="${r.id}" title="Present">✓</button>
        <button class="btn-icon" data-mark="LATE" data-sid="${r.id}" title="Late">⏱</button>
        <button class="btn-icon" data-mark="EXCUSED" data-sid="${r.id}" title="Excused">⊘</button>
        <button class="btn-icon" data-mark="ABSENT" data-sid="${r.id}" title="Absent">✕</button></td>` : ''}
    </tr>`).join('');

  const { root, close } = modal({
    title: `${s.course_code} — ${s.topic}`,
    size: 'wide',
    body: `
      <div class="flex flex-wrap" style="gap:10px;margin-bottom:14px">
        ${s.status === 'LIVE' ? `<span class="badge live">live</span><span>Closes in <span class="countdown" data-until="${s.closes_at}">—</span></span>` : statusBadge(s.status)}
        <span class="badge brand">${esc(s.level_name)}</span>
        <span class="badge accent">Tutor: ${esc(s.tutor_name)}</span>
        <div class="spacer"></div>
        <span class="badge">Opened ${fmtDT(s.opened_at)}</span>
      </div>
      <div class="grid grid-4" style="margin-bottom:14px">
        ${kpi('Roster', s.roster_size, 'Enrolled students')}
        ${kpi('Marked', `<span id="mkCount">${d.roster.filter((r) => r.status !== 'PENDING').length}</span>`, 'Responses received', 'ok')}
        ${kpi('Late', `<span id="mkLate">${d.roster.filter((r) => r.status === 'LATE').length}</span>`, `After ${s.late_after_min} min`, 'warn')}
        ${kpi('Pending', `<span id="mkPend">${d.roster.filter((r) => r.status === 'PENDING').length}</span>`, 'Yet to mark', 'accent')}
      </div>
      ${table([{ label: '' }, { label: 'Student' }, { label: 'Status' }, { label: 'Marked at' }, ...(canMark ? [{ label: '' }] : [])],
        rowsHtml(d.roster), { bodyId: 'rosterBody' })}`,
    actions: [
      { label: 'Close' },
      ...(canMark && s.status === 'LIVE' ? [{
        label: 'End register now', kind: 'btn-danger',
        onClick: async () => { await API.post(`/api/attendance/sessions/${sessionId}/close`); toast('Register closed — absentees recorded', 'ok'); },
      }] : []),
    ],
  });

  const recount = () => {
    const rows = [...root.querySelectorAll('#rosterBody tr')];
    const get = (sel) => rows.filter((r) => (r.querySelector('[data-status] .badge') || {}).textContent === sel).length;
    const pend = get('PENDING');
    root.querySelector('#mkCount').textContent = rows.length - pend;
    root.querySelector('#mkLate').textContent = get('LATE');
    root.querySelector('#mkPend').textContent = pend;
  };

  const off = bus.on('attendance:marked', (p) => {
    if (!document.body.contains(root)) { off(); return; }
    if (p.session_id !== sessionId) return;
    const row = root.querySelector(`[data-row="${p.student.id}"]`);
    if (!row) return;
    row.querySelector('[data-status]').innerHTML = statusBadge(p.status);
    row.querySelector('[data-time]').textContent = fmtTime(p.marked_at);
    row.classList.add('flash');
    setTimeout(() => row.classList.remove('flash'), 1200);
    recount();
  });
  const off2 = bus.on('attendance:session_closed', (p) => {
    if (!document.body.contains(root)) { off2(); return; }
    if (p.session.id === sessionId) { toast('Register closed', 'warn'); close(); }
  });

  if (canMark) {
    root.querySelectorAll('[data-mark]').forEach((b) => b.addEventListener('click', async () => {
      try {
        await API.post(`/api/attendance/sessions/${sessionId}/mark-student`, { student_id: Number(b.dataset.sid), status: b.dataset.mark });
        const row = root.querySelector(`[data-row="${b.dataset.sid}"]`);
        row.querySelector('[data-status]').innerHTML = statusBadge(b.dataset.mark);
        row.querySelector('[data-time]').textContent = fmtTime(new Date().toISOString());
        recount();
      } catch (e) { toast(e.message, 'danger'); }
    }));
  }
};

/* ======================= EXAMINATIONS BOARD ======================= */
V2.adminAssessments = {
  title: 'Examinations',
  sub: 'Vet, monitor and release tests and examinations',
  filter: '',
  async mount(el) {
    const load = async () => {
      const { assessments } = await API.get('/api/assessments' + (V2.adminAssessments.filter ? '?status=' + V2.adminAssessments.filter : ''));
      const counts = assessments.reduce((a, x) => { a[x.status] = (a[x.status] || 0) + 1; return a; }, {});
      el.innerHTML = `
        <div class="toolbar">
          ${['', 'PENDING_APPROVAL', 'APPROVED', 'LIVE', 'CLOSED', 'DRAFT'].map((f) =>
            `<span class="chip ${V2.adminAssessments.filter === f ? 'on' : ''}" data-f="${f}">${f ? esc(f.replace('_', ' ')) : 'All'}${counts[f] ? ` (${counts[f]})` : ''}</span>`).join('')}
        </div>
        ${card('Assessment register', table(
          [{ label: 'Course' }, { label: 'Paper' }, { label: 'Tutor' }, { label: 'Questions', cls: 'num' },
           { label: 'Weight', cls: 'num' }, { label: 'Submitted', cls: 'num' }, { label: 'Average', cls: 'num' }, { label: 'Status' }, { label: '' }],
          assessments.map((a) => `<tr>
            <td><span class="id-chip">${esc(a.course_code)}</span><div class="t-sub">${esc(a.level_name)}</div></td>
            <td><div class="t-main">${esc(a.title)}</div><div class="t-sub">${esc(a.type)} · ${a.duration_min} min</div></td>
            <td><div class="t-main" style="font-size:.84rem">${esc(a.tutor_name)}</div><div class="t-sub">${esc(a.tutor_uid)}</div></td>
            <td class="num">${a.question_count} <span class="t-sub">(${a.total_marks})</span></td>
            <td class="num">${a.weight}%</td>
            <td class="num">${a.submission_count}/${a.roster_size}</td>
            <td class="num">${a.average_percent != null ? pct(a.average_percent) : '—'}</td>
            <td>${statusBadge(a.status)}${a.status === 'LIVE' ? `<div class="t-sub">closes <span class="countdown" data-until="${a.closes_at}">—</span></div>` : ''}</td>
            <td class="right nowrap">
              <button class="btn btn-sm btn-ghost" data-view="${a.id}">Paper</button>
              <button class="btn btn-sm btn-ghost" data-subs="${a.id}">Scores</button>
            </td></tr>`).join(''),
          { emptyText: 'No assessments yet', emptyIcon: '📝' }))}`;

      el.querySelectorAll('[data-f]').forEach((c) => c.addEventListener('click', () => { V2.adminAssessments.filter = c.dataset.f; load(); }));
      el.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => V2.paperModal(Number(b.dataset.view), load)));
      el.querySelectorAll('[data-subs]').forEach((b) => b.addEventListener('click', () => V2.submissionsModal(Number(b.dataset.subs))));
    };
    await load();
    ['assessment:changed', 'assessment:published', 'assessment:closed', 'submission:received'].forEach((ev) => onView(ev, debounce(load, 700)));
  },
};

V2.paperModal = async function (id, onDone) {
  const { assessment: a, questions } = await API.get('/api/assessments/' + id);
  const mayVet = can('assessments.approve') && a.status === 'PENDING_APPROVAL';
  modal({
    title: `${a.course_code} — ${a.title}`,
    size: 'wide',
    body: `
      <div class="flex flex-wrap" style="gap:9px;margin-bottom:14px">
        ${statusBadge(a.status)}<span class="badge brand">${esc(a.type)}</span>
        <span class="badge accent">${a.weight}% of course</span><span class="badge">${a.duration_min} minutes</span>
        <span class="badge">${a.question_count} questions · ${a.total_marks} marks</span></div>
      <div class="stat-line"><span class="l">Tutor</span><span class="r">${esc(a.tutor_name)} (${esc(a.tutor_uid)})</span></div>
      <div class="stat-line"><span class="l">Level / semester</span><span class="r">${esc(a.level_name)} · ${esc(a.semester_name)}</span></div>
      ${a.approver_name ? `<div class="stat-line"><span class="l">Vetted by</span><span class="r">${esc(a.approver_name)} · ${fmtDT(a.approved_at)}</span></div>` : ''}
      ${a.review_note ? `<div class="alert alert-warn" style="margin-top:12px">Reviewer note: ${esc(a.review_note)}</div>` : ''}
      ${a.instructions ? `<div class="alert alert-info" style="margin-top:12px">${esc(a.instructions)}</div>` : ''}
      <div class="perm-group">Question paper &amp; marking scheme</div>
      ${questions.map((q) => `<div class="question" style="box-shadow:none;border:1px solid var(--line)">
        <div class="qn">Question ${q.ordinal} · ${q.marks} mark${q.marks === 1 ? '' : 's'} · ${esc(q.qtype.replace('_', ' '))}</div>
        <div class="qp">${esc(q.prompt)}</div>
        ${q.options ? q.options.map((o) => `<div class="opt ${o.toLowerCase() === String(q.answer).toLowerCase() ? 'correct' : ''}" style="cursor:default">${esc(o)}
          ${o.toLowerCase() === String(q.answer).toLowerCase() ? '<span class="badge ok" style="margin-left:auto">answer</span>' : ''}</div>`).join('')
          : `<div class="alert alert-ok" style="margin:0">Accepted answer(s): <b>${esc(q.answer)}</b></div>`}
      </div>`).join('') || '<div class="empty">No questions have been added yet</div>'}`,
    actions: [
      { label: 'Close' },
      ...(mayVet ? [
        {
          label: 'Return to tutor', kind: 'btn-danger', close: false,
          onClick: ({ close }) => {
            close();
            modal({
              title: 'Return paper to tutor',
              body: '<div class="field"><label class="label" for="rnote">Reason</label><textarea class="input" id="rnote" placeholder="What must the tutor correct?"></textarea></div>',
              actions: [{ label: 'Cancel' }, {
                label: 'Return paper', kind: 'btn-danger', close: false,
                onClick: async ({ root, close: c2 }) => {
                  await API.post(`/api/assessments/${id}/reject`, { note: root.querySelector('#rnote').value.trim() });
                  toast('Paper returned to the tutor', 'ok'); c2(); if (onDone) onDone();
                },
              }],
            });
          },
        },
        {
          label: 'Approve for sitting', kind: 'btn-ok',
          onClick: async () => { await API.post(`/api/assessments/${id}/approve`, {}); toast('Paper approved — the tutor may now publish it', 'ok'); if (onDone) onDone(); },
        },
      ] : []),
    ],
  });
};

V2.submissionsModal = async function (id) {
  const { assessment: a, submissions, pending } = await API.get(`/api/assessments/${id}/submissions`);
  modal({
    title: `Scores — ${a.course_code} ${a.title}`,
    size: 'wide',
    body: `
      <div class="grid grid-4" style="margin-bottom:15px">
        ${kpi('Submitted', submissions.length, `of ${a.roster_size} enrolled`, 'ok')}
        ${kpi('Average', a.average_percent != null ? pct(a.average_percent) : '—', 'Across submissions')}
        ${kpi('Highest', submissions.length ? pct(submissions[0].percent) : '—', submissions.length ? esc(submissions[0].full_name) : '', 'accent')}
        ${kpi('Outstanding', pending.length, 'Yet to sit', pending.length ? 'warn' : '')}
      </div>
      ${table([{ label: '' }, { label: 'Student' }, { label: 'Score', cls: 'num' }, { label: 'Percent', cls: 'num' }, { label: 'Grade' }, { label: 'Submitted' }],
        submissions.map((s) => `<tr>
          <td>${avatar(s, 'sm')}</td>
          <td><div class="t-main">${esc(s.full_name)}</div><div class="t-sub">${esc(s.uid)}</div></td>
          <td class="num">${s.score} / ${s.max_score}</td>
          <td class="num"><b>${pct(s.percent)}</b></td>
          <td>${gradeBadge(s.grade)}</td>
          <td class="t-sub">${fmtDT(s.submitted_at)}</td></tr>`).join(''),
        { emptyText: 'No submissions yet', emptyIcon: '✍' })}
      ${pending.length ? `<div class="perm-group">Yet to sit (${pending.length})</div>
        <div class="flex flex-wrap">${pending.map((p) => `<span class="badge warn">${esc(p.full_name)}</span>`).join('')}</div>` : ''}`,
    actions: [{ label: 'Close' }],
  });
};

/* ======================= STATEMENTS OF RESULT ===================== */
V2.results = {
  title: 'Results',
  sub: 'Compute and publish statements of result at the end of every semester',
  async mount(el) {
    const { levels } = await API.get('/api/academics/structure');
    el.innerHTML = `
      <div class="toolbar">
        <select class="select" id="rLevel">${levels.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select>
        <select class="select" id="rSem"></select>
        <button class="btn btn-ghost" id="rLoad">Compute</button>
        <div class="spacer"></div>
        ${can('results.publish') ? '<button class="btn" id="rPublish">📣 Publish statements</button>' : ''}
      </div>
      <div id="rBody"><div class="empty"><span class="big">🎓</span>Choose a level and semester, then compute the statements</div></div>`;

    const lv = el.querySelector('#rLevel'), sm = el.querySelector('#rSem');
    const fillSem = () => {
      const l = levels.find((x) => String(x.id) === lv.value);
      sm.innerHTML = (l ? l.semesters : []).map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
    };
    lv.addEventListener('change', fillSem); fillSem();

    const load = async () => {
      const box = el.querySelector('#rBody');
      box.innerHTML = '<div class="loader"><span class="spin"></span> Computing from live submissions…</div>';
      const d = await API.get(`/api/assessments/results/preview?level_id=${lv.value}&semester_id=${sm.value}`);
      const avg = d.students.length ? d.students.reduce((a, s) => a + s.gpa, 0) / d.students.length : 0;
      box.innerHTML = `
        <div class="grid grid-4" style="margin-bottom:18px">
          ${kpi('Students', d.students.length, esc(d.semester.name))}
          ${kpi('Average GPA', avg.toFixed(2), 'Across the cohort', 'accent')}
          ${kpi('Published', d.students.filter((s) => s.published_at).length, 'Statements already released', 'ok')}
          ${kpi('Pending', d.students.filter((s) => !s.published_at).length, 'Not yet released', 'warn')}
        </div>
        ${card('Computed statements', table(
          [{ label: '' }, { label: 'Student' }, { label: 'Courses', cls: 'num' }, { label: 'Units', cls: 'num' },
           { label: 'GPA', cls: 'num' }, { label: 'Remark' }, { label: 'Released' }, { label: '' }],
          d.students.map((s) => `<tr>
            <td>${avatar(s.student, 'sm')}</td>
            <td><div class="t-main">${esc(s.student.full_name)}</div><div class="t-sub">${esc(s.student.uid)}</div></td>
            <td class="num">${s.courses}</td><td class="num">${s.units}</td>
            <td class="num"><b>${s.gpa.toFixed(2)}</b></td>
            <td><span class="badge ${s.gpa >= 3.5 ? 'ok' : s.gpa >= 2.4 ? 'brand' : s.gpa >= 1.5 ? 'warn' : 'danger'}">${esc(s.remark)}</span></td>
            <td class="t-sub">${s.published_at ? fmtDT(s.published_at) : '—'}</td>
            <td class="right"><button class="btn btn-sm btn-ghost" data-stmt="${s.student.id}">View</button></td></tr>`).join(''),
          { emptyText: 'No active students at this level', emptyIcon: '🎓' }), '',
          'Course score = weighted average of every test and examination sat')}`;

      box.querySelectorAll('[data-stmt]').forEach((b) => b.addEventListener('click', async () => {
        const sid = Number(b.dataset.stmt);
        const row = d.students.find((x) => x.student.id === sid);
        modal({
          title: `${row.student.full_name} — ${d.semester.name}`,
          size: 'wide',
          body: V2.results.statementHTML({ payload: row, semester_name: d.semester.name, level_name: lv.selectedOptions[0].textContent, gpa: row.gpa, remark: row.remark, published_at: row.published_at }, row.student),
          actions: [{ label: 'Close' }],
        });
      }));
    };

    el.querySelector('#rLoad').addEventListener('click', load);
    const pub = el.querySelector('#rPublish');
    if (pub) pub.addEventListener('click', () => confirmDialog({
      title: 'Publish statements of result',
      confirmLabel: 'Publish now',
      message: 'Every active student at this level receives their statement for this semester immediately. Re-publishing recomputes and overwrites previous figures.',
      onConfirm: async () => {
        const r = await API.post('/api/assessments/results/publish', { level_id: Number(lv.value), semester_id: Number(sm.value) });
        toast(`${r.published} statement${r.published === 1 ? '' : 's'} published for ${r.level} ${r.semester}`, 'ok');
        load();
      },
    }));
  },

  statementHTML(stmt, student) {
    const p = stmt.payload;
    return `
      <div class="sheet" style="box-shadow:none;padding:0">
        <div class="sheet-head"><img src="/assets/logo.png" alt="">
          <div class="t"><h2>Statement of Result</h2><div class="s">${esc(stmt.level_name || p.level || '')} · ${esc(stmt.semester_name || p.semester || '')}</div></div>
        </div>
        <div class="sheet-grid">
          <div class="b"><div class="k">Student</div><div class="v">${esc((student || p.student || {}).full_name || '')}</div></div>
          <div class="b"><div class="k">Student ID</div><div class="v">${esc((student || p.student || {}).uid || '')}</div></div>
          <div class="b"><div class="k">GPA</div><div class="v">${Number(stmt.gpa).toFixed(2)}</div></div>
          <div class="b"><div class="k">Remark</div><div class="v">${esc(stmt.remark)}</div></div>
        </div>
        ${table([{ label: 'Code' }, { label: 'Course' }, { label: 'Units', cls: 'num' }, { label: 'Score %', cls: 'num' },
                 { label: 'Grade' }, { label: 'Points', cls: 'num' }, { label: 'Attendance', cls: 'num' }],
          (p.lines || []).map((l) => `<tr>
            <td><span class="id-chip">${esc(l.course_code)}</span></td>
            <td>${esc(l.course_title)}<div class="t-sub">${(l.components || []).map((c) => `${esc(c.type)} ${c.weight}% → ${pct(c.percent)}${c.sat ? '' : ' (absent)'}`).join(' · ')}</div></td>
            <td class="num">${l.credit_units}</td><td class="num"><b>${pct(l.percent)}</b></td>
            <td>${gradeBadge(l.grade)}</td><td class="num">${l.quality_points}</td>
            <td class="num">${l.attendance_rate == null ? '—' : pct(l.attendance_rate)}</td></tr>`).join(''),
          { emptyText: 'No courses enrolled for this semester' })}
        <div class="sheet-foot">
          <span>Total units: <b>${p.units || 0}</b> · Quality points: <b>${p.quality_points || 0}</b></span>
          <span>${stmt.published_at ? 'Published ' + fmtDT(stmt.published_at) : 'Not yet published'}</span>
        </div>
      </div>`;
  },
};

/* ========================== STORAGE VAULT ========================= */
V2.vault = {
  title: 'Storage vault',
  sub: '100 TB institutional storage — Super Administrator and DG/CEO only',
  async mount(el) {
    const load = async () => {
      const d = await API.get('/api/vault');
      const u = d.usage;
      el.innerHTML = `
        <div class="grid grid-4" style="margin-bottom:18px">
          ${kpi('Used', bytes(u.used), `${u.percent.toFixed(6)}% of capacity`, 'ok')}
          ${kpi('Capacity', '100 TB', 'Allocated quota', 'accent')}
          ${kpi('Objects', u.file_count, 'Files stored')}
          ${kpi('Free', bytes(u.free), 'Remaining allocation')}
        </div>
        ${card('Capacity', `${progress(Math.max(u.percent, 0.4), 'ok')}
          <div class="flex" style="margin-top:9px;font-size:.8rem;color:var(--muted)">
            <span>${bytes(u.used)} used</span><div class="spacer"></div><span>${bytes(u.quota)} total</span></div>
          ${u.host_disk && u.host_disk.free != null ? `<div class="hint">Host volume currently offers ${bytes(u.host_disk.free)} of physical headroom.</div>` : ''}`)}
        ${card('Upload to the vault', `
          <div class="field-row">
            <div class="field"><label class="label" for="vFolder">Folder</label>
              <input class="input" id="vFolder" list="folderList" placeholder="General" value="General">
              <datalist id="folderList">${d.folders.map((f) => `<option value="${esc(f.folder)}">`).join('')}</datalist></div>
            <div class="field"><label class="label" for="vFiles">Files</label><input class="input" id="vFiles" type="file" multiple></div>
          </div>
          <div class="btn-row"><button class="btn" id="vUpload">⬆ Upload</button></div>
          <div id="vProgress" class="hidden" style="margin-top:12px">${progress(0)}<div class="hint" id="vPct">Uploading…</div></div>`)}
        ${card('Stored objects', table(
          [{ label: 'Name' }, { label: 'Folder' }, { label: 'Size', cls: 'num' }, { label: 'Uploaded by' }, { label: 'When' }, { label: '' }],
          d.files.map((f) => `<tr>
            <td class="t-main">${esc(f.name)}<div class="t-sub">${esc(f.mime || 'application/octet-stream')}</div></td>
            <td><span class="badge brand">${esc(f.folder)}</span></td>
            <td class="num">${bytes(f.size)}</td>
            <td class="t-sub">${esc(f.uploader || '—')}</td>
            <td class="t-sub">${fmtDT(f.created_at)}</td>
            <td class="right nowrap">
              <a class="btn btn-sm btn-ghost" href="/api/vault/${f.id}/download">Download</a>
              <button class="btn-icon" data-del="${f.id}" title="Delete">🗑</button></td></tr>`).join(''),
          { emptyText: 'The vault is empty', emptyIcon: '🗄' }), '',
          `${d.folders.length} folder${d.folders.length === 1 ? '' : 's'}`)}`;

      el.querySelector('#vUpload').addEventListener('click', async () => {
        const input = el.querySelector('#vFiles');
        if (!input.files.length) return toast('Choose at least one file', 'warn');
        const fd = new FormData();
        fd.append('folder', el.querySelector('#vFolder').value.trim() || 'General');
        [...input.files].forEach((f) => fd.append('files', f));
        const box = el.querySelector('#vProgress');
        box.classList.remove('hidden');
        const bar = box.querySelector('.progress span'), pctTx = el.querySelector('#vPct');
        await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', '/api/vault/upload');
          xhr.withCredentials = true;
          xhr.upload.onprogress = (e) => {
            if (!e.lengthComputable) return;
            const p = (e.loaded / e.total) * 100;
            bar.style.width = p + '%';
            pctTx.textContent = `${bytes(e.loaded)} of ${bytes(e.total)} (${p.toFixed(0)}%)`;
          };
          xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(JSON.parse(xhr.responseText || '{}').error || 'Upload failed')));
          xhr.onerror = () => reject(new Error('Network error during upload'));
          xhr.send(fd);
        }).then(() => { toast('Upload complete', 'ok'); load(); })
          .catch((e) => { toast(e.message, 'danger'); box.classList.add('hidden'); });
      });

      el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
        confirmDialog({
          title: 'Delete object', danger: true, confirmLabel: 'Delete permanently',
          message: 'This removes the file from disk and from the vault index.',
          onConfirm: async () => { await API.del('/api/vault/' + b.dataset.del); toast('Object deleted', 'ok'); load(); },
        });
      }));
    };
    await load();
    onView('vault:changed', debounce(load, 800));
  },
};

/* ============================ AUDIT LOG =========================== */
V2.audit = {
  title: 'Audit trail',
  sub: 'Every action recorded, in order, with its actor',
  async mount(el) {
    el.innerHTML = `
      <div class="toolbar"><input class="input grow" id="aq" placeholder="Search action, person or detail…">
        <div class="spacer"></div><span class="badge" id="aCount">—</span></div>
      ${card('Activity log', `<div id="aBody"><div class="loader"><span class="spin"></span> Loading…</div></div>`)}`;
    const load = async (q) => {
      const d = await API.get('/api/system/audit?limit=300' + (q ? '&q=' + encodeURIComponent(q) : ''));
      el.querySelector('#aCount').textContent = `${d.total} total entries`;
      el.querySelector('#aBody').innerHTML = table(
        [{ label: 'When' }, { label: 'Actor' }, { label: 'Action' }, { label: 'Entity' }, { label: 'Detail' }, { label: 'IP' }],
        d.entries.map((e) => `<tr>
          <td class="t-sub nowrap">${fmtDT(e.created_at)}</td>
          <td><div class="t-main" style="font-size:.84rem">${esc(e.actor_name || 'System')}</div><div class="t-sub">${esc(e.actor_uid || '')}</div></td>
          <td><span class="badge ${/FAIL|DELETE|RESET|SUSPEND|REJECT/.test(e.action) ? 'danger' : /CREATE|APPROVE|PUBLISH/.test(e.action) ? 'ok' : 'brand'}">${esc(e.action.replace(/_/g, ' '))}</span></td>
          <td class="t-sub">${esc(e.entity || '—')}</td>
          <td class="t-sub" style="max-width:340px;word-break:break-word">${esc(e.detail || '')}</td>
          <td class="t-sub">${esc(e.ip || '—')}</td></tr>`).join(''),
        { emptyText: 'No entries match', emptyIcon: '📜' });
    };
    el.querySelector('#aq').addEventListener('input', debounce((e) => load(e.target.value.trim()), 350));
    await load('');
    onView('audit:new', debounce(() => load(el.querySelector('#aq').value.trim()), 1200));
  },
};

/* ======================== SYSTEM MANAGEMENT ======================= */
V2.system = {
  title: 'System',
  sub: 'Settings, backups and full system reset',
  async mount(el) {
    const isSuper = S.me.role === 'SUPER_ADMIN';
    const { settings } = await API.get('/api/system/settings');
    const { backups } = can('system.backup') ? await API.get('/api/system/backups') : { backups: [] };

    el.innerHTML = `
      ${isSuper ? card('Institution settings', `
        <div class="field-row">
          <div class="field"><label class="label" for="sInst">Institution name</label>
            <input class="input" id="sInst" value="${esc(settings.institution || '')}"></div>
          <div class="field"><label class="label" for="sSess">Academic session</label>
            <input class="input" id="sSess" value="${esc(settings.academic_session || '')}"></div>
        </div>
        <button class="btn" id="sSave">Save settings</button>`) : ''}

      ${can('system.backup') ? card('Backups', `
        <div class="alert alert-info">A backup captures the database, every passport photograph and the whole storage vault as one
          <b>.tar.gz</b> archive you can download and keep for record purposes.</div>
        <div class="btn-row" style="margin-bottom:15px">
          <button class="btn btn-accent" id="bNew">🗄 Create backup now</button></div>
        ${table([{ label: 'Archive' }, { label: 'Reason' }, { label: 'Size', cls: 'num' }, { label: 'Created by' }, { label: 'When' }, { label: '' }],
          backups.map((b) => `<tr>
            <td class="mono t-main" style="font-size:.78rem">${esc(b.filename)}</td>
            <td class="t-sub">${esc(b.reason || '')}</td>
            <td class="num">${bytes(b.size)}</td>
            <td class="t-sub">${esc(b.created_by_name || '—')}</td>
            <td class="t-sub">${fmtDT(b.created_at)}</td>
            <td class="right"><a class="btn btn-sm btn-ghost" href="/api/system/backups/${b.id}/download">Download</a></td></tr>`).join(''),
          { emptyText: 'No backups taken yet', emptyIcon: '🗄' })}`) : ''}

      ${isSuper ? card('Reset the system', `
        <div class="alert alert-danger"><b>Destructive.</b> A safety backup is taken automatically before anything is deleted,
          and the archive stays downloadable above.</div>
        <div class="field"><label class="label">What should be cleared?</label>
          <label class="perm"><div class="tx"><b>Operational data only</b>
            <small>Courses, enrolments, registers, assessments, results, vault objects and notifications. Accounts are kept.</small></div>
            <input type="radio" name="scope" value="DATA" style="width:18px;height:18px;accent-color:var(--brand)"></label>
          <label class="perm"><div class="tx"><b>Everything</b>
            <small>All of the above plus every user account except yours. Levels and semesters are rebuilt fresh.</small></div>
            <input type="radio" name="scope" value="FULL" checked style="width:18px;height:18px;accent-color:var(--danger)"></label></div>
        <div class="field"><label class="label" for="rConfirm">Type <b>RESET LISAAN LAB LMS</b> to confirm</label>
          <input class="input" id="rConfirm" placeholder="RESET LISAAN LAB LMS" autocomplete="off"></div>
        <button class="btn btn-danger" id="rGo" disabled>Backup &amp; reset the system</button>`) : ''}

      ${card('Your account', `
        <div class="flex" style="gap:15px;margin-bottom:14px">${avatar(S.me, 'lg')}
          <div><div class="t-main" style="font-size:1.05rem">${esc(S.me.full_name)}</div>
            <div class="t-sub">${esc(roleLabel(S.me.role))} · <span class="id-chip">${esc(S.me.uid)}</span></div></div></div>
        <button class="btn btn-ghost" id="cpw">Change my password</button>`)}`;

    const save = el.querySelector('#sSave');
    if (save) save.addEventListener('click', async () => {
      await API.patch('/api/system/settings', { institution: el.querySelector('#sInst').value.trim(), academic_session: el.querySelector('#sSess').value.trim() });
      toast('Settings saved', 'ok');
    });

    const bNew = el.querySelector('#bNew');
    if (bNew) bNew.addEventListener('click', async () => {
      bNew.disabled = true; bNew.textContent = 'Creating archive…';
      try { const r = await API.post('/api/system/backup', { reason: 'Manual backup' }); toast(`Backup created — ${bytes(r.backup.size)}`, 'ok'); V2.system.mount(el); }
      catch (e) { toast(e.message, 'danger'); bNew.disabled = false; bNew.textContent = '🗄 Create backup now'; }
    });

    const conf = el.querySelector('#rConfirm'), go = el.querySelector('#rGo');
    if (conf) {
      conf.addEventListener('input', () => { go.disabled = conf.value.trim().toUpperCase() !== 'RESET LISAAN LAB LMS'; });
      go.addEventListener('click', () => confirmDialog({
        title: 'Final confirmation', danger: true, confirmLabel: 'Yes — back up and reset',
        message: 'The safety backup runs first. Everyone else is signed out immediately afterwards.',
        onConfirm: async () => {
          const scope = el.querySelector('input[name="scope"]:checked').value;
          const r = await API.post('/api/system/reset', { confirm: conf.value.trim(), scope });
          toast(`System reset complete. Safety backup: ${r.backup.filename}`, 'ok');
          setTimeout(() => location.reload(), 1400);
        },
      }));
    }

    el.querySelector('#cpw').addEventListener('click', () => V2.changePasswordModal());
  },
};

V2.changePasswordModal = function (forced) {
  return modal({
    title: forced ? 'Set a new password' : 'Change your password',
    body: `${forced ? '<div class="alert alert-warn">For security, you must replace the password you were issued before using the portal.</div>' : ''}
      ${pwField('cpOld', 'Current password', 'Enter your current password')}
      ${pwField('cpNew', 'New password', 'At least 8 characters', 'Must contain at least one letter and one number.')}
      ${pwField('cpNew2', 'Repeat new password', 'Type it again')}`,
    actions: [
      ...(forced ? [] : [{ label: 'Cancel' }]),
      {
        label: 'Update password', kind: 'btn', close: false, busyLabel: 'Updating…',
        onClick: async ({ root, close }) => {
          const a = root.querySelector('#cpNew').value, b = root.querySelector('#cpNew2').value;
          if (a !== b) { toast('The two new passwords do not match', 'danger'); return false; }
          await API.post('/api/auth/change-password', { current_password: root.querySelector('#cpOld').value, new_password: a });
          toast('Password updated', 'ok');
          close();
          if (forced) location.reload();
        },
      },
    ],
  });
};
