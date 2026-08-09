import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import {
  matrixFromMeasuredRuns,
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
});
