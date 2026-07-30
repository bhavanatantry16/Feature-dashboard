import { api } from './api.js';
import { fmt, avatar, humanize, niceName, actionLabel, debounce, statusToneKey } from './utils.js';
import { showFeature } from './drawer.js';
import { renderRoadmap, openImport, closeImport } from './roadmap.js';

const state = {
  snapshot: null,
  roadmap: [],
  refreshTimer: null,
  syncedTicker: null,
  refreshSeconds: 60,
  filters: { search: '', repo: '', dev: '', sprint: '', env: '' },
  chips: new Set(),
  me: localStorage.getItem('me') || '',
  currentTab: 'overview',
};

// ---------- Boot ----------
window.addEventListener('DOMContentLoaded', () => {
  window.lucide?.createIcons();
  setupTheme();
  setupHeaderButtons();
  setupTabs();
  setupFilters();
  setupChips();
  setupRoadmapButtons();
  setupPlayback();
  boot();
});

async function boot() {
  try {
    const cfg = await api.config();
    state.refreshSeconds = cfg.clientRefreshSeconds || 60;
    document.getElementById('refresh-cadence').textContent = state.refreshSeconds;
  } catch {}
  await Promise.all([refreshSnapshot(false), refreshRoadmap()]);
  clearInterval(state.refreshTimer);
  state.refreshTimer = setInterval(() => refreshSnapshot(false), state.refreshSeconds * 1000);
  api.subscribeEvents(() => refreshSnapshot(false));
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refreshSnapshot(false));
}

// ---------- Tabs ----------
function setupTabs() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  });
  const initial = (location.hash.replace('#','') || 'overview');
  activateTab(['overview','board','roadmap'].includes(initial) ? initial : 'overview');
}
function activateTab(tab) {
  state.currentTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('hidden', p.id !== 'tab-' + tab));
  location.hash = tab;
}

// ---------- Data ----------
async function refreshSnapshot(force) {
  try {
    if (force) await api.refresh();
    const s = await api.snapshot();
    state.snapshot = s;
    document.getElementById('scope-label').textContent = (s.scope || []).join(', ') || '—';
    document.getElementById('demo-banner').classList.toggle('hidden', !s.isDemo);
    updateLastSynced(s.generatedAt);
    populateFilters(s);
    renderAll();
  } catch (e) { console.error('snapshot failed', e); }
}
async function refreshRoadmap() {
  try { const r = await fetch('/api/roadmap').then(r => r.json()); state.roadmap = r.items || []; renderRoadmapCard(); } catch {}
}

function updateLastSynced(ts) {
  const el = document.getElementById('last-synced');
  const set = () => el.textContent = fmt.relative(ts);
  set();
  clearInterval(state.syncedTicker);
  state.syncedTicker = setInterval(set, 15000);
}

// ---------- Filters ----------
function setupFilters() {
  const map = { 'f-search': 'search', 'f-repo': 'repo', 'f-dev': 'dev', 'f-sprint': 'sprint' };
  for (const [id, key] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (!el) continue;
    const handler = () => { state.filters[key] = (el.value || '').trim(); renderAll(); };
    el.addEventListener('change', handler);
    el.addEventListener('input', debounce(handler, 150));
  }
  const meInput = document.getElementById('me-name');
  if (meInput) {
    meInput.value = state.me;
    meInput.addEventListener('input', debounce(() => {
      state.me = meInput.value.trim();
      localStorage.setItem('me', state.me);
      if (state.chips.has('mine')) renderAll();
    }, 200));
  }
}
function setupChips() {
  document.querySelectorAll('.chip[data-chip]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.chip;
      if (state.chips.has(key)) state.chips.delete(key); else state.chips.add(key);
      btn.classList.toggle('active', state.chips.has(key));
      renderAll();
    });
  });
  document.getElementById('chip-clear').addEventListener('click', () => {
    state.chips.clear();
    document.querySelectorAll('.chip[data-chip]').forEach(b => b.classList.remove('active'));
    renderAll();
  });
}

