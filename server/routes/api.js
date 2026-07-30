import express from 'express';
import { config, configStatus, isConfigured, persistSettings } from '../config.js';
import { getSnapshot, getFeatureTrace, getCommitDetail, generateReleaseNotes } from '../services/githubService.js';
import { getDemoSnapshot } from '../services/demoData.js';
import { invalidate } from '../services/cache.js';
import { handleWebhook, verifySignature, subscribe } from '../services/webhookService.js';
import { getRoadmap, setRoadmap, parseCsv } from '../services/roadmapService.js';
import { getAzdoEnvView } from '../services/azdoService.js';

export const apiRouter = express.Router();

function wantsDemo(req) { return req.query.demo === '1' || req.query.demo === 'true'; }

apiRouter.get('/config', (_req, res) => res.json(configStatus()));

apiRouter.post('/config', express.json({ limit: '256kb' }), (req, res) => {
  const { token, scope, azdoUrls, azdoPat } = req.body || {};
  const scopeList = scope === undefined
    ? undefined
    : (Array.isArray(scope) ? scope : String(scope).split(',').map(s => s.trim()).filter(Boolean));

  // Allow saving just AZDO fields without re-entering the GitHub token — every
  // field is optional; the server only requires that after the save, GitHub
  // scope+token OR AZDO urls+pat are usable (or the user is intentionally
  // running in demo mode, which is fine).
  persistSettings({
    ...(token !== undefined ? { token } : {}),
    ...(scopeList !== undefined ? { scope: scopeList } : {}),
    ...(azdoUrls !== undefined ? { azdoUrls } : {}),
    ...(azdoPat !== undefined ? { azdoPat } : {}),
  });
  invalidate('');
  res.json({ ok: true, status: configStatus() });
});

apiRouter.get('/snapshot', async (req, res) => {
  // Serve demo data whenever GitHub isn't configured, or when explicitly requested.
  // Even in demo mode we still layer real AZDO deployment presence in when the
  // user has connected it — lets them explore the flow before pointing at real
  // repos. The demo snapshot already ships with a synthetic `azdo` view; we
  // only overwrite it when a real AZDO connection is configured.
  const base = (wantsDemo(req) || !isConfigured())
    ? getDemoSnapshot()
    : await getSnapshot().catch(e => { throw e; });
  try {
    const azdoView = await getAzdoEnvView();
    if (azdoView.configured || !base.azdo) base.azdo = azdoView;
    base.featureNotes = config.featureNotes || {};
    res.json(base);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, code: e.code });
  }
});

// --- Editable per-feature notes (persisted server-side) ---
apiRouter.get('/notes', (_req, res) => res.json(config.featureNotes || {}));

apiRouter.post('/notes', express.json({ limit: '128kb' }), (req, res) => {
  const { key, note } = req.body || {};
  if (!key) return res.status(400).json({ error: 'key required' });
  const notes = { ...(config.featureNotes || {}) };
  if (!note || !String(note).trim()) delete notes[key];
  else notes[key] = String(note).trim().slice(0, 500);
  persistSettings({ featureNotes: notes });
  invalidate('');
  res.json({ ok: true, notes });
});

