#!/usr/bin/env node
/**
 * @fileoverview Rhizome Feed Aggregator
 *
 * 1. Reads all active nodes from nodes.json
 * 2. Discovers each site's RSS/Atom feed (via <link> tag or node.feed field)
 * 3. Fetches and parses the feeds (RSS 2.0 and Atom 1.0)
 * 4. Merges, sorts, deduplicates, and trims to MAX_ITEMS
 * 5. Writes aggregated feed.xml to the project root
 *
 * Flags:
 *   --max N        Max items in output feed (default: 24)
 *   --concurrency  Parallel fetches (default: 10)
 *   --dry-run      Print feed XML to stdout, don't write file
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname }           from 'path';
import { fileURLToPath }              from 'url';
import { Semaphore }                  from './lib/semaphore.js';

// ─── Config ───────────────────────────────────────────────────────────────────

const __dir      = dirname(fileURLToPath(import.meta.url));
const NODES_PATH = resolve(__dir, '..', 'nodes.json');
const FEED_PATH  = resolve(__dir, '..', 'feed.xml');

const argv   = process.argv.slice(2);
const option = (name, def) => { const i = argv.indexOf(name); return i !== -1 ? Number(argv[i + 1]) : def; };
const DRY_RUN     = argv.includes('--dry-run');
const MAX_ITEMS   = option('--max', 24);
const CONCURRENCY = option('--concurrency', 10);
const TIMEOUT     = 10_000;
const UA          = 'Rhizome-Feed/2.0 (+https://github.com/ansel-s/Rhizome)';

// ─── Load nodes ───────────────────────────────────────────────────────────────

/** @type {import('../src/core.js').Node[]} */
const all   = JSON.parse(readFileSync(NODES_PATH, 'utf8'));
const nodes = all.filter(n => n.status !== 'dormant');

console.log(`\n🌿  Rhizome Feed Builder    [${nodes.length} active nodes · max=${MAX_ITEMS}]\n`);

// ─── Feed discovery ───────────────────────────────────────────────────────────

/**
 * Discover RSS/Atom feed URL from a homepage.
 * Looks for <link rel="alternate" type="application/rss+xml"> etc.
 *
 * @param {string} siteUrl
 * @returns {Promise<string|null>}
 */
async function discoverFeed(siteUrl) {
  const ctrl = new AbortController();
  const t    = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(siteUrl, {
      signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'text/html' }
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const html = await res.text();
    // Match both attribute orders: type before href and href before type
    const m =
      html.match(/<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]+href=["']([^"']+)["']/i) ??
      html.match(/<link[^>]+href=["']([^"']+)["'][^>]+type=["']application\/(?:rss|atom)\+xml["']/i);
    if (!m) return null;
    return new URL(m[1], siteUrl).href;
  } catch { clearTimeout(t); return null; }
}

// ─── Feed parsing ─────────────────────────────────────────────────────────────

/**
 * @typedef {object} FeedItem
 * @property {string} title
 * @property {string} link
 * @property {Date}   date
 * @property {string} author
 * @property {string} authorUrl
 * @property {string=} description
 */

/**
 * Minimal RSS 2.0 / Atom 1.0 parser.
 * No XML parser dependency — regex is sufficient for well-formed feeds.
 *
 * @param {string} xml
 * @param {string} feedUrl  - Used to resolve relative links
 * @returns {FeedItem[]}
 */
function parseFeed(xml, feedUrl) {
  const isAtom  = /<feed[^>]*xmlns/i.test(xml);
  const itemTag = isAtom ? '<entry' : '<item';
  const chunks  = xml.split(itemTag).slice(1);

  return chunks.slice(0, 5).reduce((acc, chunk) => {
    const title = cdata(chunk, 'title') ?? text(chunk, 'title');
    const link  = isAtom
      ? (chunk.match(/<link[^>]+href=["']([^"']+)["']/)?.[1])
      : (cdata(chunk, 'link') ?? text(chunk, 'link'));
    const date  = text(chunk, isAtom ? 'updated' : 'pubDate')
               ?? text(chunk, 'dc:date');
    const desc  = cdata(chunk, isAtom ? 'content' : 'description')
               ?? text(chunk, isAtom ? 'summary' : 'description');

    if (title && link) {
      acc.push({
        title: title.trim(),
        link:  new URL(link.trim(), feedUrl).href,
        date:  date ? new Date(date) : new Date(0),
        description: desc?.slice(0, 320).trim(),
        author:    '', // filled by caller
        authorUrl: '',
      });
    }
    return acc;
  }, /** @type {FeedItem[]} */ ([]));
}

/** Extract CDATA content of a tag */
function cdata(xml, tag) {
  return xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, 'i'))?.[1] ?? null;
}

