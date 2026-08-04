import { config, isConfigured } from '../config.js';
import { cached } from './cache.js';

const UA = 'github-engineering-intelligence/1.0';

// -------------------- Low-level fetch --------------------

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Set whenever GitHub throttles us, so a snapshot can tell the UI that the
// numbers it is about to render are incomplete rather than genuinely zero.
let lastRateLimitAt = null;

// GitHub enforces two rate limits and they look nothing alike on the wire:
//
//   Primary   — the hourly quota. 403 or 429 with x-ratelimit-remaining: 0 and
//               x-ratelimit-reset saying when it refills.
//   Secondary — burst and concurrency protection. 403 with the quota headers
//               still reporting thousands remaining, usually a retry-after
//               header, and a body that says "secondary rate limit".
//
// Testing only for `remaining === 0` misses the secondary limit completely, so
// those responses used to fall through to the generic !res.ok branch and get
// thrown as hard errors with no retry. Every caller wraps these in
// `.catch(() => [])`, so the whole snapshot silently collapsed to zeros — the
// dashboard reported "0 commits today" when the truth was "GitHub is throttling
// us". That is the failure this function exists to prevent.
function isRateLimited(res, bodyText) {
  if (res.status === 429) return true;
  if (res.status !== 403) return false;
  if (Number(res.headers.get('x-ratelimit-remaining') ?? '1') === 0) return true;
  if (res.headers.get('retry-after')) return true;
  return /secondary rate limit|abuse detection|rate limit exceeded/i.test(bodyText || '');
}

function rateLimitDelayMs(res, attempt) {
  // retry-after is authoritative when GitHub sends it (seconds, rarely a date).
  const retryAfter = res.headers.get('retry-after');
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs)) return clampDelay(secs * 1000);
    const when = Date.parse(retryAfter);
    if (!Number.isNaN(when)) return clampDelay(when - Date.now());
  }
  const remain = Number(res.headers.get('x-ratelimit-remaining') ?? '1');
  const reset = Number(res.headers.get('x-ratelimit-reset') || '0');
  if (remain === 0 && reset) return clampDelay(reset * 1000 - Date.now());
  // Secondary limit with no guidance. Exponential backoff plus jitter, so a
  // fan-out that got throttled together does not retry in lockstep and trip
  // the very same limit again.
  return clampDelay(1_000 * 2 ** attempt + Math.floor(Math.random() * 500));
}

const clampDelay = ms => Math.min(60_000, Math.max(1_000, ms));

// Returns the raw Response so callers that need headers (pagination follows
// the Link header) get the same retry and backoff treatment as everyone else.
async function ghRequest(url, { method = 'GET', body, retries = 4, accept = 'application/vnd.github+json' } = {}) {
  if (!isConfigured()) throw Object.assign(new Error('GitHub not configured'), { code: 'NOT_CONFIGURED', status: 428 });
  const headers = {
    'Authorization': `Bearer ${config.token}`,
    'Accept': accept,
    'User-Agent': UA,
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (body) headers['Content-Type'] = 'application/json';

  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(url.startsWith('http') ? url : config.apiBase + url, {
        method, headers, body: body ? JSON.stringify(body) : undefined,
      });
    } catch (netErr) {
      if (attempt > retries) throw Object.assign(new Error(`Network error: ${netErr.message}`), { code: 'NETWORK', status: 502 });
      await sleep(400 * attempt);
      continue;
    }

    if (res.status === 403 || res.status === 429) {
      // Safe to drain the body here: either we retry or we throw.
      const text = await res.text().catch(() => '');
      if (isRateLimited(res, text)) {
        lastRateLimitAt = Date.now();
        if (attempt > retries) {
          throw Object.assign(new Error('GitHub is rate limiting this token — data will be incomplete until it clears'), { code: 'RATE_LIMIT', status: 429 });
        }
        const wait = rateLimitDelayMs(res, attempt);
        console.warn(`[github] rate limited (${res.status}) on ${url} — waiting ${Math.round(wait / 1000)}s, attempt ${attempt}/${retries}`);
        await sleep(wait);
        continue;
      }
      throw Object.assign(new Error(`GitHub ${res.status}: ${text.slice(0, 300)}`), { code: 'HTTP', status: res.status });
    }
    if (res.status === 401) throw Object.assign(new Error('GitHub auth failed — check token & scopes'), { code: 'AUTH', status: 401 });
    if (res.status === 404) throw Object.assign(new Error(`Not found: ${url}`), { code: 'NOT_FOUND', status: 404 });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw Object.assign(new Error(`GitHub ${res.status}: ${text.slice(0, 300)}`), { code: 'HTTP', status: res.status });
    }
    return res;
  }
}

async function gh(url, opts = {}) {
  const res = await ghRequest(url, opts);
  const accept = opts.accept;
  if (accept === 'application/vnd.github.diff' || accept === 'application/vnd.github.patch') return res.text();
  return res.json();
}

async function ghPaginated(pathAndQuery, { limit = 200 } = {}) {
  const out = [];
  let url = pathAndQuery + (pathAndQuery.includes('?') ? '&' : '?') + 'per_page=100';
  while (url && out.length < limit) {
    let res;
    try {
      res = await ghRequest(url);
    } catch (err) {
      // A missing endpoint is normal (no Actions on the repo, no deployments).
      // Anything else — rate limits above all — must surface so the caller can
      // report incomplete data instead of quietly showing zeros.
      if (err.code === 'NOT_FOUND') return out;
      throw err;
    }
    const page = await res.json();
    // Most list endpoints return a bare array, but a few wrap the list in an
    // object: actions/runs → workflow_runs, check-runs → check_runs,
    // actions/artifacts → artifacts, search → items. The old bare
    // Array.isArray() check bailed on the first page of those, which is why
    // workflow runs came back empty every single time and failedBuilds,
    // successfulBuilds and buildSuccessRate were permanently zero.
    const items = Array.isArray(page)
      ? page
      : (page?.workflow_runs || page?.check_runs || page?.artifacts || page?.items);
    if (!Array.isArray(items)) break;
    out.push(...items);
    const link = res.headers.get('link') || '';
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    url = m ? m[1] : null;
  }
  return out.slice(0, limit);
}

