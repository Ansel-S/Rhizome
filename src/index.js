/**
 * @fileoverview Rhizome — landing page controller
 * Handles wander button, tag filter UI, and network health mini-stats.
 */

import { loadNodes, liveNodes, uid } from './core.js';

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const btn        = document.getElementById('wander');
const note       = document.getElementById('wander-note');
const tagBar     = document.getElementById('tag-bar');     // optional
const statAlive  = document.getElementById('stat-alive');  // optional
const statTotal  = document.getElementById('stat-total');  // optional

// Active tag filter (null = all)
let activeTag = null;

// ─── Bootstrap ────────────────────────────────────────────────────────────────

(async () => {
  try {
    const nodes = await loadNodes();
    renderStats(nodes);
    renderTagBar(nodes);
  } catch {
    // Non-critical — stats/tags are progressive enhancement
  }
})();

// ─── Wander ───────────────────────────────────────────────────────────────────

btn?.addEventListener('click', async () => {
  btn.disabled     = true;
  note.textContent = '';

  try {
    const nodes = await loadNodes();
    const alive = liveNodes(nodes, activeTag ?? undefined);

    if (!alive.length) {
      note.textContent = activeTag
        ? `No active nodes tagged "${activeTag}" yet.`
        : 'No active nodes yet.';
      btn.disabled = false;
      return;
    }

    const u      = new Uint32Array(1);
    crypto.getRandomValues(u);
    const target = alive[u[0] % alive.length];

    location.href = `ring.html?f=${uid(target.url)}&d=r`;
  } catch {
    note.textContent = 'Could not load nodes — try again.';
    btn.disabled = false;
  }
});

// ─── Stats ────────────────────────────────────────────────────────────────────

/** @param {import('./core.js').Node[]} nodes */
function renderStats(nodes) {
  const alive = nodes.filter(n => n.status !== 'dormant').length;
  if (statAlive) statAlive.textContent = alive;
  if (statTotal) statTotal.textContent = nodes.length;
}

// ─── Tag filter bar ───────────────────────────────────────────────────────────

/** @param {import('./core.js').Node[]} nodes */
function renderTagBar(nodes) {
  if (!tagBar) return;

  // Collect all unique tags, sort by frequency descending
  const freq = new Map();
  for (const n of nodes) {
    for (const t of (n.tags ?? [])) freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  if (!freq.size) return;

  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);

  tagBar.innerHTML = '';

  // "All" pill
  tagBar.append(makePill('all', null, activeTag === null));

  for (const [tag, count] of sorted) {
    tagBar.append(makePill(`${tag} (${count})`, tag, activeTag === tag));
  }
}

/**
 * @param {string}      label
 * @param {string|null} tag
 * @param {boolean}     active
 * @returns {HTMLButtonElement}
 */
function makePill(label, tag, active) {
  const el = document.createElement('button');
  el.className       = `rz-tag${active ? ' rz-tag--active' : ''}`;
  el.textContent     = label;
  el.setAttribute('aria-pressed', String(active));
  el.addEventListener('click', () => {
    activeTag = tag;
    // Re-render pills
    tagBar.querySelectorAll('.rz-tag').forEach(p => {
      const isThis = p === el;
      p.classList.toggle('rz-tag--active', isThis);
      p.setAttribute('aria-pressed', String(isThis));
    });
  });
  return el;
}
