// Minimalist hash-based router. Pages register once; nav clicks change window.location.hash.

const routes = new Map();
const meta = new Map();

export function register(id, opts, renderFn) {
  routes.set(id, renderFn);
  meta.set(id, opts);
}

export function getMeta(id) { return meta.get(id); }
export function allMeta() { return Array.from(meta.entries()).map(([id, m]) => ({ id, ...m })); }

export function currentRoute() {
  const raw = location.hash.replace(/^#\/?/, '').split('?')[0] || 'overview';
  return raw;
}

export function navigate(id) { location.hash = '#/' + id; }

export function start(onRender) {
  const go = () => {
    const id = currentRoute();
    const fn = routes.get(id) || routes.get('overview');
    onRender(id, fn);
  };
  window.addEventListener('hashchange', go);
  go();
}