apiRouter.get('/feature/:key', async (req, res) => {
  if (wantsDemo(req) || !isConfigured()) {
    const snap = getDemoSnapshot();
    const f = snap.features.find(x => x.key === req.params.key || String(x.id) === req.params.key);
    return f ? res.json(f) : res.status(404).json({ error: 'not found' });
  }
  try { const f = await getFeatureTrace(req.params.key); res.json(f); }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

apiRouter.get('/commit/:owner/:repo/:sha', async (req, res) => {
  if (wantsDemo(req)) {
    return res.json({
      sha: req.params.sha,
      message: 'feat: demo commit',
      author: 'demo-user', date: new Date().toISOString(),
      files: [
        { path: 'src/index.ts', status: 'modified', additions: 12, deletions: 3, patch: '@@ -1,3 +1,12 @@\n+// demo diff' },
        { path: 'README.md', status: 'modified', additions: 1, deletions: 0, patch: '@@ -1 +1 @@\n+demo' },
      ],
      stats: { total: 16, additions: 13, deletions: 3 }, url: '#',
    });
  }
  if (!isConfigured()) return res.status(428).json({ error: 'not configured' });
  try { res.json(await getCommitDetail(`${req.params.owner}/${req.params.repo}`, req.params.sha)); }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

apiRouter.get('/release-notes/:owner/:repo', async (req, res) => {
  const { since, head = 'main' } = req.query;
  if (!since) return res.status(400).json({ error: 'since=<tag> is required' });
  if (wantsDemo(req)) {
    return res.json({
      since, head, ahead: 12, behind: 0,
      groups: {
        feat: [{ sha: 'a1b2c3d', msg: 'feat: passwordless sign-in', author: 'anika-r' }],
        fix: [{ sha: 'e4f5g6h', msg: 'fix: rate limiter bypass', author: 'marcus-lee' }],
        perf: [], docs: [], refactor: [], chore: [], other: [],
      },
    });
  }
  if (!isConfigured()) return res.status(428).json({ error: 'not configured' });
  try { res.json(await generateReleaseNotes(`${req.params.owner}/${req.params.repo}`, since, head)); }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

apiRouter.post('/refresh', (_req, res) => { invalidate(''); res.json({ ok: true }); });

// --- Roadmap ---
apiRouter.get('/roadmap', (_req, res) => res.json(getRoadmap()));

apiRouter.post('/roadmap', express.json({ limit: '2mb' }), (req, res) => {
  const items = Array.isArray(req.body) ? req.body : (req.body?.items || []);
  res.json(setRoadmap(items));
});

// Add / update / delete a single item without re-sending the whole plan —
// wired to the inline "Add feature" button and the per-card delete button
// on the Roadmap tab, so the CSV isn't the only way to change the plan.
apiRouter.post('/roadmap/item', express.json({ limit: '32kb' }), (req, res) => {
  const item = req.body || {};
  if (!item.name || !String(item.name).trim()) return res.status(400).json({ error: 'name required' });
  const current = getRoadmap().items || [];
  // Upsert by id when the client sends one (edit case); else append.
  const idx = item.id ? current.findIndex(i => i.id === item.id) : -1;
  const next = idx >= 0
    ? current.map((i, k) => k === idx ? { ...i, ...item } : i)
    : [...current, item];
  res.json(setRoadmap(next));
});

apiRouter.delete('/roadmap/item/:id', (req, res) => {
  const current = getRoadmap().items || [];
  res.json(setRoadmap(current.filter(i => i.id !== req.params.id)));
});

// Upload as raw CSV, JSON, or line-per-name plaintext (Content-Type decides).
apiRouter.post('/roadmap/upload', express.text({ type: '*/*', limit: '2mb' }), (req, res) => {
  const ct = (req.get('Content-Type') || '').toLowerCase();
  const text = (typeof req.body === 'string' ? req.body : '').trim();
  if (!text) return res.status(400).json({ error: 'empty body' });
  let items = [];
  try {
    if (ct.includes('json')) items = JSON.parse(text);
    else if (ct.includes('csv') || text.includes(',')) items = parseCsv(text);
    else items = text.split(/\r?\n/).filter(Boolean).map(name => ({ name }));
  } catch (e) { return res.status(400).json({ error: 'parse error: ' + e.message }); }
  res.json(setRoadmap(Array.isArray(items) ? items : (items.items || [])));
});

// GitHub webhook receiver (real-time invalidation)
apiRouter.post('/webhooks/github', express.raw({ type: '*/*', limit: '2mb' }), (req, res) => {
  const sig = req.get('X-Hub-Signature-256') || '';
  if (!verifySignature(req.body, sig)) return res.status(401).json({ error: 'bad signature' });
  const event = req.get('X-GitHub-Event') || 'unknown';
  let payload = {};
  try { payload = JSON.parse(req.body.toString('utf-8')); } catch {}
  handleWebhook(event, payload);
  res.json({ ok: true });
});

// SSE stream so the UI updates instantly on webhook or refresh
apiRouter.get('/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  res.write(`retry: 5000\n\n`);
  subscribe(res);
});
