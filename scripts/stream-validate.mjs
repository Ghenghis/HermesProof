#!/usr/bin/env node
/**
 * stream-validate.mjs — STREAM/ message schema checker.
 *
 * Validates every message in CLAUDE_INBOX, CODEX_INBOX, LEDGER per the
 * PROTOCOL.md contract. Runs in pre-commit hook + CI gate.
 *
 * Foolproofing: zero deps (node stdlib only), idempotent, exits 0 if all
 * messages valid, exits 1 with detailed errors if any malformed.
 *
 * Usage:
 *   node scripts/stream-validate.mjs                  # validate both repos
 *   node scripts/stream-validate.mjs --repo=hermes3d  # validate one repo
 *   node scripts/stream-validate.mjs --fix            # auto-fix recoverable
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const VALID_TYPES = new Set([
  'CORRECTION_REQUEST', 'FIX_PUSHED', 'AUDIT_VERDICT', 'ENHANCEMENT_PROPOSAL',
  'GATE_GAP_FOUND', 'GATE_LANDED', 'TASK_CLAIMED', 'TASK_RELEASED',
  'STATE_UPDATE', 'HEARTBEAT', 'LGTM', 'BLOCKED', 'QUESTION', 'ANSWER',
  'ACK', 'REASSIGN_REQUEST',
]);

const VALID_STATUSES = new Set([
  'open', 'acknowledged', 'resolved', 'expired', 'stuck-reassigned',
]);

const VALID_ROLES = new Set([
  'BUILDER', 'CRITIC', 'SCRIBE', 'GATE-SMITH', 'DOC-KEEPER', 'WATCHDOG',
  'ANY', 'USER',
]);

const ID_RE = /^msg-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-\d{3}$/;

function findRepoRoot(start = process.cwd()) {
  let dir = start;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  return null;
}

function findStreamDirs() {
  // Discover both repos relative to one another. Caller may live in either.
  const here = findRepoRoot();
  const candidates = [];
  if (here) candidates.push(path.join(here, 'handoffs', 'STREAM'));
  // Sibling repos
  if (here) {
    const parent = path.dirname(here);
    for (const sib of fs.readdirSync(parent, { withFileTypes: true })) {
      if (!sib.isDirectory()) continue;
      const sp = path.join(parent, sib.name, 'handoffs', 'STREAM');
      if (fs.existsSync(sp)) candidates.push(sp);
    }
  }
  return [...new Set(candidates)];
}

function parseMessages(text) {
  // Split on H2 headers `## msg-...`
  const blocks = [];
  const lines = text.split(/\r?\n/);
  let cur = null;
  for (const line of lines) {
    if (/^## msg-/.test(line)) {
      if (cur) blocks.push(cur);
      cur = { header: line, lines: [line] };
    } else if (cur) {
      cur.lines.push(line);
    }
  }
  if (cur) blocks.push(cur);
  return blocks;
}

function parseHeader(block) {
  const m = block.header.match(/^## (msg-[^\s]+)\s+—\s+(\S+)\s+—\s+(.+)$/);
  if (!m) return { error: `Header malformed: ${block.header}` };
  const [, id, type, slug] = m;
  const fields = {};
  for (const line of block.lines.slice(1)) {
    if (/^## /.test(line)) break;
    const fm = line.match(/^- (\w[\w-]*):\s*(.*)$/);
    if (fm) fields[fm[1]] = fm[2].trim();
    if (/^[A-Za-z0-9]/.test(line) && !line.startsWith('-')) break; // body started
  }
  return { id, type, slug, fields };
}

function validateMessage(msg, file) {
  const errors = [];
  const { id, type, fields } = msg;
  if (!ID_RE.test(id)) errors.push(`bad id format: ${id}`);
  if (!VALID_TYPES.has(type)) errors.push(`unknown type: ${type}`);
  if (!fields.from) errors.push('missing from:');
  else if (!VALID_ROLES.has(fields.from.split(/[\s(]/)[0])) {
    // Allow parenthetical role-instance suffix e.g. "BUILDER (claude-impl-#1)"
    errors.push(`unknown from role: ${fields.from}`);
  }
  if (!fields.to) errors.push('missing to:');
  else if (!VALID_ROLES.has(fields.to.split(/[\s(]/)[0])) {
    errors.push(`unknown to role: ${fields.to}`);
  }
  if (!fields.status) errors.push('missing status:');
  else if (!VALID_STATUSES.has(fields.status)) errors.push(`unknown status: ${fields.status}`);
  if (!fields.correlation) errors.push('missing correlation:');
  return errors.length ? { id, file, errors } : null;
}

function main() {
  const args = process.argv.slice(2);
  const fix = args.includes('--fix');
  const repoFilter = (args.find((a) => a.startsWith('--repo=')) || '').slice('--repo='.length);

  const dirs = findStreamDirs();
  let totalMessages = 0;
  let totalErrors = 0;
  const allErrors = [];

  for (const dir of dirs) {
    if (repoFilter && !dir.includes(repoFilter)) continue;
    const inboxFiles = ['CLAUDE_INBOX.md', 'CODEX_INBOX.md', 'LEDGER.md'];
    for (const fname of inboxFiles) {
      const f = path.join(dir, fname);
      if (!fs.existsSync(f)) continue;
      const text = fs.readFileSync(f, 'utf8');
      const blocks = parseMessages(text);
      for (const b of blocks) {
        const parsed = parseHeader(b);
        if (parsed.error) {
          totalErrors++;
          allErrors.push({ file: f, errors: [parsed.error] });
          continue;
        }
        totalMessages++;
        const err = validateMessage(parsed, f);
        if (err) {
          totalErrors++;
          allErrors.push(err);
        }
      }
    }
  }

  if (totalErrors === 0) {
    console.log(`stream-validate: ${totalMessages} messages OK across ${dirs.length} STREAM dirs`);
    process.exit(0);
  }
  console.error(`stream-validate: ${totalErrors} error(s) in ${totalMessages} messages`);
  for (const e of allErrors) {
    console.error(`  ${e.file}${e.id ? ` :: ${e.id}` : ''}`);
    for (const msg of e.errors) console.error(`    - ${msg}`);
  }
  process.exit(fix ? 0 : 1);
}

main();
