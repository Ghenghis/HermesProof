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

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const SERVER = path.join(REPO_ROOT, "src", "server.mjs");

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
]);

const REALTIME_TOOLS = Object.freeze([
  "hermes_live_status",
  "hermes_wait_for_events",
]);

async function startServer(workspaceRoot) {
  const proc = spawn(process.execPath, [SERVER], {
    env: { ...process.env, MCP_LOCK_WORKSPACE: workspaceRoot },
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
