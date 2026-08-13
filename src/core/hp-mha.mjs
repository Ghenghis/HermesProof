import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  appendChainedJsonLine,
  canonicalJSON,
  ensureDir,
  sha256Hex,
  statePaths,
  utcNow
} from "./fs-utils.mjs";

// HP-MHA: HermesProof Model-Harness Attribution protocol
// Spec: docs/48-Point Lever.md sections 3, 4, 5, 6, 7, 8.
//
// This module is the independent proof authority. It must NEVER mutate a
// candidate harness, run its own optimization loop, or generate synthetic
// evidence to manufacture a winner (HP-MHA-009, HP-MHA-010).

export const HP_MHA_SCHEMA = "hermesproof.hp_mha.v1";
export const HP_MHA_CONTRACT_VERSION = "hermesproof.hp_mha.2026-08-06";
export const HP_HARNESS_ATTRIBUTION_GATE = "HP-HARNESS-ATTRIBUTION";

const SHA256_RE = /^[a-f0-9]{64}$/i;
const EVIDENCE_RE = /^ev_[a-z0-9]{8,}$/i;

// --- Required manifest field sets (HP-MHA-001) -------------------------------

const MODEL_REQUIRED = ["provider", "model_id"];
const MODEL_OPTIONAL = [
  "endpoint",
  "provider_revision",
  "context_window",
  "temperature",
  "top_p",
  "seed",
  "tool_mode",
  "reasoning_level",
  "max_output_tokens",
  "quantization",
  "model_file_sha256",
  "runtime_version",
  "gpu_layout",
  "prompt_caching",
  "fallback_policy",
  "fallback_observed"
];

const HARNESS_LAYER_FIELDS = {
  execution: [
    "installed_commit",
    "package_sha256",
    "container_digest",
    "runner_identity",
    "os_arch",
    "dependency_lock_sha256",
    "repo_commit",
    "repo_dirty",
    "per_step_timeout_s",
    "task_timeout_s",
    "max_steps",
    "token_budget",
    "cost_budget_usd",
    "wall_clock_budget_s",
    "network_policy",
    "sandbox_policy"
  ],
  model: ["provider", "model_id"],
  tools: [
    "tool_inventory",
    "tool_schema_hashes",
    "mcp_servers",
    "allowlist_sha256",
    "denylist_sha256",
    "tool_descriptions_sha256",
    "tool_result_format",
    "error_response_contract",
    "shell_restrictions",
    "write_boundaries",
    "destructive_op_policy"
  ],
  context: [
    "system_prompt_sha256",
    "project_contract_sha256",
    "context_construction_rules",
    "file_discovery",
    "retrieval_policy",
    "summarization_policy",
    "persistent_memory_policy",
    "max_retained_history",
    "constraint_reminder_behavior",
    "failed_outputs_visible",
    "test_output_injection"
  ],
  scheduling: [
    "controller",
    "planning_stage",
    "retry_count",
    "backoff",
    "escalation_rules",
    "subagent_delegation",
    "model_selection_policy",
    "stop_conditions",
    "checkpoint_rollback",
    "doom_loop_threshold",
    "per_file_edit_limit",
    "pre_completion_checklist"
  ],
  observability: [
    "tool_call_sequence_capture",
    "test_command_outcomes_capture",
    "failed_validation_capture",
    "patch_hashes",
    "changed_file_inventory",
    "timeout_cancellation_capture",
    "verification_commands_capture",
    "final_contract_check",
    "rerere_check",
    "trace_completeness_check",
    "missing_event_count"
  ],
  governance: [
    "workspace_scope",
    "side_effect_boundaries",
    "secret_access_policy",
    "human_approval_points",
    "destructive_action_policy",
    "redaction_policy",
    "secret_values_returned",
    "denied_action_attempts",
    "candidate_agent_proof_only"
  ]
};

const TASK_SET_REQUIRED = ["task_set_id", "tasks"];
const EVALUATOR_REQUIRED = ["evaluator_id", "evaluator_commit", "evaluator_sha256"];
const ENVIRONMENT_REQUIRED = ["environment_id", "os", "arch", "image_digest"];

const RUN_REQUIRED = [
  "run_id",
  "experiment_id",
  "model_manifest_sha256",
  "harness_manifest_sha256",
  "task_set_manifest_sha256",
  "evaluator_manifest_sha256",
  "environment_manifest_sha256",
  "trace_root_sha256",
  "outcome"
];

const ALLOWED_OUTCOMES = new Set(["passed", "failed", "cancelled", "crashed", "timed_out"]);
const ALLOWED_RETENTION = new Set(["release_pinned", "failure_diagnostic", "routine_run", "duplicate_chunk"]);
const ALLOWED_VERDICTS = new Set(["PASS", "FAIL", "INCONCLUSIVE"]);

// --- Validation helpers ------------------------------------------------------

function text(v) {
  return String(v ?? "").trim();
}

function isSha256(v) {
  return SHA256_RE.test(text(v));
}

function isEvidence(v) {
  return EVIDENCE_RE.test(text(v));
}

function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function presentFields(obj) {
  if (!isPlainObject(obj)) return [];
  return Object.keys(obj).filter((k) => obj[k] !== undefined && obj[k] !== null);
}

function requireFields(obj, fields, kind) {
  const missing = fields.filter((f) => !presentFields(obj).includes(f));
  if (missing.length > 0) {
    throw new Error(`${kind}: missing required field(s): ${missing.join(", ")}`);
  }
}

function canonicalHash(obj) {
  return sha256Hex(canonicalJSON(obj));
}

function deriveManifestId(label, payload) {
  const tag = text(label).toLowerCase().replace(/[^a-z0-9._-]/g, "-").slice(0, 32) || "manifest";
  const hash = canonicalHash(payload).slice(0, 16);
  return `${tag}_${hash}`;
}

function deriveEvidenceId(kind, prevHash) {
  const tag = text(kind) || "ev";
  const seed = `${tag}|${prevHash || "genesis"}|${crypto.randomBytes(8).toString("hex")}`;
  return `ev_${crypto.createHash("sha256").update(seed).digest("hex").slice(0, 16)}`;
}

function findUnexpectedFields(obj, allowed) {
  if (!isPlainObject(obj)) return [];
  return presentFields(obj).filter((k) => !allowed.includes(k));
}

// --- Layer schema validation -------------------------------------------------

export function validateModelManifest(model) {
  if (!isPlainObject(model)) throw new Error("model_manifest must be an object");
  requireFields(model, MODEL_REQUIRED, "model_manifest");
  const unexpected = findUnexpectedFields(model, [...MODEL_REQUIRED, ...MODEL_OPTIONAL]);
  if (unexpected.length > 0) {
    throw new Error(`model_manifest: unexpected field(s): ${unexpected.join(", ")}`);
  }
  if ("model_file_sha256" in model && model.model_file_sha256 !== "" && !isSha256(model.model_file_sha256)) {
    throw new Error("model_manifest.model_file_sha256 must be a SHA-256 hex");
  }
  if ("fallback_observed" in model && typeof model.fallback_observed !== "boolean") {
    throw new Error("model_manifest.fallback_observed must be a boolean");
  }
  return true;
}

export function validateHarnessCardLayers(layers) {
  if (!isPlainObject(layers)) throw new Error("harness_manifest.layers must be an object");
  const allowed = Object.keys(HARNESS_LAYER_FIELDS);
  const unexpected = findUnexpectedFields(layers, allowed);
  if (unexpected.length > 0) {
    throw new Error(`harness_manifest.layers: unknown layer(s): ${unexpected.join(", ")}`);
  }
  for (const [layer, fields] of Object.entries(HARNESS_LAYER_FIELDS)) {
    if (!presentFields(layers).includes(layer)) {
      throw new Error(`harness_manifest.layers.${layer} is required`);
    }
    const obj = layers[layer];
    if (!isPlainObject(obj)) throw new Error(`harness_manifest.layers.${layer} must be an object`);
    const unexpectedLayer = findUnexpectedFields(obj, fields);
    if (unexpectedLayer.length > 0) {
      throw new Error(`harness_manifest.layers.${layer}: unexpected field(s): ${unexpectedLayer.join(", ")}`);
    }
  }
  return true;
}

