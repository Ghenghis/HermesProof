import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";

const MANIFEST_SCHEMA = "hermesproof.expected-diff-manifest.v2";
const KILO_MANIFEST_SCHEMA = "kilocode.expected_diff_manifest.v1";
const CLASSES = new Set(["KEEP_DOC_TRUTH", "KEEP_TEST_PROOF", "KEEP_RECOVERY_FIX", "QUARANTINE_ARTIFACT", "REVERT_NOISE", "UNKNOWN_NEEDS_REVIEW"]);

function runGit(workspaceRoot, args) {
  const env = { ...process.env };
  delete env.GIT_ALTERNATE_OBJECT_DIRECTORIES;
  delete env.GIT_COMMON_DIR;
  delete env.GIT_DIR;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_OBJECT_DIRECTORY;
  delete env.GIT_WORK_TREE;
  const proc = spawnSync("git", ["-C", workspaceRoot, ...args], { encoding: "utf8", env, timeout: 5000 });
  return {
    ok: proc.status === 0,
    status: proc.status,
    stdout: proc.stdout || "",
    stderr: proc.stderr || "",
    error: proc.error?.message || null,
  };
}

async function hasGitMetadata(workspaceRoot) {
  try {
    await fs.lstat(path.join(path.resolve(workspaceRoot), ".git"));
    return true;
  } catch (err) {
    if (err.code === "ENOENT") return false;
    return false;
  }
}

function isPathSafe(value) {
  const text = String(value || "").trim();
  if (!text || path.isAbsolute(text) || text.includes("\0")) return false;
  const parts = text.split(/[\\/]+/).filter(Boolean);
  return !parts.includes("..");
}

function parseStatusLine(line) {
  const xy = line.slice(0, 2);
  const raw = line.slice(3);
  const renamed = raw.includes(" -> ") ? raw.split(" -> ").at(-1) : raw;
  return {
    status: xy.trim() || xy,
    raw_status: xy,
    path: renamed,
    raw_path: raw,
  };
}

async function readExpectedManifest(workspaceRoot, expectedManifestPath) {
  if (!expectedManifestPath) return null;
  if (!isPathSafe(expectedManifestPath)) {
    return {
      ok: false,
      path: expectedManifestPath,
      entries: [],
      error: "expectedManifestPath must be workspace-relative and must not contain '..'",
    };
  }

  const file = path.join(workspaceRoot, expectedManifestPath);
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed.entries) ? parsed.entries : [];
    const classes = parsed?.schema === KILO_MANIFEST_SCHEMA && parsed.classes && typeof parsed.classes === "object"
      ? Object.entries(parsed.classes).flatMap(([classification, paths]) => Array.isArray(paths) && CLASSES.has(classification)
        ? paths.map((entry) => ({ path: entry, classification }))
        : [])
      : [];
    const entries = [...list, ...classes];
    return {
      ok: true,
      path: expectedManifestPath,
      schema: String(parsed.schema || parsed.schema_version || "").trim(),
      branch: String(parsed.branch || "").trim(),
      head: String(parsed.head || parsed.baseCommit || "").trim(),
      reviewedAtUtc: String(parsed.reviewedAtUtc || "").trim(),
      releaseClaimAllowed: parsed.releaseClaimAllowed === true,
      integrity: parsed.schema === MANIFEST_SCHEMA ? "hash-bound" : parsed.schema === KILO_MANIFEST_SCHEMA ? "path-classified" : "legacy",
      reason: parsed.reason || "",
      entries: entries
        .filter((entry) => isPathSafe(entry?.path))
        .map((entry) => ({
          path: entry.path,
          status: String(entry.status || "").trim(),
          classification: String(entry.classification || "KEEP_RECOVERY_FIX").trim(),
          sha256: String(entry.sha256 || "").trim(),
          reason: String(entry.reason || parsed.reason || "").slice(0, 240),
        })),
    };
  } catch (err) {
    if (err.code === "ENOENT") {
      return { ok: false, path: expectedManifestPath, entries: [], error: "expected manifest not found" };
    }
    return { ok: false, path: expectedManifestPath, entries: [], error: err.message };
  }
}

