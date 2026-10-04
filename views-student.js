'use strict';
/* Lisaan Lab LMS — Student portal */
const V4 = (window.V = window.V || {});

V4.studentDashboard = {
  title: 'Student dashboard',
  sub: 'Your attendance, assessments and results — live',
  async mount(el) {
    const paint = (d) => {
      const k = d.kpis;
      el.innerHTML = `
        <div class="idcard">
          ${avatar(S.me, 'xl')}
          <div class="info">
            <h2>${esc(S.me.full_name)}</h2>
            <div class="flex flex-wrap" style="gap:8px">
              <span class="id-chip">${esc(S.me.uid)}</span>
              <span class="badge accent">${esc(S.me.level_name || '—')}</span>
              <span class="badge">${esc(S.me.semester_name || '—')}</span>
            </div>
            <div class="meta">
              <span>Admitted <b>${S.me.admission_year || '—'}</b></span>
              <span>Courses <b>${k.courses}</b></span>
              <span>Attendance <b>${pct(k.attendance_rate)}</b></span>
              <span>Average score <b>${pct(k.average_score)}</b></span>
            </div>
          </div>
        </div>

        ${d.live_attendance.length ? `<section class="card" style="border-left:4px solid var(--danger)">
          <div class="card-head"><h3><span class="badge live">live</span> Attendance register open
            <div class="card-sub">Mark yourself before the register closes</div></h3></div>
          ${d.live_attendance.map((s) => `
            <div class="flex flex-wrap" style="gap:12px;padding:11px 0;border-bottom:1px solid #f0f0f4">
              <div style="flex:1;min-width:180px">
                <div class="t-main">${esc(s.course_code)} — ${esc(s.topic)}</div>
                <div class="t-sub">${esc(s.tutor_name)} · closes in <span class="countdown" data-until="${s.closes_at}">—</span></div>
              </div>
              ${s.my_status && s.my_status !== 'ABSENT'
                ? `<span class="badge ok">✓ marked ${esc(s.my_status.toLowerCase())}</span>`
                : `<button class="btn btn-accent" data-mark="${s.id}">✓ Mark me present</button>`}
            </div>`).join('')}
        </section>` : ''}

        ${d.live_assessments.length ? `<section class="card" style="border-left:4px solid var(--brand)">
          <div class="card-head"><h3><span class="badge live">live</span> Assessment open
            <div class="card-sub">Your score appears immediately after you submit</div></h3></div>
          ${d.live_assessments.map((a) => `
            <div class="flex flex-wrap" style="gap:12px;padding:11px 0;border-bottom:1px solid #f0f0f4">
              <div style="flex:1;min-width:180px">
                <div class="t-main">${esc(a.course_code)} — ${esc(a.title)}</div>
                <div class="t-sub">${esc(a.type)} · ${a.duration_min} min · closes in <span class="countdown" data-until="${a.closes_at}">—</span></div>
              </div>
              ${a.my_submission_id ? '<span class="badge ok">✓ submitted</span>' : `<button class="btn" data-sit="${a.id}">Start now</button>`}
            </div>`).join('')}
        </section>` : ''}

        <div class="grid grid-4" style="margin-bottom:18px">
          ${kpi('Attendance rate', pct(k.attendance_rate), 'Across all registers', k.attendance_rate >= 75 ? 'ok' : 'warn')}
          ${kpi('Assessments taken', k.assessments_taken, `Average ${pct(k.average_score)}`, 'accent')}
          ${kpi('Courses', k.courses, 'This semester')}
          ${kpi('Statements', k.results_published, 'Results released', k.results_published ? 'ok' : '')}
        </div>

        <div class="grid grid-sb">
          <div>
            ${card('My courses', table(
              [{ label: 'Code' }, { label: 'Course' }, { label: 'Tutor' }, { label: 'Level' }, { label: 'Units', cls: 'num' }],
              d.courses.map((c) => `<tr><td><span class="id-chip">${esc(c.code)}</span></td>
                <td class="t-main">${esc(c.title)}</td><td class="t-sub">${esc(c.tutor_name || 'unassigned')}</td>
                <td class="t-sub">${esc(c.level_name)} · ${esc(c.semester_name)}</td><td class="num">${c.credit_units}</td></tr>`).join(''),
              { emptyText: 'You are not enrolled in any course yet', emptyIcon: '📚' }))}
            ${card('Recent scores', table(
              [{ label: 'Course' }, { label: 'Paper' }, { label: 'Score', cls: 'num' }, { label: 'Percent', cls: 'num' }, { label: 'When' }],
              d.recent_scores.map((s) => `<tr><td><span class="id-chip">${esc(s.course_code)}</span></td>
                <td>${esc(s.title)}<div class="t-sub">${esc(s.type)}</div></td>
                <td class="num">${s.score} / ${s.max_score}</td>
                <td class="num"><b>${pct(s.percent)}</b> ${gradeBadge(gradeOfPct(s.percent))}</td>
                <td class="t-sub">${ago(s.submitted_at)}</td></tr>`).join(''),
              { emptyText: 'No assessment taken yet', emptyIcon: '✍' }), '', 'Marked the instant you submit')}
          </div>
          <div>
            ${card('Statements of result', d.statements.length ? d.statements.map((s) => `
              <div class="stat-line"><span class="l">${esc(s.level_name)}<br><small>${esc(s.semester_name)}</small></span>
                <span class="r">${s.gpa.toFixed(2)} <span class="badge ${s.gpa >= 3.5 ? 'ok' : s.gpa >= 2.4 ? 'brand' : 'warn'}">${esc(s.remark)}</span></span></div>`).join('')
              : '<div class="empty"><span class="big">🎓</span>No statement published yet</div>')}
            ${card('Recent attendance', d.attendance_recent.length ? d.attendance_recent.map((r) => `
              <div class="stat-line"><span class="l">${esc(r.course_code)}<br><small>${esc(r.topic)}</small></span>
                <span class="r">${statusBadge(r.status)}</span></div>`).join('')
              : '<div class="empty"><span class="big">🗒</span>No register recorded yet</div>')}
          </div>
        </div>`;

      el.querySelectorAll('[data-mark]').forEach((b) => b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          const r = await API.post(`/api/attendance/sessions/${b.dataset.mark}/mark`, {});
          toast(`You are marked ${r.status.toLowerCase()}`, 'ok');
          load();
        } catch (e) { toast(e.message, 'danger'); b.disabled = false; }
      }));
      el.querySelectorAll('[data-sit]').forEach((b) => b.addEventListener('click', () => V4.startPaper(Number(b.dataset.sit))));
    };
    const load = async () => paint(await API.get('/api/system/dashboard'));
    el.innerHTML = '<div class="loader"><span class="spin"></span> Loading your portal…</div>';
    await load();
    ['attendance:session_opened', 'attendance:session_closed', 'assessment:published', 'assessment:closed',
     'submission:mine', 'result:published', 'enrollment:changed', 'profile:updated'].forEach((ev) => onView(ev, debounce(load, 600)));
  },
};

