import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ManagedUpdater, MANAGED_UPDATER_SCHEMA } from "./managed-updater.mjs";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);

function fixtureSource() {
  let candidate = SHA_A;
  return {
    setCandidate(value) {
      candidate = value;
    },
    async resolve() {
      return { sha: candidate, ref: "refs/heads/main", remote: "https://gitlab.com/Ghenghis/HermesProof.git" };
    },
    async stage({ sha, directory }) {
      await fs.mkdir(path.join(directory, "src", "hp-mha-serena"), { recursive: true });
      await fs.writeFile(path.join(directory, "src", "server.mjs"), "export {};\n", "utf8");
      await fs.writeFile(path.join(directory, "src", "hp-mha-serena", "server.mjs"), "export {};\n", "utf8");
      await fs.writeFile(path.join(directory, "release-sha.txt"), sha, "utf8");
      return { sha, directory };
    }
  };
}

test("managed updater activates immutable releases and rolls back to previous known-good", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hp-managed-updater-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = fixtureSource();
  const events = [];
  const updater = new ManagedUpdater({
    managedRoot: root,
    source,
    verifier: async ({ sha }) => ({ ok: true, evidenceDigest: "evidence-" + sha }),
    clientInstaller: async ({ sha }) => {
      events.push("clients:" + sha);
      return { ok: true, snapshot: "snapshot-" + sha };
    },
    probe: async ({ sha, server }) => {
      events.push("probe:" + sha + ":" + server);
      return { ok: true };
    }
  });

  const first = await updater.apply({ channel: "stable" });
  assert.equal(first.ok, true);
  assert.equal((await updater.status()).currentSha, SHA_A);

  source.setCandidate(SHA_B);
  const second = await updater.apply({ channel: "stable" });
  assert.equal(second.ok, true);
  assert.equal((await updater.status()).currentSha, SHA_B);
  assert.equal((await updater.status()).previousSha, SHA_A);
  assert.deepEqual(events.slice(-3), [
    "clients:" + SHA_B,
    "probe:" + SHA_B + ":hermes3d-locks",
    "probe:" + SHA_B + ":hp-mha-serena"
  ]);

  const rolledBack = await updater.rollback();
  assert.equal(rolledBack.ok, true);
  assert.equal((await updater.status()).currentSha, SHA_A);
  assert.equal((await updater.status()).previousSha, SHA_B);
});

test("failed candidate is quarantined and cannot change active release", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hp-managed-updater-fail-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = fixtureSource();
  const updater = new ManagedUpdater({
    managedRoot: root,
    source,
    verifier: async ({ sha }) => sha === SHA_C
      ? { ok: false, reason: "tampered Merkle proof" }
      : { ok: true, evidenceDigest: "ok-" + sha },
    clientInstaller: async () => ({ ok: true }),
    probe: async () => ({ ok: true })
  });
  await updater.apply({ channel: "stable" });
  source.setCandidate(SHA_C);
  const failed = await updater.apply({ channel: "stable" });
  assert.equal(failed.ok, false);
  assert.equal(failed.status, "quarantined");
  assert.match(failed.reason, /Merkle/);
  assert.equal((await updater.status()).currentSha, SHA_A);
  assert.equal((await updater.status()).quarantined[0].sha, SHA_C);
});

test("post-activation probe failure automatically restores previous release", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hp-managed-updater-probe-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = fixtureSource();
  const restored = [];
  const updater = new ManagedUpdater({
    managedRoot: root,
    source,
    verifier: async ({ sha }) => ({ ok: true, evidenceDigest: "ok-" + sha }),
    clientInstaller: async ({ sha }) => ({ ok: true, snapshot: { id: "snapshot-" + sha } }),
    clientRestorer: async ({ snapshot }) => {
      restored.push(snapshot.id);
      return { ok: true };
    },
    probe: async ({ sha, server }) => ({
      ok: !(sha === SHA_B && server === "hp-mha-serena")
    })
  });
  await updater.apply({ channel: "stable" });
  source.setCandidate(SHA_B);
  const failed = await updater.apply({ channel: "stable" });
  assert.equal(failed.ok, false);
  assert.equal(failed.status, "rolled_back");
  assert.equal((await updater.status()).currentSha, SHA_A);
  assert.deepEqual(restored, ["snapshot-" + SHA_B]);
});

