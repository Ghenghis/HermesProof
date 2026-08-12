#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

import { probeKiloBackend } from "../src/core/kilo-backend-kit.mjs";

function valueAfter(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] || null;
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

const extensionVersion = valueAfter("--extension-version") || "7.10.0-rc.25";
const explicitBundle = valueAfter("--bundled-kilo");
const kiloRoot = valueAfter("--kilo-root") || process.env.KILO_RC_ROOT || null;
const bundledKiloPath = explicitBundle || (
  kiloRoot
    ? path.join(kiloRoot, "packages", "kilo-vscode", "bin", process.platform === "win32" ? "kilo.exe" : "kilo")
    : null
);

let packageText = "";
if (kiloRoot) {
  const manifests = [
    path.join(kiloRoot, "packages", "kilo-vscode", "package.json"),
    path.join(kiloRoot, "packages", "kilo-indexing", "package.json")
  ];
  packageText = (
    await Promise.all(manifests.map((file) => fs.readFile(file, "utf8").catch(() => "")))
  ).join("\n");
}
const workspaceRoot = process.cwd();
const report = await probeKiloBackend({
  extensionVersion,
  bundledKiloPath,
  indexing: {
    lancedb_package: /lancedb/iu.test(packageText),
    qdrant_package: /qdrant/iu.test(packageText)
  },
  integrations: {
    hermesproof: await exists(path.join(workspaceRoot, "src", "server.mjs")),
    serena: await exists(path.join(workspaceRoot, "src", "hp-mha-serena", "server.mjs")),
    mcp_config: await exists(path.join(workspaceRoot, "src", "hp-mha-serena", "serena-catalog.mjs")),
    browser_runner: process.env.HERMES_BROWSER_RUNNER_AVAILABLE === "1"
  }
});

const output = process.argv.includes("--compact")
  ? {
      ok: report.ok,
      release: report.release,
      release_blockers: report.release_blockers,
      required_capabilities: report.required_capabilities,
      components: report.components,
      bundled_kilo: report.inventory.bundled_kilo
    }
  : report;
process.stdout.write(JSON.stringify(output, null, 2) + "\n");
if (!report.ok) process.exitCode = 1;
