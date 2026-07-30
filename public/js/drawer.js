// Feature Intelligence Drawer
// A single right-side drawer that turns any feature / PR / commit / issue /
// branch / release / deployment / workflow into a rich engineering workspace.
// It resolves everything from the already-loaded snapshot (no round-trips,
// no "Not found"), keeps itself open while you navigate between artefacts
// (back stack), and links every entity straight to GitHub.

import { api } from './api.js';
import { fmt, humanize, niceName, statusToneKey } from './utils.js';

// -------------------- DOM refs --------------------
const $ = id => document.getElementById(id);
const drawer   = () => $('drawer');
const panel    = () => $('drawer-panel');
const body     = () => $('drawer-body');
const titleEl  = () => $('drawer-title');
const kickerEl = () => $('drawer-kicker');
const swatchEl = () => $('drawer-swatch');
const backBtn  = () => $('drawer-back');
const footEl   = () => $('drawer-foot');
const searchWrap = () => $('drawer-searchbar');
const searchInput = () => $('drawer-search');

// -------------------- Module state --------------------
let snap = null;                 // latest snapshot (fed by app.js)
let stack = [];                  // navigation stack of view-builder thunks
let lastFocused = null;          // element focused before opening (for restore)

export function setSnapshot(s) { snap = s || snap; }

// ==================================================================
// GitHub URL builders — every entity gets its exact canonical URL.
// Prefer a real html_url from the API, fall back to constructing one.
// ==================================================================
const GH = {
  repo:    (full) => `https://github.com/${full}`,
  commit:  (full, sha) => `https://github.com/${full}/commit/${sha}`,
  pr:      (full, n) => `https://github.com/${full}/pull/${n}`,
  issue:   (full, n) => `https://github.com/${full}/issues/${n}`,
  release: (full, tag) => `https://github.com/${full}/releases/tag/${encodeURIComponent(tag)}`,
  branch:  (full, name) => `https://github.com/${full}/tree/${encodeURIComponent(name)}`,
  run:     (full, id) => `https://github.com/${full}/actions/runs/${id}`,
  compare: (full, a, b) => `https://github.com/${full}/compare/${a}...${b}`,
};
const realUrl = (u) => (typeof u === 'string' && /^https?:\/\//.test(u) && u !== '#') ? u : null;

// ==================================================================
// Small formatting helpers
// ==================================================================
const esc = fmt.escape;
function durationShort(ms) {
  if (!ms || ms < 0) return '—';
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60 ? (m % 60) + 'm' : ''}`.trim();
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24 ? (h % 24) + 'h' : ''}`.trim();
}
function daysSince(iso) { if (!iso) return 0; return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000)); }
function longDate(iso) { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }); }
function uniq(arr) { return Array.from(new Set(arr.filter(Boolean))); }

