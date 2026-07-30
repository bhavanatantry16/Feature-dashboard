// Team Management tab — user CRUD moved out of the old /admin page and into
// the main app. Same server routes (/api/team/*) so the auth model doesn't
// shift. The right-side drawer implements the 5-section Add User flow.

import { PERMISSIONS, ROLE_DISPLAY_NAMES, ROLE_PERMISSIONS, defaultPermissionsFor } from '../../shared/permissions.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);

let state = {
  me: null,
  users: [],
  roles: [],
  repositories: [],
  filters: { q: '', role: '', department: '', status: '' },
  editing: null,          // the user record currently in the drawer (or null for a fresh add)
  permsCustom: false,     // has the admin ticked permissions away from the role template?
  permsSelected: new Set(),
};

// ---- Public API ----

export function initTeam({ me, repositories }) {
  state.me = me;
  state.repositories = repositories || [];
  wireFilters();
  wireDrawer();
  $('btn-team-add').addEventListener('click', () => openDrawer(null));
}

export async function refreshTeam() {
  try {
    const r = await fetch('/api/team/users').then(r => r.json());
    state.users = r.users || [];
    state.roles = r.roles || [];
    populateFilterOptions();
    renderTable();
  } catch (e) {
    $('team-table-wrap').innerHTML = errorState('Failed to load users. You may not have permission to see this tab.');
  }
}

// ---- Filters ----

function wireFilters() {
  const bind = (id, key) => $(id).addEventListener('input', (e) => {
    state.filters[key] = e.target.value.trim(); renderTable();
  });
  bind('team-search', 'q');
  ['team-filter-role', 'team-filter-department', 'team-filter-status'].forEach(id => {
    $(id).addEventListener('change', (e) => {
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

function renderTable() {
  const wrap = $('team-table-wrap');
  const rows = applyFilters(state.users);
  if (rows.length === 0) {
    wrap.innerHTML = emptyState('No users match those filters');
    return;
  }
  wrap.innerHTML = `<table class="admin-table"><thead><tr>
    <th>Member</th><th>Email</th><th>Department</th><th>Role</th>
    <th>Status</th><th>Repositories</th><th>Last Active</th><th style="text-align:right">Actions</th>
  </tr></thead><tbody>
    ${rows.map(rowHtml).join('')}
  </tbody></table>`;
  wireRows(rows);
  window.lucide?.createIcons();
}

function rowHtml(u) {
  const initials = (u.name || u.email || '?').split(/\s+/).map(s => s[0]).slice(0, 2).join('').toUpperCase();
  const avatar = u.avatarUrl
    ? `<img class="team-avatar" src="${esc(u.avatarUrl)}" alt="${esc(u.name)}" />`
    : `<span class="team-avatar team-avatar-fallback">${esc(initials)}</span>`;
  const status = u.disabled
    ? `<span class="admin-pill admin-pill-off">Disabled</span>`
    : `<span class="admin-pill admin-pill-on">Active</span>`;
  const repos = (u.repositories || []).length
    ? `<span class="team-repos" title="${esc((u.repositories || []).join(', '))}">${u.repositories.length}</span>`
    : `<span class="text-ink-400">All</span>`;
  const last = u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : '—';
  const roleLabel = ROLE_DISPLAY_NAMES[u.role] || u.role;
  return `<tr data-id="${esc(u.id)}">
    <td><div class="team-member">${avatar}<div><div class="team-name">${esc(u.name || '—')}</div>${u.githubLogin ? `<div class="team-gh">@${esc(u.githubLogin)}</div>` : ''}</div></div></td>
    <td class="mono">${esc(u.email)}</td>
    <td>${esc(u.department || '—')}</td>
    <td>${esc(roleLabel)}</td>
    <td>${status}</td>
    <td>${repos}</td>
    <td class="text-xs">${last}</td>
    <td style="text-align:right; white-space:nowrap">
      <button class="admin-btn" data-act="edit">Edit</button>
      <button class="admin-btn" data-act="toggle">${u.disabled ? 'Enable' : 'Deactivate'}</button>
      <button class="admin-btn admin-btn-danger" data-act="delete">Delete</button>
    </td>
  </tr>`;
}

function wireRows(rows) {
  document.querySelectorAll('#team-table-wrap tr[data-id]').forEach(tr => {
    const u = rows.find(x => x.id === tr.dataset.id);
    tr.querySelectorAll('button[data-act]').forEach(btn => btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const act = btn.dataset.act;
      if (act === 'edit') return openDrawer(u);
      if (act === 'toggle') {
        await fetch('/api/team/users/' + u.id, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ disabled: !u.disabled }),
        });
        return refreshTeam();
      }
      if (act === 'delete') {
        if (u.id === state.me?.id) { alert("You can't delete your own account."); return; }
        if (!confirm(`Delete ${u.email}? This cannot be undone.`)) return;
        const r = await fetch('/api/team/users/' + u.id, { method: 'DELETE' });
        if (!r.ok) { alert('Delete failed: ' + (await r.json()).error); return; }
        return refreshTeam();
      }
    }));
    tr.addEventListener('click', () => openDrawer(u));
  });
}

