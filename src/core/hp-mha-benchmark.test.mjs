import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import {
  matrixFromMeasuredRuns,
  loadMeasuredMatrixEvidence,
  scoreKiloBackendPlanResponse,
  verifyMeasuredMatrixEvidence
} from "./hp-mha-benchmark.mjs";

const perfect = {
  pack_ids: ["kilo-backend"],
  global_install: false,
  enable_after_install: false,
  permissions: ["workspace:read", "process:child", "loopback:http"],
  health_probes: ["kilo --version"],
  rollback: "restore content-addressed previous pack",
  lease: { ttl_seconds: 300 },
  mcp: { default_enabled: false }
};

test("real 2x2 scorer awards only explicit backend safety evidence", () => {
  const result = scoreKiloBackendPlanResponse(JSON.stringify(perfect));
  assert.equal(result.score, 1);
  assert.equal(result.passed, 10);
  assert.equal(result.response_sha256.length, 64);

  const invalid = scoreKiloBackendPlanResponse("not json");
  assert.equal(invalid.score, 0);
  assert.equal(invalid.checks.no_secret_material, false);

  const leaked = scoreKiloBackendPlanResponse(JSON.stringify({ ...perfect, token: "secret" }));
  assert.equal(leaked.checks.no_secret_material, false);
  assert.equal(leaked.score, 0.9);
});

test("measured runs map exactly once into the factorial cells", () => {
  assert.deepEqual(matrixFromMeasuredRuns([
    { cell: "s11", score: 0.2 },
    { cell: "s12", score: 0.8 },
    { cell: "s21", score: 0.4 },
    { cell: "s22", score: 1 }
  ]), { s11: 0.2, s12: 0.8, s21: 0.4, s22: 1 });
  assert.throws(
    () => matrixFromMeasuredRuns([
      { cell: "s11", score: 0.2 },
      { cell: "s11", score: 0.8 },
      { cell: "s21", score: 0.4 },
      { cell: "s22", score: 1 }
    ]),
    /duplicate/i
  );
});

test("checked-in measured matrix is real, complete, and hash-bound", async () => {
  const file = new URL("../../examples/hp-mha/measured-matrix.json", import.meta.url);
  const evidence = JSON.parse(await fs.readFile(file, "utf8"));
  assert.equal(verifyMeasuredMatrixEvidence(evidence), true);
  assert.throws(
    () => verifyMeasuredMatrixEvidence({ ...evidence, seed: evidence.seed + 1 }),
    /digest/i
  );
  const reassigned = structuredClone(evidence);
  [reassigned.runs[0].model, reassigned.runs[2].model] = [reassigned.runs[2].model, reassigned.runs[0].model];
  delete reassigned.evidence_sha256;
  reassigned.evidence_sha256 = (await import("node:crypto")).default
    .createHash("sha256")
    .update(JSON.stringify(reassigned))
    .digest("hex");
  assert.throws(() => verifyMeasuredMatrixEvidence(reassigned), /cell|model assignment/i);

  const wrongContract = structuredClone(evidence);
  wrongContract.harnesses[1].contract_sha256 = "a".repeat(64);
  delete wrongContract.evidence_sha256;
  wrongContract.evidence_sha256 = crypto.createHash("sha256").update(JSON.stringify(wrongContract)).digest("hex");
  assert.throws(() => verifyMeasuredMatrixEvidence(wrongContract), /harness contract/i);

  const wrongBenchmark = structuredClone(evidence);
  wrongBenchmark.benchmark = "unrelated-benchmark";
  delete wrongBenchmark.evidence_sha256;
  wrongBenchmark.evidence_sha256 = crypto.createHash("sha256").update(JSON.stringify(wrongBenchmark)).digest("hex");
  assert.throws(() => verifyMeasuredMatrixEvidence(wrongBenchmark), /benchmark/i);
});

test("measured matrix loader fails closed when retained evidence is missing or tampered", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hp-measured-matrix-"));
  const checkedIn = new URL("../../examples/hp-mha/measured-matrix.json", import.meta.url);
  const evidence = JSON.parse(await fs.readFile(checkedIn, "utf8"));
  const validFile = path.join(root, "valid.json");
  const tamperedFile = path.join(root, "tampered.json");
  try {
    await fs.writeFile(validFile, JSON.stringify(evidence));
    await fs.writeFile(tamperedFile, JSON.stringify({ ...evidence, seed: evidence.seed + 1 }));
    const loaded = await loadMeasuredMatrixEvidence(validFile);
    assert.deepEqual(loaded.matrix, evidence.matrix);
    await assert.rejects(loadMeasuredMatrixEvidence(tamperedFile), /digest/i);
    await assert.rejects(loadMeasuredMatrixEvidence(path.join(root, "missing.json")), /measured matrix/i);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