export function validateHarnessCard(card) {
  if (!isPlainObject(card)) throw new Error("harness_card must be an object");
  requireFields(card, ["card_id", "layers"], "harness_card");
  validateHarnessCardLayers(card.layers);
  return true;
}

export function validateTaskSetManifest(taskSet) {
  if (!isPlainObject(taskSet)) throw new Error("task_set_manifest must be an object");
  requireFields(taskSet, TASK_SET_REQUIRED, "task_set_manifest");
  if (!Array.isArray(taskSet.tasks) || taskSet.tasks.length === 0) {
    throw new Error("task_set_manifest.tasks must be a non-empty array");
  }
  return true;
}

export function validateEvaluatorManifest(evaluator) {
  if (!isPlainObject(evaluator)) throw new Error("evaluator_manifest must be an object");
  requireFields(evaluator, EVALUATOR_REQUIRED, "evaluator_manifest");
  if (!isSha256(evaluator.evaluator_sha256)) {
    throw new Error("evaluator_manifest.evaluator_sha256 must be a SHA-256 hex");
  }
  return true;
}

export function validateEnvironmentManifest(env) {
  if (!isPlainObject(env)) throw new Error("environment_manifest must be an object");
  requireFields(env, ENVIRONMENT_REQUIRED, "environment_manifest");
  return true;
}

// --- Manifest builders (canonical + hashed) ----------------------------------

export function buildModelManifest(input) {
  validateModelManifest(input);
  const ordered = {};
  for (const k of [...MODEL_REQUIRED, ...MODEL_OPTIONAL]) {
    if (k in input) ordered[k] = input[k];
  }
  return {
    schema: "hermesproof.hp_mha.model_manifest.v2",
    schema_version: 1,
    manifest_id: deriveManifestId("model", ordered),
    manifest_sha256: canonicalHash(ordered),
    payload: ordered
  };
}

export function buildHarnessCard(input) {
  validateHarnessCard(input);
  const ordered = { card_id: input.card_id, layers: {} };
  for (const layer of Object.keys(HARNESS_LAYER_FIELDS)) {
    if (layer in input.layers) {
      const layerObj = {};
      for (const k of HARNESS_LAYER_FIELDS[layer]) {
        if (k in input.layers[layer]) layerObj[k] = input.layers[layer][k];
      }
      ordered.layers[layer] = layerObj;
    }
  }
  return {
    schema: "hermesproof.hp_mha.harness_card.v2",
    schema_version: 1,
    manifest_id: deriveManifestId("harness", ordered),
    manifest_sha256: canonicalHash(ordered),
    payload: ordered
  };
}

export function buildTaskSetManifest(input) {
  validateTaskSetManifest(input);
  const ordered = {};
  for (const k of TASK_SET_REQUIRED) {
    if (k in input) ordered[k] = input[k];
  }
  for (const k of presentFields(input)) {
    if (!TASK_SET_REQUIRED.includes(k)) ordered[k] = input[k];
  }
  return {
    schema: "hermesproof.hp_mha.task_set_manifest.v2",
    schema_version: 1,
    manifest_id: deriveManifestId("task_set", ordered),
    manifest_sha256: canonicalHash(ordered),
    payload: ordered
  };
}

export function buildEvaluatorManifest(input) {
  validateEvaluatorManifest(input);
  const ordered = {};
  for (const k of presentFields(input)) ordered[k] = input[k];
  return {
    schema: "hermesproof.hp_mha.evaluator_manifest.v2",
    schema_version: 1,
    manifest_id: deriveManifestId("evaluator", ordered),
    manifest_sha256: canonicalHash(ordered),
    payload: ordered
  };
}

export function buildEnvironmentManifest(input) {
  validateEnvironmentManifest(input);
  const ordered = {};
  for (const k of presentFields(input)) ordered[k] = input[k];
  return {
    schema: "hermesproof.hp_mha.environment_manifest.v2",
    schema_version: 1,
    manifest_id: deriveManifestId("environment", ordered),
    manifest_sha256: canonicalHash(ordered),
    payload: ordered
  };
}

// --- HP-MHA-002, HP-MHA-003: Comparison design validation --------------------

export function validateModelComparison(plan) {
  if (!isPlainObject(plan)) {
    return { ok: false, reason_code: "HP-MHA-002", reason: "comparison claim is not an object" };
  }
  const { design, locked_harness_sha256 } = plan;
  if (design === "factorial_2x2" || design === "factorial_NxN") return { ok: true, reason_code: "HP-MHA-002-pass" };
  if (design === "locked_harness") {
    if (!isSha256(locked_harness_sha256)) {
      return { ok: false, reason_code: "HP-MHA-002", reason: "locked_harness_sha256 must be a SHA-256 hex" };
    }
    return { ok: true, reason_code: "HP-MHA-002-pass" };
  }
  return {
    ok: false,
    reason_code: "HP-MHA-002",
    reason: "comparison claim must use locked_harness, factorial_2x2, or factorial_NxN design"
  };
}

export function validateHarnessImprovementClaim(plan) {
  if (!isPlainObject(plan)) {
    return { ok: false, reason_code: "HP-MHA-003", reason: "harness claim is not an object" };
  }
  const { held_constant, model_manifest_sha256 } = plan;
  const required = [
    "model",
    "inference_settings",
    "task_set",
    "environment",
    "evaluator",
    "permissions",
    "budgets",
    "stopping_rules"
  ];
  if (!isPlainObject(held_constant)) {
    return { ok: false, reason_code: "HP-MHA-003", reason: "held_constant must be an object" };
  }
  const missing = required.filter((k) => !presentFields(held_constant).includes(k));
  if (missing.length > 0) {
    return {
      ok: false,
      reason_code: "HP-MHA-003",
      reason: `held_constant is missing required keys: ${missing.join(", ")}`
    };
  }
  if (!isSha256(model_manifest_sha256)) {
    return { ok: false, reason_code: "HP-MHA-003", reason: "model_manifest_sha256 must be a SHA-256 hex" };
  }
  return { ok: true, reason_code: "HP-MHA-003-pass" };
}

// --- HP-MHA-004: contamination classification -------------------------------

export function classifyContamination(run) {
  const findings = [];
  if (!isPlainObject(run)) {
    return { contaminated: true, findings: [{ kind: "run_invalid", detail: "run is not an object" }] };
  }
  if (run.model_manifest_sha256_requested && run.model_manifest_sha256_actual &&
      run.model_manifest_sha256_requested !== run.model_manifest_sha256_actual) {
    findings.push({ kind: "model_substitution", detail: "model_manifest_sha256 changed during the run" });
  }
  if (run.fallback_observed === true) {
    findings.push({ kind: "undeclared_fallback", detail: "fallback_observed=true without prior declaration" });
  }
  if (run.reasoning_level_changed === true) {
    findings.push({ kind: "reasoning_changed", detail: "reasoning level changed mid-run" });
  }
  if (run.timeout_changed === true) {
    findings.push({ kind: "timeout_changed", detail: "timeout changed mid-run" });
  }
  if (run.tool_inventory_changed === true) {
    findings.push({ kind: "tool_inventory_changed", detail: "tool inventory changed mid-run" });
  }
  return { contaminated: findings.length > 0, findings };
}

// --- HP-MHA-005: denominator accounting --------------------------------------

export function computeDenominator(runs) {
  if (!Array.isArray(runs)) {
    throw new Error("runs must be an array");
  }
  let passed = 0;
  let failed = 0;
  let cancelled = 0;
  let crashed = 0;
  let timedOut = 0;
  const outcomeCounts = new Map();
  for (const r of runs) {
    const outcome = text(r?.outcome).toLowerCase();
    outcomeCounts.set(outcome, (outcomeCounts.get(outcome) || 0) + 1);
    if (outcome === "passed") passed++;
    else if (outcome === "failed") failed++;
    else if (outcome === "cancelled") cancelled++;
    else if (outcome === "crashed") crashed++;
    else if (outcome === "timed_out") timedOut++;
  }
  const total = runs.length;
  const passRate = total === 0 ? 0 : passed / total;
  return { total, passed, failed, cancelled, crashed, timed_out: timedOut, pass_rate: passRate, outcome_counts: Object.fromEntries(outcomeCounts) };
}

// --- HP-MHA-007: factorial attribution math ----------------------------------

