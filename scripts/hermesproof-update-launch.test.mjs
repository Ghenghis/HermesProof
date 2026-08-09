import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { launchManagedUpdater } from "./hermesproof-update-launch.mjs";
import { MANAGED_UPDATER_SCHEMA } from "../src/updater/managed-updater.mjs";

test("stable updater launcher resolves only the active known-good release", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hermesproof-update-launch-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sha = "a".repeat(40);
  const release = path.join(root, "releases", sha);
  await fs.mkdir(path.join(release, "scripts"), { recursive: true });
  await fs.mkdir(path.join(root, "state"), { recursive: true });
  await fs.writeFile(path.join(release, "scripts", "hermesproof-update.mjs"), "export {};\n");
  await fs.writeFile(path.join(root, "state", "active-release.json"), JSON.stringify({
    schema: MANAGED_UPDATER_SCHEMA, generation: 1, currentSha: sha, previousSha: null
  }));
  await fs.writeFile(path.join(root, "state", "releases.json"), JSON.stringify({
    schema: MANAGED_UPDATER_SCHEMA,
    releases: [{ sha, state: "known-good", directory: release, evidenceDigest: "proof" }]
  }));
  await fs.writeFile(path.join(root, "state", "install.json"), JSON.stringify({
    schema: "hermesproof.windows-install.v1", workspaceRoot: path.join(root, "workspace")
  }));
  const calls = [];
  const code = await launchManagedUpdater({
    argv: ["status", "--json"],
    environment: { ...process.env, HERMESPROOF_MANAGED_ROOT: root },
    spawnImpl: (command, args, options) => {
      calls.push({ command, args, options });
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("exit", 0, null));
      return child;
    }
  });
  assert.equal(code, 0);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, [path.join(release, "scripts", "hermesproof-update.mjs"), "status", "--json"]);
  assert.equal(calls[0].options.env.HERMESPROOF_MANAGED_ROOT, root);
  assert.equal(calls[0].options.env.MCP_LOCK_WORKSPACE, path.join(root, "workspace"));
  assert.equal(calls[0].options.shell, false);
});
