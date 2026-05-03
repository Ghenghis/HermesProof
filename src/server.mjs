#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { config as loadDotenv } from "dotenv";
import { resolveEnvFile } from "./core/env-file.mjs";
import { HermesLockManager } from "./core/lock-manager.mjs";
import { GateRunner } from "./core/gate-runner.mjs";
import { AnonymousOrchestrator, ROLES as ANON_ROLES } from "./core/anonymous-orchestrator.mjs";
import { HermesAgentBridge } from "./core/hermes-agent-bridge.mjs";

// Env-file resolution precedence (HermesProof v0.6):
//   1. HERMES3D_PROFILE=vps + HERMES3D_VPS_ENV_FILE  (deploy mode)
//   2. HERMES3D_ENV_FILE                              (general dev override)
//   3. ./.env in CWD                                  (legacy fallback)
// HermesProof is stdio JSON-RPC and does not parse argv; profile selection is
// driven entirely by env vars. Resolved paths are intentionally not logged.
function maybeLoadDotenv() {
  const envFile = resolveEnvFile({
    onMissing(source) {
      console.error(`[hermesproof] ${source} is set but its file was not found; trying the next env-file candidate.`);
    }
  });
  if (envFile) {
    const loaded = loadDotenv({ path: envFile });
    if (loaded.error) {
      console.error("[hermesproof] selected env file could not be loaded; continuing with current environment.");
    }
  }
}

maybeLoadDotenv();

// Workspace resolution priority: MCP_LOCK_WORKSPACE > HERMES3D_WORKSPACE > cwd.
// The orchestrator can be installed into any project, not just Hermes3D.
const workspaceRoot =
  process.env.MCP_LOCK_WORKSPACE ||
  process.env.HERMES3D_WORKSPACE ||
  process.cwd();
const stateDirName = process.env.MCP_LOCK_STATE_DIR || undefined;
const manager = new HermesLockManager({ workspaceRoot, stateDirName });
const gates = new GateRunner({ workspaceRoot });
const anon = new AnonymousOrchestrator({ workspaceRoot, stateDirName });
const hermesAgent = new HermesAgentBridge({
  orchestrator: anon,
  enabled: process.env.HERMES_AGENT_ENABLED === "1",
  scope: process.env.HERMES_AGENT_SCOPE
    ? process.env.HERMES_AGENT_SCOPE.split(",").map((s) => s.trim())
    : null,
  projectGoals: process.env.HERMES_AGENT_PROJECT_GOALS || null,
});
await manager.init();
await anon.init();

const server = new McpServer({
  name: "hermes3d-lock-orchestrator",
  version: "0.5.0"
});

// Tightened owner regex: lowercase + digits + hyphen, must start with a letter,
// 2-64 chars. Rejects whitespace, control chars, prompt-injection markers.
const Owner = z
  .string()
  .regex(/^[a-z][a-z0-9-]{1,63}$/, "owner must match ^[a-z][a-z0-9-]{1,63}$")
  .describe("Unique agent/session owner, e.g. claude-lead, codex-impl-01, windsurf-cascade.");

const Files = z.array(z.string().min(1)).min(1).describe("Workspace-relative file paths to lock, release, or hand off.");
const JsonObject = z.record(z.any()).optional().default({});
const EventStatus = z.enum(["outbox", "handled", "failed", "all"]).default("outbox");
const EventType = z.enum([
  "task.enqueued",
  "task.claimed",
  "task.released",
  "task.blocked",
  "task.recovered",
  "handoff.created",
  "handoff.approved",
  "handoff.denied",
  "lock.acquired",
  "lock.released",
  "lock.recovered",
  "evidence.appended",
  "gate.failed",
  "gate.passed",
  "pr.opened"
]);
const NextActor = z.enum(["claude", "codex", "human", "unassigned"]).default("unassigned");
const RecommendedAction = z.enum(["review_pr", "fix_scope", "merge", "review_handoff", "acknowledge", "none"]).default("none");
const TaskId = z.string().regex(/^[A-Za-z0-9._-]{2,128}$/, "task id must match ^[A-Za-z0-9._-]{2,128}$");