function gradeOfPct(p) { return p >= 70 ? 'A' : p >= 60 ? 'B' : p >= 50 ? 'C' : p >= 45 ? 'D' : p >= 40 ? 'E' : 'F'; }

V4.studentAttendance = {
  title: 'My attendance',
  sub: 'Every register published for your courses',
  async mount(el) {
    const load = async () => {
      const d = await API.get('/api/attendance/student/' + S.me.id);
      const live = (await API.get('/api/attendance/sessions?scope=live')).sessions;
      el.innerHTML = `
        <div class="grid grid-3" style="margin-bottom:18px">
          ${kpi('Attendance rate', pct(d.rate), `${d.present} of ${d.total} sessions`, d.rate >= 75 ? 'ok' : 'warn')}
          ${kpi('Sessions', d.total, 'Registers recorded')}
          ${kpi('Open now', live.length, 'Registers you can mark', live.length ? 'danger' : '')}
        </div>
        ${live.length ? card('Open registers', live.map((s) => `
          <div class="flex flex-wrap" style="gap:12px;padding:10px 0;border-bottom:1px solid #f0f0f4">
            <div style="flex:1;min-width:180px"><div class="t-main">${esc(s.course_code)} — ${esc(s.topic)}</div>
              <div class="t-sub">closes in <span class="countdown" data-until="${s.closes_at}">—</span></div></div>
            <button class="btn btn-accent btn-sm" data-mark="${s.id}">✓ Mark me present</button></div>`).join('')) : ''}
        ${card('By course', table([{ label: 'Course' }, { label: 'Title' }, { label: 'Attended', cls: 'num' }, { label: 'Rate', cls: 'num' }, { label: '' }],
          d.by_course.map((c) => `<tr><td><span class="id-chip">${esc(c.course_code)}</span></td><td>${esc(c.course_title)}</td>
            <td class="num">${c.present}/${c.total}</td><td class="num"><b>${pct(c.rate)}</b></td>
            <td style="width:140px">${progress(c.rate, c.rate >= 75 ? 'ok' : 'warn')}</td></tr>`).join(''),
          { emptyText: 'No register recorded yet', emptyIcon: '🗒' }))}
        ${card('Full record', table([{ label: 'Date' }, { label: 'Course' }, { label: 'Topic' }, { label: 'Status' }, { label: 'Marked at' }],
          d.records.map((r) => `<tr><td class="t-sub">${fmtDate(r.opened_at)}</td><td><span class="id-chip">${esc(r.course_code)}</span></td>
            <td>${esc(r.topic)}</td><td>${statusBadge(r.status)}</td>
            <td class="t-sub">${r.status === 'ABSENT' ? '—' : fmtTime(r.marked_at)}</td></tr>`).join(''),
          { emptyText: 'Nothing recorded yet', emptyIcon: '🗂' }))}`;
      el.querySelectorAll('[data-mark]').forEach((b) => b.addEventListener('click', async () => {
        try { const r = await API.post(`/api/attendance/sessions/${b.dataset.mark}/mark`, {}); toast(`Marked ${r.status.toLowerCase()}`, 'ok'); load(); }
        catch (e) { toast(e.message, 'danger'); }
      }));
    };
    await load();
    ['attendance:session_opened', 'attendance:session_closed', 'attendance:self_marked'].forEach((ev) => onView(ev, debounce(load, 700)));
  },
};

