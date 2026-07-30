// Synthetic dataset matching githubService.getSnapshot() shape.

const DEVS = ['anika-r', 'marcus-lee', 'priya-n', 'jordan-ok', 'sofia-a', 'rahul-m', 'emma-c', 'david-p'];
const AVATARS = Object.fromEntries(DEVS.map(d => [d, `https://api.dicebear.com/9.x/identicon/svg?seed=${d}`]));
const REPOS = [
  { name: 'payments-api',    lang: 'TypeScript', private: true },
  { name: 'checkout-web',    lang: 'TypeScript', private: true },
  { name: 'notification-svc',lang: 'Go',         private: false },
  { name: 'auth-gateway',    lang: 'Go',         private: true },
  { name: 'billing-worker',  lang: 'Python',     private: false },
  { name: 'design-system',   lang: 'TypeScript', private: false },
];
const BRANCHES = ['main', 'dev', 'test', 'uat', 'feature/one-click-checkout', 'feature/webhook-retries', 'hotfix/token-refresh', 'release/2026.11'];
const FEATURES = [
  'One-click checkout', 'Webhook retry with backoff', 'Passwordless sign-in',
  'GDPR data export', 'Idempotent refund API', 'Multi-currency invoicing',
  'Dark-mode polish', 'Enterprise SLA dashboard', 'Feature-flag rollouts',
  'Fraud score v2', 'Bulk merchant import', 'Real-time deploy alerts',
];
const CANON = ['Development', 'Test', 'UAT', 'Production'];
const OWNER = 'contoso';

function seedRand(seed) { let s = seed; return () => (s = (s * 9301 + 49297) % 233280) / 233280; }
const rand = seedRand(20260727);
const rInt = (a, b) => Math.floor(rand() * (b - a + 1)) + a;
const pick = (arr, i) => arr[Math.abs(i) % arr.length];
const rChoice = (arr) => arr[Math.floor(rand() * arr.length)];
function sha() { return Array.from({ length: 40 }, () => Math.floor(rand() * 16).toString(16)).join(''); }

const now = Date.now();
const isoAgo = (m) => new Date(now - m * 60_000).toISOString();

const repositories = REPOS.map((r, i) => ({
  id: 10000 + i, name: r.name, full_name: `${OWNER}/${r.name}`, private: r.private,
  url: `https://github.com/${OWNER}/${r.name}`, defaultBranch: 'main', description: `${r.name} — synthetic demo repo`,
  openIssues: rInt(3, 25), stars: rInt(5, 1200), forks: rInt(0, 200), size: rInt(400, 40000), lang: r.lang,
  pushedAt: isoAgo(rInt(5, 60 * 24 * 2)),
  health: { score: rInt(55, 96), factors: { buildSuccess: rInt(70, 99), openIssues: rInt(3, 25), staleBranches: rInt(0, 8), prVolumeOpen: rInt(1, 10) } },
}));

const contributors = DEVS.map((login, i) => ({
  login, avatar: AVATARS[login], contributions: rInt(30, 400), repos: REPOS.slice(0, rInt(2, REPOS.length)).map(r => `${OWNER}/${r.name}`),
}));

const commits = Array.from({ length: 220 }).map((_, i) => {
  const repo = pick(REPOS, i).name;
  const dev = pick(DEVS, i);
  const issue = 1000 + (i % 40);
  const feat = pick(FEATURES, i);
  const kinds = ['feat', 'fix', 'refactor', 'chore', 'test', 'docs'];
  const kind = pick(kinds, i);
  return {
    sha: sha(), shortSha: sha().slice(0, 7),
    message: `${kind}: ${feat.toLowerCase()} — #${issue}`,
    author: dev, authorAvatar: AVATARS[dev],
    date: isoAgo(rInt(1, 60 * 24 * 21)),
    url: '#', repo, repoFull: `${OWNER}/${repo}`,
    parents: 1, issues: [issue],
  };
}).sort((a, b) => new Date(b.date) - new Date(a.date));

