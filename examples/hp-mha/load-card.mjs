#!/usr/bin/env node
// HP-MHA harness card loader.
//
// Reads examples/hp-mha/harness-cards/<name>.json, canonicalises it through
// the HP-MHA schema, computes the six manifest sha256s the HP-HARNESS-ATTRIBUTION
// sub-gate requires (HP-MHA-001), and runs evaluateHpMhaSubGate. Prints the
// full PASS / FAIL / INCONCLUSIVE verdict with reason codes.
//
// With `--task-sets`, also exercises HP-MHA-006 by running
// validateTaskSetTagUniqueness against every fixture under task-sets/ and
// rejecting any bundle that mixes hp_mha.holdout + hp_mha.optimization tags.
//
// Usage:
//   node examples/hp-mha/load-card.mjs [card-name] [--matrix s11,s12,s21,s22]
//   node examples/hp-mha/load-card.mjs --all
//   node examples/hp-mha/load-card.mjs --task-sets
//
// Default card: hermesproof. Default matrix is the 0.5 / 0.6 / 0.7 / 0.8
// fixture used by the truth-gate. Override --matrix with real measured
// numbers once benchmark runs land. --all loads every card under
// harness-cards/ and asserts each PASSes.
//
// Exit codes:
//   0 all cards PASS / all task sets are HP-MHA-006 compliant
//   1 at least one card FAILed the HP-MHA contract, or a task set violates HP-MHA-006
//   2 script itself failed (bad input, IO error)

import fs from "node:fs/promises";
import path from "node:path";
import url from "node:url";
import {
  buildTaskSetManifest,
  evaluateHarnessCardFromManifest,
  HP_MHA_CONTRACT_VERSION,
  validateTaskSetTagUniqueness
} from "../../src/core/hp-mha.mjs";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const cardsDir = path.join(here, "harness-cards");
const taskSetsDir = path.join(here, "task-sets");

function parseArgs(argv) {
  const out = { card: "hermesproof", matrix: [0.5, 0.6, 0.7, 0.8], all: false, taskSets: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--card") out.card = argv[++i];
    else if (a === "--all") out.all = true;
    else if (a === "--task-sets") out.taskSets = true;
    else if (a === "--matrix") {
      const parts = argv[++i].split(",").map(Number);
      if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
        throw new Error("--matrix must be four comma-separated numbers: s11,s12,s21,s22");
      }
      out.matrix = parts;
    } else if (!a.startsWith("--")) out.card = a;
  }
  return out;
}

async function evaluateCard(cardPathOrName, args) {
  const cardPath = path.isAbsolute(cardPathOrName)
    ? cardPathOrName
    : path.join(cardsDir, `${cardPathOrName}.json`);
  const cardRaw = JSON.parse(await fs.readFile(cardPath, "utf8"));
  const result = evaluateHarnessCardFromManifest(cardRaw, { matrix: { s11: args.matrix[0], s12: args.matrix[1], s21: args.matrix[2], s22: args.matrix[3] } });
  return {
    card_id: cardRaw.card_id,
    card_path: path.relative(repoRoot, cardPath),
    installed_commit: cardRaw.layers.execution.installed_commit,
    manifest_sha256: result.manifest_sha256,
    gate: result.gate,
    verdict: result.verdict,
    ok: result.ok,
    reason_codes: result.reason_codes,
    reason: result.reason,
    attribution: result.attribution,
    denominator: result.denominator
  };
}

async function evaluateTaskSetTaskSet(file) {
  const taskSetPath = path.join(taskSetsDir, file);
  const raw = JSON.parse(await fs.readFile(taskSetPath, "utf8"));
  const built = buildTaskSetManifest(raw);
  const check = validateTaskSetTagUniqueness(raw);
  return {
    file: path.relative(repoRoot, taskSetPath),
    task_set_id: raw.task_set_id,
    task_count: Array.isArray(raw.tasks) ? raw.tasks.length : 0,
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    manifest_sha256: built.manifest_sha256,
    holdout_compliant: check.ok,
    reason_codes: check.reason_codes,
    reason: check.reason
  };
}

async function listJson(dir) {
  try {
    return (await fs.readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const summary = {
    schema: "hermesproof.hp_mha.load_card.v1",
    contract_version: HP_MHA_CONTRACT_VERSION,
    repo_root: repoRoot
  };

  if (args.taskSets) {
    const files = await listJson(taskSetsDir);
    if (files.length === 0) {
      console.error(`[hp-mha] load-card: no task-set fixtures under ${path.relative(repoRoot, taskSetsDir)}`);
      process.exitCode = 2;
      return;
    }
    const taskSets = [];
    for (const file of files) taskSets.push(await evaluateTaskSetTaskSet(file));
    summary.task_sets = {
      evaluated: taskSets.length,
      hp_mha_006_compliant: taskSets.every((t) => t.holdout_compliant),
      results: taskSets
    };
    console.log(JSON.stringify(summary, null, 2));
    if (!summary.task_sets.hp_mha_006_compliant) process.exitCode = 1;
    return;
  }

  async function collectJsonRecursive(dir) {
    const out = [];
    let entries = [];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...(await collectJsonRecursive(full)));
      else if (e.name.endsWith(".json")) out.push(full);
    }
    return out;
  }
  const files = args.all
    ? (await collectJsonRecursive(cardsDir)).sort()
    : [`${args.card}.json`];
  if (files.length === 0) {
    console.error(`[hp-mha] load-card: no harness cards found under ${path.relative(repoRoot, cardsDir)}`);
    process.exitCode = 2;
    return;
  }
  const results = [];
  for (const file of files) {
    const cardName = path.basename(file).replace(/\.json$/, "");
    try {
      results.push(await evaluateCard(file, args));
    } catch (err) {
      results.push({
        card_id: cardName,
        card_path: path.relative(repoRoot, file),
        ok: false,
        verdict: "FAIL",
        reason_codes: ["HP-MHA-load-error"],
        reason: err.message,
        attribution: null,
        denominator: null
      });
    }
  }
  summary.cards_evaluated = results.length;
  summary.overall_ok = results.every((r) => r.ok);
  summary.results = results;
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.overall_ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`[hp-mha] load-card failed: ${err.message}`);
  process.exit(2);
});