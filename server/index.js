import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, persistSettings } from './config.js';
import { apiRouter } from './routes/api.js';
import { authRouter, adminRouter } from './routes/auth.js';
import { bugsRouter } from './routes/bugs.js';
import { inviteRouter, adminInviteRouter } from './routes/invites.js';
import { availabilityRouter } from './routes/availability.js';
import { sessionMiddleware, initPassport, requireAuth, requireRole } from './services/authService.js';
import { ensureBootstrapAdmin } from './services/userStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Behind a TLS-terminating reverse proxy (Azure App Service, Heroku, nginx,
// any load balancer) the hop into this process is plain HTTP, so req.secure is
// false and req.protocol reads 'http'. authService.js marks the session cookie
// `secure` in production, and express-session refuses to send a secure cookie
// over what it believes is an insecure connection — logins appear to succeed
// and then no session ever sticks. Trusting the first proxy hop lets Express
// read X-Forwarded-Proto and get this right. No effect on local dev, where
// there is no proxy and no X-Forwarded-* header to trust.
app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
if (config.corsOrigins.length) app.use(cors({ origin: config.corsOrigins, credentials: true }));
app.use(compression());

// Sessions + passport BEFORE any route so req.user is populated everywhere.
// Also persist the auto-generated session secret so restarts don't nuke
// existing sessions.
app.use(sessionMiddleware());
initPassport(app);
if (!config.sessionSecret) {
  // sessionMiddleware() already generated one and stashed it on config —
  // persist it so it survives restarts.
  persistSettings({ sessionSecret: config.sessionSecret });
}

// Auth routes are public (login / OAuth). Admin/team routes are gated
// inside the router itself (requireRole('Admin')). `/api/team` is the
// same router as `/api/admin` — kept because the UI now uses "Team"
// terminology and older bookmarks still work.
app.use('/api/auth', authRouter);
app.use('/api/auth', inviteRouter);        // /api/auth/invite/:token + /accept-invite (public)
app.use('/api/admin', adminRouter);
app.use('/api/admin', adminInviteRouter);  // /api/admin/users/:id/resend-invite + /send-reset
app.use('/api/team', adminRouter);
app.use('/api/team', adminInviteRouter);   // team alias
// Bugs are gated per-route: view for any signed-in user, delete Admin+.
app.use('/api/bugs', requireAuth, bugsRouter);

// Availability: any authenticated user can manage their own records.
// Admin/Super Admin can read all records via GET /api/availability.
app.use('/api/availability', requireAuth, availabilityRouter);

// Everything else under /api requires a signed-in user. A handful of
// endpoints stay public because the login page uses them or they're
// truly no-secret:
//   /api/auth/*   — handled above (public)
//   /api/healthz  — not under /api
// The webhook receiver has its own signature check — bypass session auth
// because GitHub can't carry cookies.
const PUBLIC_API = new Set([
  '/webhooks/github',      // signature-verified separately
]);
app.use('/api', (req, res, next) => {
  if (PUBLIC_API.has(req.path)) return next();
  return requireAuth(req, res, next);
}, apiRouter);

const publicDir = path.join(__dirname, '..', 'public');

// Static files — /admin/login.html and /admin/index.html need to load
// before auth kicks in (obviously). We serve /admin/*.html and /admin/*.js
// and /admin/*.css publicly; the actual data endpoints under /api/admin
// are gated by requireRole('Admin').
app.use('/admin', express.static(path.join(publicDir, 'admin')));

// The `shared/` folder holds ES modules imported by BOTH server and
// client (e.g. permissions.js). Exposing it as a static route lets the
// browser resolve `../../shared/foo.js` from a public/js module without
// duplicating the file.
app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));

// Gate the main dashboard behind auth too — otherwise anyone hitting /
// sees the app before logging in. Unauth requests bounce to the login
// page. Direct file requests for /config.html etc. also bounce.
app.use((req, res, next) => {
  // Allow anonymous access to static assets and to the auth surface.
  const p = req.path;
  if (p.startsWith('/admin/'))                return next();
  if (p.startsWith('/api/'))                  return next(); // handled by their own auth
  if (/\.(css|js|svg|png|jpg|jpeg|ico|woff2?|map)$/.test(p)) return next();
  if (p === '/healthz')                       return next();
  if (!req.user)                              return res.redirect('/admin/login.html');
  next();
});

// Old /admin/index.html got folded into the main app as the "Team" tab.
// Redirect any bookmark to /#team so nobody hits a 404.
app.get(['/admin', '/admin/', '/admin/index.html'], (_req, res) => res.redirect('/#team'));

app.use(express.static(publicDir, { extensions: ['html'] }));

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.listen(config.port, () => {
  console.log(`GitHub Engineering Intelligence listening on http://localhost:${config.port}`);
  if (!config.token) console.log('  → No GitHub token configured yet. Open /config.html after signing in, or run in demo mode: /?demo=1');
  // Bootstrap Super Admin — printed to console on first boot only.
  const boot = ensureBootstrapAdmin();
  if (boot) {
    console.log('');
    console.log('  ┌────────────────────────────────────────────────────────────');
    console.log('  │  BOOTSTRAP SUPER ADMIN — this is the ONE time these are shown');
    console.log(`  │    Email:    ${boot.email}`);
    console.log(`  │    Password: ${boot.password}`);
    console.log('  │  Sign in at /admin/login.html and rotate this password now.');
    console.log('  └────────────────────────────────────────────────────────────');
    console.log('');
  }
});