const branches = REPOS.flatMap(r =>
  BRANCHES.map((b, i) => ({
    name: b, protected: b === 'main',
    commit: { sha: sha(), url: '#' },
    repo: r.name, repoFull: `${OWNER}/${r.name}`,
    env: b === 'main' ? 'Production' : (b === 'uat' ? 'UAT' : (b === 'test' ? 'Test' : (b === 'dev' ? 'Development' : null))),
  }))
);

const prs = Array.from({ length: 40 }).map((_, i) => {
  const repo = pick(REPOS, i).name;
  const dev = pick(DEVS, i);
  const issue = 1000 + (i % 40);
  const states = ['open', 'open', 'closed', 'closed', 'open'];
  const state = pick(states, i);
  const merged = state === 'closed' && rand() > 0.2 ? isoAgo(rInt(30, 60 * 24 * 5)) : null;
  const created = isoAgo(rInt(60, 60 * 24 * 10));
  return {
    id: 30000 + i, number: 200 + i,
    title: `${pick(['feat','fix','chore'], i)}: ${pick(FEATURES, i)} — closes #${issue}`,
    state, draft: i % 11 === 0,
    author: dev, authorAvatar: AVATARS[dev],
    created_at: created, updated_at: isoAgo(rInt(10, 60 * 24 * 3)),
    closed_at: state === 'closed' ? isoAgo(rInt(10, 60 * 24 * 4)) : null,
    merged_at: merged,
    base: 'main', head: pick(BRANCHES.filter(b => b !== 'main'), i),
    mergeable_state: i % 7 === 0 ? 'dirty' : 'clean',
    requestedReviewers: [pick(DEVS, i + 2), pick(DEVS, i + 3)],
    reviewers: [pick(DEVS, i + 4)],
    labels: rand() > 0.5 ? ['enhancement'] : ['bug'],
    firstReviewAt: rand() > 0.4 ? isoAgo(rInt(30, 60 * 24 * 2)) : null,
    approvals: rInt(0, 3), changesRequested: i % 8 === 0 ? 1 : 0,
    comments: rInt(0, 15),
    additions: rInt(20, 900), deletions: rInt(5, 300), changed_files: rInt(1, 25),
    url: '#', repo, repoFull: `${OWNER}/${repo}`,
    issues: [issue],
  };
});

const deployments = Array.from({ length: 90 }).map((_, i) => {
  const repo = pick(REPOS, i).name;
  const env = pick(CANON, i);
  const states = ['success', 'success', 'success', 'failure', 'in_progress', 'success'];
  const state = pick(states, i);
  const created = isoAgo(rInt(10, 60 * 24 * 14));
  const dev = pick(DEVS, i);
  return {
    id: 40000 + i, sha: sha(), ref: env === 'Production' ? 'main' : env.toLowerCase(),
    environment: env.toLowerCase(), canonicalEnvironment: env,
    created_at: created, updated_at: created,
    creator: dev, creatorAvatar: AVATARS[dev],
    state, description: `${env} deployment`,
    target_url: '#', task: 'deploy',
    buildNumber: `2026.11.${100 + i}`,
    repo, repoFull: `${OWNER}/${repo}`,
  };
}).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

const releases = Array.from({ length: 20 }).map((_, i) => {
  const repo = pick(REPOS, i).name;
  const dev = pick(DEVS, i);
  return {
    id: 50000 + i, name: `v2026.${11 + Math.floor(i / 4)}.${i}`, tag_name: `v2026.${11 + Math.floor(i / 4)}.${i}`,
    author: dev, published_at: isoAgo(rInt(60, 60 * 24 * 30)), created_at: isoAgo(rInt(60, 60 * 24 * 30)),
    body: `Release notes for ${repo}\n- ${pick(FEATURES, i)}\n- ${pick(FEATURES, i + 3)}`,
    prerelease: i % 6 === 0, draft: false,
    repo, repoFull: `${OWNER}/${repo}`, url: '#',
  };
});