// Bounded concurrency. The per-repo fetch used to fire ten paginated requests
// at once and then one request per deployment and per pull request — several
// hundred in flight on an active repo. GitHub's secondary limit trips around a
// hundred concurrent, so a single snapshot could throttle the token and keep it
// throttled on every refresh.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

// -------------------- Resolve scope → concrete repos --------------------
async function resolveRepos() {
  const items = [];
  for (const entry of config.scope) {
    try {
      if (entry.includes('/')) {
        items.push(await gh(`/repos/${entry}`));
      } else {
        // treat as org
        items.push(...await ghPaginated(`/orgs/${entry}/repos?sort=pushed&direction=desc`, { limit: 30 }));
      }
    } catch (err) {
      // This used to be a bare `catch {}`, which meant a throttled or
      // unauthorised token produced an empty repo list and therefore a snapshot
      // of zeros that looked exactly like a quiet week. Say what happened.
      console.warn(`[github] could not resolve scope entry "${entry}": ${err.message}`);
    }
  }
  return items.slice(0, 30); // hard cap for perf
}

// -------------------- Env mapping --------------------
function envForBranch(branch) {
  const b = String(branch || '').toLowerCase();
  for (const [env, keys] of Object.entries(config.env)) {
    if (keys.some(k => b === k || b.startsWith(k + '/') || b === `refs/heads/${k}` || b.endsWith('/' + k))) return env;
  }
  return null;
}
function envForDeployment(name) {
  const n = String(name || '').toLowerCase();
  for (const [env, keys] of Object.entries(config.env)) {
    if (keys.some(k => n === k || n.includes(k))) return env;
  }
  return null;
}

function issueKeys(text) {
  const out = new Set();
  const re = /#(\d+)/g; let m;
  while ((m = re.exec(text || ''))) out.add(Number(m[1]));
  return Array.from(out);
}