function populateFilters(s) {
  fillOptions('f-repo', Array.from(new Set(s.repositories.map(r => r.full_name))).map(fn => ({ value: fn, label: (fn.split('/')[1] || fn) })));
  fillOptions('f-dev', Array.from(new Set([...(s.contributors || []).map(c => c.login), ...(s.features || []).flatMap(f => f.developers || [])])).filter(Boolean).sort().map(login => ({ value: login, label: niceName(login) })));
  fillOptions('f-sprint', Array.from(new Set((s.features || []).map(f => f.milestone).filter(Boolean))).sort().map(m => ({ value: m, label: m })));
}
function fillOptions(id, entries) {
  const sel = document.getElementById(id); if (!sel) return;
  const cur = sel.value; const placeholder = sel.querySelector('option');
  sel.innerHTML = ''; if (placeholder) sel.appendChild(placeholder);
  entries.forEach(({ value, label }) => { const o = document.createElement('option'); o.value = value; o.textContent = label; sel.appendChild(o); });
  if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
}

function bucketFor(f) {
  if (['Testing','UAT','Code Review'].includes(f.stage)) return 'Testing';
  if (f.stage === 'Production') return 'Production';
  if (f.stage === 'Development') return 'Development';
  return 'Backlog';
}
function daysSince(iso) { if (!iso) return 0; return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000)); }

function applyFilters(features) {
  const { search, repo, dev, sprint } = state.filters;
  const q = search.toLowerCase();
  const chips = state.chips;
  const me = state.me.toLowerCase();
  const todayMs = new Date(); todayMs.setHours(0,0,0,0);
  return features.filter(f => {
    const display = (f.displayName || humanize(f.title)).toLowerCase();
    if (repo && f.repoFull !== repo) return false;
    if (dev && !(f.developers || []).includes(dev) && f.owner !== dev) return false;
    if (sprint && f.milestone !== sprint) return false;
    if (q && !display.includes(q)) return false;
    if (chips.has('blocked') && !f.blocked) return false;
    if (chips.has('qa') && !['Testing','UAT'].includes(f.stage)) return false;
    if (chips.has('ready') && !(f.readinessScore >= 80 && f.stage !== 'Production')) return false;
    if (chips.has('today') && !(f.updated_at && new Date(f.updated_at).getTime() >= todayMs.getTime())) return false;
    if (chips.has('mine') && me && ![f.owner, ...(f.developers || []), f.qaOwner, f.reviewer].map(x => (x || '').toLowerCase()).includes(me)) return false;
    return true;
  });
}

// ---------- Render orchestrator ----------
function renderAll() {
  if (!state.snapshot) return;
  const s = state.snapshot;
  renderOverview(s);
  renderKanban(applyFilters(s.features || []), s.backlogActivities || []);
  renderActivity(s.activity || []);
  renderNotifications(s.notifications || []);
  renderRoadmapCard();
  renderPromotionQueue(s);
  window.lucide?.createIcons();
}

