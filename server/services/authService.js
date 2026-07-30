// Auth wiring — sessions, Passport strategies, RBAC middleware.
//
// Modular by design: adding Google / Microsoft / Okta / SAML later means
// dropping in another passport strategy and calling passport.use(...) in
// registerStrategies(). The session shape (req.user = sanitized store user)
// stays the same, so routes never care which provider signed the user in.

import session from 'express-session';
import passport from 'passport';
import { Strategy as GitHubStrategy } from 'passport-github2';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { authenticateLocal, getUserById, upsertGithubUser, ROLE_RANK } from './userStore.js';

// Session secret: honour env if given, otherwise persist a random one to
// config.js's .settings.json path so restarts don't log everyone out.
function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (config.sessionSecret) return config.sessionSecret;
  const s = crypto.randomBytes(48).toString('base64url');
  config.sessionSecret = s;
  return s;
}

export function sessionMiddleware() {
  return session({
    name: 'gei.sid',
    secret: sessionSecret(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      // In prod (behind HTTPS) mark secure. In local dev leave it off so the
      // cookie is actually set on http://localhost.
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24 * 7,      // 1 week
    },
  });
}

export function initPassport(app) {
  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser((id, done) => {
    const u = getUserById(id);
    done(null, u || false);
  });
  app.use(passport.initialize());
  app.use(passport.session());
  registerStrategies();
}

function registerStrategies() {
  // GitHub OAuth is only wired when creds are configured — otherwise the
  // /api/auth/github route responds 400 with a clear message instead of
  // hanging. This lets the app boot with local login only, and light up
  // OAuth the moment credentials are dropped in via Settings.
  const gh = config.githubOAuth || {};
  if (gh.clientId && gh.clientSecret) {
    passport.use(new GitHubStrategy(
      {
        clientID: gh.clientId,
        clientSecret: gh.clientSecret,
        callbackURL: gh.callbackUrl || '/api/auth/github/callback',
        scope: ['read:user', 'user:email'],
      },
      (accessToken, refreshToken, profile, done) => {
        const email = (profile.emails || []).find(e => e.value)?.value || null;
        const user = upsertGithubUser({
          id: profile.id, login: profile.username,
          name: profile.displayName || profile.username, email,
        });
        if (!user) return done(null, false, { message: 'Account disabled' });
        done(null, user);
      },
    ));
  }
}

// Called by /api/config POST when the admin saves GitHub OAuth creds — lets
// the strategy re-register without a server restart.
export function reregisterStrategies() {
  // Unregister any existing strategy first so re-saving new creds actually
  // takes effect (passport-github2 is keyed 'github').
  try { passport.unuse('github'); } catch {}
  registerStrategies();
}

/** POST /api/auth/login handler (local email+password). */
export function localLogin(req, res) {
  const { email, password } = req.body || {};
  const user = authenticateLocal(email, password);
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });
  req.login(user, err => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true, user });
  });
}

export function logout(req, res) {
  req.logout(err => {
    if (err) return res.status(500).json({ error: err.message });
    req.session?.destroy(() => res.json({ ok: true }));
  });
}

// -------------------- RBAC middleware --------------------

/** Require any authenticated user. */
export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in', code: 'AUTH_REQUIRED' });
  if (req.user.disabled) return res.status(403).json({ error: 'Account disabled', code: 'DISABLED' });
  next();
}

/** Require the caller to have at least the given role's rank. */
export function requireRole(minRole) {
  const minRank = ROLE_RANK[minRole] ?? 999;
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not signed in', code: 'AUTH_REQUIRED' });
    const rank = ROLE_RANK[req.user.role] ?? 0;
    if (rank < minRank) return res.status(403).json({ error: `Requires ${minRole} or higher`, code: 'FORBIDDEN' });
    next();
  };
}
