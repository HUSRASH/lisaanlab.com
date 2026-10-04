'use strict';
/* Lisaan Lab LMS — shell, navigation and router */

let viewCleanups = [];
function onView(ev, fn) { viewCleanups.push(bus.on(ev, fn)); }
function clearView() { viewCleanups.forEach((off) => off()); viewCleanups = []; }
function go(route) { location.hash = '#/' + route; }

const NAV = {
  admin: [
    { group: 'Oversight' },
    { route: 'dashboard', icon: '◉', label: 'Dashboard', view: () => V.adminDashboard, show: () => can('reports.view') || isAdminish() },
    { route: 'users', icon: '👥', label: 'User accounts', view: () => V.users, show: () => can('users.create') || can('users.edit') || can('reports.view') },
    { route: 'academics', icon: '📚', label: 'Academics', view: () => V.academics, show: () => can('academics.manage') || can('reports.view') },
    { group: 'Operations' },
    { route: 'attendance', icon: '🗒', label: 'Attendance', view: () => V.adminAttendance, show: () => can('attendance.view') },
    { route: 'exams', icon: '📝', label: 'Examinations', view: () => V.adminAssessments, show: () => can('assessments.view') || can('assessments.approve') },
    { route: 'results', icon: '🎓', label: 'Results', view: () => V.results, show: () => can('results.publish') },
    { group: 'Institution' },
    { route: 'vault', icon: '🗄', label: 'Storage vault', view: () => V.vault, show: () => S.me.role === 'SUPER_ADMIN' || S.me.role === 'DG_CEO' || can('vault.access') },
    { route: 'audit', icon: '📜', label: 'Audit trail', view: () => V.audit, show: () => can('audit.view') },
    { route: 'system', icon: '⚙', label: 'System', view: () => V.system, show: () => can('system.backup') || can('system.reset') || S.me.role === 'SUPER_ADMIN' },
    { route: 'profile', icon: '🪪', label: 'My profile', view: () => V.profile },
  ],
  TUTOR: [
    { group: 'Teaching' },
    { route: 'dashboard', icon: '◉', label: 'Dashboard', view: () => V.tutorDashboard },
    { route: 'courses', icon: '📚', label: 'My courses', view: () => V.tutorCourses },
    { route: 'attendance', icon: '🗒', label: 'Attendance', view: () => V.tutorAttendance },
    { route: 'assessments', icon: '📝', label: 'Assessments', view: () => V.tutorAssessments },
    { group: 'Account' },
    { route: 'profile', icon: '🪪', label: 'My profile', view: () => V.profile },
  ],
  STUDENT: [
    { group: 'Learning' },
    { route: 'dashboard', icon: '◉', label: 'Dashboard', view: () => V.studentDashboard },
    { route: 'courses', icon: '📚', label: 'My courses', view: () => V.studentCourses },
    { route: 'attendance', icon: '🗒', label: 'My attendance', view: () => V.studentAttendance },
    { route: 'assessments', icon: '📝', label: 'Tests & exams', view: () => V.studentAssessments },
    { route: 'results', icon: '🎓', label: 'Results', view: () => V.studentResults },
    { group: 'Account' },
    { route: 'profile', icon: '🪪', label: 'My profile', view: () => V.profile },
  ],
};

function navItems() {
  const list = isAdminish() ? NAV.admin : NAV[S.me.role] || [];
  return list.filter((i) => i.group || !i.show || i.show());
}

function buildNav() {
  const nav = document.getElementById('nav');
  nav.innerHTML = navItems().map((i) => i.group
    ? `<div class="sb-group">${esc(i.group)}</div>`
    : `<a class="sb-link" href="#/${i.route}" data-route="${i.route}">
         <span class="ico">${i.icon}</span><span>${esc(i.label)}</span>
         <span class="count hidden" data-count="${i.route}"></span></a>`).join('');
  nav.querySelectorAll('.sb-link').forEach((a) => a.addEventListener('click', () => document.getElementById('sidebar').classList.remove('open')));
}

function paintIdentity() {
  document.getElementById('sbName').textContent = S.me.full_name;
  document.getElementById('sbId').textContent = S.me.uid;
  document.getElementById('sbRole').textContent = roleLabel(S.me.role);
  const av = document.getElementById('sbAvatar');
  av.outerHTML = avatar(S.me, 'sm').replace('class="avatar sm"', 'class="avatar sm" id="sbAvatar"');
}

