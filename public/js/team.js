// Team Management tab — user CRUD moved out of the old /admin page and into
// the main app. Same server routes (/api/team/*) so the auth model doesn't
// shift. The right-side drawer implements the Add/Edit User flow including:
//   • Basic Info / Role / Permissions / Repository Access / Notifications
//   • Availability (Employee role only)
//   • Assigned Tasks / Features (Employee role only)

import { PERMISSIONS, ROLE_DISPLAY_NAMES, ROLE_PERMISSIONS, defaultPermissionsFor } from '../../shared/permissions.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);

let state = {
  me: null,
  users: [],
  roles: [],
  repositories: [],
  roadmapItems: [],    // loaded once per drawer open for Employee role
  emailEnabled: false,
  filters: { q: '', role: '', department: '', status: '' },
  editing: null,
  permsCustom: false,
  permsSelected: new Set(),
  availabilityMap: {},  // userId -> [record, ...]
};

// ---- Public API ----

export function initTeam({ me, repositories, emailEnabled }) {
  state.me = me;
  state.repositories = repositories || [];
  state.emailEnabled = Boolean(emailEnabled);
  const inviteRow = $('ud-send-invite-row');
  const passwordHint = $('ud-password-hint');
  if (inviteRow) inviteRow.style.display = state.emailEnabled ? '' : 'none';
  if (passwordHint) {
    passwordHint.textContent = state.emailEnabled
      ? '(leave blank when sending invite — user picks their own)'
      : '(email delivery is off — set a temp password and hand it over)';
  }
  wireFilters();
  wireDrawer();
  wireAvailDrawer();
  $('btn-team-add').addEventListener('click', () => openDrawer(null));
}

export async function refreshTeam() {
  try {
    const [usersResp, availResp] = await Promise.all([
      fetch('/api/team/users').then(r => r.json()),
      fetch('/api/availability').then(r => r.json()).catch(() => ({ records: [] })),
    ]);
    state.users = usersResp.users || [];
    state.roles = usersResp.roles || [];

    state.availabilityMap = {};
    for (const rec of (availResp.records || [])) {
      if (!state.availabilityMap[rec.userId]) state.availabilityMap[rec.userId] = [];
      state.availabilityMap[rec.userId].push(rec);
    }

    populateFilterOptions();
    renderTable();
  } catch {
    $('team-table-wrap').innerHTML = errorState('Failed to load users. You may not have permission to see this tab.');
  }
}

// ---- Filters ----

function wireFilters() {
  const bind = (id, key) => $(id).addEventListener('input', e => {
    state.filters[key] = e.target.value.trim(); renderTable();
  });
  bind('team-search', 'q');
  ['team-filter-role', 'team-filter-department', 'team-filter-status'].forEach(id => {
    $(id).addEventListener('change', e => {
      const key = id.split('-').pop();
      state.filters[key] = e.target.value; renderTable();
    });
  });
}

function populateFilterOptions() {
  const roleSel = $('team-filter-role');
  const depSel  = $('team-filter-department');
  const roles = state.roles.map(r => ROLE_DISPLAY_NAMES[r] || r);
  roleSel.innerHTML = `<option value="">All roles</option>` + state.roles.map((r, i) =>
    `<option value="${esc(r)}"${state.filters.role === r ? ' selected' : ''}>${esc(roles[i])}</option>`).join('');
  const departments = Array.from(new Set(state.users.map(u => u.department).filter(Boolean))).sort();
  depSel.innerHTML = `<option value="">All departments</option>` + departments.map(d =>
    `<option value="${esc(d)}"${state.filters.department === d ? ' selected' : ''}>${esc(d)}</option>`).join('');
}

