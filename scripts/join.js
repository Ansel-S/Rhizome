#!/usr/bin/env node
/**
 * @fileoverview Rhizome Auto-Join Processor
 *
 * Called by the join.yml GitHub Actions workflow when an issue
 * labelled "join" is created. Validates the submission, verifies
 * the spore embed, and appends the new node to nodes.json.
 *
 * Flags (all required unless noted):
 *   --name   "Display Name"
 *   --url    "https://example.com"
 *   --bio    "Short site description"
 *   --tags   "dev,blog,art"          (optional, comma-separated)
 *   --host   "https://host.github.io/Rhizome"  (optional, for embed host verification)
 *
 * Outputs (written to GITHUB_OUTPUT):
 *   success     true | false
 *   node_name   Added node name
 *   node_url    Added node URL
 *   error       Failure reason (only on failure)
 *
 * Exit codes:
 *   0 — success
 *   1 — validation / network failure
 */

import { readFileSync, writeFileSync, appendFileSync } from 'fs';
import { resolve, dirname }    from 'path';
import { fileURLToPath }       from 'url';
import { probe }               from './lib/probe.js';
import { verifyEmbed }         from './lib/verify.js';

// ─── Paths ───────────────────────────────────────────────────────────────────

const __dir      = dirname(fileURLToPath(import.meta.url));
const NODES_PATH = resolve(__dir, '..', 'nodes.json');

// ─── Parse CLI args ──────────────────────────────────────────────────────────

/**
 * @param {string[]} argv
 * @returns {Record<string, string>}
 */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1] ?? '';
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const name = args.name?.trim();
const url  = normalizeUrl(args.url?.trim() ?? '');
const bio  = args.bio?.trim().slice(0, 200);
const tags = args.tags
  ? args.tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
  : [];
const hostHint = args.host?.trim() || undefined;

// ─── Validation ──────────────────────────────────────────────────────────────

if (!name)         fail('--name is required');
if (!url)          fail('--url is required');
if (!bio)          fail('--bio is required');
if (!isHttps(url)) fail('URL must use https://');
if (name.length > 64)  fail('name must be ≤ 64 characters');
if (bio.length  > 200) fail('bio must be ≤ 200 characters');

// ─── Load existing nodes ─────────────────────────────────────────────────────

/** @type {import('../src/core.js').Node[]} */
let existing;
try {
  existing = JSON.parse(readFileSync(NODES_PATH, 'utf8'));
} catch (err) {
  fail(`Could not read nodes.json: ${err.message}`);
}

// Duplicate check
const dupe = existing.find(n => normalizeUrl(n.url) === url);
if (dupe) fail(`URL already registered as "${dupe.name}"`);

// ─── Health probe ─────────────────────────────────────────────────────────────

console.log(`\n🌿  Rhizome Auto-Join\n`);
console.log(`  Site : ${name}`);
console.log(`  URL  : ${url}`);
console.log(`  Bio  : ${bio}`);
if (tags.length) console.log(`  Tags : ${tags.join(', ')}`);
console.log();

process.stdout.write('  🔍  Probing URL… ');
const { alive, status } = await probe(url, { timeout: 12_000, retries: 1 });
if (!alive) {
  console.log('❌');
  fail(`Site is unreachable — check the URL is live and returns a 2xx response`);
}
console.log(`✓ (HTTP ${status})`);

// ─── Embed verification ───────────────────────────────────────────────────────

process.stdout.write('  🔍  Verifying spore embed… ');
const { verified, reason, foundTag } = await verifyEmbed(url, hostHint);
if (!verified) {
  console.log('❌');
  fail(
    `Spore embed not found: ${reason}\n` +
    `  Make sure you have installed the <rhizome-spore> widget before requesting to join.`
  );
}
console.log(`✓ (${foundTag})`);

// ─── Append node ─────────────────────────────────────────────────────────────

/** @type {import('../src/core.js').Node} */
const node = {
  name,
  url,
  bio,
  ...(tags.length && { tags }),
  joined: new Date().toISOString().slice(0, 10),
};

const updated = [...existing, node];

try {
  writeFileSync(NODES_PATH, JSON.stringify(updated, null, 4) + '\n');
} catch (err) {
  fail(`Could not write nodes.json: ${err.message}`);
}

// ─── Success ─────────────────────────────────────────────────────────────────

console.log(`\n  ✅  Added "${name}" to the network!\n`);
setOutput('success',   'true');
setOutput('node_name', name);
setOutput('node_url',  url);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** @param {string} msg */
function fail(msg) {
  console.error(`\n  ❌  ${msg}\n`);
  setOutput('success', 'false');
  setOutput('error',   msg);
  process.exit(1);
}

/** @param {string} u */
function normalizeUrl(u) {
  return u.replace(/\/+$/, '');
}

/** @param {string} u */
function isHttps(u) {
  try { return new URL(u).protocol === 'https:'; }
  catch { return false; }
}

/**
 * Write a GitHub Actions output variable.
 * @param {string} key
 * @param {string} val
 */
function setOutput(key, val) {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${val}\n`);
  } else {
    // Local dev fallback
    console.log(`  [output] ${key}=${val}`);
  }
}
