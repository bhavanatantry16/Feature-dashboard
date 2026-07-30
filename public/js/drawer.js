import { api } from './api.js';
import { fmt, humanize, niceName, statusToneKey } from './utils.js';

const drawer = () => document.getElementById('drawer');
const body   = () => document.getElementById('drawer-body');
const title  = () => document.getElementById('drawer-title');
const swatch = () => document.getElementById('drawer-swatch');

export function closeDrawer() { drawer().classList.add('hidden'); document.body.style.overflow = ''; }
document.addEventListener('click', e => { if (e.target?.matches?.('[data-drawer-close]')) closeDrawer(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });

function open(t, html, tone = 'not-started') {
  title().textContent = t; body().innerHTML = html;
  swatch().className = 'drawer-swatch ' + tone;
  drawer().classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  window.lucide?.createIcons();
}

function row(label, value) {
  return `<div class="flex items-baseline gap-3">
    <span class="text-[11px] uppercase tracking-wide text-ink-500 w-28 shrink-0">${label}</span>
    <span class="text-sm text-ink-900 dark:text-slate-100 flex-1 min-w-0">${value}</span>
  </div>`;
}
function section(t, html) {
  return `<div>
    <div class="text-[11px] uppercase tracking-wide text-ink-500 mb-2">${t}</div>
    ${html}
  </div>`;
}

const STAGES = ['Planned','Development','Code Review','Testing','Production'];
function stageIndex(stage) {
  return ({ 'Backlog':0, 'Development':1, 'Code Review':2, 'Testing':3, 'UAT':3, 'Production':4 })[stage] ?? 0;
}
function journey(stage) {
  const cur = stageIndex(stage);
  return `<div class="journey">
    ${STAGES.map((s, i) => {
      const cls = i < cur ? 'done' : (i === cur ? 'current' : '');
      const conn = i > 0 ? `<div class="j-connector ${i <= cur ? 'done' : ''}"></div>` : '';
      return `${conn}<div class="j-step"><div class="j-node ${cls}">${i < cur ? '✓' : i + 1}</div><div class="j-label">${s}</div></div>`;
    }).join('')}
  </div>`;
}

function readiness(score, checks) {
  const labels = { codeReview: 'Code Review', qa: 'QA', performance: 'Performance', security: 'Security', approvals: 'Approvals' };
  const items = Object.entries(labels).map(([k, l]) => {
    const done = !!(checks || {})[k];
    return `<div class="check ${done ? 'done' : ''}"><span class="box">${done ? '✓' : ''}</span>${l}</div>`;
  }).join('');
  return `<div class="readiness-block">
    <div class="readiness-ring" style="--v:${score};" data-v="${score}"></div>
    <div class="checks">${items}</div>
  </div>`;
}

function daysSince(iso) { if (!iso) return 0; return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000)); }

export async function showFeature(key) {
  open('Loading…', `<div class="h-4 rounded animate-pulse" style="background:rgba(148,163,184,.15)"></div><div class="h-24 rounded animate-pulse" style="background:rgba(148,163,184,.15)"></div>`, 'not-started');
  try {
    const f = await api.feature(key);
    if (!f) return open('Feature', `<div class="text-sm text-ink-500">Not found.</div>`);
    renderFeature(f);
  } catch (e) {
    open('Feature', `<div class="text-sm text-rose-500">${fmt.escape(e.message)}</div>`);
  }
}

