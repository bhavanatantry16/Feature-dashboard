// Invite token store — persisted to .invites.json.
// One record per outstanding invite / password-reset. Single-use: consumed
// on successful accept, or auto-swept when expired.
//
// Token shape: 32 bytes of crypto.randomBytes → base64url (43 chars). That's
// 256 bits of entropy; brute-forcing a single valid token would take the
// remaining lifetime of the sun.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', '..', '.invites.json');

const INVITE_TTL_DAYS = 7;
const RESET_TTL_HOURS = 1;

function load() {
  try { if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf-8')); }
  catch (e) { console.error('inviteStore: read failed', e.message); }
  return { invites: [] };
}
function save(data) { fs.writeFileSync(FILE, JSON.stringify(data, null, 2), { mode: 0o600 }); }

/** Generate + persist a fresh token. Returns the raw token (opaque to caller). */
export function createToken({ userId, type, triggeredBy }) {
  if (!userId || !['invitation', 'password_reset'].includes(type)) {
    throw Object.assign(new Error('Bad invite args'), { status: 400 });
  }
  const data = load();
  // Revoke any pending invite of the same type for the same user — one
  // outstanding token per (user, type) so an admin clicking Resend
  // invalidates the old link.
  data.invites = data.invites.filter(i => !(i.userId === userId && i.type === type));

  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  const ttl = type === 'invitation' ? INVITE_TTL_DAYS * 86400_000 : RESET_TTL_HOURS * 3600_000;
  data.invites.push({
    token, userId, type,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttl).toISOString(),
    triggeredBy: triggeredBy || null,
    consumedAt: null,
  });
  save(data);
  return { token, expiresAt: new Date(now + ttl).toISOString() };
}

/**
 * Look up a token WITHOUT consuming it. Returns null if unknown, expired,
 * or already consumed. Use `consumeToken` after the caller has validated
 * business rules (e.g. new password meets complexity).
 */
export function findToken(rawToken) {
  if (!rawToken) return null;
  const data = load();
  const rec = data.invites.find(i => timingSafeEq(i.token, rawToken));
  if (!rec) return null;
  if (rec.consumedAt) return null;
  if (new Date(rec.expiresAt).getTime() < Date.now()) return null;
  return rec;
}

/** Mark a token consumed. Idempotent — a second call returns false. */
export function consumeToken(rawToken) {
  const data = load();
  const rec = data.invites.find(i => timingSafeEq(i.token, rawToken));
  if (!rec || rec.consumedAt) return false;
  if (new Date(rec.expiresAt).getTime() < Date.now()) return false;
  rec.consumedAt = new Date().toISOString();
  save(data);
  return true;
}

/** Housekeeping — call on boot / occasionally to trim old records. */
export function sweepExpired() {
  const data = load();
  const before = data.invites.length;
  const now = Date.now();
  data.invites = data.invites.filter(i => {
    if (i.consumedAt) return false;
    return new Date(i.expiresAt).getTime() > now;
  });
  if (data.invites.length !== before) save(data);
  return before - data.invites.length;
}

// timing-safe equality — avoids leaking token bytes through response-time
// oscillation. Both sides get padded to equal length so compare doesn't
// throw on length mismatch.
function timingSafeEq(a, b) {
  const A = Buffer.from(a || '', 'utf-8');
  const B = Buffer.from(b || '', 'utf-8');
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}
