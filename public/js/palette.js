import { navigate } from './router.js';
import { fmt } from './utils.js';
import { showFeature, showCommit } from './drawer.js';

let snapshot = null;
export function setPaletteData(s) { snapshot = s; }

const el = () => document.getElementById('palette');
const input = () => document.getElementById('palette-input');
const results = () => document.getElementById('palette-results');

let active = 0;
let items = [];

const PAGES = [
  ['overview','Overview'],['activity','Live Activity'],['analytics','Git Activity Analytics'],
  ['contributors','Contributors'],['commits','Commits'],['pulls','Pull Requests'],
  ['branches','Branches'],['features','Features'],['lifecycle','Feature Lifecycle'],
  ['releases','Releases'],['deployments','Deployments'],['environments','Environments'],
  ['compare','Environment Comparison'],['diff','Missing Features'],['notifications','Notifications'],
  ['audit','Audit Log'],['insights','Smart Insights'],['repos','Repositories & Health'],
];

function search(q) {
  q = q.toLowerCase().trim();
  const out = [];
  for (const [id, label] of PAGES) {
    if (!q || label.toLowerCase().includes(q)) out.push({ icon: 'compass', label, sub: 'Go to page', action: () => navigate(id) });
  }
  if (!snapshot) return out.slice(0, 30);
  for (const r of snapshot.repositories) if (!q || r.full_name.toLowerCase().includes(q)) out.push({ icon: 'folder-git-2', label: r.full_name, sub: r.lang || 'repository', action: () => navigate('repos') });
  for (const c of snapshot.contributors) if (!q || c.login.toLowerCase().includes(q)) out.push({ icon: 'user', label: c.login, sub: `${c.contributions} contributions`, action: () => navigate('contributors') });
  for (const p of snapshot.prs) if (!q || (p.title + ' #' + p.number).toLowerCase().includes(q)) out.push({ icon: 'git-pull-request', label: `#${p.number} · ${fmt.short(p.title, 60)}`, sub: p.repoFull, action: () => navigate('pulls') });
  for (const c of snapshot.commits) if (!q || (c.message + ' ' + c.shortSha).toLowerCase().includes(q)) out.push({ icon: 'git-commit-horizontal', label: c.shortSha + ' — ' + fmt.short(c.message, 60), sub: c.author + ' · ' + c.repo, action: () => showCommit(c) });
  for (const f of snapshot.features) if (!q || f.title.toLowerCase().includes(q)) out.push({ icon: 'sparkles', label: f.title, sub: `Feature · ${f.stage}`, action: () => showFeature(f.key) });
  return out.slice(0, 40);
}

function render() {
  const list = results();
  list.innerHTML = items.map((it, i) => `
    <div class="palette-item ${i === active ? 'active' : ''}" data-idx="${i}">
      <i data-lucide="${it.icon}" class="w-4 h-4 text-slate-400"></i>
      <div class="flex-1 min-w-0">
        <div class="truncate">${fmt.escape(it.label)}</div>
        <div class="text-[11px] text-slate-500 truncate">${fmt.escape(it.sub)}</div>
      </div>
    </div>
  `).join('');
  window.lucide?.createIcons();
  list.querySelectorAll('.palette-item').forEach(node => {
    node.addEventListener('click', () => { const it = items[Number(node.dataset.idx)]; close(); it?.action?.(); });
    node.addEventListener('mouseenter', () => { active = Number(node.dataset.idx); render(); });
  });
}

export function open() {
  el().classList.remove('hidden');
  input().value = ''; active = 0;
  items = search('');
  render();
  setTimeout(() => input().focus(), 30);
}
export function close() { el().classList.add('hidden'); }

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); open(); return; }
  if (!el() || el().classList.contains('hidden')) return;
  if (e.key === 'Escape') { e.preventDefault(); close(); }
  if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(items.length - 1, active + 1); render(); }
  if (e.key === 'ArrowUp')   { e.preventDefault(); active = Math.max(0, active - 1); render(); }
  if (e.key === 'Enter') { e.preventDefault(); const it = items[active]; close(); it?.action?.(); }
});
document.addEventListener('click', e => { if (e.target?.matches?.('[data-palette-close]')) close(); });

document.addEventListener('input', e => {
  if (e.target?.id !== 'palette-input') return;
  items = search(e.target.value); active = 0; render();
});
