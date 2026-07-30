// Shared Chart.js helpers with theme-aware colors and instance registry.
const registry = new Map();

function isDark() { return document.documentElement.classList.contains('dark'); }
export const palette = () => isDark()
  ? ['#60a5fa','#a78bfa','#f472b6','#fbbf24','#34d399','#f87171','#22d3ee','#e879f9']
  : ['#3b82f6','#8b5cf6','#ec4899','#f59e0b','#10b981','#ef4444','#06b6d4','#a855f7'];
const gridColor = () => isDark() ? 'rgba(148,163,184,0.15)' : 'rgba(148,163,184,0.2)';
const tickColor = () => isDark() ? 'rgba(203,213,225,0.9)' : 'rgba(51,65,85,0.9)';

export function baseOptions(extra = {}) {
  return {
    responsive: true, maintainAspectRatio: false, animation: { duration: 400 },
    plugins: {
      legend: { labels: { color: tickColor(), boxWidth: 10 } },
      tooltip: { backgroundColor: 'rgba(15,23,42,0.9)', titleColor: '#fff', bodyColor: '#fff' },
    },
    scales: extra.scales ?? {
      x: { ticks: { color: tickColor() }, grid: { color: gridColor() } },
      y: { ticks: { color: tickColor() }, grid: { color: gridColor() }, beginAtZero: true },
    },
    ...extra,
  };
}

export function upsert(id, cfg) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const existing = registry.get(id);
  if (existing) { existing.destroy(); registry.delete(id); }
  registry.set(id, new Chart(canvas.getContext('2d'), cfg));
}

export function destroyAll() {
  for (const c of registry.values()) c.destroy();
  registry.clear();
}
