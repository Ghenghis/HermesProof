import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  appendChainedJsonLine,
  canonicalJSON,
  readEvidenceCheckpointManifest,
  sha256Hex,
  verifyChainedLog
} from "./fs-utils.mjs";

async function tempLedger() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hermesproof-checkpoint-"));
  return { dir, ledger: path.join(dir, "evidence", "ledger.ndjson") };
}

function chainedEntry(value) {
  return { ...value, entry_hash: sha256Hex(canonicalJSON(value)) };
}

test("verifyChainedLog accepts only exact documented prev_hash forks", async (t) => {
  const { dir, ledger } = await tempLedger();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const first = await appendChainedJsonLine(ledger, { id: "ev_1", note: "first" });
  await appendChainedJsonLine(ledger, { id: "ev_2", note: "second" });
  const fork = chainedEntry({
    id: "ev_fork",
    ts_utc: "2026-05-03T00:00:00.000Z",
    note: "documented fork",
    prev_entry_id: first.id,
    prev_hash: first.entry_hash
  });
  await fs.appendFile(ledger, JSON.stringify(fork) + "\n", "utf8");
  await appendChainedJsonLine(ledger, { id: "ev_3", note: "after fork" });

  const strict = await verifyChainedLog(ledger);
  assert.equal(strict.ok, false);
  assert.equal(strict.first_break.index, 2);
  assert.equal(strict.first_break.id, "ev_fork");

  const accepted = await verifyChainedLog(ledger, {
    acceptedBreaks: [
      {
        index: 2,
        id: "ev_fork",
        reason: "prev_hash",
        prev_entry_id: first.id,
        ts_utc: "2026-05-03T00:00:00.000Z",
        accepted_by: "unit-test"
      }
    ]
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.strict_ok, false);
  assert.equal(accepted.first_break, null);
  assert.equal(accepted.accepted_break_count, 1);
  assert.equal(accepted.chained, 4);
});

test("verifyChainedLog does not let checkpoints hide entry_hash tampering", async (t) => {
  const { dir, ledger } = await tempLedger();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const first = await appendChainedJsonLine(ledger, { id: "ev_1", note: "first" });
  await appendChainedJsonLine(ledger, { id: "ev_2", note: "second" });
  const fork = chainedEntry({
    id: "ev_fork",
    ts_utc: "2026-05-03T00:00:00.000Z",
    note: "documented fork",
    prev_entry_id: first.id,
    prev_hash: first.entry_hash
  });
  fork.note = "tampered after hashing";
  await fs.appendFile(ledger, JSON.stringify(fork) + "\n", "utf8");

  const result = await verifyChainedLog(ledger, {
    acceptedBreaks: [{ index: 2, id: "ev_fork", reason: "prev_hash", prev_entry_id: first.id }]
  });
  assert.equal(result.ok, false);
  assert.equal(result.first_break.reason, "entry_hash mismatch");
});

test("readEvidenceCheckpointManifest validates the checkpoint hash before accepting breaks", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hermesproof-manifest-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "checkpoint.json");
  const payload = {
    schema: 1,
    kind: "hermesproof_evidence_ledger_checkpoint",
    created_utc: "2026-07-04T10:20:00.000Z",
    accepted_breaks: [{ index: 2, id: "ev_fork", reason: "prev_hash" }]
  };
  await fs.writeFile(file, JSON.stringify({ ...payload, checkpoint_hash: sha256Hex(canonicalJSON(payload)) }), "utf8");

  const ok = await readEvidenceCheckpointManifest(file);
  assert.equal(ok.ok, true);
  assert.equal(ok.accepted_breaks.length, 1);

  await fs.writeFile(file, JSON.stringify({ ...payload, checkpoint_hash: "bad" }), "utf8");
  const bad = await readEvidenceCheckpointManifest(file);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.accepted_breaks, []);
});
