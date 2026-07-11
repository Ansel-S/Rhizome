#!/usr/bin/env node
/**
 * @fileoverview Rhizome Pruner v2
 *
 * Checks every node for liveness; marks unreachable ones dormant.
 * Uses two-phase HEAD→GET probing and optional embed verification.
 *
 * Flags:
 *   --verify-embed   Also check that the spore embed is still present
 *   --dry-run        Report changes but don't write nodes.json
 *   --concurrency N  Parallel probes (default: 20)
 *   --timeout N      Per-probe timeout in ms (default: 8000)
 *
 * Exit codes:
 *   0 — success (even if nodes changed)
 *   1 — fatal error (file I/O, invalid JSON, etc.)
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname }           from 'path';
import { fileURLToPath }              from 'url';
import { Semaphore }    from './lib/semaphore.js';
import { probe }        from './lib/probe.js';
import { verifyEmbed }  from './lib/verify.js';

// ─── CLI args ─────────────────────────────────────────────────────────────────

const argv   = process.argv.slice(2);
const flag   = name => argv.includes(name);
const option = (name, def) => {
  const i = argv.indexOf(name);
  return i !== -1 ? Number(argv[i + 1]) : def;
};

const DRY_RUN     = flag('--dry-run');
const VERIFY      = flag('--verify-embed');
const CONCURRENCY = option('--concurrency', 20);
const TIMEOUT     = option('--timeout', 8_000);

// ─── Paths ───────────────────────────────────────────────────────────────────

const __dir    = dirname(fileURLToPath(import.meta.url));
const NODES_PATH = resolve(__dir, '..', 'nodes.json');

// ─── Load nodes ───────────────────────────────────────────────────────────────

/** @type {import('../src/core.js').Node[]} */
let nodes;
try {
  nodes = JSON.parse(readFileSync(NODES_PATH, 'utf8'));
} catch (err) {
  console.error(`[prune] ❌ Failed to read nodes.json: ${err.message}`);
  process.exit(1);
}

// ─── Header ───────────────────────────────────────────────────────────────────

const flags = [
  `concurrency=${CONCURRENCY}`,
  `timeout=${TIMEOUT}ms`,
  VERIFY    && 'embed-verify',
  DRY_RUN   && 'dry-run',
].filter(Boolean).join(' · ');

console.log(`\n🌿  Rhizome Pruner v2    [${flags}]`);
console.log(`    ${nodes.length} nodes  ·  ${new Date().toISOString()}\n`);

// ─── Probe each node ─────────────────────────────────────────────────────────

const sem   = new Semaphore(CONCURRENCY);
const stats = { alive: 0, dormant: 0, revived: 0, changed: 0 };

/**
 * @param {import('../src/core.js').Node} node
 * @returns {Promise<import('../src/core.js').Node>}
 */
async function processNode(node) {
  const { alive, status } = await probe(node.url, { timeout: TIMEOUT });

  // If alive, optionally verify embed
  let embedOk = true;
  let embedReason;
  if (alive && VERIFY) {
    const r   = await verifyEmbed(node.url);
    embedOk   = r.verified;
    embedReason = r.reason;
  }

  const isHealthy  = alive && embedOk;
  const wasDormant = node.status === 'dormant';

  // ── State transitions ─────────────────────────────────────────────────────

  if (!isHealthy && !wasDormant) {
    // Active → dormant
    const why = !alive
      ? `unreachable (${status ?? 'no response'})`
      : `embed missing: ${embedReason}`;
    log('DORMANT', node.name, why, '🔴');
    stats.dormant++;
    stats.changed++;
    return { ...node, status: 'dormant' };
  }

  if (isHealthy && wasDormant) {
    // Dormant → revived
    log('REVIVED', node.name, `HTTP ${status}`, '🟢');
    stats.alive++;
    stats.revived++;
    stats.changed++;
    const { status: _removed, ...rest } = node; // drop dormant flag
    return rest;
  }

  // No change
  log(isHealthy ? 'ALIVE  ' : 'DORMANT', node.name, `HTTP ${status ?? '—'}`, isHealthy ? '✓' : '✗');
  isHealthy ? stats.alive++ : stats.dormant++;
  return node;
}

const updated = await sem.map(nodes, processNode);

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(56));
console.log(`  alive=${stats.alive}  dormant=${stats.dormant}  revived=${stats.revived}  changed=${stats.changed}`);

if (stats.changed === 0) {
  console.log('  ✅  All nodes unchanged.\n');
  process.exit(0);
}

// ─── Write ───────────────────────────────────────────────────────────────────

if (DRY_RUN) {
  console.log('  ℹ️   Dry-run: nodes.json not modified.\n');
  process.exit(0);
}

try {
  writeFileSync(NODES_PATH, JSON.stringify(updated, null, 4) + '\n');
  console.log(`  💾  nodes.json updated  (${stats.changed} change${stats.changed > 1 ? 's' : ''}).\n`);
} catch (err) {
  console.error(`  ❌  Write failed: ${err.message}\n`);
  process.exit(1);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * @param {string} state
 * @param {string} name
 * @param {string} detail
 * @param {string} icon
 */
function log(state, name, detail, icon) {
  console.log(`  ${icon}  ${state}  ${name.slice(0, 28).padEnd(28)}  ${detail}`);
}
