import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HermesLockManager } from "./lock-manager.mjs";
import { ProviderPerformanceTracker } from "./provider-performance.mjs";
import {
  KILOCODE_TASK_TYPE,
  evaluateKilocodeInfrastructureProof,
  evaluateKilocodePolicy,
  readKilocodeGuardrails,
  recordKilocodeInfrastructureProof,
  recordKilocodeProgressCheckpoint,
  recordKilocodeDelegation,
  redactIntegrationText,
  setKilocodeGuardrails,
} from "./kilocode-integration.mjs";

let tmpDir;

describe("KiloCode/OpenHands HermesProof integration", () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-kilo-openhands-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("redacts tokens, auth headers, env-style secrets, and private-root paths", () => {
    const input = {
      prompt: "use sk-cp-1234567890abcdef and Authorization: Bearer abcdefghijklmnopqrstuvwxyz",
      env: "MINIMAX_API_KEY=abc1234567890xyz",
      path: "G:\\private\\prod\\.env",
      nested: ["https://user:pass@example.test/repo.git"],
    };

    const redacted = redactIntegrationText(input);
    const text = JSON.stringify(redacted);

    assert.match(text, /\[REDACTED_TOKEN\]/);
    assert.match(text, /Authorization=\[REDACTED\]/);
    assert.match(text, /MINIMAX_API_KEY=\[REDACTED\]/);
    assert.match(text, /\[PRIVATE_ROOT\]/);
    assert.match(text, /https:\/\/\[REDACTED\]@example\.test/);
    assert.doesNotMatch(text, /1234567890abcdef|abcdefghijklmnopqrstuvwxyz|abc1234567890xyz|user:pass|G:\\\\private/i);
  });

  it("requires approval for SSH delegation and keeps simple edits local", () => {
    const ssh = evaluateKilocodePolicy({
      trigger: "ssh",
      risk: "high",
      action_summary: "connect to approved VPS and inspect service logs",
    });

    assert.equal(ssh.ok, true);
    assert.equal(ssh.delegate, true);
    assert.equal(ssh.decision, "ask");
    assert.ok(ssh.required_permissions.includes("openhands_ssh"));
    assert.ok(ssh.required_permissions.includes("openhands_external_network"));

    const local = evaluateKilocodePolicy({
      trigger: "simple_edit",
      risk: "low",
      action_summary: "rename a local helper function",
    });

    assert.equal(local.delegate, false);
    assert.equal(local.decision, "allow");
    assert.deepEqual(local.required_permissions, []);
  });

  it("denies delegation when raw secrets appear in the action summary", () => {
    const policy = evaluateKilocodePolicy({
      trigger: "explicit",
      risk: "medium",
      action_summary: "run OpenHands with token=supersecret123456",
    });

    assert.equal(policy.delegate, false);
    assert.equal(policy.decision, "deny");
    assert.equal(policy.secret_values_returned, false);
    assert.doesNotMatch(JSON.stringify(policy), /supersecret123456/);
  });

  it("applies visual progress guardrails before accepting new scope", () => {
    const policy = evaluateKilocodePolicy({
      trigger: "explicit",
      explicit: true,
      action_summary: "add another GUI page before the current screen is usable",
      scope_change: true,
      current_milestone_usable: false,
    });

    assert.equal(policy.ok, true);
    assert.equal(policy.delegate, false);
    assert.equal(policy.decision, "deny");
    assert.equal(policy.blocked_by_guardrails, true);
    assert.equal(policy.visual_proof_required, true);
    assert.ok(policy.guardrail_effects.includes("current_milestone_not_usable"));
    assert.ok(policy.guardrail_effects.includes("visual_proof_required"));
    assert.ok(policy.guardrail_goals.some((goal) => /smallest usable milestone/i.test(goal)));
    assert.ok(policy.required_actions.some((action) => action.id === "capture_visual_proof"));
    assert.ok(policy.required_actions.some((action) => action.id === "finish_current_milestone"));
    assert.equal(policy.guardrails.hyperfocus_visual_mode, false);
    assert.equal(policy.checkpoint.every_steps, 3);
    assert.equal(policy.checkpoint.every_minutes, 45);
  });

  it("shortens visual checkpoints in hyperfocus visual mode without personal labels", async () => {
    const saved = await setKilocodeGuardrails({
      workspaceRoot: tmpDir,
      owner: "test-agent",
      reason: "visual progress proof",
      hyperfocus_visual_mode: true,
    });

    assert.equal(saved.ok, true);
    assert.equal(saved.guardrails.hyperfocus_visual_mode, true);
    assert.equal(saved.guardrails.visual_milestone_step_interval, 2);
    assert.equal(saved.guardrails.visual_milestone_minutes, 30);

    const read = await readKilocodeGuardrails({ workspaceRoot: tmpDir });
    assert.equal(read.ok, true);
    assert.equal(read.guardrails.hyperfocus_visual_mode, true);

    const persisted = await fs.readFile(path.join(tmpDir, ".hermes3d_orchestrator", "kilocode_guardrails.json"), "utf8");
    assert.doesNotMatch(persisted, new RegExp(["AD", "HD"].join(""), "i"));
    assert.doesNotMatch(persisted, new RegExp(["embarr", "ass"].join(""), "i"));
    assert.match(persisted, /hyperfocus_visual_mode/);
  });

  it("records real milestone checkpoints and rejects missing visual proof paths", async () => {
    const manager = new HermesLockManager({ workspaceRoot: tmpDir });
    await manager.init();
    await setKilocodeGuardrails({
      workspaceRoot: tmpDir,
      owner: "test-agent",
      hyperfocus_visual_mode: true,
      reason: "checkpoint proof",
    });

    const missing = await recordKilocodeProgressCheckpoint({
      manager,
      workspaceRoot: tmpDir,
      owner: "test-agent",
      milestone_id: "first-screen",
      milestone_goal: "Make the first screen usable",
      status: "working",
      visual_proof_paths: ["proof/missing.png"],
      summary: "Claimed a screenshot that does not exist",
    });
    assert.equal(missing.ok, false);
    assert.equal(missing.status, "missing_visual_proof");

    await fs.mkdir(path.join(tmpDir, "proof"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "proof", "screen.txt"), "visible checkpoint", "utf8");
    const recorded = await recordKilocodeProgressCheckpoint({
      manager,
      workspaceRoot: tmpDir,
      owner: "test-agent",
      milestone_id: "first-screen",
      milestone_goal: "Make the first screen usable",
      status: "usable",
      current_milestone_usable: true,
      visual_proof_paths: ["proof/screen.txt"],
      gates: [{ gate: "manual visual proof", status: "pass", evidence: "proof/screen.txt exists" }],
      summary: "First screen is visible and usable",
      next_action: "Run a real VS Code extension smoke",
    });

    assert.equal(recorded.ok, true);
    assert.equal(recorded.secret_values_returned, false);
    assert.equal(recorded.checkpoint.current_milestone_usable, true);
    assert.equal(recorded.checkpoint.visual_proof[0].exists, true);
    assert.equal(recorded.checkpoint.visual_proof[0].path, "proof/screen.txt");
    assert.equal(recorded.evidence.kind, "kilocode.progress.checkpoint");

    const progress = await fs.readFile(path.join(tmpDir, ".hermes3d_orchestrator", "kilocode_progress.json"), "utf8");
    assert.match(progress, /first-screen/);
    const evidenceCheck = await manager.verifyEvidence();
    assert.equal(evidenceCheck.ok, true);
  });

  it("records redacted provider and evidence outcomes for Kilo/OpenHands delegation", async () => {
    const manager = new HermesLockManager({ workspaceRoot: tmpDir });
    const providerPerformance = new ProviderPerformanceTracker({ workspaceRoot: tmpDir });
    await manager.init();
    await providerPerformance.init();

    const result = await recordKilocodeDelegation({
      manager,
      providerPerformance,
      owner: "codex-kilo",
      task_id: "kilo-openhands-smoke",
      provider_id: "minimax",
      model_name: "MiniMax-M3",
      openhands_conversation_id: "conv-123",
      trigger: "missing_tool",
      risk: "medium",
      outcome: "verified",
      latency_ms: 1200,
      summary: "OpenHands fixed terminal setup with sk-cp-abcdef1234567890",
      evidence: "log contains Bearer abcdefghijklmnopqrstuvwxyz",
      permission_decision: "allow",
      secret_scan: "passed",
      mode: "authorized_reverse_engineering",
      uncensored: true,
      reverse_engineering_authorized: true,
    });

    assert.equal(result.ok, true);
    assert.equal(result.secret_values_returned, false);
    assert.equal(result.task_type, KILOCODE_TASK_TYPE);
    assert.equal(result.mode, "authorized_reverse_engineering");
    assert.equal(result.uncensored, true);
    assert.equal(result.reverse_engineering_authorized, true);

    const stats = await providerPerformance.stats({
      provider_id: "minimax",
      task_type: KILOCODE_TASK_TYPE,
      include_history: true,
    });
    assert.equal(stats.providers[0].verified, 1);

    const evidenceCheck = await manager.verifyEvidence();
    assert.equal(evidenceCheck.ok, true);

    const stateText = await fs.readFile(path.join(tmpDir, ".hermes3d_orchestrator", "provider_performance.json"), "utf8");
    const evidenceText = await fs.readFile(path.join(tmpDir, ".hermes3d_orchestrator", "evidence", "ledger.ndjson"), "utf8");
    const combined = `${JSON.stringify(result)}\n${stateText}\n${evidenceText}`;
    assert.doesNotMatch(combined, /sk-cp-abcdef1234567890|abcdefghijklmnopqrstuvwxyz/);
    assert.match(combined, /\[REDACTED_TOKEN\]|\[REDACTED\]/);
    assert.match(combined, /authorized_reverse_engineering/);
  });

  it("evaluates Cloudflare and VPS infrastructure proof as release gates", () => {
    const result = evaluateKilocodeInfrastructureProof({
      resource: "edge_and_origin",
      checks: [
        { id: "cloudflare.waf_rules_enabled", status: "pass", rule_count: 3, observed_utc: "2026-07-04T12:00:00Z" },
        { id: "cloudflare.secret_probe_blocked", status: "pass", http_status: 403, latency_ms: 140 },
        { id: "cloudflare.scanner_ua_blocked", status: "pass", http_status: 403, latency_ms: 122 },
        { id: "cloudflare.cache_rule", status: "warn", evidence: "token lacks cache settings permission", observed_utc: "2026-07-04T12:00:00Z" },
        { id: "vps.ssh_health", status: "pass", exit_code: 0, command: "ssh daveai uptime" },
        { id: "vps.origin_guard_installed", status: "pass", exit_code: 0, command: "nginx -t" },
        { id: "vps.homepage_ok", status: "pass", http_status: 200, latency_ms: 90 },
        { id: "vps.secret_probe_blocked", status: "pass", http_status: 444, latency_ms: 55 },
        { id: "vps.resource_headroom", status: "pass", evidence_id: "ev_12345678" },
      ],
    });

    assert.equal(result.ok, true);
    assert.equal(result.gate_status, "warn");
    assert.equal(result.release_ready, true);
    assert.deepEqual(result.missing_required_checks, []);
    assert.ok(result.warning_checks.includes("cloudflare.cache_rule"));
    assert.equal(result.secret_values_returned, false);
  });

  it("evaluates GitLab Free plus VPS runner as a CI/CD proof lane", () => {
    const result = evaluateKilocodeInfrastructureProof({
      resource: "gitlab_runner",
      checks: [
        { id: "gitlab.runner_registered", status: "pass", evidence_id: "ev_12345678" },
        { id: "gitlab.runner_self_hosted", status: "pass", command: "gitlab-runner verify" },
        { id: "gitlab.runner_executor_ready", status: "pass", evidence: "docker executor ready", observed_utc: "2026-07-04T12:00:00Z" },
        { id: "gitlab.pipeline_smoke_passed", status: "pass", evidence_id: "ev_23456789" },
        { id: "gitlab.runner_secret_scope_checked", status: "pass", evidence: "protected/masked variables only", observed_utc: "2026-07-04T12:00:00Z" },
      ],
    });

    assert.equal(result.ok, true);
    assert.equal(result.gate_status, "pass");
    assert.equal(result.release_ready, true);
    assert.deepEqual(result.required_checks, [
      "gitlab.runner_registered",
      "gitlab.runner_self_hosted",
      "gitlab.runner_executor_ready",
      "gitlab.pipeline_smoke_passed",
      "gitlab.runner_secret_scope_checked",
    ]);
  });

  it("records Cloudflare/VPS proof but rejects fake or UI-only infrastructure gates", async () => {
    const manager = new HermesLockManager({ workspaceRoot: tmpDir });
    await manager.init();
    await fs.mkdir(path.join(tmpDir, "proof"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "proof", "cloudflare-vps-smoke.json"), JSON.stringify({ ok: true }), "utf8");

    const recorded = await recordKilocodeInfrastructureProof({
      manager,
      workspaceRoot: tmpDir,
      owner: "codex-kilo",
      task_id: "daveai-edge-origin",
      resource: "edge_and_origin",
      target: "daveai.tech",
      summary: "Cloudflare edge and VPS origin smoke passed with cache permission warning",
      proof_paths: ["proof/cloudflare-vps-smoke.json"],
      checks: [
        { id: "cloudflare.waf_rules_enabled", status: "pass", rule_count: 3, observed_utc: "2026-07-04T12:00:00Z" },
        { id: "cloudflare.secret_probe_blocked", status: "pass", http_status: 403 },
        { id: "cloudflare.scanner_ua_blocked", status: "pass", http_status: 403 },
        { id: "vps.ssh_health", status: "pass", exit_code: 0, command: "ssh daveai uptime" },
        { id: "vps.origin_guard_installed", status: "pass", exit_code: 0, command: "nginx -t" },
        { id: "vps.homepage_ok", status: "pass", http_status: 200 },
        { id: "vps.secret_probe_blocked", status: "pass", http_status: 444 },
        { id: "vps.resource_headroom", status: "pass", evidence_id: "ev_12345678" },
      ],
    });

    assert.equal(recorded.ok, true);
    assert.equal(recorded.evidence.kind, "kilocode.infrastructure.proof");
    assert.equal(recorded.release_ready, true);

    const fake = await recordKilocodeInfrastructureProof({
      manager,
      workspaceRoot: tmpDir,
      owner: "codex-kilo",
      resource: "cloudflare_edge",
      summary: "fake proof should not land",
      checks: [
        { id: "cloudflare.waf_rules_enabled", status: "pass", mock: true, rule_count: 3 },
        { id: "cloudflare.secret_probe_blocked", status: "pass", http_status: 403 },
        { id: "cloudflare.scanner_ua_blocked", status: "pass", ui_only: true, http_status: 403 },
      ],
    });

    assert.equal(fake.ok, false);
    assert.equal(fake.status, "rejected_fake_or_stubbed_proof");
    assert.ok(fake.evaluation.required_actions.some((action) => /mocked|fake|stubbed|UI-only/i.test(action)));

    const evidenceCheck = await manager.verifyEvidence();
    assert.equal(evidenceCheck.ok, true);
    const evidenceText = await fs.readFile(path.join(tmpDir, ".hermes3d_orchestrator", "evidence", "ledger.ndjson"), "utf8");
    assert.match(evidenceText, /kilocode\.infrastructure\.proof/);
    assert.doesNotMatch(evidenceText, /fake proof should not land/);
  });
});