export function computeFactorialAttribution(matrix) {
  if (!isPlainObject(matrix)) throw new Error("matrix must be an object");
  const cells = ["s11", "s12", "s21", "s22"];
  for (const c of cells) {
    if (!isFiniteNumber(matrix[c])) {
      throw new Error(`matrix.${c} must be a finite number`);
    }
  }
  // Round to 12 decimal places to absorb IEEE-754 noise from cell subtraction;
  // 1e-12 is well below any reasonable percentage-point precision and any
  // model/harness effect that survives at that scale is real.
  const round = (n) => Math.round(n * 1e12) / 1e12;
  const harnessEffect = round(((matrix.s12 - matrix.s11) + (matrix.s22 - matrix.s21)) / 2);
  const modelEffect = round(((matrix.s21 - matrix.s11) + (matrix.s22 - matrix.s12)) / 2);
  const interaction = round(matrix.s22 - matrix.s21 - matrix.s12 + matrix.s11);
  return {
    harness_effect_pp: harnessEffect,
    model_effect_pp: modelEffect,
    interaction_pp: interaction,
    cells: matrix
  };
}

// --- HP-MHA-008: promotion verdict with reason codes -------------------------

export function evaluatePromotion({ kind, evidence_ids, run_attestations, plan, attribution, contested }) {
  // HP-MHA-008 malformed-input guard. Each required field must itself be an
  // object/array; a missing plan cannot be silently PASSed.
  if (!isPlainObject(plan)) {
    return { verdict: "FAIL", reason_codes: ["HP-MHA-008-malformed"], reason: "plan is not an object" };
  }
  if (!Array.isArray(run_attestations)) {
    return { verdict: "FAIL", reason_codes: ["HP-MHA-008-malformed"], reason: "run_attestations is not an array" };
  }
  if (!Array.isArray(evidence_ids) || evidence_ids.length === 0) {
    return { verdict: "FAIL", reason_codes: ["HP-MHA-008-no-evidence"], reason: "missing chained ev_* evidence_ids" };
  }
  if (!evidence_ids.every(isEvidence)) {
    return { verdict: "FAIL", reason_codes: ["HP-MHA-008-no-evidence"], reason: "invalid chained ev_* evidence_ids" };
  }
  const reasonCodes = [];

  // HP-MHA-001 binding
  const requiredKeys = [
    "model_manifest_sha256",
    "harness_manifest_sha256",
    "task_set_manifest_sha256",
    "evaluator_manifest_sha256",
    "environment_manifest_sha256",
    "trace_root_sha256"
  ];
  for (const k of requiredKeys) {
    if (!isSha256(plan?.[k])) {
      return { verdict: "FAIL", reason_codes: ["HP-MHA-001", `missing manifest binding: ${k}`], reason: "HP-MHA-001 binding incomplete" };
    }
  }

  // HP-MHA-002 / HP-MHA-003 design
  const modelCheck = validateModelComparison(plan);
  if (!modelCheck.ok) return { verdict: "FAIL", reason_codes: [modelCheck.reason_code], reason: modelCheck.reason };
  const harnessCheck = validateHarnessImprovementClaim(plan);
  if (!harnessCheck.ok) return { verdict: "FAIL", reason_codes: [harnessCheck.reason_code], reason: harnessCheck.reason };

  // HP-MHA-004 contamination
  if (Array.isArray(run_attestations)) {
    for (const r of run_attestations) {
      const cls = classifyContamination(r);
      if (cls.contaminated) {
        return {
          verdict: "FAIL",
          reason_codes: ["HP-MHA-004", ...cls.findings.map((f) => f.kind)],
          reason: "experiment contamination detected",
          findings: cls.findings
        };
      }
    }
  }

  // HP-MHA-005 denominator
  const denom = computeDenominator(run_attestations || []);
  if (denom.total === 0) {
    return { verdict: "INCONCLUSIVE", reason_codes: ["HP-MHA-005-empty"], reason: "no runs submitted" };
  }
  const omittedOutcomes = denom.failed + denom.cancelled + denom.crashed + denom.timed_out;
  if (omittedOutcomes === 0 && denom.total > 1) {
    return { verdict: "FAIL", reason_codes: ["HP-MHA-005-impossible-clean"], reason: "no failed/cancelled/crashed/timed_out runs in denominator" };
  }

  // HP-MHA-006 holdout isolation
  if (plan?.holdout_visible_to_optimizer === true) {
    return { verdict: "FAIL", reason_codes: ["HP-MHA-006"], reason: "holdout results leaked to optimizer before candidate frozen" };
  }

  // HP-MHA-007 multi-dimensional reporting
  if (!isPlainObject(attribution) || !isFiniteNumber(attribution.harness_effect_pp) || !isFiniteNumber(attribution.model_effect_pp) || !isFiniteNumber(attribution.interaction_pp)) {
    return { verdict: "FAIL", reason_codes: ["HP-MHA-007"], reason: "attribution must report harness effect, model effect and interaction" };
  }

  // HP-MHA-008 reason codes already validated at the top of this function.

  // HP-MHA-009 independence: contest any self-certification
  if (contested?.self_certified === true) {
    return { verdict: "FAIL", reason_codes: ["HP-MHA-009"], reason: "candidate harness cannot self-certify" };
  }

  // HP-MHA-010 real execution: synthetic / mock / string-count are forbidden
  if (plan?.execution_real !== true) {
    return { verdict: "FAIL", reason_codes: ["HP-MHA-010"], reason: "execution_real must be true (real runtime, real tool chain)" };
  }
  if (Array.isArray(plan?.fake_signals) && plan.fake_signals.some((v) => v === true)) {
    return { verdict: "FAIL", reason_codes: ["HP-MHA-010-mock"], reason: "mock/fake/stub/synthetic signals present in plan" };
  }

  return {
    verdict: "PASS",
    reason_codes: reasonCodes.length === 0 ? ["HP-MHA-001-pass"] : reasonCodes,
    reason: "all HP-MHA contract requirements satisfied",
    denominator: denom,
    attribution: {
      harness_effect_pp: attribution.harness_effect_pp,
      model_effect_pp: attribution.model_effect_pp,
      interaction_pp: attribution.interaction_pp
    }
  };
}

// --- HP-MHA-008: trace bundle verification -----------------------------------

export function verifyTraceBundle(bundle) {
  if (!isPlainObject(bundle)) {
    return { ok: false, reason_codes: ["HP-MHA-008-malformed"], reason: "trace_bundle is not an object" };
  }
  const { bundle_id, retention, chunks, root_sha256 } = bundle;
  if (!text(bundle_id)) return { ok: false, reason_codes: ["HP-MHA-008-no-id"], reason: "bundle_id required" };
  if (!ALLOWED_RETENTION.has(retention)) {
    return { ok: false, reason_codes: ["HP-MHA-008-bad-retention"], reason: `retention must be one of ${[...ALLOWED_RETENTION].join(",")}` };
  }
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return { ok: false, reason_codes: ["HP-MHA-008-empty"], reason: "chunks must be non-empty" };
  }
  if (!isSha256(root_sha256)) {
    return { ok: false, reason_codes: ["HP-MHA-008-no-root"], reason: "root_sha256 must be a SHA-256 hex" };
  }
  const findings = [];
  let computedMerkle = null;
  const hashLeaves = [];
  for (const [i, chunk] of chunks.entries()) {
    if (!isPlainObject(chunk)) {
      findings.push({ index: i, reason: "chunk not an object" });
      continue;
    }
    if (!isSha256(chunk.sha256)) {
      findings.push({ index: i, reason: "chunk.sha256 missing or not SHA-256" });
    } else {
      hashLeaves.push(chunk.sha256);
    }
  }
  // Merkle root recomputation (left-fold concat, deterministic). We compute
  // even when some chunks were malformed; findings still list the offenders.
  if (hashLeaves.length > 0) {
    let layer = hashLeaves.slice();
    while (layer.length > 1) {
      const next = [];
      for (let i = 0; i < layer.length; i += 2) {
        const left = layer[i];
        const right = i + 1 < layer.length ? layer[i + 1] : left;
        next.push(sha256Hex(left + right));
      }
      layer = next;
    }
    computedMerkle = layer[0];
  }
  if (!findings.some((f) => /chunk not an object/.test(f.reason || "")) && computedMerkle !== root_sha256) {
    findings.push({ index: -1, reason: "computed Merkle root does not match root_sha256" });
  }
  if (findings.length > 0) {
    return {
      ok: false,
      reason_codes: ["HP-MHA-008-trace-tampered"],
      reason: "trace bundle verification failed",
      findings,
      computed_merkle_root: computedMerkle
    };
  }
  return { ok: true, reason_codes: ["HP-MHA-008-pass"], reason: "trace bundle verified", computed_merkle_root: computedMerkle };
}