/** Extract text content of a tag */
function text(xml, tag) {
  return xml.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`, 'i'))?.[1]?.trim() ?? null;
}

// ─── Fetch one node's feed ────────────────────────────────────────────────────

/**
 * @param {import('../src/core.js').Node} node
 * @returns {Promise<FeedItem[]>}
 */
async function fetchNodeFeed(node) {
  // Use explicit feed URL or discover from homepage
  let feedUrl = node.feed ?? await discoverFeed(node.url);
  if (!feedUrl) { console.log(`  –   ${node.name.padEnd(30)}  (no feed detected)`); return []; }

  const ctrl = new AbortController();
  const t    = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(feedUrl, {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, text/xml' }
    });
    clearTimeout(t);
    if (!res.ok) { console.log(`  ✗   ${node.name.padEnd(30)}  HTTP ${res.status}`); return []; }

    const xml   = await res.text();
    const items = parseFeed(xml, feedUrl).map(item => ({
      ...item, author: node.name, authorUrl: node.url,
    }));
    console.log(`  ✓   ${node.name.padEnd(30)}  ${items.length} item${items.length !== 1 ? 's' : ''}`);
    return items;
  } catch (err) {
    clearTimeout(t);
    console.log(`  ✗   ${node.name.padEnd(30)}  ${err.message}`);
    return [];
  }
}

// ─── Collect all items ────────────────────────────────────────────────────────

const sem  = new Semaphore(CONCURRENCY);
const sets = await sem.map(nodes, fetchNodeFeed);

const items = sets
  .flat()
  .sort((a, b) => b.date - a.date)    // newest first
  .filter((item, i, arr) =>           // deduplicate by link
    arr.findIndex(x => x.link === item.link) === i
  )
  .slice(0, MAX_ITEMS);

console.log(`\n  ${items.length} item${items.length !== 1 ? 's' : ''} collected across ${nodes.length} nodes`);

// ─── Render RSS 2.0 ───────────────────────────────────────────────────────────

const now  = new Date();
const SELF = 'https://ansel-s.github.io/Rhizome/feed.xml'; // update per fork

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:atom="http://www.w3.org/2005/Atom"
  xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Rhizome Network</title>
    <description>Aggregated posts from Rhizome member sites</description>
    <link>https://ansel-s.github.io/Rhizome/</link>
    <atom:link href="${SELF}" rel="self" type="application/rss+xml"/>
    <language>en</language>
    <lastBuildDate>${now.toUTCString()}</lastBuildDate>
    <generator>Rhizome Feed Builder v2</generator>
    <ttl>720</ttl>
${items.map(item => `    <item>
      <title><![CDATA[${item.title}]]></title>
      <link>${x(item.link)}</link>
      <guid isPermaLink="true">${x(item.link)}</guid>
      <dc:creator><![CDATA[${item.author}]]></dc:creator>
      ${item.date.getTime() ? `<pubDate>${item.date.toUTCString()}</pubDate>` : ''}
      ${item.description ? `<description><![CDATA[${item.description}]]></description>` : ''}
    </item>`).join('\n')}
  </channel>
</rss>`;

// ─── Write ───────────────────────────────────────────────────────────────────

if (DRY_RUN) {
  console.log('\n' + xml);
} else {
  writeFileSync(FEED_PATH, xml);
  console.log(`  💾  feed.xml written  (${items.length} items, ${Buffer.byteLength(xml)} bytes)\n`);
}

/** XML-escape a string */
function x(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
