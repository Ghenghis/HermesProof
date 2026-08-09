import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const PRODUCT_ROOTS = new Set([
  ".github",
  ".githooks",
  ".windsurf",
  "ci",
  "docs",
  "examples",
  "handoffs",
  "policies",
  "prompts",
  "PROOF",
  "scripts",
  "site",
  "src"
]);

const ROOT_FILES = new Set([
  ".coderabbit.yaml",
  ".env.example",
  ".gitignore",
  ".gitlab-ci.yml",
  ".gitleaks.toml",
  "AGENTS.md",
  "CHANGELOG.md",
  "CODEX_NEXT_PROMPTS.md",
  "FINAL_EVIDENCE_REPORT.md",
  "LICENSE",
  "Missing-Features.md",
  "README.md",
  "hermesproof_claude20_codex_handoff_master_prompt.md",
  "package-lock.json",
  "package.json",
  "PROOF_E2E_REPORT.md",
  "PROOF_LOCAL_TEST.md",
  "PROOF_SANDBOX_TEST.md"
]);

const BLOCKED_ROOTS = new Set(["PERF", "tools"]);
const BLOCKED_SEGMENTS = new Set([
  ".git",
  ".hermes3d_orchestrator",
  ".kilo",
  ".cache",
  ".worktrees",
  "__pycache__",
  "build",
  "cache",
  "coverage",
  "dist",
  "node_modules",
  "temp",
  "tmp",
  "worktrees"
]);

function portablePath(value) {
  return String(value ?? "").replaceAll("\\", "/");
}

function secretLike(relativePath) {
  const basename = path.posix.basename(relativePath).toLowerCase();
  if (basename === ".env.example") return false;
  return (
    basename === ".env" ||
    basename.startsWith(".env.") ||
    /^secrets?(\.|$)/.test(basename) ||
    /^credentials?(\.|$)/.test(basename) ||
    basename === "id_rsa" ||
    basename === "id_ed25519" ||
    basename.endsWith(".pem") ||
    basename.endsWith(".p12") ||
    basename.endsWith(".pfx") ||
    basename.endsWith(".key")
  );
}

export function classifyRecoveryPath(input) {
  const relativePath = portablePath(input);
  if (
    !relativePath ||
    relativePath.includes("\0") ||
    path.posix.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath)
  ) {
    return { allowed: false, reason: "unsafe-path" };
  }

  const segments = relativePath.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return { allowed: false, reason: "unsafe-path" };
  }

  if (BLOCKED_ROOTS.has(segments[0])) {
    return { allowed: false, reason: `blocked-root:${segments[0]}` };
  }

  const blockedSegment = segments.find((segment) => BLOCKED_SEGMENTS.has(segment.toLowerCase()));
  if (blockedSegment) {
    return { allowed: false, reason: `blocked-segment:${blockedSegment}` };
  }

  if (secretLike(relativePath)) {
    return { allowed: false, reason: "secret-like-file" };
  }

  if (segments.length === 1) {
    return ROOT_FILES.has(relativePath)
      ? { allowed: true, reason: `root-file:${relativePath}` }
      : { allowed: false, reason: "unrecognized-root-file" };
  }

  if (PRODUCT_ROOTS.has(segments[0])) {
    return { allowed: true, reason: `product-root:${segments[0]}` };
  }

  return { allowed: false, reason: "unrecognized-root" };
}

