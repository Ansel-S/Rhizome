/**
 * @fileoverview Rhizome Core — shared browser-side utilities
 * ES module · zero dependencies · ~1.2 KB gzipped
 *
 * Consumed by: src/index.js, src/ring.js
 * NOT used by: spore.js (standalone IIFE), scripts/ (Node env)
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const CACHE_KEY  = 'rz2';         // bump on schema change (migrates cleanly)
const TTL        = 864e5;         // 24 h — nominal freshness window
const TTL_GRACE  = TTL * 3;       // 72 h — stale-while-error extension
const FETCH_OPTS = { signal: AbortSignal.timeout(8000) };

// ─── Identity ─────────────────────────────────────────────────────────────────

/**
 * FNV-1a 32-bit hash → 8-char uppercase base-36 node ID.
 * Deterministic: same URL always produces same ID.
 *
 * @param {string} url
 * @returns {string}
 */
export function uid(url) {
  let h = 2166136261;
  for (let i = 0; i < url.length; i++)
    h = Math.imul(h ^ url.charCodeAt(i), 16777619) >>> 0;
  return h.toString(36).toUpperCase().padStart(8, '0').slice(-8);
}

/**
 * Seeded LCG RNG — deterministic fake metadata per node.
 *
 * @param {string} seed  - A node's UID string
 * @returns {() => number}  - Returns floats in [0, 1)
 */
export function mkRng(seed) {
  let s = parseInt(seed, 36) >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

// ─── Cache ────────────────────────────────────────────────────────────────────

/** @returns {{ t: number, d: Node[], etag?: string } | null} */
function readStore() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY));
  } catch {
    return null;
  }
}

/**
 * @param {Node[]}  data
 * @param {string=} etag
 */
function writeStore(data, etag) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      t: Date.now(),
      d: data,
      ...(etag && { etag }),
    }));
  } catch { /* quota exceeded — silent */ }
}

/** Refresh TTL without changing data (used on 304 responses). */
function touchStore(store) {
  writeStore(store.d, store.etag);
}

// ─── URL resolution ───────────────────────────────────────────────────────────

/** @param {string} base */
function nodesUrl(base) {
  if (base) return `${base.replace(/\/$/, '')}/nodes.json`;
  const meta = document.querySelector('meta[name=rz-base]')?.content;
  if (meta) return `${meta.replace(/\/$/, '')}/nodes.json`;
  return new URL('nodes.json', location.href).href;
}

// ─── Peer federation ─────────────────────────────────────────────────────────

/**
 * Fetch and merge nodes from peer registries.
 * Deduplicates by URL; peer nodes marked with `_peer: true`.
 *
 * @param {Node[]}   primary
 * @param {string[]} peerUrls
 * @returns {Promise<Node[]>}
 */
async function mergePeers(primary, peerUrls) {
  const known = new Set(primary.map(n => n.url));

  const settled = await Promise.allSettled(
    peerUrls.map(url =>
      fetch(url, { signal: AbortSignal.timeout(5000) }).then(r => r.json())
    )
  );

  const extras = settled
    .filter(({ status }) => status === 'fulfilled')
    .flatMap(({ value }) => (Array.isArray(value) ? value : []))
    .filter(n => n?.url && !known.has(n.url))
    .map(n => ({ ...n, _peer: true }));

  return [...primary, ...extras];
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @typedef {object} Node
 * @property {string}    name
 * @property {string}    url
 * @property {string}    bio
 * @property {string[]=} tags
 * @property {string=}   joined      - ISO date string
 * @property {string=}   feed        - RSS/Atom URL
 * @property {'dormant'=} status
 * @property {true=}     _peer       - Injected by peer federation
 */

/**
 * Load the node registry with ETag-aware caching, graceful degradation,
 * optional peer federation, and tag filtering.
 *
 * Resolution order:
 *   1. Fresh localStorage cache (< TTL, no network)
 *   2. Conditional GET with If-None-Match → 304 refreshes TTL only
 *   3. Full GET → parse, write cache
 *   4. On error: stale cache up to TTL_GRACE (72 h)
 *
 * @param {object}   [opts]
 * @param {string}   [opts.base='']        - Rhizome host base URL
 * @param {string[]} [opts.peers=[]]       - Peer nodes.json URLs to merge
 * @param {string=}  [opts.filterTag]      - Return only nodes with this tag
 * @returns {Promise<Node[]>}
 */
export async function loadNodes({ base = '', peers = [], filterTag } = {}) {
  const store  = readStore();
  const isFresh = store && (Date.now() - store.t < TTL);

  // ① Serve from warm cache (skip network entirely)
  if (isFresh && !peers.length) {
    return filter(store.d, filterTag);
  }

  try {
    const url     = nodesUrl(base);
    const headers = store?.etag ? { 'If-None-Match': store.etag } : {};
    const res     = await fetch(url, { ...FETCH_OPTS, headers });

    let data;
    if (res.status === 304 && store) {
      // ② Not modified — just push TTL forward
      touchStore(store);
      data = store.d;
    } else if (res.ok) {
      // ③ Fresh data
      data = await res.json();
      writeStore(data, res.headers.get('ETag') ?? undefined);
    } else {
      throw new Error(`HTTP ${res.status}`);
    }

    if (peers.length) data = await mergePeers(data, peers);
    return filter(data, filterTag);

  } catch (err) {
    // ④ Stale-while-error: serve cached data if within grace window
    if (store && (Date.now() - store.t < TTL_GRACE)) {
      console.warn('[rhizome] serving stale cache after fetch error:', err.message);
      return filter(store.d, filterTag);
    }
    throw err;
  }
}

/**
 * Return only active (non-dormant) nodes, optionally filtered by tag.
 *
 * @param {Node[]}  nodes
 * @param {string=} filterTag
 * @returns {Node[]}
 */
export function liveNodes(nodes, filterTag) {
  return filter(
    nodes.filter(n => n.status !== 'dormant'),
    filterTag
  );
}

/** @param {Node[]} nodes  @param {string=} tag */
function filter(nodes, tag) {
  return tag ? nodes.filter(n => n.tags?.includes(tag)) : nodes;
}
