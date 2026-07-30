// Auth + Admin routes.
//   /api/auth/*    — everyone (login, logout, me, change-password, OAuth flow)
//   /api/admin/*   — Admin+ only (user CRUD)

import express from 'express';
import passport from 'passport';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import {
  ROLES, listUsers, getUserById, getUserByEmail, upsertUser, deleteUser,
} from '../services/userStore.js';
import { localLogin, logout, requireAuth, requireRole } from '../services/authService.js';

export const authRouter = express.Router();
const json = express.json({ limit: '128kb' });

// -------------------- Public auth --------------------

authRouter.post('/login', json, localLogin);
authRouter.post('/logout', logout);

authRouter.get('/me', (req, res) => {
  if (!req.user) return res.json({ authenticated: false });
  res.json({
    authenticated: true,
    user: req.user,
    githubOAuthEnabled: Boolean(config.githubOAuth?.clientId && config.githubOAuth?.clientSecret),
  });
});

// -------------------- GitHub OAuth --------------------

authRouter.get('/github', (req, res, next) => {
  const gh = config.githubOAuth || {};
  if (!gh.clientId || !gh.clientSecret) {
    return res.status(400).send('GitHub OAuth not configured. An admin must add a Client ID and Secret in Settings.');
  }
  passport.authenticate('github', { scope: ['read:user', 'user:email'] })(req, res, next);
});

authRouter.get('/github/callback', (req, res, next) => {
  passport.authenticate('github', {
    failureRedirect: '/admin/login.html?error=oauth',
    successRedirect: '/',
  })(req, res, next);
});

// -------------------- Change password (self) --------------------

authRouter.post('/change-password', requireAuth, json, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  const raw = getUserByEmail(req.user.email);
  if (!raw) return res.status(404).json({ error: 'User not found' });
  // If the account already has a password, the current one must match.
  // Accounts created via GitHub OAuth without a password can set one here
  // for the first time (they'll be prompted after linking).
  if (raw.passwordHash) {
    if (!currentPassword || !bcrypt.compareSync(String(currentPassword), raw.passwordHash)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
  }
  upsertUser({ id: raw.id, email: raw.email, role: raw.role, password: newPassword, mustChangePassword: false });
  res.json({ ok: true });
});

// -------------------- Admin: user CRUD --------------------

export const adminRouter = express.Router();

adminRouter.use(requireRole('Admin'));

adminRouter.get('/users', (_req, res) => res.json({ users: listUsers(), roles: ROLES }));

adminRouter.post('/users', json, (req, res) => {
  try {
    const u = upsertUser({ ...req.body, mustChangePassword: Boolean(req.body?.password) });
    res.json({ user: u });
  } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});

adminRouter.patch('/users/:id', json, (req, res) => {
  // Guard: only Super Admin can grant / revoke Super Admin. This stops a
  // regular Admin from privileging themselves upward.
  if (req.body?.role === 'Super Admin' && req.user.role !== 'Super Admin') {
    return res.status(403).json({ error: 'Only Super Admin can assign Super Admin' });
  }
  const existing = getUserById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'User not found' });
  if (existing.role === 'Super Admin' && req.user.role !== 'Super Admin') {
    return res.status(403).json({ error: 'Only Super Admin can modify Super Admin accounts' });
  }
  try {
    const u = upsertUser({ ...req.body, id: req.params.id });
    res.json({ user: u });
  } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});

adminRouter.post('/users/:id/reset-password', json, (req, res) => {
  const target = getUserById(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  const password = req.body?.password || Math.random().toString(36).slice(-12);
  upsertUser({ id: target.id, email: target.email, role: target.role, password, mustChangePassword: true });
  // Return the temp password so the admin can hand it to the user out of
  // band (email/chat). Once a mailer is configured this will send instead.
  res.json({ ok: true, temporaryPassword: password });
});

adminRouter.delete('/users/:id', (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: "You can't delete your own account" });
  }
  const target = getUserById(req.params.id);
  if (target?.role === 'Super Admin' && req.user.role !== 'Super Admin') {
    return res.status(403).json({ error: 'Only Super Admin can delete Super Admin accounts' });
  }
  deleteUser(req.params.id);
  res.json({ ok: true });
});
