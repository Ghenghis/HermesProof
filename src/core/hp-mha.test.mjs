import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import url from "node:url";
import {
  HP_MHA_SCHEMA,
  HP_HARNESS_ATTRIBUTION_GATE,
  HP_MHA_CONTRACT_VERSION,
  __test__,
  appendHpMhaEvidence,
  assertLockFilesRespectHoldoutIsolation,
  attestBenchmarkRun,
  buildExperimentReport,
  buildEnvironmentManifest,
  buildEvaluatorManifest,
  buildHarnessCard,
  buildModelManifest,
  buildTaskSetManifest,
  buildTraceIndexRows,
  classifyContamination,
  classifyTaskSetTag,
  computeDenominator,
  computeFactorialAttribution,
  computeTraceMetrics,
  evaluateHpMhaSubGate,
  evaluateAndRecordPromotion,
  evaluatePromotion,
  HOLDOUT_TAG,
  lockExperimentPlan,
  OPTIMIZATION_TAG,
  pruneAndRecordRetention,
  readExperimentReport,
  readHpMhaEvidence,
  readTraceIndex,
  recordAttribution,
  recordHarnessCard,
  searchTraceIndex,
  traceIndexPath,
  validateTaskSetTagUniqueness,
  verifyAndRecordTraceBundle,
  verifyTraceBundle,
  writeTraceIndex,
  hpMhaLedgerPath
} from "./hp-mha.mjs";

const { sha256Hex, canonicalJSON } = await import("./fs-utils.mjs");

// --- Fixtures ----------------------------------------------------------------

function sha256Of(obj) {
  return sha256Hex(canonicalJSON(obj));
}

function makeHarnessCard() {
  return {
    card_id: "card_test_v1",
    layers: {
      execution: {
        installed_commit: "abc1234",
        package_sha256: "a".repeat(64),
        runner_identity: "ci-runner-01",
        os_arch: "linux-x64",
        dependency_lock_sha256: "b".repeat(64),
        repo_commit: "deadbeef",
        repo_dirty: false,
        per_step_timeout_s: 30,
        task_timeout_s: 1800,
        max_steps: 100,
        token_budget: 200000,
        cost_budget_usd: 5,
        wall_clock_budget_s: 3600,
        network_policy: "denylist_only",
        sandbox_policy: "workspace-only"
      },
      model: { provider: "anthropic", model_id: "claude-opus-4-6" },
      tools: {
        tool_inventory: ["read", "write", "shell"],
        tool_schema_hashes: ["c".repeat(64)],
        mcp_servers: ["hermesproof"],
        allowlist_sha256: "d".repeat(64),
        denylist_sha256: "e".repeat(64),
        tool_descriptions_sha256: "f".repeat(64),
        tool_result_format: "json",
        error_response_contract: "code+message",
        shell_restrictions: "allowlist",
        write_boundaries: "workspace",
        destructive_op_policy: "approval-required"
      },
      context: {
        system_prompt_sha256: "1".repeat(64),
        project_contract_sha256: "2".repeat(64),
        context_construction_rules: "deterministic",
        file_discovery: "indexed",
        retrieval_policy: "by-id",
        summarization_policy: "none",
        persistent_memory_policy: "none",
        max_retained_history: 50,
        constraint_reminder_behavior: "every-step",
        failed_outputs_visible: true,
        test_output_injection: "raw"
      },
      scheduling: {
        controller: "loop",
        planning_stage: false,
        retry_count: 2,
        backoff: "exponential",
        escalation_rules: "human-after-3",
        subagent_delegation: false,
        model_selection_policy: "single",
        stop_conditions: ["task_done", "budget_exceeded"],
        checkpoint_rollback: false,
        doom_loop_threshold: 5,
        per_file_edit_limit: 3,
        pre_completion_checklist: true
      },
      observability: {
        tool_call_sequence_capture: true,
        test_command_outcomes_capture: true,
        failed_validation_capture: true,
        patch_hashes: true,
        changed_file_inventory: true,
        timeout_cancellation_capture: true,
        verification_commands_capture: true,
        final_contract_check: true,
        rerere_check: true,
        trace_completeness_check: true,
        missing_event_count: 0
      },
      governance: {
        workspace_scope: "repo-root",
        side_effect_boundaries: "no-network-write",
        secret_access_policy: "deny",
        human_approval_points: ["destructive"],
        destructive_action_policy: "deny",
        redaction_policy: "redact-tokens",
        secret_values_returned: false,
        denied_action_attempts: [],
        candidate_agent_proof_only: true
      }
    }
  };
}

function makeModelManifest(overrides = {}) {
  return {
    provider: "anthropic",
    model_id: "claude-opus-4-6",
    reasoning_level: "high",
    fallback_observed: false,
    ...overrides
  };
}

function makeTaskSet() {
  return {
    task_set_id: "ts_main",
    tasks: [
      { id: "t1", description: "edit src/foo.ts to satisfy tests" },
      { id: "t2", description: "add docstrings to exported APIs" }
    ]
  };
}

function makeEvaluator() {
  return {
    evaluator_id: "ev_main",
    evaluator_commit: "1".repeat(40),
    evaluator_sha256: "a".repeat(64),
    evaluator_command: "npm test"
  };
}

function makeEnvironment() {
  return {
    environment_id: "env_main",
    os: "linux",
    arch: "x64",
    image_digest: "sha256:" + "b".repeat(64)
  };
}

function makeExperimentPlan() {
  const harness = buildHarnessCard(makeHarnessCard());
  const model = buildModelManifest(makeModelManifest());
  const taskSet = buildTaskSetManifest(makeTaskSet());
  const evaluator = buildEvaluatorManifest(makeEvaluator());
  const environment = buildEnvironmentManifest(makeEnvironment());
  return {
    experiment_id: "exp_main",
    design: "factorial_2x2",
    held_constant: {
      model: true,
      inference_settings: true,
      task_set: true,
      environment: true,
      evaluator: true,
      permissions: true,
      budgets: true,
      stopping_rules: true
    },
    // Top-level bindings required by HP-MHA-001 evaluator
    model_manifest_sha256: model.manifest_sha256,
    harness_manifest_sha256: harness.manifest_sha256,
    task_set_manifest_sha256: taskSet.manifest_sha256,
    evaluator_manifest_sha256: evaluator.manifest_sha256,
    environment_manifest_sha256: environment.manifest_sha256,
    trace_root_sha256: "c".repeat(64),
    // Nested manifests for the lockExperimentPlan path
    harness_card: harness.payload,
    model_manifest: model.payload,
    task_set_manifest: taskSet.payload,
    evaluator_manifest: evaluator.payload,
    environment_manifest: environment.payload
  };
}

function makeRun({ run_id = "r1", outcome = "passed", override = {} } = {}) {
  const harness = buildHarnessCard(makeHarnessCard());
  const model = buildModelManifest(makeModelManifest());
  const taskSet = buildTaskSetManifest(makeTaskSet());
  const evaluator = buildEvaluatorManifest(makeEvaluator());
  const environment = buildEnvironmentManifest(makeEnvironment());
  return {
    run_id,
    experiment_id: "exp_main",
    model_manifest_sha256: model.manifest_sha256,
    harness_manifest_sha256: harness.manifest_sha256,
    task_set_manifest_sha256: taskSet.manifest_sha256,
    evaluator_manifest_sha256: evaluator.manifest_sha256,
    environment_manifest_sha256: environment.manifest_sha256,
    trace_root_sha256: "c".repeat(64),
    outcome,
    latency_ms: 1234,
    tokens: 50000,
    cost_usd: 0.42,
    ...override
  };
}

