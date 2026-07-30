// Bug API — CRUD, comments, bulk import.
// Mounted at /api/bugs by server/index.js, gated by requireAuth. Delete
// requires Admin so accidental deletions stay hard.

import express from 'express';
import multer from 'multer';
import {
  listBugs, getBug, upsertBug, deleteBug, addComment, bulkImport, parseCsv,
  SEVERITY, PRIORITY, STATUS, ENVIRONMENT,
} from '../services/bugStore.js';
import { requireRole } from '../services/authService.js';

export const bugsRouter = express.Router();
const json = express.json({ limit: '512kb' });

// A generous limit — 8 MB — to accommodate reasonable CSV / JSON exports
// without letting anyone upload a book. Files land in memory (not on disk)
// because we parse and discard.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

bugsRouter.get('/enums', (_req, res) => {
  res.json({ severity: SEVERITY, priority: PRIORITY, status: STATUS, environment: ENVIRONMENT });
});

bugsRouter.get('/', (req, res) => {
  const { status, severity, assignee, repo, q } = req.query;
  res.json({ bugs: listBugs({ status, severity, assignee, repo, q }) });
});

bugsRouter.get('/:id', (req, res) => {
  const b = getBug(req.params.id);
  if (!b) return res.status(404).json({ error: 'Bug not found' });
  res.json({ bug: b });
});

bugsRouter.post('/', json, (req, res) => {
  try {
    const bug = upsertBug(req.body || {}, req.user);
    res.json({ bug });
  } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});

bugsRouter.patch('/:id', json, (req, res) => {
  try {
    const bug = upsertBug({ ...(req.body || {}), id: req.params.id }, req.user);
    res.json({ bug });
  } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});

bugsRouter.delete('/:id', requireRole('Admin'), (req, res) => {
  const ok = deleteBug(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Bug not found' });
  res.json({ ok: true });
});

bugsRouter.post('/:id/comments', json, (req, res) => {
  const c = addComment(req.params.id, req.body?.body, req.user);
  if (!c) return res.status(404).json({ error: 'Bug not found' });
  res.json({ comment: c });
});

// Bulk import — CSV or JSON. Accepts three body shapes:
//   1. multipart/form-data with a `file` field       (handled by multer)
//   2. application/json with { text | rows }         (handled by json)
//   3. text/csv or text/plain raw body               (handled by rawText)
// Whichever runs first that matches its Content-Type populates req.body /
// req.file; the handler picks whichever landed.
const rawText = express.text({ type: ['text/csv', 'text/plain'], limit: '8mb' });
bugsRouter.post('/import', upload.single('file'), json, rawText, (req, res) => {
  try {
    // Body can arrive three ways: uploaded file, raw text in body.text, or
    // an already-parsed JSON array in body.rows. Each route lands in `rows`.
    let rows = [];
    let source = 'csv';
    if (req.file) {
      const text = req.file.buffer.toString('utf-8');
      if (req.file.mimetype === 'application/json' || /^\s*\[/.test(text)) {
        rows = JSON.parse(text);
        source = 'json';
      } else {
        rows = parseCsv(text);
        source = 'csv';
      }
    } else if (req.body && Array.isArray(req.body.rows)) {
      rows = req.body.rows;
      source = req.body.source || 'json';
    } else if (typeof req.body?.text === 'string') {
      const text = req.body.text;
      if (/^\s*\[/.test(text)) { rows = JSON.parse(text); source = 'json'; }
      else                     { rows = parseCsv(text);   source = 'csv'; }
    } else if (typeof req.body === 'string' && req.body.trim()) {
      // Raw CSV/text body from Content-Type: text/csv or text/plain
      rows = parseCsv(req.body);
      source = 'csv';
    } else {
      return res.status(400).json({ error: 'No import payload — send file, {text}, or {rows}' });
    }
    if (!Array.isArray(rows)) return res.status(400).json({ error: 'Parsed payload is not an array' });
    const report = bulkImport(rows, req.user, { source });
    res.json(report);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
