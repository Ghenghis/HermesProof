import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export const DEFAULT_STATE_DIR_NAME = ".hermes3d_orchestrator";
// Backwards-compat alias kept for any external import sites.
export const STATE_DIR_NAME = DEFAULT_STATE_DIR_NAME;

export function resolveStateDirName(stateDirName) {
  const fromEnv = (process.env.MCP_LOCK_STATE_DIR || "").trim();
  const candidate = (stateDirName || fromEnv || DEFAULT_STATE_DIR_NAME).trim();
  if (!candidate) return DEFAULT_STATE_DIR_NAME;
  if (candidate.includes("/") || candidate.includes("\\") || candidate.includes("..") || candidate.includes("\0")) {
    throw new Error(`MCP_LOCK_STATE_DIR must be a single directory name, got: ${candidate}`);
  }
  return candidate;
}

export function utcNow() {
  return new Date().toISOString();
}

export function addMinutesIso(minutes) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

export function isExpired(iso) {
  return typeof iso === "string" && new Date(iso).getTime() < Date.now();
}

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function readJson(file, fallback = undefined) {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (arguments.length >= 2 && (err.code === "ENOENT" || err instanceof SyntaxError)) return fallback;
    throw err;
  }
}

async function renameAtomicWithRetry(tmp, file) {
  let delayMs = 5;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await fs.rename(tmp, file);
      return;
    } catch (err) {
      if (!["EPERM", "EACCES"].includes(err.code) || attempt === 9) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs *= 2;
    }
  }
}

export async function writeJsonAtomic(file, value) {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(16).toString("hex")}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
    await renameAtomicWithRetry(tmp, file);
  } catch (err) {
    try { await fs.rm(tmp, { force: true }); } catch { /* best-effort cleanup */ }
    throw err;
  }
}

export async function appendJsonLine(file, value) {
  await ensureDir(path.dirname(file));
  await fs.appendFile(file, JSON.stringify(value) + "\n", "utf8");
}

// Deterministic, key-sorted JSON for hash pre-image. Matches the canonical
// encoding rule used by Hermes3D's PROOF_PROTOCOL.md (UTF-8, sorted keys, no
// whitespace) so HermesProof attestations interop with Hermes3D ones.
export function canonicalJSON(obj) {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(canonicalJSON).join(",") + "]";
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJSON(obj[k])).join(",") + "}";
}

// Append a hash-chained entry to an NDJSON log. Each entry includes
// `prev_hash` (sha256 of the previous chained entry's `entry_hash`, or null
// for the first chained entry) and `entry_hash` (sha256 of the canonical
// pre-image including `prev_hash` but excluding `entry_hash` itself).
//
// Tampering with any entry (or splicing out a middle entry) breaks the chain
// and is detected by verifyChainedLog.
//
// Note: this assumes a single-process appender (which the MCP server is).
// Concurrent independent appenders on the same file would race; that is the
// same coordination problem HermesProof itself solves at the file-lock layer.
export async function appendChainedJsonLine(file, value) {
  await ensureDir(path.dirname(file));
  let prevHash = null;
  let prevId = null;
  try {
    const raw = await fs.readFile(file, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const last = JSON.parse(lines[i]);
        if (last && typeof last.entry_hash === "string") {
          prevHash = last.entry_hash;
          prevId = last.id || null;
          break;
        }
      } catch { /* skip malformed */ }
    }
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  const withChain = { ...value, prev_entry_id: prevId, prev_hash: prevHash };
  const entryHash = crypto.createHash("sha256").update(canonicalJSON(withChain)).digest("hex");
  const final = { ...withChain, entry_hash: entryHash };
  await fs.appendFile(file, JSON.stringify(final) + "\n", "utf8");
  return final;
}

// Walk an NDJSON log, validate each entry's hash matches its canonical
// pre-image, and verify each `prev_hash` links to the previous chained
// entry. Pre-chain entries (those lacking `entry_hash`) are tolerated and
// counted as `unchained` — useful when migrating an existing ledger.
export async function verifyChainedLog(file) {
  let raw;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return { ok: true, total: 0, chained: 0, unchained: 0, first_break: null };
    throw err;
  }
  const lines = raw.split("\n").filter(Boolean);
  let chained = 0;
  let unchained = 0;
  let lastHash = null;
  let firstBreak = null;
  for (let i = 0; i < lines.length; i++) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch (err) {
      if (firstBreak === null) firstBreak = { index: i, reason: `parse error: ${err.message}` };
      continue;
    }
    if (!entry || typeof entry.entry_hash !== "string" || !("prev_hash" in entry)) {
      unchained++;
      continue;
    }
    const { entry_hash: stored, ...preimage } = entry;
    const computed = crypto.createHash("sha256").update(canonicalJSON(preimage)).digest("hex");
    if (computed !== stored) {
      if (firstBreak === null) firstBreak = { index: i, reason: "entry_hash mismatch", id: entry.id || null };
      continue;
    }
    if (lastHash !== null && entry.prev_hash !== lastHash) {
      if (firstBreak === null) firstBreak = { index: i, reason: "prev_hash does not link to previous chained entry", id: entry.id || null };
      continue;
    }
    chained++;
    lastHash = stored;
  }
  return {
    ok: firstBreak === null,
    total: lines.length,
    chained,
    unchained,
    first_break: firstBreak
  };
}