const workflowRuns = Array.from({ length: 60 }).map((_, i) => {
  const repo = pick(REPOS, i).name;
  const dev = pick(DEVS, i);
  const status = i < 4 ? 'in_progress' : 'completed';
  const conclusion = status === 'completed' ? pick(['success', 'success', 'success', 'failure', 'cancelled', 'success'], i) : null;
  const created = isoAgo(rInt(5, 60 * 24 * 10));
  return {
    id: 60000 + i, name: pick(['CI', 'Deploy', 'Lint', 'Tests', 'Security'], i), event: pick(['push', 'pull_request', 'schedule'], i),
    status, conclusion, branch: pick(BRANCHES, i),
    actor: dev, actorAvatar: AVATARS[dev], created_at: created, updated_at: created,
    duration: status === 'completed' ? rInt(30_000, 900_000) : null,
    url: '#', repo, repoFull: `${OWNER}/${repo}`,
  };
});

const issues = Array.from({ length: 60 }).map((_, i) => {
  const repo = pick(REPOS, i).name;
  const dev = pick(DEVS, i);
  const feat = pick(FEATURES, i);
  return {
    id: 70000 + i, number: 1000 + i, title: feat,
    state: rand() > 0.4 ? 'open' : 'closed', author: pick(DEVS, i + 1),
    assignees: [dev], labels: ['epic', pick(['front-end', 'back-end', 'infra'], i)],
    milestone: pick(['Sprint 42', 'Sprint 43', 'Sprint 44'], i),
    created_at: isoAgo(rInt(60, 60 * 24 * 40)),
    closed_at: rand() > 0.4 ? null : isoAgo(rInt(30, 60 * 24 * 20)),
    updated_at: isoAgo(rInt(30, 60 * 24 * 5)),
    url: '#', repo, repoFull: `${OWNER}/${repo}`,
  };
});

const tags = Array.from({ length: 24 }).map((_, i) => ({
  name: `v2026.11.${i}`, sha: sha(), repo: pick(REPOS, i).name, repoFull: `${OWNER}/${pick(REPOS, i).name}`,
}));

const events = Array.from({ length: 120 }).map((_, i) => {
  const repo = pick(REPOS, i).name;
  const actor = pick(DEVS, i);
  const types = ['PushEvent', 'PullRequestEvent', 'PullRequestReviewEvent', 'IssuesEvent', 'DeploymentEvent', 'ReleaseEvent', 'CreateEvent'];
  const type = pick(types, i);
  const details = {
    PushEvent:              `pushed ${rInt(1, 6)} commits to ${pick(BRANCHES, i)}`,
    PullRequestEvent:       `opened PR #${200 + (i % 40)}`,
    PullRequestReviewEvent: `approved PR #${200 + (i % 40)}`,
    IssuesEvent:            `${pick(['opened','closed','commented'], i)} issue #${1000 + (i % 40)}`,
    DeploymentEvent:        `deployed to ${pick(CANON, i)}`,
    ReleaseEvent:           `published release v2026.11.${i % 20}`,
    CreateEvent:            `created branch ${pick(BRANCHES, i)}`,
  };
  return {
    id: `evt-${i}`, date: isoAgo(rInt(1, 60 * 24 * 3)), actor, actorAvatar: AVATARS[actor],
    repo: `${OWNER}/${repo}`, type, detail: details[type],
  };
}).sort((a, b) => new Date(b.date) - new Date(a.date));

// Feature registry
const features = issues.map((i, idx) => {
  const relatedPrs = prs.filter(p => p.repoFull === i.repoFull && p.issues.includes(i.number));
  const relatedCommits = commits.filter(c => c.repoFull === i.repoFull && c.issues.includes(i.number)).slice(0, 6);
  const relatedDeps = deployments.filter(d => d.repoFull === i.repoFull).slice(idx % 4, (idx % 4) + 3);
  const stages = ['Backlog', 'Development', 'Code Review', 'Testing', 'UAT', 'Production'];
  const stage = pick(stages, idx);
  const risk = pick(['Low', 'Low', 'Low', 'Medium', 'Medium', 'High'], idx);
  return {
    key: `${i.repoFull}:${i.number}`, id: i.number, repoFull: i.repoFull, title: i.title,
    owner: i.author, developers: [...new Set([...i.assignees, ...relatedPrs.map(p => p.author), ...relatedCommits.map(c => c.author)])],
    labels: i.labels, milestone: i.milestone, state: i.state,
    created_at: i.created_at, updated_at: i.updated_at, closed_at: i.closed_at, url: i.url,
    prs: relatedPrs, commits: relatedCommits, deployments: relatedDeps, releases: [],
    currentEnvironment: stage === 'Production' ? 'Production' : (stage === 'UAT' ? 'UAT' : (stage === 'Testing' ? 'Test' : 'Development')),
    stage, progress: Math.round((stages.indexOf(stage) + 1) / stages.length * 100), risk,
  };
});

