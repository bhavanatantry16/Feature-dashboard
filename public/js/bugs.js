// Bugs tab — dedicated defect triage. Isolated from the feature board so
// bug work doesn't visually compete with feature delivery. Backed by
// /api/bugs (persistent bug store, not the read-only GitHub issues list).

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);

let state = {
  bugs: [],
  enums: { severity: [], priority: [], status: [], environment: [] },
  filters: { q: '', severity: '', status: '', environment: '' },
  editing: null,
};

// ---- Public API ----

export async function initBugs() {
  // Enums drive the filter dropdowns AND the drawer's select fields.
  const r = await fetch('/api/bugs/enums').then(r => r.json()).catch(() => null);
  if (r) {
    state.enums = r;
    fillSelect('bug-filter-severity', ['', ...r.severity], ['All severities']);
    fillSelect('bug-filter-status',   ['', ...r.status],   ['All statuses']);
    fillSelect('bug-filter-env',      ['', ...r.environment], ['All environments']);
    fillSelect('bd-severity',    r.severity);
    fillSelect('bd-priority',    r.priority);
    fillSelect('bd-status',      r.status);
    fillSelect('bd-environment', r.environment);
  }
  wireFilters();
  wireDrawer();
  wireImport();
  $('btn-bug-add').addEventListener('click', () => openDrawer(null));
  $('btn-bug-import').addEventListener('click', () => openImport());
}

export async function refreshBugs() {
  try {
    const r = await fetch('/api/bugs').then(r => r.json());
    state.bugs = r.bugs || [];
    renderTable();
  } catch {
    $('bugs-table-wrap').innerHTML = errorState('Failed to load bugs.');
  }
}

// ---- Helpers ----

function fillSelect(id, opts, labels) {
  const sel = $(id); if (!sel) return;
  sel.innerHTML = opts.map((o, i) => `<option value="${esc(o)}">${esc(labels?.[i] || o || '—')}</option>`).join('');
}

// ---- Filters ----

