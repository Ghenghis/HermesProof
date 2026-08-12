import fs from "node:fs/promises";
import path from "node:path";

const STORAGE_CENSUS_SCHEMA = "hermesproof.storage-census.v1";
const STORAGE_CENSUS_CONTRACT_VERSION = "hermesproof.storage-census.2026-07-10";

function text(value) {
  return String(value ?? "").trim();
}

function inside(value, root) {
  const file = path.resolve(value);
  const base = path.resolve(root);
  return file === base || file.startsWith(`${base}${path.sep}`);
}

function classify(root, value) {
  const name = `${root}${path.sep}${value}`.toLowerCase();
  if (/(^|[\\/])(?:\.env|private)(?:[\\/]|$)|\.env(?:\.|$)/.test(name)) return "protected";
  if (/(^|[\\/])(?:test-results|proof|release-archive)(?:[\\/]|$)|\.vsix$/.test(name)) return "proof";
  if (/(^|[\\/])(?:node_modules|\.bun|cache)(?:[\\/]|$)/.test(name)) return "dependency";
  if (/(^|[\\/])(?:__pycache__|\.pytest_cache)(?:[\\/]|$)/.test(name)) return "quarantine";
  if (/(^|[\\/])(?:temp|tmp|out|dist|build)(?:[\\/]|$)|\.(?:tmp|log|dmp)$/i.test(name)) return "temporary";
  return "unknown";
}

function retention(kind) {
  if (kind === "proof" || kind === "protected") return "retain";
  if (kind === "quarantine") return "quarantine";
  return "review";
}

function age(value, now) {
  const days = Math.max(0, Math.floor((now - value) / 86_400_000));
  if (days < 1) return "today";
  if (days < 7) return "1-6d";
  if (days < 30) return "7-29d";
  return "30d+";
}

function group(root, file, depth) {
  const parts = path.relative(root, file).split(path.sep).filter(Boolean);
  return parts.slice(0, Math.max(1, depth)).join("/") || ".";
}

function add(groups, root, file, stat, depth, now) {
  const id = group(root, file, depth);
  const kind = classify(root, path.relative(root, file));
  const item = groups.get(id) || {
    path: id,
    files: 0,
    bytes: 0,
    newestUtc: null,
    oldestUtc: null,
    classifications: new Set(),
    retention: new Set(),
    ageBands: new Map(),
  };
  item.files += 1;
  item.bytes += stat.size;
  item.newestUtc = !item.newestUtc || stat.mtimeMs > Date.parse(item.newestUtc) ? new Date(stat.mtimeMs).toISOString() : item.newestUtc;
  item.oldestUtc = !item.oldestUtc || stat.mtimeMs < Date.parse(item.oldestUtc) ? new Date(stat.mtimeMs).toISOString() : item.oldestUtc;
  item.classifications.add(kind);
  item.retention.add(retention(kind));
  const band = age(stat.mtimeMs, now);
  item.ageBands.set(band, (item.ageBands.get(band) || 0) + stat.size);
  groups.set(id, item);
}

function compact(groups) {
  return [...groups.values()]
    .map((item) => ({
      path: item.path,
      files: item.files,
      bytes: item.bytes,
      newestUtc: item.newestUtc,
      oldestUtc: item.oldestUtc,
      classifications: [...item.classifications].sort(),
      retention: [...item.retention].sort(),
      ageBands: Object.fromEntries(item.ageBands),
    }))
    .sort((left, right) => right.bytes - left.bytes || left.path.localeCompare(right.path));
}

