// User store — persisted to .users.json alongside the other settings files.
// A single record represents one human, regardless of how they log in:
//
//   {
//     id,
//     email,
//     name,
//     role,                 // one of ROLES below
//     department?,
//     passwordHash?,        // set when local login is enabled for this account
//     githubLogin?,         // set when this account has linked GitHub OAuth
//     githubId?,            // numeric GitHub user id (stable across renames)
//     disabled: bool,
//     mustChangePassword: bool,   // true for bootstrap admin + password resets
//     createdAt, updatedAt, lastLoginAt,
//     repositories: string[],     // repo full_names this user has access to
//     teams: string[],
//   }
//
// The same record can carry BOTH `passwordHash` and `githubLogin` — that's the
// account-linking case (an admin who uses password today, then attaches
// GitHub OAuth later so their commits show up in the drawer).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// DATA_DIR lets tests (and containerised deployments) redirect flat-file
// state to a scratch folder. Default is the repo root — production
// behaviour unchanged.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..');
const FILE = path.join(DATA_DIR, '.users.json');
const BCRYPT_COST = 12;

export const ROLES = [
  'Super Admin',
  'Admin',
  'Engineering Manager',
  'Developer',
  'QA',
  'Product Manager',
  'Viewer',
];

// Role hierarchy for permission checks. A higher number = more privileged.
// requireRole('Admin') will accept Super Admin AND Admin, and reject the rest.
export const ROLE_RANK = {
  'Super Admin': 100,
  'Admin': 80,
  'Engineering Manager': 60,
  'Product Manager': 60,
  'Developer': 40,
  'QA': 40,
  'Viewer': 20,
};

