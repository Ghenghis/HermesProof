#!/usr/bin/env node
/**
 * docs-changes-reflected — gate `docs.reflects_changes`
 *
 * Rule: if `package.json` has a "version" change OR an ADR file is added
 * or modified between the comparison range, then README.md and/or
 * CHANGELOG.md must also be touched in the same range. Specifically:
 *
 *   - For a version bump, README OR CHANGELOG must contain the new
 *     version string (in any added line).
 *   - For an ADR change, README OR CHANGELOG must have any added line
 *     mentioning the ADR file's basename (case-insensitive).
 *
 * The comparison range is configurable:
 *   --base <ref>   default: origin/main if reachable, else HEAD~1
 *   --head <ref>   default: HEAD
 *
 * No new runtime deps. We shell out to `git` only.
 *
 * Wired as truth gate `docs.reflects_changes` (advisory) in
 * scripts/truth-gates.mjs.
 *
 * Exit code: 0 = pass or no triggers, 1 = unreflected change.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

// ---------------------------------------------------------------------------
// Argv
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base") out.base = argv[++i];
    else if (a === "--head") out.head = argv[++i];
    else if (a === "--cwd") out.cwd = argv[++i];
    else if (a === "--json") out.json = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`Usage: node scripts/docs-changes-reflected.mjs [options]

Options:
  --base <ref>   Comparison base (default: origin/main, fallback HEAD~1)
  --head <ref>   Comparison head (default: HEAD)
  --cwd <path>   Repo to inspect (default: repo root)
  --json         Emit JSON only
  --help         Show this help`);
  process.exit(0);
}

const cwd = args.cwd ? path.resolve(args.cwd) : repoRoot;

// ---------------------------------------------------------------------------
// Git helpers (sync; sub-second)
// ---------------------------------------------------------------------------
function git(args, opts = {}) {
  const r = spawnSync("git", args, { encoding: "utf8", cwd, ...opts });
  return { status: r.status ?? -1, stdout: r.stdout || "", stderr: r.stderr || "", error: r.error };
}

function refExists(ref) {
  return git(["rev-parse", "--verify", "--quiet", ref]).status === 0;
}

export function resolveBase(explicit) {
  if (explicit) return explicit;
  if (refExists("origin/main")) return "origin/main";
  if (refExists("HEAD~1")) return "HEAD~1";
  return null; // first commit; no diff possible
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests; injected git output as string)
// ---------------------------------------------------------------------------

/**
 * Parse `git diff --name-status BASE..HEAD` output into a list of
 * { status, path } records. Renames (R) yield the new path.
 */
export function parseNameStatus(text) {
  const lines = (text || "").split("\n").filter(Boolean);
  const out = [];
  for (const line of lines) {
    const parts = line.split("\t");
    const code = parts[0]?.[0] || "";
    if (!code) continue;
    if (code === "R" || code === "C") {
      // R100\told\tnew  — record the destination
      const dest = parts[2];
      if (dest) out.push({ status: code, path: dest });
    } else {
      const p = parts[1];
      if (p) out.push({ status: code, path: p });
    }
  }
  return out;
}

/**
 * Detect a version bump in a `git diff` patch of package.json.
 * Returns { changed: bool, oldVersion, newVersion } — both null when not detected.
 */
export function detectVersionBump(diffText) {
  const lines = (diffText || "").split("\n");
  let oldVersion = null;
  let newVersion = null;
  for (const ln of lines) {
    const m = ln.match(/^([+-])\s*"version"\s*:\s*"([^"]+)"/);
    if (!m) continue;
    if (m[1] === "-") oldVersion = m[2];
    else if (m[1] === "+") newVersion = m[2];
  }
  return {
    changed: !!(oldVersion && newVersion && oldVersion !== newVersion),
    oldVersion,
    newVersion
  };
}

/**
 * Identify ADR files in a list of changed paths. We accept these conventions:
 *   - docs/adr/...md, adr/...md, docs/architecture/decisions/*.md
 *   - any *.md whose basename starts with `ADR` or `adr-`
 */
export function pickAdrChanges(changes) {
  const isAdr = (p) => {
    const norm = p.replace(/\\/g, "/").toLowerCase();
    if (!norm.endsWith(".md")) return false;
    if (norm.includes("/adr/")) return true;
    if (norm.includes("docs/architecture/decisions/")) return true;
    const base = norm.split("/").pop();
    if (base.startsWith("adr-") || base.startsWith("adr_")) return true;
    if (/^adr[-_ ]?\d+/.test(base)) return true;
    return false;
  };
  return changes.filter((c) => isAdr(c.path));
}

/**
 * Pull only the lines that were added in a unified-diff `text` (i.e. start
 * with "+" but not "+++"). Returns an array of strings (no leading "+").
 */
export function extractAddedLines(diffText) {
  return (diffText || "")
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1));
}