function wireFilters() {
  $('bug-search').addEventListener('input', (e) => { state.filters.q = e.target.value.trim().toLowerCase(); renderTable(); });
  ['bug-filter-severity','bug-filter-status','bug-filter-env'].forEach(id => {
    $(id).addEventListener('change', (e) => {
      const key = id.endsWith('env') ? 'environment' : id.split('-').pop();
      state.filters[key] = e.target.value; renderTable();
    });
  });
}
function applyFilters(bugs) {
  const q = state.filters.q;
  return bugs.filter(b => {
    if (state.filters.severity   && b.severity !== state.filters.severity) return false;
    if (state.filters.status     && b.status !== state.filters.status) return false;
    if (state.filters.environment && b.environment !== state.filters.environment) return false;
    if (q) {
      const hay = `${b.title} ${b.description || ''} ${b.bugId} ${b.repo || ''} ${b.assignee || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

// ---- Table ----

const SEV_TONE = { Critical: 'critical', High: 'high', Medium: 'medium', Low: 'low' };
const STATUS_TONE = {
  Open: 'open', Triage: 'triage', 'In Progress': 'progress', 'In Review': 'review',
  Verified: 'verified', Closed: 'closed', "Won't Fix": 'wontfix',
};

function renderTable() {
  const wrap = $('bugs-table-wrap');
  const rows = applyFilters(state.bugs).sort((a, b) => {
    const sev = { Critical: 0, High: 1, Medium: 2, Low: 3 };
    if ((sev[a.severity] ?? 2) !== (sev[b.severity] ?? 2)) return (sev[a.severity] ?? 2) - (sev[b.severity] ?? 2);
    return new Date(b.updatedAt) - new Date(a.updatedAt);
  });
  if (rows.length === 0) {
    wrap.innerHTML = emptyState(state.bugs.length ? 'No bugs match those filters' : 'No bugs yet. Add one or import from CSV.');
    return;
  }
  wrap.innerHTML = `<table class="admin-table"><thead><tr>
    <th>ID</th><th>Title</th><th>Severity</th><th>Status</th>
    <th>Environment</th><th>Assignee</th><th>Repository</th><th>Updated</th>
  </tr></thead><tbody>
    ${rows.map(rowHtml).join('')}
  </tbody></table>`;
  wireRows(rows);
  window.lucide?.createIcons();
}

function rowHtml(b) {
  const sev = SEV_TONE[b.severity] || 'medium';
  const st  = STATUS_TONE[b.status] || 'open';
  return `<tr data-id="${esc(b.id)}">
    <td class="mono text-xs">${esc(b.bugId)}</td>
    <td>
      <div class="bug-title">${esc(b.title)}</div>
      ${b.linkedFeature ? `<div class="bug-link">↳ ${esc(b.linkedFeature)}</div>` : ''}
    </td>
    <td><span class="bug-sev bug-sev-${sev}">${esc(b.severity)}</span></td>
    <td><span class="bug-status bug-status-${st}">${esc(b.status)}</span></td>
    <td>${esc(b.environment)}</td>
    <td>${esc(b.assignee || '—')}</td>
    <td class="text-xs">${esc((b.repo || '').split('/').pop() || '—')}</td>
    <td class="text-xs">${b.updatedAt ? new Date(b.updatedAt).toLocaleDateString() : '—'}</td>
  </tr>`;
}

function wireRows(rows) {
  document.querySelectorAll('#bugs-table-wrap tr[data-id]').forEach(tr => {
    tr.addEventListener('click', () => {
      const b = rows.find(x => x.id === tr.dataset.id);
      if (b) openDrawer(b);
    });
  });
}

// ---- Drawer ----

function wireDrawer() {
  document.querySelectorAll('[data-bug-drawer-close]').forEach(el => el.addEventListener('click', closeDrawer));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('bug-drawer').classList.contains('hidden')) closeDrawer();
  });
  $('btn-bug-save').addEventListener('click', saveBug);
  $('bd-delete').addEventListener('click', deleteBug);
  $('bd-comment-add').addEventListener('click', addComment);
}

function openDrawer(bug) {
  state.editing = bug;
  $('bug-drawer-title').textContent = bug ? `${bug.bugId} — Edit` : 'Add Bug';
  $('bug-drawer-sub').textContent   = bug ? `Reported ${bug.createdAt ? new Date(bug.createdAt).toLocaleDateString() : '—'} · Source: ${bug.source || 'manual'}` : 'New defect entry';
  $('btn-bug-save').textContent = bug ? 'Save Changes' : 'Create Bug';
  $('bd-delete').classList.toggle('hidden', !bug);

  $('bd-id').value = bug?.id || '';
  $('bd-title').value = bug?.title || '';
  $('bd-description').value = bug?.description || '';
  $('bd-severity').value = bug?.severity || 'Medium';
  $('bd-priority').value = bug?.priority || 'P2';
  $('bd-status').value = bug?.status || 'Open';
  $('bd-environment').value = bug?.environment || 'Production';
  $('bd-reporter').value = bug?.reporter || '';
  $('bd-assignee').value = bug?.assignee || '';
  $('bd-repo').value = bug?.repo || '';
  $('bd-linkedFeature').value = bug?.linkedFeature || '';
  $('bd-githubIssueUrl').value = bug?.githubIssueUrl || '';
  $('bd-stepsToReproduce').value = bug?.stepsToReproduce || '';
  $('bd-expectedResult').value = bug?.expectedResult || '';
  $('bd-actualResult').value = bug?.actualResult || '';
  $('bd-error').textContent = '';

  // History + comments show only for existing bugs
  const historyVisible = Array.isArray(bug?.statusHistory) && bug.statusHistory.length > 0;
  $('bd-history-section').classList.toggle('hidden', !bug || !historyVisible);
  if (historyVisible) {
    $('bd-history').innerHTML = bug.statusHistory.map(h =>
      `<div class="bug-history-row"><span class="bug-history-tone"></span>
        <div><b>${esc(h.from)}</b> → <b>${esc(h.to)}</b></div>
        <div class="text-xs text-ink-500">${esc(h.by)} · ${new Date(h.at).toLocaleString()}</div>
      </div>`).join('');
  }
  $('bd-comments-section').classList.toggle('hidden', !bug);
  if (bug) renderComments(bug.comments || []);

  $('bug-drawer').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  setTimeout(() => $('bd-title').focus(), 40);
}

function closeDrawer() {
  $('bug-drawer').classList.add('hidden');
  document.body.style.overflow = '';
}

function renderComments(comments) {
  $('bd-comments').innerHTML = comments.length
    ? comments.map(c => `<div class="bug-comment">
        <div class="bug-comment-head"><b>${esc(c.author)}</b> · <span class="text-xs text-ink-500">${new Date(c.at).toLocaleString()}</span></div>
        <div class="bug-comment-body">${esc(c.body)}</div>
      </div>`).join('')
    : `<div class="text-xs text-ink-500">No comments yet.</div>`;
}

async function saveBug() {
  const body = {
    id: $('bd-id').value || undefined,
    title: $('bd-title').value.trim(),
    description: $('bd-description').value,
    severity: $('bd-severity').value,
    priority: $('bd-priority').value,
    status: $('bd-status').value,
    environment: $('bd-environment').value,
    reporter: $('bd-reporter').value.trim(),
    assignee: $('bd-assignee').value.trim(),
    repo: $('bd-repo').value.trim(),
    linkedFeature: $('bd-linkedFeature').value.trim(),
    githubIssueUrl: $('bd-githubIssueUrl').value.trim(),
    stepsToReproduce: $('bd-stepsToReproduce').value,
    expectedResult: $('bd-expectedResult').value,
    actualResult: $('bd-actualResult').value,
  };
  const method = body.id ? 'PATCH' : 'POST';
  const url = body.id ? '/api/bugs/' + body.id : '/api/bugs';
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) { $('bd-error').textContent = (await r.json()).error || 'Save failed'; return; }
  closeDrawer();
  await refreshBugs();
}

async function deleteBug() {
  const id = $('bd-id').value;
  if (!id) return;
  if (!confirm('Permanently delete this bug?')) return;
  const r = await fetch('/api/bugs/' + id, { method: 'DELETE' });
  if (!r.ok) { $('bd-error').textContent = (await r.json()).error || 'Delete failed'; return; }
  closeDrawer();
  await refreshBugs();
}

async function addComment() {
  const id = $('bd-id').value;
  const body = $('bd-comment-input').value.trim();
  if (!id || !body) return;
  const r = await fetch('/api/bugs/' + id + '/comments', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  });
  if (!r.ok) return;
  $('bd-comment-input').value = '';
  // Refresh drawer state with the latest bug (comments field grows)
  const fresh = await fetch('/api/bugs/' + id).then(r => r.json()).then(j => j.bug);
  state.editing = fresh;
  renderComments(fresh?.comments || []);
}

// ---- Import ----

function wireImport() {
  const dlg = () => $('bug-import-dialog');
  document.querySelectorAll('[data-bug-import-close]').forEach(el => el.addEventListener('click', () => closeImport()));
  $('bug-import-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    $('bug-import-text').value = await file.text();
  });
  $('btn-bug-import-save').addEventListener('click', async () => {
    const text = $('bug-import-text').value.trim();
    if (!text) { $('bug-import-report').textContent = 'Nothing to import.'; return; }
    const r = await fetch('/api/bugs/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const data = await r.json();
    if (!r.ok) { $('bug-import-report').textContent = 'Failed: ' + (data.error || r.status); return; }
    $('bug-import-report').textContent = `Imported ${data.imported}, skipped ${data.skipped} duplicate${data.skipped === 1 ? '' : 's'}${data.errors?.length ? `, ${data.errors.length} error${data.errors.length === 1 ? '' : 's'}` : ''}.`;
    await refreshBugs();
    if (!data.errors?.length && data.imported > 0) setTimeout(() => closeImport(), 900);
  });
}
function openImport() {
  $('bug-import-dialog').classList.remove('hidden');
  $('bug-import-report').textContent = '';
  document.body.style.overflow = 'hidden';
  setTimeout(() => $('bug-import-text').focus(), 40);
}
function closeImport() {
  $('bug-import-dialog').classList.add('hidden');
  document.body.style.overflow = '';
}

function emptyState(text) { return `<div class="empty-state"><div class="text-3xl mb-2">🐞</div><div>${esc(text)}</div></div>`; }
function errorState(text) { return `<div class="empty-state"><div class="text-3xl mb-2">🚫</div><div>${esc(text)}</div></div>`; }