// ---------- Promotion Queue (Board tab, Azure DevOps source) ----------
// Was two sections (Deployment Presence tiles + a diff grid). The presence
// tiles duplicated the kanban columns above them, so only the diff grid
// remains — retitled "Promotion Queue" and relabelled in plain English.
function renderPromotionQueue(s) {
  const az = s.azdo || { configured: false, byEnvironment: {}, diff: {}, projects: [] };
  const notes = s.featureNotes || {};
  const sourceEl = document.getElementById('dp-source');
  if (!az.configured) {
    sourceEl.textContent = 'Not connected · add Azure DevOps URLs in Settings to populate this queue';
  } else {
    const projectNames = (az.projects || []).map(p => p.project).join(', ');
    sourceEl.textContent = `From Azure DevOps · ${projectNames || 'connected'}`;
  }

  // Plain-English labels for the three env-gap cards. Screenshot renamed:
  //   "In Dev, not in Test"  → "Ready for Test"
  //   "In Test, not in Prod" → "Ready for Production"
  //   "In Dev, not in Prod"  → "Skipping Test (Dev straight to Prod)" — flags
  //                            a hotfix path that bypassed QA; keep it named
  //                            distinctly so it doesn't hide behind the other
  //                            two cards.
  const diffs = [
    { key: 'Development->Test',        label: 'Ready for Test',                     sub: 'Built in Dev, not yet in Test' },
    { key: 'Test->Production',         label: 'Ready for Production',               sub: 'Signed off in Test, waiting to ship' },
    { key: 'Development->Production',  label: 'Skipping Test (Dev straight to Prod)', sub: 'Hotfix path — no Test build yet' },
  ];
  document.getElementById('deployment-diff').innerHTML = diffs.map(d => {
    const items = az.diff?.[d.key] || [];
    if (items.length === 0) {
      return `<div class="dp-diff-card">
        <div class="dp-diff-title">${d.label}<span class="dp-diff-count zero">0</span></div>
        <div class="dp-diff-sub">${fmt.escape(d.sub)}</div>
        <div class="dp-diff-empty">Everything's caught up here.</div>
      </div>`;
    }
    return `<div class="dp-diff-card">
      <div class="dp-diff-title">${d.label}<span class="dp-diff-count">${items.length}</span></div>
      <div class="dp-diff-sub">${fmt.escape(d.sub)}</div>
      <div class="dp-diff-list">${items.map(name => {
        const noteKey = `${d.key}::${name}`;
        const note = notes[noteKey];
        return `<div class="dp-diff-item ${note ? 'has-note' : ''}" data-key="${fmt.escape(noteKey)}">
          <i data-lucide="git-branch" class="w-3.5 h-3.5"></i>
          <span>${fmt.escape(name)}</span>
          ${note ? `<span class="dp-note-text">— ${fmt.escape(note)}</span>` : ''}
          <button class="dp-note-btn" data-note-target="${fmt.escape(noteKey)}">${note ? 'Edit note' : 'Add note'}</button>
        </div>`;
      }).join('')}</div>
    </div>`;
  }).join('');

  // Wire note buttons — click swaps to an inline editor; save persists via /api/notes.
  document.querySelectorAll('[data-note-target]').forEach(btn => {
    btn.addEventListener('click', () => openNoteEditor(btn.dataset.noteTarget));
  });
}

function openNoteEditor(key) {
  const row = document.querySelector(`[data-key="${CSS.escape(key)}"]`);
  if (!row || row.querySelector('.dp-note-editor')) return;
  const current = (state.snapshot?.featureNotes || {})[key] || '';
  const editor = document.createElement('div');
  editor.className = 'dp-note-editor';
  editor.innerHTML = `
    <input type="text" placeholder="e.g. Waiting on QA sign-off" value="${fmt.escape(current)}" maxlength="500" />
    <button class="btn-primary" style="padding:4px 10px;font-size:11px">Save</button>
    <button class="btn-secondary" style="padding:4px 10px;font-size:11px">Cancel</button>
  `;
  row.appendChild(editor);
  const input = editor.querySelector('input');
  input.focus(); input.select();
  const [saveBtn, cancelBtn] = editor.querySelectorAll('button');
  cancelBtn.addEventListener('click', () => editor.remove());
  const doSave = async () => {
    try {
      const r = await fetch('/api/notes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, note: input.value }),
      });
      if (r.ok) {
        const data = await r.json();
        state.snapshot.featureNotes = data.notes || {};
        renderPromotionQueue(state.snapshot);
        window.lucide?.createIcons();
      }
    } catch {}
  };
  saveBtn.addEventListener('click', doSave);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); doSave(); }
    if (e.key === 'Escape') editor.remove();
  });
}

// ---------- OVERVIEW TAB ----------
function renderOverview(s) {
  const label = s.todayProgress?.windowLabel || 'Today';
  const head = document.querySelector('#tab-overview > div > h2');
  if (head) head.textContent = label === 'Today' ? 'Today at a glance' : `${label} at a glance`;
  const sub = document.querySelector('#tab-overview > div > p');
  if (sub) sub.textContent = label === 'Today'
    ? 'Everything you need to know without opening a repo.'
    : `Repo is quiet — showing the ${label.toLowerCase()} to keep numbers meaningful.`;
  renderTodayProgress(s.todayProgress);
  renderNeedsAttention(s.needsAttention || []);
  renderWeeklySummary(s.weeklySummary);
  renderReleases('recent-releases', (s.recentlyReleased || []).map(r => ({ ...r, tone: 'production', foot: `Released ${fmt.relative(r.when)} · by ${niceName(r.by)}` })));
  renderReleases('upcoming-releases', (s.upcomingReleases || []).map(r => ({ ...r, tone: statusToneKey(r.stage), foot: `${r.readiness}% ready · currently in ${r.stage}` })));
}