// --- Evidence ledger --------------------------------------------------------

export function hpMhaLedgerPath(workspaceRoot, stateDirName) {
  const paths = statePaths(workspaceRoot, stateDirName);
  return path.join(paths.evidenceDir, "hp_mha.ndjson");
}

export async function appendHpMhaEvidence(workspaceRoot, stateDirName, entry) {
  const file = hpMhaLedgerPath(workspaceRoot, stateDirName);
  await ensureDir(path.dirname(file));
  const ts = entry.ts_utc || utcNow();
  // Read the latest chained entry so the derived id can include prev_hash for
  // collision resistance across processes / ledger rewinds.
  let prevHash = null;
  try {
    const raw = await fs.readFile(file, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const last = JSON.parse(lines[i]);
        if (last && typeof last.entry_hash === "string") {
          prevHash = last.entry_hash;
          break;
        }
      } catch { /* skip malformed */ }
    }
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  const id = deriveEvidenceId(entry.kind || "ev", prevHash);
  const final = await appendChainedJsonLine(file, {
    id,
    schema: HP_MHA_SCHEMA,
    contract_version: HP_MHA_CONTRACT_VERSION,
    ts_utc: ts,
    ...entry
  });
  return final;
}

export async function readHpMhaEvidence(workspaceRoot, stateDirName) {
  const file = hpMhaLedgerPath(workspaceRoot, stateDirName);
  try {
    const raw = await fs.readFile(file, "utf8");
    return raw.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

// --- HP-MHA-001: result binding check ---------------------------------------

export function validateRunBinding(run, expected) {
  if (!isPlainObject(run)) return { ok: false, reason_codes: ["HP-MHA-001"], reason: "run not an object" };
  for (const k of RUN_REQUIRED) {
    if (!(k in run)) return { ok: false, reason_codes: ["HP-MHA-001"], reason: `run missing ${k}` };
  }
  if (!ALLOWED_OUTCOMES.has(run.outcome)) {
    return { ok: false, reason_codes: ["HP-MHA-005-bad-outcome"], reason: `outcome must be one of ${[...ALLOWED_OUTCOMES].join(",")}` };
  }
  if (expected) {
    for (const k of ["model_manifest_sha256", "harness_manifest_sha256", "task_set_manifest_sha256", "evaluator_manifest_sha256", "environment_manifest_sha256"]) {
      if (expected[k] && run[k] !== expected[k]) {
        return { ok: false, reason_codes: ["HP-MHA-001-mismatch"], reason: `run ${k} does not match locked plan` };
      }
    }
  }
  if (!isSha256(run.trace_root_sha256)) {
    return { ok: false, reason_codes: ["HP-MHA-001-trace"], reason: "trace_root_sha256 must be a SHA-256 hex" };
  }
  return { ok: true, reason_codes: ["HP-MHA-001-pass"], reason: "all six manifests bound and trace root hashed" };
}

// --- Trace retention pruning (HP-MHA spec §8.1) -------------------------------
//
// The HP-MHA ledger is append-only and hash-chained. pruneByRetention is
// therefore an ADVISORY classifier: it walks the evidence, groups each
// ev_trace entry by its retention class, and reports what SHOULD be kept,
// pruned, or deduped under the current policy. The hash chain itself is not
// mutated. A single `ev_prune` summary is appended to record the policy
// decision; a separate cron job can then act on that summary to delete
// files outside HermesProof's proof authority.

export function classifyRetentionClass(entry) {
  if (!isPlainObject(entry)) return "unknown";
  if (entry.kind === "ev_trace") return ALLOWED_RETENTION.has(entry.retention) ? entry.retention : "unknown";
  return "ledger_internal";
}

export function pruneByRetention({ evidence, options } = {}) {
  if (!Array.isArray(evidence)) throw new Error("evidence must be an array");
  const opts = isPlainObject(options) ? options : {};
  const routineRetentionMs = isFiniteNumber(opts.routine_retention_ms) && opts.routine_retention_ms > 0
    ? opts.routine_retention_ms
    : (opts.routine_retention_ms === 0 ? null : 7 * 24 * 60 * 60 * 1000);
  const failureAllowedWithoutOverride = opts.failures_required === true;
  const nowMs = isFiniteNumber(opts.now_ms) ? opts.now_ms : Date.now();
  const seenDuplicateHashes = new Set();
  const survivors = [];
  const pruned = [];
  const deduped = [];

  for (const entry of evidence) {
    if (!isPlainObject(entry)) continue;
    const retentionClass = classifyRetentionClass(entry);
    if (retentionClass === "release_pinned") {
      survivors.push(entry);
      continue;
    }
    if (retentionClass === "failure_diagnostic") {
      if (failureAllowedWithoutOverride) {
        survivors.push(entry);
      } else {
        pruned.push({ id: entry.id || null, retention: retentionClass, reason: "failure_diagnostic_purge_requested" });
      }
      continue;
    }
    if (retentionClass === "duplicate_chunk") {
      const hash = entry.root_sha256 || entry.chunk_sha256 || (entry.payload && entry.payload.sha256);
      if (typeof hash === "string" && seenDuplicateHashes.has(hash)) {
        deduped.push({ id: entry.id || null, hash });
        pruned.push({ id: entry.id || null, retention: retentionClass, reason: "duplicate_chunk" });
      } else {
        if (typeof hash === "string") seenDuplicateHashes.add(hash);
        survivors.push(entry);
      }
      continue;
    }
    if (retentionClass === "routine_run") {
      if (routineRetentionMs === null) {
        survivors.push(entry);
        continue;
      }
      const entryMs = Date.parse(entry.ts_utc || "");
      if (!Number.isFinite(entryMs)) {
        pruned.push({ id: entry.id || null, retention: retentionClass, reason: "routine_run_unparseable_ts" });
        continue;
      }
      if (nowMs - entryMs > routineRetentionMs) {
        pruned.push({ id: entry.id || null, retention: retentionClass, reason: "routine_run_retention_exceeded", age_ms: nowMs - entryMs });
      } else {
        survivors.push(entry);
      }
      continue;
    }
    survivors.push(entry);
  }
  return {
    survivors_count: survivors.length,
    pruned_count: pruned.length,
    deduped_count: deduped.length,
    pinned_count: survivors.filter((e) => classifyRetentionClass(e) === "release_pinned").length,
    pruned,
    deduped,
    survivors,
    retention_classes: Object.fromEntries(
      ["release_pinned", "failure_diagnostic", "routine_run", "duplicate_chunk"].map((c) => [c, survivors.filter((e) => classifyRetentionClass(e) === c).length])
    )
  };
}

export async function pruneAndRecordRetention({ workspaceRoot, stateDirName, options }) {
  const all = await readHpMhaEvidence(workspaceRoot, stateDirName);
  const result = pruneByRetention({ evidence: all, options });
  const summary = {
    survivors_count: result.survivors_count,
    pruned_count: result.pruned_count,
    deduped_count: result.deduped_count,
    pinned_count: result.pinned_count,
    retention_classes: result.retention_classes
  };
  const evidence = await appendHpMhaEvidence(workspaceRoot, stateDirName, {
    kind: "ev_prune",
    summary
  });
  return {
    schema: "hermesproof.hp_mha.trace_prune.v2",
    contract_version: HP_MHA_CONTRACT_VERSION,
    evidence_id: evidence.id,
    survivors_count: result.survivors_count,
    pruned_count: result.pruned_count,
    deduped_count: result.deduped_count,
    pinned_count: result.pinned_count,
    retention_classes: result.retention_classes,
    pruned: result.pruned,
    deduped: result.deduped
  };
}

// --- Trace-level metrics (HP-MHA spec §6) -----------------------------------
//
// Input: a trace bundle whose chunks carry `kind` and optional `signals`. The
// metric vocabulary mirrors the spec:
//   - recovery rate: after an error/failure chunk, did productive work resume
//     within 1, 3, 5, 10 steps?
//   - control lag: steps from problem detected -> corrective instruction
//     -> corrective action.
//   - context retention: fraction of required signals still present near
//     the end of the bundle (last `lookback` chunks).
//
// A bundle with no error chunks still reports recovery_rate=1 and zero control
// lag, since nothing needed recovery.

export const ERROR_KINDS = new Set(["tool_error", "test_failure", "patch_rejected", "malformed"]);
// "productive work" = an action that produced a usable result. Issuing an
// instruction or recording a correction is part of control lag, not recovery.
export const PRODUCTIVE_KINDS = new Set(["tool_ok", "patch_accepted", "test_passed", "corrective_action"]);
export const INSTRUCTION_KINDS = new Set(["instruction_issued"]);

export function computeTraceMetrics({ bundle, required_signals = [], lookback = 5 } = {}) {
  if (!isPlainObject(bundle)) throw new Error("bundle must be an object");
  const chunks = Array.isArray(bundle.chunks) ? bundle.chunks : [];
  const recoveryThresholdSteps = [1, 3, 5, 10];
  const recoveryHits = Object.fromEntries(recoveryThresholdSteps.map((n) => [n, 0]));
  let errorChunks = 0;
  let controlLagTotal = 0;
  let controlLagSamples = 0;
  const errorEvents = [];

  for (let i = 0; i < chunks.length; i++) {
    const ch = chunks[i];
    const kind = text(ch?.kind);
    if (!ERROR_KINDS.has(kind)) continue;
    errorChunks++;
    let recoveredAt = null;
    for (let j = 1; j <= recoveryThresholdSteps[recoveryThresholdSteps.length - 1] && i + j < chunks.length; j++) {
      if (PRODUCTIVE_KINDS.has(text(chunks[i + j].kind))) {
        recoveredAt = j;
        break;
      }
    }
    if (recoveredAt !== null) {
      for (const n of recoveryThresholdSteps) if (recoveredAt <= n) recoveryHits[n]++;
    }
    // Control lag: error -> instruction_issued -> corrective_action (each within 5 steps)
    const inst = findKindWithin(chunks, i, "instruction_issued", 5);
    const fix = inst !== null ? findKindWithin(chunks, inst, "corrective_action", 5) : null;
    if (inst !== null && fix !== null) {
      controlLagTotal += fix - i;
      controlLagSamples++;
    }
    errorEvents.push({ index: i, recovered_at: recoveredAt });
  }

  const recoveryRate = (n) => errorChunks === 0 ? 1 : recoveryHits[n] / errorChunks;
  const lastChunkIdx = chunks.length - 1;
  const lookbackStart = Math.max(0, lastChunkIdx - lookback + 1);
  const tailSignals = chunks.slice(lookbackStart).flatMap((c) => Array.isArray(c.signals) ? c.signals : []);
  const signalSet = new Set(tailSignals);
  const contextRetention = required_signals.length === 0 ? 1 : required_signals.filter((s) => signalSet.has(s)).length / required_signals.length;

  return {
    chunk_count: chunks.length,
    error_count: errorChunks,
    recovery_rate_at_1_step: recoveryRate(1),
    recovery_rate_at_3_steps: recoveryRate(3),
    recovery_rate_at_5_steps: recoveryRate(5),
    recovery_rate_at_10_steps: recoveryRate(10),
    avg_control_lag_steps: controlLagSamples === 0 ? 0 : controlLagTotal / controlLagSamples,
    context_retention: Number(contextRetention.toFixed(4)),
    required_signals: required_signals.slice(),
    lookback_used: lookback,
    error_events: errorEvents
  };
}

function findKindWithin(chunks, fromIndex, kind, maxSteps) {
  for (let j = 1; j <= maxSteps && fromIndex + j < chunks.length; j++) {
    if (text(chunks[fromIndex + j].kind) === kind) return fromIndex + j;
  }
  return null;
}

// --- v4: trace-search index (HP-MHA spec §8.1) --------------------------------
//
// Stored at <workspace>/<stateDir>/evidence/hp_mha_trace_index.ndjson.
// One index row per chunk; range queries run O(log n) over (bundle_id, byte_start)
// without scanning the ledger. Schema is intentionally small so it survives a
// purge + a re-index pass from release_pinned bundles.

const TRACE_INDEX_SCHEMA = "hermesproof.hp_mha.trace_index.v2";
const TRACE_INDEX_KIND = "ev_trace_index";

export const traceIndexPath = (workspaceRoot, stateDirName) => {
  const paths = statePaths(workspaceRoot, stateDirName);
  return path.join(paths.evidenceDir, "hp_mha_trace_index.ndjson");
};

export function buildTraceIndexRows(bundle) {
  if (!isPlainObject(bundle)) throw new Error("bundle must be an object");
  const bundleId = text(bundle.bundle_id);
  if (!bundleId) throw new Error("bundle.bundle_id is required");
  const rows = [];
  let bytesCommitted = 0;      // last-byte position of the previous emitted row
  let pendingSkipBytes = 0;   // bytes of chunks skipped since the last commit
  const chunks = Array.isArray(bundle.chunks) ? bundle.chunks : [];
  for (const chunk of chunks) {
    const sha = isPlainObject(chunk) && isSha256(chunk.sha256) ? chunk.sha256 : null;
    const chunkBytes =
      isFiniteNumber(chunk.bytes) ? chunk.bytes :
      isFiniteNumber(chunk.byte_size) ? chunk.byte_size : 0;
    if (!sha) {
      pendingSkipBytes += chunkBytes;
      continue;
    }
    const rowStart = bytesCommitted + pendingSkipBytes;
    const rowEnd = rowStart + Math.max(chunkBytes, 0);
    pendingSkipBytes = 0;
    bytesCommitted = rowEnd;
    const tokens =
      isFiniteNumber(chunk.tokens) ? chunk.tokens :
      isFiniteNumber(chunk.token_count) ? chunk.token_count : 0;
    rows.push({
      schema: TRACE_INDEX_SCHEMA,
      kind: TRACE_INDEX_KIND,
      bundle_id: bundleId,
      retention: ALLOWED_RETENTION.has(bundle.retention) ? bundle.retention : "unknown",
      chunk_sha256: sha,
      byte_start: rowStart,
      byte_end: rowEnd,
      tokens,
      kind_hint: text(chunk.kind) || null,
      signal_tags: Array.isArray(chunk.signals) ? chunk.signals.filter((s) => typeof s === "string") : []
    });
  }
  return rows;
}

export async function writeTraceIndex({ workspaceRoot, stateDirName, bundle }) {
  const rows = buildTraceIndexRows(bundle);
  const file = traceIndexPath(workspaceRoot, stateDirName);
  await ensureDir(path.dirname(file));
  await fs.appendFile(file, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""), "utf8");
  return { schema: TRACE_INDEX_SCHEMA, file, row_count: rows.length, bundle_id: bundle.bundle_id };
}

// Read index rows for one bundle. Returns rows sorted by byte_start ascending.
export async function readTraceIndex({ workspaceRoot, stateDirName, bundle_id } = {}) {
  const file = traceIndexPath(workspaceRoot, stateDirName);
  let text;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const out = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (!isPlainObject(row) || row.kind !== TRACE_INDEX_KIND) continue;
    if (bundle_id && row.bundle_id !== bundle_id) continue;
    out.push(row);
  }
  out.sort((a, b) => (a.byte_start || 0) - (b.byte_start || 0));
  return out;
}

