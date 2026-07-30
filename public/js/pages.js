// All section pages registered here. Each render function receives (snapshot) and returns HTML into #view.

import { register } from './router.js';
import { fmt, statusPill, avatar, exportCsv } from './utils.js';
import { baseOptions, upsert, palette } from './charts.js';
import { showFeature, showCommit } from './drawer.js';

const view = () => document.getElementById('view');
function html(str) { view().innerHTML = str; window.lucide?.createIcons(); }

// -------------------- Reusable widgets --------------------
function kpi(label, value, opts = {}) {
  return `<div class="kpi">
    <div class="kpi-icon bg-gradient-to-br ${opts.color || 'from-brand-500 to-fuchsia-500'}"><i data-lucide="${opts.icon || 'activity'}" class="w-4 h-4"></i></div>
    <div class="kpi-label">${label}</div>
    <div class="kpi-value">${value}</div>
    ${opts.sub ? `<div class="kpi-sub">${opts.sub}</div>` : ''}
  </div>`;
}

function trendPct(now, prev) {
  if (!prev) return '';
  const delta = ((now - prev) / prev) * 100;
  const up = delta >= 0;
  return `<span class="${up ? 'trend-up' : 'trend-down'}">${up ? '▲' : '▼'} ${Math.abs(delta).toFixed(0)}%</span> vs last week`;
}

// -------------------- Overview --------------------
register('overview', { label: 'Executive Overview', icon: 'gauge', subtitle: 'Engineering activity across your repositories' }, (s) => {
  const k = s.kpis;
  const cards = [
    kpi('Total Repositories', fmt.number(k.totalRepositories), { icon: 'folder-git-2', color: 'from-sky-500 to-cyan-500' }),
    kpi('Active Developers',  fmt.number(k.activeDevelopers),  { icon: 'users', color: 'from-violet-500 to-fuchsia-500' }),
    kpi("Today's Commits",    fmt.number(k.commitsToday),      { icon: 'git-commit-horizontal', color: 'from-emerald-500 to-teal-500', sub: trendPct(k.commitsWeek, k.commitsPrevWeek) }),
    kpi("Today's Pushes",     fmt.number(k.pushesToday),       { icon: 'upload', color: 'from-blue-500 to-indigo-500' }),
    kpi('Merged PRs Today',   fmt.number(k.mergedToday),       { icon: 'git-merge', color: 'from-fuchsia-500 to-pink-500' }),
    kpi('Open PRs',           fmt.number(k.openPRs),           { icon: 'git-pull-request', color: 'from-purple-500 to-pink-600' }),
    kpi('Failed Builds',      fmt.number(k.failedBuilds),      { icon: 'x-circle', color: 'from-rose-500 to-red-600' }),
    kpi('Successful Builds',  fmt.number(k.successfulBuilds),  { icon: 'check-circle-2', color: 'from-emerald-500 to-green-600' }),
    kpi('Pending Reviews',    fmt.number(k.pendingReviews),    { icon: 'clipboard-check', color: 'from-yellow-500 to-amber-600' }),
    kpi('Prod Releases (7d)', fmt.number(k.prodReleasesWeek),  { icon: 'rocket', color: 'from-teal-500 to-emerald-600' }),
    kpi('Avg Merge Time',     fmt.duration(k.avgMergeMs),      { icon: 'timer', color: 'from-slate-500 to-slate-700' }),
    kpi('Avg Review Time',    fmt.duration(k.avgReviewMs),     { icon: 'hourglass', color: 'from-slate-500 to-slate-700' }),
    kpi('Lead Time',          fmt.duration(k.leadTimeMs),      { icon: 'clock', color: 'from-amber-500 to-orange-500' }),
    kpi('Deploy Frequency',   `${k.deploymentFrequencyPerWeek}/wk`, { icon: 'zap', color: 'from-blue-500 to-cyan-500' }),
    kpi('Change Failure Rate',`${k.changeFailureRate}%`,       { icon: 'alert-triangle', color: 'from-orange-500 to-red-500' }),
    kpi('MTTR',               fmt.duration(k.mttrMs),          { icon: 'wrench', color: 'from-red-500 to-rose-600' }),
    kpi('Cycle Time',         fmt.duration(k.cycleTimeMs),     { icon: 'repeat', color: 'from-indigo-500 to-purple-600' }),
    kpi('Build Success Rate', `${k.buildSuccessRate}%`,        { icon: 'shield-check', color: 'from-emerald-500 to-teal-500' }),
  ].join('');

  html(`
    <section id="kpis" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">${cards}</section>

    <section class="glass rounded-2xl p-4">
      <div class="flex items-center gap-2 mb-2"><i data-lucide="lightbulb" class="w-4 h-4 text-brand-500"></i><h2 class="font-semibold">Smart Insights</h2></div>
      <ul class="text-sm space-y-1 list-disc pl-5">${(s.insights || []).map(i => `<li>${fmt.escape(i)}</li>`).join('')}</ul>
    </section>

    <div class="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <div class="chart-card glass"><div class="chart-title">Commits / day (30d)</div><div class="relative h-56"><canvas id="ov-commits"></canvas></div></div>
      <div class="chart-card glass"><div class="chart-title">Deployments / day (30d)</div><div class="relative h-56"><canvas id="ov-deploys"></canvas></div></div>
      <div class="chart-card glass"><div class="chart-title">Top Developers</div><div class="relative h-56"><canvas id="ov-devs"></canvas></div></div>
    </div>
  `);

  const c = palette();
  upsert('ov-commits', { type: 'line',
    data: { labels: s.analytics.labels, datasets: [{ label: 'Commits', data: s.analytics.commitsPerDay, borderColor: c[0], backgroundColor: c[0] + '33', fill: true, tension: 0.3 }] },
    options: baseOptions(),
  });
  upsert('ov-deploys', { type: 'bar',
    data: { labels: s.analytics.labels, datasets: [{ label: 'Deploys', data: s.analytics.deploysPerDay, backgroundColor: c[4], borderRadius: 6 }] },
    options: baseOptions(),
  });
  upsert('ov-devs', { type: 'bar',
    data: { labels: s.analytics.topDevelopers.labels, datasets: [{ label: 'Commits', data: s.analytics.topDevelopers.data, backgroundColor: c[2], borderRadius: 6 }] },
    options: baseOptions({ indexAxis: 'y' }),
  });
});

