#!/usr/bin/env node
/**
 * stream-backup.mjs — STREAM/ snapshot rotator.
 *
 * Copies all *.md in handoffs/STREAM/ to handoffs/STREAM/backups/<UTC-iso>/
 * and prunes snapshots older than 7 days.
 *
 * Foolproof: idempotent, zero deps, works offline.
 */

import fs from 'node:fs';
import path from 'node:path';

const NOW = new Date();
const RETENTION_DAYS = 7;

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

function snapshotDir(dir) {
  const stamp = NOW.toISOString().replace(/:/g, '-').replace(/\..*/, 'Z');
  const target = path.join(dir, 'backups', stamp);
  fs.mkdirSync(target, { recursive: true });
  let count = 0;
  for (const f of fs.readdirSync(dir)) {
    const src = path.join(dir, f);
    const stat = fs.statSync(src);
    if (stat.isFile() && f.endsWith('.md')) {
      fs.copyFileSync(src, path.join(target, f));
      count++;
    }
  }
  return { target, count };
}

function pruneOld(dir) {
  const backupRoot = path.join(dir, 'backups');
  if (!fs.existsSync(backupRoot)) return 0;
  let pruned = 0;
  const cutoff = NOW.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  for (const sub of fs.readdirSync(backupRoot)) {
    const full = path.join(backupRoot, sub);
    const stat = fs.statSync(full);
    if (stat.isDirectory() && stat.mtime.getTime() < cutoff) {
      fs.rmSync(full, { recursive: true, force: true });
      pruned++;
    }
  }
  return pruned;
}

function main() {
  for (const dir of findStreamDirs()) {
    const { target, count } = snapshotDir(dir);
    const pruned = pruneOld(dir);
    console.log(`backup [${dir}]: ${count} files → ${target}; pruned ${pruned} old snapshots`);
  }
}

main();