// -------------------- Aggregation --------------------
export async function getSnapshot() {
  const ttl = config.cacheTtlSeconds;
  const repos = await cached('repos', ttl, resolveRepos);

  // Repos are fetched a few at a time rather than all at once. The scope caps
  // at 30 repos and each one issues dozens of requests, so an unbounded
  // Promise.all here was the outer half of the concurrency burst that trips
  // GitHub's secondary rate limit.
  const perRepo = await mapLimit(repos, 3, r => cached(`repo:${r.full_name}`, ttl, () => fetchRepo(r)));

  // ---- flatten collections
  const allCommits = perRepo.flatMap(x => x.commits);
  const allPRs = perRepo.flatMap(x => x.prs);
  const allBranches = perRepo.flatMap(x => x.branches);
  const allDeployments = perRepo.flatMap(x => x.deployments);
  const allReleases = perRepo.flatMap(x => x.releases);
  const allWorkflowRuns = perRepo.flatMap(x => x.workflowRuns);
  const allIssues = perRepo.flatMap(x => x.issues);
  const allContributors = perRepo.flatMap(x => x.contributors);
  const allEvents = perRepo.flatMap(x => x.events);
  const allTags = perRepo.flatMap(x => x.tags);

  // ---- KPIs ----
  const now = Date.now();
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const t = todayStart.getTime();
  const weekAgo = now - 7 * 86400_000;
  const twoWeeksAgo = now - 14 * 86400_000;

  const commitsToday = allCommits.filter(c => new Date(c.date).getTime() >= t).length;
  const commitsWeek = allCommits.filter(c => new Date(c.date).getTime() >= weekAgo).length;
  const commitsPrevWeek = allCommits.filter(c => {
    const ct = new Date(c.date).getTime();
    return ct >= twoWeeksAgo && ct < weekAgo;
  }).length;

  const pushesToday = allEvents.filter(e => e.type === 'PushEvent' && new Date(e.date).getTime() >= t).length;
  const mergedToday = allPRs.filter(p => p.merged_at && new Date(p.merged_at).getTime() >= t).length;
  const openPRs = allPRs.filter(p => p.state === 'open').length;
  const pendingReviews = allPRs.filter(p => p.state === 'open' && (p.requestedReviewers || []).length).length;

  const runsFinished = allWorkflowRuns.filter(r => r.status === 'completed');
  const failedBuilds = runsFinished.filter(r => r.conclusion === 'failure').length;
  const successfulBuilds = runsFinished.filter(r => r.conclusion === 'success').length;
  const buildSuccessRate = runsFinished.length ? Math.round(successfulBuilds / runsFinished.length * 100) : 0;

  const prodReleasesWeek = allReleases.filter(r => new Date(r.published_at || r.created_at).getTime() >= weekAgo).length;

  // Merge / review time
  const mergedPRs = allPRs.filter(p => p.merged_at);
  const mergeTimes = mergedPRs.map(p => new Date(p.merged_at) - new Date(p.created_at)).filter(x => x > 0);
  const avgMergeMs = mergeTimes.length ? Math.round(mergeTimes.reduce((a, b) => a + b, 0) / mergeTimes.length) : 0;
  const reviewTimes = allPRs.flatMap(p => (p.firstReviewAt ? [new Date(p.firstReviewAt) - new Date(p.created_at)] : [])).filter(x => x > 0);
  const avgReviewMs = reviewTimes.length ? Math.round(reviewTimes.reduce((a, b) => a + b, 0) / reviewTimes.length) : 0;

  // DORA
  const deploysWeek = allDeployments.filter(d => new Date(d.created_at).getTime() >= weekAgo);
  const prodDeploys = allDeployments.filter(d => d.canonicalEnvironment === 'Production');
  const deployFrequencyPerWeek = deploysWeek.filter(d => d.canonicalEnvironment === 'Production').length;
  const leadTimes = mergedPRs.map(p => {
    // Lead time proxy: PR created → merged
    return new Date(p.merged_at) - new Date(p.created_at);
  }).filter(x => x > 0);
  const leadTimeMs = leadTimes.length ? Math.round(leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length) : 0;
  const failedProdDeploys = prodDeploys.filter(d => d.state === 'failure' || d.state === 'error').length;
  const changeFailureRate = prodDeploys.length ? Math.round(failedProdDeploys / prodDeploys.length * 100) : 0;
  // MTTR proxy: median time between a failed prod deploy and the next successful one
  const mttrMs = (() => {
    const sorted = [...prodDeploys].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const gaps = [];
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].state === 'failure' || sorted[i].state === 'error') {
        for (let j = i + 1; j < sorted.length; j++) {
          if (sorted[j].state === 'success') { gaps.push(new Date(sorted[j].created_at) - new Date(sorted[i].created_at)); break; }
        }
      }
    }
    if (!gaps.length) return 0;
    gaps.sort((a, b) => a - b);
    return gaps[Math.floor(gaps.length / 2)];
  })();
  const cycleTimeMs = leadTimeMs; // simplified

  const activeDevelopers = new Set(allCommits.map(c => c.author).filter(Boolean)).size;

  const kpis = {
    totalRepositories: repos.length,
    activeDevelopers,
    commitsToday, pushesToday, mergedToday,
    openPRs, pendingReviews, failedBuilds, successfulBuilds,
    prodReleasesWeek,
    avgMergeMs, avgReviewMs,
    leadTimeMs, cycleTimeMs, mttrMs,
    deploymentFrequencyPerWeek: deployFrequencyPerWeek,
    changeFailureRate,
    buildSuccessRate,
    commitsWeek, commitsPrevWeek,
  };

  // ---- Environment "current state" per repo ----
  // For each canonical env: last successful deployment or the tip commit of the mapped branch.
  const environmentState = {};
  for (const env of Object.keys(config.env)) {
    const rows = [];
    for (const r of perRepo) {
      const dep = r.deployments
        .filter(d => d.canonicalEnvironment === env && d.state === 'success')
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
      const branchName = config.env[env].find(k => r.branches.some(b => b.name === k || b.name === `refs/heads/${k}`));
      const branch = branchName ? r.branches.find(b => b.name === branchName || b.name === `refs/heads/${branchName}`) : null;
      if (!dep && !branch) continue;
      rows.push({
        repo: r.name, repoFull: r.full_name,
        env,
        sha: dep?.sha || branch?.commit?.sha,
        shortSha: (dep?.sha || branch?.commit?.sha || '').slice(0, 7),
        ref: dep?.ref || branch?.name,
        deployedAt: dep?.created_at || null,
        deployer: dep?.creator || null,
        status: dep ? dep.state : 'no-deploy',
        buildNumber: dep?.buildNumber || null,
        release: r.releases[0]?.tag_name || null,
      });
    }
    environmentState[env] = rows;
  }

  // ---- Features derived from issues+PRs ----
  const featureRegistry = buildFeatureRegistry({ issues: allIssues, prs: allPRs, commits: allCommits, deployments: allDeployments, releases: allReleases });

  // ---- Environment diff matrix ----
  const envDiff = buildEnvDiff(perRepo);

  // ---- Analytics ----
  const analytics = buildAnalytics({ commits: allCommits, prs: allPRs, deployments: allDeployments, runs: allWorkflowRuns, contributors: allContributors });

  // ---- Live activity feed ----
  const activity = allEvents.slice(0, 200);

  // ---- Notifications ----
  const notifications = buildNotifications({ prs: allPRs, runs: allWorkflowRuns, deployments: allDeployments, branches: allBranches, features: featureRegistry });

  // ---- Audit log ----
  const audit = allEvents.slice(0, 500).map(e => ({
    ts: e.date, actor: e.actor, action: e.type, repo: e.repo, detail: e.detail,
  }));

  // ---- Smart insights ----
  const insights = buildInsights({ kpis, features: featureRegistry, envDiff, prs: allPRs, branches: allBranches });

  // ---- Command-Center enrichments (Today's Progress, Needs Attention, Recently Released, Upcoming Releases, Weekly Summary) ----
  const nowMs = Date.now();
  const todayMs = new Date(); todayMs.setHours(0,0,0,0);
  const dayMs = 86400_000;

  // Enrich each feature with owner-role fields, time-in-stage, readiness, dependencies (best-effort).
  for (const f of featureRegistry) {
    const latestPr = f.prs?.[0];
    f.enteredStageAt = f.updated_at;
    f.qaOwner = null;
    f.reviewer = latestPr ? (latestPr.reviewers?.[0] || latestPr.requestedReviewers?.[0] || null) : null;
    f.estimatedRelease = null;
    f.blocked = f.risk === 'High' && (f.prs || []).some(p => p.mergeable_state === 'dirty' || p.changesRequested > 0);
    const hasReview = (f.prs || []).some(p => p.approvals > 0);
    const hasQA     = (f.deployments || []).some(d => ['Test','UAT'].includes(d.canonicalEnvironment) && d.state === 'success');
    const hasProdCheck = (f.deployments || []).some(d => d.canonicalEnvironment === 'Production' && d.state === 'success');
    f.readinessChecks = {
      codeReview:   hasReview,
      qa:           hasQA,
      performance:  hasQA,          // proxy — replace with real perf gate if available
      security:     hasReview,      // proxy — replace with real security gate if available
      approvals:    hasReview,
    };
    f.readinessScore = Math.round(Object.values(f.readinessChecks).filter(Boolean).length / 5 * 100);
    f.dependencies = [];
    f.displayName = f.title;
  }

  // Today's Progress — combines feature-level movement (when issues+PRs are used) with
  // raw activity counts (works for solo-dev repos that push straight to main without issues).
  // Adaptive window — try today first; if the repo is quiet, widen to 7d then 30d.
  // Solo-dev or low-frequency repos always show 0 on "today" — this makes the panel useful anyway.
  function computeWindow(sinceMs) {
    const inWin = iso => iso && new Date(iso).getTime() >= sinceMs;
    const commits = allCommits.filter(c => inWin(c.date));
    const prsOpened = allPRs.filter(p => inWin(p.created_at));
    const prsMerged = allPRs.filter(p => inWin(p.merged_at));
    const issuesOpened = allIssues.filter(i => inWin(i.created_at));
    const branchesCreated = allEvents.filter(e => e.type === 'CreateEvent' && inWin(e.date));
    const prodDeploys = allDeployments.filter(d => d.canonicalEnvironment === 'Production' && d.state === 'success' && inWin(d.created_at));
    const mainPushes = allEvents.filter(e => e.type === 'PushEvent' && inWin(e.date) && /\/(main|master)\b/.test(e.detail || ''));
    return {
      started:  Math.max(issuesOpened.length + branchesCreated.length,
                         featureRegistry.filter(f => inWin(f.enteredStageAt) && f.stage !== 'Backlog').length),
      toDev:    Math.max(commits.length,
                         featureRegistry.filter(f => f.stage === 'Development' && inWin(f.enteredStageAt)).length),
      toTest:   Math.max(prsOpened.length,
                         featureRegistry.filter(f => ['Testing','UAT','Code Review'].includes(f.stage) && inWin(f.enteredStageAt)).length),
      released: prodDeploys.length || prsMerged.length || mainPushes.length,
      activeDevs: new Set([
        ...allEvents.filter(e => inWin(e.date)).map(e => e.actor),
        ...commits.map(c => c.author),
      ].filter(Boolean)).size,
      blocked:  featureRegistry.filter(f => f.blocked).length,
    };
  }

  const windows = [
    { label: 'Today',        sinceMs: todayMs.getTime() },
    { label: 'Last 7 days',  sinceMs: nowMs - 7 * dayMs },
    { label: 'Last 30 days', sinceMs: nowMs - 30 * dayMs },
  ];
  let todayProgress = null;
  for (const w of windows) {
    const p = computeWindow(w.sinceMs);
    const nonBlockedSum = p.started + p.toDev + p.toTest + p.released + p.activeDevs;
    if (nonBlockedSum > 0) { todayProgress = { ...p, windowLabel: w.label }; break; }
  }
  if (!todayProgress) todayProgress = { ...computeWindow(0), windowLabel: 'All time' };

  const daysSince = iso => Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / dayMs));
  const needsAttention = [];
  for (const f of featureRegistry.filter(f => f.blocked).slice(0, 3))
    needsAttention.push({ severity:'high',   featureKey:f.key, name:f.title, reason:`Blocked for ${daysSince(f.updated_at)}d` });
  for (const f of featureRegistry.filter(f => ['Testing','UAT'].includes(f.stage) && daysSince(f.updated_at) >= 3).slice(0, 3))
    needsAttention.push({ severity:'medium', featureKey:f.key, name:f.title, reason:`Waiting for QA (${daysSince(f.updated_at)}d)` });
  for (const f of featureRegistry.filter(f => f.stage === 'Code Review' && daysSince(f.updated_at) >= 2).slice(0, 3))
    needsAttention.push({ severity:'warn',   featureKey:f.key, name:f.title, reason:'PR awaiting review' });
  for (const f of featureRegistry.filter(f => f.readinessScore >= 80 && f.stage !== 'Production').slice(0, 3))
    needsAttention.push({ severity:'good',   featureKey:f.key, name:f.title, reason:'Ready for Production' });

  const recentlyReleased = featureRegistry
    .filter(f => f.stage === 'Production').sort((a,b) => new Date(b.updated_at) - new Date(a.updated_at))
    .slice(0, 6).map(f => ({ key:f.key, name:f.title, when:f.updated_at, by:f.developers?.[0] || f.owner }));

  const upcomingReleases = featureRegistry
    .filter(f => f.stage !== 'Production' && f.readinessScore >= 60)
    .sort((a,b) => b.readinessScore - a.readinessScore)
    .slice(0, 6).map(f => ({ key:f.key, name:f.title, stage:f.stage, readiness:f.readinessScore, when:null }));

  const inLastN = (iso, n) => (nowMs - new Date(iso).getTime()) <= n * dayMs;
  const weeklySummary = {
    period: 'This week',
    bullets: [
      `${featureRegistry.filter(f => f.stage === 'Production' && inLastN(f.updated_at, 7)).length} feature(s) completed`,
      `${featureRegistry.filter(f => ['Testing','UAT','Code Review'].includes(f.stage) && inLastN(f.updated_at, 7)).length} entered testing`,
      `${featureRegistry.filter(f => f.blocked).length} blocked`,
      `${allDeployments.filter(d => d.canonicalEnvironment === 'Production' && d.state === 'success' && inLastN(d.created_at, 7)).length} released to Production`,
      `${upcomingReleases.length} planned for next week`,
    ],
  };

  // A snapshot of zeros is ambiguous: it means either "a genuinely quiet
  // period" or "we could not read GitHub at all". Say which, so nobody goes
  // hunting through unrelated settings to explain an empty dashboard.
  const warnings = [];
  if (config.scope.length && !repos.length) {
    warnings.push(`None of the ${config.scope.length} configured scope entr${config.scope.length === 1 ? 'y' : 'ies'} could be read from GitHub. Check that the token is valid and can see ${config.scope.join(', ')}.`);
  }
  if (lastRateLimitAt && Date.now() - lastRateLimitAt < 10 * 60_000) {
    warnings.push('GitHub rate limited this token in the last 10 minutes, so these numbers may be incomplete.');
  }

  return {
    generatedAt: new Date().toISOString(),
    scope: config.scope,
    warnings,
    repositories: repos.map(r => ({
      id: r.id, name: r.name, full_name: r.full_name, private: r.private, url: r.html_url,
      defaultBranch: r.default_branch, description: r.description,
      openIssues: r.open_issues_count, stars: r.stargazers_count, forks: r.forks_count, size: r.size,
      lang: r.language, pushedAt: r.pushed_at,
      health: computeRepoHealth(perRepo.find(x => x.full_name === r.full_name)),
    })),
    kpis,
    environmentState,
    commits: allCommits,
    pushes: allEvents.filter(e => e.type === 'PushEvent').slice(0, 200),
    prs: allPRs,
    branches: allBranches,
    deployments: allDeployments,
    releases: allReleases,
    workflowRuns: allWorkflowRuns,
    issues: allIssues,
    contributors: dedupeContribs(allContributors),
    tags: allTags,
    activity,
    features: featureRegistry,
    environmentDiff: envDiff,
    analytics,
    notifications,
    audit,
    insights,
    todayProgress, needsAttention, recentlyReleased, upcomingReleases, weeklySummary,
    backlogActivities: buildBacklogActivities({ prs: allPRs, issues: allIssues, features: featureRegistry }),
    rbac: config.rbac,
  };
}