/**
 * Given the list of triggers + the added-lines content of README/CHANGELOG,
 * return the set of unreflected triggers.
 *
 * `triggers` shape:
 *   { kind: "version", from: "0.5.0", to: "0.6.0" }
 *   { kind: "adr", path: "docs/adr/0007-thing.md" }
 *
 * `docs` shape:
 *   { readmeAdded: [string], changelogAdded: [string] }
 */
export function checkReflected(triggers, docs) {
  const haystack = [...(docs.readmeAdded || []), ...(docs.changelogAdded || [])]
    .join("\n").toLowerCase();
  const unreflected = [];
  for (const t of triggers) {
    if (t.kind === "version") {
      const needle = String(t.to).toLowerCase();
      if (!haystack.includes(needle)) {
        unreflected.push({ ...t, reason: `no added line mentions version ${t.to}` });
      }
    } else if (t.kind === "adr") {
      const base = path.basename(String(t.path)).toLowerCase();
      const stem = base.replace(/\.md$/i, "");
      if (!haystack.includes(base) && !haystack.includes(stem)) {
        unreflected.push({ ...t, reason: `no added line mentions ADR ${base}` });
      }
    }
  }
  return unreflected;
}

// ---------------------------------------------------------------------------
// Main run (CLI + harness adapter)
// ---------------------------------------------------------------------------
export async function runDocsChangesReflectedGate({ base, head = "HEAD" } = {}) {
  // Detect base (origin/main, then HEAD~1, then no-base case).
  const resolvedBase = resolveBase(base);
  if (!resolvedBase) {
    return {
      ok: true,
      evidence: { reason: "no base ref available (initial commit?)", base: null, head },
      details: "no comparison base; nothing to enforce"
    };
  }

  // 1. Get name-status across the range.
  const nameStatus = git(["diff", "--name-status", `${resolvedBase}...${head}`]);
  if (nameStatus.status !== 0) {
    return {
      ok: true,
      evidence: { reason: `git diff --name-status failed: ${nameStatus.stderr.trim()}`, base: resolvedBase, head },
      details: "could not produce diff; treating as no-op"
    };
  }
  const changes = parseNameStatus(nameStatus.stdout);

  // 2. Did package.json change? If so, parse its diff for version bump.
  const triggers = [];
  const pkgChanged = changes.some((c) => c.path === "package.json");
  let versionBump = null;
  if (pkgChanged) {
    const pkgDiff = git(["diff", `${resolvedBase}...${head}`, "--", "package.json"]);
    versionBump = detectVersionBump(pkgDiff.stdout);
    if (versionBump.changed) {
      triggers.push({ kind: "version", from: versionBump.oldVersion, to: versionBump.newVersion });
    }
  }

  // 3. ADR changes?
  const adrChanges = pickAdrChanges(changes);
  for (const a of adrChanges) {
    triggers.push({ kind: "adr", path: a.path, status: a.status });
  }

  if (triggers.length === 0) {
    return {
      ok: true,
      evidence: {
        base: resolvedBase,
        head,
        change_count: changes.length,
        version_bump: versionBump,
        adr_changes: adrChanges,
        triggers: []
      },
      details: "no version bump or ADR change in range; gate is inert"
    };
  }

  // 4. Pull added-lines for README and CHANGELOG.
  const readmeDiff = git(["diff", `${resolvedBase}...${head}`, "--", "README.md"]);
  const changelogDiff = git(["diff", `${resolvedBase}...${head}`, "--", "CHANGELOG.md"]);
  const docs = {
    readmeAdded: extractAddedLines(readmeDiff.stdout),
    changelogAdded: extractAddedLines(changelogDiff.stdout)
  };

  const unreflected = checkReflected(triggers, docs);
  const ok = unreflected.length === 0;
  return {
    ok,
    evidence: {
      base: resolvedBase,
      head,
      change_count: changes.length,
      version_bump: versionBump,
      adr_changes: adrChanges,
      triggers,
      readme_added_line_count: docs.readmeAdded.length,
      changelog_added_line_count: docs.changelogAdded.length,
      unreflected
    },
    details: ok
      ? `${triggers.length} trigger(s) all reflected in README/CHANGELOG`
      : `${unreflected.length} unreflected trigger(s): ${unreflected.map((u) => u.kind === "version" ? `version->${u.to}` : `adr ${path.basename(u.path)}`).join(", ")}`
  };
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------
const isMain = process.argv[1] && url.pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const result = await runDocsChangesReflectedGate({ base: args.base, head: args.head });
  if (args.json) {
    process.stdout.write(JSON.stringify(result) + "\n");
  } else {
    console.log(`[${result.ok ? "PASS" : "FAIL"}] docs.reflects_changes -- ${result.details}`);
    if (!result.ok) {
      for (const u of result.evidence.unreflected) {
        console.log(`  - ${u.kind === "version" ? `version ${u.from} -> ${u.to}` : `ADR ${u.path}`}: ${u.reason}`);
      }
    }
  }
  process.exit(result.ok ? 0 : 1);
}
