import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateStaleness, STALENESS_CONTRACT_VERSION, STALENESS_SCHEMA } from "./staleness.mjs";

const sha = "a".repeat(64);
const now = Date.parse("2026-07-10T22:00:00.000Z");

function record(overrides = {}) {
  return {
    id: "gate7-ui-proof",
    kind: "ui-proof",
    status: "passed",
    recordedAtUtc: "2026-07-10T21:59:00.000Z",
    sha256: sha,
    commit: sha,
    vsixSha256: sha,
    contractVersion: "kilocode.e2e-proof-contract.2026-07-10",
    runId: "run-gate7-001",
    evidenceId: "ev_abcdef1234567890",
    summary: "Installed VSIX navigation proof completed.",
    current: true,
    ...overrides,
  };
}

function report(records, overrides = {}) {
  return evaluateStaleness({
    schema: STALENESS_SCHEMA,
    contractVersion: STALENESS_CONTRACT_VERSION,
    current: { commit: sha, vsixSha256: sha, contractVersion: "kilocode.e2e-proof-contract.2026-07-10" },
    requiredKinds: ["ui-proof"],
    records,
    nowMs: now,
    ...overrides,
  });
}

describe("HermesProof staleness evaluator", () => {
  it("accepts fresh current proof with complete lineage", () => {
    const result = report([record()]);
    assert.equal(result.ok, true);
    assert.equal(result.verdict, "pass");
    assert.equal(result.truth, "proven");
    assert.deepEqual(result.requirements, [{ kind: "ui-proof", verdict: "pass", truth: "proven", recordIds: ["gate7-ui-proof"] }]);
    assert.equal(result.records[0].verdict, "pass");
    assert.equal(result.records[0].freshness, "current");
  });

  it("rejects stale, future, superseded, and secret-bearing current records", () => {
    const stale = report([record({ recordedAtUtc: "2026-07-10T20:00:00.000Z" })]);
    assert.equal(stale.ok, false);
    assert.equal(stale.verdict, "fail");
    assert.equal(stale.truth, "rejected");
    assert.ok(stale.findings.includes("gate7-ui-proof:record_stale"));
    const unsafe = report([record({
      recordedAtUtc: "2026-07-10T22:05:00.000Z",
      status: "superseded",
      supersededBy: "gate7-ui-proof-new",
      summary: "token=should-not-appear",
    })]);
    assert.equal(unsafe.ok, false);
    assert.ok(unsafe.findings.includes("gate7-ui-proof:record_timestamp_future"));
    assert.ok(unsafe.findings.includes("gate7-ui-proof:current_record_superseded"));
    assert.ok(unsafe.findings.includes("gate7-ui-proof:record_summary_secret_signal"));
  });

  it("keeps current failures visible and missing current proof blocked", () => {
    const failed = report([record({ status: "failed" })]);
    assert.equal(failed.verdict, "fail");
    assert.equal(failed.records[0].truth, "failed");
    assert.ok(failed.findings.includes("current_record_failed:gate7-ui-proof"));
    const historical = report([record({ current: false })]);
    assert.equal(historical.verdict, "blocked");
    assert.equal(historical.truth, "insufficient");
    assert.equal(historical.records[0].truth, "historical");
    assert.deepEqual(historical.requirements, [{ kind: "ui-proof", verdict: "blocked", truth: "insufficient", recordIds: [] }]);
  });

  it("rejects proof records mixed from different VSIX or commit lineage", () => {
    const other = record({ id: "gate9-ui-proof", commit: "b".repeat(64) });
    const result = report([record(), other]);
    assert.equal(result.ok, false);
    assert.ok(result.findings.includes("gate9-ui-proof:record_commit_mismatch"));
    assert.ok(result.findings.includes("run_lineage_mismatch:run-gate7-001:commit"));
  });
});
