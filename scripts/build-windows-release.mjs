#!/usr/bin/env node
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { loadReleaseFacts } from "../src/core/release-facts.mjs";

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(here, "..");
const EXCLUDED = [
  /^(?:\.git|\.github|node_modules|dist|coverage)(?:\/|$)/,
  /^(?:\.hermes3d_orchestrator|\.mcp_lock_orchestrator|\.kilo|\.idea|\.vscode|\.claude)(?:\/|$)/,
  /^(?:G_private|private_keys)(?:\/|$)/,
  /^handoffs\/STREAM\/backups(?:\/|$)/,
  /(?:^|\/)(?:secrets?\.json|secrets?\.txt)$/i,
  /(?:^|\/)\.env(?:\..*)?$/i,
  /\.(?:log|tmp|swp)$/i,
];

function normalized(relative) {
  return String(relative).replaceAll("\\", "/").replace(/^\.\//, "");
}

export function filterReleasePaths(files) {
  return files.map(normalized).filter((file) => {
    if (!file || file.startsWith("/") || file.includes("../") || file.includes("\0")) return false;
    if (file === ".env.example") return true;
    return !EXCLUDED.some((pattern) => pattern.test(file));
  });
}

async function sha256File(file) {
  const hash = crypto.createHash("sha256");
  const handle = await fs.open(file, "r");
  try {
    for await (const chunk of handle.readableWebStream()) hash.update(Buffer.from(chunk));
  } finally {
    await handle.close().catch(() => {});
  }
  return hash.digest("hex");
}

export async function createReleaseManifest({ root, files, version, sourceSha }) {
  if (!/^[0-9a-f]{40,64}$/.test(sourceSha || "")) throw new Error("source SHA is invalid");
  const entries = [];
  for (const relative of filterReleasePaths(files).sort()) {
    const absolute = path.resolve(root, relative);
    const within = path.relative(path.resolve(root), absolute);
    if (!within || within.startsWith(".." + path.sep) || path.isAbsolute(within)) throw new Error("manifest path escapes root");
    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("release payload contains a link or non-file: " + relative);
    entries.push({ path: relative, bytes: stat.size, sha256: await sha256File(absolute) });
  }
  return {
    schema: "hermesproof.windows-release.v1",
    version, sourceSha, platform: "win32", arch: "x64",
    generatedUtc: new Date().toISOString(), files: entries
  };
}

export async function verifyReleaseManifest({ root, manifest }) {
  if (manifest?.schema !== "hermesproof.windows-release.v1" || !Array.isArray(manifest.files)) {
    throw new Error("release manifest is invalid");
  }
  const mismatches = [];
  for (const entry of manifest.files) {
    const relative = normalized(entry.path);
    const absolute = path.resolve(root, relative);
    const within = path.relative(path.resolve(root), absolute);
    if (!within || within.startsWith(".." + path.sep) || path.isAbsolute(within)) { mismatches.push(relative); continue; }
    try {
      const stat = await fs.lstat(absolute);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size !== entry.bytes || await sha256File(absolute) !== entry.sha256) mismatches.push(relative);
    } catch { mismatches.push(relative); }
  }
  return { ok: mismatches.length === 0, mismatches };
}

async function trackedFiles(root) {
  const result = await execFileAsync("git", ["ls-files", "-z"], { cwd: root, encoding: "buffer", windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  return result.stdout.toString("utf8").split("\0").filter(Boolean);
}

async function sourceSha(root) {
  const result = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root, windowsHide: true, maxBuffer: 64 * 1024 });
  return String(result.stdout).trim();
}

async function copyPayload({ root, stage, files }) {
  for (const relative of files) {
    const from = path.join(root, relative);
    const stat = await fs.lstat(from);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("release payload contains a link or non-file: " + relative);
    const to = path.join(stage, relative);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(from, to);
  }
}

async function compressWindowsZip({ stage, zipFile }) {
  const safeStage = path.resolve(stage);
  const safeZip = path.resolve(zipFile);
  if (safeStage.includes("'") || safeZip.includes("'")) throw new Error("release path contains an unsupported quote");
  const command = `Compress-Archive -Path '${safeStage}\\*' -DestinationPath '${safeZip}' -CompressionLevel Optimal -Force`;
  await execFileAsync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], {
    windowsHide: true, timeout: 300_000, maxBuffer: 1024 * 1024
  });
}

export async function buildWindowsRelease({ root = defaultRoot, outputRoot = path.join(root, "dist") } = {}) {
  const facts = await loadReleaseFacts({ root });
  const sha = await sourceSha(root);
  const files = filterReleasePaths(await trackedFiles(root));
  for (const required of ["install-hermesproof.ps1", "uninstall-hermesproof.ps1", "scripts/hermesproof-launch.mjs", "scripts/hermesproof-update-launch.mjs"]) {
    if (!files.includes(required)) throw new Error("required release file is not tracked: " + required);
  }
  const name = `HermesProof-${facts.releaseTag}-windows-x64`;
  const stage = path.resolve(outputRoot, name);
  const relative = path.relative(path.resolve(root), stage);
  if (!relative || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) throw new Error("output must stay inside repository");
  await fs.rm(stage, { recursive: true, force: true });
  await fs.mkdir(stage, { recursive: true });
  await copyPayload({ root, stage, files });
  const manifest = await createReleaseManifest({ root: stage, files, version: facts.version, sourceSha: sha });
  await fs.writeFile(path.join(stage, "release-manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  const verified = await verifyReleaseManifest({ root: stage, manifest });
  if (!verified.ok) throw new Error("staged release manifest verification failed");
  const zipFile = path.join(path.resolve(outputRoot), name + ".zip");
  await fs.mkdir(path.dirname(zipFile), { recursive: true });
  await compressWindowsZip({ stage, zipFile });
  const zipSha256 = await sha256File(zipFile);
  const sumsFile = path.join(path.resolve(outputRoot), "SHA256SUMS.txt");
  await fs.writeFile(sumsFile, `${zipSha256}  ${path.basename(zipFile)}\n`, "utf8");
  return { ok: true, version: facts.version, sourceSha: sha, stage, zipFile, sumsFile, zipSha256, fileCount: manifest.files.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildWindowsRelease().then((result) => process.stdout.write(JSON.stringify(result, null, 2) + "\n")).catch((error) => {
    process.stderr.write("Windows release build failed: " + error.message + "\n"); process.exitCode = 1;
  });
}
