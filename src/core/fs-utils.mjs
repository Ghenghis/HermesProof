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

export async function writeJsonAtomic(file, value) {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  await fs.rename(tmp, file);
}

export async function appendJsonLine(file, value) {
  await ensureDir(path.dirname(file));
  await fs.appendFile(file, JSON.stringify(value) + "\n", "utf8");
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
  return {
    root: workspaceRoot,
    stateDirName: dirName,
    stateDir,
    locksDir: path.join(stateDir, "locks"),
    tasksDir: path.join(stateDir, "tasks"),
    handoffsDir: path.join(stateDir, "handoffs"),
    evidenceDir: path.join(stateDir, "evidence"),
    gatesDir: path.join(stateDir, "gates"),
    eventsFile: path.join(stateDir, "events.ndjson"),
    evidenceFile: path.join(stateDir, "evidence", "ledger.ndjson"),
    configFile: path.join(stateDir, "config.json")
  };
}

export async function initStateDirs(paths) {
  await ensureDir(paths.stateDir);
  await ensureDir(paths.locksDir);
  await ensureDir(paths.tasksDir);
  await ensureDir(paths.handoffsDir);
  await ensureDir(paths.evidenceDir);
  await ensureDir(paths.gatesDir);
}

export function lockDirForPath(paths, normalizedPath) {
  return path.join(paths.locksDir, `${shaId(normalizedPath)}.lockdir`);
}

export function lockMetadataFile(lockDir) {
  return path.join(lockDir, "metadata.json");
}
