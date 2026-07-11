/**
 * @fileoverview Spore embed verifier
 *
 * Fetches a site's homepage and confirms that:
 *   1. The page is reachable
 *   2. It contains a <rhizome-spore> custom element (or spore.js script tag)
 *   3. Optionally: the spore's `host` attribute points back to this registry
 *
 * Used by: scripts/prune.js (--verify-embed), scripts/join.js
 */

const TIMEOUT = 12_000;
const UA      = 'Rhizome-Verifier/2.0 (+https://github.com/ansel-s/Rhizome)';

/**
 * @typedef {object} VerifyResult
 * @property {boolean} verified
 * @property {string=} reason    - Human-readable failure reason
 * @property {string=} foundTag  - The matched tag/pattern, for debugging
 */

/**
 * Verify that `url` has the Rhizome spore embed installed.
 *
 * @param {string}  url          - Member site homepage URL
 * @param {string}  [hostHint]   - Expected `host` attribute value (optional)
 * @returns {Promise<VerifyResult>}
 */
export async function verifyEmbed(url, hostHint) {
  const ctrl = new AbortController();
  const t    = setTimeout(() => ctrl.abort(), TIMEOUT);

  try {
    const res = await fetch(url, {
      signal:  ctrl.signal,
      headers: { 'User-Agent': UA, Accept: 'text/html' },
    });
    clearTimeout(t);

    if (!res.ok) {
      return { verified: false, reason: `HTTP ${res.status}` };
    }

    const html = await res.text();
    return checkHtml(html, hostHint);

  } catch (err) {
    clearTimeout(t);
    return { verified: false, reason: err.message };
  }
}

/**
 * Check HTML string for spore embed markers.
 *
 * Accepts any of:
 *   <rhizome-spore …>
 *   <script … src="…spore.js">
 *   data-rhizome attribute on any element
 *
 * @param {string}  html
 * @param {string=} hostHint
 * @returns {VerifyResult}
 */
function checkHtml(html, hostHint) {
  const patterns = [
    { re: /<rhizome-spore/i,        tag: '<rhizome-spore>' },
    { re: /src=["'][^"']*spore\.js/i, tag: 'spore.js script' },
    { re: /data-rhizome/i,           tag: 'data-rhizome attr' },
  ];

  for (const { re, tag } of patterns) {
    if (!re.test(html)) continue;

    // Optional: confirm host attribute matches registry
    if (hostHint) {
      const hostRe = new RegExp(`host=["']${escapeRe(hostHint)}["']`, 'i');
      if (!hostRe.test(html)) {
        return {
          verified: false,
          reason:   `Found embed but host mismatch (expected "${hostHint}")`,
          foundTag: tag,
        };
      }
    }

    return { verified: true, foundTag: tag };
  }

  return { verified: false, reason: 'No spore embed found in page HTML' };
}

/** @param {string} s */
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
