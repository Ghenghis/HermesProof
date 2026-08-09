import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createLocalProcessAdapter } from "./local-process-adapter.mjs";

async function sha256(file) {
  return crypto.createHash("sha256").update(await fs.readFile(file)).digest("hex");
}

test("local process adapter verifies, starts, probes, and stops one leased runtime", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hp-process-"));
  const adapter = createLocalProcessAdapter({ workspaceRoot, stopTimeoutMs: 2000 });
  const manifest = {
    id: "fixture-runtime",
    command: [process.execPath, "-e", "setInterval(() => {}, 1000)"],
    executable_sha256: await sha256(process.execPath),
    tools: ["fixture.read"],
    permissions: ["workspace:read"]
  };
  const lease = { id: "lease-fixture", workspace: workspaceRoot };
  try {
    const started = await adapter.start(manifest, lease);
    assert.ok(Number.isInteger(started.pid));
    assert.equal((await adapter.health(manifest, lease)).ok, true);
    await adapter.stop(manifest, lease);
    assert.equal((await adapter.health(manifest, lease)).ok, false);
    await assert.rejects(
      adapter.start({ ...manifest, executable_sha256: "0".repeat(64) }, lease),
      /digest mismatch/i
    );
  } finally {
    await adapter.stop(manifest, lease).catch(() => {});
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});