test("check is read-only and reports already-current without staging", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hp-managed-updater-check-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = fixtureSource();
  const updater = new ManagedUpdater({
    managedRoot: root,
    source,
    verifier: async () => ({ ok: true }),
    clientInstaller: async () => ({ ok: true }),
    probe: async () => ({ ok: true })
  });
  assert.equal((await updater.check()).updateAvailable, true);
  await updater.apply();
  const check = await updater.check();
  assert.equal(check.updateAvailable, false);
  assert.equal(check.candidateSha, SHA_A);
});

test("cleanup protects current and previous releases and supports a dry-run", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hp-managed-updater-cleanup-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = fixtureSource();
  const updater = new ManagedUpdater({
    managedRoot: root,
    source,
    verifier: async ({ sha }) => ({ ok: true, evidenceDigest: "ok-" + sha }),
    clientInstaller: async () => ({ ok: true }),
    probe: async () => ({ ok: true })
  });
  await updater.apply();
  source.setCandidate(SHA_B);
  await updater.apply();
  source.setCandidate(SHA_C);
  await updater.apply();

  const planned = await updater.cleanup({ retain: 2, dryRun: true });
  assert.deepEqual(planned.removable, [SHA_A]);
  assert.equal(await fs.stat(path.join(root, "releases", SHA_A)).then(() => true), true);
  const removed = await updater.cleanup({ retain: 2, dryRun: false });
  assert.deepEqual(removed.removed, [SHA_A]);
  await assert.rejects(fs.stat(path.join(root, "releases", SHA_A)), /ENOENT/);
  assert.equal(await fs.stat(path.join(root, "releases", SHA_B)).then(() => true), true);
  assert.equal(await fs.stat(path.join(root, "releases", SHA_C)).then(() => true), true);
});

test("initialize recovers an interrupted activation journal fail-closed", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hp-managed-updater-journal-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = fixtureSource();
  const restored = [];
  const updater = new ManagedUpdater({
    managedRoot: root, source,
    verifier: async ({ sha }) => ({ ok: true, evidenceDigest: "ok-" + sha }),
    clientInstaller: async ({ sha }) => ({ ok: true, snapshot: { id: "snapshot-" + sha } }),
    clientRestorer: async ({ snapshot }) => { restored.push(snapshot.id); return { ok: true }; },
    probe: async () => ({ ok: true }),
  });
  await updater.apply();
  const previous = await updater.activeState();
  const releaseDirectory = path.join(root, "releases", SHA_B);
  await fs.mkdir(releaseDirectory, { recursive: true });
  await fs.writeFile(updater.paths.active, JSON.stringify({ ...previous, generation: previous.generation + 1, currentSha: SHA_B, previousSha: SHA_A }) + "\n");
  await fs.writeFile(updater.paths.journal, JSON.stringify({
    schema: MANAGED_UPDATER_SCHEMA, phase: "activating", sha: SHA_B, previous,
    clientSnapshot: { id: "snapshot-" + SHA_B }, releaseDirectory, createdUtc: new Date().toISOString(),
  }) + "\n");

  const status = await updater.status();
  assert.equal(status.currentSha, SHA_A);
  assert.deepEqual(restored, ["snapshot-" + SHA_B]);
  assert.equal(status.quarantined.some((item) => item.sha === SHA_B), true);
  await assert.rejects(fs.stat(updater.paths.journal), /ENOENT/);
});

test("stale updater lock is recovered but a fresh lock remains exclusive", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hp-managed-updater-lock-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = fixtureSource();
  const now = new Date("2026-08-09T12:00:00.000Z");
  const updater = new ManagedUpdater({
    managedRoot: root, source, clock: () => new Date(now),
    verifier: async ({ sha }) => ({ ok: true, evidenceDigest: "ok-" + sha }),
    clientInstaller: async () => ({ ok: true }), probe: async () => ({ ok: true }),
  });
  await updater.initialize();
  await fs.mkdir(updater.paths.lock);
  await fs.writeFile(path.join(updater.paths.lock, "owner.json"), JSON.stringify({ startedUtc: "2026-08-09T10:00:00.000Z", pid: 999999 }) + "\n");
  assert.equal((await updater.apply()).ok, true);

  source.setCandidate(SHA_B);
  await fs.mkdir(updater.paths.lock);
  await fs.writeFile(path.join(updater.paths.lock, "owner.json"), JSON.stringify({ startedUtc: now.toISOString(), pid: process.pid }) + "\n");
  await assert.rejects(updater.apply(), /another updater transaction is active/);
});
