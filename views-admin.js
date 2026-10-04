'use strict';
/* Lisaan Lab LMS — Super Admin / DG-CEO / Administrator views */
const V = (window.V = window.V || {});

/* ======================= SUPERVISION DASHBOARD ===================== */
V.adminDashboard = {
  title: 'Supervision dashboard',
  sub: 'Live activity across students, tutors and administrators',
  async mount(el) {
    el.innerHTML = '<div class="loader"><span class="spin"></span> Gathering live data…</div>';
    const paint = (d) => {
      const k = d.kpis;
      el.innerHTML = `
        <div class="grid grid-4" style="margin-bottom:18px">
          ${kpi('Students', k.students, `${k.enrollments} enrolments`)}
          ${kpi('Tutors', k.tutors, `${k.courses} courses`, 'accent')}
          ${kpi('Administrative staff', k.admins, `${k.suspended} suspended`, k.suspended ? 'warn' : '')}
          ${kpi('Online now', `<span id="kOnline">${k.online}</span>`, 'Connected in real time', 'ok')}
        </div>
        <div class="grid grid-4" style="margin-bottom:18px">
          ${kpi('Live registers', k.live_sessions, 'Attendance running now', k.live_sessions ? 'danger' : '')}
          ${kpi('Live assessments', k.live_assessments, `${k.submissions_today} submitted today`, k.live_assessments ? 'danger' : '')}
          ${kpi('Awaiting vetting', k.pending_approvals, 'Exams officer queue', k.pending_approvals ? 'warn' : '')}
          ${kpi('Staff on duty', k.staff_on_duty, `Attendance today ${pct(k.attendance_today)}`, 'accent')}
        </div>
        <div class="grid grid-sb">
          <div>
            ${card('Live class registers', `<div id="liveSessions">${V.adminDashboard._liveSessionTable(d.live_sessions)}</div>`, '', 'Published by tutors — updating as students mark')}
            ${card('Live assessments', `<div id="liveAssess">${V.adminDashboard._liveAssessTable(d.live_assessments)}</div>`, '', 'Monitored by the exams officer')}
            ${card('Latest submissions', `<div id="recentSubs">${V.adminDashboard._subsTable(d.recent_submissions)}</div>`, '', 'Scored automatically on submission')}
          </div>
          <div>
            ${card('Who is online', `<div id="onlinePanel">${V.adminDashboard._onlinePanel(d.online)}</div>`)}
            ${card('Enrolment by level', d.enrolment_by_level.map((l) => `
              <div style="margin-bottom:11px">
                <div class="stat-line" style="border:0;padding:3px 0"><span class="l">${esc(l.name)}</span><span class="r">${l.n}</span></div>
                ${progress(k.students ? (l.n / k.students) * 100 : 0, 'accent')}
              </div>`).join(''))}
            ${d.vault ? card('Storage vault', `
              <div class="stat-line"><span class="l">Used</span><span class="r">${bytes(d.vault.used)}</span></div>
              <div class="stat-line"><span class="l">Capacity</span><span class="r">${bytes(d.vault.quota)}</span></div>
              <div class="stat-line"><span class="l">Objects</span><span class="r">${d.vault.files}</span></div>
              <div style="margin-top:10px">${progress((d.vault.used / d.vault.quota) * 100, 'ok')}</div>
              <div class="hint">${((d.vault.used / d.vault.quota) * 100).toFixed(6)}% of 100 TB consumed</div>`) : ''}
            ${card('Activity feed', `<div class="feed" id="feed">${V.adminDashboard._feed(d.recent_activity)}</div>`, '', 'Every action is logged')}
          </div>
        </div>`;
    };

    const load = async () => paint(await API.get('/api/system/dashboard'));
    await load();

    const refresh = debounce(load, 700);
    ['user:created', 'user:updated', 'user:deleted', 'attendance:session_opened', 'attendance:session_closed',
     'attendance:marked', 'assessment:changed', 'assessment:published', 'assessment:closed', 'submission:received',
     'results:changed', 'vault:changed', 'staff_attendance:changed', 'course:created', 'course:updated', 'course:deleted',
    ].forEach((ev) => onView(ev, refresh));

    onView('presence:update', (d) => {
      const p = document.getElementById('onlinePanel');
      if (p) p.innerHTML = V.adminDashboard._onlinePanel(d.online);
      const kO = document.getElementById('kOnline');
      if (kO) kO.textContent = d.count;
    });
    onView('audit:new', (entry) => {
      const feed = document.getElementById('feed');
      if (!feed) return;
      const div = document.createElement('div');
      div.innerHTML = V.adminDashboard._feed([entry]);
      const node = div.firstElementChild;
      node.classList.add('flash');
      feed.prepend(node);
      while (feed.children.length > 40) feed.lastElementChild.remove();
    });
  },

  _onlinePanel(list) {
    if (!list || !list.length) return '<div class="empty"><span class="big">◌</span>No one is connected right now</div>';
    return list.map((u) => `
      <div class="flex" style="padding:7px 0;border-bottom:1px solid #f0f0f4">
        ${avatar(u, 'sm')}
        <div style="flex:1;min-width:0">
          <div class="t-main" style="font-size:.85rem">${esc(u.full_name)}</div>
          <div class="t-sub">${esc(roleLabel(u.role))} · since ${fmtTime(u.since)}</div>
        </div>
        <span class="dot-online" title="Online"></span>
      </div>`).join('');
  },
  _liveSessionTable(rows) {
    return table(
      [{ label: 'Course' }, { label: 'Topic' }, { label: 'Tutor' }, { label: 'Marked', cls: 'num' }, { label: 'Closes in', cls: 'num' }],
      (rows || []).map((s) => `<tr>
        <td><span class="id-chip">${esc(s.course_code)}</span></td>
        <td class="t-main">${esc(s.topic)}</td>
        <td>${esc(s.tutor_name)}</td>
        <td class="num"><b>${s.present_count}</b> / ${s.roster_size}</td>
        <td class="num"><span class="countdown" data-until="${s.closes_at}">—</span></td>
      </tr>`).join(''),
      { emptyText: 'No register is live at the moment', emptyIcon: '🗒' });
  },
  _liveAssessTable(rows) {
    return table(
      [{ label: 'Course' }, { label: 'Paper' }, { label: 'Tutor' }, { label: 'Submitted', cls: 'num' }, { label: 'Closes in', cls: 'num' }],
      (rows || []).map((a) => `<tr>
        <td><span class="id-chip">${esc(a.course_code)}</span></td>
        <td><div class="t-main">${esc(a.title)}</div><div class="t-sub">${esc(a.type)}</div></td>
        <td>${esc(a.tutor_name)}</td>
        <td class="num"><b>${a.submission_count}</b> / ${a.roster_size}</td>
        <td class="num"><span class="countdown" data-until="${a.closes_at}">—</span></td>
      </tr>`).join(''),
      { emptyText: 'No assessment is running', emptyIcon: '📝' });
  },
  _subsTable(rows) {
    return table(
      [{ label: 'Student' }, { label: 'Course' }, { label: 'Paper' }, { label: 'Score', cls: 'num' }, { label: 'When', cls: 'num' }],
      (rows || []).map((s) => `<tr>
        <td><div class="t-main">${esc(s.full_name)}</div><div class="t-sub">${esc(s.uid)}</div></td>
        <td><span class="id-chip">${esc(s.course_code)}</span></td>
        <td>${esc(s.title)}</td>
        <td class="num"><b>${pct(s.percent)}</b></td>
        <td class="num t-sub">${ago(s.submitted_at)}</td>
      </tr>`).join(''),
      { emptyText: 'No submissions yet', emptyIcon: '✓' });
  },
  _feed(entries) {
    const icons = { LOGIN: '→', LOGOUT: '←', USER_CREATED: '＋', PASSWORD_RESET: '⟳', ATTENDANCE_SESSION_OPENED: '▶',
      ATTENDANCE_MARKED: '✓', ASSESSMENT_PUBLISHED: '📣', ASSESSMENT_SUBMITTED: '✎', RESULTS_PUBLISHED: '🎓',
      VAULT_UPLOAD: '⬆', BACKUP_CREATED: '🗄', SYSTEM_RESET: '⚠', LOGIN_FAILED: '✕' };
    return (entries || []).map((e) => {
      let detail = '';
      try { const d = JSON.parse(e.detail || '{}'); detail = Object.entries(d).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(' · '); }
      catch { detail = e.detail || ''; }
      return `<div class="feed-item">
        <span class="ic">${icons[e.action] || '•'}</span>
        <div class="tx"><b>${esc(e.actor_name || 'System')}</b> — ${esc(String(e.action).replace(/_/g, ' ').toLowerCase())}
          ${detail ? `<div class="t-sub">${esc(detail)}</div>` : ''}</div>
        <span class="tm">${ago(e.created_at)}</span>
      </div>`;
    }).join('');
  },
};