// -------------------- Backlog activities --------------------
// Populate the Board's "Backlog" column from real GitHub state. Previously
// only demo data ever put anything here on the live snapshot, so users saw
// an empty column labelled "Nothing waiting" even when they had open PRs.
//
// A "backlog activity" is a piece of upcoming work — something opened or
// waiting to be picked up. Sources, in priority order:
//   1. Open PRs — draft or in-review (these are literally features waiting)
//   2. Open issues that aren't already tracked as an in-flight feature
// We stitch them into the same {name, person, action, when, url, featureKey}
// shape that stickyBacklog() renders, and cap to 40 so the column stays
// browsable without a scroll novel.
function buildBacklogActivities({ prs, issues, features }) {
  const inFlightKeys = new Set(features.filter(f => f.stage !== 'Backlog').map(f => f.key));
  const out = [];

  for (const p of prs) {
    if (p.state !== 'open') continue;
    out.push({
      name: p.title,
      person: p.author || 'unknown',
      action: p.draft ? 'PR opened (draft)' : 'PR opened',
      when: p.created_at,
      url: p.url,
      featureKey: `${p.repoFull}:${p.number}`,
    });
  }

  for (const i of issues) {
    if (i.state !== 'open') continue;
    const key = `${i.repoFull}:${i.number}`;
    if (inFlightKeys.has(key)) continue;                       // already on the board mid-flight
    if (out.some(a => a.featureKey === key)) continue;         // dedupe against a PR that fixes it
    out.push({
      name: i.title,
      person: i.author || 'unknown',
      action: 'Issue opened',
      when: i.created_at,
      url: i.url,
      featureKey: key,
    });
  }

  return out
    .sort((a, b) => new Date(b.when) - new Date(a.when))
    .slice(0, 40);
}