function renderTodayProgress(tp) {
  const t = tp || {};
  const cells = [
    { n: t.started    ?? 0, l: 'Features Started',   icon: 'sparkles',  bg: 'bg-blue-500' },
    { n: t.toDev      ?? 0, l: 'Moved to Development', icon: 'code',   bg: 'bg-indigo-500' },
    { n: t.toTest     ?? 0, l: 'Moved to Testing',   icon: 'flask-conical', bg: 'bg-orange-500' },
    { n: t.released   ?? 0, l: 'Released',            icon: 'rocket',   bg: 'bg-emerald-500' },
    { n: t.activeDevs ?? 0, l: 'Active Developers',   icon: 'users',    bg: 'bg-slate-600' },
    { n: t.blocked    ?? 0, l: 'Blocked',             icon: 'ban',      bg: 'bg-rose-500' },
  ];
  document.getElementById('today-progress').innerHTML = cells.map(c => `
    <div class="tp-cell">
      <div class="tp-icon ${c.bg}"><i data-lucide="${c.icon}" class="w-3.5 h-3.5"></i></div>
      <div class="tp-num">${fmt.number(c.n)}</div>
      <div class="tp-lbl">${c.l}</div>
    </div>`).join('');
}

function renderNeedsAttention(rows) {
  const el = document.getElementById('needs-attention');
  if (!rows.length) { el.innerHTML = `<div class="na-row"><span class="na-dot good"></span><div class="flex-1"><div class="na-name">Nothing needs attention right now</div><div class="na-reason">Come back later.</div></div></div>`; return; }
  el.innerHTML = rows.map(r => `
    <div class="na-row" data-key="${fmt.escape(r.featureKey)}">
      <span class="na-dot ${r.severity}"></span>
      <div class="flex-1 min-w-0">
        <div class="na-name">${fmt.escape(r.name)}</div>
        <div class="na-reason">${fmt.escape(r.reason)}</div>
      </div>
      <i data-lucide="chevron-right" class="w-4 h-4 text-ink-400"></i>
    </div>`).join('');
  el.querySelectorAll('.na-row[data-key]').forEach(n => n.addEventListener('click', () => showFeature(n.dataset.key)));
}

function renderWeeklySummary(ws) {
  const el = document.getElementById('weekly-summary');
  if (!ws || !ws.bullets?.length) { el.innerHTML = `<div class="text-sm text-ink-500">No summary yet.</div>`; return; }
  el.innerHTML = `
    <div class="text-[11px] uppercase tracking-wide text-ink-500 mb-2">${fmt.escape(ws.period || 'This week')}</div>
    <ul>${ws.bullets.map(b => `<li>${fmt.escape(b)}</li>`).join('')}</ul>
    <div class="mt-4 flex justify-end">
      <button class="btn-secondary text-xs" onclick="navigator.clipboard?.writeText(${JSON.stringify(ws.bullets.map(b => '• ' + b).join('\n'))})"><i data-lucide="copy" class="w-3.5 h-3.5"></i>Copy summary</button>
    </div>`;
}

function renderReleases(id, items) {
  const el = document.getElementById(id);
  if (!items.length) { el.innerHTML = `<div class="text-sm text-ink-500 p-3">Nothing here yet.</div>`; return; }
  el.innerHTML = items.map(r => `
    <div class="rel-card" data-key="${fmt.escape(r.key || '')}">
      <div class="rel-name">${fmt.escape(r.name)}</div>
      <div class="rel-sub">${fmt.escape(r.foot)}</div>
      <div class="rel-foot">
        <span class="status-pill ${r.tone}">${fmt.escape(r.tone === 'production' ? 'Live' : (r.stage || 'Upcoming'))}</span>
      </div>
    </div>`).join('');
  el.querySelectorAll('.rel-card[data-key]').forEach(n => n.addEventListener('click', () => n.dataset.key && showFeature(n.dataset.key)));
}

// ---------- BOARD TAB ----------
const COLUMNS = [
  { key: 'Backlog',     tone: 'backlog', label: 'Backlog' },
  { key: 'Development', tone: 'dev',     label: 'Development' },
  { key: 'Testing',     tone: 'test',    label: 'Testing' },
  { key: 'Production',  tone: 'prod',    label: 'Production' },
];
const COL_DOT = { backlog:'#78716c', dev:'#2563eb', test:'#ea580c', prod:'#059669' };