export function isPathInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function sha256File(file) {
  const hash = crypto.createHash("sha256");
  const handle = await fs.open(file, "r");
  try {
    for await (const chunk of handle.createReadStream()) {
      hash.update(chunk);
    }
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

export function stableManifest(manifest) {
  return {
    ...manifest,
    selected: [...(manifest.selected ?? [])].sort((a, b) => a.path.localeCompare(b.path)),
    excluded: [...(manifest.excluded ?? [])].sort((a, b) => a.path.localeCompare(b.path))
  };
}

export function publicRecoveryManifest(manifest) {
  const sourceRoot = portablePath(manifest.source_root);
  const destinationRoot = portablePath(manifest.destination_root);
  const excludedSummary = {};
  for (const entry of manifest.excluded ?? []) {
    excludedSummary[entry.reason] = (excludedSummary[entry.reason] ?? 0) + 1;
  }

  return {
    schema: "hermesproof.source-recovery.public.v1",
    observed_utc: manifest.observed_utc,
    source_branch: manifest.source_branch,
    source_head: manifest.source_head,
    source_root_sha256: crypto.createHash("sha256").update(sourceRoot).digest("hex"),
    destination_root_sha256: crypto.createHash("sha256").update(destinationRoot).digest("hex"),
    selected_count: manifest.selected_count ?? manifest.selected?.length ?? 0,
    excluded_count: manifest.excluded_count ?? manifest.excluded?.length ?? 0,
    selected_bytes: manifest.selected_bytes ?? 0,
    selected: [...(manifest.selected ?? [])].sort((a, b) => a.path.localeCompare(b.path)),
    excluded_summary: Object.fromEntries(
      Object.entries(excludedSummary).sort(([a], [b]) => a.localeCompare(b))
    )
  };
}

function gitBuffer(repository, args) {
  return execFileSync("git", ["-C", repository, ...args], {
    encoding: "buffer",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024
  });
}

function nulPaths(buffer) {
  return buffer
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map(portablePath);
}

function gitText(repository, args) {
  return gitBuffer(repository, args).toString("utf8").trim();
}

async function atomicJson(file, value) {
  const target = path.resolve(file);
  const temporary = `${target}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporary, target);
}

export async function createRecoveryManifest({ source, destination, manifestPath, publicManifestPath }) {
  const sourceRoot = path.resolve(source);
  const destinationRoot = path.resolve(destination);
  if (sourceRoot === destinationRoot) throw new Error("source and destination must differ");

  const tracked = new Set([
    ...nulPaths(gitBuffer(sourceRoot, ["diff", "--name-only", "-z", "--diff-filter=ACMRTUXB"])),
    ...nulPaths(gitBuffer(sourceRoot, ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMRTUXB"]))
  ]);
  const deleted = new Set([
    ...nulPaths(gitBuffer(sourceRoot, ["diff", "--name-only", "-z", "--diff-filter=D"])),
    ...nulPaths(gitBuffer(sourceRoot, ["diff", "--cached", "--name-only", "-z", "--diff-filter=D"]))
  ]);
  const untracked = new Set(
    nulPaths(gitBuffer(sourceRoot, ["ls-files", "--others", "--exclude-standard", "-z"]))
  );

  const dirtyPaths = [...new Set([...tracked, ...deleted, ...untracked])].sort();
  const selected = [];
  const excluded = [];

  for (const relativePath of dirtyPaths) {
    const classification = classifyRecoveryPath(relativePath);
    const status = deleted.has(relativePath)
      ? "deleted"
      : untracked.has(relativePath)
        ? "untracked"
        : "tracked-modified";

    if (!classification.allowed || status === "deleted") {
      excluded.push({
        path: relativePath,
        status,
        reason: status === "deleted" ? "source-deletion-not-auto-applied" : classification.reason
      });
      continue;
    }

    const sourceFile = path.resolve(sourceRoot, ...relativePath.split("/"));
    if (!isPathInside(sourceRoot, sourceFile)) {
      excluded.push({ path: relativePath, status, reason: "source-path-escape" });
      continue;
    }

    const stat = await fs.stat(sourceFile).catch(() => null);
    if (!stat?.isFile()) {
      excluded.push({ path: relativePath, status, reason: "not-a-regular-file" });
      continue;
    }

    selected.push({
      path: relativePath,
      status,
      reason: classification.reason,
      bytes: stat.size,
      sha256: await sha256File(sourceFile)
    });
  }

  const manifest = stableManifest({
    schema: "hermesproof.source-recovery.v1",
    observed_utc: new Date().toISOString(),
    source_root: sourceRoot,
    source_branch: gitText(sourceRoot, ["branch", "--show-current"]),
    source_head: gitText(sourceRoot, ["rev-parse", "HEAD"]),
    destination_root: destinationRoot,
    selected_count: selected.length,
    excluded_count: excluded.length,
    selected_bytes: selected.reduce((total, entry) => total + entry.bytes, 0),
    selected,
    excluded
  });

  await atomicJson(manifestPath, manifest);
  if (publicManifestPath) await atomicJson(publicManifestPath, publicRecoveryManifest(manifest));
  return manifest;
}

export async function applyRecoveryManifest({ manifestPath }) {
  const manifest = JSON.parse(await fs.readFile(path.resolve(manifestPath), "utf8"));
  if (manifest.schema !== "hermesproof.source-recovery.v1") {
    throw new Error("unsupported recovery manifest schema");
  }

  const sourceRoot = path.resolve(manifest.source_root);
  const destinationRoot = path.resolve(manifest.destination_root);
  const currentHead = gitText(sourceRoot, ["rev-parse", "HEAD"]);
  if (currentHead !== manifest.source_head) {
    throw new Error(`source HEAD changed: expected ${manifest.source_head}, got ${currentHead}`);
  }

  let copiedBytes = 0;
  for (const entry of manifest.selected) {
    const classification = classifyRecoveryPath(entry.path);
    if (!classification.allowed) throw new Error(`manifest path is no longer allowed: ${entry.path}`);

    const sourceFile = path.resolve(sourceRoot, ...entry.path.split("/"));
    const destinationFile = path.resolve(destinationRoot, ...entry.path.split("/"));
    if (!isPathInside(sourceRoot, sourceFile) || !isPathInside(destinationRoot, destinationFile)) {
      throw new Error(`recovery path escaped its root: ${entry.path}`);
    }

    const stat = await fs.stat(sourceFile);
    const hash = await sha256File(sourceFile);
    if (stat.size !== entry.bytes || hash !== entry.sha256) {
      throw new Error(`source changed after audit: ${entry.path}`);
    }

    await fs.mkdir(path.dirname(destinationFile), { recursive: true });
    await fs.copyFile(sourceFile, destinationFile);
    const copiedHash = await sha256File(destinationFile);
    if (copiedHash !== entry.sha256) {
      throw new Error(`destination verification failed: ${entry.path}`);
    }
    copiedBytes += stat.size;
  }

  return {
    ok: true,
    copied_count: manifest.selected.length,
    copied_bytes: copiedBytes,
    source_head: manifest.source_head
  };
}

function readArg(name) {
  const value = optionalArg(name);
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

function optionalArg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 || !process.argv[index + 1] ? null : process.argv[index + 1];
}

async function main() {
  const command = process.argv[2];
  if (command === "audit") {
    const result = await createRecoveryManifest({
      source: readArg("--source"),
      destination: readArg("--destination"),
      manifestPath: readArg("--manifest"),
      publicManifestPath: optionalArg("--public-manifest")
    });
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        selected_count: result.selected_count,
        excluded_count: result.excluded_count,
        selected_bytes: result.selected_bytes,
        source_head: result.source_head
      })}\n`
    );
    return;
  }

  if (command === "apply") {
    const result = await applyRecoveryManifest({ manifestPath: readArg("--manifest") });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  throw new Error("usage: recover-source-snapshot.mjs <audit|apply> --manifest <path> [--source <path> --destination <path>]");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}
