import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const COMMIT_RE = /^[a-f0-9]{40}$/u;
const PRODUCT_PATHS = ["src", "scripts", "config", "package.json", "package-lock.json"];

async function sha256File(file) {
  return crypto.createHash("sha256").update(await fs.readFile(file)).digest("hex");
}

async function runGit(repoRoot, args) {
  const result = await execFileAsync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: 1024 * 1024
  });
  return String(result.stdout || "").trim();
}

function localKind(cardRaw, cardPath) {
  const file = cardPath ? path.basename(cardPath).toLowerCase() : "";
  const id = String(cardRaw?.card_id || "").toLowerCase();
  if (file === "hermesproof.json" || id.startsWith("hermesproof_")) return "hermesproof";
  if (file === "hermesagent.json" || id.startsWith("hermesagent_")) return "hermesagent";
  return null;
}

function failure(kind, reason, details = {}) {
  return { ok: false, scope: "local-implementation", kind, reason, ...details };
}

export async function verifyLocalHarnessCardProvenance({ cardRaw, cardPath, repoRoot } = {}) {
  const kind = localKind(cardRaw, cardPath);
  if (!kind) return { ok: true, scope: "declared-only", kind: null, reason: "external installed identity is not locally reproducible" };
  const root = path.resolve(repoRoot || "");
  const execution = cardRaw?.layers?.execution;
  if (!repoRoot || !execution) return failure(kind, "local card execution provenance is missing");
  if (!COMMIT_RE.test(execution.installed_commit || "") ||
      execution.repo_commit !== execution.installed_commit || execution.repo_dirty !== false) {
    return failure(kind, "local card must bind one clean 40-character implementation commit");
  }

  try {
    await runGit(root, ["cat-file", "-e", execution.installed_commit + "^{commit}"]);
    await runGit(root, ["merge-base", "--is-ancestor", execution.installed_commit, "HEAD"]);
  } catch {
    return failure(kind, "local card implementation commit is missing or is not an ancestor of HEAD");
  }

  const committedDrift = await runGit(root, ["diff", "--name-only", execution.installed_commit, "--", ...PRODUCT_PATHS]);
  const workingDrift = await runGit(root, ["status", "--porcelain", "--untracked-files=all", "--", ...PRODUCT_PATHS]);
  if (committedDrift || workingDrift) {
    return failure(kind, "local product sources drifted or are dirty after the card's implementation commit", {
      committed_drift: committedDrift ? committedDrift.split(/\r?\n/u) : [],
      working_drift: workingDrift ? workingDrift.split(/\r?\n/u) : []
    });
  }

  const packageFile = kind === "hermesagent"
    ? path.join(root, "src", "core", "hermes-agent-bridge.mjs")
    : path.join(root, "package.json");
  const packageSha256 = await sha256File(packageFile);
  const dependencyLockSha256 = await sha256File(path.join(root, "package-lock.json"));
  if (execution.package_sha256 !== packageSha256 ||
      execution.dependency_lock_sha256 !== dependencyLockSha256) {
    return failure(kind, "local package or dependency-lock digest does not match the retained card", {
      package_sha256: packageSha256,
      dependency_lock_sha256: dependencyLockSha256
    });
  }
  return {
    ok: true,
    scope: "local-implementation",
    kind,
    reason: "local card matches an unchanged clean implementation commit",
    implementation_commit: execution.installed_commit,
    package_sha256: packageSha256,
    dependency_lock_sha256: dependencyLockSha256
  };
}