function renderKanban(features, backlogActivities) {
  const grouped = { Backlog: [], Development: [], Testing: [], Production: [] };
  for (const f of features) grouped[bucketFor(f)].push(f);
  const countEl = document.getElementById('board-count');
  if (countEl) countEl.textContent = `${features.length} feature${features.length===1?'':'s'}`;

  document.getElementById('kanban').innerHTML = COLUMNS.map(col => {
    let cards = '';
    if (col.key === 'Backlog') {
      const items = (backlogActivities || []).filter(a =>
        !state.filters.search || a.name.toLowerCase().includes(state.filters.search.toLowerCase())
      ).slice(0, 12);
      cards = items.length === 0 ? emptyState('Nothing waiting.') : items.map(stickyBacklog).join('');
    } else {
      const items = grouped[col.key].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)).slice(0, 40);
      cards = items.length === 0 ? emptyState(`No features in ${col.label}.`) : items.map(f => stickyFeature(f, col.tone)).join('');
    }
    const count = col.key === 'Backlog' ? (backlogActivities || []).length : grouped[col.key].length;
    return `
      <div class="kanban-col">
        <div class="kanban-col-head">
          <span class="w-2 h-2 rounded-full" style="background:${COL_DOT[col.tone]}"></span>
          <span class="col-title">${col.label}</span>
          <span class="col-count">${count}</span>
        </div>
        <div class="kanban-col-body">${cards}</div>
      </div>`;
  }).join('');
  document.querySelectorAll('.note[data-key]').forEach(el => el.addEventListener('click', () => showFeature(el.dataset.key)));
  // Backlog rows carry data-href (real PR/issue URL) instead of / in addition
  // to data-key. Open in a new tab so the dashboard stays put.
  document.querySelectorAll('.note.backlog[data-href]').forEach(el => el.addEventListener('click', () => {
    if (el.dataset.key) return; // data-key handler above already fired
    window.open(el.dataset.href, '_blank', 'noopener');
  }));
}

function emptyState(text) { return `<div class="col-empty"><div class="text-3xl mb-2">🎉</div><div>${fmt.escape(text)}</div></div>`; }

function stickyBacklog(a) {
  // Click behaviour: prefer opening the PR/issue on GitHub when we have a
  // link (real snapshots include `a.url`); fall back to the feature drawer
  // when a matching feature key exists (mostly demo data / older backlog
  // rows). Silent no-op if neither is set — better than a dead click.
  const href = a.url ? ` data-href="${fmt.escape(a.url)}"` : '';
  const featureKey = a.featureKey ? ` data-key="${fmt.escape(a.featureKey)}"` : '';
  const clickable = a.url || a.featureKey ? ' clickable' : '';
  return `<div class="note backlog${clickable}" title="${fmt.escape(a.action)}"${href}${featureKey}>
    <div class="note-title">${fmt.escape(a.name)}</div>
    <div class="note-sub">${fmt.escape(niceName(a.person))} · ${fmt.escape(a.action)}</div>
    <div class="note-meta"><span>${fmt.relative(a.when)}</span></div>
  </div>`;
}

function timeInStageBadge(f) {
  const d = daysSince(f.enteredStageAt || f.updated_at);
  if (d === 0) return `<span class="tis">Today</span>`;
  // "longer than average" thresholds by stage
  const thresholds = { 'Backlog': 14, 'Development': 7, 'Code Review': 3, 'Testing': 4, 'UAT': 3, 'Production': 999 };
  const t = thresholds[f.stage] ?? 5;
  const tone = d >= t * 2 ? 'hot' : (d >= t ? 'warn' : '');
  const suffix = tone ? ' · longer than usual' : '';
  return `<span class="tis ${tone}" title="${fmt.escape(f.stage)} for ${d}d${suffix}">${d}d</span>`;
}

