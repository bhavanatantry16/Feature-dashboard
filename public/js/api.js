function demoQuery() { return new URLSearchParams(location.search).get('demo') === '1' ? '?demo=1' : ''; }

export const api = {
  isDemo() { return demoQuery() === '?demo=1'; },
  async config() { const r = await fetch('/api/config'); if (!r.ok) throw new Error('cfg'); return r.json(); },
  async snapshot() {
    const r = await fetch('/api/snapshot' + demoQuery());
    const body = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(body.error || `HTTP ${r.status}`); e.status = r.status; throw e; }
    return body;
  },
  async feature(key) {
    const r = await fetch('/api/feature/' + encodeURIComponent(key) + demoQuery());
    if (!r.ok) throw new Error('feature'); return r.json();
  },
  async commit(owner, repo, sha) {
    const r = await fetch(`/api/commit/${owner}/${repo}/${sha}${demoQuery()}`);
    if (!r.ok) throw new Error('commit'); return r.json();
  },
  async releaseNotes(owner, repo, since, head) {
    const q = new URLSearchParams({ since, head: head || 'main' });
    if (this.isDemo()) q.set('demo', '1');
    const r = await fetch(`/api/release-notes/${owner}/${repo}?${q.toString()}`);
    if (!r.ok) throw new Error('release-notes'); return r.json();
  },
  async refresh() {
    if (this.isDemo()) return { ok: true };
    const r = await fetch('/api/refresh', { method: 'POST' });
    if (!r.ok) throw new Error('refresh'); return r.json();
  },
  subscribeEvents(onEvent) {
    if (this.isDemo()) return () => {};
    const es = new EventSource('/api/events');
    es.onmessage = (m) => { try { onEvent(JSON.parse(m.data)); } catch {} };
    return () => es.close();
  },
};
