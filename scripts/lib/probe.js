/**
 * @fileoverview HTTP health probe — two-phase (HEAD → GET) with retry
 *
 * Strategy:
 *   1. Try HEAD — fast, no body download
 *   2. On connection error or 5xx, retry with GET (some servers disallow HEAD)
 *   3. Each phase retries up to RETRIES times with exponential backoff
 *   4. 1xx–4xx from GET are treated as "alive" (site is responding)
 *   5. Only network failure / timeout on both phases → dead
 */

const TIMEOUT  = 8_000;           // ms per attempt
const RETRIES  = 2;               // extra attempts after first failure
const BACKOFF  = [1_000, 3_000];  // ms delays between retries
const UA       = 'Rhizome-Pruner/2.0 (+https://github.com/ansel-s/Rhizome)';

/**
 * @typedef {object} ProbeResult
 * @property {boolean} alive
 * @property {number=} status    - HTTP status code (if response received)
 * @property {'HEAD'|'GET'=} method - Phase that succeeded
 * @property {string=}  error   - Error message if dead
 */

/**
 * Two-phase health check for a URL.
 *
 * @param {string}  url
 * @param {object}  [opts]
 * @param {number}  [opts.timeout=8000]  - Per-attempt timeout in ms
 * @param {number}  [opts.retries=2]     - Extra attempts per phase
 * @returns {Promise<ProbeResult>}
 */
export async function probe(url, { timeout = TIMEOUT, retries = RETRIES } = {}) {
  for (const method of /** @type {('HEAD'|'GET')[]} */ (['HEAD', 'GET'])) {
    const result = await attempt(url, method, timeout, retries);
    if (result.alive) return result;
    // HEAD failed — fall through to GET before declaring dead
    if (method === 'HEAD') continue;
    return result; // GET also failed → dead
  }
  /* istanbul ignore next */
  return { alive: false, error: 'unreachable' };
}

/**
 * @param {string}       url
 * @param {'HEAD'|'GET'} method
 * @param {number}       timeout
 * @param {number}       maxRetries
 * @returns {Promise<ProbeResult>}
 */
async function attempt(url, method, timeout, maxRetries) {
  let lastErr;

  for (let i = 0; i <= maxRetries; i++) {
    if (i > 0) await sleep(BACKOFF[i - 1] ?? BACKOFF.at(-1));

    const ctrl = new AbortController();
    const t    = setTimeout(() => ctrl.abort(new Error('timeout')), timeout);

    try {
      const res = await fetch(url, {
        method,
        redirect: 'follow',
        signal:   ctrl.signal,
        headers:  { 'User-Agent': UA },
      });
      clearTimeout(t);

      // 5xx → server is up but broken; still retry on HEAD, accept on GET
      if (res.status >= 500 && method === 'HEAD') {
        lastErr = new Error(`HTTP ${res.status}`);
        continue;
      }
      return { alive: true, status: res.status, method };

    } catch (err) {
      clearTimeout(t);
      lastErr = err;
      // Abort (timeout) → retry. Other errors (DNS, TLS) → break to next phase
      if (err.name !== 'AbortError') break;
    }
  }

  return { alive: false, error: lastErr?.message ?? 'unknown' };
}

/** @param {number} ms */
const sleep = ms => new Promise(r => setTimeout(r, ms));
