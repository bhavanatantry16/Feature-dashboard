// Roadmap store + CSV/JSON parser.
// Persisted to .roadmap.json alongside .settings.json (git-ignored).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', '..', '.roadmap.json');

function load() {
  try { if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf-8')); } catch {}
  return { items: [] };
}
function save(data) { fs.writeFileSync(FILE, JSON.stringify(data, null, 2)); }

export function getRoadmap() { return load(); }

export function setRoadmap(items) {
  const clean = (items || []).map(normaliseItem).filter(Boolean);
  save({ items: clean, updatedAt: new Date().toISOString() });
  return { items: clean };
}

function normaliseItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name || raw.feature || raw.title || '').trim();
  if (!name) return null;
  const status = String(raw.status || raw.stage || 'Not Started').trim();
  return {
    id: raw.id || slug(name),
    name,
    description: raw.description || raw.desc || '',
    quarter: normaliseQuarter(raw.quarter || raw.q || raw.timeline || ''),
    status: normaliseStatus(status),
    owner: raw.owner || raw.assignee || '',
    linkedRepo: raw.repo || raw.repository || '',
    startDate: raw.startDate || raw.start || '',
    endDate: raw.endDate || raw.end || raw.dueDate || raw.due || '',
  };
}
function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function normaliseQuarter(q) {
  const s = String(q).trim();
  const m = s.match(/q\s*([1-4])/i);
  if (m) return 'Q' + m[1];
  const d = new Date(s);
  if (!isNaN(d)) return 'Q' + (Math.floor(d.getMonth() / 3) + 1);
  return s ? s.toUpperCase() : 'Q1';
}
function normaliseStatus(s) {
  const l = s.toLowerCase();
  if (['live','production','prod','shipped','done','released'].some(k => l.includes(k))) return 'Production';
  if (['test','qa','uat','staging'].some(k => l.includes(k))) return 'Testing';
  if (['dev','in progress','wip','building'].some(k => l.includes(k))) return 'Development';
  if (['block'].some(k => l.includes(k))) return 'Blocked';
  if (['wait','review'].some(k => l.includes(k))) return 'Waiting';
  return 'Not Started';
}

// --- CSV parser (RFC-ish, handles quoted commas and escaped quotes) ---
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
  const headers = rows[0].map(h => h.trim().toLowerCase());
  return rows.slice(1).filter(r => r.some(v => v.trim())).map(r =>
    Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()]))
  );
}

// Merge live GitHub feature state into stored roadmap items so the visualisation stays fresh.
export function decorateWithLiveStatus(items, features) {
  const lookup = new Map();
  for (const f of features || []) {
    const key = normalize(f.title);
    if (!lookup.has(key)) lookup.set(key, f);
  }
  return items.map(item => {
    const match = lookup.get(normalize(item.name));
    if (match) {
      return { ...item, liveStatus: mapStageToStatus(match.stage), matched: true, featureKey: match.key };
    }
    return { ...item, matched: false };
  });
}
function normalize(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
function mapStageToStatus(stage) {
  return ({ 'Backlog': 'Not Started', 'Development': 'Development', 'Code Review': 'Development',
           'Testing': 'Testing', 'UAT': 'Testing', 'Production': 'Production' })[stage] || 'Not Started';
}
