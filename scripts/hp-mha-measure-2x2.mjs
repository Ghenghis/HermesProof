#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";

import {
  KILO_BACKEND_BENCHMARK_ID,
  KILO_BACKEND_HARNESS_ID,
  KILO_BACKEND_SAFETY_CONTRACT,
  KILO_BACKEND_TASK,
  matrixFromMeasuredRuns,
  scoreKiloBackendPlanResponse
} from "../src/core/hp-mha-benchmark.mjs";

const endpoint = process.env.HP_MHA_OLLAMA_ENDPOINT || "http://127.0.0.1:11434/api/generate";
const models = [
  process.env.HP_MHA_MODEL_1 || "qwen3:0.6b-fp16",
  process.env.HP_MHA_MODEL_2 || "qwen3:4b-q8_0"
];
const seed = Number.parseInt(process.env.HP_MHA_SEED || "260809", 10);

async function runCell({ cell, model, harness }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180_000);
  const prompt = harness ? KILO_BACKEND_TASK + " " + KILO_BACKEND_SAFETY_CONTRACT : KILO_BACKEND_TASK;
  const started = Date.now();
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        format: "json",
        options: { temperature: 0, seed }
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error("Ollama returned HTTP " + response.status + " for " + cell);
    }
    const payload = await response.json();
    const output = String(payload.response || "");
    const scored = scoreKiloBackendPlanResponse(output);
    return {
      cell,
      model,
      harness,
      harness_id: harness ? KILO_BACKEND_HARNESS_ID : "none",
      score: scored.score,
      passed: scored.passed,
      total: scored.total,
      checks: scored.checks,
      response_sha256: scored.response_sha256,
      raw_response: output,
      duration_ms: Date.now() - started,
      done_reason: payload.done_reason || null,
      eval_count: payload.eval_count || null
    };
  } finally {
    clearTimeout(timer);
  }
}

const runs = [];
runs.push(await runCell({ cell: "s11", model: models[0], harness: false }));
runs.push(await runCell({ cell: "s12", model: models[0], harness: true }));
runs.push(await runCell({ cell: "s21", model: models[1], harness: false }));
runs.push(await runCell({ cell: "s22", model: models[1], harness: true }));

const evidence = {
  schema: "hermesproof.hp-mha.measured-matrix.v2",
  measured_utc: new Date().toISOString(),
  execution_real: true,
  benchmark: KILO_BACKEND_BENCHMARK_ID,
  endpoint: "ollama-loopback",
  models,
  seed,
  repetitions_per_cell: 1,
  harnesses: [
    { id: "none", contract_sha256: null },
    { id: KILO_BACKEND_HARNESS_ID, contract_sha256: crypto.createHash("sha256").update(KILO_BACKEND_SAFETY_CONTRACT).digest("hex") }
  ],
  held_constant: {
    temperature: 0,
    response_format: "json",
    task_sha256: crypto.createHash("sha256").update(KILO_BACKEND_TASK).digest("hex"),
    scorer: "10 deterministic backend-safety checks",
    scorer_source_sha256: crypto.createHash("sha256").update(await fs.readFile(new URL("../src/core/hp-mha-benchmark.mjs", import.meta.url))).digest("hex")
  },
  runs,
  matrix: matrixFromMeasuredRuns(runs)
};
evidence.evidence_sha256 = crypto
  .createHash("sha256")
  .update(JSON.stringify(evidence))
  .digest("hex");
const rendered = JSON.stringify(evidence, null, 2) + "\n";
if (process.env.HP_MHA_OUTPUT) {
  await fs.writeFile(process.env.HP_MHA_OUTPUT, rendered, "utf8");
}
process.stdout.write(rendered);