function applyFilters(users) {
  const q = state.filters.q.toLowerCase();
  return users.filter(u => {
    if (state.filters.role       && u.role !== state.filters.role) return false;
    if (state.filters.department && u.department !== state.filters.department) return false;
    if (state.filters.status === 'active'   && u.disabled) return false;
    if (state.filters.status === 'disabled' && !u.disabled) return false;
    if (q) {
      const hay = `${u.name} ${u.email} ${u.department || ''} ${u.githubLogin || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

// ---- Table ----

function currentAvailability(userId) {
  const records = state.availabilityMap[userId] || [];
  if (!records.length) return null;
  const todayStr = new Date().toISOString().slice(0, 10);
  return records.find(r => r.date === todayStr) ||
    records.slice().sort((a, b) => b.date.localeCompare(a.date))[0] || null;
}

function availBadgeHtml(userId) {
  const rec = currentAvailability(userId);
  if (!rec) return `<span style="font-size:11px;color:var(--ink-400);">—</span>`;
  if (rec.status === 'available') {
    return `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;
      letter-spacing:.04em;text-transform:uppercase;padding:3px 9px;border-radius:999px;
      background:rgba(16,185,129,.12);color:#059669;">
      <span style="width:5px;height:5px;border-radius:50%;background:#10b981;flex-shrink:0;"></span>
      Available</span>`;
  }
  return `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;
    letter-spacing:.04em;text-transform:uppercase;padding:3px 9px;border-radius:999px;
    background:rgba(245,158,11,.12);color:#d97706;">
    <span style="width:5px;height:5px;border-radius:50%;background:#f59e0b;flex-shrink:0;"></span>
    On Leave</span>`;
}

function renderTable() {
  const wrap = $('team-table-wrap');
  const rows = applyFilters(state.users);
  if (!rows.length) { wrap.innerHTML = emptyState('No users match those filters'); return; }

  const hasEmployees = rows.some(u => u.role === 'Employee');
  const availCol = hasEmployees ? `<th>Availability</th>` : '';
  const taskCol  = hasEmployees ? `<th>Tasks</th>` : '';

  wrap.innerHTML = `<table class="admin-table"><thead><tr>
    <th>Member</th><th>Email</th><th>Department</th><th>Role</th>
    <th>Status</th><th>Repositories</th><th>Last Active</th>${availCol}${taskCol}<th style="text-align:right">Actions</th>
  </tr></thead><tbody>
    ${rows.map(u => rowHtml(u, hasEmployees)).join('')}
  </tbody></table>`;
  wireRows(rows, hasEmployees);
  window.lucide?.createIcons();
}

function rowHtml(u, hasEmployees) {
  const ini = (u.name || u.email || '?').split(/\s+/).map(s => s[0]).slice(0, 2).join('').toUpperCase();
  const avatar = u.avatarUrl
    ? `<img class="team-avatar" src="${esc(u.avatarUrl)}" alt="${esc(u.name)}" />`
    : `<span class="team-avatar team-avatar-fallback">${esc(ini)}</span>`;
  const statusPill = u.disabled
    ? `<span class="admin-pill admin-pill-off">Disabled</span>`
    : `<span class="admin-pill admin-pill-on">Active</span>`;
  const repos = (u.repositories || []).length
    ? `<span class="team-repos" title="${esc((u.repositories||[]).join(', '))}">${u.repositories.length}</span>`
    : `<span class="text-ink-400">All</span>`;
  const last = u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : '—';
  const roleLabel = ROLE_DISPLAY_NAMES[u.role] || u.role;
  const isEmployee = u.role === 'Employee';

  const availCell = hasEmployees
    ? `<td>${isEmployee ? availBadgeHtml(u.id) : '<span style="font-size:11px;color:var(--ink-300);">N/A</span>'}</td>`
    : '';

  const taskCount = isEmployee && Array.isArray(u.assignedTasks) ? u.assignedTasks.length : 0;
  const taskCell = hasEmployees
    ? `<td>${isEmployee
        ? `<span style="font-size:11px;font-weight:600;color:${taskCount ? '#6366f1' : 'var(--ink-400)'};">${taskCount ? `${taskCount} task${taskCount > 1 ? 's' : ''}` : '—'}</span>`
        : '<span style="font-size:11px;color:var(--ink-300);">N/A</span>'}</td>`
    : '';

  const availBtn = isEmployee
    ? `<button class="admin-btn" data-act="avail" style="color:#6366f1;">Availability</button>`
    : '';

  return `<tr data-id="${esc(u.id)}">
    <td><div class="team-member">${avatar}<div><div class="team-name">${esc(u.name||'—')}</div>${u.githubLogin?`<div class="team-gh">@${esc(u.githubLogin)}</div>`:''}</div></div></td>
    <td class="mono">${esc(u.email)}</td>
    <td>${esc(u.department||'—')}</td>
    <td>${esc(roleLabel)}</td>
    <td>${statusPill}</td>
    <td>${repos}</td>
    <td class="text-xs">${last}</td>
    ${availCell}${taskCell}
    <td style="text-align:right;white-space:nowrap">
      <button class="admin-btn" data-act="edit">Edit</button>
      ${availBtn}
      ${state.emailEnabled ? `<button class="admin-btn" data-act="resend">Resend invite</button>` : ''}
      ${state.emailEnabled && u.hasPassword ? `<button class="admin-btn" data-act="reset">Reset password</button>` : ''}
      <button class="admin-btn" data-act="toggle">${u.disabled ? 'Enable' : 'Deactivate'}</button>
      <button class="admin-btn admin-btn-danger" data-act="delete">Delete</button>
    </td>
  </tr>`;
}

function wireRows(rows, hasEmployees) {
  document.querySelectorAll('#team-table-wrap tr[data-id]').forEach(tr => {
    const u = rows.find(x => x.id === tr.dataset.id);
    tr.querySelectorAll('button[data-act]').forEach(btn => btn.addEventListener('click', async e => {
      e.stopPropagation();
      const act = btn.dataset.act;
      if (act === 'edit')   return openDrawer(u);
      if (act === 'avail')  return openAvailDrawer(u);
      if (act === 'toggle') {
        await fetch('/api/team/users/' + u.id, {
          method:'PATCH', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ disabled: !u.disabled }),
        });
        return refreshTeam();
      }
      if (act === 'resend') {
        const r = await fetch(`/api/team/users/${u.id}/resend-invite`, { method:'POST' });
        const data = await r.json().catch(()=>({}));
        alert(r.ok ? 'Invitation resent to ' + u.email : 'Resend failed: '+(data.error||r.status));
        return;
      }
      if (act === 'reset') {
        if (!confirm(`Email a password reset link to ${u.email}?`)) return;
        const r = await fetch(`/api/team/users/${u.id}/send-reset`, { method:'POST' });
        const data = await r.json().catch(()=>({}));
        alert(r.ok ? 'Reset link sent to '+u.email : 'Reset failed: '+(data.error||r.status));
        return;
      }
      if (act === 'delete') {
        if (u.id === state.me?.id) { alert("You can't delete your own account."); return; }
        if (!confirm(`Delete ${u.email}? This cannot be undone.`)) return;
        const r = await fetch('/api/team/users/'+u.id, { method:'DELETE' });
        if (!r.ok) { alert('Delete failed: '+(await r.json()).error); return; }
        return refreshTeam();
      }
    }));
    tr.addEventListener('click', () => openDrawer(u));
  });
}

// ---- User Drawer ----

function wireDrawer() {
  document.querySelectorAll('[data-user-drawer-close]').forEach(el =>
    el.addEventListener('click', closeDrawer));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('user-drawer').classList.contains('hidden')) closeDrawer();
  });

  $('ud-role').addEventListener('change', () => {
    if (!state.permsCustom) seedPermissionsFromRole($('ud-role').value);
    syncEmployeeSections();
  });
  $('ud-perm-reset').addEventListener('click', () => {
    state.permsCustom = false;
    seedPermissionsFromRole($('ud-role').value);
    updatePermSourceLabel();
  });
  $('btn-user-save').addEventListener('click', saveUser);

  // Availability status toggles leave-date fields
  $('ud-avail-status').addEventListener('change', () => {
    $('ud-leave-dates').style.display = $('ud-avail-status').value === 'leave' ? '' : 'none';
  });

  // Tasks search filter
  $('ud-tasks-search').addEventListener('input', () => renderTaskList($('ud-tasks-search').value));
}

// Show/hide Employee-only sections based on the selected role
function syncEmployeeSections() {
  const isEmployee = $('ud-role').value === 'Employee';
  $('ud-availability-section').style.display = isEmployee ? '' : 'none';
  $('ud-tasks-section').style.display        = isEmployee ? '' : 'none';
  if (isEmployee && !state.roadmapItems.length) loadRoadmapItems();
}

// Fetch roadmap items so the task picker is populated
async function loadRoadmapItems() {
  try {
    const resp = await fetch('/api/roadmap').then(r => r.json());
    state.roadmapItems = resp.items || [];
    renderTaskList($('ud-tasks-search')?.value || '');
  } catch {
    state.roadmapItems = [];
    const el = $('ud-tasks-list');
    if (el) el.innerHTML = `<span style="color:#dc2626;">Could not load roadmap tasks.</span>`;
  }
}

// Render the checkbox list of roadmap items, filtered by the search term
// and pre-checking IDs in `selectedIds`.
function renderTaskList(filter, selectedIds) {
  const el = $('ud-tasks-list');
  if (!el) return;
  const q = (filter || '').toLowerCase();
  const items = state.roadmapItems.filter(i =>
    !q || i.name.toLowerCase().includes(q) || (i.description||'').toLowerCase().includes(q));

  if (!items.length) {
    el.innerHTML = `<span style="color:var(--ink-400);">No matching tasks.</span>`;
    $('ud-tasks-count').textContent = '';
    return;
  }

  // Collect currently checked IDs from existing checkboxes (preserve live state)
  const currentlyChecked = selectedIds !== undefined
    ? new Set(selectedIds)
    : new Set(
        Array.from(el.querySelectorAll('input[data-task-id]:checked'))
             .map(cb => cb.dataset.taskId)
      );

  el.innerHTML = items.map(item => {
    const checked = currentlyChecked.has(item.id) ? 'checked' : '';
    const statusColor = {
      'Production':'#10b981','Testing':'#0ea5e9','Development':'#6366f1',
      'Blocked':'#ef4444','Waiting':'#f59e0b','Not Started':'#94a3b8',
    }[item.status] || '#94a3b8';
    return `<label style="display:flex;align-items:flex-start;gap:8px;padding:5px 0;border-bottom:1px solid var(--surface-border);cursor:pointer;">
      <input type="checkbox" data-task-id="${esc(item.id)}" ${checked}
             style="margin-top:2px;flex-shrink:0;" />
      <div>
        <div style="font-weight:600;color:var(--ink-900);">${esc(item.name)}</div>
        ${item.description ? `<div style="color:var(--ink-500);font-size:11px;">${esc(item.description.slice(0,80))}${item.description.length>80?'…':''}</div>` : ''}
        <span style="font-size:10px;font-weight:700;color:${statusColor};text-transform:uppercase;letter-spacing:.04em;">${esc(item.status)}</span>
        ${item.quarter ? `<span style="font-size:10px;color:var(--ink-400);margin-left:6px;">${esc(item.quarter)}</span>` : ''}
      </div>
    </label>`;
  }).join('');

  updateTaskCount();
  el.querySelectorAll('input[data-task-id]').forEach(cb =>
    cb.addEventListener('change', updateTaskCount));
}

function updateTaskCount() {
  const el = $('ud-tasks-list');
  if (!el) return;
  const checked = el.querySelectorAll('input[data-task-id]:checked').length;
  const total   = el.querySelectorAll('input[data-task-id]').length;
  $('ud-tasks-count').textContent = checked
    ? `${checked} of ${total} selected`
    : `${total} task${total!==1?'s':''} available — none selected`;
}

function getSelectedTaskIds() {
  const el = $('ud-tasks-list');
  if (!el) return [];
  return Array.from(el.querySelectorAll('input[data-task-id]:checked')).map(cb => cb.dataset.taskId);
}

async function openDrawer(user) {
  state.editing = user;
  state.permsCustom = Array.isArray(user?.permissions);
  const rolesToShow = state.roles.filter(r => r !== 'Super Admin' || state.me?.role === 'Super Admin');
  $('ud-role').innerHTML = rolesToShow.map(r =>
    `<option value="${esc(r)}">${esc(ROLE_DISPLAY_NAMES[r]||r)}</option>`).join('');

  $('user-drawer-title').textContent = user ? 'Edit User' : 'Add User';
  $('btn-user-save').textContent     = user ? 'Save Changes' : 'Create User';

  $('ud-id').value         = user?.id || '';
  $('ud-name').value       = user?.name || '';
  $('ud-email').value      = user?.email || '';
  $('ud-department').value = user?.department || '';
  $('ud-avatar').value     = user?.avatarUrl || '';
  $('ud-role').value       = user?.role || 'Viewer';
  $('ud-github').value     = user?.githubLogin || '';
  $('ud-password').value   = '';
  $('ud-disabled').checked = Boolean(user?.disabled);
  const n = user?.notifications || {};
  $('ud-notif-email').checked   = n.email   !== false;
  $('ud-notif-slack').checked   = Boolean(n.slack);
  $('ud-notif-teams').checked   = Boolean(n.teams);
  $('ud-notif-weekly').checked  = n.weeklyReport !== false;
  $('ud-notif-release').checked = n.releaseNotification !== false;
  $('ud-error').textContent = '';

  const initial = state.permsCustom ? user.permissions : defaultPermissionsFor(user?.role||'Viewer');
  state.permsSelected = new Set(initial);
  renderPermGrid();
  renderRepoPicker(user?.repositories || []);
  updatePermSourceLabel();

  // Reset Employee-only sections
  $('ud-avail-status').value = '';
  $('ud-leave-dates').style.display = 'none';
  $('ud-leave-start').value = '';
  $('ud-leave-end').value = '';
  $('ud-avail-current').textContent = '';
  $('ud-tasks-search').value = '';
  $('ud-tasks-list').innerHTML = '<span style="color:var(--ink-400);">Loading tasks…</span>';
  $('ud-tasks-count').textContent = '';

  const isEmployee = (user?.role || 'Viewer') === 'Employee';
  $('ud-availability-section').style.display = isEmployee ? '' : 'none';
  $('ud-tasks-section').style.display        = isEmployee ? '' : 'none';

  if (isEmployee) {
    // Pre-fill availability from most recent record
    const rec = currentAvailability(user?.id);
    if (rec) {
      $('ud-avail-status').value = rec.status;
      if (rec.status === 'leave') {
        $('ud-leave-dates').style.display = '';
        $('ud-leave-start').value = rec.leaveStart || rec.date;
        $('ud-leave-end').value   = rec.leaveEnd   || rec.date;
      }
      $('ud-avail-current').textContent = rec.status === 'available'
        ? '✅ Currently: Available'
        : `🟡 Currently: On Leave`;
    }

    // Load roadmap items then pre-check already-assigned tasks
    const existingIds = Array.isArray(user?.assignedTasks) ? user.assignedTasks : [];
    try {
      const resp = await fetch('/api/roadmap').then(r => r.json());
      state.roadmapItems = resp.items || [];
    } catch { state.roadmapItems = []; }
    renderTaskList('', existingIds);
  }

  $('user-drawer').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  setTimeout(() => $('ud-name').focus(), 40);
}

function closeDrawer() {
  $('user-drawer').classList.add('hidden');
  document.body.style.overflow = '';
}

function seedPermissionsFromRole(role) {
  state.permsSelected = new Set(defaultPermissionsFor(role));
  renderPermGrid();
}

function renderPermGrid() {
  const byCat = new Map();
  for (const p of PERMISSIONS) {
    if (!byCat.has(p.category)) byCat.set(p.category, []);
    byCat.get(p.category).push(p);
  }
  const html = [];
  for (const [cat, perms] of byCat) {
    html.push(`<div class="perm-cat"><div class="perm-cat-head">${esc(cat)}</div>`);
    for (const p of perms) {
      const checked = state.permsSelected.has(p.key) ? 'checked' : '';
      html.push(`<label class="perm-row"><input type="checkbox" data-perm="${esc(p.key)}" ${checked} /> ${esc(p.label)}</label>`);
    }
    html.push(`</div>`);
  }
  $('ud-permissions').innerHTML = html.join('');
  $('ud-permissions').querySelectorAll('input[type="checkbox"][data-perm]').forEach(cb => {
    cb.addEventListener('change', () => {
      state.permsCustom = true;
      if (cb.checked) state.permsSelected.add(cb.dataset.perm);
      else            state.permsSelected.delete(cb.dataset.perm);
      updatePermSourceLabel();
    });
  });
}

function updatePermSourceLabel() {
  $('ud-perm-source').textContent = state.permsCustom
    ? 'Customised — overriding role template'
    : `Inheriting from ${ROLE_DISPLAY_NAMES[$('ud-role').value] || $('ud-role').value} template`;
  $('ud-perm-reset').hidden = !state.permsCustom;
}

function renderRepoPicker(selected) {
  const chosen = new Set(selected || []);
  const repos = state.repositories.slice().sort((a, b) => a.full_name.localeCompare(b.full_name));
  if (!repos.length) {
    $('ud-repos').innerHTML = `<div class="text-xs text-ink-500">No repositories configured yet. Add one in Settings.</div>`;
    return;
  }
  $('ud-repos').innerHTML = repos.map(r =>
    `<label class="repo-chip ${chosen.has(r.full_name)?'active':''}"><input type="checkbox" value="${esc(r.full_name)}" ${chosen.has(r.full_name)?'checked':''} /> ${esc(r.full_name)}</label>`
  ).join('');
  $('ud-repos').querySelectorAll('label.repo-chip').forEach(el => {
    el.addEventListener('click', () => setTimeout(() => el.classList.toggle('active', el.querySelector('input').checked), 0));
  });
}

async function saveUser() {
  const body = {
    id:           $('ud-id').value || undefined,
    name:         $('ud-name').value.trim(),
    email:        $('ud-email').value.trim(),
    department:   $('ud-department').value.trim(),
    avatarUrl:    $('ud-avatar').value.trim() || null,
    role:         $('ud-role').value,
    githubLogin:  $('ud-github').value.trim() || null,
    disabled:     $('ud-disabled').checked,
    permissions:  state.permsCustom ? Array.from(state.permsSelected) : null,
    repositories: Array.from($('ud-repos').querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value),
    notifications: {
      email:               $('ud-notif-email').checked,
      slack:               $('ud-notif-slack').checked,
      teams:               $('ud-notif-teams').checked,
      weeklyReport:        $('ud-notif-weekly').checked,
      releaseNotification: $('ud-notif-release').checked,
    },
  };
  const pw = $('ud-password').value;
  if (pw) body.password = pw;
  if (!body.id && state.emailEnabled && $('ud-send-invite').checked) body.sendInvite = true;

  // Include assigned tasks for Employee role
  if (body.role === 'Employee') {
    body.assignedTasks = getSelectedTaskIds();
  }

  const method = body.id ? 'PATCH' : 'POST';
  const url    = body.id ? '/api/team/users/'+body.id : '/api/team/users';
  const r = await fetch(url, { method, headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
  if (!r.ok) { $('ud-error').textContent = (await r.json()).error || 'Save failed'; return; }

  // If Employee, also save availability if a status was chosen
  const savedData = await r.json().catch(()=>({}));
  const targetId = body.id || savedData?.user?.id || savedData?.id;
  const availStatus = $('ud-avail-status').value;

  if (body.role === 'Employee' && availStatus && targetId) {
    const availBody = { userId: targetId, status: availStatus };
    if (availStatus === 'leave') {
      const ls = $('ud-leave-start').value;
      const le = $('ud-leave-end').value;
      if (ls) availBody.leaveStart = ls;
      if (le) availBody.leaveEnd   = le;
    } else {
      availBody.date = new Date().toISOString().slice(0, 10);
    }
    await fetch('/api/availability/admin', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(availBody),
    }).catch(()=>{});
  }

  closeDrawer();
  await refreshTeam();
}

// ---- Availability Edit Drawer ----

let availDrawerUser = null;

function wireAvailDrawer() {
  document.querySelectorAll('[data-avail-drawer-close]').forEach(el =>
    el.addEventListener('click', closeAvailDrawer));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('avail-drawer').classList.contains('hidden')) closeAvailDrawer();
  });
  $('ad-status').addEventListener('change', syncAvailDrawerFields);
  $('btn-avail-save').addEventListener('click', saveAvailability);
}

function syncAvailDrawerFields() {
  const isLeave = $('ad-status').value === 'leave';
  $('ad-leave-wrap').style.display       = isLeave ? '' : 'none';
  $('ad-single-date-wrap').style.display = isLeave ? 'none' : '';
}

async function openAvailDrawer(user) {
  availDrawerUser = user;
  $('avail-drawer-title').textContent = 'Edit Availability';
  $('avail-drawer-sub').textContent   = user.name || user.email;
  $('ad-userid').value                = user.id;
  $('ad-error').textContent           = '';
  const todayStr = new Date().toISOString().slice(0, 10);
  $('ad-single-date').value = todayStr;
  $('ad-leave-start').value = todayStr;
  $('ad-leave-end').value   = todayStr;
  const rec = currentAvailability(user.id);
  $('ad-status').value = rec?.status || 'available';
  if (rec?.status === 'leave') {
    $('ad-leave-start').value = rec.leaveStart || rec.date;
    $('ad-leave-end').value   = rec.leaveEnd   || rec.date;
  }
  syncAvailDrawerFields();
  await loadAvailRecords(user.id);
  $('avail-drawer').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeAvailDrawer() {
  $('avail-drawer').classList.add('hidden');
  document.body.style.overflow = '';
  availDrawerUser = null;
}

async function loadAvailRecords(userId) {
  const el = $('ad-records');
  el.textContent = 'Loading…';
  try {
    const resp = await fetch(`/api/availability?userId=${encodeURIComponent(userId)}`).then(r => r.json());
    const records = (resp.records || []).slice().sort((a, b) => b.date.localeCompare(a.date));
    if (!records.length) { el.innerHTML = `<span style="color:var(--ink-400);">No records yet.</span>`; return; }
    el.innerHTML = records.map(rec => {
      const badge = rec.status === 'available'
        ? `<span style="color:#059669;font-weight:700;">✅ Available</span>`
        : `<span style="color:#d97706;font-weight:700;">🟡 On Leave</span>`;
      const range = rec.leaveStart && rec.leaveEnd
        ? ` <span style="color:var(--ink-400);">(${rec.leaveStart}–${rec.leaveEnd})</span>` : '';
      return `<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--surface-border);">
        <span style="min-width:96px;font-weight:600;">${rec.date}</span>
        ${badge}${range}
        <button data-del-date="${rec.date}" style="margin-left:auto;padding:2px 8px;border-radius:6px;border:1px solid rgba(239,68,68,.3);background:transparent;font-size:11px;color:#dc2626;cursor:pointer;">Remove</button>
      </div>`;
    }).join('');
    el.querySelectorAll('[data-del-date]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const date = btn.dataset.delDate;
        const uid  = $('ad-userid').value;
        await fetch(`/api/availability/${encodeURIComponent(date)}?userId=${encodeURIComponent(uid)}`, { method:'DELETE' });
        await refreshTeam();
        await loadAvailRecords(uid);
      });
    });
  } catch {
    el.innerHTML = `<span style="color:#dc2626;">Could not load records.</span>`;
  }
}

async function saveAvailability() {
  const userId = $('ad-userid').value;
  const status = $('ad-status').value;
  $('ad-error').textContent = '';
  const isLeave = status === 'leave';
  const body = { userId, status };
  if (isLeave) {
    const ls = $('ad-leave-start').value;
    if (!ls) { $('ad-error').textContent = 'Leave start date is required.'; return; }
    body.leaveStart = ls;
    const le = $('ad-leave-end').value;
    if (le) body.leaveEnd = le;
  } else {
    const d = $('ad-single-date').value;
    if (!d) { $('ad-error').textContent = 'Date is required.'; return; }
    body.date = d;
  }
  $('btn-avail-save').disabled = true;
  try {
    const r = await fetch('/api/availability/admin', {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) { $('ad-error').textContent = data.error || 'Save failed'; return; }
    await refreshTeam();
    await loadAvailRecords(userId);
  } catch (e) {
    $('ad-error').textContent = e.message;
  } finally {
    $('btn-avail-save').disabled = false;
  }
}

// ---- Helpers ----

function emptyState(text) {
  return `<div class="empty-state"><div class="text-3xl mb-2">👥</div><div>${esc(text)}</div></div>`;
}
function errorState(text) {
  return `<div class="empty-state"><div class="text-3xl mb-2">🚫</div><div>${esc(text)}</div></div>`;
}
