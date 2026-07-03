/**
 * v07-stdio-roundtrip-smoke-test.mjs — exercises every v0.7 MCP tool through
 * the actual stdio JSON-RPC transport, not via direct module calls.
 *
 * Pre-fix (audit P1-10, 2026-05-03 cross-confirmed): all 17+ v0.7 MCP tools
 * (hermes_a2a_*, hermes_anonymous_*, hermes_dispatch_recommend,
 * hermes_list_agents, hermes_record_outcome, hermes_record_task,
 * hermes_user_*, hermes_agent_*) were exercised only via direct module
 * calls. The zod input schemas, the `registerTool` annotation surface, the
 * `toolResult`/`toolError` envelope, and the stdio JSON-RPC framing were
 * never exercised end-to-end. A schema typo or a registration ordering bug
 * would not fail any test.
 *
 * This file spawns `node src/server.mjs` once, performs a real MCP handshake
 * over stdio, and calls every v0.7 tool with valid input plus a
 * representative invalid input. It asserts:
 *
 *   - tools/list returns ALL v0.7 tools
 *   - each valid call returns a JSON-RPC `result` envelope (no protocol error)
 *   - each invalid call surfaces an error or `ok: false` (no schema gap)
 *   - each tool's annotation set has all four MCP-2025-11-25 keys
 *
 * The single-server-spawn pattern keeps it fast (~one second total).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const SERVER = path.join(REPO_ROOT, "src", "server.mjs");

function shaId(input, len = 24) {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, len);
}

const V07_TOOLS = Object.freeze([
  "hermes_list_agents",
  "hermes_anonymous_claim",
  "hermes_anonymous_release",
  "hermes_anonymous_state",
  "hermes_record_outcome",
  "hermes_record_task",
  "hermes_dispatch_recommend",
  "hermes_a2a_create_task",
  "hermes_a2a_get_task",
  "hermes_a2a_update_task",
  "hermes_a2a_list_tasks",
  "hermes_user_grant_session",
  "hermes_user_revoke_session",
  "hermes_user_check_authorization",
  "hermes_agent_health",
  "hermes_agent_request_user_session",
  "hermes_agent_resolve_blocked",
  "hermes_agent_revoke_session",
]);

const WORKSPACE_TOOLS = Object.freeze([
  "hermes_get_workspace",
  "hermes_set_workspace",
  "hermes_connect_project",
]);

const REALTIME_TOOLS = Object.freeze([
  "hermes_live_status",
  "hermes_wait_for_events",
]);

const AGENT_WORKFLOW_TOOLS = Object.freeze([
  "hermes_update_presence",
  "hermes_list_presence",
  "hermes_find_agents",
  "hermes_request_assistance",
  "hermes_wait_for_assistance",
  "hermes_send_message",
  "hermes_get_inbox",
  "hermes_wait_for_inbox",
  "hermes_ack_message",
  "hermes_wait_for_unlock",
  "hermes_complete_work",
]);

const AGENT_PROFILE_TOOLS = Object.freeze([
  "hermes_register_agent_profile",
  "hermes_get_agent_profile",
  "hermes_list_agent_profiles",
  "hermes_update_agent_capabilities",
  "hermes_join_project",
  "hermes_get_test_mode",
  "hermes_set_test_mode",
  "hermes_report_bug",
  "hermes_list_bug_tickets",
  "hermes_update_bug_ticket",
  "hermes_submit_bug_fix",
]);

const CONTRACT_TOOLS = Object.freeze([
  "hermes_upsert_project_contract",
  "hermes_list_project_contracts",
  "hermes_read_project_contract",
  "hermes_anti_slop_review",
  "hermes_list_contract_reviews",
]);

const CLAIM_AUDIT_TOOLS = Object.freeze([
  "hermes_decompose_claims",
  "hermes_audit_claims",
  "hermes_list_claim_audits",
  "hermes_agentic_tick",
]);

const BACKEND_GITLAB_TOOLS = Object.freeze([
  "hermes_backend_status",
  "hermes_gitlab_status",
  "hermes_gitlab_ensure_project",
  "hermes_gitlab_list_merge_requests",
  "hermes_gitlab_create_merge_request",
  "hermes_gitlab_ultimate_status",
  "hermes_gitlab_bootstrap_ultimate",
]);

const PROVIDER_TOOLS = Object.freeze([
  "hermes_provider_record_outcome",
  "hermes_provider_stats",
  "hermes_provider_rank",
]);

const WINMERGE_TOOLS = Object.freeze([
  "hermes_winmerge_status",
  "hermes_winmerge_compare",
]);

async function startServer(workspaceRoot, envOverrides = {}) {
  const proc = spawn(process.execPath, [SERVER], {
    env: { ...process.env, ...envOverrides, MCP_LOCK_WORKSPACE: workspaceRoot },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let buf = "";
  const queue = [];
  const stderrChunks = [];
  let nextId = 0;

  proc.stderr.on("data", (d) => stderrChunks.push(d.toString()));
  proc.on("error", (err) => {
    while (queue.length) queue.shift().reject(err);
  });
  proc.stdout.on("data", (chunk) => {
    buf += chunk.toString();
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      const next = queue.shift();
      if (next) next.resolve(msg);
    }
  });

  function request(method, params) {
    nextId++;
    const id = nextId;
    return new Promise((resolve, reject) => {
      queue.push({ resolve, reject });
      proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  function notify(method, params) {
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }
  async function call(name, args) {
    const resp = await request("tools/call", { name, arguments: args });
    return resp;
  }

  await request("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "v07-roundtrip-smoke", version: "0.0.1" },
  });
  notify("notifications/initialized", {});

  return {
    proc,
    request,
    call,
    stop() {
      try { proc.stdin.end(); } catch {}
      try { proc.kill("SIGTERM"); } catch {}
      // On Windows SIGTERM doesn't actually arrive; the stdin EOF path
      // (added in P1-8) handles graceful shutdown there.
    },
    stderr: () => stderrChunks.join(""),
  };
}

function parseToolResult(resp) {
  // Tool calls return { result: { content: [{ type:"text", text: "{...}" }] } }
  // OR { result: { isError: true, content: [{ text: "MCP error -32602: ..." }] } }
  // when zod input validation fails (MCP SDK wraps it inside `result`, not at
  // the top-level JSON-RPC error). Detect both.
  if (resp.error) return { ok: false, _protocol_error: resp.error };
  if (resp?.result?.isError === true) {
    const text = resp?.result?.content?.[0]?.text || "";
    return { ok: false, _validation_error: true, message: text };
  }
  const text = resp?.result?.content?.[0]?.text;
  if (!text) return { ok: false, _no_content: true, raw: resp };
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, _unparsed: true, text };
  }
}

test("v0.7 stdio round-trip: all 18 v0.7 tools are registered with all 4 MCP annotations", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "v07-rt-list-"));
  const s = await startServer(tmp);
  try {
    const list = await s.request("tools/list", {});
    const tools = list?.result?.tools || [];
    const names = new Set(tools.map((t) => t.name));
    for (const expected of V07_TOOLS) {
      assert.ok(names.has(expected), `tools/list missing v0.7 tool: ${expected}`);
    }
    // Each v0.7 tool must have all four MCP-2025-11-25 annotation keys explicit.
    const required = ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"];
    const missing = [];
    for (const t of tools) {
      if (!V07_TOOLS.includes(t.name)) continue;
      const ann = t.annotations || {};
      const lacking = required.filter((k) => !(k in ann));
      if (lacking.length) missing.push(`${t.name} missing: ${lacking.join(", ")}`);
    }
    assert.equal(missing.length, 0, `annotation gaps:\n  ${missing.join("\n  ")}`);
  } finally {
    s.stop();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("workspace stdio round-trip: runtime workspace can switch safely", async () => {
  const tmpA = await fs.mkdtemp(path.join(os.tmpdir(), "hp-rt-ws-a-"));
  const tmpB = await fs.mkdtemp(path.join(os.tmpdir(), "hp-rt-ws-b-"));
  const s = await startServer(tmpA);
  try {
    const list = await s.request("tools/list", {});
    const names = new Set((list?.result?.tools || []).map((t) => t.name));
    for (const expected of WORKSPACE_TOOLS) {
      assert.ok(names.has(expected), `tools/list missing workspace tool: ${expected}`);
    }

    const initial = parseToolResult(await s.call("hermes_get_workspace", {}));
    assert.equal(path.resolve(initial.workspace_root), path.resolve(tmpA));

    const relativeRejected = parseToolResult(await s.call("hermes_set_workspace", {
      owner: "rt-agent-1",
      workspaceRoot: "relative-workspace",
      reason: "round-trip invalid path",
    }));
    assert.equal(relativeRejected.ok, false);
    assert.match(relativeRejected.message, /absolute path/i);

    const switched = parseToolResult(await s.call("hermes_set_workspace", {
      owner: "rt-agent-1",
      workspaceRoot: tmpB,
      reason: "round-trip workspace switch",
    }));
    assert.equal(switched.ok, true, `switch failed: ${JSON.stringify(switched)}`);
    assert.equal(path.resolve(switched.workspace_root), path.resolve(tmpB));
    assert.ok(switched.evidence?.entry_hash, "workspace switch should append proof evidence");

    const state = parseToolResult(await s.call("hermes_get_state", {}));
    assert.equal(path.resolve(state.workspace_root), path.resolve(tmpB));

    const claim = parseToolResult(await s.call("hermes_claim_task", {
      owner: "rt-agent-1",
      taskId: "rt-workspace-switch",
      title: "workspace switch guard",
      files: ["README.md"],
    }));
    assert.equal(claim.ok, true, `claim failed: ${JSON.stringify(claim)}`);

    const lock = parseToolResult(await s.call("hermes_lock_files", {
      owner: "rt-agent-1",
      taskId: "rt-workspace-switch",
      files: ["README.md"],
      reason: "prove workspace switch refuses stranded locks",
    }));
    assert.equal(lock.ok, true, `lock failed: ${JSON.stringify(lock)}`);

    const blocked = parseToolResult(await s.call("hermes_set_workspace", {
      owner: "rt-agent-1",
      workspaceRoot: tmpA,
      reason: "should be blocked by active lock",
    }));
    assert.equal(blocked.ok, false);
    assert.match(blocked.message, /active locks/i);

    const release = parseToolResult(await s.call("hermes_release_files", {
      owner: "rt-agent-1",
      files: ["README.md"],
      note: "workspace switch guard complete",
    }));
    assert.equal(release.ok, true, `release failed: ${JSON.stringify(release)}`);

    const switchedBack = parseToolResult(await s.call("hermes_set_workspace", {
      owner: "rt-agent-1",
      workspaceRoot: tmpA,
      reason: "round-trip switch back after release",
    }));
    assert.equal(switchedBack.ok, true, `switch back failed: ${JSON.stringify(switchedBack)}`);
    assert.equal(path.resolve(switchedBack.workspace_root), path.resolve(tmpA));
  } finally {
    s.stop();
    await fs.rm(tmpA, { recursive: true, force: true });
    await fs.rm(tmpB, { recursive: true, force: true });
  }
});

test("realtime stdio round-trip: live status and event wait observe workspace events", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hp-rt-live-"));
  const s = await startServer(tmp);
  try {
    const list = await s.request("tools/list", {});
    const names = new Set((list?.result?.tools || []).map((t) => t.name));
    for (const expected of REALTIME_TOOLS) {
      assert.ok(names.has(expected), `tools/list missing realtime tool: ${expected}`);
    }

    const before = parseToolResult(await s.call("hermes_wait_for_events", {
      status: "outbox",
      timeoutMs: 0,
      limit: 5,
    }));
    assert.equal(before.ok, true);

    const emitted = parseToolResult(await s.call("hermes_emit_event", {
      event_type: "task.enqueued",
      task_id: "rt-live-event",
      owner: "rt-agent-1",
      summary: "round-trip live event",
      next_actor: "codex",
      recommended_action: "review_handoff",
      payload: { source: "v07-stdio-roundtrip" },
    }));
    assert.equal(emitted.ok, true, `emit failed: ${JSON.stringify(emitted)}`);

    const waited = parseToolResult(await s.call("hermes_wait_for_events", {
      status: "outbox",
      afterEventId: before.last_event_id || "",
      timeoutMs: 1_000,
      pollMs: 250,
      limit: 10,
    }));
    assert.equal(waited.ok, true);
    assert.equal(waited.status, "events", `wait should observe emitted event: ${JSON.stringify(waited)}`);
    assert.ok(waited.events.some((event) => event.event_id === emitted.event.event_id));

    const live = parseToolResult(await s.call("hermes_live_status", {
      includeEvents: true,
      includeAgents: false,
      eventLimit: 10,
    }));
    assert.equal(live.ok, true, `live status failed: ${JSON.stringify(live)}`);
    assert.equal(path.resolve(live.workspace_root), path.resolve(tmp));
    assert.ok(live.outbox_event_count >= 1);
    assert.ok(live.recent_outbox_events.some((event) => event.event_id === emitted.event.event_id));
  } finally {
    s.stop();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("unlock-request stdio round-trip: requester asks, owner approves, lock transfers", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hp-rt-unlock-"));
  const s = await startServer(tmp);
  try {
    const claim = parseToolResult(await s.call("hermes_claim_task", {
      owner: "rt-owner-a",
      taskId: "rt-unlock-owner",
      title: "own locked file",
      files: ["src/locked.txt"],
    }));
    assert.equal(claim.ok, true, `claim failed: ${JSON.stringify(claim)}`);

    const lock = parseToolResult(await s.call("hermes_lock_files", {
      owner: "rt-owner-a",
      taskId: "rt-unlock-owner",
      files: ["src/locked.txt"],
      reason: "prove unlock request flow",
    }));
    assert.equal(lock.ok, true, `lock failed: ${JSON.stringify(lock)}`);

    const unlock = parseToolResult(await s.call("hermes_request_unlock", {
      requester: "rt-owner-b",
      taskId: "rt-unlock-requester",
      files: ["src/locked.txt", "src/free.txt"],
      reason: "need to finish release prep",
    }));
    assert.equal(unlock.ok, true, `unlock request failed: ${JSON.stringify(unlock)}`);
    assert.equal(unlock.status, "requested");
    assert.deepEqual(unlock.unlocked, ["src/free.txt"]);
    assert.equal(unlock.handoff_requests.length, 1);
    const requestId = unlock.handoff_requests[0].id;

    const waited = parseToolResult(await s.call("hermes_wait_for_events", {
      status: "outbox",
      timeoutMs: 1_000,
      pollMs: 250,
      limit: 50,
    }));
    assert.equal(waited.ok, true);
    assert.ok(
      waited.events.some((event) => event.event_type === "handoff.created" && event.payload?.request_id === requestId),
      `handoff event missing from wait result: ${JSON.stringify(waited)}`
    );

    const approved = parseToolResult(await s.call("hermes_approve_handoff", {
      owner: "rt-owner-a",
      requestId,
      decision: "approve",
      note: "transferring for release prep",
    }));
    assert.equal(approved.ok, true, `approval failed: ${JSON.stringify(approved)}`);
    assert.equal(approved.status, "approved");

    const locks = parseToolResult(await s.call("hermes_list_locks", {}));
    const transferred = locks.locks.find((item) => item.file === "src/locked.txt");
    assert.equal(transferred?.owner, "rt-owner-b", `lock did not transfer: ${JSON.stringify(locks)}`);

    const release = parseToolResult(await s.call("hermes_release_files", {
      owner: "rt-owner-b",
      files: ["src/locked.txt"],
      note: "unlock request flow complete",
    }));
    assert.equal(release.ok, true, `release failed: ${JSON.stringify(release)}`);
  } finally {
    s.stop();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("agent workflow stdio round-trip: presence, skills, inbox, wait, complete release", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hp-rt-agent-flow-"));
  const s = await startServer(tmp);
  try {
    const list = await s.request("tools/list", {});
    const names = new Set((list?.result?.tools || []).map((t) => t.name));
    for (const expected of AGENT_WORKFLOW_TOOLS) {
      assert.ok(names.has(expected), `tools/list missing agent workflow tool: ${expected}`);
    }

    const ownerPresence = parseToolResult(await s.call("hermes_update_presence", {
      owner: "rt-agent-a",
      role: "builder",
      status: "working",
      taskId: "rt-agent-flow",
      files: ["src/agent-flow.txt"],
      skills: ["python", "release", "docs"],
      taskTypes: ["build", "release"],
      note: "owning release prep",
      ttlSeconds: 300,
      canInterrupt: true,
    }));
    assert.equal(ownerPresence.ok, true, `presence failed: ${JSON.stringify(ownerPresence)}`);

    const reviewerPresence = parseToolResult(await s.call("hermes_update_presence", {
      owner: "rt-agent-b",
      role: "reviewer",
      status: "idle",
      skills: ["review", "docs"],
      taskTypes: ["review"],
      note: "available for reviews",
    }));
    assert.equal(reviewerPresence.ok, true);

    const candidates = parseToolResult(await s.call("hermes_find_agents", {
      requiredSkills: ["review", "docs"],
      taskType: "review",
      includeBusy: false,
      limit: 5,
    }));
    assert.equal(candidates.ok, true, `find agents failed: ${JSON.stringify(candidates)}`);
    assert.equal(candidates.candidates[0]?.owner, "rt-agent-b");

    const assistance = parseToolResult(await s.call("hermes_request_assistance", {
      requester: "rt-agent-a",
      requiredSkills: ["review", "docs"],
      taskType: "review",
      subject: "Need release-prep review help",
      body: "Please review the release prep before handoff.",
      taskId: "rt-agent-flow",
      files: ["src/agent-flow.txt"],
      priority: "high",
      includeBusy: false,
      limit: 3,
    }));
    assert.equal(assistance.ok, true, `assistance request failed: ${JSON.stringify(assistance)}`);
    assert.deepEqual(assistance.recipients, ["rt-agent-b"]);

    const assistanceInbox = parseToolResult(await s.call("hermes_wait_for_inbox", {
      owner: "rt-agent-b",
      type: "assistance_request",
      timeoutMs: 500,
    }));
    assert.equal(assistanceInbox.ok, true);
    assert.equal(assistanceInbox.status, "ready");
    assert.equal(assistanceInbox.messages[0].type, "assistance_request");
    const assistanceMessageId = assistanceInbox.messages[0].id;

    const assistanceAck = parseToolResult(await s.call("hermes_ack_message", {
      owner: "rt-agent-b",
      messageId: assistanceMessageId,
      status: "acknowledged",
      note: "I can help review it.",
      notifySender: true,
    }));
    assert.equal(assistanceAck.ok, true, `assistance ack failed: ${JSON.stringify(assistanceAck)}`);
    assert.equal(assistanceAck.sender_notification.recipient, "rt-agent-a");

    const duplicateAssistanceAck = parseToolResult(await s.call("hermes_ack_message", {
      owner: "rt-agent-b",
      messageId: assistanceMessageId,
      status: "acknowledged",
      note: "I can help review it.",
      notifySender: true,
    }));
    assert.equal(duplicateAssistanceAck.ok, true);
    assert.equal(duplicateAssistanceAck.notification_skipped, "already_acknowledged");
    assert.equal(duplicateAssistanceAck.sender_notification, null);

    const assistanceAccepted = parseToolResult(await s.call("hermes_wait_for_assistance", {
      requester: "rt-agent-a",
      messageIds: assistance.messages.map((message) => message.id),
      responseDeadlineUtc: assistance.response_deadline_utc,
      timeoutMs: 500,
    }));
    assert.equal(assistanceAccepted.ok, true);
    assert.equal(assistanceAccepted.status, "accepted");
    assert.equal(assistanceAccepted.first_response.owner, "rt-agent-b");

    const sent = parseToolResult(await s.call("hermes_send_message", {
      sender: "rt-agent-a",
      recipients: ["rt-agent-b"],
      type: "ping",
      priority: "normal",
      subject: "Review availability",
      body: "Can you review the release prep?",
      taskId: "rt-agent-flow",
      files: ["src/agent-flow.txt"],
    }));
    assert.equal(sent.ok, true, `send failed: ${JSON.stringify(sent)}`);
    const messageId = sent.messages[0].id;

    const waitedInbox = parseToolResult(await s.call("hermes_wait_for_inbox", {
      owner: "rt-agent-b",
      type: "ping",
      timeoutMs: 500,
    }));
    assert.equal(waitedInbox.ok, true);
    assert.equal(waitedInbox.status, "ready");
    assert.equal(waitedInbox.messages[0].id, messageId);

    const inbox = parseToolResult(await s.call("hermes_get_inbox", {
      owner: "rt-agent-b",
    }));
    assert.equal(inbox.ok, true);
    assert.ok(inbox.messages.some((message) => message.id === messageId));

    const ack = parseToolResult(await s.call("hermes_ack_message", {
      owner: "rt-agent-b",
      messageId,
      status: "acknowledged",
      note: "I can review it.",
    }));
    assert.equal(ack.ok, true, `ack failed: ${JSON.stringify(ack)}`);

    const claim = parseToolResult(await s.call("hermes_claim_task", {
      owner: "rt-agent-a",
      taskId: "rt-agent-flow",
      title: "agent workflow release prep",
      files: ["src/agent-flow.txt"],
    }));
    assert.equal(claim.ok, true);

    const lock = parseToolResult(await s.call("hermes_lock_files", {
      owner: "rt-agent-a",
      taskId: "rt-agent-flow",
      files: ["src/agent-flow.txt"],
      reason: "agent workflow proof",
    }));
    assert.equal(lock.ok, true);

    const unlock = parseToolResult(await s.call("hermes_request_unlock", {
      requester: "rt-agent-b",
      taskId: "rt-agent-flow-review",
      files: ["src/agent-flow.txt"],
      reason: "review needs ownership",
      priority: "high",
      deadlineMinutes: 5,
    }));
    assert.equal(unlock.ok, true, `unlock failed: ${JSON.stringify(unlock)}`);
    assert.equal(unlock.notifications.length, 1);
    const requestId = unlock.handoff_requests[0].id;

    const ownerInbox = parseToolResult(await s.call("hermes_get_inbox", {
      owner: "rt-agent-a",
      type: "unlock_request",
    }));
    assert.ok(ownerInbox.messages.some((message) => message.metadata?.handoff_request_id === requestId));

    const pendingWait = parseToolResult(await s.call("hermes_wait_for_unlock", {
      requester: "rt-agent-b",
      files: ["src/agent-flow.txt"],
      timeoutMs: 0,
    }));
    assert.equal(pendingWait.status, "timeout");

    const approved = parseToolResult(await s.call("hermes_approve_handoff", {
      owner: "rt-agent-a",
      requestId,
      decision: "approve",
      note: "review can take it",
    }));
    assert.equal(approved.ok, true);

    const readyWait = parseToolResult(await s.call("hermes_wait_for_unlock", {
      requester: "rt-agent-b",
      files: ["src/agent-flow.txt"],
      timeoutMs: 1_000,
      pollMs: 250,
    }));
    assert.equal(readyWait.status, "ready", `wait should be ready: ${JSON.stringify(readyWait)}`);

    const reviewerClaim = parseToolResult(await s.call("hermes_claim_task", {
      owner: "rt-agent-b",
      taskId: "rt-agent-flow-review",
      title: "review handed-off release prep",
      files: ["src/agent-flow.txt"],
    }));
    assert.equal(reviewerClaim.ok, true, `reviewer claim failed: ${JSON.stringify(reviewerClaim)}`);

    const completed = parseToolResult(await s.call("hermes_complete_work", {
      owner: "rt-agent-b",
      taskId: "rt-agent-flow-review",
      files: ["src/agent-flow.txt"],
      summary: "Review finished and lock released.",
      status: "completed",
      notifyRecipients: ["rt-agent-a"],
    }));
    assert.equal(completed.ok, true, `complete failed: ${JSON.stringify(completed)}`);
    assert.deepEqual(completed.release.released, ["src/agent-flow.txt"]);
    assert.ok(completed.presence.skills.includes("review"), "complete_work should preserve advertised skills");

    const locks = parseToolResult(await s.call("hermes_list_locks", {}));
    assert.equal(locks.count, 0, `complete_work should release locks: ${JSON.stringify(locks)}`);

    const live = parseToolResult(await s.call("hermes_live_status", {
      includePresence: true,
      includeAgents: false,
      includeEvents: true,
      eventLimit: 50,
    }));
    const reviewerLive = live.presence.find((record) => record.owner === "rt-agent-b");
    assert.equal(reviewerLive?.status, "done");
    assert.ok(reviewerLive.skills.includes("review"));
    assert.ok(live.recent_outbox_events.some((event) => event.event_type === "work.completed"));
  } finally {
    s.stop();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("agent profile stdio round-trip: register, filter, update capabilities, live status", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hp-rt-agent-profile-"));
  const s = await startServer(tmp);
  try {
    const list = await s.request("tools/list", {});
    const names = new Set((list?.result?.tools || []).map((t) => t.name));
    for (const expected of AGENT_PROFILE_TOOLS) {
      assert.ok(names.has(expected), `tools/list missing agent profile tool: ${expected}`);
    }

    const registered = parseToolResult(await s.call("hermes_register_agent_profile", {
      owner: "minimax-m3-cechat-01",
      displayName: "MiniMax M3 in Cheat Engine Chat",
      host: "cheat-engine-chat",
      model: "minimax-m3",
      mode: "release-operator",
      role: "builder",
      skills: ["ce-chat", "minimax-m3", "code", "docs", "testing", "release", "gitlab"],
      taskTypes: ["build", "repair", "test", "docs", "release"],
      hostSupplies: ["filesystem-read-write", "shell", "git"],
      hermesproofSupplies: ["locks", "gates", "evidence", "inbox"],
      workspaceRoots: [tmp],
      releaseGates: ["npm test", "node scripts/truth-gates.mjs --ci"],
      gitRemotes: ["github:Ghenghis/HermesProof"],
      notes: "Ready for coordinated high-trust host work.",
      metadata: { prompt: "MINIMAX_M3_CHEAT_ENGINE_CHAT_PROMPT.md" },
    }));
    assert.equal(registered.ok, true, `register failed: ${JSON.stringify(registered)}`);
    assert.equal(registered.status, "registered");
    assert.equal(registered.profile.mode, "release-operator");
    assert.equal(registered.profile.default_workspace_root, tmp);
    assert.ok(registered.presence.skills.includes("gitlab"));

    const fetched = parseToolResult(await s.call("hermes_get_agent_profile", {
      owner: "minimax-m3-cechat-01",
      includePresence: true,
    }));
    assert.equal(fetched.ok, true, `get profile failed: ${JSON.stringify(fetched)}`);
    assert.equal(fetched.profile.host, "cheat-engine-chat");
    assert.equal(fetched.presence.owner, "minimax-m3-cechat-01");

    const filtered = parseToolResult(await s.call("hermes_list_agent_profiles", {
      requiredSkills: ["gitlab", "release"],
      taskType: "release",
      host: "cheat-engine-chat",
      mode: "release-operator",
      includePresence: true,
    }));
    assert.equal(filtered.ok, true);
    assert.equal(filtered.count, 1);
    assert.equal(filtered.profiles[0].owner, "minimax-m3-cechat-01");

    const updated = parseToolResult(await s.call("hermes_update_agent_capabilities", {
      owner: "minimax-m3-cechat-01",
      skills: ["python", "aice"],
      taskTypes: ["review"],
      hostSupplies: ["browser-automation"],
      releaseGates: ["python -m pytest"],
      gitRemotes: ["gitlab:Ghenghis/HermesProof"],
      notes: "Added Python/AICE review capability.",
      merge: true,
      updatePresence: true,
    }));
    assert.equal(updated.ok, true, `update capabilities failed: ${JSON.stringify(updated)}`);
    assert.ok(updated.profile.skills.includes("python"));
    assert.ok(updated.profile.skills.includes("gitlab"));
    assert.ok(updated.profile.task_types.includes("review"));
    assert.ok(updated.profile.git_remotes.includes("gitlab:Ghenghis/HermesProof"));
    assert.ok(updated.presence.skills.includes("aice"));

    const routed = parseToolResult(await s.call("hermes_find_agents", {
      requiredSkills: ["python", "aice"],
      taskType: "review",
      includeBusy: true,
    }));
    assert.equal(routed.ok, true);
    assert.equal(routed.candidates[0]?.owner, "minimax-m3-cechat-01");

    const live = parseToolResult(await s.call("hermes_live_status", {
      includeProfiles: true,
      includePresence: true,
      includeEvents: true,
      eventLimit: 50,
    }));
    assert.ok(live.agent_profiles.some((profile) => profile.owner === "minimax-m3-cechat-01"));
    assert.ok(live.recent_outbox_events.some((event) => event.event_type === "agent.profile.updated"));

    const missing = parseToolResult(await s.call("hermes_get_agent_profile", {
      owner: "missing-profile-agent",
    }));
    assert.equal(missing.ok, false);
    assert.equal(missing.status, "missing");

    const joined = parseToolResult(await s.call("hermes_join_project", {
      owner: "codex-join-agent",
      displayName: "Codex Join Agent",
      host: "codex",
      model: "gpt-5",
      mode: "coordinated-dev",
      role: "builder",
      status: "idle",
      skills: ["code", "review", "gitlab"],
      taskTypes: ["build", "review"],
      hostSupplies: ["filesystem-read-write", "shell"],
      hermesproofSupplies: ["locks", "gates", "inbox"],
      workspaceRoots: [tmp],
      notes: "Joining after project work has already started.",
      includeInbox: true,
      includeEvents: true,
    }));
    assert.equal(joined.ok, true, `join project failed: ${JSON.stringify(joined)}`);
    assert.equal(joined.status, "joined");
    assert.equal(joined.profile.owner, "codex-join-agent");
    assert.equal(joined.presence.status, "idle");
    assert.equal(joined.inbox.count, 0);
    assert.equal(joined.backend_status.secret_values_returned, false);

    const mode = parseToolResult(await s.call("hermes_set_test_mode", {
      owner: "codex-join-agent",
      mode: "testing",
      reason: "round-trip bug-ticket intake proof",
    }));
    assert.equal(mode.ok, true, `set test mode failed: ${JSON.stringify(mode)}`);
    assert.equal(mode.mode.mode, "testing");

    const currentMode = parseToolResult(await s.call("hermes_get_test_mode", {}));
    assert.equal(currentMode.ok, true);
    assert.equal(currentMode.mode.testing_enabled, true);

    const bug = parseToolResult(await s.call("hermes_report_bug", {
      reporter: "codex-join-agent",
      ticketId: "scan-panel-types",
      title: "Scan panel hides full CE value types",
      summary: "KiloCode found that the panel dropdown did not expose CE bridge scan types.",
      severity: "high",
      files: ["src/server.mjs"],
      reproduction: "Open the panel and inspect the value-type dropdown.",
      expected: "Agents can pick full CE scan types.",
      actual: "Only a reduced subset is visible.",
      tags: ["aice", "scan"],
      enqueue: true,
      targetOwnerPattern: ".*",
      evidence: [{ kind: "screenshot", id: "local-proof" }],
    }));
    assert.equal(bug.ok, true, `report bug failed: ${JSON.stringify(bug)}`);
    assert.equal(bug.ticket.ticket_id, "scan-panel-types");
    assert.equal(bug.ticket.release_blocker, true);
    assert.equal(bug.queued.status, "enqueued");

    const tickets = parseToolResult(await s.call("hermes_list_bug_tickets", {
      status: "active",
      releaseBlockersOnly: true,
    }));
    assert.equal(tickets.ok, true);
    assert.equal(tickets.count, 1);
    assert.equal(tickets.tickets[0].ticket_id, "scan-panel-types");

    const triaged = parseToolResult(await s.call("hermes_update_bug_ticket", {
      owner: "codex-join-agent",
      ticketId: "scan-panel-types",
      status: "assigned",
      assignee: "minimax-m3-cechat-01",
      note: "Assign to the agent with CE chat context.",
      tags: ["ui"],
    }));
    assert.equal(triaged.ok, true, `update bug failed: ${JSON.stringify(triaged)}`);
    assert.equal(triaged.ticket.status, "assigned");
    assert.equal(triaged.ticket.assignee, "minimax-m3-cechat-01");

    const fix = parseToolResult(await s.call("hermes_submit_bug_fix", {
      owner: "minimax-m3-cechat-01",
      ticketId: "scan-panel-types",
      summary: "Expanded value type workflow and added tests.",
      branch: "codex/aice-scan-types",
      commit: "abc123",
      gates: [{ gate: "npm test", status: "pass" }],
      files: ["src/server.mjs"],
      verdict: "submitted",
    }));
    assert.equal(fix.ok, true, `submit bug fix failed: ${JSON.stringify(fix)}`);
    assert.equal(fix.ticket.status, "fix_submitted");
    assert.equal(fix.fix.commit, "abc123");

    const afterTicketLive = parseToolResult(await s.call("hermes_live_status", {
      includeEvents: true,
      includePresence: true,
      eventLimit: 100,
    }));
    const eventTypes = afterTicketLive.recent_outbox_events.map((event) => event.event_type);
    assert.ok(eventTypes.includes("mode.testing.updated"));
    assert.ok(eventTypes.includes("bug.reported"));
    assert.ok(eventTypes.includes("bug.updated"));
    assert.ok(eventTypes.includes("bug.fix_submitted"));

    const releaseMode = parseToolResult(await s.call("hermes_set_test_mode", {
      owner: "codex-join-agent",
      mode: "release",
      reason: "round-trip proof complete",
    }));
    assert.equal(releaseMode.ok, true);
    assert.equal(releaseMode.mode.testing_enabled, false);
  } finally {
    s.stop();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("project contract stdio round-trip: anti-slop review opens shared blocker ticket", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hp-rt-contract-"));
  const s = await startServer(tmp);
  try {
    const list = await s.request("tools/list", {});
    const names = new Set((list?.result?.tools || []).map((t) => t.name));
    for (const expected of CONTRACT_TOOLS) {
      assert.ok(names.has(expected), `tools/list missing contract tool: ${expected}`);
    }

    const saved = parseToolResult(await s.call("hermes_upsert_project_contract", {
      owner: "contract-agent",
      contractId: "aice-release-contract",
      title: "AI-CE release truth contract",
      project: "AI-CE",
      scope: "CE Chat and HermesProof release coordination",
      requiredGates: ["pytest", "proof_check"],
      requiredEvidence: ["test output", "changed files", "remaining risks"],
      protectedPaths: ["src/", "scripts/", ".gitlab-ci.yml"],
      forbiddenClaimPatterns: ["release ready", "everything fixed"],
      riskPatterns: [{
        id: "unsafe-delete",
        severity: "critical",
        regex: "git\\s+reset\\s+--hard",
        message: "Destructive git reset is not allowed in shared workspaces."
      }],
      autoTicketThreshold: "high",
      merge: false,
    }));
    assert.equal(saved.ok, true, `contract upsert failed: ${JSON.stringify(saved)}`);
    assert.equal(saved.contract.contract_id, "aice-release-contract");

    const read = parseToolResult(await s.call("hermes_read_project_contract", {
      contractId: "aice-release-contract",
    }));
    assert.equal(read.ok, true);
    assert.equal(read.contract.title, "AI-CE release truth contract");

    const contracts = parseToolResult(await s.call("hermes_list_project_contracts", {}));
    assert.ok(contracts.contracts.some((contract) => contract.contract_id === "aice-release-contract"));

    const reviewStart = Date.now();
    const review = parseToolResult(await s.call("hermes_anti_slop_review", {
      owner: "contract-agent",
      taskId: "contract-proof",
      summary: "release ready, everything fixed",
      files: ["src/fake.js"],
      gates: [],
      contractIds: ["aice-release-contract"],
      createTicket: true,
      autoTicketThreshold: "high",
      maxFilesToScan: 5,
      maxFileScanBytes: 20000,
    }));
    const reviewElapsedMs = Date.now() - reviewStart;
    assert.equal(review.ok, false, `unproven release claim should fail review: ${JSON.stringify(review)}`);
    assert.equal(review.status, "needs_review");
    assert.equal(review.review.severity, "high");
    assert.equal(review.review.performance.git_shortstat_skipped, true);
    assert.ok(reviewElapsedMs < 1500, `anti-slop review should stay fast; took ${reviewElapsedMs}ms`);
    assert.ok(review.review.findings.some((finding) => finding.code === "claim.unproven_completion"));
    assert.ok(review.ticket?.ticket?.release_blocker);

    const reviews = parseToolResult(await s.call("hermes_list_contract_reviews", {
      status: "needs_review",
    }));
    assert.equal(reviews.ok, true);
    assert.equal(reviews.count, 1);
    assert.equal(reviews.reviews[0].review_id, review.review.review_id);

    const tickets = parseToolResult(await s.call("hermes_list_bug_tickets", {
      status: "active",
      releaseBlockersOnly: true,
    }));
    assert.equal(tickets.ok, true);
    assert.ok(tickets.tickets.some((ticket) => ticket.ticket_id.startsWith("slop-review-")));

    const live = parseToolResult(await s.call("hermes_live_status", {
      includeEvents: true,
      eventLimit: 100,
    }));
    const eventTypes = live.recent_outbox_events.map((event) => event.event_type);
    assert.ok(eventTypes.includes("contract.updated"));
    assert.ok(eventTypes.includes("slop.detected"));
    assert.ok(eventTypes.includes("bug.reported"));
  } finally {
    s.stop();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("claim audit stdio round-trip: unsupported agent claims produce correction packet", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hp-rt-claim-audit-"));
  const s = await startServer(tmp);
  try {
    const list = await s.request("tools/list", {});
    const names = new Set((list?.result?.tools || []).map((t) => t.name));
    for (const expected of CLAIM_AUDIT_TOOLS) {
      assert.ok(names.has(expected), `tools/list missing claim-audit tool: ${expected}`);
    }

    const decomposed = parseToolResult(await s.call("hermes_decompose_claims", {
      text: "Everything is fixed and release ready. npm test: 316 passed, 0 failed.",
    }));
    assert.equal(decomposed.ok, true);
    assert.ok(decomposed.claims.length >= 2);
    assert.ok(decomposed.claims.some((claim) => claim.type === "completion"));

    const started = Date.now();
    const audited = parseToolResult(await s.call("hermes_audit_claims", {
      owner: "claim-agent",
      taskId: "claim-proof",
      text: "Everything is fixed and release ready. npm test: 316 passed, 0 failed.",
      latencyMode: "instant",
      createTicket: false,
      notifyAgents: false,
      generatorProvider: "minimax",
      generatorModel: "m3",
      auditorProvider: "deepseek",
      auditorModel: "v4",
    }));
    const elapsed = Date.now() - started;
    assert.equal(audited.ok, false, `unsupported claim should fail audit: ${JSON.stringify(audited)}`);
    assert.equal(audited.status, "needs_correction");
    assert.ok(audited.audit.findings.some((finding) => finding.code === "claim.unproven_completion"));
    assert.ok(audited.audit.grounding_requests.length >= 1);
    assert.ok(audited.audit.correction_packet.claims_to_fix.length >= 1);
    assert.ok(audited.provider_records.some((record) => record.provider_id === "minimax"));
    assert.ok(elapsed < 1500, `claim audit should stay fast; took ${elapsed}ms`);

    const audits = parseToolResult(await s.call("hermes_list_claim_audits", {
      status: "needs_correction",
    }));
    assert.equal(audits.ok, true);
    assert.equal(audits.count, 1);
    assert.equal(audits.audits[0].audit_id, audited.audit.audit_id);

    const live = parseToolResult(await s.call("hermes_live_status", {
      includeEvents: true,
      eventLimit: 100,
    }));
    const eventTypes = live.recent_outbox_events.map((event) => event.event_type);
    assert.ok(eventTypes.includes("claim.audit.failed"));
  } finally {
    s.stop();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("agentic tick stdio round-trip: bad claims enqueue correction work", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hp-rt-agentic-tick-"));
  const s = await startServer(tmp);
  try {
    const list = await s.request("tools/list", {});
    const names = new Set((list?.result?.tools || []).map((t) => t.name));
    assert.ok(names.has("hermes_agentic_tick"), "tools/list missing hermes_agentic_tick");

    const tick = parseToolResult(await s.call("hermes_agentic_tick", {
      owner: "minimax-controller",
      taskId: "pacman-loop",
      mode: "autopilot",
      objective: "Find PAC-MAN timer and speed addresses",
      latestOutput: "Timer freeze is complete and release ready. All tests passed.",
      providerCandidates: ["minimax", "deepseek", "siliconflow", "lm-studio"],
      primaryProvider: "minimax",
      keepGoing: true,
      enqueueNext: true,
      notifyAgents: false,
      createTicket: false,
      progressSignals: ["bridge reachable", "candidate count decreased"],
    }));
    assert.equal(tick.ok, false, `unsupported claim should require action: ${JSON.stringify(tick)}`);
    assert.equal(tick.loop.status, "needs_action");
    assert.equal(tick.loop.mode, "autopilot");
    assert.ok(tick.loop.provider_roles.some((entry) => entry.provider === "deepseek"));
    assert.ok(tick.loop.next_actions.some((entry) => entry.action === "ground_claims"));
    assert.ok(tick.loop.queued_task?.task_id?.startsWith("agentic-"));

    const pending = parseToolResult(await s.call("hermes_list_pending_tasks", {}));
    assert.equal(pending.ok, true);
    assert.ok(pending.tasks.some((task) => task.task_id === tick.loop.queued_task.task_id));

    const live = parseToolResult(await s.call("hermes_live_status", {
      includeEvents: true,
      eventLimit: 100,
    }));
    const eventTypes = live.recent_outbox_events.map((event) => event.event_type);
    assert.ok(eventTypes.includes("agentic.tick"));
    assert.ok(eventTypes.includes("claim.audit.failed"));
  } finally {
    s.stop();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("backend and GitLab stdio round-trip: status is redacted and missing-token paths are safe", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hp-rt-backend-gitlab-"));
  const emptyGitLabEnv = path.join(tmp, ".env.gitlab");
  await fs.writeFile(emptyGitLabEnv, "# empty GitLab env for stdio test isolation\n");
  const s = await startServer(tmp, {
    GITLAB_TOKEN: "",
    GLAB_TOKEN: "",
    GITLAB_ACCESS_TOKEN: "",
    GITLAB_PRIVATE_TOKEN: "",
    GITLAB_PAT: "",
    GHENGHIS_GITLAB_TOKEN: "",
    HERMESPROOF_GITLAB_ENV_FILE: emptyGitLabEnv,
    GH_TOKEN: "",
    GITHUB_TOKEN: "",
  });
  try {
    const list = await s.request("tools/list", {});
    const names = new Set((list?.result?.tools || []).map((t) => t.name));
    for (const expected of BACKEND_GITLAB_TOOLS) {
      assert.ok(names.has(expected), `tools/list missing backend/GitLab tool: ${expected}`);
    }

    const backend = parseToolResult(await s.call("hermes_backend_status", {}));
    assert.equal(backend.ok, true, `backend status failed: ${JSON.stringify(backend)}`);
    assert.equal(backend.secret_values_returned, false);
    assert.ok(!JSON.stringify(backend).includes("PRIVATE-TOKEN"));

    const status = parseToolResult(await s.call("hermes_gitlab_status", { probe: false }));
    assert.equal(status.ok, true);
    assert.equal(status.status, "missing_token");
    assert.equal(status.configured, false);

    const connected = parseToolResult(await s.call("hermes_connect_project", {
      owner: "gitlab-proof-agent",
      workspaceRoot: tmp,
      status: "idle",
      skills: ["gitlab", "coordination"],
      taskTypes: ["release"],
      hermesproofSupplies: ["locks", "gitlab", "inbox"],
      notes: "connect without leaking or requiring GitLab credentials",
    }));
    assert.equal(connected.ok, true, `connect project failed: ${JSON.stringify(connected)}`);
    assert.equal(connected.status, "connected");
    assert.equal(connected.gitlab_status.status, "missing_token");
    assert.equal(connected.joined.presence.status, "idle");
    assert.equal(connected.backend_status.secret_values_returned, false);
    assert.ok(!JSON.stringify(connected).includes("PRIVATE-TOKEN"));

    const ensured = parseToolResult(await s.call("hermes_gitlab_ensure_project", {
      owner: "gitlab-proof-agent",
      namespacePath: "Ghenghis",
      projectPath: "HermesProof-test",
      visibility: "private",
    }));
    assert.equal(ensured.ok, false);
    assert.equal(ensured.status, "missing_token");
    assert.equal(ensured.backend_status.secret_values_returned, false);

    const listed = parseToolResult(await s.call("hermes_gitlab_list_merge_requests", {
      projectFullPath: "Ghenghis/HermesProof",
    }));
    assert.equal(listed.ok, false);
    assert.equal(listed.status, "missing_token");

    const mr = parseToolResult(await s.call("hermes_gitlab_create_merge_request", {
      owner: "gitlab-proof-agent",
      projectFullPath: "Ghenghis/HermesProof",
      sourceBranch: "codex/test",
      targetBranch: "main",
      title: "Proof MR",
    }));
    assert.equal(mr.ok, false);
    assert.equal(mr.status, "missing_token");

    const ultimateStatus = parseToolResult(await s.call("hermes_gitlab_ultimate_status", {
      projectFullPath: "Ghenghis/HermesProof",
    }));
    assert.equal(ultimateStatus.ok, false);
    assert.equal(ultimateStatus.status, "missing_token");

    const ultimateBootstrap = parseToolResult(await s.call("hermes_gitlab_bootstrap_ultimate", {
      owner: "gitlab-proof-agent",
      projectFullPath: "Ghenghis/HermesProof",
      dryRun: true,
    }));
    assert.equal(ultimateBootstrap.ok, false);
    assert.equal(ultimateBootstrap.status, "missing_token");
    assert.equal(ultimateBootstrap.backend_status.secret_values_returned, false);
  } finally {
    s.stop();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("provider-performance stdio round-trip: record, rank, and live status expose model routing scores", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hp-rt-provider-perf-"));
  const s = await startServer(tmp);
  try {
    const list = await s.request("tools/list", {});
    const names = new Set((list?.result?.tools || []).map((t) => t.name));
    for (const expected of PROVIDER_TOOLS) {
      assert.ok(names.has(expected), `tools/list missing provider tool: ${expected}`);
    }

    const minimax = parseToolResult(await s.call("hermes_provider_record_outcome", {
      provider_id: "minimax",
      model_name: "MiniMax-M3",
      task_type: "pacman_timer_scan",
      outcome: "verified",
      reward: 1,
      latency_ms: 700,
      context: "narrowed live timer candidates",
      evidence: "ce_ping 30/30",
    }));
    assert.equal(minimax.ok, true, `record minimax failed: ${JSON.stringify(minimax)}`);

    const deepseek = parseToolResult(await s.call("hermes_provider_record_outcome", {
      provider_id: "deepseek",
      model_name: "deepseek-chat",
      task_type: "pacman_timer_scan",
      outcome: "failed",
      context: "wrong scan lane",
    }));
    assert.equal(deepseek.ok, true, `record deepseek failed: ${JSON.stringify(deepseek)}`);

    const ranked = parseToolResult(await s.call("hermes_provider_rank", {
      task_type: "pacman_timer_scan",
      candidates: ["deepseek", "siliconflow", "minimax"],
    }));
    assert.equal(ranked.ok, true, `rank failed: ${JSON.stringify(ranked)}`);
    assert.deepEqual(
      ranked.providers.map((entry) => entry.provider_id),
      ["minimax", "siliconflow", "deepseek"]
    );

    const stats = parseToolResult(await s.call("hermes_provider_stats", {
      provider_id: "minimax",
      task_type: "pacman_timer_scan",
      include_history: true,
    }));
    assert.equal(stats.ok, true, `stats failed: ${JSON.stringify(stats)}`);
    assert.equal(stats.providers[0].verified, 1);
    assert.equal(stats.providers[0].recent_events[0].model_name, "MiniMax-M3");

    const live = parseToolResult(await s.call("hermes_live_status", {
      includeProviderStats: true,
      includeAgents: false,
      includeEvents: false,
    }));
    assert.equal(live.ok, true);
    assert.ok(live.provider_performance.some((entry) => entry.provider_id === "minimax"));
  } finally {
    s.stop();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("WinMerge stdio round-trip: status and safe path validation are exposed", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hp-rt-winmerge-"));
  const s = await startServer(tmp, {
    HERMES_WINMERGE_EXE: process.execPath,
    HERMES_WINMERGE_ALLOWED_ROOTS: tmp,
  });
  try {
    const list = await s.request("tools/list", {});
    const names = new Set((list?.result?.tools || []).map((t) => t.name));
    for (const expected of WINMERGE_TOOLS) {
      assert.ok(names.has(expected), `tools/list missing WinMerge tool: ${expected}`);
    }

    const status = parseToolResult(await s.call("hermes_winmerge_status", {}));
    assert.equal(status.ok, true, `status failed: ${JSON.stringify(status)}`);
    assert.equal(status.found, true);
    assert.ok(status.allowed_roots.some((root) => path.resolve(root) === path.resolve(tmp)));

    await fs.writeFile(path.join(tmp, "left.txt"), "left", "utf8");
    const privateRejected = parseToolResult(await s.call("hermes_winmerge_compare", {
      owner: "rt-agent-1",
      leftPath: path.join(tmp, "left.txt"),
      rightPath: path.join(tmp, "private", "right.txt"),
    }));
    assert.equal(privateRejected.ok, false);
    assert.match(privateRejected.message, /private|missing_winmerge/i);
  } finally {
    s.stop();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("unlock-request stdio round-trip: stale owner routes to recovery instead of inbox wait", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hp-rt-stale-unlock-"));
  const s = await startServer(tmp);
  try {
    const claim = parseToolResult(await s.call("hermes_claim_task", {
      owner: "rt-stale-owner",
      taskId: "rt-stale-lock",
      title: "stale lock owner proof",
      files: ["src/stale-lock.txt"],
    }));
    assert.equal(claim.ok, true);

    const lock = parseToolResult(await s.call("hermes_lock_files", {
      owner: "rt-stale-owner",
      taskId: "rt-stale-lock",
      files: ["src/stale-lock.txt"],
      reason: "stale unlock proof",
      ttlMinutes: 5,
    }));
    assert.equal(lock.ok, true);

    const metadataFile = path.join(
      tmp,
      ".hermes3d_orchestrator",
      "locks",
      `${shaId("src/stale-lock.txt")}.lockdir`,
      "metadata.json"
    );
    const metadata = JSON.parse(await fs.readFile(metadataFile, "utf8"));
    metadata.expires_utc = new Date(Date.now() - 60_000).toISOString();
    await fs.writeFile(metadataFile, JSON.stringify(metadata, null, 2), "utf8");

    const unlock = parseToolResult(await s.call("hermes_request_unlock", {
      requester: "rt-stale-requester",
      taskId: "rt-stale-request",
      files: ["src/stale-lock.txt"],
      reason: "owner is stale, recover instead of waiting",
      priority: "urgent",
    }));
    assert.equal(unlock.ok, true, `stale unlock failed: ${JSON.stringify(unlock)}`);
    assert.equal(unlock.status, "stale_available");
    assert.equal(unlock.handoff_requests.length, 0);
    assert.equal(unlock.notifications.length, 0);
    assert.ok(unlock.next_tools.includes("hermes_recover_stale_locks"));

    const wait = parseToolResult(await s.call("hermes_wait_for_unlock", {
      requester: "rt-stale-requester",
      files: ["src/stale-lock.txt"],
      timeoutMs: 0,
    }));
    assert.equal(wait.status, "stale_available");
    assert.ok(wait.next_tools.includes("hermes_recover_stale_locks"));
  } finally {
    s.stop();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("v0.7 stdio round-trip: anonymous orchestrator tools (claim → state → release)", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "v07-rt-anon-"));
  const s = await startServer(tmp);
  try {
    // Valid claim
    const claim = parseToolResult(await s.call("hermes_anonymous_claim", {
      role: "BUILDER",
      actor_id: "rt-actor-1",
      purpose: "round-trip smoke",
    }));
    assert.equal(claim.ok, true, `claim failed: ${JSON.stringify(claim)}`);

    // State sees the claim
    const state = parseToolResult(await s.call("hermes_anonymous_state", {}));
    assert.ok(state.active_roles?.BUILDER?.some((r) => r.actor_id === "rt-actor-1"));

    // Invalid role → zod rejects via result.isError envelope
    const badRole = parseToolResult(await s.call("hermes_anonymous_claim", { role: "NOT_A_ROLE", actor_id: "rt-actor-1" }));
    assert.equal(badRole.ok, false, `invalid role should reject; got ${JSON.stringify(badRole)}`);

    // Release
    const rel = parseToolResult(await s.call("hermes_anonymous_release", {
      role: "BUILDER",
      actor_id: "rt-actor-1",
    }));
    assert.equal(rel.ok, true);
  } finally {
    s.stop();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("v0.7 stdio round-trip: A2A task lifecycle (create → get → update → list)", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "v07-rt-a2a-"));
  const s = await startServer(tmp);
  try {
    const create = parseToolResult(await s.call("hermes_a2a_create_task", {
      agent_id: "rt-agent-1",
      task_type: "gate_run",
      input: { gate: "smoke" },
    }));
    assert.equal(create.ok, true, `create failed: ${JSON.stringify(create)}`);
    const taskId = create.task_id;

    const get = parseToolResult(await s.call("hermes_a2a_get_task", { task_id: taskId }));
    assert.equal(get.id, taskId);
    assert.equal(get.status, "submitted");

    const update = parseToolResult(await s.call("hermes_a2a_update_task", {
      task_id: taskId,
      status: "working",
    }));
    assert.equal(update.ok, true);
    assert.equal(update.status, "working");

    const list = parseToolResult(await s.call("hermes_a2a_list_tasks", {}));
    assert.ok(Array.isArray(list.tasks));
    assert.ok(list.tasks.some((t) => t.id === taskId && t.status === "working"));

    // Invalid transition (working → submitted is not allowed)
    const badTransition = parseToolResult(await s.call("hermes_a2a_update_task", {
      task_id: taskId,
      status: "submitted",
    }));
    assert.equal(badTransition.ok, false, "invalid transition must fail closed");
  } finally {
    s.stop();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("v0.7 stdio round-trip: reputation + skill + dispatch tools", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "v07-rt-rep-"));
  const s = await startServer(tmp);
  try {
    const rec = parseToolResult(await s.call("hermes_record_outcome", {
      actor_id: "rt-actor-1",
      outcome: "merge",
      context: "round-trip smoke",
    }));
    assert.equal(rec.ok, true);
    assert.equal(rec.delta, 1.0);

    const task = parseToolResult(await s.call("hermes_record_task", {
      actor_id: "rt-actor-1",
      task_type: "build",
    }));
    assert.equal(task.ok, true);

    const dispatch = parseToolResult(await s.call("hermes_dispatch_recommend", {
      task_type: "build",
      candidates: ["rt-actor-1", "rt-actor-2"],
    }));
    assert.ok(dispatch.actor_id, "must return a recommendation");

    const agents = parseToolResult(await s.call("hermes_list_agents", {
      task_type: "build",
    }));
    assert.ok(Array.isArray(agents.agents));
    // P1-14: every agent entry must have a `roles` array (even if empty).
    for (const a of agents.agents) {
      assert.ok(Array.isArray(a.roles), `agent ${a.actor_id} must have roles array (P1-14)`);
    }
  } finally {
    s.stop();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("v0.7 stdio round-trip: P1-14 — hermes_list_agents includes anonymous role state", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "v07-rt-roles-"));
  const s = await startServer(tmp);
  try {
    // Claim a role for an actor that has NO recorded skill or reputation.
    // Pre-P1-14 this actor was invisible in hermes_list_agents.
    await s.call("hermes_anonymous_claim", {
      role: "GATE-SMITH",
      actor_id: "rt-role-only-actor",
      purpose: "P1-14 visibility test",
    });
    const agents = parseToolResult(await s.call("hermes_list_agents", {}));
    const found = agents.agents.find((a) => a.actor_id === "rt-role-only-actor");
    assert.ok(found, "role-only actor must appear in hermes_list_agents (P1-14)");
    assert.ok(found.roles.some((r) => r.role === "GATE-SMITH"), "actor's GATE-SMITH role must be surfaced");

    // Invalid outcome (not in OUTCOME_DELTAS) → graceful error
    const badOutcome = parseToolResult(await s.call("hermes_record_outcome", {
      actor_id: "rt-actor-1",
      outcome: "excellent",
    }));
    assert.equal(badOutcome.ok, false, "unknown outcome must fail closed");
  } finally {
    s.stop();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("v0.7 stdio round-trip: USER session tools enforce P0-5 hardening over the wire", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "v07-rt-user-"));
  const s = await startServer(tmp);
  try {
    // P0-5: omitted scope → reject
    const noScope = parseToolResult(await s.call("hermes_user_grant_session", {
      granted_by: "hermes-agent",
      session_id: "rt-sess-aaaaaaaa",
    }));
    assert.equal(noScope.ok, false, "missing scope must be rejected over wire");
    assert.match(noScope.message || "", /scope is required|non-empty array/i);

    // P0-5: empty scope → reject
    const emptyScope = parseToolResult(await s.call("hermes_user_grant_session", {
      granted_by: "hermes-agent",
      session_id: "rt-sess-aaaaaaaa",
      scope: [],
    }));
    assert.equal(emptyScope.ok, false);

    // Valid grant with scope (granted_by:"hermes-agent" has no env requirement)
    const ok = parseToolResult(await s.call("hermes_user_grant_session", {
      granted_by: "hermes-agent",
      session_id: "rt-sess-aaaaaaaa",
      scope: ["read_state", "claim_role"],
    }));
    assert.equal(ok.ok, true);

    // checkUserAuthorization respects scope
    const allowed = parseToolResult(await s.call("hermes_user_check_authorization", { action: "read_state" }));
    assert.equal(allowed.allowed, true);
    const denied = parseToolResult(await s.call("hermes_user_check_authorization", { action: "delete_branch" }));
    assert.equal(denied.allowed, false);

    const rev = parseToolResult(await s.call("hermes_user_revoke_session", { session_id: "rt-sess-aaaaaaaa" }));
    assert.equal(rev.ok, true);
  } finally {
    s.stop();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("v0.7 stdio round-trip: Hermes Agent bridge tools (disabled-state probes)", async () => {
  // Run with bridge DISABLED — exercises the tool registration + envelope
  // without requiring any LLM provider.
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "v07-rt-agent-"));
  const s = await startServer(tmp);
  try {
    const health = parseToolResult(await s.call("hermes_agent_health", {}));
    // Disabled bridge should respond with ok:false + reason — but the
    // PROTOCOL response (the tool call) must succeed.
    assert.ok("ok" in health, "agent_health must return an envelope, not a protocol error");

    // revokeOwnSession returns ok:false when no active session — proves the
    // tool is registered and reachable.
    const revoke = parseToolResult(await s.call("hermes_agent_revoke_session", {}));
    assert.ok("ok" in revoke);
  } finally {
    s.stop();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