// KPI aggregation
const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
const t = todayStart.getTime();
const weekAgo = now - 7 * 86400_000;
const kpis = {
  totalRepositories: repositories.length,
  activeDevelopers: DEVS.length,
  commitsToday: commits.filter(c => new Date(c.date).getTime() >= t).length,
  pushesToday: events.filter(e => e.type === 'PushEvent' && new Date(e.date).getTime() >= t).length,
  mergedToday: prs.filter(p => p.merged_at && new Date(p.merged_at).getTime() >= t).length,
  openPRs: prs.filter(p => p.state === 'open').length,
  pendingReviews: prs.filter(p => p.state === 'open' && p.requestedReviewers.length).length,
  failedBuilds: workflowRuns.filter(r => r.conclusion === 'failure').length,
  successfulBuilds: workflowRuns.filter(r => r.conclusion === 'success').length,
  prodReleasesWeek: releases.filter(r => new Date(r.published_at).getTime() >= weekAgo).length,
  avgMergeMs: 12 * 3600_000,
  avgReviewMs: 4 * 3600_000,
  leadTimeMs: 26 * 3600_000,
  cycleTimeMs: 6 * 3600_000,
  mttrMs: 90 * 60_000,
  deploymentFrequencyPerWeek: deployments.filter(d => d.canonicalEnvironment === 'Production' && new Date(d.created_at).getTime() >= weekAgo).length,
  changeFailureRate: 12,
  buildSuccessRate: Math.round(workflowRuns.filter(r => r.conclusion === 'success').length / Math.max(1, workflowRuns.filter(r => r.status === 'completed').length) * 100),
  commitsWeek: commits.filter(c => new Date(c.date).getTime() >= weekAgo).length,
  commitsPrevWeek: commits.filter(c => {
    const ct = new Date(c.date).getTime();
    return ct >= now - 14 * 86400_000 && ct < weekAgo;
  }).length,
};

// Env state
const environmentState = Object.fromEntries(CANON.map(env => [env,
  REPOS.map(r => {
    const dep = deployments.find(d => d.repo === r.name && d.canonicalEnvironment === env && d.state === 'success');
    return dep ? {
      repo: r.name, repoFull: `${OWNER}/${r.name}`, env,
      sha: dep.sha, shortSha: dep.sha.slice(0, 7), ref: dep.ref,
      deployedAt: dep.created_at, deployer: dep.creator, status: 'success',
      buildNumber: dep.buildNumber, release: releases.find(rr => rr.repo === r.name)?.tag_name,
    } : null;
  }).filter(Boolean)
]));

// Env diff
const environmentDiff = {
  environments: CANON,
  repositories: REPOS.map(r => {
    const row = { repo: r.name, repoFull: `${OWNER}/${r.name}` };
    for (const env of CANON) {
      const dep = deployments.find(d => d.repo === r.name && d.canonicalEnvironment === env && d.state === 'success');
      row[env] = dep ? { sha: dep.sha.slice(0, 7), fullSha: dep.sha, at: dep.created_at, by: dep.creator } : null;
    }
    row.missing = {};
    for (let i = 0; i < CANON.length - 1; i++) {
      const a = CANON[i], b = CANON[i + 1];
      row.missing[`${a}->${b}`] = !row[b] || (row[a] && row[a].fullSha !== row[b].fullSha);
    }
    return row;
  }),
};

// Analytics
const days = 30;
const labels = Array.from({ length: days }, (_, i) => {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (days - 1 - i));
  return d.toISOString().slice(5, 10);
});
const commitsPerDay = Array.from({ length: days }, () => rInt(4, 40));
const deploysPerDay = Array.from({ length: days }, () => rInt(0, 8));
const pushesPerDay = commitsPerDay.map(x => Math.max(1, Math.round(x / 2)));
const heatmap = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => rInt(0, 8)));
const topDevelopers = { labels: DEVS.slice(0, 8), data: DEVS.slice(0, 8).map(() => rInt(15, 90)) };
const mergeTimeBuckets = { labels: ['<1h','1-8h','8-24h','1-3d','>3d'], data: [4, 12, 18, 9, 3] };