function load() {
  try {
    if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
  } catch (e) {
    console.error('userStore: failed to read', FILE, e.message);
  }
  return { users: [] };
}
function save(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export function listUsers() {
  return load().users.map(sanitize);
}
export function getUserById(id) {
  const u = load().users.find(u => u.id === id);
  return u ? sanitize(u) : null;
}
export function getUserByEmail(email) {
  if (!email) return null;
  return load().users.find(u => u.email?.toLowerCase() === String(email).toLowerCase()) || null;
}
export function getUserByGithub({ login, id }) {
  const users = load().users;
  if (id) {
    const byId = users.find(u => u.githubId && String(u.githubId) === String(id));
    if (byId) return byId;
  }
  if (login) {
    return users.find(u => u.githubLogin?.toLowerCase() === String(login).toLowerCase()) || null;
  }
  return null;
}

// Never return the password hash to callers — they only need to know the
// hash exists via `hasPassword`. `authenticateLocal` uses the raw record
// internally.
function sanitize(u) {
  if (!u) return null;
  const { passwordHash, ...rest } = u;
  return { ...rest, hasPassword: Boolean(passwordHash) };
}

/** Add or update a user. Auto-hashes `password` if supplied. */
export function upsertUser(input) {
  const data = load();
  const now = new Date().toISOString();
  const email = String(input.email || '').trim().toLowerCase();
  if (!email) throw Object.assign(new Error('email is required'), { status: 400 });
  const role = ROLES.includes(input.role) ? input.role : 'Viewer';

  let user = input.id
    ? data.users.find(u => u.id === input.id)
    : data.users.find(u => u.email?.toLowerCase() === email);

  const passwordHash = input.password
    ? bcrypt.hashSync(String(input.password), BCRYPT_COST)
    : undefined;

  if (user) {
    user.email = email;
    if (input.name !== undefined)          user.name = input.name;
    if (input.role !== undefined)          user.role = role;
    if (input.department !== undefined)    user.department = input.department;
    if (input.githubLogin !== undefined)   user.githubLogin = input.githubLogin || null;
    if (input.githubId !== undefined)      user.githubId = input.githubId || null;
    if (input.disabled !== undefined)      user.disabled = Boolean(input.disabled);
    if (input.repositories !== undefined)  user.repositories = Array.isArray(input.repositories) ? input.repositories : [];
    if (input.teams !== undefined)         user.teams = Array.isArray(input.teams) ? input.teams : [];
    if (input.permissions !== undefined)   user.permissions = Array.isArray(input.permissions) ? input.permissions : null;
    if (input.notifications !== undefined) user.notifications = { ...(user.notifications || {}), ...input.notifications };
    if (input.avatarUrl !== undefined)     user.avatarUrl = input.avatarUrl || null;
    if (passwordHash) {
      user.passwordHash = passwordHash;
      user.mustChangePassword = Boolean(input.mustChangePassword);
    }
    user.updatedAt = now;
  } else {
    user = {
      id:               input.id || crypto.randomUUID(),
      email,
      name:             input.name || email,
      role,
      department:       input.department || '',
      passwordHash,
      githubLogin:      input.githubLogin || null,
      githubId:         input.githubId || null,
      disabled:         Boolean(input.disabled),
      mustChangePassword: Boolean(input.mustChangePassword),
      createdAt:        now,
      updatedAt:        now,
      lastLoginAt:      null,
      repositories:     Array.isArray(input.repositories) ? input.repositories : [],
      teams:            Array.isArray(input.teams) ? input.teams : [],
      // permissions: null = "inherit from role template" (default). An array
      // means the admin has overridden the template for this user. This
      // shape lets us tell the two states apart in the UI ("inheriting
      // Developer defaults" vs "customised").
      permissions:      Array.isArray(input.permissions) ? input.permissions : null,
      notifications:    input.notifications || { email: true, slack: false, teams: false, weeklyReport: true, releaseNotification: true },
      avatarUrl:        input.avatarUrl || null,
    };
    data.users.push(user);
  }
  save(data);
  return sanitize(user);
}

export function deleteUser(id) {
  const data = load();
  const before = data.users.length;
  data.users = data.users.filter(u => u.id !== id);
  if (data.users.length !== before) save(data);
  return before !== data.users.length;
}

export function setDisabled(id, disabled) {
  return upsertUser({ id, ...getRawById(id), disabled });
}

/** Verify email + password. Returns sanitized user on success, null on any failure. */
export function authenticateLocal(email, password) {
  const raw = getUserByEmail(email);
  if (!raw || raw.disabled || !raw.passwordHash) return null;
  const ok = bcrypt.compareSync(String(password || ''), raw.passwordHash);
  if (!ok) return null;
  touchLoginTs(raw.id);
  return sanitize(raw);
}

function touchLoginTs(id) {
  const data = load();
  const u = data.users.find(u => u.id === id);
  if (u) { u.lastLoginAt = new Date().toISOString(); save(data); }
}

/** Called by the OAuth callback to create-or-update a user from a GitHub profile. */
export function upsertGithubUser({ id, login, name, email }) {
  const existing = getUserByGithub({ id, login });
  if (existing) {
    if (existing.disabled) return null;
    return upsertUser({
      id: existing.id,
      email: existing.email,
      name: existing.name || name || login,
      role: existing.role,
      githubLogin: login,
      githubId: id,
    });
  }
  // New sign-up via GitHub — first user ever becomes Super Admin, otherwise
  // Viewer (an admin can promote them). This mirrors the bootstrap admin
  // behaviour so the app is never unreachable.
  const firstUser = load().users.length === 0;
  return upsertUser({
    email: email || `${login}@users.noreply.github.com`,
    name: name || login,
    role: firstUser ? 'Super Admin' : 'Viewer',
    githubLogin: login,
    githubId: id,
  });
}

function getRawById(id) {
  const u = load().users.find(u => u.id === id);
  if (!u) return {};
  return { email: u.email, name: u.name, role: u.role, department: u.department };
}

/** Bootstrap admin — printed to console on first boot when the store is empty. */
export function ensureBootstrapAdmin() {
  const users = load().users;
  if (users.length > 0) return null;
  const password = crypto.randomBytes(12).toString('base64url');
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@local';
  upsertUser({
    email, name: 'Bootstrap Admin', role: 'Super Admin',
    password, mustChangePassword: true,
  });
  return { email, password };
}
