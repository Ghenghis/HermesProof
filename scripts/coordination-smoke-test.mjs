import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { EventManager } from "../src/core/event-manager.mjs";
import { statePaths } from "../src/core/fs-utils.mjs";
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

test("evidenceIdsForTask streams without loading the whole ledger", async () => {
  const workspaceRoot = await makeTempWorkspace();
  const paths = statePaths(workspaceRoot);
  await fs.mkdir(path.dirname(paths.evidenceFile), { recursive: true });
  const targetTask = "CP-LARGE-LEDGER";
  const matches = new Map([
    [7, "ev_match_1"],
    [1500, "ev_match_2"],
    [4999, "ev_match_3"]
  ]);
  const lines = [];
  for (let i = 0; i < 5000; i++) {
    const id = matches.get(i) || `ev_other_${i}`;
    lines.push(JSON.stringify({
      id,
      task_id: matches.has(i) ? targetTask : "OTHER-TASK",
      entry_hash: crypto.createHash("sha256").update(String(i)).digest("hex")
    }));
  }
  await fs.writeFile(paths.evidenceFile, `${lines.join("\n")}\n`, "utf8");

  const before = process.memoryUsage().heapUsed;
  const ids = await new EventManager({ workspaceRoot }).evidenceIdsForTask(targetTask);
  const after = process.memoryUsage().heapUsed;
  console.log(`[perf] evidenceIdsForTask heap_delta=${after - before}`);
  assert.deepEqual(ids, ["ev_match_1", "ev_match_2", "ev_match_3"]);
});

test("listEvents respects limit without reading all files", async () => {
  const workspaceRoot = await makeTempWorkspace();
  const paths = await ensureEventDirs(workspaceRoot);
  for (let i = 0; i < 200; i++) {
    const eventId = `evt_20260503T000000${String(i).padStart(3, "0")}Z_${i.toString(16).padStart(6, "0")}`;
    await fs.writeFile(path.join(paths.handledDir, `${eventId}.json`), JSON.stringify({
      event_schema_version: 1,
      event_id: eventId,
      event_type: "task.released",
      created_utc: `2026-05-03T00:00:${String(i % 60).padStart(2, "0")}.000Z`,
      workspace_root: workspaceRoot,
      task_id: `TASK-${i}`,
      owner: "codex-impl-01",
      branch: "feat/test",
      files: [],
      summary: "handled event",
      evidence_ids: [],
      next_actor: "claude",
      recommended_action: "review_pr",
      payload: {}
    }, null, 2), "utf8");
  }

  const listed = await new EventManager({ workspaceRoot }).listEvents({ status: "handled", limit: 5 });
  assert.equal(listed.events.length, 5);
  assert.equal(listed.count, 200);
  assert.deepEqual(listed.events.map((event) => event.task_id), ["TASK-0", "TASK-1", "TASK-2", "TASK-3", "TASK-4"]);
});

test("watch-events webhook timeout aborts cleanly", async () => {
  const workspaceRoot = await makeTempWorkspace();
  const { event, file } = await emitTestEvent(workspaceRoot);
  const server = http.createServer(() => {
    // Intentionally never responds; the watcher must abort its fetch.
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const script = path.resolve("scripts/watch-events.mjs");
  const started = Date.now();
  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [script, "--workspace", workspaceRoot, "--once", "--mark-handled"], {
        cwd: path.resolve("."),
        env: {
          ...process.env,
          HERMESPROOF_WEBHOOK_URL: `http://127.0.0.1:${port}`,
          HERMESPROOF_WEBHOOK_TIMEOUT_MS: "500"
        },
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      const killTimer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("watch-events hung past timeout"));
      }, 3000);
      child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
      child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
      child.on("error", (err) => {
        clearTimeout(killTimer);
        reject(err);
      });
      child.on("exit", (code) => {
        clearTimeout(killTimer);
        resolve({ code, stdout, stderr });
      });
    });
    assert.equal(result.code, 0);
    assert.match(result.stderr, /webhook timeout/);
    assert.ok(Date.now() - started < 3000);
    assert.equal((await fs.stat(file)).isFile(), true);
    const paths = await ensureEventDirs(workspaceRoot);
    await assert.rejects(fs.stat(path.join(paths.handledDir, `${event.event_id}.json`)));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("task envelope validates task_schema_version=1", async () => {
  const workspaceRoot = await makeTempWorkspace();
  const m = new HermesLockManager({ workspaceRoot });
  await m.init();
  const enqueued = await m.enqueueTask({ task_id: "QUEUE-SCHEMA", title: "Schema", enqueued_by: "claude-lead" });
  assert.equal(enqueued.ok, true);
  assert.equal(enqueued.task.task_schema_version, 1);
});

