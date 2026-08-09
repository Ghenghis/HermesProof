import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateHelperRuntimeConsensus,
  evaluateHelperRuntimeEnvelope,
  HELPER_RUNTIME_CONTRACT_VERSION,
  HELPER_RUNTIME_SCHEMA,
} from "./helper-runtime.mjs";

const sha = "a".repeat(64);

function run(overrides = {}) {
  return {
    schema: HELPER_RUNTIME_SCHEMA,
    contractVersion: HELPER_RUNTIME_CONTRACT_VERSION,
    runId: "run-hybrid-20260710",
    taskId: "task-helper-health",
    worker: { id: "zeroclaw-local-01", runtime: "zeroclaw", location: "local" },
    workspace: { commit: sha, vsixSha256: sha },
    scope: ["health"],
    startedAtUtc: "2026-07-10T21:00:00.000Z",
    finishedAtUtc: "2026-07-10T21:00:01.000Z",
    status: "completed",
    runner: { statusOk: true, timedOut: false, exitCode: 0 },
    artifacts: [{ id: "status-proof", sha256: sha }],
    hermesProof: { evidenceId: "ev_abcdef1234567890" },
    secretValuesReturned: false,
    summary: "Health check completed without secret output.",
    ...overrides,
  };
}

describe("helper runtime proof contract", () => {
  it("accepts a redacted real terminal worker envelope", () => {
    const result = evaluateHelperRuntimeEnvelope(run());
    assert.equal(result.ok, true);
    assert.equal(result.secret_values_returned, false);
  });

  it("accepts real Git SHA-1 and SHA-256 commit identifiers", () => {
    const sha1 = evaluateHelperRuntimeEnvelope(run({ workspace: { commit: "b".repeat(40), vsixSha256: sha } }));
    const sha256 = evaluateHelperRuntimeEnvelope(run({ workspace: { commit: "c".repeat(64), vsixSha256: sha } }));
    assert.equal(sha1.ok, true);
    assert.equal(sha256.ok, true);
  });

  it("rejects timeouts, secrets, fake metadata, and missing evidence", () => {
    const result = evaluateHelperRuntimeEnvelope(run({
      runner: { statusOk: true, timedOut: true, exitCode: 0 },
      secretValuesReturned: true,
      mocked: true,
      summary: "api_key=should-not-appear",
      hermesProof: { evidenceId: "" },
    }));
    assert.equal(result.ok, false);
    assert.ok(result.findings.includes("runner_timed_out_or_missing"));
    assert.ok(result.findings.includes("secret_values_returned"));
    assert.ok(result.findings.includes("envelope.mocked_forbidden"));
    assert.ok(result.findings.includes("summary_contains_secret_signal"));
    assert.ok(result.findings.includes("evidence_id_missing"));
  });

  it("requires local and VPS workers to agree on run and artifact lineage", () => {
    const local = run();
    const vps = run({ worker: { id: "hermes-agent-vps-01", runtime: "hermes-agent", location: "vps" } });
    const accepted = evaluateHelperRuntimeConsensus({ requiredLocations: ["local", "vps"], runs: [local, vps] });
    assert.equal(accepted.ok, true);
    const blocked = evaluateHelperRuntimeConsensus({
      requiredLocations: ["local", "vps"],
      runs: [local, run({ worker: { id: "hermes-agent-vps-01", runtime: "hermes-agent", location: "vps" }, workspace: { commit: "b".repeat(64), vsixSha256: sha } })],
    });
    assert.equal(blocked.ok, false);
    assert.ok(blocked.findings.includes("consensus_mismatch:workspace.commit"));
  });
});