V4.studentAssessments = {
  title: 'Tests & examinations',
  sub: 'Sit your papers and see the score immediately',
  async mount(el) {
    const load = async () => {
      const { assessments } = await API.get('/api/assessments');
      el.innerHTML = `
        ${card('Available now', (assessments.filter((a) => a.can_sit).map((a) => `
          <div class="flex flex-wrap" style="gap:12px;padding:12px 0;border-bottom:1px solid #f0f0f4">
            <div style="flex:1;min-width:200px">
              <div class="t-main">${esc(a.course_code)} — ${esc(a.title)}</div>
              <div class="t-sub">${esc(a.type)} · ${a.question_count} questions · ${a.total_marks} marks · ${a.duration_min} minutes</div>
              <div class="t-sub">Closes in <span class="countdown" data-until="${a.closes_at}">—</span></div>
            </div>
            <button class="btn" data-sit="${a.id}">Start paper</button>
          </div>`).join('')) || '<div class="empty"><span class="big">📝</span>No paper is open for you right now</div>')}
        ${card('My results', table(
          [{ label: 'Course' }, { label: 'Paper' }, { label: 'Type' }, { label: 'Score', cls: 'num' }, { label: 'Percent', cls: 'num' }, { label: 'Grade' }, { label: 'Submitted' }],
          assessments.filter((a) => a.my_submission).map((a) => `<tr>
            <td><span class="id-chip">${esc(a.course_code)}</span></td>
            <td class="t-main">${esc(a.title)}</td><td>${esc(a.type)}</td>
            <td class="num">${a.my_submission.score} / ${a.my_submission.max_score}</td>
            <td class="num"><b>${pct(a.my_submission.percent)}</b></td>
            <td>${gradeBadge(gradeOfPct(a.my_submission.percent))}</td>
            <td class="t-sub">${fmtDT(a.my_submission.submitted_at)}</td></tr>`).join(''),
          { emptyText: 'You have not sat any paper yet', emptyIcon: '✍' }))}
        ${card('Missed / closed papers', table([{ label: 'Course' }, { label: 'Paper' }, { label: 'Status' }, { label: 'Closed' }],
          assessments.filter((a) => a.status === 'CLOSED' && !a.my_submission).map((a) => `<tr>
            <td><span class="id-chip">${esc(a.course_code)}</span></td><td>${esc(a.title)}</td>
            <td><span class="badge danger">not sat</span></td><td class="t-sub">${fmtDT(a.closes_at)}</td></tr>`).join(''),
          { emptyText: 'Nothing missed', emptyIcon: '✓' }))}`;
      el.querySelectorAll('[data-sit]').forEach((b) => b.addEventListener('click', () => V4.startPaper(Number(b.dataset.sit))));
    };
    await load();
    ['assessment:published', 'assessment:closed', 'submission:mine'].forEach((ev) => onView(ev, debounce(load, 600)));
  },
};