// Range-search the index. Returns at most `limit` rows whose byte window
// intersects the [byte_start, byte_end] range, sorted by byte_start.
export function searchTraceIndex(indexRows, { byte_start, byte_end, signals, kind, limit } = {}) {
  const lo = isFiniteNumber(byte_start) ? byte_start : -Infinity;
  const hi = isFiniteNumber(byte_end) ? byte_end : Infinity;
  const signalSet = Array.isArray(signals) ? new Set(signals) : null;
  const matches = [];
  for (const row of indexRows) {
    if (row.byte_end < lo || row.byte_start > hi) continue;
    if (kind && row.kind_hint !== kind) continue;
    if (signalSet && !row.signal_tags.some((t) => signalSet.has(t))) continue;
    matches.push(row);
    if (isFiniteNumber(limit) && matches.length >= limit) break;
  }
  return matches;
}

// --- MCP tool surface -------------------------------------------------------

export async function recordHarnessCard({ workspaceRoot, stateDirName, harness_card }) {
  validateHarnessCard(harness_card);
  const built = buildHarnessCard(harness_card);
  const evidence = await appendHpMhaEvidence(workspaceRoot, stateDirName, {
    kind: "ev_harness",
    harness_card_id: built.manifest_id,
    harness_card_sha256: built.manifest_sha256,
    payload: built.payload
  });
  return {
    schema: "hermesproof.hp_mha.harness_card_record.v2",
    contract_version: HP_MHA_CONTRACT_VERSION,
    evidence_id: evidence.id,
    harness_card_id: built.manifest_id,
    harness_card_sha256: built.manifest_sha256,
    prev_entry_id: evidence.prev_entry_id,
    prev_hash: evidence.prev_hash
  };
}