// ==================================================================
// Toast (copy feedback)
// ==================================================================
function toast(msg) {
  let t = $('drawer-toast');
  if (!t) { t = document.createElement('div'); t.id = 'drawer-toast'; t.className = 'drawer-toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 1800);
}
async function copy(text, label = 'Copied') {
  try { await navigator.clipboard.writeText(text); toast(`${label}`); }
  catch { toast('Copy failed'); }
}

// ==================================================================
// Markdown-lite renderer (safe: escapes first, then adds structure)
// ==================================================================
function mdInline(s) {
  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, t, u) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(])\*([^*\s][^*]*?)\*/g, '$1<em>$2</em>');
  return s;
}
function mdLite(src) {
  if (!src || !String(src).trim()) return '';
  const lines = String(src).replace(/\r\n/g, '\n').split('\n');
  let html = '', inUl = false;
  const closeUl = () => { if (inUl) { html += '</ul>'; inUl = false; } };
  for (const line of lines) {
    let m;
    if ((m = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/.exec(line))) {
      closeUl();
      const done = m[1].toLowerCase() === 'x';
      html += `<div class="md-check ${done ? 'done' : ''}"><span class="md-box">${done ? '✓' : ''}</span><span>${mdInline(m[2])}</span></div>`;
      continue;
    }
    if ((m = /^\s*[-*]\s+(.*)$/.exec(line))) {
      if (!inUl) { html += '<ul class="md-ul">'; inUl = true; }
      html += `<li>${mdInline(m[1])}</li>`;
      continue;
    }
    closeUl();
    if ((m = /^\s*#{1,3}\s+(.*)$/.exec(line))) { html += `<h4 class="md-h">${mdInline(m[1])}</h4>`; continue; }
    if (!line.trim()) continue;
    html += `<p class="md-p">${mdInline(line)}</p>`;
  }
  closeUl();
  return html;
}
function parseChecklist(body) {
  const out = []; const re = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/gm; let m;
  while ((m = re.exec(body || ''))) out.push({ done: m[1].toLowerCase() === 'x', text: m[2].trim() });
  return out;
}

// ==================================================================
// UI primitives
// ==================================================================
function section(title, inner, opts = {}) {
  if (opts.hideEmpty && !inner) return '';
  const id = opts.id ? ` data-sec="${opts.id}"` : '';
  const count = opts.count != null ? `<span class="d-sec-count">${opts.count}</span>` : '';
  return `<section class="d-sec"${id}>
    <div class="d-sec-head">${esc(title)}${count}</div>
    <div class="d-sec-body">${inner}</div>
  </section>`;
}
function meta(label, value) {
  return `<div class="d-meta"><span class="d-meta-k">${esc(label)}</span><span class="d-meta-v">${value}</span></div>`;
}
function pill(text, tone) {
  return `<span class="status-pill ${tone || statusToneKey(text)}">${esc(text)}</span>`;
}
function tag(text) { return `<span class="d-tag">${esc(text)}</span>`; }
function person(login) {
  if (!login) return '<span class="text-ink-500">Unassigned</span>';
  return `<span class="d-person">${esc(niceName(login))}</span>`;
}
function emptyState(icon, title, hint) {
  return `<div class="d-empty"><i data-lucide="${icon}" class="w-5 h-5"></i><div class="d-empty-t">${esc(title)}</div>${hint ? `<div class="d-empty-h">${esc(hint)}</div>` : ''}</div>`;
}
function metricCard(label, value, sub) {
  return `<div class="d-metric"><div class="d-metric-v">${value}</div><div class="d-metric-l">${esc(label)}</div>${sub ? `<div class="d-metric-s">${esc(sub)}</div>` : ''}</div>`;
}
// A clickable activity row that dispatches into the drawer via data-open.
function openAttrs(type, o) {
  const a = [`data-open="${type}"`];
  if (o.repoFull) a.push(`data-repo="${esc(o.repoFull)}"`);
  if (o.sha) a.push(`data-sha="${esc(o.sha)}"`);
  if (o.num != null) a.push(`data-num="${o.num}"`);
  if (o.tag) a.push(`data-tag="${esc(o.tag)}"`);
  if (o.name) a.push(`data-name="${esc(o.name)}"`);
  if (o.id != null) a.push(`data-id="${esc(o.id)}"`);
  return a.join(' ');
}
function activityRow(open, { icon, title, sub, right, tone, search }) {
  return `<button class="d-row" ${open} ${search != null ? `data-search="${esc(String(search).toLowerCase())}"` : ''}>
    <span class="d-row-ic ${tone || ''}"><i data-lucide="${icon}" class="w-3.5 h-3.5"></i></span>
    <span class="d-row-main">
      <span class="d-row-title">${title}</span>
      ${sub ? `<span class="d-row-sub">${sub}</span>` : ''}
    </span>
    ${right ? `<span class="d-row-right">${right}</span>` : ''}
    <i data-lucide="chevron-right" class="w-4 h-4 d-row-chev"></i>
  </button>`;
}

// ==================================================================
// Timeline component (color-coded, clickable nodes)
// ==================================================================
function timeline(nodes) {
  if (!nodes.length) return emptyState('git-commit-horizontal', 'No timeline events yet', 'Events appear as work moves through GitHub.');
  return `<div class="d-timeline">${nodes.map((n) => `
    <div class="d-tl-node ${n.done ? 'done' : (n.current ? 'current' : 'pending')} ${n.open ? 'clickable' : ''}" ${n.open || ''}>
      <span class="d-tl-marker ${n.tone || ''}"><i data-lucide="${n.icon}" class="w-3 h-3"></i></span>
      <div class="d-tl-content">
        <div class="d-tl-title">${esc(n.title)}</div>
        <div class="d-tl-meta">${n.meta ? esc(n.meta) : ''}${n.when ? `<span class="d-tl-when">${fmt.relative(n.when)}</span>` : ''}</div>
      </div>
    </div>`).join('')}</div>`;
}

// ==================================================================
// Snapshot lookups
// ==================================================================
function repoOf(repoFull) { return (snap?.repositories || []).find(r => r.full_name === repoFull); }
function findPR(repoFull, num) { return (snap?.prs || []).find(p => p.repoFull === repoFull && p.number === Number(num)); }
function findIssue(repoFull, num) { return (snap?.issues || []).find(i => i.repoFull === repoFull && i.number === Number(num)); }
function findCommit(repoFull, sha) { return (snap?.commits || []).find(c => c.repoFull === repoFull && (c.sha === sha || c.shortSha === sha)); }
function findBranch(repoFull, name) { return (snap?.branches || []).find(b => b.repoFull === repoFull && b.name === name); }
function findRelease(repoFull, tag) { return (snap?.releases || []).find(r => r.repoFull === repoFull && r.tag_name === tag); }
function findDeployment(repoFull, id) { return (snap?.deployments || []).find(d => d.repoFull === repoFull && String(d.id) === String(id)); }
function findRun(repoFull, id) { return (snap?.workflowRuns || []).find(r => r.repoFull === repoFull && String(r.id) === String(id)); }
function findFeature(key) { return (snap?.features || []).find(f => f.key === key || String(f.id) === String(key)); }

// ==================================================================
// Drawer open / close / navigation
// ==================================================================
export function closeDrawer() {
  drawer().classList.add('hidden');
  document.body.style.overflow = '';
  stack = [];
  if (searchWrap()) searchWrap().classList.add('hidden');
  if (lastFocused && lastFocused.focus) { try { lastFocused.focus(); } catch {} }
}

function openShell() {
  if (drawer().classList.contains('hidden')) {
    lastFocused = document.activeElement;
    drawer().classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    panel().classList.remove('anim');
    void panel().offsetWidth;         // reflow → restart slide animation
    panel().classList.add('anim');
    setTimeout(() => { const c = panel().querySelector('[data-drawer-close]'); c?.focus?.(); }, 60);
  }
}

// navigate(builder): push a new view; back stack keeps prior builders.
function navigate(builder) {
  stack.push(builder);
  render();
}
function back() { if (stack.length > 1) { stack.pop(); render(); } }

// Re-run the top builder and paint header/body/footer.
function render() {
  openShell();
  const builder = stack[stack.length - 1];
  let view;
  try { view = builder(); }
  catch (e) { view = errorView(e); }

  kickerEl().textContent = view.kicker || '';
  titleEl().textContent = view.title || '';
  titleEl().title = view.title || '';
  swatchEl().className = 'drawer-swatch ' + (view.tone || 'not-started');
  backBtn().classList.toggle('hidden', stack.length <= 1);
  body().scrollTop = 0;
  body().innerHTML = view.body || '';
  renderFooter(view);

  // reset + wire search
  if (searchWrap()) { searchWrap().classList.add('hidden'); }
  if (searchInput()) { searchInput().value = ''; applySearch(''); }

  window.lucide?.createIcons();
  view.hydrate?.(body());
}

function renderFooter(view) {
  const actions = [];
  if (view.ghUrl) actions.push(`<a href="${esc(view.ghUrl)}" target="_blank" rel="noopener" class="btn-primary d-foot-primary"><i data-lucide="external-link" class="w-3.5 h-3.5"></i>${esc(view.ghLabel || 'Open in GitHub')}</a>`);
  if (view.ghUrl) actions.push(`<button class="d-foot-btn" data-copy="${esc(view.ghUrl)}" data-copy-label="Link copied"><i data-lucide="link" class="w-3.5 h-3.5"></i>Copy link</button>`);
  if (view.copyId) actions.push(`<button class="d-foot-btn" data-copy="${esc(view.copyId)}" data-copy-label="ID copied"><i data-lucide="hash" class="w-3.5 h-3.5"></i>Copy ID</button>`);
  if (view.repoFull) actions.push(`<a href="${esc(GH.repo(view.repoFull))}" target="_blank" rel="noopener" class="d-foot-btn"><i data-lucide="folder-git-2" class="w-3.5 h-3.5"></i>Repository</a>`);
  if (view.ghUrl) actions.push(`<button class="d-foot-btn" data-share="${esc(view.ghUrl)}" data-share-title="${esc(view.title || '')}"><i data-lucide="share-2" class="w-3.5 h-3.5"></i>Share</button>`);
  footEl().innerHTML = actions.length ? `<div class="d-foot-row">${actions.join('')}</div>` : '';
  footEl().classList.toggle('hidden', !actions.length);
}

// -------------------- Search inside the drawer --------------------
function applySearch(q) {
  const query = (q || '').trim().toLowerCase();
  body().querySelectorAll('[data-search]').forEach(el => {
    const hay = el.getAttribute('data-search') || '';
    el.classList.toggle('d-hidden', !!query && !hay.includes(query));
  });
  body().querySelectorAll('.d-sec').forEach(sec => {
    const rows = sec.querySelectorAll('[data-search]');
    if (!rows.length) return;
    const anyVisible = Array.from(rows).some(r => !r.classList.contains('d-hidden'));
    sec.classList.toggle('d-dim', !!query && !anyVisible);
  });
}

// ==================================================================
// Error / loading views
// ==================================================================
function errorView(e) {
  return {
    kicker: 'Error', title: 'Something went wrong', tone: 'blocked',
    body: `<div class="d-error">
      <i data-lucide="alert-triangle" class="w-6 h-6"></i>
      <div class="d-error-t">We couldn't load this.</div>
      <div class="d-error-m">${esc(e?.message || 'Unknown error')}</div>
      <button class="btn-primary" id="d-retry"><i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>Retry</button>
    </div>`,
    hydrate(root) { root.querySelector('#d-retry')?.addEventListener('click', () => render()); },
  };
}

// ==================================================================
// FEATURE VIEW — the full engineering workspace
// ==================================================================
function metricsForFeature(f) {
  const prs = f.prs || [], commits = f.commits || [], deployments = f.deployments || [];
  const mergedPRs = prs.filter(p => p.merged_at);
  const filesChanged = prs.reduce((n, p) => n + (p.changed_files || 0), 0);
  const added = prs.reduce((n, p) => n + (p.additions || 0), 0);
  const removed = prs.reduce((n, p) => n + (p.deletions || 0), 0);
  const contributors = uniq([...(f.developers || []), f.owner, ...commits.map(c => c.author), ...prs.map(p => p.author)]);
  const commitDates = commits.map(c => new Date(c.date).getTime()).filter(Boolean);
  const devStart = commitDates.length ? Math.min(...commitDates) : (f.created_at ? new Date(f.created_at).getTime() : null);
  const devEnd = deployments.length ? Math.max(...deployments.map(d => new Date(d.created_at).getTime())) :
                 (commitDates.length ? Math.max(...commitDates) : Date.now());
  const devTime = devStart ? devEnd - devStart : 0;
  const reviewTimes = prs.filter(p => p.firstReviewAt).map(p => new Date(p.firstReviewAt) - new Date(p.created_at)).filter(x => x > 0);
  const reviewTime = reviewTimes.length ? reviewTimes.reduce((a, b) => a + b, 0) / reviewTimes.length : 0;
  const mergeTimes = mergedPRs.map(p => new Date(p.merged_at) - new Date(p.created_at)).filter(x => x > 0);
  const mergeTime = mergeTimes.length ? mergeTimes.reduce((a, b) => a + b, 0) / mergeTimes.length : 0;
  return { prs: prs.length, commits: commits.length, deployments: deployments.length, filesChanged, added, removed,
           contributors: contributors.length, devTime, reviewTime, mergeTime, mergedPRs: mergedPRs.length };
}

function featureSummary(f, m) {
  const bits = [];
  const name = f.displayName || humanize(f.title);
  bits.push(`<strong>${esc(name)}</strong> is currently in <strong>${esc(f.stage || 'Backlog')}</strong>`);
  if (m.commits || m.prs) {
    const parts = [];
    if (m.commits) parts.push(`${m.commits} commit${m.commits === 1 ? '' : 's'}`);
    if (m.prs) parts.push(`${m.prs} pull request${m.prs === 1 ? '' : 's'}`);
    bits.push(` built from ${parts.join(' and ')}`);
  }
  if (m.contributors) bits.push(` by ${m.contributors} contributor${m.contributors === 1 ? '' : 's'}`);
  let s = bits.join('') + '.';
  if (f.created_at) s += ` Work started ${longDate(f.created_at)}`;
  if (m.devTime) s += `, spanning ${durationShort(m.devTime)} of development`;
  s += '.';
  const prodDeploy = (f.deployments || []).some(d => d.canonicalEnvironment === 'Production' && d.state === 'success') || f.stage === 'Production';
  if (prodDeploy) s += ` It has shipped to <strong>Production</strong>.`;
  else if (m.deployments) s += ` It has ${m.deployments} deployment${m.deployments === 1 ? '' : 's'} so far, not yet in Production.`;
  else s += ` No deployments recorded yet.`;
  return s;
}

function buildFeatureTimeline(f) {
  const nodes = [];
  const commits = [...(f.commits || [])].sort((a, b) => new Date(a.date) - new Date(b.date));
  const prs = [...(f.prs || [])].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const deps = [...(f.deployments || [])].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const firstPR = prs[0];
  const mergedPR = prs.find(p => p.merged_at);
  const prodDep = deps.find(d => d.canonicalEnvironment === 'Production' && d.state === 'success');

  nodes.push({ title: `Issue #${f.id} opened`, icon: 'circle-dot', when: f.created_at, done: true, tone: 'purple',
    meta: 'Feature requested', open: openAttrs('issue', { repoFull: f.repoFull, num: f.id }) });
  if (commits[0]) nodes.push({ title: 'First commit', icon: 'git-commit-horizontal', when: commits[0].date, done: true, tone: 'blue',
    meta: commits[0].shortSha, open: openAttrs('commit', { repoFull: commits[0].repoFull, sha: commits[0].sha }) });
  if (commits.length > 2) nodes.push({ title: `${commits.length} commits pushed`, icon: 'git-branch', when: commits[commits.length - 1].date, done: true, tone: 'blue' });
  if (firstPR) nodes.push({ title: `PR #${firstPR.number} opened`, icon: 'git-pull-request', when: firstPR.created_at, done: true, tone: 'blue',
    meta: firstPR.title, open: openAttrs('pr', { repoFull: firstPR.repoFull, num: firstPR.number }) });
  if (firstPR?.firstReviewAt) nodes.push({ title: 'Review submitted', icon: 'message-square', when: firstPR.firstReviewAt, done: true, tone: 'orange',
    meta: firstPR.approvals ? `${firstPR.approvals} approval${firstPR.approvals === 1 ? '' : 's'}` : 'Under review' });
  if (mergedPR) nodes.push({ title: `PR #${mergedPR.number} merged`, icon: 'git-merge', when: mergedPR.merged_at, done: true, tone: 'purple',
    meta: mergedPR.mergedBy ? `by ${niceName(mergedPR.mergedBy)}` : '', open: openAttrs('pr', { repoFull: mergedPR.repoFull, num: mergedPR.number }) });
  for (const d of deps.filter(d => d.state === 'success' && d.canonicalEnvironment && d.canonicalEnvironment !== 'Production')) {
    nodes.push({ title: `Deployed to ${d.canonicalEnvironment}`, icon: 'server', when: d.created_at, done: true, tone: 'orange',
      meta: (d.sha || '').slice(0, 7), open: openAttrs('deployment', { repoFull: d.repoFull, id: d.id }) });
  }
  if (prodDep) nodes.push({ title: 'Released to Production', icon: 'rocket', when: prodDep.created_at, done: true, tone: 'green', current: true,
    meta: (prodDep.sha || '').slice(0, 7), open: openAttrs('deployment', { repoFull: prodDep.repoFull, id: prodDep.id }) });
  else nodes.push({ title: 'Production', icon: 'rocket', current: f.stage !== 'Backlog', pending: true, meta: 'Not yet released' });
  return nodes;
}

function relatedFeatureActivity(f) {
  const out = [];
  // PRs
  const prs = [...(f.prs || [])].sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
  const prSec = prs.length ? prs.map(p => activityRow(openAttrs('pr', { repoFull: p.repoFull, num: p.number }), {
    icon: p.merged_at ? 'git-merge' : (p.state === 'closed' ? 'git-pull-request-closed' : 'git-pull-request'),
    tone: p.merged_at ? 'purple' : (p.state === 'closed' ? 'red' : 'green'),
    title: `<span class="d-mono">#${p.number}</span> ${esc(fmt.short(p.title, 64))}`,
    sub: `${esc(niceName(p.author))} · ${p.merged_at ? 'Merged' : (p.draft ? 'Draft' : (p.state === 'open' ? 'Open' : 'Closed'))}`,
    right: fmt.relative(p.merged_at || p.updated_at || p.created_at),
    search: `${p.number} ${p.title} ${p.author}`,
  })).join('') : emptyState('git-pull-request', 'No Pull Requests linked yet', 'Open a PR that references #' + f.id + ' to see it here.');
  out.push(section('Pull Requests', prSec, { count: prs.length, id: 'prs' }));

  // Commits
  const commits = [...(f.commits || [])].sort((a, b) => new Date(b.date) - new Date(a.date));
  const cSec = commits.length ? commits.slice(0, 30).map(c => activityRow(openAttrs('commit', { repoFull: c.repoFull, sha: c.sha }), {
    icon: 'git-commit-horizontal', tone: 'blue',
    title: `<span class="d-mono">${esc(c.shortSha)}</span> ${esc(fmt.short(c.message, 60))}`,
    sub: esc(niceName(c.author)), right: fmt.relative(c.date), search: `${c.shortSha} ${c.message} ${c.author}`,
  })).join('') : emptyState('git-commit-horizontal', 'No commits linked yet', 'Commits mentioning #' + f.id + ' show up here.');
  out.push(section('Commits', cSec, { count: commits.length, id: 'commits' }));

  // Deployments
  const deps = [...(f.deployments || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const dSec = deps.length ? deps.map(d => activityRow(openAttrs('deployment', { repoFull: d.repoFull, id: d.id }), {
    icon: 'server', tone: d.state === 'success' ? 'green' : (d.state === 'failure' || d.state === 'error' ? 'red' : 'orange'),
    title: `${esc(d.canonicalEnvironment || d.environment || 'Deployment')} <span class="d-chip ${d.state === 'success' ? 'ok' : 'warn'}">${esc(d.state)}</span>`,
    sub: `${esc(niceName(d.creator))} · ${esc((d.sha || '').slice(0, 7))}`, right: fmt.relative(d.created_at),
    search: `${d.environment} ${d.state} ${d.creator}`,
  })).join('') : emptyState('server', 'No Deployments available', 'Deployments to Dev/Test/Prod will appear here.');
  out.push(section('Deployments', dSec, { count: deps.length, id: 'deployments' }));

  return out.join('');
}

function relatedRepoResources(f) {
  const out = [];
  // Branches referenced by this feature's PRs
  const headRefs = uniq((f.prs || []).map(p => p.head));
  const branches = (snap?.branches || []).filter(b => b.repoFull === f.repoFull && headRefs.includes(b.name));
  if (branches.length) {
    out.push(section('Branches', branches.map(b => activityRow(openAttrs('branch', { repoFull: b.repoFull, name: b.name }), {
      icon: 'git-branch', tone: 'blue', title: `<span class="d-mono">${esc(b.name)}</span>`,
      sub: b.protected ? 'Protected' : (b.env || 'feature branch'), search: b.name,
    })).join(''), { count: branches.length }));
  }
  // Repo releases (most recent 5)
  const releases = (snap?.releases || []).filter(r => r.repoFull === f.repoFull).slice(0, 5);
  if (releases.length) {
    out.push(section('Releases', releases.map(r => activityRow(openAttrs('release', { repoFull: r.repoFull, tag: r.tag_name }), {
      icon: 'package', tone: 'purple', title: `<span class="d-mono">${esc(r.tag_name)}</span> ${esc(fmt.short(r.name || '', 40))}`,
      sub: `${esc(niceName(r.author))}`, right: fmt.relative(r.published_at), search: `${r.tag_name} ${r.name}`,
    })).join(''), { count: releases.length }));
  }
  return out.join('');
}

function featureView(f) {
  const displayName = f.displayName || humanize(f.title);
  const tone = statusToneKey(f.stage || 'Backlog');
  const m = metricsForFeature(f);
  const ghUrl = realUrl(f.url) || GH.issue(f.repoFull, f.id);
  const inStage = daysSince(f.enteredStageAt || f.updated_at);
  const checklist = parseChecklist(f.body || f.description);
  const [owner, repo] = (f.repoFull || '/').split('/');

  const metricsGrid = `<div class="d-metrics">
    ${metricCard('Commits', m.commits)}
    ${metricCard('Pull Requests', m.prs, m.mergedPRs ? `${m.mergedPRs} merged` : '')}
    ${metricCard('Contributors', m.contributors)}
    ${metricCard('Deployments', m.deployments)}
    ${metricCard('Files Changed', fmt.number(m.filesChanged))}
    ${metricCard('Lines +', `<span class="d-add">+${fmt.number(m.added)}</span>`)}
    ${metricCard('Lines −', `<span class="d-del">−${fmt.number(m.removed)}</span>`)}
    ${metricCard('Dev Time', durationShort(m.devTime))}
    ${metricCard('Review Time', durationShort(m.reviewTime))}
    ${metricCard('Merge Time', durationShort(m.mergeTime))}
  </div>`;

  const metaGrid = `<div class="d-meta-grid">
    ${meta('Repository', `<a href="${GH.repo(f.repoFull)}" target="_blank" rel="noopener" class="d-link">${esc(repo || f.repoFull)}</a>`)}
    ${meta('Owner', esc(niceName(owner)))}
    ${meta('Feature ID', `<span class="d-mono">#${esc(f.id)}</span>`)}
    ${meta('Created', longDate(f.created_at))}
    ${meta('Last updated', fmt.relative(f.updated_at))}
    ${meta('Sprint', f.milestone ? esc(f.milestone) : '<span class="text-ink-500">—</span>')}
    ${meta('Progress', `<span class="d-progress"><span class="d-progress-bar" style="width:${f.progress || 0}%"></span></span> ${f.progress || 0}%`)}
    ${meta('Priority', pill(f.risk === 'High' ? 'High' : f.risk === 'Medium' ? 'Medium' : 'Normal', f.risk === 'High' ? 'blocked' : f.risk === 'Medium' ? 'waiting' : 'not-started'))}
    ${meta('Developer', (f.developers || []).length ? (f.developers || []).slice(0, 4).map(person).join(' ') : person(owner))}
    ${meta('Reviewer', f.reviewer ? person(f.reviewer) : ((f.prs || [])[0]?.reviewApprovers?.[0] ? person((f.prs || [])[0].reviewApprovers[0]) : '<span class="text-ink-500">Not assigned</span>'))}
  </div>`;

  const labels = (f.labels || []).length ? `<div class="d-tags">${(f.labels || []).map(tag).join('')}</div>` : '';

  const description = (f.description && f.description.trim())
    ? `<div class="d-md">${mdLite(f.description)}</div>`
    : emptyState('file-text', 'No description provided', 'Add a description to the GitHub issue to see it here.');

  const acceptance = checklist.length
    ? `<div class="d-checklist">${checklist.map(c => `<div class="md-check ${c.done ? 'done' : ''}"><span class="md-box">${c.done ? '✓' : ''}</span><span>${mdInline(c.text)}</span></div>`).join('')}</div>`
    : emptyState('list-checks', 'No acceptance criteria yet', 'Add a checklist to the issue body (- [ ] item).');

  const body = `
    <div class="d-hero">
      <div class="d-hero-pills">
        ${pill(f.stage || 'Backlog', tone)}
        ${f.blocked ? pill('Blocked', 'blocked') : ''}
        <span class="d-instage">${inStage}d in ${esc(f.stage || 'Backlog')}</span>
      </div>
      ${labels}
    </div>

    ${section('Summary', `<div class="d-summary">${featureSummary(f, m)}</div>`)}
    ${section('Metrics', metricsGrid)}
    ${section('Details', metaGrid)}
    ${section('Description', description)}
    ${section('Acceptance Criteria', acceptance)}
    ${section('Development Timeline', timeline(buildFeatureTimeline(f)))}
    ${relatedFeatureActivity(f)}
    ${relatedRepoResources(f)}
  `;

  return {
    kicker: 'Feature', title: displayName, tone, body,
    ghUrl, ghLabel: 'Open on GitHub', repoFull: f.repoFull, copyId: `#${f.id}`,
  };
}

// ==================================================================
// PR VIEW
// ==================================================================
function prView(p) {
  const ghUrl = realUrl(p.url) || GH.pr(p.repoFull, p.number);
  const state = p.merged_at ? 'Merged' : (p.draft ? 'Draft' : (p.state === 'open' ? 'Open' : 'Closed'));
  const tone = p.merged_at ? 'production' : (p.state === 'open' ? 'testing' : 'blocked');
  const checklist = parseChecklist(p.body);
  const commits = (snap?.commits || []).filter(c => c.repoFull === p.repoFull && (c.issues || []).some(n => (p.issues || []).includes(n)));

  const metaGrid = `<div class="d-meta-grid">
    ${meta('Author', person(p.author))}
    ${meta('State', pill(state, tone))}
    ${meta('Created', longDate(p.created_at))}
    ${meta('Merged', p.merged_at ? `${longDate(p.merged_at)}${p.mergedBy ? ' · ' + esc(niceName(p.mergedBy)) : ''}` : '<span class="text-ink-500">Not merged</span>')}
    ${meta('Branch', `<span class="d-mono">${esc(p.head || '?')}</span> → <span class="d-mono">${esc(p.base || '?')}</span>`)}
    ${meta('Merge commit', p.merge_commit_sha ? `<button class="d-linkbtn" ${openAttrs('commit', { repoFull: p.repoFull, sha: p.merge_commit_sha })}><span class="d-mono">${esc((p.merge_commit_sha || '').slice(0, 7))}</span></button>` : '<span class="text-ink-500">—</span>')}
    ${meta('Reviewers', (p.requestedReviewers || []).length ? (p.requestedReviewers || []).map(person).join(' ') : (p.reviewApprovers || []).length ? (p.reviewApprovers || []).map(person).join(' ') : '<span class="text-ink-500">None</span>')}
    ${meta('Approvals', `<span class="d-add">${p.approvals || 0} ✓</span>${p.changesRequested ? ` · <span class="d-del">${p.changesRequested} changes requested</span>` : ''}`)}
    ${meta('Mergeable', p.mergeable_state === 'dirty' ? pill('Conflict', 'blocked') : pill('Clean', 'production'))}
  </div>`;

  const metricsGrid = `<div class="d-metrics">
    ${metricCard('Commits', commits.length)}
    ${metricCard('Files', fmt.number(p.changed_files || 0))}
    ${metricCard('Lines +', `<span class="d-add">+${fmt.number(p.additions || 0)}</span>`)}
    ${metricCard('Lines −', `<span class="d-del">−${fmt.number(p.deletions || 0)}</span>`)}
    ${metricCard('Comments', p.comments || 0)}
    ${metricCard('Merge Time', p.merged_at ? durationShort(new Date(p.merged_at) - new Date(p.created_at)) : '—')}
  </div>`;

  const labels = (p.labels || []).length ? `<div class="d-tags">${(p.labels || []).map(tag).join('')}</div>` : '';
  const desc = (p.body && p.body.trim()) ? `<div class="d-md">${mdLite(p.body)}</div>` : emptyState('file-text', 'No description', 'This PR has no description.');
  const checklistHtml = checklist.length ? `<div class="d-checklist">${checklist.map(c => `<div class="md-check ${c.done ? 'done' : ''}"><span class="md-box">${c.done ? '✓' : ''}</span><span>${mdInline(c.text)}</span></div>`).join('')}</div>` : '';

  const commitsSec = commits.length
    ? commits.slice(0, 30).map(c => activityRow(openAttrs('commit', { repoFull: c.repoFull, sha: c.sha }), {
        icon: 'git-commit-horizontal', tone: 'blue',
        title: `<span class="d-mono">${esc(c.shortSha)}</span> ${esc(fmt.short(c.message, 60))}`,
        sub: esc(niceName(c.author)), right: fmt.relative(c.date), search: `${c.shortSha} ${c.message}`,
      })).join('')
    : emptyState('git-commit-horizontal', 'No commits resolved', 'Commits show when they reference the same issue.');

  const linkedIssues = (p.issues || []).map(n => {
    const iss = findIssue(p.repoFull, n);
    return activityRow(openAttrs('issue', { repoFull: p.repoFull, num: n }), {
      icon: 'circle-dot', tone: 'purple', title: `<span class="d-mono">#${n}</span> ${esc(iss ? fmt.short(iss.title, 56) : 'Linked issue')}`,
      sub: iss ? (iss.state === 'closed' ? 'Closed' : 'Open') : 'Referenced', search: `${n} ${iss?.title || ''}`,
    });
  }).join('');

  const body = `
    <div class="d-hero"><div class="d-hero-pills">${pill(state, tone)}<span class="d-instage"><span class="d-mono">#${p.number}</span></span></div>${labels}</div>
    ${section('Overview', metaGrid)}
    ${section('Metrics', metricsGrid)}
    ${section('Description', desc)}
    ${checklist.length ? section('Checklist', checklistHtml) : ''}
    ${section('Commits', commitsSec, { count: commits.length })}
    ${linkedIssues ? section('Linked Issues', linkedIssues, { count: (p.issues || []).length }) : ''}
  `;
  return { kicker: `Pull Request #${p.number}`, title: p.title, tone, body, ghUrl, ghLabel: 'Open Pull Request', repoFull: p.repoFull, copyId: `#${p.number}` };
}

// ==================================================================
// COMMIT VIEW (async: fetch diff & files)
// ==================================================================
function categorize(path) {
  const p = (path || '').toLowerCase();
  if (/(^|\/)(tests?|__tests__|spec)\//.test(p) || /\.(test|spec)\./.test(p)) return 'Tests';
  if (/\.(sql)$/.test(p) || /(^|\/)migrations?\//.test(p) || /(^|\/)(db|database)\//.test(p)) return 'Database';
  if (/(^|\/)(api|routes?|controllers?|server|services?)\//.test(p) || /\.(go|rb|py|java|php|rs)$/.test(p)) return 'Backend';
  if (/\.(css|scss|sass|less|tsx|jsx|vue|svelte|html)$/.test(p) || /(^|\/)(components?|pages?|public|ui|styles?|views?)\//.test(p)) return 'Frontend';
  if (/\.(ya?ml|json|toml|ini|env|lock|config)$/.test(p) || /dockerfile/.test(p) || /(^|\/)\.github\//.test(p)) return 'Config';
  return 'Other';
}
function commitView(c) {
  const ghUrl = realUrl(c.url) || GH.commit(c.repoFull, c.sha);
  const metaGrid = `<div class="d-meta-grid">
    ${meta('Commit', `<span class="d-mono">${esc(c.shortSha || (c.sha || '').slice(0, 7))}</span>`)}
    ${meta('Author', person(c.author))}
    ${meta('Date', longDate(c.date))}
    ${meta('Repository', `<a href="${GH.repo(c.repoFull)}" target="_blank" rel="noopener" class="d-link">${esc((c.repoFull || '').split('/')[1] || c.repoFull)}</a>`)}
    ${(c.issues || []).length ? meta('References', (c.issues || []).map(n => `<button class="d-linkbtn" ${openAttrs('issue', { repoFull: c.repoFull, num: n })}><span class="d-mono">#${n}</span></button>`).join(' ')) : ''}
  </div>`;
  const body = `
    ${section('Message', `<div class="d-commit-msg">${esc(c.message || '')}</div>`)}
    ${section('Details', metaGrid)}
    <div class="d-actions-inline">
      <button class="d-foot-btn" data-copy="${esc(c.sha)}" data-copy-label="Hash copied"><i data-lucide="hash" class="w-3.5 h-3.5"></i>Copy hash</button>
      <button class="d-foot-btn" data-copy="${esc(ghUrl)}" data-copy-label="URL copied"><i data-lucide="link" class="w-3.5 h-3.5"></i>Copy URL</button>
    </div>
    <div id="d-commit-files">${section('File Changes', `<div class="d-skeleton"></div><div class="d-skeleton"></div><div class="d-skeleton"></div>`)}</div>
  `;
  return {
    kicker: 'Commit', title: (c.message || 'Commit').split('\n')[0], tone: 'development', body,
    ghUrl, ghLabel: 'Open in GitHub', repoFull: c.repoFull, copyId: c.sha,
    async hydrate(root) {
      const host = root.querySelector('#d-commit-files');
      const [owner, repo] = (c.repoFull || '/').split('/');
      try {
        const detail = await api.commit(owner, repo, c.sha);
        const files = detail.files || [];
        const stats = detail.stats || { additions: 0, deletions: 0, total: files.length };
        const summary = `<div class="d-metrics">
          ${metricCard('Files Changed', files.length)}
          ${metricCard('Insertions', `<span class="d-add">+${fmt.number(stats.additions || 0)}</span>`)}
          ${metricCard('Deletions', `<span class="d-del">−${fmt.number(stats.deletions || 0)}</span>`)}
        </div>`;
        let filesHtml;
        if (!files.length) {
          filesHtml = emptyState('file-diff', 'No file changes', 'This commit changed no files (e.g. a merge commit).');
        } else {
          const groups = {};
          for (const f of files) { (groups[categorize(f.path)] ||= []).push(f); }
          filesHtml = Object.entries(groups).map(([grp, gfiles]) => `
            <div class="d-filegroup">
              <div class="d-filegroup-h">${esc(grp)} <span class="d-sec-count">${gfiles.length}</span></div>
              ${gfiles.map(f => `<div class="d-file" data-search="${esc(f.path.toLowerCase())}">
                <span class="d-file-status s-${esc(f.status || 'modified')}" title="${esc(f.status || '')}">${(f.status || 'M')[0].toUpperCase()}</span>
                <span class="d-file-path d-mono" title="${esc(f.path)}">${esc(f.path)}</span>
                <span class="d-file-nums"><span class="d-add">+${f.additions || 0}</span> <span class="d-del">−${f.deletions || 0}</span></span>
              </div>`).join('')}
            </div>`).join('');
        }
        host.innerHTML = section('Diff Summary', summary) + section('Changed Files', filesHtml, { count: files.length });
        window.lucide?.createIcons();
      } catch (e) {
        host.innerHTML = section('File Changes', `<div class="d-error small">
          <div class="d-error-m">Couldn't load the diff — ${esc(e.message || 'error')}.</div>
          <button class="btn-secondary" id="d-file-retry"><i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>Retry</button>
        </div>`);
        window.lucide?.createIcons();
        host.querySelector('#d-file-retry')?.addEventListener('click', () => render());
      }
    },
  };
}

// ==================================================================
// ISSUE VIEW
// ==================================================================
function issueView(i) {
  const ghUrl = realUrl(i.url) || GH.issue(i.repoFull, i.number);
  const tone = i.state === 'closed' ? 'production' : 'development';
  const checklist = parseChecklist(i.body);
  const linkedPRs = (snap?.prs || []).filter(p => p.repoFull === i.repoFull && (p.issues || []).includes(i.number));
  const feature = findFeature(`${i.repoFull}:${i.number}`);

  const metaGrid = `<div class="d-meta-grid">
    ${meta('State', pill(i.state === 'closed' ? 'Closed' : 'Open', tone))}
    ${meta('Author', person(i.author))}
    ${meta('Assignees', (i.assignees || []).length ? (i.assignees || []).map(person).join(' ') : '<span class="text-ink-500">None</span>')}
    ${meta('Created', longDate(i.created_at))}
    ${meta('Closed', i.closed_at ? longDate(i.closed_at) : '<span class="text-ink-500">Open</span>')}
    ${meta('Milestone', i.milestone ? esc(i.milestone) : '<span class="text-ink-500">—</span>')}
    ${meta('Comments', String(i.comments ?? feature?.commentsCount ?? 0))}
  </div>`;
  const labels = (i.labels || []).length ? `<div class="d-tags">${(i.labels || []).map(tag).join('')}</div>` : '';
  const desc = (i.body && i.body.trim()) ? `<div class="d-md">${mdLite(i.body)}</div>` : emptyState('file-text', 'No description', 'This issue has no body.');

  const prsSec = linkedPRs.length ? linkedPRs.map(p => activityRow(openAttrs('pr', { repoFull: p.repoFull, num: p.number }), {
    icon: p.merged_at ? 'git-merge' : 'git-pull-request', tone: p.merged_at ? 'purple' : 'green',
    title: `<span class="d-mono">#${p.number}</span> ${esc(fmt.short(p.title, 56))}`,
    sub: `${esc(niceName(p.author))} · ${p.merged_at ? 'Merged' : p.state}`, right: fmt.relative(p.updated_at), search: `${p.number} ${p.title}`,
  })).join('') : emptyState('git-pull-request', 'No Pull Requests linked', 'PRs that close this issue will appear here.');

  const body = `
    <div class="d-hero"><div class="d-hero-pills">${pill(i.state === 'closed' ? 'Closed' : 'Open', tone)}<span class="d-instage"><span class="d-mono">#${i.number}</span></span></div>${labels}</div>
    ${section('Overview', metaGrid)}
    ${section('Description', desc)}
    ${checklist.length ? section('Acceptance Criteria', `<div class="d-checklist">${checklist.map(c => `<div class="md-check ${c.done ? 'done' : ''}"><span class="md-box">${c.done ? '✓' : ''}</span><span>${mdInline(c.text)}</span></div>`).join('')}</div>`) : ''}
    ${section('Linked Pull Requests', prsSec, { count: linkedPRs.length })}
    ${feature ? `<div class="d-jumpcard" ${openAttrs('feature', { name: feature.key })}><i data-lucide="sparkles" class="w-4 h-4"></i><div><div class="d-jumpcard-t">View as feature workspace</div><div class="d-jumpcard-s">Full timeline, metrics & related resources</div></div><i data-lucide="chevron-right" class="w-4 h-4"></i></div>` : ''}
  `;
  return { kicker: `Issue #${i.number}`, title: i.title, tone, body, ghUrl, ghLabel: 'Open Issue', repoFull: i.repoFull, copyId: `#${i.number}` };
}

// ==================================================================
// BRANCH VIEW
// ==================================================================
function branchView(b) {
  const ghUrl = GH.branch(b.repoFull, b.name);
  const openPRs = (snap?.prs || []).filter(p => p.repoFull === b.repoFull && p.head === b.name && p.state === 'open');
  const runs = (snap?.workflowRuns || []).filter(r => r.repoFull === b.repoFull && r.branch === b.name).slice(0, 5);
  const metaGrid = `<div class="d-meta-grid">
    ${meta('Branch', `<span class="d-mono">${esc(b.name)}</span>`)}
    ${meta('Repository', `<a href="${GH.repo(b.repoFull)}" target="_blank" rel="noopener" class="d-link">${esc(b.repoFull.split('/')[1])}</a>`)}
    ${meta('Protected', b.protected ? pill('Protected', 'production') : '<span class="text-ink-500">No</span>')}
    ${meta('Environment', b.env ? pill(b.env) : '<span class="text-ink-500">—</span>')}
    ${meta('Last commit', `<button class="d-linkbtn" ${openAttrs('commit', { repoFull: b.repoFull, sha: b.commit?.sha })}><span class="d-mono">${esc((b.commit?.sha || '').slice(0, 7))}</span></button>`)}
    ${meta('Open PRs', String(openPRs.length))}
  </div>`;
  const prsSec = openPRs.length ? openPRs.map(p => activityRow(openAttrs('pr', { repoFull: p.repoFull, num: p.number }), {
    icon: 'git-pull-request', tone: 'green', title: `<span class="d-mono">#${p.number}</span> ${esc(fmt.short(p.title, 56))}`,
    sub: esc(niceName(p.author)), right: fmt.relative(p.updated_at), search: `${p.number} ${p.title}`,
  })).join('') : emptyState('git-pull-request', 'No open PRs from this branch', 'Open a PR to merge this branch.');
  const runsSec = runs.length ? runs.map(r => activityRow(openAttrs('run', { repoFull: r.repoFull, id: r.id }), {
    icon: 'workflow', tone: r.conclusion === 'success' ? 'green' : (r.conclusion === 'failure' ? 'red' : 'orange'),
    title: `${esc(r.name || 'Workflow')} <span class="d-chip ${r.conclusion === 'success' ? 'ok' : 'warn'}">${esc(r.conclusion || r.status)}</span>`,
    sub: esc(niceName(r.actor)), right: fmt.relative(r.created_at), search: r.name,
  })).join('') : '';
  const body = `
    ${section('Overview', metaGrid)}
    ${section('Open Pull Requests', prsSec, { count: openPRs.length })}
    ${runs.length ? section('Recent Workflow Runs', runsSec, { count: runs.length }) : ''}
  `;
  return { kicker: 'Branch', title: b.name, tone: 'development', body, ghUrl, ghLabel: 'View branch', repoFull: b.repoFull, copyId: b.name };
}

// ==================================================================
// RELEASE VIEW
// ==================================================================
function releaseView(r) {
  const ghUrl = realUrl(r.url) || GH.release(r.repoFull, r.tag_name);
  const metaGrid = `<div class="d-meta-grid">
    ${meta('Tag', `<span class="d-mono">${esc(r.tag_name)}</span>`)}
    ${meta('Name', esc(r.name || r.tag_name))}
    ${meta('Author', person(r.author))}
    ${meta('Published', longDate(r.published_at || r.created_at))}
    ${meta('Type', r.draft ? pill('Draft', 'not-started') : (r.prerelease ? pill('Pre-release', 'waiting') : pill('Stable', 'production')))}
    ${meta('Repository', `<a href="${GH.repo(r.repoFull)}" target="_blank" rel="noopener" class="d-link">${esc(r.repoFull.split('/')[1])}</a>`)}
  </div>`;
  const notes = (r.body && r.body.trim()) ? `<div class="d-md">${mdLite(r.body)}</div>` : emptyState('file-text', 'No release notes', 'This release has no notes.');
  const body = `
    ${section('Overview', metaGrid)}
    ${section('Release Notes', notes)}
    ${section('Assets', emptyState('package', 'No assets listed', 'Binary assets attached on GitHub open via the button below.'))}
  `;
  return { kicker: 'Release', title: r.name || r.tag_name, tone: 'production', body, ghUrl, ghLabel: 'Open Release', repoFull: r.repoFull, copyId: r.tag_name };
}

// ==================================================================
// DEPLOYMENT VIEW
// ==================================================================
function deploymentView(d) {
  const commit = findCommit(d.repoFull, d.sha);
  const ok = d.state === 'success';
  const tone = ok ? 'production' : (d.state === 'failure' || d.state === 'error' ? 'blocked' : 'waiting');
  const ghUrl = realUrl(d.target_url) || GH.commit(d.repoFull, d.sha);
  const metaGrid = `<div class="d-meta-grid">
    ${meta('Environment', pill(d.canonicalEnvironment || d.environment || 'Unknown', tone))}
    ${meta('Status', pill(d.state, tone))}
    ${meta('Deployed by', person(d.creator))}
    ${meta('When', longDate(d.created_at))}
    ${meta('Commit', `<button class="d-linkbtn" ${openAttrs('commit', { repoFull: d.repoFull, sha: d.sha })}><span class="d-mono">${esc((d.sha || '').slice(0, 7))}</span></button>`)}
    ${meta('Ref', `<span class="d-mono">${esc(d.ref || '—')}</span>`)}
    ${d.buildNumber ? meta('Build', `<span class="d-mono">${esc(d.buildNumber)}</span>`) : ''}
  </div>`;
  const body = `
    ${section('Overview', metaGrid)}
    ${d.description ? section('Description', `<div class="d-md">${mdLite(d.description)}</div>`) : ''}
    ${commit ? section('Deployed Commit', activityRow(openAttrs('commit', { repoFull: commit.repoFull, sha: commit.sha }), {
      icon: 'git-commit-horizontal', tone: 'blue', title: `<span class="d-mono">${esc(commit.shortSha)}</span> ${esc(fmt.short(commit.message, 56))}`,
      sub: esc(niceName(commit.author)), right: fmt.relative(commit.date),
    })) : ''}
  `;
  return { kicker: 'Deployment', title: `${d.canonicalEnvironment || d.environment || 'Deployment'} · ${d.state}`, tone, body,
    ghUrl, ghLabel: d.target_url && realUrl(d.target_url) ? 'Open deployment' : 'Open commit', repoFull: d.repoFull, copyId: String(d.id) };
}

// ==================================================================
// WORKFLOW RUN VIEW
// ==================================================================
function workflowView(r) {
  const ghUrl = realUrl(r.url) || GH.run(r.repoFull, r.id);
  const ok = r.conclusion === 'success';
  const tone = ok ? 'production' : (r.conclusion === 'failure' ? 'blocked' : 'waiting');
  const metaGrid = `<div class="d-meta-grid">
    ${meta('Workflow', esc(r.name || 'Workflow'))}
    ${meta('Status', pill(r.conclusion || r.status, tone))}
    ${meta('Event', esc(r.event || '—'))}
    ${meta('Branch', `<button class="d-linkbtn" ${openAttrs('branch', { repoFull: r.repoFull, name: r.branch })}><span class="d-mono">${esc(r.branch || '—')}</span></button>`)}
    ${meta('Triggered by', person(r.actor))}
    ${meta('When', longDate(r.created_at))}
    ${meta('Duration', r.duration ? durationShort(r.duration) : '—')}
  </div>`;
  const body = `${section('Overview', metaGrid)}`;
  return { kicker: 'Workflow Run', title: r.name || `Run ${r.id}`, tone, body, ghUrl, ghLabel: 'Open in GitHub', repoFull: r.repoFull, copyId: String(r.id) };
}

// ==================================================================
// Synthesize a feature-like view from a bare backlog item / PR / issue.
// Guarantees we NEVER show "Not found".
// ==================================================================
function genericView(key, hint) {
  const m = /^(.+):(\d+)$/.exec(key || '');
  const repoFull = m ? m[1] : (hint?.repoFull || '');
  const title = hint?.name || 'Item';
  const ghUrl = hint?.url && realUrl(hint.url) ? hint.url : (repoFull ? GH.repo(repoFull) : 'https://github.com');
  const body = `
    <div class="d-hero"><div class="d-hero-pills">${pill('Backlog', 'not-started')}</div></div>
    ${section('Summary', `<div class="d-summary">This item is on the backlog and hasn't been picked up into active development yet. Once a branch, commit or PR references it, a full engineering workspace will appear here automatically.</div>`)}
    ${repoFull ? section('Details', `<div class="d-meta-grid">${meta('Repository', `<a href="${GH.repo(repoFull)}" target="_blank" rel="noopener" class="d-link">${esc(repoFull)}</a>`)}${hint?.person ? meta('Raised by', person(hint.person)) : ''}${hint?.when ? meta('When', fmt.relative(hint.when)) : ''}</div>`) : ''}
    ${section('Pull Requests', emptyState('git-pull-request', 'No Pull Requests linked yet', 'Nothing in flight for this item.'))}
    ${section('Commits', emptyState('git-commit-horizontal', 'No commits yet', 'Work will show here once it starts.'))}
  `;
  return { kicker: 'Backlog Item', title, tone: 'not-started', body, ghUrl, ghLabel: 'Open in GitHub', repoFull };
}

// ==================================================================
// Public entry points
// ==================================================================
export function showFeature(key, hint) {
  const doIt = () => {
    const f = findFeature(key);
    if (f) return featureView(f);
    const m = /^(.+):(\d+)$/.exec(key || '');
    if (m) {
      const repoFull = m[1], num = Number(m[2]);
      const pr = findPR(repoFull, num);
      if (pr) return prView(pr);
      const iss = findIssue(repoFull, num);
      if (iss) return issueView(iss);
    }
    return genericView(key, hint);
  };
  // If snapshot hasn't arrived yet, fetch the single feature as a fallback.
  if (!snap) {
    navigate(() => ({ kicker: 'Feature', title: 'Loading…', tone: 'not-started', body: `<div class="d-skeleton"></div><div class="d-skeleton big"></div><div class="d-skeleton"></div>` }));
    api.feature(key).then(f => { if (f) { snap = snap || { features: [f], prs: [], issues: [], commits: [], branches: [], releases: [], deployments: [], workflowRuns: [], repositories: [] }; stack[stack.length - 1] = () => featureView(f); render(); } })
      .catch(() => { stack[stack.length - 1] = () => genericView(key, hint); render(); });
    return;
  }
  navigate(doIt);
}
export function showPR(pr) { navigate(() => prView(pr)); }
export function showCommit(c) { navigate(() => commitView(c)); }
export function showIssue(i) { navigate(() => issueView(i)); }
export function showBranch(b) { navigate(() => branchView(b)); }
export function showRelease(r) { navigate(() => releaseView(r)); }
export function showDeployment(d) { navigate(() => deploymentView(d)); }
export function showWorkflow(r) { navigate(() => workflowView(r)); }

// ==================================================================
// Global wiring (once)
// ==================================================================
function dispatchOpen(el) {
  const type = el.getAttribute('data-open');
  const repoFull = el.getAttribute('data-repo');
  const num = el.getAttribute('data-num');
  const sha = el.getAttribute('data-sha');
  const tag = el.getAttribute('data-tag');
  const name = el.getAttribute('data-name');
  const id = el.getAttribute('data-id');
  switch (type) {
    case 'feature': return showFeature(name);
    case 'pr':      { const p = findPR(repoFull, num); return p ? showPR(p) : showFeature(`${repoFull}:${num}`); }
    case 'issue':   { const i = findIssue(repoFull, num); return i ? showIssue(i) : showFeature(`${repoFull}:${num}`); }
    case 'commit':  { const c = findCommit(repoFull, sha) || { repoFull, sha, shortSha: (sha || '').slice(0, 7), message: 'Commit ' + (sha || '').slice(0, 7), author: '', date: null, issues: [] }; return showCommit(c); }
    case 'branch':  { const b = findBranch(repoFull, name) || { repoFull, name, commit: {} }; return showBranch(b); }
    case 'release': { const r = findRelease(repoFull, tag); return r ? showRelease(r) : null; }
    case 'deployment': { const d = findDeployment(repoFull, id); return d ? showDeployment(d) : null; }
    case 'run':     { const r = findRun(repoFull, id); return r ? showWorkflow(r) : null; }
  }
}

function wire() {
  // close
  document.addEventListener('click', e => { if (e.target?.closest?.('[data-drawer-close]')) closeDrawer(); });
  // back
  backBtn()?.addEventListener('click', back);
  // keyboard: ESC closes; but if a stack exists, ESC goes back first
  document.addEventListener('keydown', e => {
    if (drawer().classList.contains('hidden')) return;
    if (e.key === 'Escape') { e.preventDefault(); stack.length > 1 ? back() : closeDrawer(); }
  });
  // delegated clicks inside body → open sub-views
  body()?.addEventListener('click', e => {
    const openEl = e.target.closest('[data-open]');
    if (openEl) { e.preventDefault(); dispatchOpen(openEl); return; }
    const copyEl = e.target.closest('[data-copy]');
    if (copyEl) { e.preventDefault(); copy(copyEl.getAttribute('data-copy'), copyEl.getAttribute('data-copy-label') || 'Copied'); return; }
    const shareEl = e.target.closest('[data-share]');
    if (shareEl) {
      e.preventDefault();
      const url = shareEl.getAttribute('data-share'), title = shareEl.getAttribute('data-share-title') || 'Feature Tracker';
      if (navigator.share) navigator.share({ title, url }).catch(() => {});
      else copy(url, 'Link copied to share');
      return;
    }
  });
  // footer actions
  footEl()?.addEventListener('click', e => {
    const copyEl = e.target.closest('[data-copy]');
    if (copyEl) { e.preventDefault(); copy(copyEl.getAttribute('data-copy'), copyEl.getAttribute('data-copy-label') || 'Copied'); return; }
    const shareEl = e.target.closest('[data-share]');
    if (shareEl) {
      e.preventDefault();
      const url = shareEl.getAttribute('data-share'), title = shareEl.getAttribute('data-share-title') || 'Feature Tracker';
      if (navigator.share) navigator.share({ title, url }).catch(() => {});
      else copy(url, 'Link copied to share');
    }
  });
  // search
  $('drawer-search-toggle')?.addEventListener('click', () => {
    const wrap = searchWrap(); if (!wrap) return;
    wrap.classList.toggle('hidden');
    if (!wrap.classList.contains('hidden')) searchInput()?.focus();
    else { if (searchInput()) searchInput().value = ''; applySearch(''); }
  });
  searchInput()?.addEventListener('input', e => applySearch(e.target.value));
}

if (document.readyState !== 'loading') wire();
else document.addEventListener('DOMContentLoaded', wire);