// --- HP-MHA-001 manifest binding -------------------------------------------

test("HP-MHA-001: every run must bind six manifests and a trace-root hash", () => {
  const run = makeRun();
  const built = __test__.validateRunBinding(run);
  assert.equal(built.ok, true);
  // drop each required binding in turn
  for (const k of ["model_manifest_sha256", "harness_manifest_sha256", "task_set_manifest_sha256", "evaluator_manifest_sha256", "environment_manifest_sha256", "trace_root_sha256"]) {
    const broken = { ...run };
    delete broken[k];
    const r = __test__.validateRunBinding(broken);
    assert.equal(r.ok, false, `expected binding to fail without ${k}`);
    assert.ok(r.reason_codes.includes("HP-MHA-001"));
  }
});

test("HP-MHA-001: run binding mismatch with locked plan is rejected", () => {
  const run = makeRun();
  const locked = {
    model_manifest_sha256: run.model_manifest_sha256,
    harness_manifest_sha256: run.harness_manifest_sha256,
    task_set_manifest_sha256: run.task_set_manifest_sha256,
    evaluator_manifest_sha256: run.evaluator_manifest_sha256,
    environment_manifest_sha256: run.environment_manifest_sha256
  };
  const broken = { ...run, model_manifest_sha256: "0".repeat(64) };
  const r = __test__.validateRunBinding(broken, locked);
  assert.equal(r.ok, false);
  assert.ok(r.reason_codes.includes("HP-MHA-001-mismatch"));
});

// --- HP-MHA-002 model comparison requires locked harness or factorial -----

test("HP-MHA-002: rejects model comparison without design declaration", () => {
  const r = __test__.validateModelComparison({});
  assert.equal(r.ok, false);
  assert.equal(r.reason_code, "HP-MHA-002");
});

test("HP-MHA-002: accepts locked_harness design with sha256 binding", () => {
  const r = __test__.validateModelComparison({ design: "locked_harness", locked_harness_sha256: "a".repeat(64) });
  assert.equal(r.ok, true);
});

test("HP-MHA-002: accepts factorial_2x2 design", () => {
  const r = __test__.validateModelComparison({ design: "factorial_2x2" });
  assert.equal(r.ok, true);
});

// --- HP-MHA-003 harness improvement requires held-constant everything ------