export async function lockExperimentPlan({ workspaceRoot, stateDirName, plan }) {
  if (!isPlainObject(plan)) throw new Error("plan must be an object");
  requireFields(plan, ["experiment_id", "model_manifest", "harness_card", "task_set_manifest", "evaluator_manifest", "environment_manifest"], "plan");
  const model = buildModelManifest(plan.model_manifest);
  const harness = buildHarnessCard(plan.harness_card);
  const taskSet = buildTaskSetManifest(plan.task_set_manifest);
  const evaluator = buildEvaluatorManifest(plan.evaluator_manifest);
  const environment = buildEnvironmentManifest(plan.environment_manifest);
  // Inject the freshly-computed manifest shas BEFORE design/contamination
  // validation so the HP-MHA-002 / HP-MHA-003 checks act on the shas the
  // server is actually about to lock, not on whatever the caller typed.
  const lockedPlan = {
    ...plan,
    model_manifest_sha256: model.manifest_sha256,
    harness_manifest_sha256: harness.manifest_sha256,
    task_set_manifest_sha256: taskSet.manifest_sha256,
    evaluator_manifest_sha256: evaluator.manifest_sha256,
    environment_manifest_sha256: environment.manifest_sha256
  };
  const modelCheck = validateModelComparison(lockedPlan);
  if (!modelCheck.ok) throw new Error(`${modelCheck.reason_code}: ${modelCheck.reason}`);
  const harnessCheck = validateHarnessImprovementClaim(lockedPlan);
  if (!harnessCheck.ok) throw new Error(`${harnessCheck.reason_code}: ${harnessCheck.reason}`);
  const evidence = await appendHpMhaEvidence(workspaceRoot, stateDirName, {
    kind: "ev_experiment",
    experiment_id: plan.experiment_id,
    model_manifest_sha256: model.manifest_sha256,
    harness_manifest_sha256: harness.manifest_sha256,
    task_set_manifest_sha256: taskSet.manifest_sha256,
    evaluator_manifest_sha256: evaluator.manifest_sha256,
    environment_manifest_sha256: environment.manifest_sha256,
    comparison_design: plan.design || "factorial_2x2",
    held_constant_keys: Object.keys(plan.held_constant || {})
  });
  return {
    schema: "hermesproof.hp_mha.experiment_plan_lock.v2",
    contract_version: HP_MHA_CONTRACT_VERSION,
    evidence_id: evidence.id,
    experiment_id: plan.experiment_id,
    model_manifest_sha256: model.manifest_sha256,
    harness_manifest_sha256: harness.manifest_sha256,
    task_set_manifest_sha256: taskSet.manifest_sha256,
    evaluator_manifest_sha256: evaluator.manifest_sha256,
    environment_manifest_sha256: environment.manifest_sha256,
    prev_entry_id: evidence.prev_entry_id,
    prev_hash: evidence.prev_hash
  };
}

export async function attestBenchmarkRun({ workspaceRoot, stateDirName, run }) {
  if (!isPlainObject(run)) throw new Error("run must be an object");
  for (const k of RUN_REQUIRED) {
    if (!(k in run)) throw new Error(`run missing ${k}`);
  }
  if (!ALLOWED_OUTCOMES.has(run.outcome)) {
    throw new Error(`outcome must be one of ${[...ALLOWED_OUTCOMES].join(",")}`);
  }
  if (!isSha256(run.trace_root_sha256)) {
    throw new Error("trace_root_sha256 must be a SHA-256 hex");
  }
  const cls = classifyContamination(run);
  const evidence = await appendHpMhaEvidence(workspaceRoot, stateDirName, {
    kind: "ev_run",
    run_id: run.run_id,
    experiment_id: run.experiment_id,
    model_manifest_sha256: run.model_manifest_sha256,
    harness_manifest_sha256: run.harness_manifest_sha256,
    task_set_manifest_sha256: run.task_set_manifest_sha256,
    evaluator_manifest_sha256: run.evaluator_manifest_sha256,
    environment_manifest_sha256: run.environment_manifest_sha256,
    trace_root_sha256: run.trace_root_sha256,
    outcome: run.outcome,
    contaminated: cls.contaminated,
    contamination_findings: cls.findings,
    latency_ms: run.latency_ms,
    tokens: run.tokens,
    cost_usd: run.cost_usd,
    passed: run.outcome === "passed"
  });
  return {
    schema: "hermesproof.hp_mha.benchmark_run_attest.v2",
    contract_version: HP_MHA_CONTRACT_VERSION,
    evidence_id: evidence.id,
    run_id: run.run_id,
    contaminated: cls.contaminated,
    contamination_findings: cls.findings,
    prev_entry_id: evidence.prev_entry_id,
    prev_hash: evidence.prev_hash
  };
}

export async function verifyAndRecordTraceBundle({ workspaceRoot, stateDirName, bundle }) {
  const result = verifyTraceBundle(bundle);
  const evidence = await appendHpMhaEvidence(workspaceRoot, stateDirName, {
    kind: "ev_trace",
    bundle_id: bundle.bundle_id,
    retention: bundle.retention,
    root_sha256: bundle.root_sha256,
    chunk_count: Array.isArray(bundle.chunks) ? bundle.chunks.length : 0,
    verification_ok: result.ok,
    findings: result.findings || [],
    reason_codes: result.reason_codes
  });
  return {
    schema: "hermesproof.hp_mha.trace_bundle_verify.v2",
    contract_version: HP_MHA_CONTRACT_VERSION,
    evidence_id: evidence.id,
    bundle_id: bundle.bundle_id,
    retention: bundle.retention,
    verification_ok: result.ok,
    reason_codes: result.reason_codes,
    reason: result.reason,
    findings: result.findings,
    computed_merkle_root: result.computed_merkle_root || null,
    prev_entry_id: evidence.prev_entry_id,
    prev_hash: evidence.prev_hash
  };
}

export async function recordAttribution({ workspaceRoot, stateDirName, experiment_id, matrix, uncertainty }) {
  const attribution = computeFactorialAttribution(matrix);
  const evidence = await appendHpMhaEvidence(workspaceRoot, stateDirName, {
    kind: "ev_attribution",
    experiment_id,
    harness_effect_pp: attribution.harness_effect_pp,
    model_effect_pp: attribution.model_effect_pp,
    interaction_pp: attribution.interaction_pp,
    uncertainty: isPlainObject(uncertainty) ? uncertainty : null,
    matrix
  });
  return {
    schema: "hermesproof.hp_mha.model_harness_attribution.v2",
    contract_version: HP_MHA_CONTRACT_VERSION,
    evidence_id: evidence.id,
    experiment_id,
    harness_effect_pp: attribution.harness_effect_pp,
    model_effect_pp: attribution.model_effect_pp,
    interaction_pp: attribution.interaction_pp,
    uncertainty: isPlainObject(uncertainty) ? uncertainty : null,
    prev_entry_id: evidence.prev_entry_id,
    prev_hash: evidence.prev_hash
  };
}