// -------------------- Per-repo fetch --------------------
async function fetchRepo(repo) {
  const owner = repo.owner?.login;
  const name = repo.name;
  const full = `${owner}/${name}`;
  // Per-repo fetch caps. Sized for a 90-day working window — the previous
  // caps (80 PRs, 100 commits) were tuned for "today at a glance" and
  // truncated activity on busy repos, so the Backlog column and Overview
  // charts effectively only ever showed the last day or two. Numbers picked
  // to comfortably cover a full quarter without paginating forever on very
  // active monorepos. `state=all&sort=updated` means we still get the most
  // recent updates first even when the cap trims older ones.
  const endpoints = [
    ['commits',      `/repos/${full}/commits?per_page=100`, 500],
    ['pull requests', `/repos/${full}/pulls?state=all&sort=updated&direction=desc`, 300],
    ['branches',     `/repos/${full}/branches?per_page=100`, 100],
    ['deployments',  `/repos/${full}/deployments?per_page=100`, 300],
    ['releases',     `/repos/${full}/releases?per_page=100`, 100],
    ['workflow runs', `/repos/${full}/actions/runs?per_page=100`, 200],
    ['issues',       `/repos/${full}/issues?state=all&sort=updated&direction=desc`, 300],
    ['contributors', `/repos/${full}/contributors?per_page=100&anon=true`, 100],
    // GitHub caps public events at 300 total — no point pulling past that.
    ['events',       `/repos/${full}/events?per_page=100`, 300],
    ['tags',         `/repos/${full}/tags?per_page=100`, 100],
  ];
  const [commitsRaw, prsRaw, branchesRaw, deploymentsRaw, releasesRaw, runsRaw, issuesRaw, contributorsRaw, eventsRaw, tagsRaw] =
    await mapLimit(endpoints, 3, async ([label, path, limit]) => {
      try {
        return await ghPaginated(path, { limit });
      } catch (err) {
        // Still degrade to an empty list, because one dead endpoint should not
        // blank the whole dashboard — but never silently. The bare
        // `.catch(() => [])` this replaces is why a throttled token was
        // indistinguishable from a repo where nothing had happened.
        console.warn(`[github] ${full}: ${label} unavailable — ${err.message}`);
        return [];
      }
    });

  const commits = commitsRaw.map(c => ({
    sha: c.sha, shortSha: c.sha.slice(0, 7),
    message: c.commit.message.split('\n')[0],
    author: c.author?.login || c.commit.author?.name || 'unknown',
    authorAvatar: c.author?.avatar_url,
    date: c.commit.author.date,
    url: c.html_url,
    repo: name, repoFull: full,
    parents: (c.parents || []).length,
    issues: issueKeys(c.commit.message),
  }));

  // Deployment statuses need extra fetches — pull the latest status per
  // deployment, but a few at a time. Unbounded, this alone put up to 300
  // requests in flight for one repo and was the single biggest contributor to
  // tripping GitHub's secondary rate limit.
  const depWithStatus = await mapLimit(deploymentsRaw, 4, async d => {
    let latest = { state: 'unknown', created_at: d.created_at };
    try {
      const statuses = await ghPaginated(`/repos/${full}/deployments/${d.id}/statuses?per_page=10`, { limit: 10 });
      if (statuses[0]) latest = statuses[0];
    } catch {}
    return {
      id: d.id, sha: d.sha, ref: d.ref,
      environment: d.environment, canonicalEnvironment: envForDeployment(d.environment),
      created_at: d.created_at, updated_at: d.updated_at,
      creator: d.creator?.login || 'unknown', creatorAvatar: d.creator?.avatar_url,
      state: latest.state,          // success | failure | error | pending | in_progress | queued
      description: latest.description,
      target_url: latest.target_url || latest.log_url,
      task: d.task,
      buildNumber: d.payload?.build_number || null,
      repo: name, repoFull: full,
    };
  });

  // PRs: keep ALL fetched PRs in the output (previously .slice(0, 60) here
  // silently dropped older ones, so the Backlog column and 90-day analytics
  // were seeing at most ~60 PRs per repo total). Only pull per-PR reviews
  // for the most recent 150 to keep API cost bounded — older PRs still show
  // up in the timeline & charts, they just won't have firstReviewAt/approval
  // counts populated (which don't matter for a 90-day-old merged PR).
  const REVIEW_CAP = 150;
  const prs = await mapLimit(prsRaw, 4, async (p, idx) => {
    let reviews = [];
    if (idx < REVIEW_CAP && (p.state === 'open' || p.merged_at)) {
      try { reviews = await ghPaginated(`/repos/${full}/pulls/${p.number}/reviews?per_page=30`, { limit: 30 }); } catch {}
    }
    const firstReviewAt = reviews.length ? reviews.map(r => r.submitted_at).sort()[0] : null;
    const approvals = reviews.filter(r => r.state === 'APPROVED').length;
    const changesRequested = reviews.filter(r => r.state === 'CHANGES_REQUESTED').length;
    return {
      id: p.id, number: p.number, title: p.title,
      body: p.body || '',
      state: p.state, draft: p.draft,
      author: p.user?.login, authorAvatar: p.user?.avatar_url,
      created_at: p.created_at, updated_at: p.updated_at, closed_at: p.closed_at, merged_at: p.merged_at,
      base: p.base?.ref, head: p.head?.ref,
      merge_commit_sha: p.merge_commit_sha,
      mergedBy: p.merged_by?.login || null,
      mergeable_state: p.mergeable_state,
      requestedReviewers: (p.requested_reviewers || []).map(u => u.login),
      reviewers: (p.assignees || []).map(u => u.login),
      reviewApprovers: reviews.filter(r => r.state === 'APPROVED').map(r => r.user?.login).filter(Boolean),
      labels: (p.labels || []).map(l => l.name),
      firstReviewAt, approvals, changesRequested,
      comments: p.review_comments,
      additions: p.additions, deletions: p.deletions, changed_files: p.changed_files,
      url: p.html_url,
      repo: name, repoFull: full,
      issues: issueKeys(p.title + ' ' + (p.body || '')),
    };
  });

  const branches = branchesRaw.map(b => ({
    name: b.name, protected: b.protected,
    commit: { sha: b.commit.sha, url: b.commit.url },
    repo: name, repoFull: full,
    env: envForBranch(b.name),
  }));

  const releases = releasesRaw.map(r => ({
    id: r.id, name: r.name || r.tag_name, tag_name: r.tag_name,
    author: r.author?.login, published_at: r.published_at, created_at: r.created_at,
    body: r.body, prerelease: r.prerelease, draft: r.draft,
    repo: name, repoFull: full, url: r.html_url,
  }));

  const workflowRuns = runsRaw.map(r => ({
    id: r.id, name: r.name, event: r.event,
    status: r.status, conclusion: r.conclusion,
    branch: r.head_branch,
    actor: r.actor?.login, actorAvatar: r.actor?.avatar_url,
    created_at: r.created_at, updated_at: r.updated_at,
    duration: r.updated_at && r.created_at ? new Date(r.updated_at) - new Date(r.created_at) : null,
    url: r.html_url,
    repo: name, repoFull: full,
  }));

  const issues = issuesRaw.filter(i => !i.pull_request).map(i => ({
    id: i.id, number: i.number, title: i.title,
    body: i.body || '',
    state: i.state, author: i.user?.login, authorAvatar: i.user?.avatar_url,
    assignees: (i.assignees || []).map(u => u.login),
    labels: (i.labels || []).map(l => l.name),
    comments: i.comments,
    milestone: i.milestone?.title, created_at: i.created_at, closed_at: i.closed_at, updated_at: i.updated_at,
    url: i.html_url, repo: name, repoFull: full,
  }));

  const contributors = contributorsRaw.map(c => ({
    login: c.login || c.name, avatar: c.avatar_url, contributions: c.contributions,
    repo: name, repoFull: full,
  }));

  const events = eventsRaw.map(e => normaliseEvent(e, full)).filter(Boolean);

  const tags = tagsRaw.map(t => ({ name: t.name, sha: t.commit.sha, repo: name, repoFull: full }));

  return { name, full_name: full, commits, prs, branches, deployments: depWithStatus, releases, workflowRuns, issues, contributors, events, tags };
}