/* ------------------------- sitting a paper ------------------------ */
V4.startPaper = async function (id) {
  let paper;
  try { paper = await API.get(`/api/assessments/${id}/paper`); }
  catch (e) { return toast(e.message, 'danger'); }
  const a = paper.assessment;
  const view = document.getElementById('view');
  const answers = {};
  const startedAt = new Date().toISOString();

  document.getElementById('pageTitle').textContent = `${a.course_code} — ${a.title}`;
  document.getElementById('pageSub').textContent = `${a.type} · ${paper.questions.length} questions · ${a.total_marks} marks`;

  view.innerHTML = `
    <div class="exam-bar">
      <div><div class="t-main">${esc(a.course_code)} — ${esc(a.title)}</div>
        <div class="t-sub">${esc(a.type)} · ${a.total_marks} marks · ${esc(a.tutor_name)}</div></div>
      <div class="spacer"></div>
      <div class="center"><div class="t-sub">Time remaining</div>
        <div class="countdown" style="font-size:1.25rem" data-until="${a.closes_at}" data-onend="exam:timeup">—</div></div>
      <div class="center"><div class="t-sub">Answered</div><div class="t-main" id="answeredCount">0 / ${paper.questions.length}</div></div>
      <button class="btn btn-ok" id="submitPaper">Submit paper</button>
    </div>
    ${a.instructions ? `<div class="alert alert-info">${esc(a.instructions)}</div>` : ''}
    <div id="questions">
      ${paper.questions.map((q) => `
        <div class="question" data-q="${q.id}">
          <div class="qn">Question ${q.ordinal} · ${q.marks} mark${q.marks === 1 ? '' : 's'}</div>
          <div class="qp">${esc(q.prompt)}</div>
          ${q.options ? q.options.map((o, i) => `
            <label class="opt" data-opt="${esc(o)}">
              <input type="radio" name="q${q.id}" value="${esc(o)}">
              <span><b>${String.fromCharCode(65 + i)}.</b> ${esc(o)}</span>
            </label>`).join('')
            : `<input class="input" placeholder="Type your answer" data-short="${q.id}">`}
        </div>`).join('')}
    </div>
    <div class="btn-row" style="margin-bottom:40px"><button class="btn btn-lg btn-ok" id="submitPaper2">Submit paper</button>
      <button class="btn btn-lg btn-ghost" id="abandon">Leave without submitting</button></div>`;

  const updateCount = () => {
    document.getElementById('answeredCount').textContent = `${Object.keys(answers).filter((k) => answers[k] !== '').length} / ${paper.questions.length}`;
  };
  view.querySelectorAll('input[type="radio"]').forEach((r) => r.addEventListener('change', () => {
    const q = r.closest('[data-q]');
    q.querySelectorAll('.opt').forEach((o) => o.classList.remove('sel'));
    r.closest('.opt').classList.add('sel');
    answers[q.dataset.q] = r.value;
    updateCount();
  }));
  view.querySelectorAll('[data-short]').forEach((i) => i.addEventListener('input', () => { answers[i.dataset.short] = i.value.trim(); updateCount(); }));

  let submitting = false;
  const submit = async (auto) => {
    if (submitting) return;
    const unanswered = paper.questions.length - Object.keys(answers).filter((k) => answers[k] !== '').length;
    if (!auto && unanswered > 0) {
      const ok = await new Promise((resolve) => {
        let decided = false;
        const done = (v) => { if (!decided) { decided = true; resolve(v); } };
        const m = modal({
          title: 'Submit with unanswered questions?',
          body: `<p style="margin:0">${unanswered} question${unanswered === 1 ? '' : 's'} left blank. Unanswered questions score zero.</p>`,
          actions: [
            { label: 'Go back', onClick: () => done(false) },
            { label: 'Submit anyway', kind: 'btn-ok', onClick: () => done(true) },
          ],
        });
        // Dismissing the dialog any other way counts as "go back".
        const watch = setInterval(() => {
          if (!document.body.contains(m.root)) { clearInterval(watch); done(false); }
        }, 200);
      });
      if (!ok) return;
    }
    submitting = true;
    try {
      const r = await API.post(`/api/assessments/${id}/submit`, { answers, started_at: startedAt });
      V4.scoreModal(a, r, paper.questions);
      go('assessments');
    } catch (e) { submitting = false; toast(e.message, 'danger'); }
  };
  document.getElementById('submitPaper').addEventListener('click', () => submit(false));
  document.getElementById('submitPaper2').addEventListener('click', () => submit(false));
  document.getElementById('abandon').addEventListener('click', () => go('assessments'));
  onView('exam:timeup', () => { toast('Time is up — submitting your paper', 'warn'); submit(true); });
  onView('assessment:closed', (d) => { if (d.assessment && d.assessment.id === id) submit(true); });
};