const analytics = { labels, commitsPerDay, pushesPerDay, deploysPerDay, heatmap, topDevelopers, mergeTimeBuckets };

const notifications = [
  { severity: 'error',   kind: 'build-failed',    title: 'Build failed: CI on feature/one-click-checkout', when: isoAgo(38), href: '#' },
  { severity: 'warning', kind: 'stale-pr',        title: 'PR #211 open for 6d — Passwordless sign-in',    when: isoAgo(60 * 24 * 6) },
  { severity: 'warning', kind: 'conflict',        title: 'Merge conflict: PR #223 GDPR data export',      when: isoAgo(90) },
  { severity: 'info',    kind: 'prod-deploy',     title: 'Production deployment complete (a91f3ce)',      when: isoAgo(140) },
  { severity: 'warning', kind: 'stuck-feature',   title: 'Feature stuck in review: #1014 Feature-flag rollouts', when: isoAgo(60 * 24 * 4) },
  { severity: 'info',    kind: 'prod-deploy',     title: 'Production deployment complete (7d2a1e0)',      when: isoAgo(60 * 24 * 1) },
];

const insights = [
  `${kpis.commitsToday} commits pushed today, ${kpis.mergedToday} PR${kpis.mergedToday === 1 ? '' : 's'} merged.`,
  `${prs.filter(p => p.state === 'open').length} pull requests currently open across ${repositories.length} repositories.`,
  `${environmentDiff.repositories.filter(r => r.missing['UAT->Production']).length} repositories behind Production compared to UAT.`,
  `Testing environment is trailing Development by ${environmentDiff.repositories.filter(r => r.missing['Development->Test']).length} repos.`,
  `Build success rate is ${kpis.buildSuccessRate}% over the last ${workflowRuns.filter(r => r.status === 'completed').length} runs.`,
  `Change failure rate (DORA) ${kpis.changeFailureRate}%; MTTR ${Math.round(kpis.mttrMs / 60_000)}m.`,
];

const audit = events.slice(0, 300).map(e => ({ ts: e.date, actor: e.actor, action: e.type, repo: e.repo, detail: e.detail }));

// Backlog activities — human-readable "things waiting to move" derived from events + PRs
const backlogActivities = (() => {
  const ACTIONS = {
    PushEvent:              'Pushed to Repository',
    PullRequestEvent:       'PR Created',
    PullRequestReviewEvent: 'PR Reviewed',
    IssuesEvent:            'Requested',
    DeploymentEvent:        'Deployed',
    ReleaseEvent:           'Released',
    CreateEvent:            'Started',
  };
  const chosen = [];
  const seen = new Set();
  for (const e of events.slice(0, 40)) {
    const feat = pick(FEATURES, chosen.length + 3);
    if (seen.has(feat + e.actor)) continue;
    seen.add(feat + e.actor);
    chosen.push({
      id: `bl-${e.id}`,
      name: feat,
      person: e.actor,
      action: ACTIONS[e.type] || 'Updated',
      when: e.date,
      repo: e.repo,
    });
    if (chosen.length >= 8) break;
  }
  return chosen;
})();

