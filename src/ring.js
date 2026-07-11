/**
 * @fileoverview Rhizome — transit page (ring.html) controller
 * Picks target node, fills registry card, animates progress, redirects.
 * Supports cancel-redirect and graceful error display.
 */

import { loadNodes, liveNodes, uid, mkRng } from './core.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const STEPS = Object.freeze(['ROUTING', 'HANDSHAKE', 'VERIFYING', 'TUNNELING', 'CONNECTED']);
const DIRS  = Object.freeze({ n: '→ Next Node', p: '← Prev Node', r: '⊕ Random Node' });
const ANIM_DURATION = 1800; // ms

// ─── Query params ─────────────────────────────────────────────────────────────

const sp   = new URLSearchParams(location.search);
const from = sp.get('f');
const dir  = sp.get('d') || 'n';
const tag  = sp.get('tag') ?? undefined; // optional tag filter pass-through

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const $   = id => document.getElementById(id);
const win = document.querySelector('.win');

$('dir-label').textContent = DIRS[dir] ?? 'Record';

// ─── Cancel redirect ──────────────────────────────────────────────────────────

let redirectCancelled = false;
let redirectTimer     = null;
let targetUrl         = null;

/** @type {HTMLButtonElement|null} */
const cancelBtn = $('cancel-redirect');
cancelBtn?.addEventListener('click', () => {
  redirectCancelled = true;
  clearTimeout(redirectTimer);
  cancelBtn.hidden = true;

  // Show "visit" link instead
  if (targetUrl) {
    const visitLink = $('visit-link');
    if (visitLink) {
      visitLink.href   = targetUrl;
      visitLink.hidden = false;
    }
  }

  // Stop progress animation
  const bar = $('bar');
  if (bar) bar.style.transition = 'none';

  $('f-status').textContent = 'PAUSED';
  $('pct').textContent      = '—';
});

// ─── Node selection ───────────────────────────────────────────────────────────

/** @param {import('./core.js').Node[]} alive */
function pickTarget(alive) {
  if (dir === 'r') {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return alive[buf[0] % alive.length];
  }

  const i = alive.findIndex(n => uid(n.url) === from?.toUpperCase());
  return alive[(i + (dir === 'p' ? -1 : 1) + alive.length) % alive.length];
}

// ─── Card rendering ───────────────────────────────────────────────────────────

/**
 * Generate deterministic fake IPv6 address from RNG.
 * @param {() => number} rng
 */
function fakeIPv6(rng) {
  return Array.from({ length: 8 }, () =>
    (rng() * 0xffff | 0).toString(16).padStart(4, '0')
  ).join(':');
}

/**
 * Generate deterministic fake coordinates from RNG.
 * @param {() => number} rng
 */
function fakeCoord(rng) {
  const la = (rng() * 170 - 85).toFixed(4);
  const lo = (rng() * 360 - 180).toFixed(4);
  return `${Math.abs(la)}° ${la > 0 ? 'N' : 'S'},  ${Math.abs(lo)}° ${lo > 0 ? 'E' : 'W'}`;
}

/** @param {import('./core.js').Node} node */
function fillCard(node) {
  const id  = uid(node.url);
  const rng = mkRng(id);

  $('f-name').textContent  = node.name;
  $('f-ip').textContent    = fakeIPv6(rng);
  $('f-coord').textContent = fakeCoord(rng);
  $('f-bio').textContent   = node.bio || '—';
  $('f-url').textContent   = node.url.replace(/^https?:\/\//, '');
  $('s-id').textContent    = id;

  // Tags row
  const tagsEl = $('f-tags');
  if (tagsEl && node.tags?.length) {
    tagsEl.innerHTML = node.tags
      .map(t => `<span class="rz-tag-pill">${t}</span>`)
      .join('');
    tagsEl.closest('.field')?.removeAttribute('hidden');
  }

  // Stamp
  $('s-time').textContent  = new Date().toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
  $('s-time').setAttribute('datetime', new Date().toISOString());

  // Peer badge
  if (node._peer) {
    $('f-peer')?.removeAttribute('hidden');
  }
}

// ─── Progress animation → redirect ───────────────────────────────────────────

/** @param {string} url */
function startProgress(url) {
  targetUrl        = url;
  const bar        = $('bar');
  const pct        = $('pct');
  const statusEl   = $('f-status');
  const t0         = performance.now();

  if (cancelBtn) cancelBtn.hidden = false;

  function tick(now) {
    if (redirectCancelled) return;

    const p    = Math.min(100, (now - t0) / ANIM_DURATION * 100);
    const step = Math.min(STEPS.length - 1, (p / 20) | 0);

    bar.value          = p;
    pct.textContent    = `${Math.round(p)}%`;
    statusEl.textContent = STEPS[step];

    if (p < 100) { requestAnimationFrame(tick); return; }

    // Fade out card, then redirect
    win.style.transition = 'opacity .32s ease, transform .32s cubic-bezier(.22,1,.36,1)';
    win.style.opacity    = '0';
    win.style.transform  = 'translateY(-4px) scale(.98)';

    redirectTimer = setTimeout(() => {
      if (!redirectCancelled) location.replace(url);
    }, 340);
  }

  requestAnimationFrame(tick);
}

// ─── Error display ────────────────────────────────────────────────────────────

/** @param {string} msg */
function showError(msg) {
  win.style.cssText   += ';animation:none;opacity:1;transform:none';
  $('f-name').textContent    = msg;
  $('f-status').textContent  = 'ERROR';
  if (cancelBtn) cancelBtn.hidden = true;
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function boot() {
  try {
    const nodes = await loadNodes();
    const alive = liveNodes(nodes, tag);

    if (!alive.length) {
      showError(tag ? `No active nodes tagged "${tag}"` : 'No active nodes');
      return;
    }

    const target = pickTarget(alive);
    fillCard(target);
    startProgress(target.url);

  } catch (err) {
    showError(`Failed to load nodes (${err.message})`);
  }
}

boot();
