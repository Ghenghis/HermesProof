import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { UpdateManager } from "./update-manager.mjs";

function updaterFixture(events) {
  return {
    status: async () => ({ ok: true, currentSha: "a".repeat(40), channel: "stable" }),
    check: async ({ channel }) => ({ ok: true, channel, updateAvailable: true, candidateSha: "b".repeat(40) }),
    apply: async ({ channel }) => {
      events.push("apply:" + channel);
      return { ok: true, status: "activated", currentSha: "b".repeat(40) };
    },
    rollback: async () => {
      events.push("rollback");
      return { ok: true, status: "rolled_back", currentSha: "a".repeat(40) };
    },
    cleanup: async ({ retain, dryRun }) => ({ ok: true, retain, dryRun, removed: [] })
  };
}

test("update manager exposes stable status, check, apply, rollback, cleanup, and evidence", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hp-update-manager-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const events = [];
  const evidenceDirectory = path.join(root, "evidence");
  await fs.mkdir(evidenceDirectory, { recursive: true });
  const sha = "a".repeat(40);
  await fs.writeFile(path.join(evidenceDirectory, sha + ".json"), JSON.stringify({ ok: true, sha }), "utf8");
  const manager = new UpdateManager({
    managedRoot: root,
    updater: updaterFixture(events),
    scheduler: {
      install: async () => ({ ok: true, status: "installed" }),
      inspect: async () => ({ ok: true, status: "installed" }),
      remove: async () => ({ ok: true, status: "removed" })
    },
    machineId: "fixture-machine"
  });

  assert.equal((await manager.status()).auto.enabled, false);
  assert.equal((await manager.check()).candidateSha, "b".repeat(40));
  assert.equal((await manager.apply()).status, "activated");
  assert.equal((await manager.rollback()).status, "rolled_back");
  assert.equal((await manager.cleanup({ retain: 3, dryRun: true })).retain, 3);
  assert.deepEqual(await manager.evidence({ sha }), { ok: true, sha });
  assert.deepEqual(events, ["apply:stable", "rollback"]);
});

test("update manager persists preview acknowledgement and automatic update settings", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hp-update-manager-settings-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const events = [];
  const schedulerEvents = [];
  const manager = new UpdateManager({
    managedRoot: root,
    updater: updaterFixture(events),
    scheduler: {
      install: async () => { schedulerEvents.push("install"); return { ok: true }; },
      inspect: async () => ({ ok: true, status: "installed" }),
      remove: async () => { schedulerEvents.push("remove"); return { ok: true }; }
    },
    machineId: "fixture-machine",
    clock: () => new Date("2026-08-09T20:00:00.000Z")
  });

  await assert.rejects(manager.channel({ channel: "preview" }), /preview channel requires explicit acknowledgement/);
  assert.equal((await manager.channel({ channel: "preview", acknowledgePreview: true })).channel, "preview");
  const configured = await manager.configureAuto({ enabled: true, cadenceHours: 6, jitterMinutes: 0 });
  assert.equal(configured.auto.enabled, true);
  assert.deepEqual(schedulerEvents, ["install"]);
  const automatic = await manager.auto({ force: true });
  assert.equal(automatic.status, "activated");
  assert.deepEqual(events, ["apply:preview"]);
  const status = await manager.status();
  assert.equal(status.auto.lastResult.ok, true);
  assert.equal(status.auto.consecutiveFailures, 0);
  await manager.configureAuto({ enabled: false });
  assert.deepEqual(schedulerEvents, ["install", "remove"]);
});

test("automatic update records failures and honors disabled or not-due state", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hp-update-manager-auto-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const updater = updaterFixture([]);
  updater.apply = async () => ({ ok: false, status: "quarantined", reason: "verification failed" });
  const manager = new UpdateManager({
    managedRoot: root,
    updater,
    scheduler: {
      install: async () => ({ ok: true }),
      inspect: async () => ({ ok: false, status: "absent" }),
      remove: async () => ({ ok: true })
    },
    machineId: "fixture-machine",
    clock: () => new Date("2026-08-09T20:00:00.000Z")
  });

  assert.equal((await manager.auto()).status, "disabled");
  await manager.configureAuto({ enabled: true, cadenceHours: 6, jitterMinutes: 0 });
  const failed = await manager.auto({ force: true });
  assert.equal(failed.ok, false);
  assert.equal((await manager.status()).auto.consecutiveFailures, 1);
  const notDue = await manager.auto();
  assert.equal(notDue.status, "not_due");
});