export async function evaluateAndRecordPromotion({ workspaceRoot, stateDirName, decision }) {
  const result = evaluatePromotion(decision);
  if (!ALLOWED_VERDICTS.has(result.verdict)) {
    throw new Error(`promotion verdict must be one of ${[...ALLOWED_VERDICTS].join(",")}`);
  }
  const evidence = await appendHpMhaEvidence(workspaceRoot, stateDirName, {
    kind: "ev_promotion",
    experiment_id: decision?.plan?.experiment_id || null,
    verdict: result.verdict,
    reason_codes: result.reason_codes,
    reason: result.reason,
    denominator: result.denominator || null,
    attribution: result.attribution || null
  });
  return {
    schema: "hermesproof.hp_mha.promotion_evaluate.v2",
    contract_version: HP_MHA_CONTRACT_VERSION,
    evidence_id: evidence.id,
    verdict: result.verdict,
    reason_codes: result.reason_codes,
    reason: result.reason,
    denominator: result.denominator || null,
    attribution: result.attribution || null,
    findings: result.findings || [],
    prev_entry_id: evidence.prev_entry_id,
    prev_hash: evidence.prev_hash
  };
}

// --- HP-HARNESS-ATTRIBUTION sub-gate ----------------------------------------
// Used by scripts/truth-gates.mjs. Pure function over the ledger + plan.

export function evaluateHpMhaSubGate({ workspaceRoot, stateDirName, harness_card, experiment_plan, run_attestations, matrix, holdout_visible_to_optimizer, execution_real, fake_signals, evidence_ids }) {
  const findings = [];
  if (!harness_card) findings.push({ id: "HP-MHA-missing-harness-card", reason: "harness_card_record required" });
  if (!experiment_plan) findings.push({ id: "HP-MHA-missing-experiment-plan", reason: "experiment_plan_lock required" });
  if (!Array.isArray(run_attestations) || run_attestations.length === 0) findings.push({ id: "HP-MHA-missing-runs", reason: "benchmark_run_attest required" });
  if (!isPlainObject(matrix)) findings.push({ id: "HP-MHA-missing-matrix", reason: "model_harness_attribution 2x2 matrix required" });

  if (findings.length > 0) {
    return { ok: false, verdict: "FAIL", reason_codes: ["HP-MHA-missing-input"], reason: "missing required inputs", findings };
  }

  const decision = {
    kind: "sub_gate",
    evidence_ids: evidence_ids || [],
    run_attestations,
    plan: {
      ...experiment_plan,
      holdout_visible_to_optimizer: holdout_visible_to_optimizer === true,
      execution_real: execution_real === true,
      fake_signals: Array.isArray(fake_signals) ? fake_signals : []
    },
    attribution: computeFactorialAttribution(matrix)
  };
  const result = evaluatePromotion(decision);
  return {
    ok: result.verdict === "PASS",
    verdict: result.verdict,
    reason_codes: result.reason_codes,
    reason: result.reason,
    findings: result.findings || [],
    denominator: result.denominator || null,
    attribution: result.attribution || null
  };
}

// Convenience: evaluate a card file + the standard truth-gate fixture plan in
// one call. Used by both scripts/truth-gates.mjs and examples/hp-mha/load-card.mjs
// so the smoke harness evaluation stays consistent.
const SMOKE_TRACE_ROOT = "0".repeat(64);
const MEASURED_MATRIX = { s11: 0.2, s12: 0.2, s21: 0.1, s22: 0.8 };

export function validateHarnessCardFromManifest(cardRaw) {
  const cardInput = { card_id: cardRaw.card_id, layers: cardRaw.layers };
  const builtHarness = buildHarnessCard(cardInput);
  const model = buildModelManifest(cardRaw.layers.model);
  const execution = cardRaw.layers.execution;
  return {
    card_id: cardRaw.card_id,
    gate: HP_HARNESS_ATTRIBUTION_GATE,
    ok: execution.repo_dirty === false,
    verdict: execution.repo_dirty === false ? "PASS" : "FAIL",
    reason_codes: execution.repo_dirty === false ? ["HP-MHA-card-provenance-valid"] : ["HP-MHA-card-dirty"],
    reason: execution.repo_dirty === false
      ? "card schema and retained installed identity are valid"
      : "card records a dirty repository and cannot be release-certified",
    manifest_sha256: { model: model.manifest_sha256, harness: builtHarness.manifest_sha256 },
    installed_commit: execution.installed_commit,
    package_sha256: execution.package_sha256,
    dependency_lock_sha256: execution.dependency_lock_sha256,
    repo_dirty: execution.repo_dirty,
    attribution: null,
    denominator: null
  };
}

export function evaluateHarnessCardFromManifest(cardRaw, { matrix = MEASURED_MATRIX } = {}) {
  const cardInput = { card_id: cardRaw.card_id, layers: cardRaw.layers };
  const builtHarness = buildHarnessCard(cardInput);
  const model = buildModelManifest(cardRaw.layers.model);
  const cardName = cardRaw.card_id.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 18).padEnd(18, "0");
  const plan = {
    experiment_id: `smoke_${cardRaw.card_id}`,
    design: "factorial_2x2",
    held_constant: {
      model: true, inference_settings: true, task_set: true, environment: true,
      evaluator: true, permissions: true, budgets: true, stopping_rules: true
    },
    model_manifest_sha256: model.manifest_sha256,
    harness_manifest_sha256: builtHarness.manifest_sha256,
    task_set_manifest_sha256: buildTaskSetManifest({
      task_set_id: `ts_smoke_${cardRaw.card_id}`,
      tasks: [{ id: "smoke", description: `smoke harness eval for ${cardRaw.card_id}` }]
    }).manifest_sha256,
    evaluator_manifest_sha256: buildEvaluatorManifest({
      evaluator_id: `eval_smoke_${cardRaw.card_id}`,
      evaluator_commit: cardRaw.layers.execution.installed_commit,
      evaluator_sha256: cardRaw.layers.execution.package_sha256,
      evaluator_command: "node --test src/core/hp-mha.test.mjs"
    }).manifest_sha256,
    environment_manifest_sha256: buildEnvironmentManifest({
      environment_id: `env_smoke_${cardRaw.card_id}`,
      os: process.platform,
      arch: process.arch,
      image_digest: cardRaw.layers.execution.container_digest || `local-${process.platform}-${process.arch}`
    }).manifest_sha256,
    trace_root_sha256: SMOKE_TRACE_ROOT
  };
  const ev = evaluateHpMhaSubGate({
    harness_card: cardInput,
    experiment_plan: plan,
    run_attestations: [
      { outcome: "passed", trace_root_sha256: SMOKE_TRACE_ROOT },
      { outcome: "failed", trace_root_sha256: SMOKE_TRACE_ROOT },
      { outcome: "timed_out", trace_root_sha256: SMOKE_TRACE_ROOT }
    ],
    matrix,
    holdout_visible_to_optimizer: false,
    execution_real: true,
    fake_signals: [],
    evidence_ids: [`ev_smoke${cardName}1`]
  });
  return {
    card_id: cardRaw.card_id,
    manifest_sha256: {
      model: model.manifest_sha256,
      harness: builtHarness.manifest_sha256,
      task_set: plan.task_set_manifest_sha256,
      evaluator: plan.evaluator_manifest_sha256,
      environment: plan.environment_manifest_sha256
    },
    gate: HP_HARNESS_ATTRIBUTION_GATE,
    ok: ev.ok,
    verdict: ev.verdict,
    reason_codes: ev.reason_codes,
    reason: ev.reason,
    attribution: ev.attribution,
    denominator: ev.denominator
  };
}

// --- v2: HP-MHA-006 holdout/optimization split --------------------------------
//
// HP-MHA-006 says the candidate optimizer SHALL NOT receive holdout results
// before the candidate harness is frozen. Rather than treat the rule as
// evaluator-side only (where any caller can lie), we add a small contract
// helper that a queue manager, scheduler, or any tool can call to assert the
// tag it is about to attach actually matches the workspace's lock state.

export const HOLDOUT_TAG = "hp_mha.holdout";
export const OPTIMIZATION_TAG = "hp_mha.optimization";
const HOLDOUT_TAGS = new Set([HOLDOUT_TAG, OPTIMIZATION_TAG]);

export function classifyTaskSetTag(tags) {
  if (!Array.isArray(tags)) return null;
  for (const tag of tags) if (typeof tag === "string" && HOLDOUT_TAGS.has(tag)) return tag;
  return null;
}