// -------------------- Live Activity --------------------
register('activity', { label: 'Live Activity', icon: 'activity', subtitle: 'Real-time engineering feed' }, (s) => {
  const items = s.activity.slice(0, 100).map(a => `
    <div class="tl-item ${a.type === 'PushEvent' ? 'ok' : (a.type.includes('Delete') ? 'fail' : '')}">
      <div class="flex items-center gap-2">
        ${avatar(a.actorAvatar, a.actor)}
        <div class="flex-1 text-sm"><span class="font-semibold">${fmt.escape(a.actor || 'unknown')}</span> · <span class="text-slate-600 dark:text-slate-300">${fmt.escape(a.detail)}</span></div>
        <span class="text-xs text-slate-500" title="${fmt.escape(fmt.datetime(a.date))}">${fmt.relative(a.date)}</span>
      </div>
      <div class="mt-0.5 text-xs text-slate-500 mono">${fmt.escape(a.repo)}</div>
    </div>`).join('');
  html(`
    <div class="glass rounded-2xl p-4">
      <div class="flex items-center gap-2 mb-3"><i data-lucide="activity" class="w-4 h-4 text-brand-500"></i><h2 class="font-semibold">Engineering Timeline</h2>
      <span class="ml-auto text-xs text-slate-500">${s.activity.length} events</span></div>
      <div class="max-h-[680px] overflow-auto pr-2">${items || '<div class="text-sm text-slate-400 p-6 text-center">No activity.</div>'}</div>
    </div>`);
});