V4.scoreModal = function (a, result, questions) {
  const byId = new Map(questions.map((q) => [String(q.id), q]));
  modal({
    title: 'Your score',
    size: 'wide',
    body: `
      <div class="alert alert-ok">Marked automatically and recorded against <b>${esc(a.course_code)}</b>.
        It counts ${a.weight}% toward your course score.</div>
      <div class="grid grid-4" style="margin-bottom:16px">
        ${kpi('Score', `${result.submission.score} / ${result.submission.max_score}`, 'Raw marks', 'ok')}
        ${kpi('Percent', pct(result.submission.percent), 'Of total marks')}
        ${kpi('Grade', result.grade.grade, esc(result.grade.remark), 'accent')}
        ${kpi('Submitted', fmtTime(result.submission.submitted_at), fmtDate(result.submission.submitted_at))}
      </div>
      <div class="perm-group">Question by question</div>
      ${result.breakdown.map((b) => {
        const q = byId.get(String(b.question_id));
        return `<div class="question" style="box-shadow:none;border:1px solid var(--line);padding:13px">
          <div class="flex"><div class="qn" style="flex:1">Question ${b.ordinal}</div>
            <span class="badge ${b.correct ? 'ok' : 'danger'}">${b.marks} / ${b.out_of}</span></div>
          <div class="qp" style="font-size:.92rem;margin-bottom:6px">${esc(q ? q.prompt : '')}</div>
          <div class="t-sub">Your answer: <b>${esc(b.given || '— blank —')}</b></div>
        </div>`;
      }).join('')}`,
    actions: [{ label: 'Done', kind: 'btn' }],
  });
};

/* --------------------------- results ------------------------------ */
V4.studentResults = {
  title: 'Statements of result',
  sub: 'Published at the end of every semester',
  async mount(el) {
    const d = await API.get('/api/assessments/results/student/' + S.me.id);
    el.innerHTML = `
      <div class="grid grid-3" style="margin-bottom:18px">
        ${kpi('CGPA', d.cgpa.toFixed(2), `${d.statements.length} semester${d.statements.length === 1 ? '' : 's'} published`, 'accent')}
        ${kpi('Current level', esc(S.me.level_name || '—'), esc(S.me.semester_name || ''))}
        ${kpi('Student ID', `<span style="font-size:1rem">${esc(S.me.uid)}</span>`, `Admitted ${S.me.admission_year || '—'}`)}
      </div>
      ${d.statements.length ? d.statements.map((s) => V.results.statementHTML(s, d.student) +
        `<div class="btn-row no-print" style="margin:-8px 0 20px"><button class="btn btn-sm btn-ghost" onclick="window.print()">🖨 Print this statement</button></div>`).join('')
        : '<div class="card"><div class="empty"><span class="big">🎓</span>No statement has been published for you yet.<br><small>Statements are released by the examinations office at the end of each semester.</small></div></div>'}`;
    onView('result:published', () => { toast('A new statement of result has been published', 'ok'); V4.studentResults.mount(el); });
  },
};

