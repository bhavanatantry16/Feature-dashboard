/*
 * Azure DevOps deployment source. Consumes the three per-environment URLs
 * (Dev/Test/Prod) from config.azdo.urls plus a single PAT. Each URL is parsed
 * into (org, project) — same project across all three slots is the common case;
 * different projects per env is also supported.
 *
 * Returns a normalised, human-readable per-environment view:
 *   {
 *     configured: true,
 *     projects: [{ orgUrl, project, envSlots: ['Development','Test','Production'] }],
 *     byEnvironment: {
 *       Development: [{ feature, buildNumber, deployedBy, at, status, url }, ...],
 *       Test:        [...],
 *       Production:  [...],
 *     },
 *     diff: {
 *       'Development->Test':      [ featureNamesInDevButNotTest ],
 *       'Test->Production':       [ featureNamesInTestButNotProd ],
 *       'Development->Production':[ featureNamesInDevButNotProd ],
 *     },
 *     lastFetchedAt: iso,
 *   }
 *
 * Callers get an empty (but still shaped) result when AZDO is not configured so
 * the Board can render "no data yet" states without special-casing.
 */

import { config, isAzdoConfigured, azdoProjectsFromUrls, parseAzdoUrl } from '../config.js';
import { cached } from './cache.js';

const API_VERSION = '7.1';
const EMPTY_RESULT = {
  configured: false,
  projects: [],
  byEnvironment: { Development: [], Test: [], Production: [] },
  diff: { 'Development->Test': [], 'Test->Production': [], 'Development->Production': [] },
  lastFetchedAt: null,
};

function authHeader() {
  const b64 = Buffer.from(':' + config.azdo.pat).toString('base64');
  return `Basic ${b64}`;
}
function vsrmUrl(orgUrl) {
  const u = new URL(orgUrl);
  u.host = u.host.replace(/^dev\.azure\.com$/i, 'vsrm.dev.azure.com');
  u.host = u.host.replace(/^([^.]+)\.visualstudio\.com$/i, '$1.vsrm.visualstudio.com');
  return `${u.origin}${u.pathname.replace(/\/$/, '')}`;
}

async function azdoFetch(url, { retries = 2 } = {}) {
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(url, { headers: { Authorization: authHeader(), Accept: 'application/json' } });
    } catch (netErr) {
      if (attempt > retries) throw Object.assign(new Error(`AZDO network: ${netErr.message}`), { code: 'NETWORK' });
      await new Promise(r => setTimeout(r, 400 * attempt));
      continue;
    }
    if (res.status === 429 && attempt <= retries) {
      const wait = Number(res.headers.get('Retry-After') || '2') * 1000;
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      const text = await res.text().catch(() => '');
      throw Object.assign(new Error(`AZDO auth (${res.status}): ${text.slice(0, 200)}`), { code: 'AUTH' });
    }
    if (res.status === 404) return { value: [] };  // project may not have releases enabled
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw Object.assign(new Error(`AZDO ${res.status}: ${text.slice(0, 300)}`), { code: 'HTTP' });
    }
    const ctype = res.headers.get('content-type') || '';
    if (!ctype.includes('application/json')) {
      const text = await res.text().catch(() => '');
      if (/sign in/i.test(text)) throw Object.assign(new Error('AZDO returned a sign-in page — PAT likely invalid.'), { code: 'AUTH' });
      return { value: [] };
    }
    return res.json();
  }
}

/*
 * Fetch every recent deployment across the project and normalise into a
 * human-oriented row (no SHAs, no branch names). The `feature` string is what
 * the UI shows on the Board and diff cards.
 */
async function fetchProjectDeployments(orgUrl, project) {
  const enc = encodeURIComponent(project);
  const url = `${vsrmUrl(orgUrl)}/${enc}/_apis/release/deployments?$top=200&queryOrder=descending&api-version=${API_VERSION}`;
  const data = await azdoFetch(url);
  return (data.value || []).map(d => normaliseDeployment(d, orgUrl, project));
}

function humanFeature(deployment) {
  // Prefer the release name (usually "Release-42") + description if the pipeline
  // sets one; fall back to pipeline name. All are human-readable — no SHAs, no
  // branch names, so managers can scan the Board without Git knowledge.
  const releaseName = deployment.release?.name;
  const description = deployment.release?.description;
  const pipeline = deployment.releaseDefinition?.name;
  const stage = deployment.releaseEnvironment?.name;
  const feature = (description && description.length < 80 && description) ||
                  releaseName ||
                  pipeline ||
                  stage ||
                  'Untitled release';
  return feature.replace(/^Release[-\s]?/i, 'Release ');
}

function statusFrom(rawStatus) {
  return ({
    succeeded: 'success', failed: 'failure', partiallySucceeded: 'failure',
    inProgress: 'in_progress', queued: 'in_progress', notDeployed: 'pending', all: 'success',
  })[rawStatus] || (rawStatus || 'unknown');
}

