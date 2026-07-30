// Invite acceptance + admin-triggered resend / password reset.
//   POST  /api/auth/accept-invite           — public, consumes a token, sets password
//   GET   /api/auth/invite/:token           — public, returns basic user info for the set-password page
//   POST  /api/team/users/:id/resend-invite — Admin+, regenerates + resends the invite
//   POST  /api/team/users/:id/send-reset    — Admin+, sends a password reset link
//
// Public token routes deliberately don't leak account existence — both a
// missing token and an expired one produce the same 410 error.

import express from 'express';
import { config } from '../config.js';
import { getUserById, getUserByEmail, upsertUser } from '../services/userStore.js';
import { createToken, findToken, consumeToken } from '../services/inviteStore.js';
import { sendInvitation, sendPasswordReset, isEmailEnabled } from '../services/emailService.js';
import { requireRole } from '../services/authService.js';

export const inviteRouter = express.Router();
const json = express.json({ limit: '32kb' });

function buildSetupUrl(token, type) {
  const base = (config.emailProvider?.appUrl || '').replace(/\/$/, '') || 'http://localhost:8788';
  return `${base}/admin/accept-invite.html?token=${encodeURIComponent(token)}&type=${type}`;
}

// -------------------- Public: view + accept invite --------------------

inviteRouter.get('/invite/:token', (req, res) => {
  const rec = findToken(req.params.token);
  if (!rec) return res.status(410).json({ ok: false, error: 'This link has expired or was already used.' });
  const user = getUserById(rec.userId);
  if (!user) return res.status(410).json({ ok: false, error: 'This link has expired or was already used.' });
  res.json({
    ok: true,
    type: rec.type,
    user: { email: user.email, name: user.name, role: user.role },
    expiresAt: rec.expiresAt,
  });
});

inviteRouter.post('/accept-invite', json, (req, res) => {
  const { token, password } = req.body || {};
  if (!password || String(password).length < 8) {
    return res.status(400).json({ ok: false, error: 'Password must be at least 8 characters.' });
  }
  const rec = findToken(token);
  if (!rec) return res.status(410).json({ ok: false, error: 'This link has expired or was already used.' });
  const user = getUserById(rec.userId);
  if (!user) return res.status(410).json({ ok: false, error: 'This link has expired or was already used.' });
  // Set the password + activate. mustChangePassword goes false — the user
  // just chose their password themselves, no forced-rotation on next login.
  upsertUser({
    id: user.id, email: user.email, role: user.role,
    password, mustChangePassword: false,
    disabled: false,
  });
  consumeToken(token);
  res.json({ ok: true });
});

// -------------------- Admin: resend invite / send reset --------------------

export const adminInviteRouter = express.Router();
adminInviteRouter.use(requireRole('Admin'));

adminInviteRouter.post('/users/:id/resend-invite', json, async (req, res) => {
  const user = getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!isEmailEnabled()) {
    return res.status(400).json({ error: 'Email delivery is not enabled. Configure it in Settings → Email.' });
  }
  const { token, expiresAt } = createToken({
    userId: user.id, type: 'invitation', triggeredBy: req.user?.email,
  });
  const result = await sendInvitation({
    to: user.email, userName: user.name || user.email,
    role: user.role, department: user.department,
    setupUrl: buildSetupUrl(token, 'invitation'),
    expiresAt, triggeredBy: req.user?.email,
  });
  if (!result.ok) return res.status(502).json({ error: 'Email send failed: ' + result.error });
  res.json({ ok: true });
});

adminInviteRouter.post('/users/:id/send-reset', json, async (req, res) => {
  const user = getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!isEmailEnabled()) {
    return res.status(400).json({ error: 'Email delivery is not enabled. Configure it in Settings → Email.' });
  }
  const { token, expiresAt } = createToken({
    userId: user.id, type: 'password_reset', triggeredBy: req.user?.email,
  });
  const result = await sendPasswordReset({
    to: user.email, userName: user.name || user.email,
    setupUrl: buildSetupUrl(token, 'password_reset'),
    expiresAt, triggeredBy: req.user?.email,
  });
  if (!result.ok) return res.status(502).json({ error: 'Email send failed: ' + result.error });
  res.json({ ok: true });
});

// -------------------- Helper used by team.js on user creation --------------------

/**
 * When the Add-User flow finishes and email is enabled + the admin picked
 * "Send invite email", the team route calls this to fire the invite. Kept
 * here (not in the team route file) so all invite logic lives together.
 */
export async function sendInviteForNewUser({ userId, triggeredBy }) {
  const user = getUserById(userId);
  if (!user || !isEmailEnabled()) return { ok: false, error: 'not-enabled' };
  const { token, expiresAt } = createToken({ userId, type: 'invitation', triggeredBy });
  return sendInvitation({
    to: user.email, userName: user.name || user.email,
    role: user.role, department: user.department,
    setupUrl: buildSetupUrl(token, 'invitation'),
    expiresAt, triggeredBy,
  });
}
