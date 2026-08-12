#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { statePaths } from "../src/core/fs-utils.mjs";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--workspace") out.workspace = argv[++i];
    else if (arg === "--before") out.before = argv[++i];
    else if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
  }
  return out;
}

export async function pruneEvents({ workspace = process.cwd(), before, dryRun = false } = {}) {
  if (!before) throw new Error("--before <iso> is required");
  const cutoff = new Date(before);
  if (Number.isNaN(cutoff.getTime())) throw new Error("--before must be an ISO timestamp");
  const paths = statePaths(path.resolve(workspace));
  const files = await fs.readdir(paths.eventsHandledDir).catch(() => []);
  const removed = [];
  const kept = [];
  for (const file of files.filter((name) => name.endsWith(".json")).sort()) {
    const full = path.join(paths.eventsHandledDir, file);
    let event;
    try {
      event = JSON.parse(await fs.readFile(full, "utf8"));
    } catch {
      kept.push(file);
      continue;
    }
    const created = new Date(event.created_utc || 0);
    if (!Number.isNaN(created.getTime()) && created < cutoff) {
      removed.push(file);
      if (!dryRun) await fs.rm(full, { force: true });
    } else {
      kept.push(file);
    }
  }
  return {
    ok: true,
    dry_run: dryRun,
    cutoff_utc: cutoff.toISOString(),
    before: cutoff.toISOString(),
    deleted: removed,
    removed,
    kept,
    failed_pruned: false,
    failed_dir_touched: false
  };
}

export const pruneHandledEvents = pruneEvents;

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node scripts/prune-events.mjs --before <iso> [--workspace <path>] [--dry-run]");
    process.exit(0);
  }
  try {
    const result = await pruneEvents(args);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
    process.exit(1);
  }
}
