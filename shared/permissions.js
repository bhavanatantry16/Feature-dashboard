// Permission catalogue + role templates.
//
// Shared between client and server so the Add-User drawer can show the
// exact same permission list that the backend enforces. Categorised so
// the drawer can render sections instead of one huge flat list.
//
// Naming convention: <verb>.<noun>. Verbs stay short (view / manage /
// create / edit / delete). Nouns follow the app's tab structure.
//
// The Administrator template is deliberately `*` (all permissions) so
// that adding a new permission later doesn't require going and ticking
// it on every admin. Non-admin templates enumerate explicitly so newly
// added permissions default to DENIED for those roles.

export const PERMISSIONS = [
  // Dashboard
  { key: 'view.dashboard',        label: 'View Dashboard',       category: 'Dashboard' },
  { key: 'view.reports',          label: 'View Reports',         category: 'Dashboard' },

  // Features
  { key: 'view.features',         label: 'View Features',        category: 'Features' },
  { key: 'create.features',       label: 'Create Features',      category: 'Features' },
  { key: 'edit.assigned',         label: 'Edit Assigned Features', category: 'Features' },
  { key: 'edit.features',         label: 'Edit Any Feature',     category: 'Features' },
  { key: 'move.status',           label: 'Move Feature Status',  category: 'Features' },
  { key: 'delete.features',       label: 'Delete Features',      category: 'Features' },

  // Roadmap
  { key: 'view.roadmap',          label: 'View Roadmap',         category: 'Roadmap' },
  { key: 'edit.roadmap',          label: 'Edit Roadmap',         category: 'Roadmap' },

  // Bugs
  { key: 'view.bugs',             label: 'View Bugs',            category: 'Bugs' },
  { key: 'create.bugs',           label: 'Create Bugs',          category: 'Bugs' },
  { key: 'edit.bugs',             label: 'Edit Bugs',            category: 'Bugs' },
  { key: 'delete.bugs',           label: 'Delete Bugs',          category: 'Bugs' },
  { key: 'import.bugs',           label: 'Import Bugs',          category: 'Bugs' },

  // GitHub
  { key: 'view.prs',              label: 'View Pull Requests',   category: 'GitHub' },
  { key: 'view.commits',          label: 'View Commits',         category: 'GitHub' },
  { key: 'view.issues',           label: 'View Issues',          category: 'GitHub' },
  { key: 'comment',               label: 'Comment on Items',     category: 'GitHub' },
  { key: 'manage.github',         label: 'Manage GitHub Integration', category: 'GitHub' },

  // Team + admin
  { key: 'view.team',             label: 'View Team Members',    category: 'Team' },
  { key: 'manage.team',           label: 'Add / Edit / Deactivate Users', category: 'Team' },
  { key: 'delete.users',          label: 'Delete Users',         category: 'Team' },
  { key: 'manage.roles',          label: 'Manage Roles',         category: 'Team' },

  // Availability
  { key: 'manage.availability',   label: 'Set Own Availability', category: 'Availability' },
];

// Ordered by descending privilege — same order used in role dropdowns.
// `Administrator` is spelled out (not `Admin`) to match the user-facing
// spec; the internal role name stays `Admin` for backend compatibility
// with the auth service.
export const ROLE_DISPLAY_NAMES = {
  'Super Admin':          'Super Admin',
  'Admin':                'Administrator',
  'Engineering Manager':  'Engineering Manager',
  'Product Manager':      'Product Manager',
  'Developer':            'Developer',
  'QA':                   'QA Engineer',
  'Viewer':               'Viewer',
  'Employee':             'Employee',
};

/** Role templates — the checkbox set an Add-User drawer starts from. */
export const ROLE_PERMISSIONS = {
  'Super Admin':          '*',
  'Admin':                '*',
  'Engineering Manager':  [
    'view.dashboard','view.reports','view.features','create.features','edit.features',
    'move.status','view.roadmap','edit.roadmap',
    'view.bugs','create.bugs','edit.bugs','import.bugs',
    'view.prs','view.commits','view.issues','comment','view.team',
  ],
  'Product Manager':      [
    'view.dashboard','view.reports','view.features','create.features','edit.features',
    'move.status','view.roadmap','edit.roadmap',
    'view.bugs','create.bugs','edit.bugs','view.issues','comment','view.team',
  ],
  'Developer':            [
    'view.dashboard','view.reports','view.features','create.features',
    'edit.assigned','move.status','view.roadmap',
    'view.bugs','create.bugs','edit.bugs',
    'view.prs','view.commits','view.issues','comment','view.team',
  ],
  'QA':                   [
    'view.dashboard','view.reports','view.features','view.roadmap',
    'view.bugs','create.bugs','edit.bugs','import.bugs',
    'view.prs','view.commits','view.issues','comment','view.team',
  ],
  'Viewer':               [
    'view.dashboard','view.reports','view.features','view.roadmap','view.bugs','view.team',
  ],
  'Employee':             [
    'manage.availability',
  ],
};

/** Resolve a role's default permission set into the concrete key list. */
export function defaultPermissionsFor(role) {
  const raw = ROLE_PERMISSIONS[role];
  if (raw === '*') return PERMISSIONS.map(p => p.key);
  return Array.isArray(raw) ? [...raw] : [];
}

/** Does a user (via effective permission set) hold the given permission? */
export function hasPermission(effective, key) {
  if (!effective) return false;
  if (effective === '*' || (Array.isArray(effective) && effective.includes('*'))) return true;
  return Array.isArray(effective) && effective.includes(key);
}
