import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SETTINGS_FILE = path.join(__dirname, '..', '.settings.json');

function parseList(raw) {
  if (Array.isArray(raw)) return raw.map(s => String(s).trim()).filter(Boolean);
  return String(raw || '').split(',').map(s => s.trim()).filter(Boolean);
}

function loadPersisted() {
  try { if (fs.existsSync(SETTINGS_FILE)) return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')); } catch {}
  return {};
}
const persisted = loadPersisted();

/*
 * Accepts any Azure DevOps URL and pulls (org, project) out of it. Examples:
 *   https://dev.azure.com/mantrika-ai/ttsw-app                    → mantrika-ai / ttsw-app
 *   https://dev.azure.com/mantrika-ai/ttsw-app/_release?...       → mantrika-ai / ttsw-app
 *   https://dev.azure.com/mantrika-ai/ttsw-app/_environments/12   → mantrika-ai / ttsw-app
 *   https://mantrika-ai.visualstudio.com/ttsw-app/_dashboards      → mantrika-ai / ttsw-app  (legacy)
 * Environment slots typically all point at the same project — that's fine, we
 * deduplicate. Returns null when the URL doesn't parse.
 */
export function parseAzdoUrl(raw) {
  const url = String(raw || '').trim();
  if (!url) return null;
  try {
    const u = new URL(url);
    let orgUrl = null, project = null;
    if (/dev\.azure\.com$/i.test(u.host)) {
      const parts = u.pathname.split('/').filter(Boolean);   // ["<org>", "<project>", ...]
      if (parts.length >= 1) orgUrl = `https://dev.azure.com/${parts[0]}`;
      if (parts.length >= 2) project = decodeURIComponent(parts[1]);
    } else if (/\.visualstudio\.com$/i.test(u.host)) {
      const org = u.host.split('.')[0];
      const parts = u.pathname.split('/').filter(Boolean);
      orgUrl = `https://${org}.visualstudio.com`;
      if (parts.length >= 1) project = decodeURIComponent(parts[0]);
    }
    if (!orgUrl || !project) return null;
    return { orgUrl: orgUrl.replace(/\/$/, ''), project };
  } catch { return null; }
}

function normaliseAzdoUrls(source) {
  const urls = source || {};
  return {
    Development: (urls.Development || '').trim(),
    Test:        (urls.Test || '').trim(),
    Production:  (urls.Production || '').trim(),
  };
}

/*
 * Back-compat: earlier settings held a single (azdoOrgUrl, azdoProject) pair.
 * If those exist but per-env URLs don't, promote them to the Production slot so
 * old configs still surface deployments somewhere reasonable.
 */
function seedFromLegacy(urls, legacy) {
  const anySet = urls.Development || urls.Test || urls.Production;
  if (anySet) return urls;
  if (legacy?.orgUrl && legacy?.project) {
    return { ...urls, Production: `${legacy.orgUrl.replace(/\/$/, '')}/${encodeURIComponent(legacy.project)}` };
  }
  return urls;
}

const legacyAzdo = {
  orgUrl:  (persisted.azdoOrgUrl  || process.env.AZDO_ORG_URL  || '').replace(/\/$/, ''),
  project:  persisted.azdoProject || process.env.AZDO_PROJECT  || '',
};
const envSeedUrls = {
  Development: process.env.AZDO_URL_DEV  || '',
  Test:        process.env.AZDO_URL_TEST || '',
  Production:  process.env.AZDO_URL_PROD || '',
};
const persistedUrls = normaliseAzdoUrls(persisted.azdoUrls);
const initialUrls = seedFromLegacy(
  {
    Development: persistedUrls.Development || envSeedUrls.Development,
    Test:        persistedUrls.Test        || envSeedUrls.Test,
    Production:  persistedUrls.Production  || envSeedUrls.Production,
  },
  legacyAzdo,
);

export const config = {
  token: persisted.token || process.env.GITHUB_TOKEN || '',
  apiBase: (process.env.GITHUB_API_BASE || 'https://api.github.com').replace(/\/$/, ''),
  scope: parseList(persisted.scope || process.env.GITHUB_SCOPE || ''),
  webhookSecret: process.env.GITHUB_WEBHOOK_SECRET || '',
  // Persisted session secret so restarts don't log everyone out. First-run
  // it's empty; authService.sessionSecret() generates one and stores it here.
  sessionSecret: persisted.sessionSecret || process.env.SESSION_SECRET || '',
  // GitHub OAuth (for the Sign in with GitHub button). Optional — the app
  // boots fine without it; the OAuth strategy just isn't registered until
  // both clientId and clientSecret land in .settings.json.
  githubOAuth: {
    clientId:     persisted.githubOAuth?.clientId     || process.env.GITHUB_OAUTH_CLIENT_ID     || '',
    clientSecret: persisted.githubOAuth?.clientSecret || process.env.GITHUB_OAUTH_CLIENT_SECRET || '',
    callbackUrl:  persisted.githubOAuth?.callbackUrl  || process.env.GITHUB_OAUTH_CALLBACK_URL  || '',
  },
  env: {
    Development: parseList(process.env.ENV_DEV_KEYS  || 'dev,develop,development'),
    Test:        parseList(process.env.ENV_TEST_KEYS || 'test,qa,testing,sit'),
    UAT:         parseList(process.env.ENV_UAT_KEYS  || 'uat,staging,stage,preprod'),
    Production:  parseList(process.env.ENV_PROD_KEYS || 'main,master,prod,production,release'),
  },
  azdo: {
    urls: initialUrls,
    pat:  persisted.azdoPat || process.env.AZDO_PAT || '',
    // Convenience mirrors — kept in sync at assignment time so azdoService can
    // reach a single (orgUrl, project) without re-parsing URLs on every call.
    orgUrl: '',
    project: '',
  },
  featureNotes: persisted.featureNotes || {},  // { featureKey: 'user note' } — editable per-feature notes
  port: Number(process.env.PORT || 8788),
  cacheTtlSeconds: Number(process.env.CACHE_TTL_SECONDS || 60),
  clientRefreshSeconds: Number(process.env.CLIENT_REFRESH_SECONDS || 60),
  corsOrigins: parseList(process.env.CORS_ORIGINS),
  rbac: (() => {
    const out = {};
    for (const pair of parseList(process.env.RBAC_ASSIGNMENTS)) {
      const [login, role] = pair.split(':').map(s => s.trim());
      if (login && role) out[login.toLowerCase()] = role;
    }
    return out;
  })(),
};

// Initial mirror of the first parsable URL — azdoService uses this fallback for
// endpoints that only work at project scope (releases, builds).
;(function primeAzdoMirror() {
  for (const key of ['Production', 'Test', 'Development']) {
    const parsed = parseAzdoUrl(config.azdo.urls[key]);
    if (parsed) { config.azdo.orgUrl = parsed.orgUrl; config.azdo.project = parsed.project; return; }
  }
  // fall back to legacy fields when no URL provided
  config.azdo.orgUrl = legacyAzdo.orgUrl;
  config.azdo.project = legacyAzdo.project;
})();

/**
 * Return the unique (orgUrl, project) pairs derived from configured env URLs.
 * De-duplicates when the same project is used across multiple env slots (common).
 */
export function azdoProjectsFromUrls() {
  const seen = new Map();
  for (const [envKey, url] of Object.entries(config.azdo.urls)) {
    const parsed = parseAzdoUrl(url);
    if (!parsed) continue;
    const key = `${parsed.orgUrl}::${parsed.project}`;
    if (!seen.has(key)) seen.set(key, { ...parsed, envSlots: [] });
    seen.get(key).envSlots.push(envKey);
  }
  return Array.from(seen.values());
}

export function persistSettings({ token, scope, azdoUrls, azdoPat, azdoOrgUrl, azdoProject, featureNotes, sessionSecret, githubOAuth }) {
  const current = loadPersisted();
  const nextUrls = normaliseAzdoUrls({ ...(current.azdoUrls || {}), ...(azdoUrls || {}) });
  const nextOAuth = githubOAuth !== undefined
    ? { ...(current.githubOAuth || {}), ...githubOAuth }
    : current.githubOAuth;
  const next = {
    ...current,
    ...(token         !== undefined ? { token } : {}),
    ...(scope         !== undefined ? { scope } : {}),
    ...(azdoUrls      !== undefined ? { azdoUrls: nextUrls } : {}),
    ...(azdoPat       !== undefined ? { azdoPat } : {}),
    ...(azdoOrgUrl    !== undefined ? { azdoOrgUrl } : {}),
    ...(azdoProject   !== undefined ? { azdoProject } : {}),
    ...(featureNotes  !== undefined ? { featureNotes } : {}),
    ...(sessionSecret !== undefined ? { sessionSecret } : {}),
    ...(githubOAuth   !== undefined ? { githubOAuth: nextOAuth } : {}),
  };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2), { mode: 0o600 });

  // Update live config in-place
  if (token !== undefined) config.token = next.token || config.token;
  if (scope !== undefined) config.scope = parseList(next.scope || '');
  if (azdoPat !== undefined) config.azdo.pat = next.azdoPat || '';
  if (featureNotes !== undefined) config.featureNotes = next.featureNotes || {};
  if (sessionSecret !== undefined) config.sessionSecret = next.sessionSecret || '';
  if (githubOAuth !== undefined) config.githubOAuth = { ...config.githubOAuth, ...nextOAuth };
  if (azdoUrls !== undefined || azdoOrgUrl !== undefined || azdoProject !== undefined) {
    config.azdo.urls = seedFromLegacy(nextUrls, { orgUrl: next.azdoOrgUrl, project: next.azdoProject });
    // Re-prime mirror
    for (const key of ['Production', 'Test', 'Development']) {
      const parsed = parseAzdoUrl(config.azdo.urls[key]);
      if (parsed) { config.azdo.orgUrl = parsed.orgUrl; config.azdo.project = parsed.project; break; }
    }
  }
  return { ok: true };
}

export function isConfigured() { return Boolean(config.token && config.scope.length); }
export function isAzdoConfigured() {
  const anyUrl = Object.values(config.azdo.urls).some(u => parseAzdoUrl(u));
  return Boolean(anyUrl && config.azdo.pat);
}

export function configStatus() {
  return {
    configured: isConfigured(),
    hasToken: Boolean(config.token),
    scope: config.scope,
    apiBase: config.apiBase,
    clientRefreshSeconds: config.clientRefreshSeconds,
    azdo: {
      configured: isAzdoConfigured(),
      urls: config.azdo.urls,
      hasPat: Boolean(config.azdo.pat),
      projects: azdoProjectsFromUrls(),
    },
  };
}