function expected(item, manifest) {
  if (!manifest?.ok) return false;
  return manifest.entries.find((entry) => {
    if (entry.path !== item.path) return false;
    if (!entry.status) return true;
    return entry.status === item.status || entry.status === item.raw_status || (entry.status === "??" && item.raw_status === "??");
  });
}

function hash(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || "").trim());
}

function gitHash(value) {
  return /^[a-f0-9]{7,64}$/i.test(String(value || "").trim());
}

async function digest(workspaceRoot, item) {
  const file = path.resolve(workspaceRoot, item.path);
  const root = `${path.resolve(workspaceRoot)}${path.sep}`;
  if (!file.startsWith(root)) return null;
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) return null;
    const raw = await fs.readFile(file);
    return crypto.createHash("sha256").update(raw).digest("hex");
  } catch (err) {
    if (err.code === "ENOENT" && item.status.includes("D")) return "deleted";
    return null;
  }
}

async function manifestFacts(workspaceRoot, manifest, branch, commit, items) {
  if (!manifest?.ok) return { ok: false, integrity: "missing", findings: [manifest?.error || "expected_manifest_missing"] };
  const findings = [];
  if (!manifest.schema) findings.push("manifest_schema_missing");
  if (!gitHash(manifest.head)) findings.push("manifest_head_invalid");
  if (gitHash(manifest.head) && !commit.startsWith(manifest.head)) findings.push("manifest_head_mismatch");
  if (manifest.branch && manifest.branch !== branch) findings.push("manifest_branch_mismatch");
  if (manifest.releaseClaimAllowed) findings.push("manifest_release_claim_forbidden");
  if (manifest.entries.some((entry) => !CLASSES.has(entry.classification))) findings.push("manifest_classification_invalid");
  if (manifest.entries.some((entry) => entry.classification === "UNKNOWN_NEEDS_REVIEW")) findings.push("manifest_unknown_entries_present");
  for (const entry of manifest.entries) {
    const item = items.find((candidate) => candidate.path === entry.path && (!entry.status || entry.status === candidate.status || entry.status === candidate.raw_status));
    if (!item) findings.push(`manifest_entry_not_dirty:${entry.path}`);
  }
  if (manifest.integrity !== "hash-bound") return { ok: findings.length === 0, integrity: manifest.integrity, findings };
  if (!manifest.reviewedAtUtc || !Number.isFinite(Date.parse(manifest.reviewedAtUtc))) findings.push("manifest_reviewed_timestamp_invalid");
  for (const entry of manifest.entries) {
    const item = items.find((candidate) => candidate.path === entry.path && (!entry.status || entry.status === candidate.status || entry.status === candidate.raw_status));
    if (!item) continue;
    if (entry.classification === "QUARANTINE_ARTIFACT") continue;
    if (!hash(entry.sha256) && !(item.status.includes("D") && entry.sha256 === "deleted")) {
      findings.push(`manifest_entry_hash_missing:${entry.path}`);
      continue;
    }
    const actual = await digest(workspaceRoot, item);
    if (!actual) {
      findings.push(`manifest_entry_hash_unavailable:${entry.path}`);
      continue;
    }
    if (actual !== entry.sha256) findings.push(`manifest_entry_hash_mismatch:${entry.path}`);
  }
  return { ok: findings.length === 0, integrity: manifest.integrity, findings };
}

function classifyGitignoreInstallMod(workspaceRoot, mod, stateDirName) {
  if (mod.path !== ".gitignore") return null;
  const diff = runGit(workspaceRoot, ["diff", "--unified=0", "--", ".gitignore"]);
  const added = diff.stdout
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"));
  const escaped = stateDirName.replace(/[.\\]/g, "\\$&");
  const markers = [
    /Added by MCP Lock Orchestrator init/i,
    new RegExp(`^\\+\\s*${escaped}/?\\s*$`),
    /tools\/hermes3d-mcp-lock-orchestrator\/node_modules\//,
  ];
  const ours = added.length > 0 && added.every((line) =>
    markers.some((re) => re.test(line)) || line === "+"
  );
  return ours ? { ...mod, kind: "install_marker", added_lines: added.length } : null;
}

