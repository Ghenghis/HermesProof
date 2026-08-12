import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { RuntimeLifecycleManager } from "./runtime-lifecycle-manager.mjs";

async function withManager(fn) {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hps-runtime-lifecycle-"));
  let now = 1_000_000;
  const actions = [];
  const manager = new RuntimeLifecycleManager({
    workspaceRoot,
    now: () => now,
    processAdapter: {
      async start(manifest) { actions.push(["start", manifest.id]); return { pid: 4242 }; },
      async stop(manifest) { actions.push(["stop", manifest.id]); return { stopped: true }; },
      async health(manifest) { actions.push(["health", manifest.id]); return { ok: true }; }
    }
  });
  await manager.init();
  try {
    await fn({ manager, actions, advance: (ms) => { now += ms; }, workspaceRoot });
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
}

const server = {
  id: "serena",
  kind: "mcp",
  version: "1.7.0",
  executable_sha256: "a".repeat(64),
  command: ["serena", "start-mcp-server"],
  tools: ["semantic.find"],
  permissions: ["workspace:read"],
  default_enabled: false
};

test("unused MCP servers stay disabled until a bounded lease enables them", async () => {
  await withManager(async ({ manager, actions }) => {
    const registered = await manager.register(server);
    assert.equal(registered.runtime.enabled, false);
    assert.equal(actions.length, 0);

    const lease = await manager.issueLease({
      runtimeId: "serena",
      workspace: "fixture",
      owner: "codex",
      taskId: "task-1",
      permissions: ["workspace:read"],
      ttlMs: 60_000
    });
    const enabled = await manager.enable({ runtimeId: "serena", leaseId: lease.lease.id, workspace: "fixture", owner: "codex" });
    assert.equal(enabled.runtime.enabled, true);
    assert.equal(enabled.runtime.pid, 4242);
    assert.deepEqual(actions.map((entry) => entry[0]), ["start", "health"]);
  });
});

test("runtime leases are re-authorized against workspace and owner on every operation", async () => {
  await withManager(async ({ manager }) => {
    await manager.register(server);
    const issued = await manager.issueLease({
      runtimeId: "serena",
      workspace: "fixture",
      owner: "owner-a",
      taskId: "task-a",
      permissions: ["workspace:read"],
      ttlMs: 60_000
    });

    await assert.rejects(
      manager.enable({
        runtimeId: "serena",
        leaseId: issued.lease.id,
        workspace: "fixture",
        owner: "owner-b"
      }),
      /matching active runtime lease/i
    );
    await manager.enable({
      runtimeId: "serena",
      leaseId: issued.lease.id,
      workspace: "fixture",
      owner: "owner-a"
    });
    await assert.rejects(
      manager.cycle({
        runtimeId: "serena",
        leaseId: issued.lease.id,
        workspace: "other-workspace",
        owner: "owner-a"
      }),
      /matching active runtime lease/i
    );
    await assert.rejects(
      manager.revokeLease({
        leaseId: issued.lease.id,
        workspace: "fixture",
        owner: "owner-b"
      }),
      /matching active runtime lease/i
    );

    const hidden = await manager.status({ workspace: "fixture", owner: "owner-b" });
    assert.deepEqual(hidden.leases, []);
    assert.equal(hidden.runtimes[0].active_lease_id, null);
    const owned = await manager.status({ workspace: "fixture", owner: "owner-a" });
    assert.equal(owned.leases.length, 1);
    assert.equal(owned.leases[0].id, issued.lease.id);
  });
});

test("cycle, revoke, and expiry stop runtimes fail-closed", async () => {
  await withManager(async ({ manager, actions, advance }) => {
    await manager.register(server);
    const lease = await manager.issueLease({
      runtimeId: "serena",
      workspace: "fixture",
      owner: "codex",
      taskId: "task-2",
      permissions: ["workspace:read"],
      ttlMs: 100
    });
    await manager.enable({ runtimeId: "serena", leaseId: lease.lease.id, workspace: "fixture", owner: "codex" });
    const cycled = await manager.cycle({ runtimeId: "serena", leaseId: lease.lease.id, workspace: "fixture", owner: "codex" });
    assert.equal(cycled.runtime.generation, 2);
    assert.deepEqual(actions.map((entry) => entry[0]), ["start", "health", "stop", "start", "health"]);

    advance(101);
    const tick = await manager.disableUnused();
    assert.deepEqual(tick.disabled, ["serena"]);
    assert.equal((await manager.status()).runtimes[0].enabled, false);

    const revoked = await manager.revokeLease({ leaseId: lease.lease.id, workspace: "fixture", owner: "codex" });
    assert.equal(revoked.lease.status, "revoked");
  });
});

test("an active runtime cannot be seized by a second valid lease", async () => {
  await withManager(async ({ manager, actions }) => {
    await manager.register(server);
    const first = await manager.issueLease({
      runtimeId: "serena", workspace: "fixture", owner: "owner-a", taskId: "task-a",
      permissions: ["workspace:read"], ttlMs: 60_000
    });
    const second = await manager.issueLease({
      runtimeId: "serena", workspace: "fixture", owner: "owner-b", taskId: "task-b",
      permissions: ["workspace:read"], ttlMs: 60_000
    });
    await manager.enable({ runtimeId: "serena", leaseId: first.lease.id, workspace: "fixture", owner: "owner-a" });
    await assert.rejects(
      manager.cycle({ runtimeId: "serena", leaseId: second.lease.id, workspace: "fixture", owner: "owner-b" }),
      /active lease owns the runtime/i
    );
    assert.deepEqual(actions.map((entry) => entry[0]), ["start", "health"]);
  });
});

test("runtime registry persists disabled state and rejects tool collisions", async () => {
  await withManager(async ({ manager, workspaceRoot }) => {
    await manager.register(server);
    await assert.rejects(
      manager.register({
        ...server,
        id: "duplicate-semantic",
        executable_sha256: "b".repeat(64)
      }),
      /tool collision/i
    );

    const restarted = new RuntimeLifecycleManager({ workspaceRoot });
    await restarted.init();
    const status = await restarted.status();
    assert.equal(status.runtimes.length, 1);
    assert.equal(status.runtimes[0].id, "serena");
    assert.equal(status.runtimes[0].enabled, false);
  });
});