/* ========================== USER DIRECTORY ========================= */
V.users = {
  title: 'User accounts',
  sub: 'Generate and govern every account in the system',
  state: { role: '', q: '', status: '' },
  async mount(el) {
    el.innerHTML = `
      <div class="toolbar">
        <input class="input grow" id="uq" placeholder="Search by name, email or ID…" value="${esc(V.users.state.q)}">
        <div class="flex flex-wrap" id="roleChips">
          ${['', 'STUDENT', 'TUTOR', 'ADMIN', 'DG_CEO'].map((r) =>
            `<span class="chip ${V.users.state.role === r ? 'on' : ''}" data-role="${r}">${r ? esc(roleLabel(r)) : 'All roles'}</span>`).join('')}
        </div>
        <div class="spacer"></div>
        ${can('users.create') ? '<button class="btn" id="newUser">＋ Create account</button>' : ''}
      </div>
      <section class="card"><div id="userTable"><div class="loader"><span class="spin"></span> Loading accounts…</div></div></section>`;

    const load = async () => {
      const p = new URLSearchParams();
      if (V.users.state.role) p.set('role', V.users.state.role);
      if (V.users.state.q) p.set('q', V.users.state.q);
      const { users } = await API.get('/api/users?' + p.toString());
      document.getElementById('userTable').innerHTML = V.users._table(users);
    };

    el.querySelector('#uq').addEventListener('input', debounce((e) => { V.users.state.q = e.target.value.trim(); load(); }, 320));
    el.querySelectorAll('[data-role]').forEach((c) => c.addEventListener('click', () => {
      V.users.state.role = c.dataset.role;
      el.querySelectorAll('[data-role]').forEach((x) => x.classList.toggle('on', x === c));
      load();
    }));
    const nu = el.querySelector('#newUser');
    if (nu) nu.addEventListener('click', () => V.users.createModal(load));

    el.addEventListener('click', (e) => {
      const row = e.target.closest('[data-uid]');
      if (row && !e.target.closest('button')) V.users.profileModal(Number(row.dataset.uid), load);
    });

    await load();
    const refresh = debounce(load, 600);
    ['user:created', 'user:updated', 'user:deleted', 'presence:update'].forEach((ev) => onView(ev, refresh));
  },

  _table(users) {
    return table(
      [{ label: '' }, { label: 'Name' }, { label: 'ID' }, { label: 'Role' }, { label: 'Placement' },
       { label: 'Status' }, { label: 'Last seen' }, { label: '' }],
      users.map((u) => `<tr class="row-click" data-uid="${u.id}">
        <td>${avatar(u, 'sm')}</td>
        <td><div class="t-main">${esc(u.full_name)}</div><div class="t-sub">${esc(u.email)}</div></td>
        <td><span class="id-chip">${esc(u.uid)}</span></td>
        <td>${roleBadge(u.role)}</td>
        <td class="t-sub">${esc(u.level_name || u.designation || '—')}${u.semester_name ? `<br>${esc(u.semester_name)}` : ''}</td>
        <td>${statusBadge(u.status)}${u.must_change_password ? ' <span class="badge warn">new password</span>' : ''}</td>
        <td class="t-sub">${u.online ? '<span class="dot-online"></span> online' : (u.last_login ? ago(u.last_login) : 'never')}</td>
        <td class="right"><button class="btn-icon" title="Open">›</button></td>
      </tr>`).join(''),
      { emptyText: 'No accounts match this filter', emptyIcon: '👥' });
  },

  /* ----------------------- create account ------------------------ */
  async createModal(onDone) {
    const [{ levels }, { permissions }] = await Promise.all([
      API.get('/api/academics/structure'),
      API.get('/api/users/meta/permissions'),
    ]);
    const year = new Date().getFullYear();
    const groups = [...new Set(permissions.map((p) => p.group))];

    const m = modal({
      title: 'Create a user account',
      size: 'wide',
      body: `
        <div class="alert alert-info">The system issues the ID automatically — <b>LSL/ADM/${year}/00001</b> style for staff,
          <b>LSL/STU/&lt;admission year&gt;/00001</b> for students.</div>
        <fieldset><legend>Role</legend>
          <div class="field-row">
            <div class="field">
              <label class="label" for="role">Account type</label>
              <select class="select" id="role">
                <option value="STUDENT">Student</option>
                <option value="TUTOR">Tutor</option>
                <option value="ADMIN">Administrative staff</option>
                <option value="DG_CEO">DG / CEO</option>
              </select>
            </div>
            <div class="field" id="desigWrap" style="display:none">
              <label class="label" for="designation">Designation</label>
              <input class="input" id="designation" placeholder="e.g. Exams Officer, Registrar">
            </div>
          </div>
        </fieldset>

        <fieldset><legend>Identity</legend>
          <div class="field-row">
            <div class="field"><label class="label" for="full_name">Full name</label>
              <input class="input" id="full_name" placeholder="Surname First Middle"></div>
            <div class="field"><label class="label" for="email">Email address</label>
              <input class="input" id="email" type="email" placeholder="name@lisaanlab.com"></div>
          </div>
          <div class="field-row-3">
            <div class="field"><label class="label" for="phone">Phone</label><input class="input" id="phone" placeholder="Optional"></div>
            <div class="field"><label class="label" for="gender">Gender</label>
              <select class="select" id="gender"><option value="">—</option><option>Male</option><option>Female</option></select></div>
            <div class="field"><label class="label" for="passport">Passport photograph</label>
              <input class="input" id="passport" type="file" accept="image/png,image/jpeg,image/webp"></div>
          </div>
          <div id="pp" class="flex" style="display:none;gap:12px;align-items:center;margin-top:-4px">
            <img id="ppImg" class="avatar lg" alt="">
            <div class="hint">This photograph appears on the dashboard and ID card.</div>
          </div>
        </fieldset>

        <fieldset id="academicWrap"><legend>Academic placement</legend>
          <div class="field-row-3">
            <div class="field"><label class="label" for="level_id">Level</label>
              <select class="select" id="level_id">${levels.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select></div>
            <div class="field"><label class="label" for="semester_id">Semester</label><select class="select" id="semester_id"></select></div>
            <div class="field"><label class="label" for="admission_year">Year of admission</label>
              <input class="input" id="admission_year" type="number" value="${year}" min="2000" max="2100"></div>
          </div>
        </fieldset>

        <fieldset><legend>Access</legend>
          ${pwField('password', 'Initial password', 'Leave blank to generate one', 'The user must change it at first sign-in.')}
          <div id="permWrap" style="display:none">
            <div class="hint" style="margin-bottom:8px">Toggle the privileges this account carries. You can change them at any time.</div>
            <div id="permList">
              ${groups.map((g) => `<div class="perm-group">${esc(g)}</div>` +
                permissions.filter((p) => p.group === g).map((p) => `
                  <label class="perm">
                    <div class="tx"><b>${esc(p.label)}</b><small>${esc(p.hint)}</small></div>
                    <span class="switch"><input type="checkbox" data-perm="${p.key}"><span class="slider"></span></span>
                  </label>`).join('')).join('')}
            </div>
          </div>
        </fieldset>`,
      actions: [
        { label: 'Cancel' },
        {
          label: 'Create account', kind: 'btn', busyLabel: 'Creating…', close: false,
          onClick: async ({ root, close }) => {
            const f = new FormData();
            const role = root.querySelector('#role').value;
            const perms = {};
            root.querySelectorAll('[data-perm]').forEach((c) => { if (c.checked) perms[c.dataset.perm] = true; });
            f.append('role', role);
            ['full_name', 'email', 'phone', 'gender', 'designation', 'password'].forEach((k) => {
              const v = root.querySelector('#' + k);
              if (v && v.value.trim()) f.append(k, v.value.trim());
            });
            if (role === 'STUDENT') {
              f.append('level_id', root.querySelector('#level_id').value);
              f.append('semester_id', root.querySelector('#semester_id').value);
              f.append('admission_year', root.querySelector('#admission_year').value);
            }
            if (['ADMIN', 'DG_CEO'].includes(role)) f.append('permissions', JSON.stringify(perms));
            const file = root.querySelector('#passport').files[0];
            if (file) f.append('passport', file);

            const res = await API.upload('/api/users', f);
            close();
            V.users.credentialsModal(res.user, res.initial_password);
            if (onDone) onDone();
          },
        },
      ],
      onMount: ({ root }) => {
        const roleSel = root.querySelector('#role');
        const semSel = root.querySelector('#semester_id');
        const levelSel = root.querySelector('#level_id');
        const fillSems = () => {
          const lvl = levels.find((l) => String(l.id) === levelSel.value);
          semSel.innerHTML = (lvl ? lvl.semesters : []).map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
        };
        const sync = () => {
          const r = roleSel.value;
          root.querySelector('#academicWrap').style.display = r === 'STUDENT' ? '' : 'none';
          root.querySelector('#desigWrap').style.display = ['ADMIN', 'DG_CEO'].includes(r) ? '' : 'none';
          root.querySelector('#permWrap').style.display = ['ADMIN', 'DG_CEO'].includes(r) ? '' : 'none';
          if (r === 'DG_CEO') {
            root.querySelectorAll('[data-perm]').forEach((c) => {
              c.checked = c.dataset.perm !== 'users.create';
              c.disabled = c.dataset.perm === 'users.create';
            });
            root.querySelector('#designation').value = root.querySelector('#designation').value || 'Director General / CEO';
          } else {
            root.querySelectorAll('[data-perm]').forEach((c) => { c.disabled = false; });
          }
        };
        levelSel.addEventListener('change', fillSems);
        roleSel.addEventListener('change', sync);
        fillSems(); sync();

        root.querySelector('#passport').addEventListener('change', (e) => {
          const f = e.target.files[0];
          if (!f) return;
          const url = URL.createObjectURL(f);
          root.querySelector('#ppImg').src = url;
          root.querySelector('#pp').style.display = 'flex';
        });
      },
    });
    return m;
  },

  credentialsModal(user, password) {
    modal({
      title: 'Account created',
      body: `
        <div class="alert alert-ok">Hand these credentials to <b>${esc(user.full_name)}</b>. The password must be changed at first sign-in.</div>
        <div class="flex" style="gap:14px;margin-bottom:16px">${avatar(user, 'lg')}
          <div><div class="t-main" style="font-size:1.05rem">${esc(user.full_name)}</div>
          <div class="t-sub">${esc(roleLabel(user.role))}${user.level_name ? ' · ' + esc(user.level_name) : ''}</div></div></div>
        <div class="stat-line"><span class="l">${user.role === 'STUDENT' ? 'Student ID' : 'Staff ID'}</span>
          <span class="r"><span class="id-chip">${esc(user.uid)}</span> <button class="copy" data-copy="${esc(user.uid)}">Copy</button></span></div>
        <div class="stat-line"><span class="l">Login email</span>
          <span class="r">${esc(user.email)} <button class="copy" data-copy="${esc(user.email)}">Copy</button></span></div>
        <div class="stat-line"><span class="l">Temporary password</span>
          <span class="r"><span class="id-chip">${esc(password)}</span> <button class="copy" data-copy="${esc(password)}">Copy</button></span></div>`,
      actions: [{ label: 'Done', kind: 'btn' }],
    });
  },

  /* ------------------------ profile drawer ----------------------- */
  async profileModal(id, onDone) {
    const [{ user, courses, online }, { permissions }] = await Promise.all([
      API.get('/api/users/' + id),
      API.get('/api/users/meta/permissions'),
    ]);
    const groups = [...new Set(permissions.map((p) => p.group))];
    const isSuper = user.role === 'SUPER_ADMIN';
    const editable = S.me.role === 'SUPER_ADMIN' && !isSuper;
    const showPerms = ['ADMIN', 'DG_CEO', 'SUPER_ADMIN'].includes(user.role);

    modal({
      title: user.full_name,
      size: 'wide',
      body: `
        <div class="flex" style="gap:17px;align-items:flex-start;margin-bottom:17px">
          ${avatar(user, 'xl')}
          <div style="flex:1;min-width:0">
            <div class="flex flex-wrap" style="gap:8px;margin-bottom:7px">${roleBadge(user.role)}${statusBadge(user.status)}
              ${online ? '<span class="badge ok"><span class="dot-online"></span> online</span>' : ''}</div>
            <div class="stat-line"><span class="l">${user.role === 'STUDENT' ? 'Student ID' : 'Staff ID'}</span>
              <span class="r"><span class="id-chip">${esc(user.uid)}</span></span></div>
            <div class="stat-line"><span class="l">Email</span><span class="r">${esc(user.email)}</span></div>
            ${user.phone ? `<div class="stat-line"><span class="l">Phone</span><span class="r">${esc(user.phone)}</span></div>` : ''}
            ${user.designation ? `<div class="stat-line"><span class="l">Designation</span><span class="r">${esc(user.designation)}</span></div>` : ''}
            ${user.level_name ? `<div class="stat-line"><span class="l">Placement</span><span class="r">${esc(user.level_name)} · ${esc(user.semester_name || '')}</span></div>` : ''}
            ${user.admission_year ? `<div class="stat-line"><span class="l">Admitted</span><span class="r">${user.admission_year}</span></div>` : ''}
            <div class="stat-line"><span class="l">Created</span><span class="r">${fmtDT(user.created_at)}</span></div>
            <div class="stat-line"><span class="l">Last sign-in</span><span class="r">${user.last_login ? fmtDT(user.last_login) : 'Never'} · ${user.login_count} logins</span></div>
          </div>
        </div>
        ${courses && courses.length ? `<fieldset><legend>${user.role === 'TUTOR' ? 'Courses taught' : 'Courses enrolled'}</legend>
          <div class="flex flex-wrap">${courses.map((c) => `<span class="badge brand">${esc(c.code)}</span>`).join('')}</div></fieldset>` : ''}
        ${showPerms ? `<fieldset><legend>Roles, privileges & access</legend>
          ${isSuper ? '<div class="alert alert-info">The Super Administrator holds every privilege permanently.</div>' : ''}
          ${!editable && !isSuper ? '<div class="alert alert-warn">Only the Super Administrator can change privileges.</div>' : ''}
          ${user.role === 'DG_CEO' ? '<div class="alert alert-info">The DG/CEO carries the same authority as the Super Administrator <b>except creating user accounts</b>, which stays locked.</div>' : ''}
          <div id="permBox">
            ${groups.map((g) => `<div class="perm-group">${esc(g)}</div>` +
              permissions.filter((p) => p.group === g).map((p) => {
                const locked = isSuper || !editable || (user.role === 'DG_CEO' && p.key === 'users.create');
                const on = isSuper ? true : !!user.permissions[p.key];
                return `<label class="perm">
                  <div class="tx"><b>${esc(p.label)}</b><small>${esc(p.hint)}</small></div>
                  <span class="switch"><input type="checkbox" data-perm="${p.key}" ${on ? 'checked' : ''} ${locked ? 'disabled' : ''}><span class="slider"></span></span>
                </label>`;
              }).join('')).join('')}
          </div></fieldset>` : ''}`,
      actions: [
        { label: 'Close' },
        ...(user.role === 'STUDENT' && can('academics.manage') ? [{ label: 'Change placement', kind: 'btn-ghost', close: false, onClick: () => V.users.placementModal(user, onDone) }] : []),
        ...(can('users.reset_password') && !isSuper ? [{ label: 'Reset password', kind: 'btn-accent', close: false, onClick: () => V.users.resetModal(user) }] : []),
        ...(can('users.suspend') && !isSuper ? [{
          label: user.status === 'ACTIVE' ? 'Suspend' : 'Restore', kind: user.status === 'ACTIVE' ? 'btn-danger' : 'btn-ok',
          onClick: async () => {
            await API.post(`/api/users/${user.id}/status`, { status: user.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' });
            toast(`${user.full_name} ${user.status === 'ACTIVE' ? 'suspended' : 'restored'}`, 'ok');
            if (onDone) onDone();
          },
        }] : []),
      ],
      onMount: ({ root }) => {
        root.querySelectorAll('[data-perm]:not([disabled])').forEach((cb) => {
          cb.addEventListener('change', async () => {
            try {
              await API.post(`/api/users/${user.id}/permissions`, { key: cb.dataset.perm, enabled: cb.checked });
              toast(`${cb.dataset.perm} ${cb.checked ? 'granted' : 'revoked'}`, 'ok', user.full_name);
            } catch (e) { cb.checked = !cb.checked; toast(e.message, 'danger'); }
          });
        });
      },
    });
  },

  resetModal(user) {
    modal({
      title: 'Reset password',
      body: `<div class="alert alert-warn">This signs <b>${esc(user.full_name)}</b> out everywhere and forces a new password at next sign-in.</div>
        ${pwField('newpw', 'New password', 'Leave blank to generate one', 'Minimum 8 characters with at least one letter and one number.')}`,
      actions: [
        { label: 'Cancel' },
        {
          label: 'Reset password', kind: 'btn-danger', busyLabel: 'Resetting…', close: false,
          onClick: async ({ root, close }) => {
            const pw = root.querySelector('#newpw').value.trim();
            const r = await API.post(`/api/users/${user.id}/reset-password`, pw ? { password: pw } : {});
            close();
            modal({
              title: 'Password reset',
              body: `<div class="alert alert-ok">Give this password to ${esc(r.full_name)} (${esc(r.uid)}).</div>
                <div class="stat-line"><span class="l">New password</span><span class="r"><span class="id-chip">${esc(r.new_password)}</span>
                  <button class="copy" data-copy="${esc(r.new_password)}">Copy</button></span></div>`,
              actions: [{ label: 'Done', kind: 'btn' }],
            });
          },
        },
      ],
    });
  },

  async placementModal(user, onDone) {
    const { levels } = await API.get('/api/academics/structure');
    modal({
      title: 'Change placement — ' + user.full_name,
      body: `<div class="field-row">
        <div class="field"><label class="label" for="plLevel">Level</label>
          <select class="select" id="plLevel">${levels.map((l) => `<option value="${l.id}" ${l.id === user.level_id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div>
        <div class="field"><label class="label" for="plSem">Semester</label><select class="select" id="plSem"></select></div>
      </div>`,
      actions: [
        { label: 'Cancel' },
        {
          label: 'Save placement', kind: 'btn', close: false,
          onClick: async ({ root, close }) => {
            await API.post(`/api/academics/students/${user.id}/placement`, {
              level_id: Number(root.querySelector('#plLevel').value),
              semester_id: Number(root.querySelector('#plSem').value),
            });
            toast('Placement updated', 'ok');
            close();
            if (onDone) onDone();
          },
        },
      ],
      onMount: ({ root }) => {
        const lv = root.querySelector('#plLevel'), sm = root.querySelector('#plSem');
        const fill = () => {
          const l = levels.find((x) => String(x.id) === lv.value);
          sm.innerHTML = (l ? l.semesters : []).map((s) => `<option value="${s.id}" ${s.id === user.semester_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
        };
        lv.addEventListener('change', fill); fill();
      },
    });
  },
};

/* ======================= ACADEMIC STRUCTURE ======================== */
V.academics = {
  title: 'Academic structure',
  sub: 'Three levels · four semesters each · courses and enrolment',
  async mount(el) {
    const load = async () => {
      const [{ levels }, { courses }, { users }] = await Promise.all([
        API.get('/api/academics/structure'),
        API.get('/api/academics/courses'),
        can('academics.manage') ? API.get('/api/users?role=TUTOR') : Promise.resolve({ users: [] }),
      ]);
      V.academics._tutors = users;
      el.innerHTML = `
        <div class="grid grid-3" style="margin-bottom:18px">
          ${levels.map((l) => kpi(l.name, l.students, `${l.courses} courses · 4 semesters`, l.code === 'BEG' ? '' : l.code === 'INT' ? 'accent' : 'ok')).join('')}
        </div>
        ${levels.map((l) => `
          <section class="card">
            <div class="card-head">
              <h3>${esc(l.name)} <span class="badge brand">${esc(l.code)}</span>
                <div class="card-sub">${l.students} students · ${l.courses} courses</div></h3>
            </div>
            ${l.semesters.map((s) => {
              const list = courses.filter((c) => c.semester_id === s.id);
              return `<div style="margin-bottom:15px">
                <div class="flex" style="margin-bottom:8px">
                  <b style="color:var(--brand)">${esc(s.name)}</b>
                  <span class="badge">${list.length} course${list.length === 1 ? '' : 's'}</span>
                  <div class="spacer"></div>
                  ${can('academics.manage') ? `
                    <button class="btn btn-sm btn-ghost" data-newcourse="${s.id}" data-level="${l.id}">＋ Course</button>
                    <button class="btn btn-sm btn-ghost" data-autoenroll="${s.id}" title="Enrol every ${esc(l.name)} student into all courses of this semester">⇄ Auto-enrol</button>` : ''}
                </div>
                ${table([{ label: 'Code' }, { label: 'Title' }, { label: 'Tutor' }, { label: 'Units', cls: 'num' },
                         { label: 'Students', cls: 'num' }, { label: 'Papers', cls: 'num' }, { label: '' }],
                  list.map((c) => `<tr>
                    <td><span class="id-chip">${esc(c.code)}</span>${c.live_sessions ? ' <span class="badge live">live</span>' : ''}</td>
                    <td class="t-main">${esc(c.title)}</td>
                    <td>${c.tutor_name ? `<div class="t-main" style="font-size:.84rem">${esc(c.tutor_name)}</div><div class="t-sub">${esc(c.tutor_uid || '')}</div>` : '<span class="badge warn">unassigned</span>'}</td>
                    <td class="num">${c.credit_units}</td>
                    <td class="num">${c.student_count}</td>
                    <td class="num">${c.assessment_count}</td>
                    <td class="right nowrap">
                      ${can('academics.manage') ? `
                        <button class="btn-icon" data-roster="${c.id}" title="Manage students">👥</button>
                        <button class="btn-icon" data-editcourse="${c.id}" title="Edit">✎</button>
                        <button class="btn-icon" data-delcourse="${c.id}" title="Delete">🗑</button>` : ''}
                    </td></tr>`).join(''),
                  { emptyText: 'No courses in this semester yet', emptyIcon: '📚' })}
              </div>`;
            }).join('')}
          </section>`).join('')}`;

      el.querySelectorAll('[data-newcourse]').forEach((b) => b.addEventListener('click', () =>
        V.academics.courseModal({ level_id: Number(b.dataset.level), semester_id: Number(b.dataset.newcourse) }, levels, load)));
      el.querySelectorAll('[data-editcourse]').forEach((b) => b.addEventListener('click', () =>
        V.academics.courseModal(courses.find((c) => c.id === Number(b.dataset.editcourse)), levels, load)));
      el.querySelectorAll('[data-roster]').forEach((b) => b.addEventListener('click', () => V.academics.rosterModal(Number(b.dataset.roster), load)));
      el.querySelectorAll('[data-delcourse]').forEach((b) => b.addEventListener('click', () => {
        const c = courses.find((x) => x.id === Number(b.dataset.delcourse));
        confirmDialog({
          title: 'Delete course', danger: true, confirmLabel: 'Delete ' + c.code,
          message: `Delete <b>${esc(c.code)} — ${esc(c.title)}</b>? Its enrolments, registers and assessments are removed with it.`,
          onConfirm: async () => { await API.del('/api/academics/courses/' + c.id); toast('Course deleted', 'ok'); load(); },
        });
      }));
      el.querySelectorAll('[data-autoenroll]').forEach((b) => b.addEventListener('click', () => {
        confirmDialog({
          title: 'Auto-enrol semester', confirmLabel: 'Enrol all',
          message: 'Every active student at this level will be enrolled into every course of this semester. Existing enrolments are untouched.',
          onConfirm: async () => {
            const r = await API.post(`/api/academics/semesters/${b.dataset.autoenroll}/auto-enroll`, {});
            toast(`${r.added} enrolment${r.added === 1 ? '' : 's'} created`, 'ok');
            load();
          },
        });
      }));
    };
    await load();
    ['course:created', 'course:updated', 'course:deleted', 'academics:changed'].forEach((ev) => onView(ev, debounce(load, 600)));
  },

  courseModal(course, levels, onDone) {
    const editing = course && course.id;
    const tutors = V.academics._tutors || [];
    modal({
      title: editing ? `Edit ${course.code}` : 'New course',
      body: `
        <div class="field-row">
          <div class="field"><label class="label" for="ccode">Course code</label>
            <input class="input" id="ccode" value="${esc(course.code || '')}" placeholder="ARB101" ${editing ? 'disabled' : ''}></div>
          <div class="field"><label class="label" for="cunits">Credit units</label>
            <input class="input" id="cunits" type="number" min="1" max="12" value="${course.credit_units || 2}"></div>
        </div>
        <div class="field"><label class="label" for="ctitle">Course title</label>
          <input class="input" id="ctitle" value="${esc(course.title || '')}" placeholder="Introduction to Arabic Morphology"></div>
        <div class="field-row">
          <div class="field"><label class="label" for="clevel">Level</label>
            <select class="select" id="clevel">${levels.map((l) => `<option value="${l.id}" ${l.id === course.level_id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div>
          <div class="field"><label class="label" for="csem">Semester</label><select class="select" id="csem"></select></div>
        </div>
        <div class="field"><label class="label" for="ctutor">Assigned tutor</label>
          <select class="select" id="ctutor"><option value="">— Not assigned —</option>
            ${tutors.map((t) => `<option value="${t.id}" ${t.id === course.tutor_id ? 'selected' : ''}>${esc(t.full_name)} (${esc(t.uid)})</option>`).join('')}</select>
          <div class="hint">The tutor publishes attendance and assessments for this course.</div></div>`,
      actions: [
        { label: 'Cancel' },
        {
          label: editing ? 'Save changes' : 'Create course', kind: 'btn', close: false,
          onClick: async ({ root, close }) => {
            const body = {
              code: root.querySelector('#ccode').value.trim().toUpperCase(),
              title: root.querySelector('#ctitle').value.trim(),
              credit_units: Number(root.querySelector('#cunits').value),
              level_id: Number(root.querySelector('#clevel').value),
              semester_id: Number(root.querySelector('#csem').value),
              tutor_id: root.querySelector('#ctutor').value ? Number(root.querySelector('#ctutor').value) : null,
            };
            if (editing) await API.patch('/api/academics/courses/' + course.id, body);
            else await API.post('/api/academics/courses', body);
            toast(editing ? 'Course updated' : 'Course created', 'ok');
            close();
            onDone();
          },
        },
      ],
      onMount: ({ root }) => {
        const lv = root.querySelector('#clevel'), sm = root.querySelector('#csem');
        const fill = () => {
          const l = levels.find((x) => String(x.id) === lv.value);
          sm.innerHTML = (l ? l.semesters : []).map((s) => `<option value="${s.id}" ${s.id === course.semester_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
        };
        lv.addEventListener('change', fill); fill();
      },
    });
  },

  async rosterModal(courseId, onDone) {
    const [{ course, students }, { users }] = await Promise.all([
      API.get(`/api/academics/courses/${courseId}/students`),
      API.get('/api/users?role=STUDENT'),
    ]);
    const enrolledIds = new Set(students.map((s) => s.id));
    const available = users.filter((u) => !enrolledIds.has(u.id));
    modal({
      title: `${course.code} — enrolment`,
      size: 'wide',
      body: `
        <div class="grid grid-2">
          <div>
            <div class="perm-group">Enrolled (${students.length})</div>
            <div style="max-height:330px;overflow:auto">
              ${students.length ? students.map((s) => `
                <div class="flex" style="padding:7px 0;border-bottom:1px solid #f0f0f4">
                  ${avatar(s, 'sm')}<div style="flex:1;min-width:0"><div class="t-main" style="font-size:.84rem">${esc(s.full_name)}</div>
                  <div class="t-sub">${esc(s.uid)}</div></div>
                  <button class="btn-icon" data-unenroll="${s.id}" title="Remove">✕</button></div>`).join('')
                : '<div class="empty">No student enrolled yet</div>'}
            </div>
          </div>
          <div>
            <div class="perm-group">Available students (${available.length})</div>
            <input class="input" id="rsearch" placeholder="Filter…" style="margin-bottom:8px">
            <div style="max-height:300px;overflow:auto" id="availBox">
              ${available.length ? available.map((s) => `
                <label class="flex" data-name="${esc((s.full_name + ' ' + s.uid).toLowerCase())}" style="padding:7px 0;border-bottom:1px solid #f0f0f4;cursor:pointer">
                  <input type="checkbox" value="${s.id}" style="width:17px;height:17px;accent-color:var(--brand)">
                  ${avatar(s, 'sm')}<div style="flex:1;min-width:0"><div class="t-main" style="font-size:.84rem">${esc(s.full_name)}</div>
                  <div class="t-sub">${esc(s.uid)} · ${esc(s.level_name || '—')}</div></div></label>`).join('')
                : '<div class="empty">Every student is already enrolled</div>'}
            </div>
          </div>
        </div>`,
      actions: [
        { label: 'Close' },
        {
          label: 'Enrol selected', kind: 'btn', close: false,
          onClick: async ({ root, close }) => {
            const ids = [...root.querySelectorAll('#availBox input:checked')].map((c) => Number(c.value));
            if (!ids.length) { toast('Select at least one student', 'warn'); return false; }
            const r = await API.post(`/api/academics/courses/${courseId}/enroll`, { student_ids: ids });
            toast(`${r.added} student${r.added === 1 ? '' : 's'} enrolled`, 'ok');
            close(); onDone();
          },
        },
      ],
      onMount: ({ root, close }) => {
        root.querySelector('#rsearch').addEventListener('input', (e) => {
          const q = e.target.value.toLowerCase();
          root.querySelectorAll('#availBox [data-name]').forEach((n) => { n.style.display = n.dataset.name.includes(q) ? '' : 'none'; });
        });
        root.querySelectorAll('[data-unenroll]').forEach((b) => b.addEventListener('click', async () => {
          await API.del(`/api/academics/courses/${courseId}/enroll/${b.dataset.unenroll}`);
          toast('Student removed from course', 'ok');
          close(); onDone();
        }));
      },
    });
  },
};