function normaliseEvent(e, repoFull) {
  const base = { id: e.id, date: e.created_at, actor: e.actor?.login, actorAvatar: e.actor?.avatar_url, repo: repoFull, type: e.type };
  switch (e.type) {
    case 'PushEvent':
      return { ...base, detail: `pushed ${e.payload.commits?.length || 0} commit(s) to ${(e.payload.ref || '').replace('refs/heads/', '')}` };
    case 'PullRequestEvent':
      return { ...base, detail: `${e.payload.action} PR #${e.payload.number}: ${e.payload.pull_request?.title || ''}` };
    case 'PullRequestReviewEvent':
      return { ...base, detail: `${e.payload.review?.state?.toLowerCase() || 'reviewed'} PR #${e.payload.pull_request?.number}` };
    case 'IssuesEvent':
      return { ...base, detail: `${e.payload.action} issue #${e.payload.issue?.number}: ${e.payload.issue?.title || ''}` };
    case 'IssueCommentEvent':
      return { ...base, detail: `commented on #${e.payload.issue?.number}` };
    case 'ReleaseEvent':
      return { ...base, detail: `${e.payload.action} release ${e.payload.release?.tag_name || ''}` };
    case 'DeploymentEvent':
      return { ...base, detail: `deployed to ${e.payload.deployment?.environment}` };
    case 'DeploymentStatusEvent':
      return { ...base, detail: `deployment ${e.payload.deployment_status?.state} in ${e.payload.deployment?.environment}` };
    case 'CreateEvent':
      return { ...base, detail: `created ${e.payload.ref_type} ${e.payload.ref || ''}` };
    case 'DeleteEvent':
      return { ...base, detail: `deleted ${e.payload.ref_type} ${e.payload.ref || ''}` };
    case 'ForkEvent':
      return { ...base, detail: `forked to ${e.payload.forkee?.full_name}` };
    case 'WatchEvent':
      return { ...base, detail: `starred repo` };
    default:
      return { ...base, detail: e.type };
  }
}

function dedupeContribs(arr) {
  const map = new Map();
  for (const c of arr) {
    const prev = map.get(c.login) || { login: c.login, avatar: c.avatar, contributions: 0, repos: [] };
    prev.contributions += c.contributions || 0;
    if (!prev.repos.includes(c.repoFull)) prev.repos.push(c.repoFull);
    prev.avatar = prev.avatar || c.avatar;
    map.set(c.login, prev);
  }
  return Array.from(map.values()).sort((a, b) => b.contributions - a.contributions);
}

