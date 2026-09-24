// Availability routes — employee availability CRUD.
//
// Identity is ALWAYS derived from req.user (set by Passport / express-session).
// The request body never carries a userId — this prevents any user from
// creating or modifying records that belong to someone else.
//
// Storage: flat JSON file at <repo-root>/.availability.json, following the
// same approach used by userStore.js (.users.json) and bugs.js (.bugs.json).
//
// Mounts at: /api/availability  (see server/index.js)
// Auth gate:  requireAuth applied by the parent mount in server/index.js

import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ROLE_RANK } from '../services/userStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// DATA_DIR follows the same env-override pattern as userStore.js so that
// tests / containerised deployments can redirect flat-file state to a
// scratch folder without touching production data.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..');
const FILE = path.join(DATA_DIR, '.availability.json');

// Only these two values are accepted — "not available" is explicitly excluded.
const VALID_STATUSES = new Set(['available', 'leave']);

// ── Flat-file helpers ──────────────────────────────────────────────────────

function loadRecords() {
  try {
    if (fs.existsSync(FILE)) {
      const raw = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
      return Array.isArray(raw) ? raw : [];
    }
  } catch (e) {
    console.error('availabilityStore: failed to read', FILE, e.message);
  }
  return [];
}

function saveRecords(records) {
  fs.writeFileSync(FILE, JSON.stringify(records, null, 2), { mode: 0o600 });
}

// ── Router ─────────────────────────────────────────────────────────────────

export const availabilityRouter = express.Router();
const json = express.json({ limit: '32kb' });

// Convenience: is the caller an Admin or Super Admin?
function isAdmin(user) {
  return (ROLE_RANK[user?.role] ?? 0) >= ROLE_RANK['Admin'];
}

// Validate a date string is exactly YYYY-MM-DD and represents a real date.
function isValidDate(str) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const d = new Date(str + 'T00:00:00');
  return !isNaN(d.getTime());
}

// ── GET /api/availability ──────────────────────────────────────────────────
//
// Employees: returns only their own records.
// Admin / Super Admin: returns ALL records (so the Admin Calendar can
// aggregate availability across the whole team).
//
// Optional query params:
//   ?userId=<id>   (Admin only) — filter to a specific employee
//   ?date=YYYY-MM-DD            — filter to a specific date (any role)

availabilityRouter.get('/', (req, res) => {
  const records = loadRecords();
  const caller = req.user;

  let result;
  if (isAdmin(caller)) {
    // Admins see everything; honour optional ?userId filter.
    const { userId, date } = req.query;
    result = records.filter(r => {
      if (userId && r.userId !== userId) return false;
      if (date && r.date !== date) return false;
      return true;
    });
  } else {
    // Non-admins (including employees) see only their own records.
    const { date } = req.query;
    result = records.filter(r => {
      if (r.userId !== caller.id) return false;
      if (date && r.date !== date) return false;
      return true;
    });
  }

  res.json({ records: result });
});

// ── POST /api/availability ─────────────────────────────────────────────────
//
// Creates or updates (upserts) the authenticated user's availability for
// a given date.  userId is ALWAYS taken from req.user.id — never from body.
//
// Body: { date: 'YYYY-MM-DD', status: 'available' | 'leave' }

availabilityRouter.post('/', json, (req, res) => {
  const { date, status } = req.body || {};
  const caller = req.user;

  // -- Validation --
  if (!date || !isValidDate(date)) {
    return res.status(400).json({ error: 'date is required and must be YYYY-MM-DD' });
  }
  if (!status || !VALID_STATUSES.has(status)) {
    return res.status(400).json({ error: 'status must be "available" or "leave"' });
  }

  const records = loadRecords();
  const now = new Date().toISOString();

  // Upsert: find an existing record for this user + date combination.
  const idx = records.findIndex(r => r.userId === caller.id && r.date === date);

  let record;
  if (idx >= 0) {
    // Update in place — preserve id and createdAt.
    record = { ...records[idx], status, updatedAt: now };
    records[idx] = record;
  } else {
    // New record.
    record = {
      id: crypto.randomUUID(),
      userId: caller.id,
      employeeName: caller.name || caller.email,  // denormalised for easy calendar display
      date,
      status,
      createdAt: now,
      updatedAt: now,
    };
    records.push(record);
  }

  saveRecords(records);
  res.json({ ok: true, record });
});

