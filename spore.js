/**
 * Rhizome Spore v2 — <rhizome-spore> custom element
 *
 * Standalone IIFE · zero dependencies · embeds on any member site
 *
 * Attributes:
 *   host        Rhizome registry base URL (required)
 *   filter-tag  Only traverse nodes with this tag
 *   lang        UI language: en (default) | zh | ja | fr | de | es
 *   size        Widget size: default | compact | wide
 *   theme       Color theme: auto (default) | light | dark
 *
 * Example:
 *   <rhizome-spore
 *     host="https://you.github.io/Rhizome"
 *     lang="zh"
 *     size="compact"
 *     theme="auto">
 *   </rhizome-spore>
 *   <script src="https://you.github.io/Rhizome/spore.js" defer></script>
 */

(function () {
  'use strict';

  // ─── Constants ──────────────────────────────────────────────────────────────

  const CACHE_KEY = 'rz2';
  const TTL       = 864e5;
  const TTL_GRACE = TTL * 3;

  // Localised strings for all UI labels
  const I18N = Object.freeze({
    en: { prev: '← Prev', rand: 'Random', next: 'Next →', err: 'Network error', ring: 'Rhizome' },
    zh: { prev: '← 上一个', rand: '随机', next: '下一个 →', err: '网络错误', ring: 'Rhizome' },
    ja: { prev: '← 前へ', rand: 'ランダム', next: '次へ →', err: 'ネットワークエラー', ring: 'Rhizome' },
    fr: { prev: '← Préc', rand: 'Hasard', next: 'Suiv →', err: 'Erreur réseau', ring: 'Rhizome' },
    de: { prev: '← Zurück', rand: 'Zufall', next: 'Weiter →', err: 'Netzwerkfehler', ring: 'Rhizome' },
    es: { prev: '← Ant', rand: 'Aleatorio', next: 'Sig →', err: 'Error de red', ring: 'Rhizome' },
  });

  // ─── Utilities ──────────────────────────────────────────────────────────────

  /** FNV-1a 32-bit → 8-char base-36 node ID */
  function uid(url) {
    let h = 2166136261;
    for (let i = 0; i < url.length; i++)
      h = Math.imul(h ^ url.charCodeAt(i), 16777619) >>> 0;
    return h.toString(36).toUpperCase().padStart(8, '0').slice(-8);
  }

  /** Read raw stored cache (may be expired — used for grace-window fallback) */
  function readStore() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch { return null; }
  }

  function writeStore(data, etag) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), d: data, ...(etag && { etag }) }));
    } catch { /* quota */ }
  }

  /**
   * Load nodes with ETag caching + stale-while-error.
   * @param {string}  base
   * @param {string=} filterTag
   * @returns {Promise<object[]>}
   */
  async function loadNodes(base, filterTag) {
    const store   = readStore();
    const isFresh = store && (Date.now() - store.t < TTL);

    if (isFresh) return applyFilter(store.d, filterTag);

    try {
      const headers = store?.etag ? { 'If-None-Match': store.etag } : {};
      const res     = await fetch(`${base}/nodes.json`, {
        headers,
        signal: AbortSignal.timeout(8000),
      });

      if (res.status === 304 && store) {
        writeStore(store.d, store.etag);        // refresh TTL
        return applyFilter(store.d, filterTag);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      writeStore(data, res.headers.get('ETag'));
      return applyFilter(data, filterTag);

    } catch (err) {
      // Stale-while-error: serve up to 72h
      if (store && (Date.now() - store.t < TTL_GRACE)) return applyFilter(store.d, filterTag);
      throw err;
    }
  }

  function applyFilter(nodes, tag) {
    const live = nodes.filter(n => n.status !== 'dormant');
    return tag ? live.filter(n => n.tags?.includes(tag)) : live;
  }

  // ─── Shadow DOM template ────────────────────────────────────────────────────

  /**
   * @param {{ prev:string, rand:string, next:string, ring:string }} t  - i18n strings
   * @param {'default'|'compact'|'wide'} size
   * @param {'auto'|'light'|'dark'} theme
   */
  function buildTemplate(t, size, theme) {
    const tmpl = document.createElement('template');
    tmpl.innerHTML = /* html */ `
<style>
  :host {
    display: inline-block;
    font-family: inherit;
    color-scheme: ${theme === 'auto' ? 'light dark' : theme};
  }
  .rz {
    display: inline-flex;
    align-items: center;
    gap: ${size === 'compact' ? '0.3em' : size === 'wide' ? '0.8em' : '0.5em'};
    font-size: ${size === 'compact' ? '0.78em' : size === 'wide' ? '0.95em' : '0.85em'};
    border: 1px solid light-dark(#d4d4d8, #3f3f46);
    border-radius: 4px;
    padding: ${size === 'compact' ? '2px 6px' : '4px 10px'};
    background: light-dark(#fafafa, #18181b);
    color: light-dark(#3f3f46, #a1a1aa);
    line-height: 1;
    white-space: nowrap;
    transition: border-color .15s;
  }
  .rz:focus-within { border-color: light-dark(#71717a, #71717a); outline: none; }
  .rz-label {
    font-size: 0.78em;
    letter-spacing: 0.05em;
    opacity: .55;
    user-select: none;
    ${size === 'compact' ? 'display:none;' : ''}
  }
  .rz-sep {
    opacity: .25;
    user-select: none;
    padding: 0 .1em;
  }
  button {
    all: unset;
    cursor: pointer;
    padding: ${size === 'compact' ? '1px 3px' : '2px 5px'};
    border-radius: 3px;
    color: light-dark(#52525b, #a1a1aa);
    transition: color .12s, background .12s;
  }
  button:hover:not(:disabled) {
    color: light-dark(#18181b, #f4f4f5);
    background: light-dark(rgba(0,0,0,.06), rgba(255,255,255,.08));
  }
  button:focus-visible {
    outline: 2px solid light-dark(#71717a, #71717a);
    outline-offset: 1px;
  }
  button:disabled { opacity: .35; cursor: default; }
  button.loading  { animation: rz-pulse 0.8s ease infinite alternate; }
  @keyframes rz-pulse { to { opacity: .4; } }
  .rz-err {
    font-size: .8em;
    color: light-dark(#ef4444, #f87171);
    padding: 0 .25em;
  }
</style>
<div class="rz" part="container" role="navigation" aria-label="${t.ring}">
  <span class="rz-label" aria-hidden="true">${t.ring}</span>
  <span class="rz-sep" aria-hidden="true">·</span>
  <button part="btn-prev" data-dir="p" aria-label="${t.prev}">${t.prev}</button>
  <span class="rz-sep" aria-hidden="true">·</span>
  <button part="btn-rand" data-dir="r" aria-label="${t.rand}">${t.rand}</button>
  <span class="rz-sep" aria-hidden="true">·</span>
  <button part="btn-next" data-dir="n" aria-label="${t.next}">${t.next}</button>
  <span class="rz-err" part="error" hidden></span>
</div>`;
    return tmpl;
  }

  // ─── Custom element ─────────────────────────────────────────────────────────

  class RhizomeSpore extends HTMLElement {
    #shadow   = null;
    #nodes    = null;   // cached live node list
    #loading  = false;

    static get observedAttributes() {
      return ['host', 'filter-tag', 'lang', 'size', 'theme'];
    }

    connectedCallback() {
      const lang  = this.getAttribute('lang')  || 'en';
      const size  = this.getAttribute('size')  || 'default';
      const theme = this.getAttribute('theme') || 'auto';
      const t     = I18N[lang] ?? I18N.en;

      this.#shadow = this.attachShadow({ mode: 'open' });
      this.#shadow.appendChild(buildTemplate(t, size, theme).content.cloneNode(true));

      this.#shadow.querySelectorAll('button[data-dir]').forEach(btn => {
        btn.addEventListener('click', () => this.#navigate(btn.dataset.dir));
      });
    }

    attributeChangedCallback() {
      // Re-render if attributes change after mount
      if (this.#shadow) {
        this.#shadow.innerHTML = '';
        this.connectedCallback();
        this.#nodes = null; // invalidate node cache
      }
    }

    async #navigate(dir) {
      if (this.#loading) return;
      this.#loading = true;

      const host      = this.getAttribute('host')?.replace(/\/+$/, '');
      const filterTag = this.getAttribute('filter-tag') ?? undefined;
      const btns      = this.#shadow.querySelectorAll('button');
      const errEl     = this.#shadow.querySelector('.rz-err');

      btns.forEach(b => { b.disabled = true; b.classList.add('loading'); });
      errEl.hidden = true;

      try {
        if (!this.#nodes) this.#nodes = await loadNodes(host, filterTag);
        if (!this.#nodes.length) throw new Error('empty ring');

        const i = this.#nodes.findIndex(n => uid(n.url) === uid(location.href.split('?')[0].replace(/\/$/, '')));
        let target;

        if (dir === 'r') {
          const buf = new Uint32Array(1);
          crypto.getRandomValues(buf);
          target = this.#nodes[buf[0] % this.#nodes.length];
        } else {
          target = this.#nodes[(i + (dir === 'p' ? -1 : 1) + this.#nodes.length) % this.#nodes.length];
        }

        location.href = `${host}/ring.html?f=${uid(location.href)}&d=${dir}${filterTag ? `&tag=${encodeURIComponent(filterTag)}` : ''}`;
      } catch {
        const lang = this.getAttribute('lang') || 'en';
        const t    = I18N[lang] ?? I18N.en;
        errEl.textContent = t.err;
        errEl.hidden      = false;
        this.#nodes       = null; // allow retry
      } finally {
        this.#loading = false;
        btns.forEach(b => { b.disabled = false; b.classList.remove('loading'); });
      }
    }
  }

  if (!customElements.get('rhizome-spore')) {
    customElements.define('rhizome-spore', RhizomeSpore);
  }
})();