// -------------------- Feature registry --------------------
function buildFeatureRegistry({ issues, prs, commits, deployments, releases }) {
  const byKey = new Map(); // key = repoFull:issueNumber
  for (const i of issues) {
    const key = `${i.repoFull}:${i.number}`;
    byKey.set(key, {
      key, id: i.number, repoFull: i.repoFull, title: i.title,
      description: i.body || '', body: i.body || '',
      owner: i.author, ownerAvatar: i.authorAvatar, developers: [...i.assignees], assignees: [...i.assignees],
      labels: i.labels, milestone: i.milestone,
      state: i.state, created_at: i.created_at, updated_at: i.updated_at, closed_at: i.closed_at,
      commentsCount: i.comments || 0,
      url: i.url,
      prs: [], commits: [], deployments: [], releases: [],
    });
  }
  for (const p of prs) {
    for (const n of (p.issues || [])) {
      const key = `${p.repoFull}:${n}`;
      const f = byKey.get(key);
      if (f) { f.prs.push(p); if (p.author && !f.developers.includes(p.author)) f.developers.push(p.author); }
    }
  }
  for (const c of commits) {
    for (const n of (c.issues || [])) {
      const key = `${c.repoFull}:${n}`;
      const f = byKey.get(key);
      if (f) { f.commits.push(c); if (c.author && !f.developers.includes(c.author)) f.developers.push(c.author); }
    }
  }
  // Attribute deployments via commit-sha match
  for (const d of deployments) {
    const commit = commits.find(c => c.sha === d.sha);
    if (!commit) continue;
    for (const n of (commit.issues || [])) {
      const key = `${d.repoFull}:${n}`;
      const f = byKey.get(key);
      if (f) f.deployments.push(d);
    }
  }
  // Infer feature status
  const order = ['Production', 'UAT', 'Test', 'Development'];
  for (const f of byKey.values()) {
    const envs = new Set(f.deployments.filter(d => d.state === 'success').map(d => d.canonicalEnvironment).filter(Boolean));
    f.currentEnvironment = order.find(e => envs.has(e)) || (f.prs.some(p => p.merged_at) ? 'Development' : (f.prs.length ? 'Code Review' : (f.state === 'open' ? 'Development' : 'Backlog')));
    f.stage = pickStage(f);
    f.progress = computeProgress(f);
    f.risk = riskScore(f);
  }
  return Array.from(byKey.values());
}

function pickStage(f) {
  if (f.currentEnvironment === 'Production') return 'Production';
  if (f.currentEnvironment === 'UAT') return 'UAT';
  if (f.currentEnvironment === 'Test') return 'Testing';
  if (f.prs.some(p => p.state === 'open')) return 'Code Review';
  if (f.commits.length) return 'Development';
  return 'Backlog';
}
function computeProgress(f) {
  const stages = ['Backlog', 'Development', 'Code Review', 'Testing', 'UAT', 'Production'];
  return Math.round(((stages.indexOf(f.stage) + 1) / stages.length) * 100);
}
function riskScore(f) {
  let risk = 0;
  const totalChanges = f.prs.reduce((n, p) => n + ((p.additions || 0) + (p.deletions || 0)), 0);
  if (totalChanges > 1000) risk += 2; else if (totalChanges > 300) risk += 1;
  const files = f.prs.reduce((n, p) => n + (p.changed_files || 0), 0);
  if (files > 40) risk += 2; else if (files > 15) risk += 1;
  const anyReject = f.prs.some(p => p.changesRequested > 0);
  if (anyReject) risk += 1;
  const anyFail = f.deployments.some(d => d.state === 'failure' || d.state === 'error');
  if (anyFail) risk += 2;
  return risk >= 5 ? 'High' : (risk >= 2 ? 'Medium' : 'Low');
}

// -------------------- Env diff matrix --------------------
function buildEnvDiff(perRepo) {
  const envs = ['Development', 'Test', 'UAT', 'Production'];
  const rows = [];
  for (const r of perRepo) {
    const row = { repo: r.name, repoFull: r.full_name };
    const succDeps = r.deployments.filter(d => d.state === 'success');
    for (const env of envs) {
      const dep = succDeps.filter(d => d.canonicalEnvironment === env).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
      row[env] = dep ? { sha: dep.sha.slice(0, 7), fullSha: dep.sha, at: dep.created_at, by: dep.creator } : null;
    }
    // "missing in" logic: features present in Dev but not in later env
    row.missing = {};
    for (let i = 0; i < envs.length - 1; i++) {
      const a = envs[i], b = envs[i + 1];
      const shaA = row[a]?.fullSha, shaB = row[b]?.fullSha;
      row.missing[`${a}->${b}`] = !shaB || (shaA && shaA !== shaB);
    }
    rows.push(row);
  }
  return { environments: envs, repositories: rows };
}

// -------------------- Analytics --------------------
function buildAnalytics({ commits, prs, deployments, runs, contributors }) {
  const days = 30;
  const labels = [];
  const commitsPerDay = new Array(days).fill(0);
  const pushesPerDay = new Array(days).fill(0);
  const deploysPerDay = new Array(days).fill(0);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now); d.setDate(now.getDate() - i);
    labels.push(d.toISOString().slice(5, 10));
  }
  for (const c of commits) {
    const t = new Date(c.date); t.setHours(0, 0, 0, 0);
    const idx = days - 1 - Math.floor((now - t) / 86400_000);
    if (idx >= 0 && idx < days) commitsPerDay[idx]++;
  }
  for (const d of deployments) {
    const t = new Date(d.created_at); t.setHours(0, 0, 0, 0);
    const idx = days - 1 - Math.floor((now - t) / 86400_000);
    if (idx >= 0 && idx < days) deploysPerDay[idx]++;
  }

  // Commit heatmap by weekday x hour
  const heat = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const c of commits) {
    const d = new Date(c.date);
    heat[d.getDay()][d.getHours()]++;
  }

  // Top devs
  const perAuthor = new Map();
  for (const c of commits) perAuthor.set(c.author, (perAuthor.get(c.author) || 0) + 1);
  const topDevs = Array.from(perAuthor.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);

  // PR merge time distribution buckets (hrs)
  const buckets = { '<1h': 0, '1-8h': 0, '8-24h': 0, '1-3d': 0, '>3d': 0 };
  for (const p of prs.filter(p => p.merged_at)) {
    const h = (new Date(p.merged_at) - new Date(p.created_at)) / 3600_000;
    if (h < 1) buckets['<1h']++;
    else if (h < 8) buckets['1-8h']++;
    else if (h < 24) buckets['8-24h']++;
    else if (h < 72) buckets['1-3d']++;
    else buckets['>3d']++;
  }

  return {
    labels,
    commitsPerDay,
    pushesPerDay,
    deploysPerDay,
    heatmap: heat,
    topDevelopers: { labels: topDevs.map(x => x[0]), data: topDevs.map(x => x[1]) },
    mergeTimeBuckets: { labels: Object.keys(buckets), data: Object.values(buckets) },
  };
}