export function shaId(input, len = 24) {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, len);
}

/**
 * Resolves the workspace root the MCP server should govern.
 * Priority:
 *   1. Explicit argument
 *   2. MCP_LOCK_WORKSPACE env var (project-agnostic name)
 *   3. HERMES3D_WORKSPACE env var (legacy/back-compat for the original Hermes3D scaffold)
 *   4. Current working directory
 *
 * The path is always resolved to an absolute path so subsequent path-escape
 * checks can be applied uniformly across platforms.
 */
export function safeWorkspaceRoot(workspaceRoot) {
  const candidate =
    workspaceRoot ||
    process.env.MCP_LOCK_WORKSPACE ||
    process.env.HERMES3D_WORKSPACE ||
    process.cwd();
  return path.resolve(candidate);
}

export function normalizeWorkspacePath(workspaceRoot, requestedPath) {
  if (typeof requestedPath !== "string" || requestedPath.trim() === "") {
    throw new Error("file path must be a non-empty string");
  }
  const trimmed = requestedPath.trim().replace(/\\/g, "/");
  if (trimmed.includes("\0")) throw new Error("file path contains null byte");
  if (/[\x01-\x1f\x7f]/.test(trimmed)) throw new Error("file path contains control characters");
  if (trimmed.includes("~")) throw new Error("file path may not contain '~'");

  // Reject NTFS Alternate Data Stream syntax (filename:stream). The drive
  // letter case (e.g. `C:/foo`) is handled by `path.isAbsolute` and the
  // workspace-escape check below — here we look for `:` AFTER the leading
  // path component, which on POSIX is also nonsense.
  const afterDrive = trimmed.replace(/^[A-Za-z]:/, "");
  if (afterDrive.includes(":")) {
    throw new Error(`file path contains ':' (NTFS ADS or invalid POSIX): ${requestedPath}`);
  }

  const absolute = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(workspaceRoot, trimmed);

  const rel = path.relative(workspaceRoot, absolute).replace(/\\/g, "/");
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(
      `file path escapes workspace: requested="${requestedPath}" resolved="${absolute}" workspace="${workspaceRoot}"`
    );
  }
  if (rel === "") throw new Error("workspace root itself cannot be locked");
  return rel;
}

export function statePaths(workspaceRoot, stateDirName) {
  const dirName = resolveStateDirName(stateDirName);
  const stateDir = path.join(workspaceRoot, dirName);
  const eventsDir = path.join(stateDir, "events");
  const tasksDir = path.join(stateDir, "tasks");
  return {
    root: workspaceRoot,
    stateDirName: dirName,
    stateDir,
    locksDir: path.join(stateDir, "locks"),
    tasksDir,
    tasksPendingDir: path.join(tasksDir, "pending"),
    tasksClaimedDir: path.join(tasksDir, "claimed"),
    tasksBlockedDir: path.join(tasksDir, "blocked"),
    tasksDoneDir: path.join(tasksDir, "done"),
    handoffsDir: path.join(stateDir, "handoffs"),
    evidenceDir: path.join(stateDir, "evidence"),
    gatesDir: path.join(stateDir, "gates"),
    eventsDir,
    eventsOutboxDir: path.join(eventsDir, "outbox"),
    eventsHandledDir: path.join(eventsDir, "handled"),
    eventsFailedDir: path.join(eventsDir, "failed"),
    reviewPacketsDir: path.join(stateDir, "review_packets"),
    eventsFile: path.join(stateDir, "events.ndjson"),
    evidenceFile: path.join(stateDir, "evidence", "ledger.ndjson"),
    configFile: path.join(stateDir, "config.json")
  };
}

export async function initStateDirs(paths) {
  await ensureDir(paths.stateDir);
  await ensureDir(paths.locksDir);
  await ensureDir(paths.tasksDir);
  await ensureDir(paths.tasksPendingDir);
  await ensureDir(paths.tasksClaimedDir);
  await ensureDir(paths.tasksBlockedDir);
  await ensureDir(paths.tasksDoneDir);
  await ensureDir(paths.handoffsDir);
  await ensureDir(paths.evidenceDir);
  await ensureDir(paths.gatesDir);
  await ensureDir(paths.eventsOutboxDir);
  await ensureDir(paths.eventsHandledDir);
  await ensureDir(paths.eventsFailedDir);
  await ensureDir(paths.reviewPacketsDir);
}

export async function moveFileAtomic(source, destination) {
  await ensureDir(path.dirname(destination));
  await fs.rename(source, destination);
}

export function lockDirForPath(paths, normalizedPath) {
  return path.join(paths.locksDir, `${shaId(normalizedPath)}.lockdir`);
}

export function lockMetadataFile(lockDir) {
  return path.join(lockDir, "metadata.json");
}