// Seed roadmap items — mapped to Q1..Q4 with statuses that echo real features
const roadmapSeed = [
  { name: 'User Authentication',        quarter: 'Q1', description: 'Login, sign-up, password reset', status: 'Production',  owner: 'anika-r',   linkedRepo: 'contoso/auth-gateway' },
  { name: 'Partner Portal',             quarter: 'Q1', description: 'Onboard partners with self-service', status: 'Production', owner: 'marcus-lee', linkedRepo: 'contoso/checkout-web' },
  { name: 'One-Click Checkout',         quarter: 'Q2', description: 'Reduce cart drop-off',            status: 'Testing',     owner: 'priya-n',   linkedRepo: 'contoso/checkout-web' },
  { name: 'Multi-Currency Invoicing',   quarter: 'Q2', description: 'Bill in customer currency',       status: 'Development', owner: 'jordan-ok', linkedRepo: 'contoso/billing-worker' },
  { name: 'Passwordless Sign-In',       quarter: 'Q3', description: 'Magic-link email login',          status: 'Development', owner: 'sofia-a',   linkedRepo: 'contoso/auth-gateway' },
  { name: 'Webhook Retry With Backoff', quarter: 'Q3', description: 'Reliability for outbound events', status: 'Not Started', owner: 'rahul-m',   linkedRepo: 'contoso/notification-svc' },
  { name: 'Fraud Score v2',             quarter: 'Q3', description: 'Better risk model',               status: 'Blocked',     owner: 'emma-c',    linkedRepo: 'contoso/payments-api' },
  { name: 'Bulk Merchant Import',       quarter: 'Q4', description: 'CSV import with validation',      status: 'Not Started', owner: 'david-p',   linkedRepo: 'contoso/checkout-web' },
  { name: 'Feature-Flag Rollouts',      quarter: 'Q4', description: 'Gradual releases',                status: 'Not Started', owner: 'anika-r',   linkedRepo: 'contoso/design-system' },
  { name: 'GDPR Data Export',           quarter: 'Q4', description: 'Self-service user data export',   status: 'Waiting',     owner: 'marcus-lee', linkedRepo: 'contoso/billing-worker' },
];

// Add a "displayName" (human-readable) + "action" to every feature so the UI can render sticky notes without technical detail
const QA_OWNERS = ['priya-n','emma-c','david-p'];
const REVIEWERS = ['anika-r','marcus-lee','jordan-ok','sofia-a'];
const STAGE_ORDER = { 'Backlog':0, 'Development':1, 'Code Review':1, 'Testing':2, 'UAT':2, 'Production':3 };

features.forEach((f, i) => {
  f.displayName = humanizeFeatureName(f.title);
  f.action = ({
    'Backlog': 'Planned',
    'Development': 'In Development',
    'Code Review': 'In Development',
    'Testing': 'Awaiting QA',
    'UAT': 'Awaiting QA',
    'Production': 'Live',
  })[f.stage] || 'Updated';
  f.person = (f.developers && f.developers[0]) || f.owner || 'Team';
  f.qaOwner = pick(QA_OWNERS, i);
  f.reviewer = pick(REVIEWERS, i + 1);
  // Time in stage: how long the feature has been at its current stage
  f.enteredStageAt = isoAgo(rInt(60, 60 * 24 * 12));
  // Estimated release date (only meaningful pre-Production)
  f.estimatedRelease = f.stage === 'Production' ? null
    : new Date(now + rInt(1, 14) * 86400_000).toISOString().slice(0, 10);
  // Explicit blocked flag on top of risk
  f.blocked = (f.risk === 'High' && i % 6 === 0);
  // Readiness checklist
  const stageIdx = STAGE_ORDER[f.stage] ?? 0;
  f.readinessChecks = {
    codeReview:   stageIdx >= 1,
    qa:           stageIdx >= 2,
    performance:  stageIdx >= 2 && rand() > 0.35,
    security:     stageIdx >= 2 && rand() > 0.3,
    approvals:    stageIdx >= 2 && rand() > 0.25,
  };
  f.readinessScore = Math.round(Object.values(f.readinessChecks).filter(Boolean).length / 5 * 100);
  // Dependencies — 30% of features depend on 1–2 earlier features
  f.dependencies = (i % 3 === 0 && i > 2)
    ? [{ key: features[i - 2].key, name: humanizeFeatureName(features[i - 2].title), stage: features[i - 2].stage }]
    : [];
});

// Utility functions consumed by summary computations
function daysAgo(iso) { return Math.floor((now - new Date(iso).getTime()) / 86400_000); }
function inLastNDays(iso, n) { const t = new Date(iso).getTime(); return t >= now - n * 86400_000; }