V4.studentCourses = {
  title: 'My courses',
  sub: 'Courses you are enrolled in',
  async mount(el) {
    const { courses } = await API.get('/api/academics/courses');
    el.innerHTML = courses.length ? `<div class="grid grid-2">${courses.map((c) => `
      <section class="card">
        <div class="card-head"><h3>${esc(c.code)}<div class="card-sub">${esc(c.title)}</div></h3></div>
        <div class="stat-line"><span class="l">Tutor</span><span class="r">${esc(c.tutor_name || 'Unassigned')}</span></div>
        <div class="stat-line"><span class="l">Level</span><span class="r">${esc(c.level_name)}</span></div>
        <div class="stat-line"><span class="l">Semester</span><span class="r">${esc(c.semester_name)}</span></div>
        <div class="stat-line"><span class="l">Credit units</span><span class="r">${c.credit_units}</span></div>
        <div class="stat-line"><span class="l">Classmates</span><span class="r">${c.student_count}</span></div>
      </section>`).join('')}</div>`
      : '<div class="card"><div class="empty"><span class="big">📚</span>You have not been enrolled in any course yet</div></div>';
  },
};

/* --------------------------- shared profile ----------------------- */
V4.profile = {
  title: 'My profile',
  sub: 'Your identity and security',
  async mount(el) {
    const { user } = await API.get('/api/users/' + S.me.id);
    el.innerHTML = `
      <div class="grid grid-2">
        <section class="card">
          <div class="card-head"><h3>Identity</h3></div>
          <div class="flex" style="gap:16px;margin-bottom:14px">${avatar(user, 'xl')}
            <div><div class="t-main" style="font-size:1.1rem">${esc(user.full_name)}</div>
              <div class="t-sub">${esc(roleLabel(user.role))}</div>
              <div style="margin-top:7px"><span class="id-chip">${esc(user.uid)}</span></div></div></div>
          <div class="stat-line"><span class="l">Email</span><span class="r">${esc(user.email)}</span></div>
          <div class="stat-line"><span class="l">Phone</span><span class="r">${esc(user.phone || '—')}</span></div>
          ${user.level_name ? `<div class="stat-line"><span class="l">Level</span><span class="r">${esc(user.level_name)}</span></div>
            <div class="stat-line"><span class="l">Semester</span><span class="r">${esc(user.semester_name || '—')}</span></div>` : ''}
          ${user.designation ? `<div class="stat-line"><span class="l">Designation</span><span class="r">${esc(user.designation)}</span></div>` : ''}
          <div class="stat-line"><span class="l">Account created</span><span class="r">${fmtDT(user.created_at)}</span></div>
          <div class="stat-line"><span class="l">Sign-ins</span><span class="r">${user.login_count}</span></div>
        </section>
        <section class="card">
          <div class="card-head"><h3>Update details</h3></div>
          <div class="field"><label class="label" for="pName">Full name</label><input class="input" id="pName" value="${esc(user.full_name)}"></div>
          <div class="field"><label class="label" for="pPhone">Phone</label><input class="input" id="pPhone" value="${esc(user.phone || '')}"></div>
          <div class="field"><label class="label" for="pPhoto">Replace passport photograph</label>
            <input class="input" id="pPhoto" type="file" accept="image/*"></div>
          <div class="btn-row"><button class="btn" id="pSave">Save changes</button>
            <button class="btn btn-ghost" id="pPw">Change password</button></div>
        </section>
      </div>`;
    el.querySelector('#pSave').addEventListener('click', async () => {
      const fd = new FormData();
      fd.append('full_name', el.querySelector('#pName').value.trim());
      fd.append('phone', el.querySelector('#pPhone').value.trim());
      const f = el.querySelector('#pPhoto').files[0];
      if (f) fd.append('passport', f);
      const r = await API.upload('/api/users/' + S.me.id, fd, 'PATCH');
      S.me = { ...S.me, ...r.user };
      toast('Profile updated', 'ok');
      V4.profile.mount(el);
      paintIdentity();
    });
    el.querySelector('#pPw').addEventListener('click', () => V.changePasswordModal());
  },
};
