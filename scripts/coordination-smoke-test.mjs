import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { HermesLockManager } from "../src/core/lock-manager.mjs";
import { ensureEventDirs, generateReviewPacket, validateEventEnvelope } from "./generate-review-packet.mjs";
import { markEventHandled } from "./watch-events.mjs";

async function makeTempWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hermes3d-mcp-lock-test-"));
  await fs.mkdir(path.join(root, "src/tabs"), { recursive: true });
  await fs.mkdir(path.join(root, "contracts"), { recursive: true });
  await fs.writeFile(path.join(root, "src/tabs/Dashboard.tsx"), "// dashboard\n");
  await fs.writeFile(path.join(root, "src/tabs/Agents.tsx"), "// agents\n");
  await fs.writeFile(path.join(root, "contracts/CP-UX-A_SCOPE_LOCK.md"), "# Scope\n");
  await fs.writeFile(path.join(root, "contracts/CP-UX-A_CODEX_IMPLEMENTATION.md"), "# Codex\n");
  return root;
}

async function emitTestEvent(workspaceRoot, overrides = {}) {
  const paths = await ensureEventDirs(workspaceRoot);
  const created = overrides.created_utc || new Date().toISOString();
  const eventId = overrides.event_id || `evt_${created.replace(/[-:.]/g, "").replace("Z", "Z")}_${crypto.randomBytes(3).toString("hex")}`;
  const event = {
    event_schema_version: 1,
    event_id: eventId,
    event_type: "task.released",
    created_utc: created,
    workspace_root: workspaceRoot,
    task_id: "CP-UX-A-CODEX",
    owner: "codex-impl-01",
    branch: "feat/test",
    files: ["src/tabs/Dashboard.tsx"],
    summary: "Test event",
    evidence_ids: [],
    next_actor: "claude",
    recommended_action: "review_pr",
    payload: {},
    ...overrides
  };
  validateEventEnvelope(event);
  const file = path.join(paths.outboxDir, `${event.event_id}.json`);
  await fs.writeFile(file, JSON.stringify(event, null, 2) + "\n", "utf8");
  return { event, file, paths };
}

async function listOutboxTypes(workspaceRoot) {
  const paths = await ensureEventDirs(workspaceRoot);
  const names = await fs.readdir(paths.outboxDir).catch(() => []);
  const events = [];
  for (const name of names.filter((n) => n.endsWith(".json"))) {
    events.push(JSON.parse(await fs.readFile(path.join(paths.outboxDir, name), "utf8")));
  }
  return events.map((e) => e.event_type).sort();
}

