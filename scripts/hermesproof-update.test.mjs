import test from "node:test";
import assert from "node:assert/strict";

import { runUpdateCli } from "./hermesproof-update.mjs";

function managerFixture(calls) {
  return {
    status: async () => ({ ok: true, status: "ready" }),
    check: async () => ({ ok: true, updateAvailable: true }),
    apply: async () => { calls.push("apply"); return { ok: true, status: "activated" }; },
    rollback: async () => { calls.push("rollback"); return { ok: true, status: "rolled_back" }; },
    channel: async (input) => { calls.push(["channel", input]); return { ok: true, ...input }; },
    configureAuto: async (input) => { calls.push(["auto-config", input]); return { ok: true, auto: input }; },
    auto: async (input) => { calls.push(["auto-run", input]); return { ok: true, status: "current" }; },
    cleanup: async (input) => { calls.push(["cleanup", input]); return { ok: true, removed: [] }; },
    evidence: async (input) => ({ ok: true, ...input })
  };
}

test("updater CLI routes every supported command and emits stable JSON", async () => {
  const calls = [];
  const output = [];
  const manager = managerFixture(calls);
  const options = {
    managerFactory: async () => manager,
    write: (value) => output.push(value)
  };
  assert.equal((await runUpdateCli(["status", "--json"], options)).ok, true);
  assert.equal((await runUpdateCli(["check", "--json"], options)).updateAvailable, true);
  assert.equal((await runUpdateCli(["apply", "--json"], options)).status, "activated");
  assert.equal((await runUpdateCli(["rollback", "--json"], options)).status, "rolled_back");
  assert.equal((await runUpdateCli(["channel", "preview", "--ack-preview", "--json"], options)).channel, "preview");
  assert.equal((await runUpdateCli(["auto", "enable", "--cadence-hours", "6", "--jitter-minutes", "30", "--json"], options)).auto.enabled, true);
  assert.equal((await runUpdateCli(["auto", "run", "--force", "--json"], options)).status, "current");
  assert.equal((await runUpdateCli(["cleanup", "--retain", "3", "--apply", "--json"], options)).ok, true);
  assert.equal((await runUpdateCli(["evidence", "a".repeat(40), "--json"], options)).sha, "a".repeat(40));
  assert.equal(output.every((line) => JSON.parse(line).ok === true), true);
});

test("updater CLI rejects unknown flags, unsafe cleanup defaults, and preview without acknowledgement", async () => {
  const manager = managerFixture([]);
  const options = { managerFactory: async () => manager, write: () => {} };
  await assert.rejects(runUpdateCli(["unknown"], options), /unknown updater command/);
  await assert.rejects(runUpdateCli(["apply", "--mystery"], options), /unknown updater option/);
  await assert.rejects(runUpdateCli(["channel", "preview"], options), /preview channel requires --ack-preview/);
  const cleanup = await runUpdateCli(["cleanup", "--retain", "2", "--json"], options);
  assert.equal(cleanup.dryRun, true);
});