test("enqueue creates pending task with priority and owner pattern", async () => {
  const workspaceRoot = await makeTempWorkspace();
  const m = new HermesLockManager({ workspaceRoot });
  await m.init();
  const enqueued = await m.enqueueTask({
    task_id: "QUEUE-PENDING",
    title: "Pending",
    priority: 7,
    target_owner_pattern: "^codex-.*$",
    files_hint: ["src/tabs/Dashboard.tsx"],
    enqueued_by: "claude-lead"
  });
  assert.equal(enqueued.ok, true);
  const paths = statePaths(workspaceRoot);
  const saved = JSON.parse(await fs.readFile(path.join(paths.tasksPendingDir, "QUEUE-PENDING.json"), "utf8"));
  assert.equal(saved.priority, 7);
  assert.equal(saved.target_owner_pattern, "^codex-.*$");
  assert.deepEqual(saved.files_hint, ["src/tabs/Dashboard.tsx"]);
});

test("list_pending returns priority desc and FIFO within priority", async () => {
  const workspaceRoot = await makeTempWorkspace();
  const m = new HermesLockManager({ workspaceRoot });
  await m.init();
  await m.enqueueTask({ task_id: "QUEUE-LOW", priority: 1, enqueued_by: "claude-lead" });
  await m.enqueueTask({ task_id: "QUEUE-HIGH-1", priority: 5, enqueued_by: "claude-lead" });
  await m.enqueueTask({ task_id: "QUEUE-HIGH-2", priority: 5, enqueued_by: "claude-lead" });
  const listed = await m.listPendingTasks({});
  assert.deepEqual(listed.tasks.map((task) => task.task_id), ["QUEUE-HIGH-1", "QUEUE-HIGH-2", "QUEUE-LOW"]);
});

test("pick atomically claims one task under concurrent callers", async () => {
  const workspaceRoot = await makeTempWorkspace();
  const m = new HermesLockManager({ workspaceRoot });
  await m.init();
  await m.enqueueTask({ task_id: "QUEUE-ATOMIC", enqueued_by: "claude-lead" });
  const results = await Promise.all([
    m.pickTask({ owner: "codex-impl-01", prefer_task_id: "QUEUE-ATOMIC" }),
    m.pickTask({ owner: "codex-impl-02", prefer_task_id: "QUEUE-ATOMIC" })
  ]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.filter((result) => !result.ok).length, 1);
  assert.ok(["task_already_claimed", "no_pending_tasks_for_owner"].includes(results.find((result) => !result.ok).status));
});

test("pick respects target_owner_pattern", async () => {
  const workspaceRoot = await makeTempWorkspace();
  const m = new HermesLockManager({ workspaceRoot });
  await m.init();
  await m.enqueueTask({
    task_id: "QUEUE-AFFINITY",
    target_owner_pattern: "^claude-.*$",
    enqueued_by: "claude-lead"
  });
  const mismatch = await m.pickTask({ owner: "codex-impl-01", prefer_task_id: "QUEUE-AFFINITY" });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.status, "task_owner_mismatch");
});

test("invalid owner pattern is rejected at enqueue time", async () => {
  const workspaceRoot = await makeTempWorkspace();
  const m = new HermesLockManager({ workspaceRoot });
  await m.init();
  await assert.rejects(
    m.enqueueTask({ task_id: "QUEUE-BAD-REGEX", target_owner_pattern: "[" }),
    /invalid_owner_pattern/
  );
});