// ---- Drawer ----

function wireDrawer() {
  document.querySelectorAll('[data-user-drawer-close]').forEach(el => el.addEventListener('click', closeDrawer));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('user-drawer').classList.contains('hidden')) closeDrawer();
  });

  // Role change re-seeds permissions from the template unless the admin has
  // deliberately customised them (in which case we keep their choices).
  $('ud-role').addEventListener('change', () => {
    if (!state.permsCustom) seedPermissionsFromRole($('ud-role').value);
  });
  $('ud-perm-reset').addEventListener('click', () => {
    state.permsCustom = false;
    seedPermissionsFromRole($('ud-role').value);
    updatePermSourceLabel();
  });
  $('btn-user-save').addEventListener('click', saveUser);
}

function openDrawer(user) {
  state.editing = user;
  state.permsCustom = Array.isArray(user?.permissions);
  const rolesToShow = state.roles.filter(r => r !== 'Super Admin' || state.me?.role === 'Super Admin');
  $('ud-role').innerHTML = rolesToShow.map(r =>
    `<option value="${esc(r)}">${esc(ROLE_DISPLAY_NAMES[r] || r)}</option>`).join('');

  $('user-drawer-title').textContent = user ? 'Edit User' : 'Add User';
  $('btn-user-save').textContent = user ? 'Save Changes' : 'Create User';

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

  const initial = state.permsCustom ? user.permissions : defaultPermissionsFor(user?.role || 'Viewer');
  state.permsSelected = new Set(initial);
  renderPermGrid();
  renderRepoPicker(user?.repositories || []);
  updatePermSourceLabel();

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
      else state.permsSelected.delete(cb.dataset.perm);
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
    `<label class="repo-chip ${chosen.has(r.full_name) ? 'active' : ''}"><input type="checkbox" value="${esc(r.full_name)}" ${chosen.has(r.full_name) ? 'checked' : ''} /> ${esc(r.full_name)}</label>`
  ).join('');
  $('ud-repos').querySelectorAll('label.repo-chip').forEach(el => {
    el.addEventListener('click', () => setTimeout(() => el.classList.toggle('active', el.querySelector('input').checked), 0));
  });
}

async function saveUser() {
  const body = {
    id: $('ud-id').value || undefined,
    name: $('ud-name').value.trim(),
    email: $('ud-email').value.trim(),
    department: $('ud-department').value.trim(),
    avatarUrl: $('ud-avatar').value.trim() || null,
    role: $('ud-role').value,
    githubLogin: $('ud-github').value.trim() || null,
    disabled: $('ud-disabled').checked,
    // Only send `permissions` if the admin has diverged from the role
    // template. Sending null keeps the "inherit from role" behaviour.
    permissions: state.permsCustom ? Array.from(state.permsSelected) : null,
    repositories: Array.from($('ud-repos').querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value),
    notifications: {
      email:   $('ud-notif-email').checked,
      slack:   $('ud-notif-slack').checked,
      teams:   $('ud-notif-teams').checked,
      weeklyReport:        $('ud-notif-weekly').checked,
      releaseNotification: $('ud-notif-release').checked,
    },
  };
  const pw = $('ud-password').value;
  if (pw) body.password = pw;

  const method = body.id ? 'PATCH' : 'POST';
  const url = body.id ? '/api/team/users/' + body.id : '/api/team/users';
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) { $('ud-error').textContent = (await r.json()).error || 'Save failed'; return; }
  closeDrawer();
  await refreshTeam();
}

function emptyState(text) {
  return `<div class="empty-state"><div class="text-3xl mb-2">👥</div><div>${esc(text)}</div></div>`;
}
function errorState(text) {
  return `<div class="empty-state"><div class="text-3xl mb-2">🚫</div><div>${esc(text)}</div></div>`;
}