function safeActions({ releaseReady, recoveryReady, dirty, expectedDirty, expectedManifestPath }) {
  const actions = [];
  actions.push("No destructive action was performed by HermesProof.");
  if (releaseReady) {
    actions.push("Workspace hygiene is release-ready for dirty-workspace checks.");
    return actions;
  }
  actions.push("Review the listed dirty paths before any release, update, or installer claim.");
  actions.push("Commit intentional changes on the current branch, or move new work into an isolated git worktree branch before updating sidecars.");
  actions.push("For temporary local work, ask the user before running git stash push -u; HermesProof only reports this option and never runs it automatically.");
  if (dirty) actions.push("Do not run git reset, git clean, checkout, or branch switches that would discard work unless the user explicitly approves that exact operation.");
  if (recoveryReady) actions.push("The reviewed recovery batch is preserved and may continue through focused checks, but it is still not a clean release workspace.");
  if (expectedDirty) actions.push("Expected dirty entries are never release-ready. Keep them in the reviewed recovery batch until they are committed, isolated, or explicitly archived.");
  if (!expectedManifestPath) actions.push("If dirty state is intentionally tolerated, create a reviewed expected-diff manifest and rerun with that manifest path.");
  return actions;
}

export async function evaluateWorkspaceHygiene({
  workspaceRoot,
  stateDirName = ".hermes3d_orchestrator",
  expectedManifestPath = "",
  allowExpectedDirty = false,
} = {}) {
  const root = path.resolve(workspaceRoot || process.cwd());
  const manifest = await readExpectedManifest(root, expectedManifestPath);
  if (!(await hasGitMetadata(root))) {
    return {
      ok: false,
      status: "not_git_workspace",
      release_ready: false,
      workspace_root: root,
      git_available: true,
      branch: null,
      commit: null,
      expected_manifest: manifest,
      destructive_actions_performed: [],
      safe_actions: safeActions({ releaseReady: false, recoveryReady: false, dirty: false, expectedDirty: false, expectedManifestPath }),
      secret_values_returned: false,
    };
  }
  const branch = runGit(root, ["branch", "--show-current"]);
  const commit = runGit(root, ["rev-parse", "HEAD"]);
  const inside = runGit(root, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok || inside.stdout.trim() !== "true") {
    return {
      ok: false,
      status: "not_git_workspace",
      release_ready: false,
      workspace_root: root,
      git_available: inside.error ? false : true,
      branch: branch.ok ? branch.stdout.trim() : null,
      commit: commit.ok ? commit.stdout.trim() : null,
      expected_manifest: manifest,
      destructive_actions_performed: [],
      safe_actions: safeActions({ releaseReady: false, recoveryReady: false, dirty: false, expectedDirty: false, expectedManifestPath }),
      secret_values_returned: false,
    };
  }

  let probeFiles = 0;
  try {
    const entries = await fs.readdir(root);
    probeFiles = entries.filter((entry) => entry.startsWith(".mcp-lock-write-probe-")).length;
  } catch {
    probeFiles = 0;
  }

  let stateDirPresent = false;
  try {
    const stat = await fs.stat(path.join(root, stateDirName));
    stateDirPresent = stat.isDirectory();
  } catch {
    stateDirPresent = false;
  }

  const status = runGit(root, ["status", "--porcelain=v1"]);
  if (!status.ok) {
    return {
      ok: false,
      status: "git_status_failed",
      release_ready: false,
      workspace_root: root,
      branch: branch.ok ? branch.stdout.trim() : null,
      commit: commit.ok ? commit.stdout.trim() : null,
      git_error: status.stderr.trim() || status.error,
      expected_manifest: manifest,
      destructive_actions_performed: [],
      safe_actions: safeActions({ releaseReady: false, recoveryReady: false, dirty: false, expectedDirty: false, expectedManifestPath }),
      secret_values_returned: false,
    };
  }

  const lines = status.stdout.split("\n").filter(Boolean);
  const tracked = [];
  const untracked = [];
  for (const line of lines) {
    const item = parseStatusLine(line);
    if (item.raw_status === "??") untracked.push(item);
    else tracked.push(item);
  }

  const allowed = [`${stateDirName}/`, stateDirName];
  const untrackedVisible = untracked.filter((item) =>
    !allowed.some((prefix) => item.path === prefix || item.path.startsWith(prefix))
  );
  const expectedUntracked = untrackedVisible.filter((item) => expected(item, manifest));
  const unexpectedUntracked = untrackedVisible.filter((item) => !expected(item, manifest));

  const installRelatedModifications = [];
  const expectedModifications = [];
  const unexpectedModifications = [];
  for (const mod of tracked) {
    const install = classifyGitignoreInstallMod(root, mod, stateDirName);
    if (install) {
      installRelatedModifications.push(install);
      continue;
    }
    if (expected(mod, manifest)) {
      expectedModifications.push(mod);
      continue;
    }
    unexpectedModifications.push(mod);
  }

  const expectedDirty = expectedModifications.length + expectedUntracked.length;
  const dirty = tracked.length + untrackedVisible.length + probeFiles;
  const items = [...tracked, ...untrackedVisible];
  const facts = await manifestFacts(root, manifest, branch.ok ? branch.stdout.trim() : "", commit.ok ? commit.stdout.trim() : "", items);
  const quarantined = items.filter((item) => expected(item, manifest)?.classification === "QUARANTINE_ARTIFACT");
  const releaseReady = dirty === 0 && probeFiles === 0;
  const recoveryReady = !releaseReady &&
    facts.ok &&
    facts.integrity === "hash-bound" &&
    unexpectedModifications.length === 0 &&
    unexpectedUntracked.length === 0 &&
    quarantined.length === 0 &&
    probeFiles === 0;
  const resultStatus = releaseReady
    ? "clean"
    : recoveryReady
      ? "reviewed_recovery_dirty"
      : quarantined.length > 0
        ? "quarantine_required"
        : unexpectedModifications.length || unexpectedUntracked.length || probeFiles
          ? "dirty_blocked"
          : "expected_manifest_invalid";
  const verdict = releaseReady ? "pass" : recoveryReady ? "blocked" : "fail";

  return {
    ok: releaseReady,
    verdict,
    truth: verdict === "pass" ? "proven" : verdict === "blocked" ? "insufficient" : "rejected",
    status: resultStatus,
    release_ready: releaseReady,
    recovery_ready: recoveryReady,
    workspace_root: root,
    branch: branch.ok ? branch.stdout.trim() || null : null,
    commit: commit.ok ? commit.stdout.trim() || null : null,
    state_dir_name: stateDirName,
    hermes3d_state_dir_present: stateDirPresent,
    probe_files_left: probeFiles,
    dirty_count: dirty,
    tracked_modifications: tracked,
    install_related_modifications: installRelatedModifications,
    expected_modifications: expectedModifications,
    unexpected_modifications: unexpectedModifications,
    untracked_paths: untrackedVisible.map((item) => item.path),
    expected_untracked: expectedUntracked,
    unexpected_untracked: unexpectedUntracked.map((item) => item.path),
    expected_manifest: manifest,
    manifest_facts: facts,
    quarantined_paths: quarantined.map((item) => item.path),
    expected_dirty_allowed: false,
    destructive_actions_performed: [],
    safe_actions: safeActions({ releaseReady, recoveryReady, dirty, expectedDirty, expectedManifestPath }),
    secret_values_returned: false,
  };
}