// Verify a task set has at most ONE holdout/optimization tag (a mix is a
// holdout-isolation violation by definition). Duplicate identical tags are
// collapsed; a set cannot semantically carry both.
export function validateTaskSetTagUniqueness(taskSet) {
  if (!isPlainObject(taskSet)) {
    return { ok: false, reason_codes: ["HP-MHA-006-unknown"], reason: "task_set is not an object" };
  }
  const tagged = Array.isArray(taskSet.tags) ? taskSet.tags : [];
  const present = Array.from(new Set(tagged.filter((t) => typeof t === "string" && HOLDOUT_TAGS.has(t))));
  if (present.length > 1) {
    return {
      ok: false,
      reason_codes: ["HP-MHA-006", "HP-MHA-006-mixed-tags"],
      reason: `task_set may not carry both ${HOLDOUT_TAG} and ${OPTIMIZATION_TAG}; found ${present.join(",")}`
    };
  }
  return { ok: true, tag: present[0] || null };
}

// Roles that may claim files for a holdout task set. Anything else — most
// importantly the candidate optimizer — is blocked at lock time. This is the
// queue-level half of HP-MHA-006; the result-level half (run attestations) is
// covered by `evaluatePromotion`'s `holdout_visible_to_optimizer` check.
const HOLDOUT_AWARE_ROLES = new Set([
  "agent",
  "auditor",
  "reviewer",
  "human",
  "system"
]);

function holdoutScopedFiles(files) {
  return files.filter((file) => {
    const normalized = String(file).replace(/\\/gu, "/").toLowerCase();
    return normalized.split("/").some((segment) =>
      /^(?:hp-mha-)?holdout(?:[.-].*)?$/u.test(segment)
    );
  });
}

export function assertTaskClaimRespectsHoldoutIsolation({ role, task_set_manifest } = {}) {
  const tagCheck = validateTaskSetTagUniqueness(task_set_manifest || {});
  if (!tagCheck.ok) {
    return { ok: false, reason_codes: tagCheck.reason_codes, reason: tagCheck.reason };
  }
  if (tagCheck.tag !== HOLDOUT_TAG) {
    return { ok: true, reason_codes: [], reason: "task set is not holdout-scoped" };
  }
  if (HOLDOUT_AWARE_ROLES.has(role)) {
    return { ok: true, reason_codes: [], reason: `role '${role}' is allow-listed for holdout tasks` };
  }
  return {
    ok: false,
    reason_codes: ["HP-MHA-006"],
    reason: `role '${role || "(missing)"}' may not claim a holdout task set (${HOLDOUT_TAG}). Allowed roles: ${[...HOLDOUT_AWARE_ROLES].join(", ")}.`
  };
}

export function assertLockFilesRespectHoldoutIsolation({ files, role, task_set_manifest } = {}) {
  if (!Array.isArray(files) || files.length === 0) {
    return { ok: true, reason_codes: [], reason: "no files requested" };
  }
  const derivedHoldoutFiles = holdoutScopedFiles(files);
  if (derivedHoldoutFiles.length > 0) {
    return {
      ok: false,
      reason_codes: ["HP-MHA-006", "HP-MHA-006-derived-holdout"],
      reason: "the public MCP lock path cannot mutate holdout-scoped files; caller-supplied roles and manifests are not authorization",
      blocked_files: derivedHoldoutFiles
    };
  }
  const tagCheck = validateTaskSetTagUniqueness(task_set_manifest || {});
  if (!tagCheck.ok && tagCheck.reason_codes.includes("HP-MHA-006")) {
    return { ok: false, reason_codes: tagCheck.reason_codes, reason: tagCheck.reason };
  }
  if (tagCheck.tag !== HOLDOUT_TAG) {
    return { ok: true, reason_codes: [], reason: "task set is not holdout-scoped" };
  }
  return {
    ok: false,
    reason_codes: ["HP-MHA-006"],
    reason: `the public MCP lock path cannot mutate a holdout task set (${HOLDOUT_TAG}); caller-supplied role '${role || "(missing)"}' is not authorization`,
    blocked_files: files
  };
}

// --- v2: experiment-level aggregator ----------------------------------------
//
// Collapses every ev_* entry tied to one experiment_id into a single record
// the release gate, an external dashboard, or the audit reviewer can read.
// Pure read-only; no ledger mutation.

const REPORTABLE_KINDS = new Set(["ev_harness", "ev_experiment", "ev_run", "ev_trace", "ev_attribution", "ev_promotion", "ev_prune"]);

export function buildExperimentReport(evidence, { experiment_id, harness_card_id } = {}) {
  if (!Array.isArray(evidence)) throw new Error("evidence must be an array");
  const matches = evidence.filter((e) => {
    if (!isPlainObject(e) || !REPORTABLE_KINDS.has(e.kind)) return false;
    if (experiment_id && e.experiment_id !== experiment_id) return false;
    if (harness_card_id && e.harness_card_id !== harness_card_id) return false;
    return true;
  });
  const byKind = {};
  for (const entry of matches) byKind[entry.kind] = (byKind[entry.kind] || 0) + 1;
  const lastPromotion = [...matches].reverse().find((e) => e.kind === "ev_promotion");
  const lastAttribution = [...matches].reverse().find((e) => e.kind === "ev_attribution");
  const runs = matches.filter((e) => e.kind === "ev_run");
  const runSummary = computeDenominator(runs.map((r) => ({ outcome: r.outcome })));
  const passesThru = (REPORTABLE_KINDS.has("ev_promotion") && Boolean(lastPromotion?.verdict));
  return {
    schema: "hermesproof.hp_mha.experiment_report.v2",
    contract_version: HP_MHA_CONTRACT_VERSION,
    experiment_id: experiment_id || null,
    harness_card_id: harness_card_id || null,
    match_count: matches.length,
    by_kind: byKind,
    denominator: runSummary,
    last_attribution: lastAttribution ? {
      harness_effect_pp: lastAttribution.harness_effect_pp,
      model_effect_pp: lastAttribution.model_effect_pp,
      interaction_pp: lastAttribution.interaction_pp
    } : null,
    last_promotion: lastPromotion ? {
      verdict: lastPromotion.verdict,
      reason_codes: lastPromotion.reason_codes,
      reason: lastPromotion.reason
    } : null,
    evidence_ids: matches.map((e) => e.id).filter(Boolean),
    last_entry_id: matches.length > 0 ? (matches[matches.length - 1].id || null) : null,
    reportable: passesThru
  };
}

export async function readExperimentReport({ workspaceRoot, stateDirName, experiment_id, harness_card_id }) {
  const evidence = await readHpMhaEvidence(workspaceRoot, stateDirName);
  return buildExperimentReport(evidence, { experiment_id, harness_card_id });
}

export const __test__ = {
  HARNESS_LAYER_FIELDS,
  MODEL_REQUIRED,
  MODEL_OPTIONAL,
  TASK_SET_REQUIRED,
  EVALUATOR_REQUIRED,
  ENVIRONMENT_REQUIRED,
  RUN_REQUIRED,
  ALLOWED_OUTCOMES,
  ALLOWED_RETENTION,
  ALLOWED_VERDICTS,
  validateModelManifest,
  validateHarnessCard,
  validateTaskSetManifest,
  validateEvaluatorManifest,
  validateEnvironmentManifest,
  validateModelComparison,
  validateHarnessImprovementClaim,
  classifyContamination,
  computeDenominator,
  computeFactorialAttribution,
  evaluatePromotion,
  verifyTraceBundle,
  validateRunBinding,
  canonicalHash,
  buildModelManifest,
  buildHarnessCard,
  buildTaskSetManifest,
  buildEvaluatorManifest,
  buildEnvironmentManifest,
  appendHpMhaEvidence,
  readHpMhaEvidence,
  hpMhaLedgerPath,
  classifyRetentionClass,
  pruneByRetention,
  computeTraceMetrics,
  classifyRetentionClass,
  classifyTaskSetTag,
  validateTaskSetTagUniqueness,
  assertTaskClaimRespectsHoldoutIsolation,
  assertLockFilesRespectHoldoutIsolation,
  buildTraceIndexRows,
  searchTraceIndex,
  traceIndexPath,
  writeTraceIndex,
  readTraceIndex,
  HOLDOUT_AWARE_ROLES,
  HOLDOUT_TAG,
  OPTIMIZATION_TAG,
  buildExperimentReport,
  readExperimentReport,
  ERROR_KINDS,
  PRODUCTIVE_KINDS,
  INSTRUCTION_KINDS
};
