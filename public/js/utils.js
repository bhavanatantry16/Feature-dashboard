export const fmt = {
  number(n) { return (n ?? 0).toLocaleString(); },
  short(s, n = 60) { if (!s) return ''; return s.length > n ? s.slice(0, n - 1) + '…' : s; },
  escape(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); },
  relative(iso) {
    if (!iso) return '—';
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return '—';
    const diff = Date.now() - t;
    const s = Math.round(diff / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24); return `${d}d ago`;
  },
  datetime(iso) { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); },
  clock(iso) { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); },
};

// Turn `feat: fix auth bug — closes #12`, `feature/login-auth-v2`, `payment_api_fix` → human-readable feature names.
export function humanize(raw) {
  if (!raw) return 'Untitled';
  let s = String(raw);
  s = s.replace(/^\s*(feat|fix|chore|perf|refactor|test|docs|hotfix|bugfix|release|build|ci|style)(\([^)]*\))?\s*:\s*/i, '');
  s = s.split(/\s+—\s+|\s+-\s+#|#\d+/)[0];
  s = s.replace(/^(feature|hotfix|bugfix|release|fix|chore|refactor|test)[\/_-]+/i, '');
  s = s.replace(/-v\d+(\.\d+)*$/i, '').replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const smallWords = new Set(['a','an','and','the','of','for','to','in','on','with','vs','via']);
  return s.split(' ').map((w, i) => {
    if (i > 0 && smallWords.has(w.toLowerCase())) return w.toLowerCase();
    return w.length > 2 ? (w[0].toUpperCase() + w.slice(1)) : w.toUpperCase();
  }).join(' ');
}

// Person-friendly display name from a GitHub login.
export function niceName(login) {
  if (!login) return 'Team';
  return login.split(/[-._]/).map(part => (part[0] || '').toUpperCase() + part.slice(1)).join(' ');
}

// A single, non-technical description of a GitHub event.
export function actionLabel(eventType) {
  return ({
    'PushEvent':              'Pushed to Repository',
    'PullRequestEvent':       'PR Created',
    'PullRequestReviewEvent': 'Review Left',
    'IssuesEvent':            'Requested',
    'IssueCommentEvent':      'Commented',
    'DeploymentEvent':        'Deployed',
    'DeploymentStatusEvent':  'Deployment Update',
    'ReleaseEvent':           'Released',
    'CreateEvent':            'Started',
    'DeleteEvent':            'Removed',
  })[eventType] || 'Updated';
}

export function avatar(url, alt = '', cls = 'avatar') {
  if (!url) return `<span class="${cls}" title="${fmt.escape(alt)}"></span>`;
  return `<img src="${fmt.escape(url)}" alt="${fmt.escape(alt)}" class="${cls}" title="${fmt.escape(alt)}" />`;
}

export function debounce(fn, wait = 200) {
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

export function statusToneKey(status) {
  const l = String(status || '').toLowerCase();
  if (l.includes('prod') || l === 'live') return 'production';
  if (l.includes('test') || l.includes('qa') || l.includes('uat') || l.includes('review')) return 'testing';
  if (l.includes('dev')) return 'development';
  if (l.includes('block')) return 'blocked';
  if (l.includes('wait')) return 'waiting';
  return 'not-started';
}
