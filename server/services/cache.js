const store = new Map();
const inflight = new Map();

export function cached(key, ttlSeconds, producer) {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return Promise.resolve(hit.value);
  if (inflight.has(key)) return inflight.get(key);
  const p = Promise.resolve().then(producer).then(v => {
    store.set(key, { expires: Date.now() + ttlSeconds * 1000, value: v });
    inflight.delete(key);
    return v;
  }).catch(err => { inflight.delete(key); throw err; });
  inflight.set(key, p);
  return p;
}

export function invalidate(prefix = '') {
  for (const k of Array.from(store.keys())) {
    if (!prefix || k.startsWith(prefix)) store.delete(k);
  }
}