// ----- Today's Progress (adaptive window) -----
const todayProgress = (() => {
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const compute = (sinceMs) => {
    const inWin = iso => iso && new Date(iso).getTime() >= sinceMs;
    return {
      started:    features.filter(f => f.stage === 'Development' && inWin(f.enteredStageAt)).length,
      toDev:      features.filter(f => f.stage === 'Development' && inWin(f.enteredStageAt)).length,
      toTest:     features.filter(f => ['Testing','UAT','Code Review'].includes(f.stage) && inWin(f.enteredStageAt)).length,
      released:   deployments.filter(d => d.canonicalEnvironment === 'Production' && d.state === 'success' && inWin(d.created_at)).length,
      activeDevs: new Set(events.filter(e => inWin(e.date)).map(e => e.actor)).size,
      blocked:    features.filter(f => f.blocked).length,
    };
  };
  const wins = [
    { label: 'Today',        since: todayStart.getTime() },
    { label: 'Last 7 days',  since: now - 7 * 86400_000 },
    { label: 'Last 30 days', since: now - 30 * 86400_000 },
  ];
  for (const w of wins) {
    const p = compute(w.since);
    if ((p.started + p.toDev + p.toTest + p.released + p.activeDevs) > 0) return { ...p, windowLabel: w.label };
  }
  return { ...compute(0), windowLabel: 'All time' };
})();

// ----- Needs Attention -----
const needsAttention = (() => {
  const rows = [];
  for (const f of features.filter(f => f.blocked).slice(0, 3)) {
    rows.push({ severity: 'high',   featureKey: f.key, name: f.displayName, reason: `Blocked for ${Math.max(1, daysAgo(f.enteredStageAt))} day${daysAgo(f.enteredStageAt) === 1 ? '' : 's'}` });
  }
  for (const f of features.filter(f => ['Testing','UAT'].includes(f.stage) && daysAgo(f.enteredStageAt) >= 3).slice(0, 3)) {
    rows.push({ severity: 'medium', featureKey: f.key, name: f.displayName, reason: `Waiting for QA (${daysAgo(f.enteredStageAt)}d)` });
  }
  for (const f of features.filter(f => f.stage === 'Code Review' && daysAgo(f.updated_at) >= 2).slice(0, 3)) {
    rows.push({ severity: 'warn',   featureKey: f.key, name: f.displayName, reason: 'PR awaiting review' });
  }
  for (const f of features.filter(f => f.readinessScore >= 80 && f.stage !== 'Production').slice(0, 3)) {
    rows.push({ severity: 'good',   featureKey: f.key, name: f.displayName, reason: 'Ready for Production' });
  }
  return rows.slice(0, 8);
})();

// ----- Recently Released -----
const recentlyReleased = features
  .filter(f => f.stage === 'Production')
  .sort((a,b) => new Date(b.enteredStageAt) - new Date(a.enteredStageAt))
  .slice(0, 6)
  .map(f => ({ key: f.key, name: f.displayName, when: f.enteredStageAt, by: f.reviewer }));

// ----- Upcoming Releases -----
const upcomingReleases = features
  .filter(f => f.estimatedRelease && f.stage !== 'Production')
  .sort((a,b) => new Date(a.estimatedRelease) - new Date(b.estimatedRelease))
  .slice(0, 6)
  .map(f => ({ key: f.key, name: f.displayName, when: f.estimatedRelease, stage: f.stage, readiness: f.readinessScore }));

// ----- Weekly Summary (auto-generated bullets) -----
const weeklySummary = (() => {
  const completed = features.filter(f => f.stage === 'Production' && inLastNDays(f.enteredStageAt, 7)).length;
  const inTesting = features.filter(f => ['Testing','UAT','Code Review'].includes(f.stage) && inLastNDays(f.enteredStageAt, 7)).length;
  const blocked   = features.filter(f => f.blocked).length;
  const released  = deployments.filter(d => d.canonicalEnvironment === 'Production' && d.state === 'success' && inLastNDays(d.created_at, 7)).length;
  const upcoming  = upcomingReleases.length;
  return {
    period: 'This week',
    bullets: [
      `${completed} feature${completed === 1 ? '' : 's'} completed`,
      `${inTesting} entered testing`,
      `${blocked} blocked`,
      `${released} released to Production`,
      `${upcoming} planned for next week`,
    ],
  };
})();

