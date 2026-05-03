#!/usr/bin/env node
/**
 * stream-state-snapshot.mjs — refreshes STREAM/STATE.md from real gh PR + lock data.
 *
 * Foolproof: zero deps (Node 20 has fetch + child_process), idempotent,
 * fail-soft if gh CLI absent or token missing.
 *
 * Picks the repo from `git remote get-url origin` and queries gh API for
 * open PRs in both Hermes3D and HermesProof if discoverable.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";

const NOW = new Date();

function findRepoRoot() {
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    try {
      execSync(`git -C "${dir}" rev-parse --git-dir`, { stdio: "pipe" });
      return dir;
    } catch {
      // not a repo yet
    }
    dir = path.dirname(dir);
  }
  return process.cwd();
}

function ghJson(args, fallback = []) {
  try {
    const out = execSync(`gh ${args}`, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    return JSON.parse(out);
  } catch {
    return fallback;
  }
}

function ghPRs(repo) {
  return ghJson(
    `pr list -R ${repo} --state open --json number,title,headRefName,statusCheckRollup --limit 30`
  );
}

function rollupSummary(checks) {
  if (!Array.isArray(checks) || checks.length === 0) return "no-checks";
  const failed = checks.filter((c) => c.conclusion === "FAILURE").length;
  const inProgress = checks.filter((c) => c.status === "IN_PROGRESS").length;
  const success = checks.filter((c) => c.conclusion === "SUCCESS").length;
  const skipped = checks.filter((c) => c.conclusion === "SKIPPED").length;
  if (failed > 0) return `🔴 ${failed} fail / ${success} ok / ${skipped} skip / ${inProgress} pending`;
  if (inProgress > 0) return `🟡 ${success} ok / ${skipped} skip / ${inProgress} pending`;
  return `🟢 ${success} ok / ${skipped} skip`;
}

function fmtPRsTable(prs) {
  if (!prs || prs.length === 0) return "_none_";
  const rows = prs.map((p) => {
    const title = String(p.title || "").slice(0, 80).replace(/\|/g, "\\|");
    return `| #${p.number} | ${title} | ${p.headRefName} | ${rollupSummary(p.statusCheckRollup)} |`;
  });
  return ["| PR | Title | Branch | CI |", "|---|---|---|---|", ...rows].join("\n");
}

async function snapshotOneRepo(streamDir, repoSlug, label) {
  if (!streamDir) return;
  const stateFile = path.join(streamDir, "STATE.md");
  let prs = [];
  if (repoSlug) prs = ghPRs(repoSlug);
  const banner = `_Refreshed by stream-state-snapshot at ${NOW.toISOString()}._`;
  const block = [
    `# STREAM/STATE.md — Live snapshot (${label})`,
    "",
    "## Last update",
    `- **UTC:** ${NOW.toISOString()}`,
    "- **By role:** WATCHDOG (auto-cron)",
    "",
    "## Open PRs",
    "",
    fmtPRsTable(prs),
    "",
    `## Health`,
    `- snapshot type: cron-auto`,
    `- gh availability: ${prs.length === 0 ? "unverified" : "ok"}`,
    "",
    banner,
    "",
  ].join("\n");
  await fs.writeFile(stateFile, block, "utf8");
  console.log(`snapshot updated: ${stateFile}`);
}

async function main() {
  const root = findRepoRoot();
  // Detect which repo we're in based on remote
  let repoSlug = null;
  try {
    const url = execSync(`git -C "${root}" remote get-url origin`, { encoding: "utf8" }).trim();
    const m = url.match(/github\.com[/:]([^/]+\/[^/.]+)/);
    if (m) repoSlug = m[1];
  } catch {
    // ignore
  }
  const label = repoSlug ?? "this repo";
  const streamDir = path.join(root, "handoffs", "STREAM");
  try {
    await fs.access(streamDir);
  } catch {
    console.log(`no handoffs/STREAM/ in ${root}; nothing to snapshot`);
    return;
  }
  await snapshotOneRepo(streamDir, repoSlug, label);

  // If a sibling repo's STREAM/ is reachable, try that too
  const parent = path.dirname(root);
  try {
    const sibs = await fs.readdir(parent, { withFileTypes: true });
    for (const s of sibs) {
      if (!s.isDirectory()) continue;
      const sibStream = path.join(parent, s.name, "handoffs", "STREAM");
      try {
        await fs.access(sibStream);
        if (sibStream === streamDir) continue;
        // Try detecting the sibling's repo slug
        let sibSlug = null;
        try {
          const url = execSync(`git -C "${path.join(parent, s.name)}" remote get-url origin`, {
            encoding: "utf8",
          }).trim();
          const m = url.match(/github\.com[/:]([^/]+\/[^/.]+)/);
          if (m) sibSlug = m[1];
        } catch {}
        await snapshotOneRepo(sibStream, sibSlug, sibSlug ?? `sibling: ${s.name}`);
      } catch {}
    }
  } catch {}
}

main().catch((err) => {
  console.error("snapshot error:", err.message);
  process.exit(0); // fail-soft per cron contract
});
