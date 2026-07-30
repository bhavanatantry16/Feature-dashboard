import { fmt, statusToneKey } from './utils.js';

const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];
const MONTHS_BY_Q = {
  Q1: 'Jan · Feb · Mar', Q2: 'Apr · May · Jun', Q3: 'Jul · Aug · Sep', Q4: 'Oct · Nov · Dec',
};

let currentItems = [];

export function renderRoadmap(items, onItemClick) {
  currentItems = items || [];
  const empty = document.getElementById('roadmap-empty');
  const timeline = document.getElementById('roadmap-timeline');
  const lanes = document.getElementById('roadmap-lanes');
  if (!currentItems.length) {
    timeline.innerHTML = ''; lanes.innerHTML = ''; empty.classList.remove('hidden'); return;
  }
  empty.classList.add('hidden');
  timeline.innerHTML = QUARTERS.map(q => `<div class="quarter"><b>${q}</b> <span class="text-ink-500">· ${MONTHS_BY_Q[q]}</span></div>`).join('');
  lanes.innerHTML = QUARTERS.map(q => {
    const items = currentItems.filter(i => (i.quarter || 'Q1').toUpperCase() === q);
    if (items.length === 0) return `<div class="roadmap-lane"><div class="text-xs text-ink-500 text-center opacity-70 pt-6">—</div></div>`;
    return `<div class="roadmap-lane">${items.map(itemHtml).join('')}</div>`;
  }).join('');
  document.querySelectorAll('.roadmap-item[data-id]').forEach(node => {
    node.addEventListener('click', () => onItemClick?.(node.dataset.id));
  });
}

function itemHtml(it) {
  const tone = statusToneKey(it.liveStatus || it.status || 'Not Started');
  const progress = ({ 'not-started': 5, 'development': 40, 'testing': 70, 'production': 100, 'blocked': 30, 'waiting': 20 })[tone] ?? 5;
  return `<div class="roadmap-item ${tone}" data-id="${fmt.escape(it.id)}">
    <div class="roadmap-title">${fmt.escape(it.name)}</div>
    ${it.description ? `<div class="roadmap-desc">${fmt.escape(fmt.short(it.description, 90))}</div>` : ''}
    <div class="roadmap-foot">
      <span class="status-pill ${tone}">${fmt.escape(it.liveStatus || it.status || 'Not Started')}</span>
      ${it.owner ? `<span>· ${fmt.escape(it.owner)}</span>` : ''}
      ${it.matched === false ? `<span class="text-[10px] text-ink-400 ml-auto" title="Not yet linked to a GitHub feature">unlinked</span>` : ''}
    </div>
    <div class="rm-progress"><span style="width:${progress}%"></span></div>
  </div>`;
}

// ---- Import dialog ----
const dlg = () => document.getElementById('import-dialog');
export function openImport() { dlg().classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
export function closeImport() { dlg().classList.add('hidden'); document.body.style.overflow = ''; }
document.addEventListener('click', e => { if (e.target?.matches?.('[data-import-close]')) closeImport(); });
