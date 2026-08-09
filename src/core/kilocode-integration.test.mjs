import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HermesLockManager } from "./lock-manager.mjs";
import { ProviderPerformanceTracker } from "./provider-performance.mjs";
import {
  KILOCODE_AGENT_BUS_TASK_TYPE,
  KILOCODE_E2E_CONTRACT_VERSION,
  KILOCODE_INSTALLED_VSIX_TASK_TYPE,
  KILOCODE_REQUIRED_PREFLIGHTS,
  KILOCODE_ROADMAP_TASK_TYPE,
  KILOCODE_TASK_TYPE,
  evaluateKilocodeAgentBusEnvelope,
  evaluateKilocodeInstalledVsixReleaseProof,
  evaluateKilocodeInfrastructureProof,
  evaluateKilocodePolicy,
  evaluateKilocodeRoadmapCompletionProof,
  readKilocodeGuardrails,
  recordKilocodeAgentBusEvent,
  recordKilocodeInfrastructureProof,
  recordKilocodeProgressCheckpoint,
  recordKilocodeDelegation,
  redactIntegrationText,
  setKilocodeGuardrails,
} from "./kilocode-integration.mjs";

let tmpDir;

function releasePreflights(hash) {
  const records = Object.fromEntries(KILOCODE_REQUIRED_PREFLIGHTS.map((key) => [key, { ok: true }]));
  const shots = [
    { path: "artifacts/before.png", sha256: "a".repeat(64) },
    { path: "artifacts/after.png", sha256: "b".repeat(64) },
  ];
  records["visible-ui-driver"] = {
    ok: true,
    uiDriver: "vscode-extension-tester",
    vsixSha256: hash,
    stages: ["activityBar", "view", "webview", "prompt", "backendReady", "focus"].map((name) => ({ name, status: "passed" })),
    screenshots: shots,
  };
  records["settings-ui-driver"] = {
    ok: true,
    scenario: "settings-navigation",
    uiDriver: "vscode-extension-tester",
    vsixSha256: hash,
    stages: ["activityBar", "view", "settingsAction", "settingsEditor", "settingsFrame", "settingsRoot"].map((name) => ({ name, status: "passed" })),
    screenshots: shots,
    settings: { visits: [{ tab: "speech", content: "speech", renderErrors: [] }] },
  };
  records["chat-task"] = {
    ok: true,
    scenario: "sidebar-submit",
    uiDriver: "vscode-extension-tester",
    vsixSha256: hash,
    stages: ["activityBar", "view", "webview", "prompt", "backendReady", "focus", "sendButton", "submit", "message", "routing"].map((name) => ({ name, status: "passed" })),
    screenshots: shots,
    submission: { clicked: true },
    message: { optimisticUserRow: true, promptCleared: true },
    routing: { worker: "kilo", source: "backend", phase: "running", voiceIndependent: true },
  };
  return records;
}

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

  it("evaluates agent-bus completion proof and rejects completion without evidence", () => {
    const missingEvidence = evaluateKilocodeAgentBusEnvelope({
      schema: "kilo.agent.bus.v1",
      event_type: "task.completed",
      substrate: "cao",
      task_id: "cao-task-1",
      worker_id: "cao-worker-1",
      summary: "UI panel says the worker is done",
    });

    assert.equal(missingEvidence.ok, false);
    assert.equal(missingEvidence.status, "rejected_completion_without_evidence");
    assert.ok(missingEvidence.required_actions.some((action) => /ev_\*/.test(action)));

    const accepted = evaluateKilocodeAgentBusEnvelope({
      schema: "kilo.agent.bus.v1",
      event_type: "task.completed",
      substrate: "cao",
      task_id: "cao-task-1",
      worker_id: "cao-worker-1",
      summary: "Worker completed with linked proof",
      evidence_id: "ev_12345678",
      checks: [{ id: "cao.worker.exit", status: "pass", evidence_id: "ev_12345678" }],
    });

    assert.equal(accepted.ok, true);
    assert.equal(accepted.status, "accepted");
    assert.equal(accepted.task_type, KILOCODE_AGENT_BUS_TASK_TYPE);
    assert.deepEqual(accepted.proof_refs, ["ev_12345678"]);
    assert.equal(accepted.secret_values_returned, false);
  });

  it("rejects installed VSIX release proof when VS Code exits before writing gate results", () => {
    const result = evaluateKilocodeInstalledVsixReleaseProof({
      schema: "kilocode.installed_vsix.release.v1",
      vsixSha256: "61B35F00ABE48E6536CF64AFC4A48F065E7DBB52213631B07905578DD305E1C1",
      resultFileExists: false,
      error: { message: "VS Code extension test exited before writing a result file" },
      heartbeat: [
        "2026-07-09T14:16:02.547Z pre-readiness",
        "2026-07-09T14:16:03.012Z pre-gate-gate6-sidecar-probes",
      ],
    }, { now_ms: Date.parse("2026-07-09T14:20:00.000Z") });

    assert.equal(result.ok, false);
    assert.equal(result.release_ready, false);
    assert.equal(result.task_type, KILOCODE_INSTALLED_VSIX_TASK_TYPE);
    assert.ok(result.findings.some((finding) => finding.code === "installed_vsix.result_file_missing"));
    assert.ok(result.findings.some((finding) => finding.code === "installed_vsix.gate_started_without_finish"));
    assert.ok(result.findings.some((finding) => finding.code === "installed_vsix.visible_sidecar_proof_missing"));
  });

  it("accepts installed VSIX proof only with timestamps, snapshots, sidecar tool calls, and ev evidence", () => {
    const hash = "61B35F00ABE48E6536CF64AFC4A48F065E7DBB52213631B07905578DD305E1C1";
    const gates = {};
    const names = [
      "gate1-supervisor-recording",
      "gate2-closed-loop-auto",
      "gate3-daveai-indexed-repair",
      "gate4-speech-safe-narration",
      "gate5-installed-indexing",
      "gate6-sidecar-probes",
      "gate7-settings-panel-rendered",
      "gate8-cli-bundled",
      "gate9-extension-activation",
      "gate10-required-commands",
    ];
    for (const [idx, name] of names.entries()) {
      gates[name] = {
        ok: true,
        snapshotPath: `artifacts/${String(idx + 1).padStart(2, "0")}-${name}/snapshot.json`,
        gateArtifactsDir: `artifacts/${String(idx + 1).padStart(2, "0")}-${name}`,
      };
    }
    gates["gate7-settings-panel-rendered"].visibleWindowProof = {
      ok: true,
      settingsCommandSent: true,
      settingsCommandChangedWindow: true,
      settingsPanelVisible: true,
      screenshotHashChanged: true,
      foregroundBelongsToVsCode: true,
      before: { ok: true, sha256: "before-settings", foregroundBelongsToTarget: true },
      after: { ok: true, sha256: "after-settings", foregroundBelongsToTarget: true },
    };
    gates["gate7-settings-panel-rendered"].visibleSettingsWebviewProof = {
      ok: true,
      settingsRootPresent: true,
      missingStableTabs: [],
      missingRequiredTabs: [],
      forbiddenTabsLeaked: false,
    };
    gates["gate9-extension-activation"].kiloActivityBarClicked = true;
    gates["gate9-extension-activation"].visibleWindowProof = {
      ok: true,
      activityBarClicked: true,
      closeEditorsCommandSent: true,
      closeAfterMigrationCommandSent: true,
      activityBarClickChangedWindow: true,
      activityBarClickRecorded: true,
      migrationDismissalProofOk: true,
      loadWaitMs: 30000,
      focusCommandSent: true,
      notificationsDismissedCommandSent: true,
      newTaskCommandSent: true,
      markerTabActive: false,
      webviewChatSmokeCommandSent: true,
      webviewChatSmokeAccepted: true,
      webviewChatSmoke: { ok: true, marker: "KILO_VISIBLE_CHAT_SMOKE_TEST", sessionID: "ses_test" },
      screenshotHashChanged: true,
      foregroundBelongsToVsCode: true,
      before: { ok: true, sha256: "before-chat", foregroundBelongsToTarget: true },
      after: { ok: true, sha256: "after-chat", foregroundBelongsToTarget: true },
    };
    gates["gate6-sidecar-probes"].visibleSidecarToolSmokes = {
      openhands: {
        ok: true,
        expectedToolMatched: true,
        evidenceId: "ev_openhands123",
        toolCalls: [{ tool: "openhands", statusOk: true }],
      },
      aider: {
        ok: true,
        expectedToolMatched: true,
        evidenceId: "ev_aider123456",
        toolCalls: [{ tool: "aider", statusOk: true }],
      },
      goose: {
        ok: true,
        expectedToolMatched: true,
        evidenceId: "ev_goose123456",
        toolCalls: [{ tool: "goose", statusOk: true }],
      },
    };

    const heartbeat = names.flatMap((name, idx) => {
      const start = new Date(Date.parse("2026-07-09T14:16:00.000Z") + idx * 2000).toISOString();
      const end = new Date(Date.parse("2026-07-09T14:16:01.000Z") + idx * 2000).toISOString();
      return [`${start} pre-gate-${name}`, `${end} post-gate-${name}`];
    });

    const result = evaluateKilocodeInstalledVsixReleaseProof({
      schema: "kilocode.installed_vsix.release.v1",
      contractVersion: KILOCODE_E2E_CONTRACT_VERSION,
      vsixSha256: hash,
      startedAt: "2026-07-09T14:16:00.000Z",
      finishedAt: "2026-07-09T14:17:00.000Z",
      gates,
      heartbeat,
      preflightResults: releasePreflights(hash),
    });

    assert.equal(result.ok, true);
    assert.equal(result.release_ready, true);
    assert.equal(result.status, "accepted");
    assert.equal(result.heartbeat_count, 20);
    assert.deepEqual(result.missing, []);
  });

  it("rejects missing, failed, stale-contract, or fake KiloCode preflights", () => {
    const hash = "61B35F00ABE48E6536CF64AFC4A48F065E7DBB52213631B07905578DD305E1C1";
    const preflights = releasePreflights(hash);
    delete preflights["speech-playback"];
    preflights["lanes-tab"] = { ok: false, blockedReason: "lanes DOM did not mount" };
    preflights["chat-routing-surface"] = { ok: true, nested: { simulated: true } };
    const result = evaluateKilocodeInstalledVsixReleaseProof({
      schema: "kilocode.installed_vsix.release.v1",
      contractVersion: "kilocode.e2e-proof-contract.stale",
      vsixSha256: hash,
      preflightResults: preflights,
    });

    assert.equal(result.ok, false);
    assert.ok(result.findings.some((finding) => finding.code === "installed_vsix.contract_version_mismatch"));
    assert.ok(result.findings.some((finding) => finding.code === "installed_vsix.preflight_missing" && finding.evidence?.preflight === "speech-playback"));
    assert.ok(result.findings.some((finding) => finding.code === "installed_vsix.preflight_not_ok" && finding.evidence?.preflight === "lanes-tab"));
    assert.ok(result.findings.some((finding) => finding.code === "installed_vsix.preflight_fake_metadata" && finding.evidence?.preflight === "chat-routing-surface"));
  });

  it("rejects installed VSIX proof when visible VS Code settings or chat proof is missing", () => {
    const gates = {};
    const names = [
      "gate1-supervisor-recording",
      "gate2-closed-loop-auto",
      "gate3-daveai-indexed-repair",
      "gate4-speech-safe-narration",
      "gate5-installed-indexing",
      "gate6-sidecar-probes",
      "gate7-settings-panel-rendered",
      "gate8-cli-bundled",
      "gate9-extension-activation",
      "gate10-required-commands",
    ];
    for (const [idx, name] of names.entries()) {
      gates[name] = {
        ok: true,
        snapshotPath: `artifacts/${String(idx + 1).padStart(2, "0")}-${name}/snapshot.json`,
      };
    }
    gates["gate6-sidecar-probes"].visibleSidecarToolSmokes = {
      openhands: { ok: true, expectedToolMatched: true, evidenceId: "ev_openhands123", toolCalls: [{ statusOk: true }] },
      aider: { ok: true, expectedToolMatched: true, evidenceId: "ev_aider123456", toolCalls: [{ statusOk: true }] },
      goose: { ok: true, expectedToolMatched: true, evidenceId: "ev_goose123456", toolCalls: [{ statusOk: true }] },
    };
    const heartbeat = names.flatMap((name, idx) => {
      const start = new Date(Date.parse("2026-07-09T14:16:00.000Z") + idx * 2000).toISOString();
      const end = new Date(Date.parse("2026-07-09T14:16:01.000Z") + idx * 2000).toISOString();
      return [`${start} pre-gate-${name}`, `${end} post-gate-${name}`];
    });

    const result = evaluateKilocodeInstalledVsixReleaseProof({
      schema: "kilocode.installed_vsix.release.v1",
      vsixSha256: "61B35F00ABE48E6536CF64AFC4A48F065E7DBB52213631B07905578DD305E1C1",
      finishedAt: "2026-07-09T14:17:00.000Z",
      gates,
      heartbeat,
    });

    assert.equal(result.ok, false);
    assert.ok(result.findings.some((finding) => finding.code === "installed_vsix.visible_settings_window_proof_missing"));
    assert.ok(result.findings.some((finding) => finding.code === "installed_vsix.visible_chat_window_proof_missing"));
  });

  it("requires all 21 installed gates when all-21 release proof is requested", () => {
    const gates = {};
    for (let idx = 0; idx < 10; idx++) {
      const name = [
        "gate1-supervisor-recording",
        "gate2-closed-loop-auto",
        "gate3-daveai-indexed-repair",
        "gate4-speech-safe-narration",
        "gate5-installed-indexing",
        "gate6-sidecar-probes",
        "gate7-settings-panel-rendered",
        "gate8-cli-bundled",
        "gate9-extension-activation",
        "gate10-required-commands",
      ][idx];
      gates[name] = { ok: true, snapshotPath: `artifacts/${idx + 1}/snapshot.json` };
    }
    gates["gate6-sidecar-probes"].visibleSidecarToolSmokes = {
      openhands: { ok: true, expectedToolMatched: true, evidenceId: "ev_openhands123", toolCalls: [{ statusOk: true }] },
      aider: { ok: true, expectedToolMatched: true, evidenceId: "ev_aider123456", toolCalls: [{ statusOk: true }] },
      goose: { ok: true, expectedToolMatched: true, evidenceId: "ev_goose123456", toolCalls: [{ statusOk: true }] },
    };

    const result = evaluateKilocodeInstalledVsixReleaseProof({
      schema: "kilocode.installed_vsix.release.v1",
      vsixSha256: "61B35F00ABE48E6536CF64AFC4A48F065E7DBB52213631B07905578DD305E1C1",
      finishedAt: "2026-07-09T14:17:00.000Z",
      gates,
      heartbeat: ["2026-07-09T14:16:00.000Z pre-gate-gate1-supervisor-recording"],
    }, { required_gate_count: 21 });

    assert.equal(result.ok, false);
    assert.ok(result.findings.some((finding) => finding.code === "installed_vsix.required_gates_missing"));
    assert.ok(result.findings.some((finding) => finding.evidence?.missing?.includes("gate21-evolve-lane")));
  });

  it("rejects roadmap completion claims without real proof and accepts hashed runner-backed items", () => {
    const rejected = evaluateKilocodeRoadmapCompletionProof({
      schema: "kilocode.roadmap_completion.v1",
      docs: ["ROADMAP.md"],
      items: [{ id: "action-plan-rest", status: "done", fake: true }],
    });

    assert.equal(rejected.ok, false);
    assert.equal(rejected.task_type, KILOCODE_ROADMAP_TASK_TYPE);
    assert.ok(rejected.findings.some((finding) => finding.code === "roadmap.fake_or_stubbed_item"));
    assert.ok(rejected.findings.some((finding) => finding.code === "roadmap.completed_item_missing_evidence"));
    assert.ok(rejected.findings.some((finding) => finding.code === "roadmap.required_docs_missing"));

    const accepted = evaluateKilocodeRoadmapCompletionProof({
      schema: "kilocode.roadmap_completion.v1",
      docs: [
        "ROADMAP.md",
        "ACTION_PLAN.md",
        "HANDOFF.md",
        "docs/current-e2e-recovery-contract-2026-07-10.md",
        "docs/real-e2e-proof-governance.md",
        "ci/e2e-gate-proof-policy.json",
      ],
      items: [{
        id: "gates-1-10",
        status: "done",
        evidenceId: "ev_roadmap1234",
        runner: { command: "bun script/installed-vsix-smoke.ts", status: "pass", durationMs: 120000 },
        artifacts: [{
          path: "test-results/installed-vsix-smoke.json",
          sha256: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        }],
      }],
    }, { require_all_complete: true });

    assert.equal(accepted.ok, true);
    assert.equal(accepted.status, "accepted");
    assert.deepEqual(accepted.completed_items, ["gates-1-10"]);
  });

  it("records accepted agent-bus events but refuses fake or UI-only proof", async () => {
    const manager = new HermesLockManager({ workspaceRoot: tmpDir });
    await manager.init();

    const proof = await recordKilocodeAgentBusEvent({
      manager,
      owner: "codex-kilo",
      envelope: {
        schema: "kilo.agent.bus.v1",
        event_type: "proof.attached",
        substrate: "agent_orchestrator",
        task_id: "ao-task-1",
        worker_id: "aider-reviewer-1",
        lane: "review",
        summary: "Aider review proof attached with a concrete artifact hash",
        artifacts: [{ kind: "log", path: "proof/aider-review.txt", sha256: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789" }],
        checks: [{ id: "aider.review.exit", status: "pass", exit_code: 0 }],
      },
    });

    assert.equal(proof.ok, true);
    assert.equal(proof.status, "recorded");
    assert.equal(proof.evidence.kind, "kilocode.agent_bus.event");
    assert.equal(proof.evaluation.has_concrete_proof, true);

    const fake = await recordKilocodeAgentBusEvent({
      manager,
      owner: "codex-kilo",
      envelope: {
        schema: "kilo.agent.bus.v1",
        event_type: "proof.attached",
        substrate: "goose",
        task_id: "goose-task-1",
        worker_id: "goose-worker-1",
        summary: "fake proof should not land",
        checks: [{ id: "goose.browser.done", status: "pass", ui_only: true }],
      },
    });

    assert.equal(fake.ok, false);
    assert.equal(fake.status, "rejected_fake_or_stubbed_event");
    assert.ok(fake.evaluation.required_actions.some((action) => /mocked|fake|stubbed|UI-only/i.test(action)));

    const evidenceCheck = await manager.verifyEvidence();
    assert.equal(evidenceCheck.ok, true);
    const evidenceText = await fs.readFile(path.join(tmpDir, ".hermes3d_orchestrator", "evidence", "ledger.ndjson"), "utf8");
    assert.match(evidenceText, /kilocode\.agent_bus\.event/);
    assert.doesNotMatch(evidenceText, /fake proof should not land/);
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

  it("does not report partial infrastructure proof as ok but still allows recording follow-up evidence", async () => {
    const partial = evaluateKilocodeInfrastructureProof({
      resource: "cloudflare_edge",
      checks: [
        { id: "cloudflare.waf_rules_enabled", status: "pass", rule_count: 1, observed_utc: "2026-07-05T12:00:00Z" },
      ],
    });

    assert.equal(partial.ok, false);
    assert.equal(partial.accepted_for_recording, true);
    assert.equal(partial.gate_status, "fail");
    assert.equal(partial.release_ready, false);
    assert.ok(partial.missing_required_checks.includes("cloudflare.secret_probe_blocked"));

    const manager = new HermesLockManager({ workspaceRoot: tmpDir });
    await manager.init();
    const recorded = await recordKilocodeInfrastructureProof({
      manager,
      workspaceRoot: tmpDir,
      owner: "codex-kilo",
      task_id: "partial-cloudflare-proof",
      resource: "cloudflare_edge",
      summary: "Partial Cloudflare proof should be recorded as follow-up, not release-ready.",
      checks: [
        { id: "cloudflare.waf_rules_enabled", status: "pass", rule_count: 1, observed_utc: "2026-07-05T12:00:00Z" },
      ],
    });

    assert.equal(recorded.ok, false);
    assert.equal(recorded.recorded, true);
    assert.equal(recorded.status, "recorded_needs_followup");
    assert.equal(recorded.release_ready, false);
    assert.equal(recorded.evidence.kind, "kilocode.infrastructure.proof");
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