async function scan(root, options) {
  const groups = new Map();
  const findings = [];
  const stack = [{ dir: root, depth: 0 }];
  const state = { files: 0, bytes: 0, stopped: false };
  while (stack.length > 0 && !state.stopped) {
    const current = stack.pop();
    if (!current) continue;
    const entries = await fs.readdir(current.dir, { withFileTypes: true }).catch((err) => {
      findings.push(`unreadable:${path.relative(root, current.dir) || "."}:${err.code || "unknown"}`);
      return null;
    });
    if (!entries) continue;
    for (const entry of entries) {
      if (state.files >= options.maxFiles) {
        state.stopped = true;
        findings.push("file_limit_reached");
        break;
      }
      const file = path.join(current.dir, entry.name);
      if (entry.isDirectory()) {
        if (current.depth < options.maxDepth) stack.push({ dir: file, depth: current.depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const stat = await fs.stat(file);
        state.files += 1;
        state.bytes += stat.size;
        add(groups, root, file, stat, options.groupDepth, options.nowMs);
      } catch (err) {
        findings.push(`unstatable:${path.relative(root, file)}:${err.code || "unknown"}`);
      }
    }
  }
  const entries = compact(groups);
  const kinds = new Set(entries.flatMap((item) => item.classifications));
  return {
    root,
    complete: findings.length === 0,
    files: state.files,
    bytes: state.bytes,
    findings,
    classifications: [...kinds].sort(),
    groups: entries,
  };
}

export async function evaluateStorageCensus(input = {}) {
  const allowedRoots = Array.isArray(input.allowedRoots) ? input.allowedRoots.map(text).filter(Boolean).map((root) => path.resolve(root)) : [];
  const roots = Array.isArray(input.roots) ? input.roots.map(text).filter(Boolean).map((root) => path.resolve(root)) : [];
  const options = {
    maxFiles: Number.isFinite(Number(input.maxFiles)) ? Math.max(1, Math.min(100_000, Number(input.maxFiles))) : 10_000,
    maxDepth: Number.isFinite(Number(input.maxDepth)) ? Math.max(0, Math.min(32, Number(input.maxDepth))) : 8,
    groupDepth: Number.isFinite(Number(input.groupDepth)) ? Math.max(1, Math.min(8, Number(input.groupDepth))) : 1,
    nowMs: Number.isFinite(Number(input.nowMs)) ? Number(input.nowMs) : Date.now(),
  };
  const findings = [];
  if (text(input.schema) !== STORAGE_CENSUS_SCHEMA) findings.push("schema_invalid");
  if (text(input.contractVersion) !== STORAGE_CENSUS_CONTRACT_VERSION) findings.push("contract_version_mismatch");
  if (roots.length === 0) findings.push("roots_missing");
  if (allowedRoots.length === 0) findings.push("allowed_roots_missing");
  const reports = [];
  for (const root of roots) {
    if (!allowedRoots.some((allowed) => inside(root, allowed))) {
      findings.push(`root_outside_allowlist:${root}`);
      continue;
    }
    try {
      const stat = await fs.stat(root);
      if (!stat.isDirectory()) {
        findings.push(`root_not_directory:${root}`);
        continue;
      }
    } catch (err) {
      findings.push(`root_unavailable:${root}:${err.code || "unknown"}`);
      continue;
    }
    const report = await scan(root, options);
    reports.push(report);
    findings.push(...report.findings.map((finding) => `${root}:${finding}`));
    if (report.classifications.includes("unknown")) findings.push(`root_unknown_artifacts:${root}`);
  }
  const verdict = findings.length === 0 ? "pass" : "blocked";
  return {
    ok: verdict === "pass",
    verdict,
    truth: verdict === "pass" ? "classified" : "insufficient",
    schema: STORAGE_CENSUS_SCHEMA,
    contractVersion: STORAGE_CENSUS_CONTRACT_VERSION,
    options: { maxFiles: options.maxFiles, maxDepth: options.maxDepth, groupDepth: options.groupDepth },
    reports,
    findings: [...new Set(findings)],
    destructive_actions_performed: [],
    safe_actions: [
      "No file was deleted, moved, archived, staged, committed, reset, cleaned, or overwritten.",
      "Retain proof and protected groups. Quarantine and review groups need an explicit retention decision before any human-approved cleanup.",
      "A partial scan or unknown artifact is blocked, not safe to remove.",
    ],
    secret_values_returned: false,
  };
}

export { STORAGE_CENSUS_CONTRACT_VERSION, STORAGE_CENSUS_SCHEMA };