function stickyFeature(f, tone) {
  const display = f.displayName || humanize(f.title);
  const dev = niceName((f.developers || [])[0] || f.owner || 'Team');
  const secondaries = (f.developers || []).slice(1, 3).map(niceName);
  const av = f.commits?.[0]?.authorAvatar || null;
  const badge = ({ dev:'In Development', test:'Awaiting QA', prod:'Live', backlog:'Planned' })[tone] || 'Updated';
  const blocked = f.blocked || f.risk === 'High';
  return `<div class="note ${tone} ${blocked ? 'blocked' : ''}" data-key="${fmt.escape(f.key)}">
    <div class="note-title">${fmt.escape(display)}</div>
    <div class="note-sub">${fmt.escape(dev)}${secondaries.length ? ` +${secondaries.length}` : ''}</div>
    <div class="note-meta">
      ${avatar(av, dev, 'avatar')}
      <span>${fmt.relative(f.commits?.[0]?.date || f.updated_at)}</span>
      ${timeInStageBadge(f)}
      <span class="note-badge">${fmt.escape(badge)}</span>
    </div>
  </div>`;
}

// ---------- Activity ----------
function renderActivity(events) {
  const items = events.slice(0, 10);
  const root = document.getElementById('activity');
  if (!items.length) { root.innerHTML = `<div class="text-sm text-ink-500 py-6 text-center">No activity to show.</div>`; return; }
  root.innerHTML = items.map(e => `
    <div class="act-row">
      <div class="act-time">${fmt.clock(e.date)}</div>
      <div class="flex-1 min-w-0">
        <div class="act-text"><b>${fmt.escape(niceName(e.actor))}</b> ${fmt.escape(humanizeEventDetail(e))}</div>
        <div class="act-sub">${fmt.escape((e.repo || '').split('/').pop() || '')}</div>
      </div>
    </div>`).join('');
}