function toolResult(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }]
  };
}

function toolError(err) {
  return toolResult({ ok: false, status: "error", message: err?.message || String(err) });
}

// Tool registration helper. Uses registerTool when available so we can declare
// annotations (readOnlyHint, destructiveHint, idempotentHint, openWorldHint)
// per MCP spec 2025-11-25; falls back to legacy server.tool() shape if not.
function registerTool(name, { title, description, inputSchema, annotations }, handler) {
  if (typeof server.registerTool === "function") {
    server.registerTool(
      name,
      {
        title,
        description,
        inputSchema,
        annotations
      },
      handler
    );
  } else {
    server.tool(name, description, inputSchema || {}, handler);
  }
}

registerTool(
  "hermes_get_state",
  {
    title: "Get coordination state",
    description: "Read current coordination state: locks, tasks, handoffs, evidence location.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true }
  },
  async () => {
    try { return toolResult(await manager.getStateSummary()); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_claim_task",
  {
    title: "Claim a task",
    description: "Claim a task before editing. Use this before locking files.",
    inputSchema: {
      owner: Owner,
      role: z.string().default("agent"),
      taskId: z.string().optional().describe("Stable task id, e.g. CP-UX-A-CODEX."),
      title: z.string().default(""),
      files: z.array(z.string()).default([]),
      reason: z.string().default("")
    },
    annotations: { readOnlyHint: false, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    try { return toolResult(await manager.claimTask(args)); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_release_task",
  {
    title: "Release a task",
    description: "Release a task after all locked files have been released and evidence appended.",
    inputSchema: {
      owner: Owner,
      taskId: z.string().min(1),
      note: z.string().default("")
    },
    annotations: { readOnlyHint: false, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    try { return toolResult(await manager.releaseTask(args)); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_lock_files",
  {
    title: "Lock files atomically",
    description: "Atomically lock files before editing. If any file is locked by another owner, the whole request is rolled back; the caller should request a handoff instead.",
    inputSchema: {
      owner: Owner,
      role: z.string().default("agent"),
      taskId: z.string().default(""),
      files: Files,
      reason: z.string().default(""),
      ttlMinutes: z.number().int().min(5).max(720).default(90)
    },
    annotations: { readOnlyHint: false, openWorldHint: false, idempotentHint: false }
  },
  async (args) => {
    try { return toolResult(await manager.lockFiles(args)); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_release_files",
  {
    title: "Release locked files",
    description: "Release files when finished. Only the owning agent can release its locks unless stale recovery is used.",
    inputSchema: {
      owner: Owner,
      files: Files,
      note: z.string().default("")
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: true, idempotentHint: true }
  },
  async (args) => {
    try { return toolResult(await manager.releaseFiles(args)); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_heartbeat",
  {
    title: "Heartbeat owned locks",
    description: "Refresh locks for a running task/session so other agents know the owner is still active.",
    inputSchema: {
      owner: Owner,
      taskId: z.string().default("")
    },
    annotations: { readOnlyHint: false, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    try { return toolResult(await manager.heartbeat(args)); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_list_locks",
  {
    title: "List active locks",
    description: "List all active file locks with owner, task, heartbeat, expiry, and stale status.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true }
  },
  async () => {
    try { return toolResult(await manager.listLocks()); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_request_handoff",
  {
    title: "Request lock handoff",
    description: "Ask the current owner for permission to take over locked files. Use when hermes_lock_files returns blocked.",
    inputSchema: {
      requester: Owner,
      currentOwner: Owner,
      files: Files,
      reason: z.string().default(""),
      taskId: z.string().default("")
    },
    annotations: { readOnlyHint: false, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    try { return toolResult(await manager.requestHandoff(args)); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_approve_handoff",
  {
    title: "Approve or deny handoff",
    description: "Approve or deny a handoff request. Only the current lock owner can approve. Approval transfers lock ownership; denial keeps the lock.",
    inputSchema: {
      owner: Owner,
      requestId: z.string().min(1),
      decision: z.enum(["approve", "deny"]).default("approve"),
      note: z.string().default("")
    },
    annotations: { readOnlyHint: false, openWorldHint: false, idempotentHint: false }
  },
  async (args) => {
    try { return toolResult(await manager.approveHandoff(args)); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_recover_stale_locks",
  {
    title: "Recover stale locks",
    description: "Recover locks whose TTL expired. This is the only safe override path and should be used with evidence.",
    inputSchema: {
      owner: Owner,
      files: z.array(z.string()).default([]),
      note: z.string().default("")
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: true, idempotentHint: true }
  },
  async (args) => {
    try { return toolResult(await manager.recoverStaleLocks(args)); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_list_events",
  {
    title: "List durable events",
    description: "List file-based trigger events from outbox, handled, failed, or all event queues.",
    inputSchema: {
      status: EventStatus,
      limit: z.number().int().min(1).max(500).default(50)
    },
    annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    try { return toolResult(await manager.listEvents(args)); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_mark_event_handled",
  {
    title: "Mark event handled",
    description: "Atomically move one outbox event to handled after a watcher or reviewer processes it.",
    inputSchema: {
      event_id: z.string().min(1),
      handled_by: Owner,
      note: z.string().default("")
    },
    annotations: { readOnlyHint: false, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    try { return toolResult(await manager.markEventHandled(args)); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_emit_event",
  {
    title: "Emit manual event",
    description: "Insert a durable trigger event. The manager fills event id, timestamp, workspace, branch, and evidence ids.",
    inputSchema: {
      event_type: EventType,
      task_id: z.string().default(""),
      owner: z.string().default(""),
      branch: z.string().default(""),
      files: z.array(z.string()).default([]),
      summary: z.string().default(""),
      next_actor: NextActor,
      recommended_action: RecommendedAction,
      payload: z.record(z.any()).default({})
    },
    annotations: { readOnlyHint: false, openWorldHint: false, idempotentHint: false }
  },
  async (args) => {
    try {
      const payload = {
        ...args,
        task_id: args.task_id || null,
        owner: args.owner || null,
        branch: args.branch || null
      };
      return toolResult(await manager.emitManualEvent(payload));
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_create_blocked_handoff",
  {
    title: "Create blocked handoff",
    description: "Write a blocked handoff markdown file, append evidence, emit task.blocked, and optionally release owned locks.",
    inputSchema: {
      task_id: z.string().min(1),
      owner: Owner,
      reason: z.string().min(1),
      blocked_files: z.array(z.string()).default([]),
      suggested_correct_paths: z.array(z.string()).default([]),
      handoff_path: z.string().min(1),
      release_locks: z.boolean().default(false)
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: true, idempotentHint: false }
  },
  async (args) => {
    try { return toolResult(await manager.createBlockedHandoff(args)); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_enqueue_task",
  {
    title: "Enqueue task",
    description: "Add a durable queue task under tasks/pending. Re-enqueueing the same task id is a no-op success.",
    inputSchema: {
      task_id: TaskId,
      title: z.string().default(""),
      summary: z.string().default(""),
      handoff_path: z.string().default(""),
      branch_hint: z.string().default(""),
      files_hint: z.array(z.string()).default([]),
      priority: z.number().min(-100).max(100).default(0),
      target_owner_pattern: z.string().default(".*"),
      ttl_minutes: z.number().int().min(1).max(10080).default(120),
      data: z.record(z.any()).default({})
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false, idempotentHint: true }
  },
  async (args) => {
    try { return toolResult(await manager.enqueueTask(args)); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_list_pending_tasks",
  {
    title: "List pending tasks",
    description: "List durable queue tasks sorted by priority descending, then enqueue time ascending.",
    inputSchema: {
      owner_filter: z.string().default(""),
      limit: z.number().int().min(1).max(500).default(50)
    },
    annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    try { return toolResult(await manager.listPendingTasks(args)); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_pick_task",
  {
    title: "Pick task",
    description: "Atomically claim the highest-priority pending task matching the owner pattern.",
    inputSchema: {
      owner: Owner,
      prefer_task_id: TaskId.optional()
    },
    annotations: { readOnlyHint: false, openWorldHint: false, idempotentHint: false }
  },
  async (args) => {
    try { return toolResult(await manager.pickTask(args)); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_recover_stale_tasks",
  {
    title: "Recover stale tasks",
    description: "Move expired claimed queue tasks back to pending and emit task.recovered events.",
    inputSchema: {
      owner: Owner,
      files: z.array(TaskId).default([]),
      note: z.string().default("")
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: true, idempotentHint: true }
  },
  async (args) => {
    try { return toolResult(await manager.recoverStaleTasks(args)); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_append_evidence",
  {
    title: "Append evidence record",
    description: "Append a hash-chained evidence entry to the ledger. Use after locks, tests, screenshots, commits, and handoffs.",
    inputSchema: {
      owner: Owner,
      taskId: z.string().default(""),
      kind: z.string().default("note"),
      summary: z.string().min(1),
      data: JsonObject
    },
    annotations: { readOnlyHint: false, openWorldHint: false, idempotentHint: false }
  },
  async (args) => {
    try { return toolResult(await manager.appendEvidence(args)); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_verify_evidence",
  {
    title: "Verify evidence hash chain",
    description: "Walk the append-only evidence ledger and verify every entry's prev_hash and entry_hash. Reports first break, total entries, chained vs unchained counts.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true }
  },
  async () => {
    try { return toolResult(await manager.verifyEvidence()); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_list_gates",
  {
    title: "List allowlisted gates",
    description: "List allowed gates. This server does not run arbitrary shell commands.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true }
  },
  async () => toolResult({ ok: true, gates: gates.listGates() })
);

registerTool(
  "hermes_run_gate",
  {
    title: "Run an allowlisted gate",
    description: "Run one allowlisted gate and store the result in the evidence ledger. Unknown commands are rejected.",
    inputSchema: {
      owner: Owner,
      gateId: z.string().min(1),
      cwd: z.string().default("."),
      env: z.record(z.any()).default({})
    },
    annotations: { readOnlyHint: false, openWorldHint: true, idempotentHint: false }
  },
  async (args) => {
    try {
      const result = await gates.runGate(args);
      await manager.emitGateEvent({ owner: args.owner, result });
      return toolResult(result);
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_read_policy",
  {
    title: "Read policy",
    description: "Read-only view of orchestrator policy: workspace root, state dir, default TTL, env-var resolution, and safety guarantees.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true }
  },
  async () => {
    try { return toolResult(manager.getPolicy()); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_doctor",
  {
    title: "Doctor (pre-flight checks)",
    description: "Run non-destructive pre-flight checks: workspace exists, state dir is writable, env vars set, git presence, Node version. Returns findings with suggested fixes.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true }
  },
  async () => {
    try { return toolResult(await manager.doctor()); } catch (err) { return toolError(err); }
  }
);

// === Anonymous orchestrator + Hermes Agent USER bridge tools ===

const RoleEnum = z.enum(["BUILDER", "CRITIC", "SCRIBE", "GATE-SMITH", "DOC-KEEPER", "WATCHDOG"]);

registerTool(
  "hermes_anonymous_claim",
  {
    title: "Claim an anonymous role",
    description: "Claim one of the anonymous coordination roles (BUILDER, CRITIC, SCRIBE, GATE-SMITH, DOC-KEEPER, WATCHDOG). Roles are claimed per-actor with a 30min TTL; renewing reclaims with a fresh TTL.",
    inputSchema: { role: RoleEnum, actor_id: Owner, purpose: z.string().min(2).max(280).optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  async ({ role, actor_id, purpose }) => {
    try { return toolResult(await anon.claimRole({ role, actor_id, purpose })); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_anonymous_release",
  {
    title: "Release an anonymous role",
    description: "Release a previously-claimed role. Idempotent — releasing a non-claimed role is a no-op.",
    inputSchema: { role: RoleEnum, actor_id: Owner },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  async ({ role, actor_id }) => {
    try { return toolResult(await anon.releaseRole({ role, actor_id })); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_anonymous_state",
  {
    title: "Read anonymous orchestrator state",
    description: "Read-only view of active role claims and (redacted) active user session. Hash field is redacted.",
    inputSchema: {},
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
  },
  async () => {
    try { return toolResult(await anon.getState()); } catch (err) { return toolError(err); }
  }
);

const GrantedBy = z.enum(["human", "hermes-agent", "ci"]);

registerTool(
  "hermes_user_grant_session",
  {
    title: "Grant an AS_USER session",
    description: "Grant an AS_USER session that authorizes a bounded set of actions. granted_by may be 'human' (real user), 'hermes-agent' (the bridged delegate), or 'ci' (automation). Only one active session at a time; revoke before granting a new one.",
    inputSchema: {
      granted_by: GrantedBy,
      session_id: z.string().min(8).max(128),
      scope: z.array(z.string().min(1)).optional().describe("Whitelist of action capability strings; null/missing = all actions"),
      ttl_ms: z.number().int().positive().max(48 * 60 * 60 * 1000).optional()
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  },
  async ({ granted_by, session_id, scope, ttl_ms }) => {
    try { return toolResult(await anon.grantUserSession({ granted_by, session_id, scope, ttl_ms })); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_user_revoke_session",
  {
    title: "Revoke the active AS_USER session",
    description: "Revoke an active AS_USER session by id. No-op if session_id doesn't match the currently active session.",
    inputSchema: { session_id: z.string().min(8).max(128) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
  },
  async ({ session_id }) => {
    try { return toolResult(await anon.revokeUserSession({ session_id })); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_user_check_authorization",
  {
    title: "Check AS_USER authorization for an action",
    description: "Returns { allowed, reason, granted_by } for the given action name against the currently active AS_USER session. Lazy-clears expired sessions.",
    inputSchema: { action: z.string().min(1).max(128) },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
  },
  async ({ action }) => {
    try { return toolResult(await anon.checkUserAuthorization(action)); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_agent_health",
  {
    title: "Hermes Agent bridge health probe",
    description: "Probes the configured DeepSeek/MiniMax/SiliconFlow/LM-Studio providers in failover order. Returns the first healthy provider + model. Bridge is disabled by default (set HERMES_AGENT_ENABLED=1).",
    inputSchema: {},
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true }
  },
  async () => {
    try { return toolResult(await hermesAgent.healthCheck()); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_agent_request_user_session",
  {
    title: "Have Hermes Agent request a USER session",
    description: "Asks the Hermes Agent (DeepSeek v4 → MiniMax → SiliconFlow → LM Studio) to reason about the requested scope against project goals; on 'approve', grants an AS_USER session in the orchestrator. The agent's verdict and rationale are evidenced.",
    inputSchema: {
      requested_scope: z.array(z.string().min(1)).min(1),
      ttl_hours: z.number().int().positive().max(48).optional()
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  },
  async ({ requested_scope, ttl_hours }) => {
    try { return toolResult(await hermesAgent.requestUserSession({ requested_scope, ttl_hours })); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_agent_resolve_blocked",
  {
    title: "Hermes Agent resolves a BLOCKED escalation",
    description: "Asks Hermes Agent to reason about a BLOCKED handoff and emit a verdict (approve/decline/defer). Requires an active AS_USER session for the agent (call hermes_agent_request_user_session first).",
    inputSchema: {
      correlation: z.string().min(1).max(256),
      summary: z.string().min(1).max(2000),
      full_thread: z.string().min(1).max(20000)
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  },
  async ({ correlation, summary, full_thread }) => {
    try { return toolResult(await hermesAgent.resolveBlocked({ correlation, summary, full_thread })); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_agent_revoke_session",
  {
    title: "Hermes Agent revokes its own USER session",
    description: "Hermes Agent surrenders its delegated authority. After this, AS_USER actions require either the human or a fresh agent grant.",
    inputSchema: {},
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
  },
  async () => {
    try { return toolResult(await hermesAgent.revokeOwnSession()); } catch (err) { return toolError(err); }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