function humanizeFeatureName(raw) {
  if (!raw) return 'Untitled';
  let s = String(raw);
  s = s.replace(/^\s*(feat|fix|chore|perf|refactor|test|docs|hotfix|bugfix|release)(\([^)]*\))?\s*:\s*/i, '');
  s = s.split(/\s+—\s+|\s+-\s+|\s—\s|\s+#\d+/)[0];
  s = s.replace(/^(feature|hotfix|bugfix|release|fix|chore)[\/_-]+/i, '');
  s = s.replace(/-v\d+$/i, '').replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s.split(' ').map(w => w.length > 3 ? (w[0].toUpperCase() + w.slice(1)) : w).join(' ');
}

/*
 * Synthetic Azure DevOps "environment view" so the demo Board can show the
 * Dev / Test / Prod presence + diff without any real Azure connection. Uses
 * the same feature names that already appear in the demo so the diff is
 * intuitive: a few things live in Dev only, a few in Dev+Test, a few in all
 * three.
 */
const demoAzdoEnvView = (() => {
  const now = Date.now();
  const iso = m => new Date(now - m * 60_000).toISOString();
  const pickPerson = i => DEVS[i % DEVS.length];
  const releases = [
    { feature: 'One-Click Checkout',        envs: ['Development'] },
    { feature: 'Webhook Retry With Backoff', envs: ['Development'] },
    { feature: 'Multi-Currency Invoicing',  envs: ['Development', 'Test'] },
    { feature: 'Passwordless Sign-In',      envs: ['Development', 'Test'] },
    { feature: 'GDPR Data Export',          envs: ['Development'] },
    { feature: 'Fraud Score v2',            envs: ['Development', 'Test', 'Production'] },
    { feature: 'Real-Time Deploy Alerts',   envs: ['Development', 'Test', 'Production'] },
    { feature: 'Dark-Mode Polish',          envs: ['Development', 'Test', 'Production'] },
    { feature: 'Partner Portal',            envs: ['Development', 'Test', 'Production'] },
    { feature: 'User Authentication',       envs: ['Development', 'Test', 'Production'] },
  ];
  const byEnvironment = { Development: [], Test: [], UAT: [], Production: [] };
  releases.forEach((r, i) => {
    for (const env of r.envs) {
      byEnvironment[env].push({
        id: `azdo-demo-${i}-${env}`,
        orgUrl: `https://dev.azure.com/${OWNER}-demo`,
        project: 'demo-project',
        stageName: env,
        canonicalEnvironment: env,
        feature: r.feature,
        buildNumber: `2026.11.${100 + i}`,
        releaseName: `Release ${1200 + i}`,
        deployedBy: pickPerson(i + (env === 'Production' ? 1 : env === 'Test' ? 2 : 0)),
        at: iso(60 * (i + 1) + (env === 'Development' ? 0 : env === 'Test' ? 240 : 720)),
        status: 'success', rawStatus: 'succeeded',
        isRollback: false,
        url: '#',
      });
    }
  });
  const nameSet = env => new Set(byEnvironment[env].map(d => d.feature));
  const diffOf = (a, b) => Array.from(a).filter(x => !b.has(x));
  const dev = nameSet('Development'), test = nameSet('Test'), prod = nameSet('Production');
  return {
    configured: true,
    projects: [{ orgUrl: `https://dev.azure.com/${OWNER}-demo`, project: 'demo-project', envSlots: ['Development','Test','Production'] }],
    byEnvironment,
    diff: {
      'Development->Test':       diffOf(dev, test),
      'Test->Production':        diffOf(test, prod),
      'Development->Production': diffOf(dev, prod),
    },
    lastFetchedAt: new Date().toISOString(),
  };
})();

export function getDemoSnapshot() {
  return {
    generatedAt: new Date().toISOString(),
    scope: [`${OWNER} (demo)`],
    repositories, kpis, environmentState,
    commits, pushes: events.filter(e => e.type === 'PushEvent'),
    prs, branches, deployments, releases, workflowRuns, issues, contributors, tags,
    activity: events, features, environmentDiff, analytics, notifications, audit, insights,
    backlogActivities, roadmapSeed,
    todayProgress, needsAttention, recentlyReleased, upcomingReleases, weeklySummary,
    azdo: demoAzdoEnvView,
    featureNotes: {},
    rbac: {}, isDemo: true,
  };
}
