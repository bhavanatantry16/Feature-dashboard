// Bug store — persisted to .bugs.json alongside the other side-tables.
// Separate from the read-only GitHub-sourced issues list surfaced on the
// board: users can add / import / edit bugs here that don't map to a GitHub
// issue (customer-reported, incident post-mortems, hotfix tracking, imports
// from Jira / Azure DevOps / Linear).
//
// Deliberately flat file — same pattern as .roadmap.json and .users.json.
// Once the volume warrants it, swap this out for a real DB without changing
// the route surface.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..');
const FILE = path.join(DATA_DIR, '.bugs.json');

export const SEVERITY = ['Critical', 'High', 'Medium', 'Low'];
export const PRIORITY = ['P0', 'P1', 'P2', 'P3'];
export const STATUS   = ['Open', 'Triage', 'In Progress', 'In Review', 'Verified', 'Closed', "Won't Fix"];
export const ENVIRONMENT = ['Production', 'Staging', 'UAT', 'Testing', 'Development'];

function load() {
  try {
    if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
  } catch (e) {
    console.error('bugStore: failed to read', FILE, e.message);
  }
  return { bugs: [], counter: 100 };
}
function save(data) { fs.writeFileSync(FILE, JSON.stringify(data, null, 2), { mode: 0o600 }); }