function renderFeature(f) {
  const displayName = f.displayName || humanize(f.title);
  const owner = niceName(f.owner || (f.developers || [])[0] || 'Team');
  const developers = (f.developers || []).slice(0, 4).map(niceName);
  const currentStage = f.stage || 'Backlog';
  const tone = statusToneKey(currentStage);
  const inStageDays = daysSince(f.enteredStageAt || f.updated_at);
  const stageThresholds = { 'Backlog': 14, 'Development': 7, 'Code Review': 3, 'Testing': 4, 'UAT': 3, 'Production': 999 };
  const threshold = stageThresholds[currentStage] ?? 5;
  const overTime = inStageDays >= threshold;

  const ghLink = (f.repoFull && !/^https?:/.test(f.url || '')) ? `https://github.com/${f.repoFull}` : (f.url || '#');
  const readinessScore = f.readinessScore ?? 0;

  // Compose recent activity (max 5), no technical metadata
  const latestPr = (f.prs || [])[0];
  const latestDeploy = (f.deployments || [])[0];
  const latestActivity = (f.commits || [])[0];
  const events = [];
  if (latestDeploy) events.push({ t: latestDeploy.created_at, text: `Deployed to <b>${fmt.escape(latestDeploy.canonicalEnvironment || 'an environment')}</b> by <b>${fmt.escape(niceName(latestDeploy.creator))}</b>` });
  if (latestPr) events.push({ t: latestPr.merged_at || latestPr.created_at, text: latestPr.merged_at
      ? `<b>${fmt.escape(niceName(latestPr.author))}</b> merged the change`
      : `<b>${fmt.escape(niceName(latestPr.author))}</b> opened a review` });
  if (latestActivity) events.push({ t: latestActivity.date, text: `<b>${fmt.escape(niceName(latestActivity.author))}</b> pushed an update` });

  const html = `
    <div>
      <div class="flex items-center gap-2 mb-2 flex-wrap">
        <span class="status-pill ${tone}">${fmt.escape(currentStage)}</span>
        ${f.blocked ? '<span class="status-pill blocked">Blocked</span>' : ''}
        ${overTime ? `<span class="tis warn">${inStageDays}d in ${currentStage} · longer than usual</span>` : `<span class="tis">${inStageDays}d in ${currentStage}</span>`}
      </div>
      <div class="text-xl font-semibold leading-tight">${fmt.escape(displayName)}</div>
      <div class="text-sm text-ink-500 mt-1">${fmt.escape(f.description || (f.labels || []).join(' · ') || 'No description available.')}</div>
    </div>

    ${section('Feature Journey', journey(currentStage) + `<div class="mt-2 text-[11px] text-ink-500">${
      f.estimatedRelease ? `Estimated release: <b>${fmt.escape(new Date(f.estimatedRelease).toLocaleDateString(undefined, { weekday:'long' }))}</b> (${fmt.escape(f.estimatedRelease)})` : ''
    }</div>`)}

    ${section('Release Readiness', readiness(readinessScore, f.readinessChecks))}

    <div class="space-y-3">
      ${row('Developer', developers.length ? developers.map(d => `<span class="badge">${fmt.escape(d)}</span>`).join(' ') : fmt.escape(owner))}
      ${row('QA Owner', f.qaOwner ? fmt.escape(niceName(f.qaOwner)) : '<span class="text-ink-500">Not assigned</span>')}
      ${row('Reviewer', f.reviewer ? fmt.escape(niceName(f.reviewer)) : '<span class="text-ink-500">Not assigned</span>')}
      ${row('Product Owner', fmt.escape(owner))}
      ${row('Sprint', fmt.escape(f.milestone || '—'))}
      ${row('Last updated', fmt.relative(f.updated_at))}
    </div>

    ${(f.dependencies && f.dependencies.length) ? section('Waiting on', `
      <div class="space-y-2">${f.dependencies.map(d => `
        <div class="dep-row">
          <i data-lucide="link" class="w-3.5 h-3.5 text-ink-400"></i>
          <span class="flex-1">${fmt.escape(d.name)}</span>
          <span class="status-pill ${statusToneKey(d.stage || 'Not Started')}">${fmt.escape(d.stage || 'Not Started')}</span>
        </div>`).join('')}</div>`) : ''}

    ${section('Recent Activity',
      events.length === 0
        ? `<div class="text-sm text-ink-500">Nothing recent to show.</div>`
        : `<div class="space-y-2">${events.slice(0,5).map(e => `
              <div class="flex gap-3 items-start">
                <span class="w-2 h-2 rounded-full bg-ink-400 mt-2"></span>
                <div class="text-sm flex-1"><div>${e.text}</div><div class="text-xs text-ink-500">${fmt.relative(e.t)}</div></div>
              </div>`).join('')}</div>`
    )}

    <div class="pt-1">
      <a href="${fmt.escape(ghLink)}" target="_blank" rel="noopener" class="btn-primary">
        <i data-lucide="external-link" class="w-3.5 h-3.5"></i>Open on GitHub
      </a>
    </div>`;
  open(displayName, html, tone);
}