test("HP-MHA-003: rejects harness claim missing held_constant keys", () => {
  const r = __test__.validateHarnessImprovementClaim({
    model_manifest_sha256: "a".repeat(64),
    held_constant: { model: true, inference_settings: true }
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason_code, "HP-MHA-003");
});

test("HP-MHA-003: accepts complete held_constant declaration", () => {
  const r = __test__.validateHarnessImprovementClaim({
    model_manifest_sha256: "a".repeat(64),
    held_constant: {
      model: true, inference_settings: true, task_set: true, environment: true,
      evaluator: true, permissions: true, budgets: true, stopping_rules: true
    }
  });
  assert.equal(r.ok, true);
});

// --- HP-MHA-004 contamination classification -------------------------------

test("HP-MHA-004: undeclared provider fallback is contamination", () => {
  const r = classifyContamination({ fallback_observed: true });
  assert.equal(r.contaminated, true);
  assert.ok(r.findings.some((f) => f.kind === "undeclared_fallback"));
});

test("HP-MHA-004: model substitution is contamination", () => {
  const r = classifyContamination({
    model_manifest_sha256_requested: "a".repeat(64),
    model_manifest_sha256_actual: "b".repeat(64)
  });
  assert.equal(r.contaminated, true);
  assert.ok(r.findings.some((f) => f.kind === "model_substitution"));
});

test("HP-MHA-004: changed reasoning / timeout / tools is contamination", () => {
  for (const flag of ["reasoning_level_changed", "timeout_changed", "tool_inventory_changed"]) {
    const r = classifyContamination({ [flag]: true });
    assert.equal(r.contaminated, true, `${flag} should be contamination`);
  }
});

test("HP-MHA-004: clean run is not contaminated", () => {
  const r = classifyContamination(makeRun());
  assert.equal(r.contaminated, false);
});

// --- HP-MHA-005 denominator accounting -------------------------------------

test("HP-MHA-005: failed/cancelled/crashed/timed_out runs must be in denominator", () => {
  const runs = [
    makeRun({ run_id: "r1", outcome: "passed" }),
    makeRun({ run_id: "r2", outcome: "failed" }),
    makeRun({ run_id: "r3", outcome: "cancelled" }),
    makeRun({ run_id: "r4", outcome: "crashed" }),
    makeRun({ run_id: "r5", outcome: "timed_out" })
  ];
  const d = computeDenominator(runs);
  assert.equal(d.total, 5);
  assert.equal(d.passed, 1);
  assert.equal(d.failed, 1);
  assert.equal(d.cancelled, 1);
  assert.equal(d.crashed, 1);
  assert.equal(d.timed_out, 1);
  assert.equal(d.pass_rate, 0.2);
});

test("HP-MHA-005: promotion verdict fails when denominator cannot be all-pass", () => {
  const plan = makeExperimentPlan();
  const result = evaluatePromotion({
    kind: "test",
    evidence_ids: ["ev_abcdef12345"],
    run_attestations: [
      makeRun({ run_id: "r1", outcome: "passed" }),
      makeRun({ run_id: "r2", outcome: "passed" })
    ],
    plan,
    attribution: computeFactorialAttribution({ s11: 0.5, s12: 0.55, s21: 0.6, s22: 0.65 }),
    execution_real: true
  });
  assert.equal(result.verdict, "FAIL");
  assert.ok(result.reason_codes.includes("HP-MHA-005-impossible-clean"));
});

// --- HP-MHA-006 holdout isolation ------------------------------------------

test("HP-MHA-006: holdout visible to optimizer before freeze fails promotion", () => {
  const plan = makeExperimentPlan();
  const result = evaluatePromotion({
    kind: "test",
    evidence_ids: ["ev_abcdef12345"],
    run_attestations: [makeRun({ outcome: "failed" })],
    plan: { ...plan, holdout_visible_to_optimizer: true },
    attribution: computeFactorialAttribution({ s11: 0.5, s12: 0.55, s21: 0.6, s22: 0.65 }),
    execution_real: true
  });
  assert.equal(result.verdict, "FAIL");
  assert.ok(result.reason_codes.includes("HP-MHA-006"));
});

// --- HP-MHA-007 multi-dimensional reporting -------------------------------

test("HP-MHA-007: report must include harness, model and interaction", () => {
  const matrix = { s11: 0.50, s12: 0.55, s21: 0.60, s22: 0.65 };
  const a = computeFactorialAttribution(matrix);
  assert.ok(Math.abs(a.harness_effect_pp - 0.05) < 1e-9, `harness=${a.harness_effect_pp}`);
  assert.ok(Math.abs(a.model_effect_pp - 0.10) < 1e-9, `model=${a.model_effect_pp}`);
  assert.equal(a.interaction_pp, 0);
});

test("HP-MHA-007: missing interaction rejects the report", () => {
  const plan = makeExperimentPlan();
  const result = evaluatePromotion({
    kind: "test",
    evidence_ids: ["ev_abcdef12345"],
    run_attestations: [makeRun({ outcome: "failed" })],
    plan,
    attribution: { harness_effect_pp: 0.05, model_effect_pp: 0.10 },
    execution_real: true
  });
  assert.equal(result.verdict, "FAIL");
  assert.ok(result.reason_codes.includes("HP-MHA-007"));
});

// --- HP-MHA-008 machine-readable verdict + chained ev_* -------------------

test("HP-MHA-008: returns PASS with reason codes and chained ev_* evidence", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hp-mha-"));
  try {
    const harnessRec = await recordHarnessCard({
      workspaceRoot: tmp, stateDirName: ".hermes3d_orchestrator",
      harness_card: makeHarnessCard()
    });
    assert.match(harnessRec.evidence_id, /^ev_[a-f0-9]+$/);
    assert.match(harnessRec.harness_card_sha256, /^[a-f0-9]{64}$/);

    const plan = makeExperimentPlan();
    const planRec = await lockExperimentPlan({
      workspaceRoot: tmp, stateDirName: ".hermes3d_orchestrator", plan
    });
    assert.equal(planRec.evidence_id !== harnessRec.evidence_id, true);

    const runRec = await attestBenchmarkRun({
      workspaceRoot: tmp, stateDirName: ".hermes3d_orchestrator",
      run: makeRun({ outcome: "failed" })
    });
    assert.match(runRec.evidence_id, /^ev_[a-f0-9]+$/);

    const traceRec = await verifyAndRecordTraceBundle({
      workspaceRoot: tmp, stateDirName: ".hermes3d_orchestrator",
      bundle: {
        bundle_id: "tb_1",
        retention: "release_pinned",
        chunks: [{ sha256: "a".repeat(64) }, { sha256: "b".repeat(64) }],
        root_sha256: sha256Hex("a".repeat(64) + "b".repeat(64))
      }
    });
    assert.equal(traceRec.verification_ok, true);

    const attrRec = await recordAttribution({
      workspaceRoot: tmp, stateDirName: ".hermes3d_orchestrator",
      experiment_id: "exp_main",
      matrix: { s11: 0.5, s12: 0.55, s21: 0.6, s22: 0.65 }
    });
    assert.ok(Math.abs(attrRec.harness_effect_pp - 0.05) < 1e-9);

    const decision = {
      kind: "promotion",
      evidence_ids: [harnessRec.evidence_id, planRec.evidence_id, runRec.evidence_id, traceRec.evidence_id, attrRec.evidence_id],
      run_attestations: [makeRun({ outcome: "failed" })],
      plan,
      attribution: attrRec,
      execution_real: true
    };
    const promo = await evaluateAndRecordPromotion({
      workspaceRoot: tmp, stateDirName: ".hermes3d_orchestrator", decision
    });
    assert.ok(["PASS", "FAIL", "INCONCLUSIVE"].includes(promo.verdict));
    assert.ok(Array.isArray(promo.reason_codes));
    assert.match(promo.evidence_id, /^ev_[a-f0-9]+$/);

    const ledger = await readHpMhaEvidence(tmp, ".hermes3d_orchestrator");
    assert.ok(ledger.length >= 5);
    for (const entry of ledger) {
      assert.equal(entry.schema, HP_MHA_SCHEMA);
      assert.match(entry.entry_hash, /^[a-f0-9]{64}$/);
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("HP-MHA-008: malformed evidence_ids fail the promotion", () => {
  const plan = makeExperimentPlan();
  const result = evaluatePromotion({
    kind: "test",
    evidence_ids: ["not-an-ev-id"],
    run_attestations: [makeRun({ outcome: "failed" })],
    plan,
    attribution: computeFactorialAttribution({ s11: 0.5, s12: 0.55, s21: 0.6, s22: 0.65 }),
    execution_real: true
  });
  assert.equal(result.verdict, "FAIL");
  assert.ok(result.reason_codes.includes("HP-MHA-008-no-evidence"));
});

// --- HP-MHA-009 independence from candidate -------------------------------

test("HP-MHA-009: candidate harness cannot self-certify", () => {
  const plan = makeExperimentPlan();
  const result = evaluatePromotion({
    kind: "test",
    evidence_ids: ["ev_abcdef12345"],
    run_attestations: [makeRun({ outcome: "failed" })],
    plan,
    attribution: computeFactorialAttribution({ s11: 0.5, s12: 0.55, s21: 0.6, s22: 0.65 }),
    execution_real: true,
    contested: { self_certified: true }
  });
  assert.equal(result.verdict, "FAIL");
  assert.ok(result.reason_codes.includes("HP-MHA-009"));
});

// --- HP-MHA-010 real execution --------------------------------------------

test("HP-MHA-010: synthetic / mock execution_real=false fails promotion", () => {
  const plan = makeExperimentPlan();
  const result = evaluatePromotion({
    kind: "test",
    evidence_ids: ["ev_abcdef12345"],
    run_attestations: [makeRun({ outcome: "failed" })],
    plan,
    attribution: computeFactorialAttribution({ s11: 0.5, s12: 0.55, s21: 0.6, s22: 0.65 }),
    execution_real: false
  });
  assert.equal(result.verdict, "FAIL");
  assert.ok(result.reason_codes.includes("HP-MHA-010"));
});

test("HP-MHA-010: fake signals in plan are rejected", () => {
  const plan = makeExperimentPlan();
  const result = evaluatePromotion({
    kind: "test",
    evidence_ids: ["ev_abcdef12345"],
    run_attestations: [makeRun({ outcome: "failed" })],
    plan: { ...plan, fake_signals: [true], execution_real: true },
    attribution: computeFactorialAttribution({ s11: 0.5, s12: 0.55, s21: 0.6, s22: 0.65 })
  });
  assert.equal(result.verdict, "FAIL");
  assert.ok(result.reason_codes.includes("HP-MHA-010-mock"));
});

// --- Trace bundle verification --------------------------------------------

test("trace bundle: valid bundle passes", () => {
  const chunks = [{ sha256: "a".repeat(64) }, { sha256: "b".repeat(64) }];
  const root = sha256Hex("a".repeat(64) + "b".repeat(64));
  const r = verifyTraceBundle({
    bundle_id: "tb_1",
    retention: "release_pinned",
    chunks,
    root_sha256: root
  });
  assert.equal(r.ok, true);
});

test("trace bundle: tampered root_sha256 is detected", () => {
  const r = verifyTraceBundle({
    bundle_id: "tb_2",
    retention: "failure_diagnostic",
    chunks: [{ sha256: "a".repeat(64) }, { sha256: "b".repeat(64) }],
    root_sha256: "0".repeat(64)
  });
  assert.equal(r.ok, false);
  assert.ok(r.reason_codes.includes("HP-MHA-008-trace-tampered"));
});

test("trace bundle: bad retention class is rejected", () => {
  const r = verifyTraceBundle({
    bundle_id: "tb_3",
    retention: "throwaway",
    chunks: [{ sha256: "a".repeat(64) }],
    root_sha256: "a".repeat(64)
  });
  assert.equal(r.ok, false);
  assert.ok(r.reason_codes.includes("HP-MHA-008-bad-retention"));
});

// --- Harness card schema validation ----------------------------------------

test("harness card: rejects unknown layer", () => {
  assert.throws(() => __test__.validateHarnessCard({
    card_id: "x",
    layers: { execution: {}, unknown_layer: {} }
  }), /unknown layer/i);
});

test("harness card: rejects unknown field in execution layer", () => {
  assert.throws(() => __test__.validateHarnessCard({
    card_id: "x",
    layers: { execution: { mystery_field: true } }
  }), /unexpected field/i);
});

test("model manifest: rejects unknown top-level field", () => {
  assert.throws(() => __test__.validateModelManifest({
    provider: "anthropic", model_id: "claude-opus-4-6", mystery: true
  }), /unexpected field/i);
});

// --- End-to-end: sub-gate decision -----------------------------------------

test("evaluateHpMhaSubGate: missing inputs FAIL", () => {
  const r = evaluateHpMhaSubGate({});
  assert.equal(r.ok, false);
  assert.equal(r.verdict, "FAIL");
  assert.ok(r.reason_codes.includes("HP-MHA-missing-input"));
});

test("evaluateHpMhaSubGate: complete inputs PASS", () => {
  const plan = makeExperimentPlan();
  const harnessCard = makeHarnessCard();
  const r = evaluateHpMhaSubGate({
    harness_card: harnessCard,
    experiment_plan: plan,
    run_attestations: [
      makeRun({ run_id: "r1", outcome: "passed" }),
      makeRun({ run_id: "r2", outcome: "failed" }),
      makeRun({ run_id: "r3", outcome: "timed_out" })
    ],
    matrix: { s11: 0.5, s12: 0.6, s21: 0.7, s22: 0.8 },
    holdout_visible_to_optimizer: false,
    execution_real: true,
    fake_signals: [],
    evidence_ids: ["ev_abcdef12345"]
  });
  assert.equal(r.ok, true);
  assert.equal(r.verdict, "PASS");
  assert.ok(Math.abs(r.attribution.harness_effect_pp - 0.10) < 1e-9);
  assert.ok(Math.abs(r.attribution.model_effect_pp - 0.20) < 1e-9);
  assert.equal(r.attribution.interaction_pp, 0);
});

test("evaluateHpMhaSubGate: gate id is HP-HARNESS-ATTRIBUTION", () => {
  assert.equal(HP_HARNESS_ATTRIBUTION_GATE, "HP-HARNESS-ATTRIBUTION");
});

test("evaluateHpMhaSubGate: contaminated run FAIL", () => {
  const plan = makeExperimentPlan();
  const contaminated = makeRun({ override: { fallback_observed: true } });
  const r = evaluateHpMhaSubGate({
    harness_card: makeHarnessCard(),
    experiment_plan: plan,
    run_attestations: [makeRun({ outcome: "failed" }), contaminated],
    matrix: { s11: 0.5, s12: 0.6, s21: 0.7, s22: 0.8 },
    holdout_visible_to_optimizer: false,
    execution_real: true,
    fake_signals: [],
    evidence_ids: ["ev_abcdef12345"]
  });
  assert.equal(r.ok, false);
  assert.ok(r.reason_codes.includes("HP-MHA-004"));
});

test("hp-mha ledger path lives inside evidenceDir", () => {
  const p = hpMhaLedgerPath("/tmp", ".hermes3d_orchestrator");
  assert.ok(p.endsWith(path.join(".hermes3d_orchestrator", "evidence", "hp_mha.ndjson")));
});

test("appendHpMhaEvidence chain: prev_hash links each entry", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hp-mha-"));
  try {
    const a = await appendHpMhaEvidence(tmp, ".hermes3d_orchestrator", { kind: "ev_test", n: 1 });
    const b = await appendHpMhaEvidence(tmp, ".hermes3d_orchestrator", { kind: "ev_test", n: 2 });
    const c = await appendHpMhaEvidence(tmp, ".hermes3d_orchestrator", { kind: "ev_test", n: 3 });
    assert.equal(b.prev_hash, a.entry_hash);
    assert.equal(c.prev_hash, b.entry_hash);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// --- Regression: the committed real HermesProof harness card must satisfy HP-MHA

test("real HermesProof harness card passes HP-HARNESS-ATTRIBUTION contract", async () => {
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, "..", "..");
  const cardPath = path.join(repoRoot, "examples", "hp-mha", "harness-cards", "hermesproof.json");
  const cardRaw = JSON.parse(await fs.readFile(cardPath, "utf8"));
  const cardInput = { card_id: cardRaw.card_id, layers: cardRaw.layers };
  const builtHarness = buildHarnessCard(cardInput);
  const model = buildModelManifest(cardRaw.layers.model);
  const taskSet = buildTaskSetManifest({
    task_set_id: "ts_real_card",
    tasks: [{ id: "real_card_smoke", description: "real card smoke" }]
  });
  const evaluator = buildEvaluatorManifest({
    evaluator_id: "eval_real_card",
    evaluator_commit: cardRaw.layers.execution.installed_commit,
    evaluator_sha256: cardRaw.layers.execution.package_sha256,
    evaluator_command: "node --test src/core/hp-mha.test.mjs"
  });
  const environment = buildEnvironmentManifest({
    environment_id: "env_real_card",
    os: process.platform,
    arch: process.arch,
    image_digest: cardRaw.layers.execution.container_digest || `local-${process.platform}-${process.arch}`
  });
  const result = evaluateHpMhaSubGate({
    harness_card: cardInput,
    experiment_plan: {
      experiment_id: "real_card_regression",
      design: "factorial_2x2",
      held_constant: {
        model: true, inference_settings: true, task_set: true, environment: true,
        evaluator: true, permissions: true, budgets: true, stopping_rules: true
      },
      model_manifest_sha256: model.manifest_sha256,
      harness_manifest_sha256: builtHarness.manifest_sha256,
      task_set_manifest_sha256: taskSet.manifest_sha256,
      evaluator_manifest_sha256: evaluator.manifest_sha256,
      environment_manifest_sha256: environment.manifest_sha256,
      trace_root_sha256: cardRaw.layers.execution.package_sha256
    },
    run_attestations: [
      { outcome: "passed", trace_root_sha256: cardRaw.layers.execution.package_sha256 },
      { outcome: "failed", trace_root_sha256: cardRaw.layers.execution.package_sha256 },
      { outcome: "timed_out", trace_root_sha256: cardRaw.layers.execution.package_sha256 }
    ],
    matrix: { s11: 0.5, s12: 0.6, s21: 0.7, s22: 0.8 },
    holdout_visible_to_optimizer: false,
    execution_real: true,
    fake_signals: [],
    evidence_ids: ["ev_realcard00000001"]
  });
  assert.equal(result.ok, true, `real card contract FAIL: ${JSON.stringify(result)}`);
  assert.equal(result.verdict, "PASS");
  assert.equal(result.attribution.harness_effect_pp, 0.1);
  assert.equal(result.attribution.model_effect_pp, 0.2);
  assert.equal(result.attribution.interaction_pp, 0);
  assert.equal(result.denominator.total, 3);
});

// --- trace retention pruning -----------------------------------------------

test("pruneByRetention: keeps release_pinned forever", () => {
  const ev = [
    { kind: "ev_trace", retention: "release_pinned", id: "ev_pinned", ts_utc: "2020-01-01T00:00:00.000Z" },
    { kind: "ev_harness", retention: "release_pinned", id: "ev_meta", ts_utc: "2020-01-01T00:00:00.000Z" }
  ];
  const r = __test__.pruneByRetention({ evidence: ev, options: { now_ms: Date.parse("2030-01-01T00:00:00.000Z") } });
  assert.equal(r.survivors_count, 2);
  assert.equal(r.pruned_count, 0);
  assert.equal(r.pinned_count, 1);
});

test("pruneByRetention: purges routine_run older than retention window", () => {
  const oldIso = "2020-01-01T00:00:00.000Z";
  const recentIso = "2030-01-17T00:00:00.000Z"; // 15 days before now
  const ev = [
    { kind: "ev_trace", retention: "routine_run", id: "ev_old", ts_utc: oldIso },
    { kind: "ev_trace", retention: "routine_run", id: "ev_recent", ts_utc: recentIso }
  ];
  const r = __test__.pruneByRetention({ evidence: ev, options: {
    now_ms: Date.parse("2030-02-01T00:00:00.000Z"),
    routine_retention_ms: 30 * 24 * 60 * 60 * 1000
  } });
  assert.equal(r.survivors_count, 1);
  assert.equal(r.pruned_count, 1);
  assert.equal(r.pruned[0].id, "ev_old");
  assert.equal(r.pruned[0].reason, "routine_run_retention_exceeded");
});

test("pruneByRetention: dedups duplicate_chunk entries with the same root hash", () => {
  const ev = [
    { kind: "ev_trace", retention: "duplicate_chunk", root_sha256: "a".repeat(64), id: "ev_dup_a" },
    { kind: "ev_trace", retention: "duplicate_chunk", root_sha256: "a".repeat(64), id: "ev_dup_a_again" },
    { kind: "ev_trace", retention: "duplicate_chunk", root_sha256: "b".repeat(64), id: "ev_dup_b" }
  ];
  const r = __test__.pruneByRetention({ evidence: ev });
  assert.equal(r.survivors_count, 2);
  assert.equal(r.deduped_count, 1);
  assert.equal(r.pruned_count, 1);
});

test("pruneByRetention: failure_diagnostic requires explicit failures_required=true to keep", () => {
  const ev = [
    { kind: "ev_trace", retention: "failure_diagnostic", id: "ev_fail" }
  ];
  const kept = __test__.pruneByRetention({ evidence: ev, options: { failures_required: true } });
  assert.equal(kept.survivors_count, 1);
  const purged = __test__.pruneByRetention({ evidence: ev, options: { failures_required: false } });
  assert.equal(purged.survivors_count, 0);
  assert.equal(purged.pruned[0].reason, "failure_diagnostic_purge_requested");
});

test("pruneAndRecordRetention: appends ev_prune summary without breaking the chain", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hp-mha-prune-"));
  try {
    await appendHpMhaEvidence(tmp, ".hermes3d_orchestrator", {
      kind: "ev_trace", retention: "release_pinned", id: "ev_one", root_sha256: "a".repeat(64)
    });
    await appendHpMhaEvidence(tmp, ".hermes3d_orchestrator", {
      kind: "ev_trace", retention: "routine_run", id: "ev_two", ts_utc: "2030-01-30T00:00:00.000Z"
    });
    const r = await pruneAndRecordRetention({
      workspaceRoot: tmp, stateDirName: ".hermes3d_orchestrator",
      options: { now_ms: Date.parse("2030-02-01T00:00:00.000Z"), routine_retention_ms: 7 * 86400 * 1000 }
    });
    assert.equal(r.pruned_count, 0);
    assert.equal(r.survivors_count, 2);
    assert.equal(r.pinned_count, 1);
    assert.match(r.evidence_id, /^ev_[a-f0-9]+$/);
    const ledger = await readHpMhaEvidence(tmp, ".hermes3d_orchestrator");
    assert.equal(ledger.length, 3);
    assert.equal(ledger[ledger.length - 1].kind, "ev_prune");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("pruneAndRecordRetention: routine_run exceeding window IS pruned and chain stays valid", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hp-mha-prune-old-"));
  try {
    await appendHpMhaEvidence(tmp, ".hermes3d_orchestrator", {
      kind: "ev_trace", retention: "release_pinned", id: "ev_one", root_sha256: "a".repeat(64)
    });
    await appendHpMhaEvidence(tmp, ".hermes3d_orchestrator", {
      kind: "ev_trace", retention: "routine_run", id: "ev_two", ts_utc: "2020-01-01T00:00:00.000Z"
    });
    const r = await pruneAndRecordRetention({
      workspaceRoot: tmp, stateDirName: ".hermes3d_orchestrator",
      options: { now_ms: Date.parse("2030-01-01T00:00:00.000Z"), routine_retention_ms: 7 * 86400 * 1000 }
    });
    assert.equal(r.pruned_count, 1);
    assert.equal(r.survivors_count, 1);
    assert.equal(r.pinned_count, 1);
    assert.equal(r.pruned[0].id, "ev_two");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// --- trace-level metrics ----------------------------------------------------

test("computeTraceMetrics: error-free bundle yields recovery rate 1, zero control lag", () => {
  const r = computeTraceMetrics({ bundle: { chunks: [
    { kind: "tool_ok" }, { kind: "tool_ok" }, { kind: "test_passed" }
  ] } });
  assert.equal(r.error_count, 0);
  assert.equal(r.recovery_rate_at_1_step, 1);
  assert.equal(r.recovery_rate_at_10_steps, 1);
  assert.equal(r.avg_control_lag_steps, 0);
});

test("computeTraceMetrics: error followed by productivity within 3 steps counts as recovery", () => {
  const r = computeTraceMetrics({ bundle: { chunks: [
    { kind: "tool_ok" },
    { kind: "tool_error" },
    { kind: "instruction_issued" },
    { kind: "corrective_action" },
    { kind: "tool_ok" }
  ] } });
  assert.equal(r.error_count, 1);
  // First real productivity (corrective_action) is at index 3, two steps after the error.
  assert.equal(r.recovery_rate_at_3_steps, 1);
  assert.equal(r.recovery_rate_at_1_step, 0);
  // lag: inst at index 2, fix at index 3, error at index 1; lag = fix - error = 2
  assert.ok(Math.abs(r.avg_control_lag_steps - 2) < 1e-9, `lag=${r.avg_control_lag_steps}`);
});

test("computeTraceMetrics: every error chunk is counted separately (3 chunks = 3 errors)", () => {
  const r = computeTraceMetrics({ bundle: { chunks: [
    { kind: "test_failure" }, { kind: "test_failure" }, { kind: "test_failure" }
  ] } });
  assert.equal(r.error_count, 3);
  assert.equal(r.recovery_rate_at_10_steps, 0);
});

test("computeTraceMetrics: context retention checks tail-window signals", () => {
  const r = computeTraceMetrics({
    bundle: { chunks: [
      { kind: "tool_ok", signals: ["artifact_path", "acceptance_tests"] },
      { kind: "malformed", signals: [] },
      { kind: "tool_ok", signals: ["artifact_path"] },
      { kind: "tool_ok", signals: ["security_restrictions"] }
    ] },
    required_signals: ["artifact_path", "acceptance_tests", "deployment_target"],
    lookback: 3
  });
  // tail of 3 = indices 1..3 ; signals present: {} + {artifact_path} + {security_restrictions}
  // required ∩ present: {artifact_path} = 1/3 ≈ 0.333
  assert.ok(Math.abs(r.context_retention - 0.3333) < 0.01, `retention=${r.context_retention}`);
});

test("computeTraceMetrics: zero required signals yields retention = 1", () => {
  const r = computeTraceMetrics({ bundle: { chunks: [{ kind: "tool_ok" }] } });
  assert.equal(r.context_retention, 1);
});

// --- edge cases: retention + metrics + malformed input ----------------------

test("pruneByRetention: empty evidence array returns zero counts", () => {
  const r = __test__.pruneByRetention({ evidence: [] });
  assert.equal(r.survivors_count, 0);
  assert.equal(r.pruned_count, 0);
  assert.equal(r.deduped_count, 0);
  assert.equal(r.pinned_count, 0);
  assert.equal(r.retention_classes.release_pinned, 0);
});

test("pruneByRetention: routine_retention_ms=0 disables the retention window", () => {
  const oldIso = "1990-01-01T00:00:00.000Z";
  const ev = [{ kind: "ev_trace", retention: "routine_run", id: "ev_old", ts_utc: oldIso }];
  const r = __test__.pruneByRetention({ evidence: ev, options: {
    now_ms: Date.parse("2030-01-01T00:00:00.000Z"),
    routine_retention_ms: 0
  } });
  assert.equal(r.survivors_count, 1, "with retention_ms=0, no entries should be pruned");
  assert.equal(r.pruned_count, 0);
});

test("pruneByRetention: unknown retention class is treated as ledger_internal", () => {
  const r = __test__.pruneByRetention({ evidence: [
    { kind: "ev_harness", id: "ev_meta" },
    { kind: "unknown_kind", retention: "routine_run", id: "ev_other" }
  ] });
  assert.equal(r.survivors_count, 2);
});

test("computeTraceMetrics: empty chunks returns zero error count, recovery=1", () => {
  const r = computeTraceMetrics({ bundle: { chunks: [] } });
  assert.equal(r.chunk_count, 0);
  assert.equal(r.error_count, 0);
  assert.equal(r.recovery_rate_at_1_step, 1);
  assert.equal(r.avg_control_lag_steps, 0);
  assert.equal(r.context_retention, 1);
});

test("evaluatePromotion: HP-MHA-008 malformed-input guard rejects non-object plan", () => {
  const r = evaluatePromotion({
    kind: "test",
    evidence_ids: ["ev_abcdef12345"],
    run_attestations: [],
    plan: "not-an-object",
    attribution: { harness_effect_pp: 0, model_effect_pp: 0, interaction_pp: 0 }
  });
  assert.equal(r.verdict, "FAIL");
  assert.ok(r.reason_codes.includes("HP-MHA-008-malformed"));
});

test("evaluatePromotion: rejects empty evidence_ids list", () => {
  const plan = {
    design: "factorial_2x2",
    model_manifest_sha256: "a".repeat(64),
    harness_manifest_sha256: "b".repeat(64),
    task_set_manifest_sha256: "c".repeat(64),
    evaluator_manifest_sha256: "d".repeat(64),
    environment_manifest_sha256: "e".repeat(64),
    trace_root_sha256: "f".repeat(64),
    execution_real: true
  };
  const r = evaluatePromotion({
    kind: "test", evidence_ids: [],
    run_attestations: [{ outcome: "failed" }],
    plan,
    attribution: { harness_effect_pp: 0.1, model_effect_pp: 0.1, interaction_pp: 0 }
  });
  assert.equal(r.verdict, "FAIL");
  assert.ok(r.reason_codes.includes("HP-MHA-008-no-evidence"));
});

test("evaluateAndRecordPromotion: appends ev_promotion with chained prev_hash", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hp-mha-promo-"));
  try {
    const harness = await recordHarnessCard({
      workspaceRoot: tmp, stateDirName: ".hermes3d_orchestrator",
      harness_card: makeHarnessCard()
    });
    const planLock = await lockExperimentPlan({
      workspaceRoot: tmp, stateDirName: ".hermes3d_orchestrator",
      plan: makeExperimentPlan()
    });
    const planWithBindings = {
      ...makeExperimentPlan(),
      model_manifest_sha256: planLock.model_manifest_sha256,
      harness_manifest_sha256: planLock.harness_manifest_sha256,
      task_set_manifest_sha256: planLock.task_set_manifest_sha256,
      evaluator_manifest_sha256: planLock.evaluator_manifest_sha256,
      environment_manifest_sha256: planLock.environment_manifest_sha256,
      trace_root_sha256: makeExperimentPlan().trace_root_sha256,
      execution_real: true
    };
    const r = await evaluateAndRecordPromotion({
      workspaceRoot: tmp, stateDirName: ".hermes3d_orchestrator",
      decision: {
        kind: "test",
        evidence_ids: [harness.evidence_id, planLock.evidence_id],
        run_attestations: [makeRun({ outcome: "failed" })],
        plan: planWithBindings,
        attribution: computeFactorialAttribution({ s11: 0.5, s12: 0.6, s21: 0.7, s22: 0.8 })
      }
    });
    assert.match(r.evidence_id, /^ev_[a-f0-9]+$/);
    const ledger = await readHpMhaEvidence(tmp, ".hermes3d_orchestrator");
    const last = ledger[ledger.length - 1];
    assert.equal(last.kind, "ev_promotion");
    assert.ok(["PASS", "FAIL", "INCONCLUSIVE"].includes(last.verdict));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("recordAttribution: emitted entry carries the canonical attribution triple", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hp-mha-attr-"));
  try {
    const r = await recordAttribution({
      workspaceRoot: tmp, stateDirName: ".hermes3d_orchestrator",
      experiment_id: "attr_test",
      matrix: { s11: 0.50, s12: 0.55, s21: 0.60, s22: 0.65 },
      uncertainty: { ci_95_pp: 0.02 }
    });
    assert.ok(Math.abs(r.harness_effect_pp - 0.05) < 1e-9);
    assert.ok(Math.abs(r.model_effect_pp - 0.10) < 1e-9);
    assert.equal(r.interaction_pp, 0);
    assert.equal(r.uncertainty.ci_95_pp, 0.02);
    assert.match(r.evidence_id, /^ev_[a-f0-9]+$/);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("attestBenchmarkRun: rejected when required outcome is outside the allowed enum", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hp-mha-attest-"));
  try {
    await assert.rejects(
      attestBenchmarkRun({
        workspaceRoot: tmp, stateDirName: ".hermes3d_orchestrator",
        run: { ...makeRun(), outcome: "uncaught_exception" }
      }),
      /outcome must be one of/
    );
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// --- v2: holdout / optimization tag isolation -------------------------------

test("classifyTaskSetTag: returns the only recognized tag", () => {
  assert.equal(classifyTaskSetTag([HOLDOUT_TAG, "other"]), HOLDOUT_TAG);
  assert.equal(classifyTaskSetTag(["foo", OPTIMIZATION_TAG, "bar"]), OPTIMIZATION_TAG);
  assert.equal(classifyTaskSetTag(["foo", "bar"]), null);
  assert.equal(classifyTaskSetTag(null), null);
  assert.equal(classifyTaskSetTag(undefined), null);
});

test("validateTaskSetTagUniqueness: same tag twice is allowed; both tags together is FAIL", () => {
  assert.equal(validateTaskSetTagUniqueness({ tags: [HOLDOUT_TAG, HOLDOUT_TAG] }).ok, true);
  const r = validateTaskSetTagUniqueness({ tags: [HOLDOUT_TAG, OPTIMIZATION_TAG] });
  assert.equal(r.ok, false);
  assert.ok(r.reason_codes.includes("HP-MHA-006"));
  assert.equal(validateTaskSetTagUniqueness({ tags: [] }).ok, true);
  assert.equal(validateTaskSetTagUniqueness(null).ok, false);
});

test("buildTaskSetManifest accepts a tag and preserves it under payload", () => {
  const built = buildTaskSetManifest({
    task_set_id: "ts_holdout",
    tasks: [{ id: "t1", description: "hidden eval task" }],
    tags: [HOLDOUT_TAG]
  });
  assert.deepEqual(built.payload.tags, [HOLDOUT_TAG]);
  assert.ok(built.manifest_sha256.length === 64);
});

test("HP-MHA-006 enforced: holdout + optimization tag on same task set is rejected", () => {
  const r = validateTaskSetTagUniqueness({
    task_set_id: "ts_evil",
    tasks: [{ id: "t1" }],
    tags: [HOLDOUT_TAG, OPTIMIZATION_TAG]
  });
  assert.equal(r.ok, false);
  assert.ok(r.reason_codes.includes("HP-MHA-006"));
});

test("classifyTaskSetTag: returns optimization-tag first when both empty set (deterministic)", () => {
  // Set semantics: order-independent lookup of the only present tag.
  assert.equal(classifyTaskSetTag([OPTIMIZATION_TAG]), OPTIMIZATION_TAG);
  assert.equal(classifyTaskSetTag([HOLDOUT_TAG, "x", "y"]), HOLDOUT_TAG);
});

// --- v2: experiment-level aggregator ----------------------------------------

test("buildExperimentReport: empty evidence returns zero counts, no promotion", () => {
  const r = buildExperimentReport([], { experiment_id: "exp_x" });
  assert.equal(r.match_count, 0);
  assert.equal(r.experiment_id, "exp_x");
  assert.equal(r.last_promotion, null);
  assert.equal(r.last_attribution, null);
  assert.equal(Object.keys(r.by_kind).length, 0);
});

test("buildExperimentReport: aggregates by kind, picks last promotion + last attribution", () => {
  const ev = [
    { id: "ev_aaa", kind: "ev_run", experiment_id: "exp1", outcome: "passed" },
    { id: "ev_bbb", kind: "ev_run", experiment_id: "exp1", outcome: "failed" },
    { id: "ev_ccc", kind: "ev_attribution", experiment_id: "exp1", harness_effect_pp: 0.05, model_effect_pp: 0.10, interaction_pp: 0 },
    { id: "ev_ddd", kind: "ev_promotion", experiment_id: "exp1", verdict: "PASS", reason_codes: ["HP-MHA-001-pass"], reason: "ok" },
    { id: "ev_eee", kind: "ev_trace", experiment_id: "exp1", retention: "release_pinned" },
    { id: "ev_fff", kind: "ev_run", experiment_id: "exp2", outcome: "passed" }  // different experiment
  ];
  const r = buildExperimentReport(ev, { experiment_id: "exp1" });
  assert.equal(r.match_count, 5);
  assert.equal(r.by_kind.ev_run, 2);
  assert.equal(r.by_kind.ev_attribution, 1);
  assert.equal(r.by_kind.ev_promotion, 1);
  assert.equal(r.by_kind.ev_trace, 1);
  assert.equal(r.last_attribution.harness_effect_pp, 0.05);
  assert.equal(r.last_promotion.verdict, "PASS");
  assert.equal(r.denominator.total, 2);
  assert.equal(r.denominator.passed, 1);
  assert.equal(r.denominator.failed, 1);
  assert.deepEqual(r.evidence_ids, ["ev_aaa", "ev_bbb", "ev_ccc", "ev_ddd", "ev_eee"]);
  assert.equal(r.last_entry_id, "ev_eee");
  assert.equal(r.reportable, true);
});

test("readExperimentReport: real ledger round-trip yields a structured report", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hp-mha-report-"));
  try {
    await lockExperimentPlan({
      workspaceRoot: tmp, stateDirName: ".hermes3d_orchestrator",
      plan: makeExperimentPlan()
    });
    await attestBenchmarkRun({
      workspaceRoot: tmp, stateDirName: ".hermes3d_orchestrator",
      run: makeRun({ outcome: "passed" })
    });
    await attestBenchmarkRun({
      workspaceRoot: tmp, stateDirName: ".hermes3d_orchestrator",
      run: makeRun({ outcome: "failed" })
    });
    await recordAttribution({
      workspaceRoot: tmp, stateDirName: ".hermes3d_orchestrator",
      experiment_id: "exp_main", matrix: { s11: 0.5, s12: 0.6, s21: 0.7, s22: 0.8 }
    });
    const r = await readExperimentReport({
      workspaceRoot: tmp, stateDirName: ".hermes3d_orchestrator",
      experiment_id: "exp_main"
    });
    assert.ok(r.match_count >= 3);
    assert.equal(r.last_attribution.harness_effect_pp, 0.1);
    assert.ok(r.evidence_ids.length >= 3);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// --- v3: HP-MHA-006 lock-time holdout isolation -------------------------------

test("assertLockFilesRespectHoldoutIsolation: empty file list short-circuits to ok", () => {
  const r = assertLockFilesRespectHoldoutIsolation({ files: [], role: "optimizer", task_set_manifest: { tags: [HOLDOUT_TAG] } });
  assert.equal(r.ok, true);
});

test("assertLockFilesRespectHoldoutIsolation: non-holdout task set always passes", () => {
  const r = assertLockFilesRespectHoldoutIsolation({
    files: ["a.ts", "b.ts"],
    role: "optimizer",
    task_set_manifest: { tags: [OPTIMIZATION_TAG] }
  });
  assert.equal(r.ok, true);
});

test("assertLockFilesRespectHoldoutIsolation: holdout tag + optimizer role = FAIL", () => {
  const r = assertLockFilesRespectHoldoutIsolation({
    files: ["holdout/run-001.json"],
    role: "optimizer",
    task_set_manifest: { tags: [HOLDOUT_TAG] }
  });
  assert.equal(r.ok, false);
  assert.ok(r.reason_codes.includes("HP-MHA-006"));
  assert.deepEqual(r.blocked_files, ["holdout/run-001.json"]);
});

test("assertLockFilesRespectHoldoutIsolation: holdout tag + agent/auditor/human = PASS", () => {
  for (const role of ["agent", "auditor", "reviewer", "human", "system"]) {
    const r = assertLockFilesRespectHoldoutIsolation({
      files: ["x.ts"],
      role,
      task_set_manifest: { tags: [HOLDOUT_TAG] }
    });
    assert.equal(r.ok, true, `role '${role}' should be allowed on holdout files`);
  }
});

test("assertLockFilesRespectHoldoutIsolation: unknown role on holdout = FAIL", () => {
  const r = assertLockFilesRespectHoldoutIsolation({
    files: ["x.ts"],
    role: "researcher",
    task_set_manifest: { tags: [HOLDOUT_TAG] }
  });
  assert.equal(r.ok, false);
});

test("assertLockFilesRespectHoldoutIsolation: holds a mixed tag set HP-MHA-006-FAIL", () => {
  const r = assertLockFilesRespectHoldoutIsolation({
    files: ["x.ts"],
    role: "optimizer",
    task_set_manifest: { tags: [HOLDOUT_TAG, OPTIMIZATION_TAG] }
  });
  assert.equal(r.ok, false);
  assert.ok(r.reason_codes.includes("HP-MHA-006"));
});

// --- v3: contract version + schema bumps -------------------------------------

test("v3: HP_MHA_CONTRACT_VERSION is 2026-08-06", () => {
  assert.equal(HP_MHA_CONTRACT_VERSION, "hermesproof.hp_mha.2026-08-06");
});

test("v3: buildModelManifest returns v2 schema string", () => {
  const m = buildModelManifest({ provider: "x", model_id: "y" });
  assert.equal(m.schema, "hermesproof.hp_mha.model_manifest.v2");
  assert.equal(m.schema_version, 1);
});

test("v3: all recordHarnessCard / lockExperimentPlan / attestBenchmarkRun shapes carry contract version", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hp-mha-v3-"));
  try {
    const harnessRec = await recordHarnessCard({
      workspaceRoot: tmp, stateDirName: ".hermes3d_orchestrator",
      harness_card: makeHarnessCard()
    });
    assert.ok(harnessRec.schema.endsWith(".v2"));
    assert.equal(harnessRec.contract_version, HP_MHA_CONTRACT_VERSION);

    const planLock = await lockExperimentPlan({
      workspaceRoot: tmp, stateDirName: ".hermes3d_orchestrator",
      plan: makeExperimentPlan()
    });
    assert.ok(planLock.schema.endsWith(".v2"));
    assert.equal(planLock.contract_version, HP_MHA_CONTRACT_VERSION);

    const runAttest = await attestBenchmarkRun({
      workspaceRoot: tmp, stateDirName: ".hermes3d_orchestrator",
      run: makeRun({ outcome: "failed" })
    });
    assert.ok(runAttest.schema.endsWith(".v2"));
    assert.equal(runAttest.contract_version, HP_MHA_CONTRACT_VERSION);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// --- v4: trace-search index --------------------------------------------------

test("buildTraceIndexRows: emits one row per chunk with monotonic byte ranges", () => {
  const bundle = {
    bundle_id: "tb_v4_smoke",
    retention: "release_pinned",
    chunks: [
      { sha256: "a".repeat(64), bytes: 100, tokens: 25, kind: "tool_ok", signals: ["artifact_path"] },
      { sha256: "b".repeat(64), bytes: 200, tokens: 50, kind: "test_passed" },
      { sha256: "c".repeat(64), bytes: 150, tokens: 35, kind: "tool_ok", signals: ["artifact_path"] }
    ]
  };
  const rows = buildTraceIndexRows(bundle);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].byte_start, 0);
  assert.equal(rows[0].byte_end, 100);
  assert.equal(rows[1].byte_start, 100);
  assert.equal(rows[1].byte_end, 300);
  assert.equal(rows[2].byte_start, 300);
  assert.equal(rows[2].byte_end, 450);
  assert.equal(rows[0].retention, "release_pinned");
  assert.deepEqual(rows[0].signal_tags, ["artifact_path"]);
  assert.equal(rows[1].kind_hint, "test_passed");
});

test("buildTraceIndexRows: skips chunks without a SHA-256 hash (advances offset by cursor)", () => {
  const bundle = {
    bundle_id: "tb_skip",
    retention: "routine_run",
    chunks: [
      { not_a_hash: true, bytes: 50 },
      { sha256: "a".repeat(64), bytes: 10 }
    ]
  };
  const rows = buildTraceIndexRows(bundle);
  assert.equal(rows.length, 1);
  // The valid second row gets offsets of 50..60 (the first chunk's bytes advance the cursor)
  assert.equal(rows[0].byte_start, 50);
  assert.equal(rows[0].byte_end, 60);
});

test("searchTraceIndex: range intersection finds overlapping rows", () => {
  const rows = [
    { byte_start: 0, byte_end: 100, kind_hint: "tool_ok", signal_tags: ["a"] },
    { byte_start: 100, byte_end: 200, kind_hint: "test_passed", signal_tags: [] },
    { byte_start: 200, byte_end: 350, kind_hint: "tool_ok", signal_tags: ["a"] },
    { byte_start: 500, byte_end: 600, kind_hint: "tool_error", signal_tags: [] }
  ];
  // Overlap with rows [0..350]
  assert.equal(searchTraceIndex(rows, { byte_start: 80, byte_end: 220 }).length, 3);
  // No overlap with the last row
  assert.equal(searchTraceIndex(rows, { byte_start: 0, byte_end: 50 }).length, 1);
  // Filter by kind
  assert.equal(searchTraceIndex(rows, { kind: "tool_error" }).length, 1);
  // Filter by signal
  assert.equal(searchTraceIndex(rows, { signals: ["a"] }).length, 2);
  // Limit
  assert.equal(searchTraceIndex(rows, { limit: 2 }).length, 2);
  // Open-ended range: no boundary returns everything
  assert.equal(searchTraceIndex(rows, {}).length, 4);
});

test("writeTraceIndex + readTraceIndex: round-trip appends rows then filters by bundle_id", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hp-mha-index-"));
  try {
    const a = await writeTraceIndex({
      workspaceRoot: tmp, stateDirName: ".hermes3d_orchestrator",
      bundle: {
        bundle_id: "tb_A", retention: "release_pinned",
        chunks: [
          { sha256: "1".repeat(64), bytes: 10, kind: "tool_ok" },
          { sha256: "2".repeat(64), bytes: 20, kind: "test_passed" }
        ]
      }
    });
    const b = await writeTraceIndex({
      workspaceRoot: tmp, stateDirName: ".hermes3d_orchestrator",
      bundle: {
        bundle_id: "tb_B", retention: "routine_run",
        chunks: [
          { sha256: "3".repeat(64), bytes: 30, kind: "tool_ok" }
        ]
      }
    });
    assert.equal(a.row_count, 2);
    assert.equal(b.row_count, 1);
    const all = await readTraceIndex({ workspaceRoot: tmp, stateDirName: ".hermes3d_orchestrator" });
    assert.equal(all.length, 3);
    const aRows = await readTraceIndex({ workspaceRoot: tmp, stateDirName: ".hermes3d_orchestrator", bundle_id: "tb_A" });
    assert.equal(aRows.length, 2);
    assert.ok(aRows.every((r) => r.bundle_id === "tb_A"));
    assert.equal(aRows[0].byte_start, 0);
    assert.equal(aRows[1].byte_start, 10);
    assert.equal(traceIndexPath(tmp, ".hermes3d_orchestrator").endsWith("hp_mha_trace_index.ndjson"), true);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("searchTraceIndex: returns [] when the index file is absent (ENOENT → [])", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hp-mha-noindex-"));
  try {
    const rows = await readTraceIndex({ workspaceRoot: tmp, stateDirName: ".hermes3d_orchestrator" });
    assert.deepEqual(rows, []);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});