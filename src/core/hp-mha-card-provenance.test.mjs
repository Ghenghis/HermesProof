import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { verifyLocalHarnessCardProvenance } from "./hp-mha-card-provenance.mjs";

const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();
}

test("local HermesProof card is bound to a real unchanged implementation commit", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hp-card-provenance-"));
  try {
    await fs.mkdir(path.join(root, "src", "core"), { recursive: true });
    await fs.mkdir(path.join(root, "scripts"), { recursive: true });
    await fs.mkdir(path.join(root, "config"), { recursive: true });
    const packageText = JSON.stringify({ name: "hermesproof", version: "0.9.2" }) + "\n";
    const lockText = JSON.stringify({ name: "hermesproof", lockfileVersion: 3 }) + "\n";
    await fs.writeFile(path.join(root, "package.json"), packageText);
    await fs.writeFile(path.join(root, "package-lock.json"), lockText);
    await fs.writeFile(path.join(root, "src", "core", "hermes-agent-bridge.mjs"), "export const bridge = true;\n");
    await fs.writeFile(path.join(root, "scripts", "gate.mjs"), "export const gate = true;\n");
    await fs.writeFile(path.join(root, "config", "release.json"), "{}\n");
    git(root, ["init"]);
    git(root, ["add", "."]);
    git(root, ["-c", "user.name=Hermes Test", "-c", "user.email=test@example.invalid", "commit", "-m", "fixture"]);
    const commit = git(root, ["rev-parse", "HEAD"]);
    const cardRaw = {
      card_id: "hermesproof_v0.9.2_hp_mha_real",
      layers: { execution: {
        installed_commit: commit,
        repo_commit: commit,
        repo_dirty: false,
        package_sha256: digest(packageText),
        dependency_lock_sha256: digest(lockText)
      } }
    };

    const valid = await verifyLocalHarnessCardProvenance({ cardRaw, repoRoot: root });
    assert.equal(valid.ok, true);
    assert.equal(valid.scope, "local-implementation");

    await fs.writeFile(path.join(root, "scripts", "gate.mjs"), "export const gate = false;\n");
    const drifted = await verifyLocalHarnessCardProvenance({ cardRaw, repoRoot: root });
    assert.equal(drifted.ok, false);
    assert.match(drifted.reason, /drift|dirty/i);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("local HermesAgent card verifies the exact bridge source hash", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hp-agent-card-provenance-"));
  try {
    await fs.mkdir(path.join(root, "src", "core"), { recursive: true });
    await fs.mkdir(path.join(root, "scripts"));
    await fs.mkdir(path.join(root, "config"));
    const packageText = "{}\n";
    const lockText = "{}\n";
    const bridgeText = "export const bridge = true;\n";
    await fs.writeFile(path.join(root, "package.json"), packageText);
    await fs.writeFile(path.join(root, "package-lock.json"), lockText);
    await fs.writeFile(path.join(root, "src", "core", "hermes-agent-bridge.mjs"), bridgeText);
    git(root, ["init"]);
    git(root, ["add", "."]);
    git(root, ["-c", "user.name=Hermes Test", "-c", "user.email=test@example.invalid", "commit", "-m", "fixture"]);
    const commit = git(root, ["rev-parse", "HEAD"]);
    const cardRaw = {
      card_id: "hermesagent_bridge_v0.9.2_real",
      layers: { execution: {
        installed_commit: commit,
        repo_commit: commit,
        repo_dirty: false,
        package_sha256: digest(bridgeText),
        dependency_lock_sha256: digest(lockText)
      } }
    };
    assert.equal((await verifyLocalHarnessCardProvenance({ cardRaw, repoRoot: root })).ok, true);
    cardRaw.layers.execution.package_sha256 = "a".repeat(64);
    assert.equal((await verifyLocalHarnessCardProvenance({ cardRaw, repoRoot: root })).ok, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
