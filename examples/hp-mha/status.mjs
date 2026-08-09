#!/usr/bin/env node
// HP-MHA ledger status CLI.
//
// Prints a summary of every ev_* entry currently recorded in the HP-MHA
// ledger at <workspace>/.hermes3d_orchestrator/evidence/hp_mha.ndjson.
// Pure read-only; never mutates the ledger or workspace. Exits 0 always so it
// is safe to chain from CI logs, dashboards, or release scripts.
//
// Usage:
//   node examples/hp-mha/status.mjs [--workspace <path>] [--json]
//
// --workspace defaults to the current working directory; --json produces a
// one-shot JSON object that downstream tooling (CI status checks, dashboards)
// can pipe through jq. With no flag, it prints a human-readable table.

import fs from "node:fs/promises";
import path from "node:path";
import url from "node:url";
import {
  HP_MHA_CONTRACT_VERSION,
  readHpMhaEvidence
} from "../../src/core/hp-mha.mjs";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

function parseArgs(argv) {
  const out = { workspace: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--workspace") out.workspace = argv[++i];
    else if (a === "--json") out.json = true;
  }
  if (!out.workspace) out.workspace = process.env.HP_MHA_WORKSPACE || repoRoot;
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const stateDirName = process.env.HP_MHA_STATE_DIR || ".hermes3d_orchestrator";
  let evidence = [];
  let ioError = null;
  try {
    evidence = await readHpMhaEvidence(args.workspace, stateDirName);
  } catch (err) {
    ioError = err.message;
  }

  const countByKind = {};
  const experiments = new Set();
  let lastPromotion = null;
  let lastAttribution = null;
  const harnesses = new Set();
  for (const entry of evidence) {
    if (!entry || typeof entry !== "object") continue;
    const k = entry.kind || "unknown";
    countByKind[k] = (countByKind[k] || 0) + 1;
    if (entry.experiment_id) experiments.add(entry.experiment_id);
    if (entry.harness_card_id) harnesses.add(entry.harness_card_id);
    if (k === "ev_promotion") lastPromotion = entry;
    if (k === "ev_attribution") lastAttribution = entry;
  }

  const summary = {
    schema: "hermesproof.hp_mha.status.v1",
    contract_version: HP_MHA_CONTRACT_VERSION,
    workspace: args.workspace,
    state_dir: stateDirName,
    ledger_path: path.join(args.workspace, stateDirName, "evidence", "hp_mha.ndjson"),
    io_error: ioError,
    total_entries: evidence.length,
    count_by_kind: countByKind,
    distinct_experiments: [...experiments].sort(),
    distinct_harness_cards: [...harnesses].sort(),
    last_promotion: lastPromotion ? {
      verdict: lastPromotion.verdict,
      reason_codes: lastPromotion.reason_codes,
      ts_utc: lastPromotion.ts_utc,
      evidence_id: lastPromotion.id
    } : null,
    last_attribution: lastAttribution ? {
      harness_effect_pp: lastAttribution.harness_effect_pp,
      model_effect_pp: lastAttribution.model_effect_pp,
      interaction_pp: lastAttribution.interaction_pp,
      ts_utc: lastAttribution.ts_utc,
      evidence_id: lastAttribution.id
    } : null,
    head_hash: evidence.length > 0 ? (evidence[evidence.length - 1].entry_hash || null) : null,
    head_evidence_id: evidence.length > 0 ? (evidence[evidence.length - 1].id || null) : null
  };

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  if (ioError) {
    console.error(`[hp-mha] status: cannot read ledger: ${ioError}`);
    console.log(JSON.stringify(summary, null, 2));
    process.exitCode = 2;
    return;
  }
  const fmt = (n) => (typeof n === "number" ? n.toFixed(4) : "-");
  console.log(`HP-MHA ledger status`);
  console.log(`  workspace       : ${summary.workspace}`);
  console.log(`  ledger          : ${summary.ledger_path}`);
  console.log(`  contract        : ${HP_MHA_CONTRACT_VERSION}`);
  console.log(`  total entries   : ${summary.total_entries}`);
  if (summary.total_entries === 0) {
    console.log(`  (no ev_* entries recorded yet)`);
    return;
  }
  console.log(`  by kind:`);
  for (const [kind, n] of Object.entries(countByKind)) {
    console.log(`    ${kind.padEnd(20)} ${n}`);
  }
  console.log(`  experiments     : ${summary.distinct_experiments.length} (${summary.distinct_experiments.join(", ") || "-"})`);
  console.log(`  harness cards   : ${summary.distinct_harness_cards.length} (${summary.distinct_harness_cards.join(", ") || "-"})`);
  if (summary.last_attribution) {
    console.log(`  last attribution: harness=${fmt(summary.last_attribution.harness_effect_pp)}pp model=${fmt(summary.last_attribution.model_effect_pp)}pp interaction=${fmt(summary.last_attribution.interaction_pp)}pp at ${summary.last_attribution.ts_utc}`);
  }
  if (summary.last_promotion) {
    console.log(`  last promotion  : verdict=${summary.last_promotion.verdict} reasons=${(summary.last_promotion.reason_codes || []).join(",")} at ${summary.last_promotion.ts_utc}`);
  }
  console.log(`  head            : ${summary.head_evidence_id} hash=${summary.head_hash ? summary.head_hash.slice(0, 12) : null}…`);
}

main().catch((err) => {
  console.error(`[hp-mha] status failed: ${err.message}`);
  process.exit(2);
});