async function route() {
  const hash = (location.hash || '#/dashboard').replace(/^#\//, '') || 'dashboard';
  const items = navItems().filter((i) => !i.group);
  const item = items.find((i) => i.route === hash) || items[0];
  if (!item) return;

  clearView();
  document.querySelectorAll('.sb-link').forEach((a) => a.classList.toggle('active', a.dataset.route === item.route));
  const view = item.view();
  document.getElementById('pageTitle').textContent = view.title || item.label;
  document.getElementById('pageSub').textContent = view.sub || '';
  const el = document.getElementById('view');
  el.innerHTML = '<div class="loader"><span class="spin"></span> Loading…</div>';
  try { await view.mount(el); }
  catch (e) {
    el.innerHTML = `<div class="card"><div class="alert alert-danger view-error">${esc(e.message)}</div>
      <button class="btn btn-ghost" onclick="location.reload()">Reload</button></div>`;
  }
}

/* ------------------------- notifications -------------------------- */
async function loadNotifications(open) {
  const d = await API.get('/api/system/notifications');
  S.unread = d.unread;
  const b = document.getElementById('bellCount');
  b.textContent = d.unread;
  b.classList.toggle('hidden', !d.unread);
  if (!open) return;
  modal({
    title: 'Notifications',
    body: d.notifications.length ? d.notifications.map((nt) => `
      <div class="feed-item">
        <span class="ic">${nt.kind === 'success' ? '✓' : nt.kind === 'danger' ? '!' : nt.kind === 'warning' ? '⚠' : 'ℹ'}</span>
        <div class="tx"><b>${esc(nt.title)}</b><div class="t-sub">${esc(nt.body || '')}</div></div>
        <span class="tm">${ago(nt.created_at)}</span></div>`).join('')
      : '<div class="empty"><span class="big">🔔</span>Nothing yet</div>',
    actions: [{ label: 'Mark all read', kind: 'btn', onClick: async () => { await API.post('/api/system/notifications/read', {}); loadNotifications(false); } }],
  });
}

/* ------------------------------ boot ------------------------------ */
(async function boot() {
  let me;
  try { me = await API.get('/api/auth/me'); }
  catch { location.href = '/'; return; }

  S.me = me.user;
  paintIdentity();
  connectWS();

  if (me.must_change_password) {
    document.getElementById('view').innerHTML =
      '<div class="card"><div class="alert alert-warn">Set a new password to continue.</div></div>';
    document.getElementById('pageTitle').textContent = 'Security';
    document.getElementById('pageSub').textContent = 'First sign-in — password change required';
    V.changePasswordModal(true);
    return;
  }

  buildNav();
  await route();
  loadNotifications(false);

  window.addEventListener('hashchange', route);
  document.getElementById('refreshBtn').addEventListener('click', route);
  document.getElementById('bellBtn').addEventListener('click', () => loadNotifications(true));
  document.getElementById('burger').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('scrim').classList.toggle('show');
  });
  document.getElementById('scrim').addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('scrim').classList.remove('show');
  });
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await API.post('/api/auth/logout', {});
    location.href = '/';
  });

  /* Global real-time reactions outside the active view */
  bus.on('notification:new', (nt) => { toast(nt.body || '', nt.kind === 'danger' ? 'danger' : nt.kind === 'warning' ? 'warn' : 'ok', nt.title); loadNotifications(false); });
  bus.on('attendance:session_opened', (d) => {
    if (S.me.role === 'STUDENT') toast(`${d.session.course_code} — ${d.session.topic}`, 'warn', 'Attendance register is open');
  });
  bus.on('assessment:published', (d) => {
    if (S.me.role === 'STUDENT') toast(`${d.assessment.course_code} — ${d.assessment.title}`, 'warn', 'A paper is now live');
  });
  bus.on('permissions:updated', (d) => {
    S.me.permissions = d.permissions;
    buildNav();
    toast('Your privileges were updated by the Super Administrator', 'warn');
    route();
  });
  bus.on('profile:updated', (d) => { S.me = { ...S.me, ...d.user }; paintIdentity(); });
  bus.on('system:reset', () => { toast('The system was reset by the Super Administrator', 'danger'); setTimeout(() => location.reload(), 1800); });

  /* Live counters in the sidebar */
  const refreshCounts = debounce(async () => {
    try {
      const d = await API.get('/api/system/dashboard');
      const set = (route2, n) => {
        const el = document.querySelector(`[data-count="${route2}"]`);
        if (!el) return;
        el.textContent = n;
        el.classList.toggle('hidden', !n);
      };
      if (isAdminish()) {
        set('attendance', d.kpis.live_sessions);
        set('exams', d.kpis.pending_approvals);
      } else if (S.me.role === 'STUDENT') {
        set('attendance', d.kpis.live_now);
        set('assessments', (d.live_assessments || []).filter((a) => !a.my_submission_id).length);
      } else if (S.me.role === 'TUTOR') {
        set('attendance', d.kpis.live_sessions);
      }
    } catch {}
  }, 500);
  refreshCounts();
  ['attendance:session_opened', 'attendance:session_closed', 'assessment:published', 'assessment:changed',
   'assessment:closed', 'submission:mine', 'submission:received'].forEach((ev) => bus.on(ev, refreshCounts));
})();