export function listBugs({ status, severity, assignee, repo, q } = {}) {
  const all = load().bugs;
  return all.filter(b => {
    if (status && b.status !== status) return false;
    if (severity && b.severity !== severity) return false;
    if (assignee && b.assignee !== assignee) return false;
    if (repo && b.repo !== repo) return false;
    if (q) {
      const needle = String(q).toLowerCase();
      const hay = `${b.title} ${b.description || ''} ${b.bugId}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

export function getBug(id) {
  return load().bugs.find(b => b.id === id || b.bugId === id) || null;
}

/** Normalise + persist one bug. Auto-assigns BUG-<N> if bugId is missing. */
export function upsertBug(input, actor) {
  const data = load();
  const now = new Date().toISOString();
  const title = String(input?.title || '').trim();
  if (!title) throw Object.assign(new Error('title is required'), { status: 400 });

  const idx = input.id ? data.bugs.findIndex(b => b.id === input.id) : -1;
  const existing = idx >= 0 ? data.bugs[idx] : null;

  // Only the client-provided bugId beats an auto-generated one. Keep the
  // existing bugId on updates so URLs / references don't shift.
  const bugId = existing?.bugId
    || (input.bugId ? String(input.bugId) : `BUG-${data.counter}`);
  if (!existing && !input.bugId) data.counter += 1;

  const next = {
    id: existing?.id || crypto.randomUUID(),
    bugId,
    title,
    description:       input.description || '',
    severity:          SEVERITY.includes(input.severity) ? input.severity : (existing?.severity || 'Medium'),
    priority:          PRIORITY.includes(input.priority) ? input.priority : (existing?.priority || 'P2'),
    status:            STATUS.includes(input.status) ? input.status : (existing?.status || 'Open'),
    environment:       ENVIRONMENT.includes(input.environment) ? input.environment : (existing?.environment || 'Production'),
    reporter:          input.reporter ?? existing?.reporter ?? actor?.email ?? '',
    assignee:          input.assignee ?? existing?.assignee ?? '',
    repo:              input.repo ?? existing?.repo ?? '',
    linkedFeature:     input.linkedFeature ?? existing?.linkedFeature ?? '',
    linkedFeatureKey:  input.linkedFeatureKey ?? existing?.linkedFeatureKey ?? '',
    stepsToReproduce:  input.stepsToReproduce ?? existing?.stepsToReproduce ?? '',
    expectedResult:    input.expectedResult ?? existing?.expectedResult ?? '',
    actualResult:      input.actualResult ?? existing?.actualResult ?? '',
    githubIssueUrl:    input.githubIssueUrl ?? existing?.githubIssueUrl ?? '',
    prFixUrl:          input.prFixUrl ?? existing?.prFixUrl ?? '',
    attachments:       Array.isArray(input.attachments) ? input.attachments : (existing?.attachments || []),
    comments:          existing?.comments || [],
    statusHistory:     existing?.statusHistory || [],
    source:            input.source ?? existing?.source ?? 'manual',   // manual | csv | github | jira | azure | linear
    createdAt:         existing?.createdAt || now,
    createdBy:         existing?.createdBy || actor?.email || 'system',
    updatedAt:         now,
  };

  // Record status transitions so the drawer can render a history timeline.
  if (existing && existing.status !== next.status) {
    next.statusHistory = [...(existing.statusHistory || []),
      { from: existing.status, to: next.status, at: now, by: actor?.email || 'system' }];
  }

  if (idx >= 0) data.bugs[idx] = next; else data.bugs.push(next);
  save(data);
  return next;
}

export function deleteBug(id) {
  const data = load();
  const before = data.bugs.length;
  data.bugs = data.bugs.filter(b => b.id !== id);
  if (data.bugs.length !== before) save(data);
  return before !== data.bugs.length;
}

export function addComment(id, body, actor) {
  const data = load();
  const bug = data.bugs.find(b => b.id === id);
  if (!bug) return null;
  const comment = {
    id: crypto.randomUUID(),
    body: String(body || '').slice(0, 4000),
    author: actor?.email || 'system',
    at: new Date().toISOString(),
  };
  bug.comments = [...(bug.comments || []), comment];
  bug.updatedAt = comment.at;
  save(data);
  return comment;
}

/**
 * Bulk import — accepts an array of raw rows already parsed from CSV/JSON.
 * Duplicate detection: two bugs are considered duplicates if they share
 * (title, repo) or (bugId if provided). Duplicates are counted but skipped.
 * Returns { imported, skipped, errors: [{row, message}] } so the UI can
 * show a real report instead of a silent success.
 */
export function bulkImport(rows, actor, { source = 'csv' } = {}) {
  const data = load();
  const existingTitles = new Set(data.bugs.map(b => `${b.title.toLowerCase()}|${(b.repo || '').toLowerCase()}`));
  const existingIds = new Set(data.bugs.map(b => b.bugId));
  const result = { imported: 0, skipped: 0, errors: [] };
  const now = new Date().toISOString();

  for (const [i, row] of rows.entries()) {
    try {
      const title = String(row.title || row.summary || row.name || '').trim();
      if (!title) { result.errors.push({ row: i + 1, message: 'missing title' }); continue; }
      const key = `${title.toLowerCase()}|${String(row.repo || row.repository || '').toLowerCase()}`;
      if (existingTitles.has(key) || (row.bugId && existingIds.has(row.bugId))) {
        result.skipped += 1;
        continue;
      }
      const bugId = row.bugId ? String(row.bugId) : `BUG-${data.counter++}`;
      const bug = {
        id: crypto.randomUUID(),
        bugId,
        title,
        description:      String(row.description || row.body || ''),
        severity:         SEVERITY.includes(row.severity) ? row.severity : 'Medium',
        priority:         PRIORITY.includes(row.priority) ? row.priority : 'P2',
        status:           STATUS.includes(row.status) ? row.status : 'Open',
        environment:      ENVIRONMENT.includes(row.environment) ? row.environment : 'Production',
        reporter:         String(row.reporter || row.reported_by || ''),
        assignee:         String(row.assignee || row.assigned_to || ''),
        repo:             String(row.repo || row.repository || ''),
        linkedFeature:    String(row.linkedFeature || row.feature || ''),
        linkedFeatureKey: '',
        stepsToReproduce: String(row.stepsToReproduce || row.steps || ''),
        expectedResult:   String(row.expectedResult || row.expected || ''),
        actualResult:     String(row.actualResult || row.actual || ''),
        githubIssueUrl:   String(row.githubIssueUrl || row.githubUrl || row.url || ''),
        prFixUrl:         '',
        attachments:      [],
        comments:         [],
        statusHistory:    [],
        source,
        createdAt:        row.createdAt || now,
        createdBy:        actor?.email || 'import',
        updatedAt:        now,
      };
      data.bugs.push(bug);
      existingTitles.add(key);
      existingIds.add(bugId);
      result.imported += 1;
    } catch (e) {
      result.errors.push({ row: i + 1, message: e.message });
    }
  }
  save(data);
  return result;
}

// --- CSV parser (RFC-ish, handles quoted commas + escaped quotes). ---
// Same shape as roadmapService.parseCsv but kept local so bug import can
// change independently. Returns Array<Object> keyed by lowercased headers.
export function parseCsv(text) {
  const rows = [];
  let field = '', row = [], inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (inQuote) {
      if (c === '"' && next === '"') { field += '"'; i++; continue; }
      if (c === '"') { inQuote = false; continue; }
      field += c;
    } else {
      if (c === '"') { inQuote = true; continue; }
      if (c === ',') { row.push(field); field = ''; continue; }
      if (c === '\n' || c === '\r') {
        if (c === '\r' && next === '\n') i++;
        row.push(field); field = '';
        rows.push(row); row = [];
        continue;
      }
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0].map(h => h.trim().toLowerCase().replace(/\s+/g, ''));
  return rows.slice(1).filter(r => r.some(v => (v || '').trim())).map(r =>
    Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])),
  );
}