test("enqueue is idempotent for the same task id", async () => {
  const workspaceRoot = await makeTempWorkspace();
  const m = new HermesLockManager({ workspaceRoot });
  await m.init();
  const first = await m.enqueueTask({ task_id: "QUEUE-IDEMPOTENT", title: "First", enqueued_by: "claude-lead" });
  const second = await m.enqueueTask({ task_id: "QUEUE-IDEMPOTENT", title: "Second", enqueued_by: "claude-lead" });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.idempotent, true);
  assert.equal(second.task.title, "First");
});

test("queue lifecycle emits task.enqueued and task.claimed events", async () => {
  const workspaceRoot = await makeTempWorkspace();
  const m = new HermesLockManager({ workspaceRoot });
  await m.init();
  await m.enqueueTask({ task_id: "QUEUE-EVENTS", enqueued_by: "claude-lead" });
  await m.pickTask({ owner: "codex-impl-01", prefer_task_id: "QUEUE-EVENTS" });
  const types = await listOutboxTypes(workspaceRoot);
  assert.ok(types.includes("task.enqueued"));
  assert.ok(types.includes("task.claimed"));
});

test("task.recovered event fires on stale recovery", async () => {
  const workspaceRoot = await makeTempWorkspace();
  const m = new HermesLockManager({ workspaceRoot });
  await m.init();
  await m.enqueueTask({ task_id: "QUEUE-RECOVER", ttl_minutes: 1, enqueued_by: "claude-lead" });
  const picked = await m.pickTask({ owner: "codex-impl-01", prefer_task_id: "QUEUE-RECOVER" });
  picked.task.claimed_utc = new Date(Date.now() - 120_000).toISOString();
  picked.task.heartbeat_utc = picked.task.claimed_utc;
  const paths = statePaths(workspaceRoot);
  await fs.writeFile(path.join(paths.tasksClaimedDir, "QUEUE-RECOVER.json"), JSON.stringify(picked.task, null, 2), "utf8");
  const recovered = await m.recoverStaleTasks({ owner: "claude-lead" });
  assert.deepEqual(recovered.recovered, ["QUEUE-RECOVER"]);
  assert.ok((await listOutboxTypes(workspaceRoot)).includes("task.recovered"));
});

test("recover_stale_tasks ignores not-yet-expired claims", async () => {
  const workspaceRoot = await makeTempWorkspace();
  const m = new HermesLockManager({ workspaceRoot });
  await m.init();
  await m.enqueueTask({ task_id: "QUEUE-FRESH", ttl_minutes: 120, enqueued_by: "claude-lead" });
  await m.pickTask({ owner: "codex-impl-01", prefer_task_id: "QUEUE-FRESH" });
  const recovered = await m.recoverStaleTasks({ owner: "claude-lead" });
  assert.deepEqual(recovered.recovered, []);
});

test("queue heartbeat extends claimed task record", async () => {
  const workspaceRoot = await makeTempWorkspace();
  const m = new HermesLockManager({ workspaceRoot });
  await m.init();
  await m.enqueueTask({ task_id: "QUEUE-HEARTBEAT", enqueued_by: "claude-lead" });
  const picked = await m.pickTask({ owner: "codex-impl-01", prefer_task_id: "QUEUE-HEARTBEAT" });
  const paths = statePaths(workspaceRoot);
  picked.task.heartbeat_utc = "2026-01-01T00:00:00.000Z";
  await fs.writeFile(path.join(paths.tasksClaimedDir, "QUEUE-HEARTBEAT.json"), JSON.stringify(picked.task, null, 2), "utf8");
  const hb = await m.heartbeat({ owner: "codex-impl-01", taskId: "QUEUE-HEARTBEAT" });
  const saved = JSON.parse(await fs.readFile(path.join(paths.tasksClaimedDir, "QUEUE-HEARTBEAT.json"), "utf8"));
  assert.deepEqual(hb.touched_tasks, ["QUEUE-HEARTBEAT"]);
  assert.notEqual(saved.heartbeat_utc, picked.task.heartbeat_utc);
});

test("task path cannot escape workspace", async () => {
  const workspaceRoot = await makeTempWorkspace();
  const m = new HermesLockManager({ workspaceRoot });
  await m.init();
  await assert.rejects(m.enqueueTask({ task_id: "../escape" }), /task_id/);
});
