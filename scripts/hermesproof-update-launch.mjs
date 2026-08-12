#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MANAGED_UPDATER_SCHEMA } from "../src/updater/managed-updater.mjs";
import { createUpdaterPathPolicy, validateReleaseSha } from "../src/updater/path-policy.mjs";

async function readJson(file, label, optional = false) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (optional && error?.code === "ENOENT") return null;
    throw new Error(label + " is unreadable or invalid: " + error.message);
  }
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export async function resolveManagedUpdater({ managedRoot } = {}) {
  const policy = await createUpdaterPathPolicy({ managedRoot, homeDirectory: os.homedir() });
  const active = await readJson(path.join(policy.managedRoot, "state", "active-release.json"), "active release state");
  if (active?.schema !== MANAGED_UPDATER_SCHEMA) throw new Error("active release schema is invalid");
  const sha = validateReleaseSha(active.currentSha);
  const registry = await readJson(path.join(policy.managedRoot, "state", "releases.json"), "release registry");
  if (registry?.schema !== MANAGED_UPDATER_SCHEMA || !Array.isArray(registry.releases)) {
    throw new Error("release registry schema is invalid");
  }
  const release = registry.releases.find((item) => item.sha === sha && item.state === "known-good");
  if (!release || typeof release.evidenceDigest !== "string" || !release.evidenceDigest) {
    throw new Error("active release is not evidence-bound known-good");
  }
  const releaseDirectory = policy.releaseDirectory(sha);
  if (!samePath(release.directory, releaseDirectory)) throw new Error("release directory mismatch");
  const updaterFile = policy.assertContained(path.join(releaseDirectory, "scripts", "hermesproof-update.mjs"));
  const stat = await fs.lstat(updaterFile);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("updater entry is invalid");
  const real = await fs.realpath(updaterFile);
  policy.assertContained(real);
  if (!samePath(real, updaterFile)) throw new Error("updater entry resolved outside immutable release");
  const install = await readJson(path.join(policy.managedRoot, "state", "install.json"), "install state", true);
  const workspaceRoot = install?.workspaceRoot && path.isAbsolute(install.workspaceRoot)
    ? path.resolve(install.workspaceRoot)
    : null;
  return { managedRoot: policy.managedRoot, workspaceRoot, updaterFile, releaseDirectory, sha };
}

export async function launchManagedUpdater({
  argv = process.argv.slice(2),
  environment = process.env,
  spawnImpl = spawn
} = {}) {
  const managedRoot = path.resolve(
    environment.HERMESPROOF_MANAGED_ROOT || path.join(os.homedir(), ".hermesproof-managed")
  );
  const resolved = await resolveManagedUpdater({ managedRoot });
  const controlDirectory = path.dirname(fileURLToPath(import.meta.url));
  return await new Promise((resolve, reject) => {
    const child = spawnImpl(process.execPath, [resolved.updaterFile, ...argv], {
      cwd: resolved.releaseDirectory,
      env: {
        ...environment,
        HERMESPROOF_MANAGED_ROOT: resolved.managedRoot,
        HERMESPROOF_LAUNCHER_PATH: path.join(controlDirectory, "hermesproof-launch.mjs"),
        HERMESPROOF_UPDATER_LAUNCHER_PATH: fileURLToPath(import.meta.url),
        ...(resolved.workspaceRoot ? {
          MCP_LOCK_WORKSPACE: resolved.workspaceRoot,
          HERMES_WORKSPACE_ROOT: resolved.workspaceRoot
        } : {})
      },
      shell: false,
      windowsHide: true,
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) reject(new Error("managed updater exited from signal " + signal));
      else resolve(code ?? 1);
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  launchManagedUpdater().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write("HermesProof updater launcher failed: " + error.message + "\n");
    process.exitCode = 1;
  });
}
