#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  MANAGED_SERVER_NAMES,
  MANAGED_UPDATER_SCHEMA
} from "../src/updater/managed-updater.mjs";
import {
  createUpdaterPathPolicy,
  validateReleaseSha
} from "../src/updater/path-policy.mjs";

const SERVER_ENTRIES = Object.freeze({
  "hermes3d-locks": ["src", "server.mjs"],
  "hp-mha-serena": ["src", "hp-mha-serena", "server.mjs"]
});

async function readJson(file, label) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    throw new Error(label + " is unreadable or invalid: " + error.message);
  }
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export async function resolveManagedServer({ managedRoot, server } = {}) {
  if (!MANAGED_SERVER_NAMES.includes(server) || !SERVER_ENTRIES[server]) {
    throw new Error("server is not allowlisted");
  }
  const policy = await createUpdaterPathPolicy({
    managedRoot,
    homeDirectory: os.homedir()
  });
  const active = await readJson(path.join(policy.managedRoot, "state", "active-release.json"), "active release state");
  if (active?.schema !== MANAGED_UPDATER_SCHEMA) throw new Error("active release schema is invalid");
  const sha = validateReleaseSha(active.currentSha);
  const registry = await readJson(path.join(policy.managedRoot, "state", "releases.json"), "release registry");
  if (registry?.schema !== MANAGED_UPDATER_SCHEMA || !Array.isArray(registry.releases)) {
    throw new Error("release registry schema is invalid");
  }
  const release = registry.releases.find((item) => item.sha === sha && item.state === "known-good");
  if (!release) throw new Error("active release is not known-good");
  const expectedDirectory = policy.releaseDirectory(sha);
  if (!samePath(release.directory, expectedDirectory)) throw new Error("release directory mismatch");
  if (typeof release.evidenceDigest !== "string" || release.evidenceDigest.length === 0) {
    throw new Error("known-good release evidence is missing");
  }
  const serverFile = policy.assertContained(path.join(expectedDirectory, ...SERVER_ENTRIES[server]));
  const stat = await fs.lstat(serverFile);
  if (stat.isSymbolicLink()) throw new Error("server entry is a link or junction");
  if (!stat.isFile()) throw new Error("server entry is not a file");
  const realServerFile = await fs.realpath(serverFile);
  policy.assertContained(realServerFile);
  if (!samePath(realServerFile, serverFile)) throw new Error("server entry resolved outside its immutable path");
  return serverFile;
}

function parseArguments(argv) {
  let server = null;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--server") server = argv[++index];
    else if (argv[index].startsWith("--server=")) server = argv[index].slice("--server=".length);
    else throw new Error("unknown launcher argument: " + argv[index]);
  }
  return { server };
}

export async function launchManagedServer({
  argv = process.argv.slice(2),
  environment = process.env,
  spawnImpl = spawn
} = {}) {
  const { server } = parseArguments(argv);
  const managedRoot = path.resolve(
    environment.HERMESPROOF_MANAGED_ROOT || path.join(os.homedir(), ".hermesproof-managed")
  );
  const serverFile = await resolveManagedServer({ managedRoot, server });
  return await new Promise((resolve, reject) => {
    const child = spawnImpl(process.execPath, [serverFile], {
      env: environment,
      shell: false,
      windowsHide: true,
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) reject(new Error("managed server exited from signal " + signal));
      else resolve(code ?? 1);
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await launchManagedServer();
  } catch (error) {
    process.stderr.write("HermesProof launcher failed: " + error.message + "\n");
    process.exitCode = 1;
  }
}
