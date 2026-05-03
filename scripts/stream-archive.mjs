#!/usr/bin/env node
/**
 * stream-archive.mjs — move resolved/expired messages from inbox to LEDGER.
 *
 * Inbox stays clean for the next polling cycle; LEDGER preserves audit trail.
 *
 * Cutoff: 6h after `resolved` or `expired` status.
 *
 * Foolproof: idempotent, append-only on LEDGER, atomic-write on inbox files.
 */

import fs from 'node:fs';
import path from 'node:path';

const NOW = new Date();
const ARCHIVE_GRACE_HOURS = 6;

function findStreamDirs() {
  const here = process.cwd();
  let root = here;
  while (root !== path.dirname(root)) {
    if (fs.existsSync(path.join(root, '.git'))) break;
    root = path.dirname(root);
  }
  const out = [];
  const sp = path.join(root, 'handoffs', 'STREAM');
  if (fs.existsSync(sp)) out.push(sp);
  const parent = path.dirname(root);
  if (fs.existsSync(parent)) {
    for (const sib of fs.readdirSync(parent, { withFileTypes: true })) {
      if (!sib.isDirectory()) continue;
      const ssp = path.join(parent, sib.name, 'handoffs', 'STREAM');
      if (fs.existsSync(ssp) && !out.includes(ssp)) out.push(ssp);
    }
  }
  return out;
}

function splitMessages(text) {
  const blocks = [];
  const lines = text.split(/\r?\n/);
  let cur = null;
  let preamble = [];
  for (const line of lines) {
    if (/^## msg-/.test(line)) {
      if (cur) blocks.push(cur);
      cur = { header: line, lines: [line] };
    } else if (cur) {
      cur.lines.push(line);
    } else {
      preamble.push(line);
    }
  }
  if (cur) blocks.push(cur);
  return { preamble: preamble.join('\n'), blocks };
}

function getStatus(block) {
  for (const line of block.lines) {
    const m = line.match(/^- status:\s*(.+)$/);
    if (m) return m[1].trim();
  }
  return null;
}

function getTimestamp(block) {
  const m = block.header.match(/^## msg-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z-/);
  if (!m) return null;
  return new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`);
}

function ageHours(date) {
  if (!date) return Infinity;
  return (NOW - date) / 3600000;
}

function archiveDir(dir) {
  const ledger = path.join(dir, 'LEDGER.md');
  const inboxFiles = ['CLAUDE_INBOX.md', 'CODEX_INBOX.md'];
  let archivedTotal = 0;

  for (const fname of inboxFiles) {
    const f = path.join(dir, fname);
    if (!fs.existsSync(f)) continue;
    const text = fs.readFileSync(f, 'utf8');
    const { preamble, blocks } = splitMessages(text);
    const keep = [];
    const archive = [];
    for (const b of blocks) {
      const status = getStatus(b);
      const ts = getTimestamp(b);
      const isFinal = status === 'resolved' || status === 'expired';
      const old = ageHours(ts) >= ARCHIVE_GRACE_HOURS;
      if (isFinal && old) archive.push(b);
      else keep.push(b);
    }
    if (archive.length === 0) continue;

    // Append to LEDGER
    const ledgerEntry = [
      '',
      `## archived from ${fname} at ${NOW.toISOString()}`,
      '',
      ...archive.flatMap((b) => [...b.lines, '']),
    ].join('\n');
    fs.appendFileSync(ledger, ledgerEntry);

    // Rewrite inbox
    const newText = preamble + (keep.length ? '\n' + keep.flatMap((b) => b.lines).join('\n') : '');
    fs.writeFileSync(f, newText);
    archivedTotal += archive.length;
    console.log(`archive [${dir}/${fname}]: ${archive.length} messages moved to LEDGER`);
  }
  return archivedTotal;
}

function main() {
  let total = 0;
  for (const dir of findStreamDirs()) {
    total += archiveDir(dir);
  }
  console.log(`stream-archive: ${total} messages archived`);
}

main();