// ── DELETE /api/availability/:date ────────────────────────────────────────
//
// Removes the authenticated user's availability record for the given date.
// Employees can only delete their own records.
// Admins can delete any record (useful for moderation), but must pass
// ?userId=<id> to target a specific employee (defaults to their own).

availabilityRouter.delete('/:date', (req, res) => {
  const dateParam = req.params.date;
  const caller = req.user;

  if (!isValidDate(dateParam)) {
    return res.status(400).json({ error: 'date parameter must be YYYY-MM-DD' });
  }

  const records = loadRecords();

  // Determine whose record to delete.
  let targetUserId = caller.id;
  if (isAdmin(caller) && req.query.userId) {
    targetUserId = req.query.userId;
  }

  const idx = records.findIndex(r => r.userId === targetUserId && r.date === dateParam);
  if (idx < 0) {
    return res.status(404).json({ error: 'No availability record found for that date' });
  }

  const [deleted] = records.splice(idx, 1);
  saveRecords(records);
  res.json({ ok: true, deleted });
});

// ── POST /api/availability/admin ───────────────────────────────────────────
//
// Admin-only endpoint: set availability for ANY employee by userId.
// Accepts a single date or a leave date range (leaveStart + leaveEnd).
// Used by the Team drawer (both the inline availability section inside
// Add/Edit User and the standalone "Availability" button per row).
//
// Body: {
//   userId:      string  (required)
//   status:      'available' | 'leave'  (required)
//   date?:       'YYYY-MM-DD'           (for non-leave; defaults to today)
//   leaveStart?: 'YYYY-MM-DD'           (for leave ranges)
//   leaveEnd?:   'YYYY-MM-DD'           (for leave ranges)
// }

availabilityRouter.post('/admin', json, (req, res) => {
  const caller = req.user;
  if (!isAdmin(caller)) {
    return res.status(403).json({ error: 'Admin or Super Admin required' });
  }

  const { userId, status, date, leaveStart, leaveEnd } = req.body || {};

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }
  if (!status || !VALID_STATUSES.has(status)) {
    return res.status(400).json({ error: 'status must be "available" or "leave"' });
  }

  // Build the list of dates to upsert.
  const datesToSet = [];
  if (status === 'leave' && leaveStart && leaveEnd) {
    if (!isValidDate(leaveStart) || !isValidDate(leaveEnd)) {
      return res.status(400).json({ error: 'leaveStart and leaveEnd must be YYYY-MM-DD' });
    }
    let cur = new Date(leaveStart + 'T00:00:00');
    const end = new Date(leaveEnd + 'T00:00:00');
    if (cur > end) {
      return res.status(400).json({ error: 'leaveStart must be on or before leaveEnd' });
    }
    while (cur <= end) {
      datesToSet.push(cur.toISOString().slice(0, 10));
      cur.setDate(cur.getDate() + 1);
    }
  } else {
    const targetDate = date || new Date().toISOString().slice(0, 10);
    if (!isValidDate(targetDate)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }
    datesToSet.push(targetDate);
  }

  const records = loadRecords();
  const now = new Date().toISOString();
  const upserted = [];

  for (const d of datesToSet) {
    const idx = records.findIndex(r => r.userId === userId && r.date === d);
    if (idx >= 0) {
      // Update existing record in place.
      records[idx] = {
        ...records[idx],
        status,
        leaveStart: status === 'leave' && leaveStart ? leaveStart : undefined,
        leaveEnd:   status === 'leave' && leaveEnd   ? leaveEnd   : undefined,
        updatedAt: now,
      };
      upserted.push(records[idx]);
    } else {
      // New record — denormalise the employee name from userId if possible.
      const rec = {
        id:           crypto.randomUUID(),
        userId,
        date:         d,
        status,
        leaveStart:   status === 'leave' && leaveStart ? leaveStart : undefined,
        leaveEnd:     status === 'leave' && leaveEnd   ? leaveEnd   : undefined,
        createdAt:    now,
        updatedAt:    now,
      };
      records.push(rec);
      upserted.push(rec);
    }
  }

  saveRecords(records);
  res.json({ ok: true, records: upserted });
});