// -------------------- Notifications --------------------
function buildNotifications({ prs, runs, deployments, branches, features }) {
  const out = [];
  const now = Date.now();
  const day = 86400_000;

  for (const p of prs.filter(p => p.state === 'open')) {
    const openFor = now - new Date(p.created_at).getTime();
    if (openFor > 5 * day) out.push({ severity: 'warning', kind: 'stale-pr', title: `PR #${p.number} open for ${Math.round(openFor / day)}d — ${p.title}`, when: p.created_at, href: p.url });
    if (p.mergeable_state === 'dirty') out.push({ severity: 'warning', kind: 'conflict', title: `Merge conflict: PR #${p.number} ${p.title}`, when: p.updated_at, href: p.url });
    if (p.changesRequested > 0 && p.updated_at && (now - new Date(p.updated_at).getTime()) > 2 * day)
      out.push({ severity: 'info', kind: 'review-overdue', title: `Review overdue on #${p.number}`, when: p.updated_at, href: p.url });
  }
  for (const r of runs.filter(r => r.conclusion === 'failure')) {
    out.push({ severity: 'error', kind: 'build-failed', title: `Build failed: ${r.name} on ${r.branch}`, when: r.updated_at || r.created_at, href: r.url });
  }
  for (const d of deployments.filter(d => d.canonicalEnvironment === 'Production' && d.state === 'success')) {
    out.push({ severity: 'info', kind: 'prod-deploy', title: `Production deployment complete (${(d.sha || '').slice(0, 7)})`, when: d.created_at });
  }
  for (const b of branches) {
    if (b.name === b.repo) continue;
    // Marker for stale branches would need commit dates; using a lightweight rule
  }
  for (const f of features.filter(f => f.stage === 'Code Review' && f.prs.every(p => p.state === 'open') && f.updated_at && (now - new Date(f.updated_at).getTime()) > 3 * day)) {
    out.push({ severity: 'warning', kind: 'stuck-feature', title: `Feature stuck in review: #${f.id} ${f.title}`, when: f.updated_at, href: f.url });
  }
  out.sort((a, b) => new Date(b.when) - new Date(a.when));
  return out.slice(0, 40);
}

// -------------------- Smart insights --------------------
function buildInsights({ kpis, features, envDiff, prs, branches }) {
  const insights = [];
  insights.push(`${kpis.commitsToday} commits pushed today, ${kpis.mergedToday} PR${kpis.mergedToday === 1 ? '' : 's'} merged.`);
  const stuck = features.filter(f => f.stage === 'Code Review').length;
  if (stuck) insights.push(`${stuck} feature${stuck === 1 ? '' : 's'} sitting in code review.`);
  const prodShortfall = envDiff.repositories.filter(r => r.missing['UAT->Production']).length;
  if (prodShortfall) insights.push(`${prodShortfall} repo${prodShortfall === 1 ? '' : 's'} behind Production compared to UAT.`);
  const staleBranches = branches.filter(b => !['main', 'master'].includes(b.name)).length;
  if (staleBranches) insights.push(`${staleBranches} active side branches across the org.`);
  if (kpis.buildSuccessRate) insights.push(`Build success rate is ${kpis.buildSuccessRate}%.`);
  return insights;
}

function computeRepoHealth(repoData) {
  if (!repoData) return { score: 0, factors: {} };
  const runs = repoData.workflowRuns;
  const buildRate = runs.length ? Math.round(runs.filter(r => r.conclusion === 'success').length / runs.length * 100) : 100;
  const openIssues = repoData.issues.filter(i => i.state === 'open').length;
  const staleBranches = repoData.branches.length - 1;
  const factors = {
    buildSuccess: buildRate,
    openIssues,
    staleBranches: Math.max(0, staleBranches),
    prVolumeOpen: repoData.prs.filter(p => p.state === 'open').length,
  };
  const score = Math.max(0, Math.min(100, Math.round(
    buildRate * 0.5
    - Math.min(30, openIssues) * 0.5
    - Math.min(30, staleBranches) * 0.3
    - Math.min(30, factors.prVolumeOpen) * 0.4
    + 30
  )));
  return { score, factors };
}

// -------------------- Feature drilldown --------------------
export async function getFeatureTrace(key) {
  const snap = await getSnapshot();
  return snap.features.find(f => f.key === key || String(f.id) === String(key)) || null;
}

// -------------------- Commit diff --------------------
export async function getCommitDetail(repoFull, sha) {
  const c = await gh(`/repos/${repoFull}/commits/${sha}`);
  return {
    sha: c.sha, message: c.commit.message, author: c.author?.login || c.commit.author?.name,
    date: c.commit.author.date, files: (c.files || []).map(f => ({ path: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, patch: f.patch })),
    stats: c.stats, url: c.html_url,
  };
}

// -------------------- Release notes generator --------------------
export async function generateReleaseNotes(repoFull, sinceTag, headRef = 'main') {
  const cmp = await gh(`/repos/${repoFull}/compare/${sinceTag}...${headRef}`);
  const groups = { feat: [], fix: [], perf: [], docs: [], refactor: [], chore: [], other: [] };
  for (const c of cmp.commits || []) {
    const msg = c.commit.message.split('\n')[0];
    const m = msg.match(/^(feat|fix|perf|docs|refactor|chore)(\(.+?\))?:\s*(.+)/i);
    const kind = (m ? m[1] : 'other').toLowerCase();
    (groups[kind] || groups.other).push({ sha: c.sha.slice(0, 7), msg, author: c.author?.login });
  }
  return { since: sinceTag, head: headRef, ahead: cmp.ahead_by, behind: cmp.behind_by, groups };
}
