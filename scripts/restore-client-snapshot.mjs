#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { restoreClientConfigSnapshot } from "../src/core/client-config-snapshot.mjs";

export async function restoreSnapshotCli(argv = process.argv.slice(2), environment = process.env) {
  const index = argv.indexOf("--manifest");
  const digestIndex = argv.indexOf("--sha256");
  if (index < 0 || !argv[index + 1] || digestIndex < 0 || !argv[digestIndex + 1] || argv.length !== 4) {
    throw new Error("--manifest and --sha256 are required");
  }
  const managedRoot = path.resolve(environment.HERMESPROOF_MANAGED_ROOT || path.join(os.homedir(), ".hermesproof-managed"));
  const manifestFile = path.resolve(argv[index + 1]);
  const backupsRoot = path.join(managedRoot, "backups", "clients");
  const relative = path.relative(backupsRoot, manifestFile);
  if (!relative || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) throw new Error("snapshot manifest is outside the managed backup root");
  const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
  if (!Array.isArray(manifest.entries)) throw new Error("snapshot manifest entries are invalid");
  const allowedFiles = manifest.entries.map((entry) => path.resolve(entry.file));
  return await restoreClientConfigSnapshot({ manifestFile, manifestSha256: argv[digestIndex + 1], allowedFiles });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  restoreSnapshotCli().then((result) => {
    process.stdout.write(JSON.stringify(result) + "\n");
    process.exitCode = result.ok === false ? 1 : 0;
  }).catch((error) => {
    process.stderr.write("Client snapshot restore failed: " + error.message + "\n");
    process.exitCode = 1;
  });
}