function humanizeEventDetail(e) {
  if (!e) return '';
  const d = e.detail || actionLabel(e.type);
  return d
    .replace(/pushed\s+(\d+)\s+commits?(?:\(s\))?\s+to\s+\S+/i, (_, n) => `pushed ${n} update${n === '1' ? '' : 's'}`)
    .replace(/\b(opened|closed|reopened|edited|merged)\s+PR\s+#\d+:?[^,]*/gi, '$1 a change')
    .replace(/\b(approved|commented|changes_requested)\s+PR\s+#\d+/gi, '$1 a change')
    .replace(/\b(opened|closed|reopened|commented)\s+issue\s+#\d+:?[^,]*/gi, (_, verb) => (verb === 'opened' ? 'requested a feature' : `${verb} a feature request`))
    .replace(/PR\s+#\d+/gi, 'a change')
    .replace(/issue\s+#\d+/gi, 'a feature request')
    .replace(/(published|created)\s+release\s+[^\s,]+/i, 'released a new version')
    .replace(/created\s+branch\s+[^\s,]+/i, 'started new work')
    .replace(/deleted\s+branch\s+[^\s,]+/i, 'archived a branch')
    .replace(/refs\/heads\/[^\s,)]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ---------- Notifications ----------
function renderNotifications(list) {
  const items = list.slice(0, 6);
  document.getElementById('notif-count').textContent = list.length ? `${list.length} updates` : '';
  const root = document.getElementById('notifications');
  if (items.length === 0) { root.innerHTML = `<div class="notif"><span class="n-dot info"></span><div>All clear — no attention needed.</div></div>`; return; }
  const REWRITE = {
    'build-failed':   { tone: 'error', label: () => `Something failed to build` },
    'stale-pr':       { tone: 'warn',  label: () => `A change is waiting for review` },
    'conflict':       { tone: 'warn',  label: () => `A change has a conflict` },
    'review-overdue': { tone: 'warn',  label: () => `A review is overdue` },
    'prod-deploy':    { tone: 'info',  label: () => `A feature went live` },
    'stuck-feature':  { tone: 'warn',  label: () => `A feature is stuck in review` },
  };
  root.innerHTML = items.map(n => {
    const rw = REWRITE[n.kind];
    const tone = rw ? rw.tone : (n.severity === 'error' ? 'error' : n.severity === 'warning' ? 'warn' : 'info');
    const text = rw ? rw.label(n) : n.title;
    return `<div class="notif"><span class="n-dot ${tone}"></span>
      <div class="flex-1 min-w-0"><div><b>${fmt.escape(text)}</b></div><div class="text-[11px] text-ink-500">${fmt.relative(n.when)}</div></div>
    </div>`;
  }).join('');
}

// ---------- Roadmap ----------
function renderRoadmapCard() {
  const featureIndex = new Map();
  for (const f of state.snapshot?.features || []) featureIndex.set(normalize(f.displayName || humanize(f.title)), f);
  const items = (state.roadmap || []).map(it => {
    const match = featureIndex.get(normalize(it.name));
    return match ? { ...it, liveStatus: matchStage(match), matched: true, featureKey: match.key } : { ...it, matched: false };
  });
  renderRoadmap(items, id => {
    const found = items.find(x => x.id === id);
    if (found?.featureKey) showFeature(found.featureKey);
  });
}
function matchStage(f) {
  if (f.stage === 'Production') return 'Production';
  if (['Testing','UAT'].includes(f.stage)) return 'Testing';
  if (['Development','Code Review'].includes(f.stage)) return 'Development';
  return 'Not Started';
}
function normalize(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }

// ---------- Roadmap buttons ----------
function setupRoadmapButtons() {
  document.getElementById('btn-roadmap-import').addEventListener('click', () => openImport());
  document.getElementById('btn-roadmap-seed').addEventListener('click', async () => {
    let items = state.snapshot?.roadmapSeed || [];
    if (!items.length) {
      const feats = (state.snapshot?.features || []).slice(0, 8);
      items = feats.map((f, i) => ({
        name: f.displayName || humanize(f.title),
        quarter: 'Q' + ((i % 4) + 1),
        status: matchStage(f),
        owner: niceName(f.owner || (f.developers || [])[0] || ''),
      }));
    }
    await fetch('/api/roadmap', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) });
    await refreshRoadmap();
  });
  document.getElementById('btn-import-save').addEventListener('click', async () => {
    const text = document.getElementById('import-text').value.trim(); if (!text) return;
    const contentType = /^\s*[\[{]/.test(text) ? 'application/json' : 'text/csv';
    const res = await fetch('/api/roadmap/upload', { method: 'POST', headers: { 'Content-Type': contentType }, body: text });
    if (res.ok) { closeImport(); await refreshRoadmap(); } else alert('Import failed: ' + (await res.text()));
  });
  document.getElementById('import-file').addEventListener('change', async e => {
    const file = e.target.files?.[0]; if (!file) return;
    document.getElementById('import-text').value = await file.text();
  });
}

// ---------- Executive Playback ----------
function setupPlayback() {
  document.getElementById('btn-playback').addEventListener('click', () => openPlayback());
  document.getElementById('pb-prev').addEventListener('click', () => pbStep(-1));
  document.getElementById('pb-next').addEventListener('click', () => pbStep(1));
  document.getElementById('pb-play').addEventListener('click', () => pbToggle());
  document.addEventListener('click', e => { if (e.target?.matches?.('[data-playback-close]')) closePlayback(); });
}

const pb = { idx: 0, playing: false, timer: null, barTimer: null, slides: [] };

function computeSlides() {
  const s = state.snapshot; if (!s) return [];
  const tp = s.todayProgress || {}; const ws = s.weeklySummary || {};
  const inTest = (s.features || []).filter(f => ['Testing','UAT'].includes(f.stage)).length;
  const inDev  = (s.features || []).filter(f => f.stage === 'Development').length;
  return [
    { title: `Today at a glance`, body: `<div class="pb-number">${tp.released ?? 0}</div><p>features released to production today.</p><p class="text-sm text-ink-500 mt-2">Across ${s.repositories?.length ?? 0} products, ${tp.activeDevs ?? 0} developers were active.</p>` },
    { title: `In motion`, body: `<p class="text-lg text-ink-900">${inDev} feature${inDev===1?'':'s'} being built, ${inTest} in QA.</p><p>Latest movement: <b>${niceName((s.activity || [])[0]?.actor || 'Team')}</b> ${humanizeEventDetail((s.activity || [])[0] || {})}.</p>` },
    { title: `Needs attention`, body: `<p>${(s.needsAttention || []).length} item${(s.needsAttention||[]).length===1?'':'s'} require attention.</p><ul class="pb-list mt-3">${(s.needsAttention || []).slice(0, 6).map(n => `<li><b>${fmt.escape(n.name)}</b> — ${fmt.escape(n.reason)}</li>`).join('') || '<li>Nothing right now — 🎉</li>'}</ul>` },
    { title: `${ws.period || 'This week'}`, body: `<ul class="pb-list mt-1">${(ws.bullets || []).map(b => `<li>${fmt.escape(b)}</li>`).join('')}</ul>` },
    { title: `Coming next`, body: `<ul class="pb-list mt-1">${(s.upcomingReleases || []).slice(0, 6).map(r => `<li><b>${fmt.escape(r.name)}</b> — ${r.readiness}% ready (${fmt.escape(r.stage)})</li>`).join('') || '<li>Nothing scheduled yet.</li>'}</ul>` },
  ];
}

function openPlayback() {
  pb.slides = computeSlides();
  pb.idx = 0;
  document.getElementById('playback').classList.remove('hidden');
  renderPbDots();
  renderPbSlide();
  pbPlay();
}
function closePlayback() {
  document.getElementById('playback').classList.add('hidden');
  pbStop();
}
function renderPbDots() {
  document.getElementById('pb-dots').innerHTML = pb.slides.map((_, i) => `<span class="pb-dot ${i === pb.idx ? 'active' : ''}" data-i="${i}"></span>`).join('');
  document.querySelectorAll('#pb-dots .pb-dot').forEach(d => d.addEventListener('click', () => { pb.idx = Number(d.dataset.i); renderPbSlide(); renderPbDots(); resetBar(); }));
}
function renderPbSlide() {
  const s = pb.slides[pb.idx]; if (!s) return;
  document.getElementById('pb-slide').innerHTML = `<h2>${fmt.escape(s.title)}</h2>${s.body}`;
  renderPbDots();
}
function pbStep(delta) {
  pb.idx = (pb.idx + delta + pb.slides.length) % pb.slides.length;
  renderPbSlide(); resetBar();
}
function pbToggle() { pb.playing ? pbStop() : pbPlay(); }
const SLIDE_MS = 6000;
function pbPlay() {
  pb.playing = true;
  document.getElementById('pb-play').innerHTML = `<i data-lucide="pause" class="w-4 h-4"></i>`; window.lucide?.createIcons();
  resetBar();
  pb.timer = setInterval(() => pbStep(1), SLIDE_MS);
}
function pbStop() {
  pb.playing = false;
  document.getElementById('pb-play').innerHTML = `<i data-lucide="play" class="w-4 h-4"></i>`; window.lucide?.createIcons();
  clearInterval(pb.timer); clearInterval(pb.barTimer);
  document.getElementById('pb-bar').style.width = '0';
}
function resetBar() {
  clearInterval(pb.barTimer);
  const bar = document.getElementById('pb-bar');
  bar.style.width = '0';
  if (!pb.playing) return;
  const started = Date.now();
  pb.barTimer = setInterval(() => {
    const pct = Math.min(100, ((Date.now() - started) / SLIDE_MS) * 100);
    bar.style.width = pct + '%';
    if (pct >= 100) clearInterval(pb.barTimer);
  }, 80);
}

// ---------- Theme + buttons ----------
function setupTheme() {
  const btn = document.getElementById('btn-theme');
  const applyIcon = () => {
    const dark = document.documentElement.classList.contains('dark');
    btn.innerHTML = `<i data-lucide="${dark ? 'sun' : 'moon'}" class="w-4 h-4"></i>`;
    window.lucide?.createIcons();
  };
  applyIcon();
  btn.addEventListener('click', () => {
    const dark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', dark ? 'dark' : 'light');
    applyIcon();
  });
}
function setupHeaderButtons() {
  document.getElementById('btn-refresh').addEventListener('click', () => refreshSnapshot(true));
  document.getElementById('btn-download-pdf')?.addEventListener('click', downloadOverviewPdf);
}

// PDF export via the browser's built-in print → Save as PDF. No external
// deps, no CDN. We force the user onto the Overview tab first so the
// currently-visible section matches what @media print scopes to, then call
// window.print(). CSS in styles.css hides everything except #tab-overview
// during print. Users get the native OS dialog and can pick their preferred
// PDF sink (Preview / Adobe / Chrome / whatever).
function downloadOverviewPdf() {
  if (state.currentTab !== 'overview') activateTab('overview');
  // let the tab-swap paint before the print dialog freezes the frame
  setTimeout(() => window.print(), 60);
}

window.app = { refreshSnapshot, refreshRoadmap };
