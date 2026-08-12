import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createProductionUpdateManager } from "./production-update-manager.mjs";

const SHA = "a".repeat(40);

test("production factory composes source, verifier, client recovery, probes, and scheduler", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hp-production-manager-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspaceRoot = path.join(root, "workspace");
  const managedRoot = path.join(root, "managed");
  await fs.mkdir(workspaceRoot);
  const events = [];
  const manager = await createProductionUpdateManager({
    workspaceRoot,
    managedRoot,
    machineId: "fixture-machine",
    source: {
      resolve: async () => ({ sha: SHA, ref: "refs/heads/main", remote: "fixture" }),
      stage: async ({ directory }) => {
        await fs.mkdir(path.join(directory, "src", "hp-mha-serena"), { recursive: true });
        await fs.writeFile(path.join(directory, "src", "server.mjs"), "export {};\n", "utf8");
        await fs.writeFile(path.join(directory, "src", "hp-mha-serena", "server.mjs"), "export {};\n", "utf8");
      }
    },
    verifier: async () => ({ ok: true, evidenceDigest: "proof-" + SHA }),
    clientInstaller: async () => {
      events.push("clients");
      return { ok: true, snapshot: { manifestFile: "fixture", allowedFiles: [] } };
    },
    clientRestorer: async () => ({ ok: true }),
    probe: async ({ server }) => {
      events.push("probe:" + server);
      return { ok: true };
    },
    scheduler: {
      install: async () => ({ ok: true }),
      inspect: async () => ({ ok: true, status: "installed" }),
      remove: async () => ({ ok: true })
    }
  });
  assert.equal((await manager.status()).currentSha, null);
  assert.equal((await manager.apply()).status, "activated");
  assert.deepEqual(events, ["clients", "probe:hermes3d-locks", "probe:hp-mha-serena"]);
});

test("production factory refuses an unsafe managed root", async () => {
  await assert.rejects(
    createProductionUpdateManager({
      workspaceRoot: process.cwd(),
      managedRoot: path.parse(process.cwd()).root,
      machineId: "fixture-machine"
    }),
    /unsafe managed root/
  );
});