// -------------------- Git Activity Analytics --------------------
register('analytics', { label: 'Git Activity Analytics', icon: 'line-chart', subtitle: 'Commits, pushes and heatmap' }, (s) => {
  const a = s.analytics;
  html(`
    <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <div class="chart-card glass"><div class="chart-title">Commits vs Deploys / day</div><div class="relative h-64"><canvas id="an-multi"></canvas></div></div>
      <div class="chart-card glass"><div class="chart-title">Merge Time Distribution</div><div class="relative h-64"><canvas id="an-merge"></canvas></div></div>
    </div>
    <div class="chart-card glass mt-4">
      <div class="chart-title">Commit Heatmap (day × hour, last 30 days)</div>
      <div id="heat" class="heatmap" style="grid-template-columns: 80px repeat(24, 1fr);"></div>
    </div>`);

  const c = palette();
  upsert('an-multi', { type: 'line',
    data: { labels: a.labels, datasets: [
      { label: 'Commits', data: a.commitsPerDay, borderColor: c[0], backgroundColor: c[0]+'22', fill: true, tension: 0.3 },
      { label: 'Deploys', data: a.deploysPerDay, borderColor: c[4], backgroundColor: c[4]+'22', fill: true, tension: 0.3 },
    ] },
    options: baseOptions(),
  });
  upsert('an-merge', { type: 'doughnut',
    data: { labels: a.mergeTimeBuckets.labels, datasets: [{ data: a.mergeTimeBuckets.data, backgroundColor: c, borderWidth: 0 }] },
    options: baseOptions({ cutout: '55%', scales: {} }),
  });

  // Heatmap
  const heatEl = document.getElementById('heat');
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  let out = '';
  const flat = a.heatmap.flat();
  const max = Math.max(1, ...flat);
  for (let d = 0; d < 7; d++) {
    out += `<div class="text-[11px] text-slate-500 flex items-center">${days[d]}</div>`;
    for (let h = 0; h < 24; h++) {
      const v = a.heatmap[d][h] / max;
      out += `<div class="heat-cell" style="--v:${(v * 6).toFixed(2)}; height: 14px;" title="${days[d]} ${h}:00 — ${a.heatmap[d][h]} commits"></div>`;
    }
  }
  heatEl.innerHTML = out;
});

// -------------------- Contributors --------------------
register('contributors', { label: 'Contributors', icon: 'users', subtitle: 'Developer performance & activity' }, (s) => {
  const cards = s.contributors.slice(0, 24).map(c => {
    const authored = s.commits.filter(x => x.author === c.login);
    const prsBy = s.prs.filter(p => p.author === c.login);
    const merged = prsBy.filter(p => p.merged_at).length;
    const additions = prsBy.reduce((n, p) => n + (p.additions || 0), 0);
    const deletions = prsBy.reduce((n, p) => n + (p.deletions || 0), 0);
    const lastActive = authored[0]?.date || null;
    return `
      <div class="glass rounded-2xl p-4">
        <div class="flex items-center gap-3">
          ${avatar(c.avatar, c.login).replace('avatar', 'avatar avatar-lg')}
          <div class="min-w-0">
            <div class="font-semibold truncate">${fmt.escape(c.login)}</div>
            <div class="text-xs text-slate-500 truncate">${(c.repos || []).length} repos · last active ${fmt.relative(lastActive)}</div>
          </div>
          <div class="ml-auto text-right text-xs">
            <div class="font-bold text-lg">${fmt.number(c.contributions)}</div>
            <div class="text-slate-500">total commits</div>
          </div>
        </div>
        <div class="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div class="rounded-lg bg-slate-100/60 dark:bg-slate-800/60 p-2"><div class="text-slate-500">Recent commits</div><div class="font-bold text-sm">${authored.length}</div></div>
          <div class="rounded-lg bg-slate-100/60 dark:bg-slate-800/60 p-2"><div class="text-slate-500">Merged PRs</div><div class="font-bold text-sm">${merged}</div></div>
          <div class="rounded-lg bg-slate-100/60 dark:bg-slate-800/60 p-2"><div class="text-slate-500">Lines +</div><div class="font-bold text-sm text-emerald-600">${fmt.number(additions)}</div></div>
          <div class="rounded-lg bg-slate-100/60 dark:bg-slate-800/60 p-2"><div class="text-slate-500">Lines −</div><div class="font-bold text-sm text-rose-600">${fmt.number(deletions)}</div></div>
        </div>
      </div>`;
  }).join('');
  html(`<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">${cards || '<div class="text-sm text-slate-400">No contributors.</div>'}</div>`);
});