function normaliseDeployment(d, orgUrl, project) {
  const stageName = d.releaseEnvironment?.name || '';
  return {
    id: `azdo-${d.id}`,
    orgUrl,
    project,
    stageName,
    canonicalEnvironment: canonicalForStage(stageName),
    feature: humanFeature(d),
    buildNumber: d.release?.artifacts?.[0]?.definitionReference?.version?.name || null,
    releaseName: d.release?.name || '',
    deployedBy: d.requestedFor?.displayName || d.requestedBy?.displayName || 'unknown',
    at: d.completedOn || d.startedOn || d.queuedOn || null,
    status: statusFrom(d.deploymentStatus),
    rawStatus: d.deploymentStatus,
    isRollback: d.reason === 'redeploy' || (d.attempt || 1) > 1,
    url: d._links?.web?.href || `${orgUrl}/${encodeURIComponent(project)}/_release?releaseId=${d.release?.id}`,
  };
}

function canonicalForStage(stageName) {
  const n = String(stageName || '').toLowerCase();
  for (const [env, patterns] of Object.entries(config.env)) {
    if (patterns.some(p => n === p || n.includes(p))) return env;
  }
  return null;
}

/*
 * Group latest successful deployments by canonical environment. When a project
 * appears in multiple env slots, we further restrict which stages count per slot
 * by using the env-keyword lists (a "Test" slot only shows stages that map to
 * Test, etc.). This lets a single Azure DevOps project drive all three columns.
 */
function groupByEnvironment(deployments, envSlots) {
  const latestByPipelineAndEnv = new Map(); // pipelineName+env -> deployment
  for (const d of deployments) {
    if (!d.canonicalEnvironment) continue;
    if (!envSlots.includes(d.canonicalEnvironment)) continue;
    const key = `${d.releaseName || d.feature}::${d.canonicalEnvironment}`;
    const prev = latestByPipelineAndEnv.get(key);
    if (!prev || new Date(d.at) > new Date(prev.at)) latestByPipelineAndEnv.set(key, d);
  }
  const byEnv = { Development: [], Test: [], UAT: [], Production: [] };
  for (const d of latestByPipelineAndEnv.values()) {
    byEnv[d.canonicalEnvironment]?.push(d);
  }
  // Sort each env by most recent
  for (const key of Object.keys(byEnv)) byEnv[key].sort((a, b) => new Date(b.at) - new Date(a.at));
  return byEnv;
}

function computeDiff(byEnv) {
  const nameSet = env => new Set((byEnv[env] || []).map(d => d.feature));
  const dev = nameSet('Development');
  const test = nameSet('Test');
  const prod = nameSet('Production');
  const diffOf = (a, b) => Array.from(a).filter(f => !b.has(f));
  return {
    'Development->Test':       diffOf(dev, test),
    'Test->Production':        diffOf(test, prod),
    'Development->Production': diffOf(dev, prod),
  };
}

export async function getAzdoEnvView() {
  if (!isAzdoConfigured()) return EMPTY_RESULT;
  const projects = azdoProjectsFromUrls();
  if (!projects.length) return EMPTY_RESULT;

  const ttl = config.cacheTtlSeconds;
  const allDeployments = [];
  const errors = [];
  await Promise.all(projects.map(async p => {
    try {
      const list = await cached(`azdo:${p.orgUrl}::${p.project}`, ttl, () => fetchProjectDeployments(p.orgUrl, p.project));
      allDeployments.push(...list);
    } catch (e) {
      errors.push({ orgUrl: p.orgUrl, project: p.project, message: e.message });
      console.warn('[azdo]', p.project, e.message);
    }
  }));

  // For each project, restrict to the env slots it was mapped into so a
  // project used only for "Production" doesn't accidentally leak into "Dev".
  const merged = { Development: [], Test: [], UAT: [], Production: [] };
  for (const p of projects) {
    const projectDeps = allDeployments.filter(d => d.orgUrl === p.orgUrl && d.project === p.project);
    const grouped = groupByEnvironment(projectDeps, p.envSlots);
    for (const key of Object.keys(merged)) merged[key].push(...grouped[key]);
  }
  const diff = computeDiff(merged);

  return {
    configured: true,
    projects,
    byEnvironment: merged,
    diff,
    lastFetchedAt: new Date().toISOString(),
    errors: errors.length ? errors : undefined,
  };
}

// Kept for back-compat with earlier azdoService.getAzdoDeployments callers.
export async function getAzdoDeployments() {
  const view = await getAzdoEnvView();
  const flat = [];
  for (const env of Object.keys(view.byEnvironment)) flat.push(...view.byEnvironment[env]);
  return {
    configured: view.configured,
    deployments: flat,
    releases: [],
    builds: [],
    errors: view.errors,
  };
}
