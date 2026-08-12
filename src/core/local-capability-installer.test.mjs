import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createLocalCapabilityInstaller } from "./local-capability-installer.mjs";

const integrity = "sha512-" + Buffer.from("fixture-integrity").toString("base64");

test("local installer creates an isolated pinned npm pack with hashes, SBOM, and health proof", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hp-installer-"));
  const sandbox = path.join(workspaceRoot, ".hermes3d_orchestrator", "capability-packs", "fixture", "1.2.3");
  const commandRunner = async ({ cwd }) => {
    const packageDir = path.join(cwd, "node_modules", "@fixture", "cli");
    await fs.mkdir(path.join(packageDir, "bin"), { recursive: true });
    await fs.writeFile(path.join(packageDir, "package.json"), JSON.stringify({ name: "@fixture/cli", version: "1.2.3", bin: { fixture: "bin/cli.mjs" } }));
    await fs.writeFile(path.join(packageDir, "bin", "cli.mjs"), "console.log('1.2.3')\n");
    await fs.writeFile(path.join(cwd, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/@fixture/cli": { version: "1.2.3", integrity } } }));
  };
  try {
    const installer = createLocalCapabilityInstaller({ workspaceRoot, commandRunner });
    const receipt = await installer({
      pack: { id: "fixture", version: "1.2.3", source: { type: "npm", package: "@fixture/cli", integrity }, schema_sha256: "d".repeat(64), health_probe: { args: ["--version"] } },
      plan: { sandbox_path: sandbox }
    });
    assert.match(receipt.executable_sha256, /^[a-f0-9]{64}$/);
    assert.match(receipt.sbom_sha256, /^[a-f0-9]{64}$/);
    assert.equal(receipt.schema_sha256, "d".repeat(64));
    assert.equal(receipt.package_integrity, integrity);
    assert.equal(receipt.health.ok, true);
    assert.equal(receipt.enabled, false);
    assert.equal((await fs.stat(path.join(sandbox, "sbom.spdx.json"))).isFile(), true);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("local installer rejects path escape before invoking npm", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hp-installer-"));
  let called = false;
  try {
    const installer = createLocalCapabilityInstaller({ workspaceRoot, commandRunner: async () => { called = true; } });
    await assert.rejects(installer({ pack: { id: "fixture", version: "1.2.3", source: { type: "npm", package: "x", integrity }, schema_sha256: "d".repeat(64) }, plan: { sandbox_path: path.join(workspaceRoot, "outside") } }), /sandbox path/i);
    assert.equal(called, false);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});