// -------------------- Commits --------------------
register('commits', { label: 'Commits', icon: 'git-commit-horizontal', subtitle: 'Every commit across your repositories' }, (s) => {
  const rows = s.commits.slice(0, 200).map(c => `
    <tr class="cursor-pointer" data-sha="${fmt.escape(c.sha)}" data-repo="${fmt.escape(c.repoFull)}">
      <td class="mono text-brand-600">${fmt.escape(c.shortSha)}</td>
      <td>${avatar(c.authorAvatar, c.author)} <span class="ml-1">${fmt.escape(c.author)}</span></td>
      <td title="${fmt.escape(c.message)}">${fmt.escape(fmt.short(c.message, 80))}</td>
      <td class="mono">${fmt.escape(c.repo)}</td>
      <td>${(c.issues || []).map(i => `<span class="pill pill-brand mr-1">#${i}</span>`).join('') || '—'}</td>
      <td title="${fmt.escape(fmt.datetime(c.date))}">${fmt.relative(c.date)}</td>
    </tr>`).join('');
  html(`<div class="glass rounded-2xl overflow-hidden"><div class="table-wrap"><table class="dtable">
    <thead><tr><th>SHA</th><th>Author</th><th>Message</th><th>Repo</th><th>Issues</th><th>When</th></tr></thead>
    <tbody id="commit-tbody">${rows}</tbody>
  </table></div></div>`);
  document.getElementById('commit-tbody').addEventListener('click', e => {
    const tr = e.target.closest('tr'); if (!tr) return;
    const c = s.commits.find(x => x.sha === tr.dataset.sha);
    if (c) showCommit(c);
  });
});

// -------------------- Pull Requests (Kanban + Table) --------------------
register('pulls', { label: 'Pull Requests', icon: 'git-pull-request', subtitle: 'Kanban board + intelligence' }, (s) => {
  const cols = [
    { key: 'draft', label: 'Draft', filter: p => p.draft },
    { key: 'open',  label: 'Open',  filter: p => p.state === 'open' && !p.draft && p.approvals === 0 },
    { key: 'review',label: 'In Review', filter: p => p.state === 'open' && p.firstReviewAt && !p.merged_at },
    { key: 'approved', label: 'Approved', filter: p => p.state === 'open' && p.approvals > 0 && !p.merged_at },
    { key: 'merged',label: 'Merged', filter: p => !!p.merged_at },
    { key: 'closed',label: 'Closed', filter: p => p.state === 'closed' && !p.merged_at },
  ];
  const kanban = cols.map(col => {
    const items = s.prs.filter(col.filter).slice(0, 20);
    return `<div class="kanban-col">
      <h4><i data-lucide="git-pull-request" class="w-3.5 h-3.5"></i>${col.label}<span class="ml-auto pill pill-neutral">${items.length}</span></h4>
      ${items.map(p => `<div class="kanban-card">
        <div class="text-xs font-semibold">#${p.number} <span class="text-slate-500">· ${fmt.escape(p.repo)}</span></div>
        <div class="text-sm mt-1">${fmt.escape(fmt.short(p.title, 60))}</div>
        <div class="flex items-center gap-1 mt-2 flex-wrap">
          ${avatar(p.authorAvatar, p.author)}
          <span class="pill pill-brand">${fmt.escape(p.author)}</span>
          ${p.mergeable_state === 'dirty' ? '<span class="pill pill-fail">Conflict</span>' : ''}
          ${p.changesRequested > 0 ? '<span class="pill pill-warn">Changes</span>' : ''}
          ${p.approvals > 0 ? `<span class="pill pill-ok">${p.approvals} ✓</span>` : ''}
          <span class="ml-auto text-[11px] text-slate-500">${fmt.relative(p.updated_at)}</span>
        </div>
      </div>`).join('') || '<div class="text-xs text-slate-400 py-2">Empty</div>'}
    </div>`;
  }).join('');

  const rows = s.prs.slice(0, 80).map(p => `
    <tr>
      <td>#${p.number}</td>
      <td>${fmt.escape(fmt.short(p.title, 60))}</td>
      <td>${avatar(p.authorAvatar, p.author)} <span class="ml-1">${fmt.escape(p.author)}</span></td>
      <td>${(p.requestedReviewers || []).slice(0,3).map(r => `<span class="pill pill-neutral mr-1">${fmt.escape(r)}</span>`).join('') || '—'}</td>
      <td>${p.approvals || 0} ✓ / ${p.changesRequested || 0} ✗</td>
      <td>${statusPill(p.state)}${p.merged_at ? ' · <span class="pill pill-ok">merged</span>' : ''}</td>
      <td class="mono">${fmt.escape(p.head)} → ${fmt.escape(p.base)}</td>
      <td>${fmt.relative(p.updated_at)}</td>
    </tr>`).join('');
  html(`
    <section class="mb-4">
      <div class="kanban">${kanban}</div>
    </section>
    <div class="glass rounded-2xl overflow-hidden"><div class="table-wrap"><table class="dtable">
      <thead><tr><th>PR</th><th>Title</th><th>Author</th><th>Reviewers</th><th>Votes</th><th>Status</th><th>Branch</th><th>Updated</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div></div>`);
});

// -------------------- Branches --------------------
register('branches', { label: 'Branches', icon: 'git-branch', subtitle: 'Every branch + relationships' }, (s) => {
  const byRepo = new Map();
  for (const b of s.branches) {
    if (!byRepo.has(b.repoFull)) byRepo.set(b.repoFull, []);
    byRepo.get(b.repoFull).push(b);
  }
  const trees = Array.from(byRepo.entries()).map(([repo, branches]) => `
    <div class="glass rounded-2xl p-4">
      <div class="flex items-center gap-2 mb-2"><i data-lucide="folder-git-2" class="w-4 h-4 text-brand-500"></i><span class="font-semibold mono">${fmt.escape(repo)}</span><span class="ml-auto text-xs text-slate-500">${branches.length} branches</span></div>
      <ul class="text-sm space-y-1">
        ${branches.map(b => `<li class="flex items-center gap-2">
          <i data-lucide="git-branch" class="w-3.5 h-3.5 text-slate-400"></i>
          <span class="mono">${fmt.escape(b.name)}</span>
          ${b.protected ? '<span class="pill pill-brand">protected</span>' : ''}
          ${b.env ? `<span class="pill pill-info">${b.env}</span>` : ''}
          <span class="ml-auto text-xs text-slate-500 mono">${fmt.escape((b.commit?.sha || '').slice(0,7))}</span>
        </li>`).join('')}
      </ul>
    </div>`).join('');
  html(`<div class="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">${trees}</div>`);
});

// -------------------- Features --------------------
register('features', { label: 'Features', icon: 'sparkles', subtitle: 'Feature registry with progress & risk' }, (s) => {
  const rows = s.features.slice(0, 80).map(f => `
    <tr class="cursor-pointer" data-key="${fmt.escape(f.key)}">
      <td>#${f.id}</td>
      <td>${fmt.escape(fmt.short(f.title, 60))}</td>
      <td>${fmt.escape(f.owner || '—')}</td>
      <td class="mono">${fmt.escape(f.repoFull)}</td>
      <td>${statusPill(f.stage)}</td>
      <td><span class="pill pill-info">${fmt.escape(f.currentEnvironment || '—')}</span></td>
      <td><span class="pill ${f.risk==='High'?'pill-fail':(f.risk==='Medium'?'pill-warn':'pill-ok')}">${f.risk}</span></td>
      <td><div class="h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden w-24"><div class="h-full bg-gradient-to-r from-brand-500 to-fuchsia-500" style="width:${f.progress}%"></div></div></td>
      <td>${fmt.relative(f.updated_at)}</td>
    </tr>`).join('');
  html(`<div class="glass rounded-2xl overflow-hidden"><div class="table-wrap"><table class="dtable">
    <thead><tr><th>ID</th><th>Feature</th><th>Owner</th><th>Repo</th><th>Stage</th><th>Env</th><th>Risk</th><th>Progress</th><th>Updated</th></tr></thead>
    <tbody id="feat-tbody">${rows}</tbody>
  </table></div></div>`);
  document.getElementById('feat-tbody').addEventListener('click', e => {
    const tr = e.target.closest('tr'); if (!tr) return; showFeature(tr.dataset.key);
  });
});

// -------------------- Feature Lifecycle --------------------
register('lifecycle', { label: 'Feature Lifecycle', icon: 'kanban', subtitle: 'Pipeline: Backlog → Production' }, (s) => {
  const stages = ['Backlog','Development','Code Review','Testing','UAT','Production'];
  const cols = stages.map(st => {
    const items = s.features.filter(f => f.stage === st).slice(0, 20);
    return `<div class="lc-stage">
      <h5>${st} <span class="ml-auto text-slate-500 font-normal">${items.length}</span></h5>
      ${items.map(f => `<div class="kanban-card" data-key="${fmt.escape(f.key)}">
        <div class="text-xs text-slate-500">#${f.id} · ${fmt.escape(f.repoFull.split('/')[1] || f.repoFull)}</div>
        <div class="text-sm mt-0.5">${fmt.escape(fmt.short(f.title, 60))}</div>
        <div class="mt-2 flex items-center gap-1">
          <span class="pill ${f.risk==='High'?'pill-fail':(f.risk==='Medium'?'pill-warn':'pill-ok')}">${f.risk}</span>
          <span class="ml-auto text-[11px] text-slate-500">${fmt.relative(f.updated_at)}</span>
        </div>
      </div>`).join('') || '<div class="text-xs text-slate-400 py-2">Empty</div>'}
    </div>`;
  }).join('');
  html(`<div class="glass rounded-2xl p-4"><div class="lifecycle">${cols}</div></div>`);
  view().querySelectorAll('.kanban-card[data-key]').forEach(c => c.addEventListener('click', () => showFeature(c.dataset.key)));
});

// -------------------- Releases --------------------
register('releases', { label: 'Releases', icon: 'package', subtitle: 'Every release across your repositories' }, (s) => {
  const rows = s.releases.slice(0, 60).map(r => `
    <tr>
      <td class="mono">${fmt.escape(r.tag_name)}</td>
      <td>${fmt.escape(r.name || '—')}</td>
      <td class="mono">${fmt.escape(r.repoFull)}</td>
      <td>${fmt.escape(r.author || '—')}</td>
      <td>${statusPill(r.draft ? 'draft' : (r.prerelease ? 'pending' : 'success'))}</td>
      <td title="${fmt.escape(fmt.datetime(r.published_at))}">${fmt.relative(r.published_at)}</td>
    </tr>`).join('');
  html(`<div class="glass rounded-2xl overflow-hidden"><div class="table-wrap"><table class="dtable">
    <thead><tr><th>Tag</th><th>Name</th><th>Repo</th><th>Author</th><th>State</th><th>Published</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div></div>`);
});

// -------------------- Deployments (timeline) --------------------
register('deployments', { label: 'Deployments', icon: 'rocket', subtitle: 'Chronological deployment timeline' }, (s) => {
  const items = s.deployments.slice(0, 100).map(d => `
    <div class="tl-item ${d.state === 'success' ? 'ok' : (d.state === 'failure' ? 'fail' : 'warn')}">
      <div class="flex flex-wrap items-center gap-2">
        <span class="pill pill-info">${fmt.escape(d.canonicalEnvironment || d.environment || '')}</span>
        <span class="font-semibold mono">${fmt.escape(d.repoFull)}</span>
        ${statusPill(d.state)}
        <span class="ml-auto text-xs text-slate-500" title="${fmt.escape(fmt.datetime(d.created_at))}">${fmt.relative(d.created_at)}</span>
      </div>
      <div class="mt-0.5 text-xs text-slate-500">
        By <span class="text-slate-700 dark:text-slate-200">${fmt.escape(d.creator)}</span>
        · SHA <span class="mono">${fmt.escape((d.sha || '').slice(0,7))}</span>
        · Ref <span class="mono">${fmt.escape(d.ref || '—')}</span>
        · Build <span class="mono">${fmt.escape(d.buildNumber || '—')}</span>
      </div>
    </div>`).join('');
  html(`<div class="glass rounded-2xl p-4 max-h-[720px] overflow-auto">${items || '<div class="text-sm text-slate-400 p-6 text-center">No deployments.</div>'}</div>`);
});

// -------------------- Environments --------------------
register('environments', { label: 'Environments', icon: 'layers', subtitle: 'Current state per environment' }, (s) => {
  const envs = ['Development','Test','UAT','Production'];
  const icons = { Development: 'code', Test: 'flask-conical', UAT: 'shield-check', Production: 'rocket' };
  const cards = envs.map(env => {
    const rows = s.environmentState[env] || [];
    return `<div class="env-card glass">
      <div class="env-header env-${env}">
        <i data-lucide="${icons[env]}" class="w-4 h-4"></i>
        <span class="font-semibold">${env}</span>
        <span class="ml-auto text-xs opacity-90">${rows.length} repo${rows.length===1?'':'s'}</span>
      </div>
      <div class="table-wrap"><table class="dtable">
        <thead><tr><th>Repo</th><th>Build</th><th>SHA</th><th>Ref</th><th>Release</th><th>Deployer</th><th>When</th></tr></thead>
        <tbody>${rows.length === 0 ? `<tr><td colspan="7" class="text-center text-slate-400 py-6">No deployments to ${env}.</td></tr>` : rows.map(r => `
          <tr>
            <td class="mono">${fmt.escape(r.repo)}</td>
            <td class="mono">${fmt.escape(r.buildNumber || '—')}</td>
            <td class="mono">${fmt.escape(r.shortSha || '—')}</td>
            <td class="mono">${fmt.escape(r.ref || '—')}</td>
            <td class="mono">${fmt.escape(r.release || '—')}</td>
            <td>${fmt.escape(r.deployer || '—')}</td>
            <td title="${fmt.escape(fmt.datetime(r.deployedAt))}">${fmt.relative(r.deployedAt)}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>
    </div>`;
  }).join('');
  html(`<div class="grid grid-cols-1 xl:grid-cols-2 gap-4">${cards}</div>`);
});

// -------------------- Environment Comparison --------------------
register('compare', { label: 'Environment Comparison', icon: 'columns-3', subtitle: 'What is where — Dev vs Test vs UAT vs Prod' }, (s) => {
  const envs = s.environmentDiff.environments;
  const rows = s.environmentDiff.repositories.map(r => `
    <tr>
      <td class="mono">${fmt.escape(r.repo)}</td>
      ${envs.map(env => r[env]
        ? `<td><span class="diff-cell diff-yes mono" title="deployed by ${fmt.escape(r[env].by)} · ${fmt.escape(fmt.datetime(r[env].at))}">${fmt.escape(r[env].sha)}</span></td>`
        : `<td><span class="diff-cell diff-no">✕</span></td>`
      ).join('')}
    </tr>`).join('');
  html(`
    <div class="glass rounded-2xl p-3 flex items-center gap-2 mb-3">
      <i data-lucide="info" class="w-4 h-4 text-brand-500"></i>
      <div class="text-sm">Cells show the deployed SHA in each environment. Empty cells indicate a repository was never deployed to that environment.</div>
      <button id="cmp-export" class="ml-auto btn-secondary text-xs"><i data-lucide="file-spreadsheet" class="w-3.5 h-3.5"></i>Export CSV</button>
    </div>
    <div class="glass rounded-2xl overflow-hidden"><div class="table-wrap"><table class="dtable">
      <thead><tr><th>Repo</th>${envs.map(e => `<th>${e}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div></div>`);
  document.getElementById('cmp-export').onclick = () => {
    const out = s.environmentDiff.repositories.map(r => ({
      repo: r.repo, ...Object.fromEntries(envs.map(e => [e, r[e]?.sha || '']))
    }));
    exportCsv('environment-comparison.csv', out);
  };
});

// -------------------- Missing Features Report --------------------
register('diff', { label: 'Missing Features', icon: 'alert-triangle', subtitle: 'Gaps between environments' }, (s) => {
  const envs = s.environmentDiff.environments;
  const groups = [];
  for (let i = 0; i < envs.length - 1; i++) {
    const a = envs[i], b = envs[i + 1];
    const missing = s.environmentDiff.repositories.filter(r => r.missing[`${a}->${b}`]);
    groups.push({ a, b, missing });
  }
  html(`<div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
    ${groups.map(g => `
      <div class="glass rounded-2xl p-4">
        <div class="flex items-center gap-2 mb-2"><i data-lucide="git-compare" class="w-4 h-4 text-rose-500"></i><h3 class="font-semibold">${g.a} → ${g.b}</h3>
        <span class="ml-auto pill pill-fail">${g.missing.length} out of sync</span></div>
        ${g.missing.length === 0 ? '<div class="text-sm text-emerald-600">All repos in sync.</div>' : `<ul class="text-sm space-y-1">${g.missing.map(r => `
          <li class="flex items-center gap-2"><span class="mono">${fmt.escape(r.repo)}</span>
            <span class="ml-auto text-xs text-slate-500">${r[g.a]?.sha || '—'} → ${r[g.b]?.sha || '—'}</span>
          </li>`).join('')}</ul>`}
      </div>`).join('')}
  </div>`);
});

// -------------------- Notifications --------------------
register('notifications', { label: 'Notifications', icon: 'bell', subtitle: 'Alerts & watchlist' }, (s) => {
  const items = (s.notifications || []).map(n => {
    const cls = n.severity === 'error' ? 'pill-fail' : (n.severity === 'warning' ? 'pill-warn' : 'pill-info');
    const icon = { 'build-failed':'x-circle','stale-pr':'clock','conflict':'git-merge','review-overdue':'hourglass','prod-deploy':'rocket','stuck-feature':'alert-triangle' }[n.kind] || 'bell';
    return `<div class="glass rounded-xl px-4 py-3 flex items-center gap-3">
      <span class="pill ${cls}"><i data-lucide="${icon}" class="w-3 h-3"></i>${n.severity}</span>
      <div class="text-sm flex-1">${fmt.escape(n.title)}</div>
      <span class="text-xs text-slate-500" title="${fmt.escape(fmt.datetime(n.when))}">${fmt.relative(n.when)}</span>
      ${n.href ? `<a href="${fmt.escape(n.href)}" target="_blank" class="text-xs text-brand-600 hover:underline">Open</a>` : ''}
    </div>`;
  }).join('');
  html(`<div class="space-y-2">${items || '<div class="text-sm text-slate-400 p-6 text-center">Nothing to report.</div>'}</div>`);
});

// -------------------- Audit Log --------------------
register('audit', { label: 'Audit Log', icon: 'scroll-text', subtitle: 'Immutable engineering activity trail' }, (s) => {
  const rows = (s.audit || []).slice(0, 300).map(a => `
    <tr>
      <td title="${fmt.escape(fmt.datetime(a.ts))}">${fmt.relative(a.ts)}</td>
      <td>${fmt.escape(a.actor)}</td>
      <td>${statusPill(a.action)}</td>
      <td class="mono">${fmt.escape(a.repo)}</td>
      <td>${fmt.escape(a.detail || '')}</td>
    </tr>`).join('');
  html(`<div class="glass rounded-2xl p-3 flex items-center gap-2 mb-3">
    <i data-lucide="scroll-text" class="w-4 h-4 text-brand-500"></i>
    <div class="text-sm">${(s.audit || []).length} events captured</div>
    <button id="audit-export" class="ml-auto btn-secondary text-xs"><i data-lucide="file-spreadsheet" class="w-3.5 h-3.5"></i>Export CSV</button>
  </div>
  <div class="glass rounded-2xl overflow-hidden"><div class="table-wrap"><table class="dtable">
    <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Repo</th><th>Detail</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div></div>`);
  document.getElementById('audit-export').onclick = () => exportCsv('audit.csv', (s.audit || []).map(a => ({ ts: a.ts, actor: a.actor, action: a.action, repo: a.repo, detail: a.detail })));
});

// -------------------- Smart Insights (dedicated) --------------------
register('insights', { label: 'Smart Insights', icon: 'lightbulb', subtitle: 'AI-style summary of your engineering state' }, (s) => {
  const cards = (s.insights || []).map(i => `<div class="glass rounded-2xl p-4 flex items-start gap-3">
    <i data-lucide="sparkles" class="w-4 h-4 text-fuchsia-500 mt-0.5"></i><div class="text-sm">${fmt.escape(i)}</div>
  </div>`).join('');
  html(`<div class="grid grid-cols-1 md:grid-cols-2 gap-3">${cards}</div>`);
});

// -------------------- Repositories & Health --------------------
register('repos', { label: 'Repositories & Health', icon: 'folder-git-2', subtitle: 'Repo health scores' }, (s) => {
  const cards = s.repositories.map(r => `
    <div class="glass rounded-2xl p-4">
      <div class="flex items-start gap-3">
        <div class="min-w-0 flex-1">
          <div class="font-semibold mono truncate">${fmt.escape(r.full_name)}</div>
          <div class="text-xs text-slate-500 truncate">${fmt.escape(r.description || '—')}</div>
          <div class="mt-2 flex flex-wrap gap-1 text-xs">
            ${r.lang ? `<span class="pill pill-neutral">${fmt.escape(r.lang)}</span>` : ''}
            ${r.private ? '<span class="pill pill-brand">private</span>' : '<span class="pill pill-info">public</span>'}
            <span class="pill pill-neutral">${r.openIssues} open issues</span>
            <span class="pill pill-neutral">${r.stars}★</span>
          </div>
        </div>
        <div class="ring" style="--p:${r.health.score}" data-p="${r.health.score}"></div>
      </div>
      <div class="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div class="rounded-lg bg-slate-100/60 dark:bg-slate-800/60 p-2"><div class="text-slate-500">Build success</div><div class="font-bold">${r.health.factors.buildSuccess}%</div></div>
        <div class="rounded-lg bg-slate-100/60 dark:bg-slate-800/60 p-2"><div class="text-slate-500">Open PRs</div><div class="font-bold">${r.health.factors.prVolumeOpen}</div></div>
        <div class="rounded-lg bg-slate-100/60 dark:bg-slate-800/60 p-2"><div class="text-slate-500">Stale branches</div><div class="font-bold">${r.health.factors.staleBranches}</div></div>
        <div class="rounded-lg bg-slate-100/60 dark:bg-slate-800/60 p-2"><div class="text-slate-500">Pushed</div><div class="font-bold">${fmt.relative(r.pushedAt)}</div></div>
      </div>
    </div>`).join('');
  html(`<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">${cards}</div>`);
});