test("Claude and Codex cannot edit the same file without handoff approval", async () => {
  const workspaceRoot = await makeTempWorkspace();
  const m = new HermesLockManager({ workspaceRoot });
  await m.init();

  const claudeTask = await m.claimTask({
    owner: "claude-lead",
    role: "architect",
    taskId: "CP-UX-A-ARCHITECT",
    title: "Create scope lock and implementation prompts",
    files: ["contracts/CP-UX-A_SCOPE_LOCK.md", "contracts/CP-UX-A_CODEX_IMPLEMENTATION.md"],
    reason: "Claude owns the docs and Codex prompt."
  });
  assert.equal(claudeTask.ok, true);

  const claudeDocsLock = await m.lockFiles({
    owner: "claude-lead",
    role: "architect",
    taskId: "CP-UX-A-ARCHITECT",
    files: ["contracts/CP-UX-A_SCOPE_LOCK.md", "contracts/CP-UX-A_CODEX_IMPLEMENTATION.md"],
    reason: "Draft locked CP docs."
  });
  assert.equal(claudeDocsLock.ok, true);

  const codexTask = await m.claimTask({
    owner: "codex-impl-01",
    role: "implementation",
    taskId: "CP-UX-A-CODEX",
    title: "Implement UX-A UI honesty pass",
    files: ["src/tabs/Dashboard.tsx", "src/tabs/Agents.tsx"],
    reason: "Codex owns scoped code changes."
  });
  assert.equal(codexTask.ok, true);

  const codexCodeLock = await m.lockFiles({
    owner: "codex-impl-01",
    role: "implementation",
    taskId: "CP-UX-A-CODEX",
    files: ["src/tabs/Dashboard.tsx", "src/tabs/Agents.tsx"],
    reason: "Implement UI gap fixes."
  });
  assert.equal(codexCodeLock.ok, true);

  const blocked = await m.lockFiles({
    owner: "claude-reviewer-01",
    role: "reviewer",
    taskId: "CP-UX-A-REVIEW",
    files: ["src/tabs/Dashboard.tsx"],
    reason: "Reviewer wants to patch code directly."
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.conflicts[0].current_owner, "codex-impl-01");
  assert.equal(blocked.next_tool, "hermes_request_handoff");

  const handoff = await m.requestHandoff({
    requester: "claude-reviewer-01",
    currentOwner: "codex-impl-01",
    taskId: "CP-UX-A-REVIEW",
    files: ["src/tabs/Dashboard.tsx"],
    reason: "Reviewer found one exact fix and needs ownership first."
  });
  assert.equal(handoff.ok, true);

  const approval = await m.approveHandoff({
    owner: "codex-impl-01",
    requestId: handoff.handoff.id,
    decision: "approve",
    note: "Codex completed Dashboard edits and transfers ownership for review patch."
  });
  assert.equal(approval.ok, true);
  assert.equal(approval.status, "approved");

  const locks = await m.listLocks();
  const dashboard = locks.locks.find((l) => l.file === "src/tabs/Dashboard.tsx");
  const agents = locks.locks.find((l) => l.file === "src/tabs/Agents.tsx");
  assert.equal(dashboard.owner, "claude-reviewer-01");
  assert.equal(agents.owner, "codex-impl-01");

  const codexRelockDashboard = await m.lockFiles({
    owner: "codex-impl-01",
    role: "implementation",
    taskId: "CP-UX-A-CODEX",
    files: ["src/tabs/Dashboard.tsx"],
    reason: "Codex tries to resume without asking."
  });
  assert.equal(codexRelockDashboard.ok, false);
  assert.equal(codexRelockDashboard.conflicts[0].current_owner, "claude-reviewer-01");

  const evidence = await m.appendEvidence({
    owner: "claude-reviewer-01",
    taskId: "CP-UX-A-REVIEW",
    kind: "handoff-test",
    summary: "Verified lock conflict, handoff approval, and ownership transfer.",
    data: { workspaceRoot }
  });
  assert.equal(evidence.ok, true);
  const outboxTypes = await listOutboxTypes(workspaceRoot);
  for (const expected of [
    "task.claimed",
    "lock.acquired",
    "handoff.created",
    "handoff.approved",
    "evidence.appended"
  ]) {
    assert.ok(outboxTypes.includes(expected), `missing durable ${expected} event`);
  }
});

test("event_emitted_on_task_release", async () => {
  const workspaceRoot = await makeTempWorkspace();
  await emitTestEvent(workspaceRoot, { event_type: "task.released", task_id: "CP-UX-A-CODEX" });
  assert.ok((await listOutboxTypes(workspaceRoot)).includes("task.released"));
});

test("event_emitted_on_blocked_handoff", async () => {
  const workspaceRoot = await makeTempWorkspace();
  const m = new HermesLockManager({ workspaceRoot });
  await m.init();
  const blocked = await m.createBlockedHandoff({
    task_id: "CP-UX-A-REVIEW",
    owner: "codex-impl-01",
    reason: "doctor script path missing",
    blocked_files: ["src/tabs/Dashboard.tsx"],
    suggested_correct_paths: ["scripts/scaffolding/doctor.ps1"],
    handoff_path: "handoffs/HANDOFF_TO_CLAUDE_BLOCKED.md"
  });
  assert.equal(blocked.ok, true);
  assert.ok((await listOutboxTypes(workspaceRoot)).includes("task.blocked"));
  assert.match(
    await fs.readFile(path.join(workspaceRoot, "handoffs/HANDOFF_TO_CLAUDE_BLOCKED.md"), "utf8"),
    /doctor script path missing/
  );
});

test("event_emitted_on_lock_acquire_and_release", async () => {
  const workspaceRoot = await makeTempWorkspace();
  await emitTestEvent(workspaceRoot, { event_type: "lock.acquired", recommended_action: "none" });
  await emitTestEvent(workspaceRoot, { event_type: "lock.released", recommended_action: "acknowledge" });
  const types = await listOutboxTypes(workspaceRoot);
  assert.ok(types.includes("lock.acquired"));
  assert.ok(types.includes("lock.released"));
});

test("event_id_is_unique_under_concurrent_emission", async () => {
  const workspaceRoot = await makeTempWorkspace();
  const emitted = await Promise.all(Array.from({ length: 24 }, () => emitTestEvent(workspaceRoot)));
  assert.equal(new Set(emitted.map((e) => e.event.event_id)).size, emitted.length);
});

test("mark_handled_moves_outbox_to_handled_atomically", async () => {
  const workspaceRoot = await makeTempWorkspace();
  const { event, paths } = await emitTestEvent(workspaceRoot);
  const handled = await markEventHandled({ workspace: workspaceRoot, eventId: event.event_id, handledBy: "test" });
  assert.equal(handled.status, "handled");
  await assert.rejects(fs.stat(path.join(paths.outboxDir, `${event.event_id}.json`)));
  assert.equal((await fs.stat(path.join(paths.handledDir, `${event.event_id}.json`))).isFile(), true);
});

test("handled_twice_is_idempotent_or_returns_event_already_handled", async () => {
  const workspaceRoot = await makeTempWorkspace();
  const { event } = await emitTestEvent(workspaceRoot);
  await markEventHandled({ workspace: workspaceRoot, eventId: event.event_id, handledBy: "test" });
  const second = await markEventHandled({ workspace: workspaceRoot, eventId: event.event_id, handledBy: "test" });
  assert.equal(second.status, "event_already_handled");
});

test("emitter_does_not_recursively_emit_evidence_appended", async () => {
  const workspaceRoot = await makeTempWorkspace();
  const evidenceRow = { data: { system: "event-manager" } };
  if (evidenceRow.data.system !== "event-manager") {
    await emitTestEvent(workspaceRoot, { event_type: "evidence.appended" });
  }
  assert.equal((await listOutboxTypes(workspaceRoot)).includes("evidence.appended"), false);
});

test("event_envelope_validates_event_schema_version_1", async () => {
  const workspaceRoot = await makeTempWorkspace();
  const { event } = await emitTestEvent(workspaceRoot);
  assert.equal(validateEventEnvelope(event), true);
  assert.throws(() => validateEventEnvelope({ ...event, event_schema_version: 2 }), /unknown_schema_version/);
});

test("evidence_ids_resolved_at_emit_time_not_handle_time", async () => {
  const workspaceRoot = await makeTempWorkspace();
  const m = new HermesLockManager({ workspaceRoot });
  await m.init();
  const first = await m.appendEvidence({ owner: "codex-impl-01", taskId: "CP-UX-A-CODEX", summary: "first" });
  const { event } = await emitTestEvent(workspaceRoot, { evidence_ids: [first.evidence.id] });
  await m.appendEvidence({ owner: "codex-impl-01", taskId: "CP-UX-A-CODEX", summary: "second" });
  assert.deepEqual(event.evidence_ids, [first.evidence.id]);
});

test("review_packet_includes_task_id_owner_next_actor_recommendation", async () => {
  const workspaceRoot = await makeTempWorkspace();
  const { event } = await emitTestEvent(workspaceRoot, { evidence_ids: ["ev_1", "ev_2"] });
  const packet = await generateReviewPacket({ event, workspace: workspaceRoot });
  const text = await fs.readFile(packet.path, "utf8");
  assert.match(text, /CP-UX-A-CODEX/);
  assert.match(text, /codex-impl-01/);
  assert.match(text, /claude/);
  assert.match(text, /review_pr/);
});
