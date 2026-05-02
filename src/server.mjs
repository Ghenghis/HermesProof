#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { HermesLockManager } from "./core/lock-manager.mjs";
import { GateRunner } from "./core/gate-runner.mjs";

// Workspace resolution priority: MCP_LOCK_WORKSPACE > HERMES3D_WORKSPACE > cwd.
// The orchestrator can be installed into any project, not just Hermes3D.
const workspaceRoot =
  process.env.MCP_LOCK_WORKSPACE ||
  process.env.HERMES3D_WORKSPACE ||
  process.cwd();
const stateDirName = process.env.MCP_LOCK_STATE_DIR || undefined;
const manager = new HermesLockManager({ workspaceRoot, stateDirName });
const gates = new GateRunner({ workspaceRoot });
await manager.init();

const server = new McpServer({
  name: "hermes3d-lock-orchestrator",
  version: "0.1.0"
});

const Owner = z.string().min(2).describe("Unique agent/session owner, e.g. claude-lead, codex-impl-01, windsurf-cascade.");
const Files = z.array(z.string().min(1)).min(1).describe("Workspace-relative file paths to lock, release, or hand off.");
const JsonObject = z.record(z.any()).optional().default({});

function toolResult(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }]
  };
}

function toolError(err) {
  return toolResult({ ok: false, status: "error", message: err?.message || String(err) });
}

server.tool(
  "hermes_get_state",
  "Read current Hermes3D coordination state: locks, tasks, handoffs, evidence location.",
  {},
  async () => toolResult(await manager.getStateSummary())
);

server.tool(
  "hermes_claim_task",
  "Claim a task before editing. Use this before locking files.",
  {
    owner: Owner,
    role: z.string().default("agent"),
    taskId: z.string().optional().describe("Stable task id, e.g. CP-UX-A-CODEX."),
    title: z.string().default(""),
    files: z.array(z.string()).default([]),
    reason: z.string().default("")
  },
  async (args) => {
    try { return toolResult(await manager.claimTask(args)); } catch (err) { return toolError(err); }
  }
);

server.tool(
  "hermes_release_task",
  "Release a task after all locked files have been released and evidence appended.",
  {
    owner: Owner,
    taskId: z.string().min(1),
    note: z.string().default("")
  },
  async (args) => {
    try { return toolResult(await manager.releaseTask(args)); } catch (err) { return toolError(err); }
  }
);

server.tool(
  "hermes_lock_files",
  "Atomically lock files before editing. If any file is locked by another owner, the whole lock request is rolled back and you must request a handoff.",
  {
    owner: Owner,
    role: z.string().default("agent"),
    taskId: z.string().default(""),
    files: Files,
    reason: z.string().default(""),
    ttlMinutes: z.number().int().min(5).max(720).default(90)
  },
  async (args) => {
    try { return toolResult(await manager.lockFiles(args)); } catch (err) { return toolError(err); }
  }
);

server.tool(
  "hermes_release_files",
  "Release files when finished. Only the owning agent can release its locks unless stale recovery is used.",
  {
    owner: Owner,
    files: Files,
    note: z.string().default("")
  },
  async (args) => {
    try { return toolResult(await manager.releaseFiles(args)); } catch (err) { return toolError(err); }
  }
);

server.tool(
  "hermes_heartbeat",
  "Refresh locks for a running task/session so other agents know the owner is still active.",
  {
    owner: Owner,
    taskId: z.string().default("")
  },
  async (args) => {
    try { return toolResult(await manager.heartbeat(args)); } catch (err) { return toolError(err); }
  }
);

server.tool(
  "hermes_list_locks",
  "List all active file locks with owner, task, heartbeat, expiry, and stale status.",
  {},
  async () => {
    try { return toolResult(await manager.listLocks()); } catch (err) { return toolError(err); }
  }
);

server.tool(
  "hermes_request_handoff",
  "Ask the current owner for permission to take over locked files. Use when hermes_lock_files returns blocked.",
  {
    requester: Owner,
    currentOwner: Owner,
    files: Files,
    reason: z.string().default(""),
    taskId: z.string().default("")
  },
  async (args) => {
    try { return toolResult(await manager.requestHandoff(args)); } catch (err) { return toolError(err); }
  }
);

server.tool(
  "hermes_approve_handoff",
  "Approve or deny a handoff request. Only the current lock owner can approve. Approval transfers lock ownership; denial keeps the lock.",
  {
    owner: Owner,
    requestId: z.string().min(1),
    decision: z.enum(["approve", "deny"]).default("approve"),
    note: z.string().default("")
  },
  async (args) => {
    try { return toolResult(await manager.approveHandoff(args)); } catch (err) { return toolError(err); }
  }
);

server.tool(
  "hermes_recover_stale_locks",
  "Recover locks whose TTL expired. This is the only safe override path and should be used with evidence.",
  {
    owner: Owner,
    files: z.array(z.string()).default([]),
    note: z.string().default("")
  },
  async (args) => {
    try { return toolResult(await manager.recoverStaleLocks(args)); } catch (err) { return toolError(err); }
  }
);

server.tool(
  "hermes_append_evidence",
  "Append an evidence entry to the Hermes3D ledger. Use after locks, tests, screenshots, commits, and handoffs.",
  {
    owner: Owner,
    taskId: z.string().default(""),
    kind: z.string().default("note"),
    summary: z.string().min(1),
    data: JsonObject
  },
  async (args) => {
    try { return toolResult(await manager.appendEvidence(args)); } catch (err) { return toolError(err); }
  }
);

server.tool(
  "hermes_list_gates",
  "List allowed gates. This server does not run arbitrary shell commands.",
  {},
  async () => toolResult({ ok: true, gates: gates.listGates() })
);

server.tool(
  "hermes_run_gate",
  "Run one allowlisted gate and store the result in the evidence ledger. Unknown commands are rejected.",
  {
    owner: Owner,
    gateId: z.string().min(1),
    cwd: z.string().default("."),
    env: z.record(z.any()).default({})
  },
  async (args) => {
    try { return toolResult(await gates.runGate(args)); } catch (err) { return toolError(err); }
  }
);

server.tool(
  "hermes_read_policy",
  "Read-only view of orchestrator policy: workspace root, state dir, default TTL, env-var resolution, and safety guarantees.",
  {},
  async () => {
    try { return toolResult(manager.getPolicy()); } catch (err) { return toolError(err); }
  }
);

server.tool(
  "hermes_doctor",
  "Run non-destructive pre-flight checks: workspace exists, state dir is writable, env vars set, git presence, Node version. Returns findings with suggested fixes.",
  {},
  async () => {
    try { return toolResult(await manager.doctor()); } catch (err) { return toolError(err); }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
