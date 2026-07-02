#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { resolveEnvFile } from "./core/env-file.mjs";
import { HermesLockManager } from "./core/lock-manager.mjs";
import { GateRunner } from "./core/gate-runner.mjs";
import { SkillRotation } from "./core/skill-rotation.mjs";
import { ReputationTracker } from "./core/reputation.mjs";
import { CapabilityDispatch } from "./core/capability-dispatch.mjs";
import { A2AStub } from "./core/a2a-stub.mjs";
import { AnonymousOrchestrator, ROLES as ANON_ROLES } from "./core/anonymous-orchestrator.mjs";
import { HermesAgentBridge } from "./core/hermes-agent-bridge.mjs";
import { loadRegistryProviders } from "./core/registry-providers.mjs";
import {
  ensureDir,
  readJson,
  shaId,
  utcNow,
  writeJsonAtomic
} from "./core/fs-utils.mjs";

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
const configuredWorkspaceRoot =
  process.env.MCP_LOCK_WORKSPACE ||
  process.env.HERMES3D_WORKSPACE ||
  process.cwd();
const configuredStateDirName = process.env.MCP_LOCK_STATE_DIR || undefined;
const workspaceSwitchHistory = [];

let runtime = null;
let manager;
let gates;
let skills;
let reputation;
let dispatch;
let a2a;
let anon;
let hermesAgent;

async function assertExistingWorkspaceDirectory(workspaceRoot) {
  const stat = await fs.stat(workspaceRoot).catch((err) => {
    throw new Error(`workspaceRoot does not exist: ${workspaceRoot} (${err.code || err.message})`);
  });
  if (!stat.isDirectory()) {
    throw new Error(`workspaceRoot is not a directory: ${workspaceRoot}`);
  }
}

async function buildRuntime(workspaceRoot) {
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  const nextManager = new HermesLockManager({ workspaceRoot: resolvedWorkspaceRoot, stateDirName: configuredStateDirName });
  const nextGates = new GateRunner({ workspaceRoot: resolvedWorkspaceRoot });
  const nextSkills = new SkillRotation({ workspaceRoot: resolvedWorkspaceRoot, stateDirName: configuredStateDirName });
  const nextReputation = new ReputationTracker({ workspaceRoot: resolvedWorkspaceRoot, stateDirName: configuredStateDirName });
  // P1-15 (audit 2026-05-03): inject the server's already-created reputation +
  // skills into CapabilityDispatch instead of letting it construct its own
  // parallel instances. This guarantees any in-memory state added later (caches,
  // mutexes, subscriptions) stays in a single instance per process.
  const nextDispatch = new CapabilityDispatch({
    workspaceRoot: resolvedWorkspaceRoot,
    stateDirName: configuredStateDirName,
    reputation: nextReputation,
    skills: nextSkills
  });
  const nextA2a = new A2AStub({ workspaceRoot: resolvedWorkspaceRoot, stateDirName: configuredStateDirName });
  const nextAnon = new AnonymousOrchestrator({ workspaceRoot: resolvedWorkspaceRoot, stateDirName: configuredStateDirName });
  // Auto-load any of the 62 Continue LLM provider classes from
  // policies/provider-registry/registry.yaml. Per the user's directive: don't
  // exclude any providers. The 6 hardcoded built-ins remain the fast path; the
  // registry extends the failover chain with whatever else has API keys in env.
  const registryLoad = await loadRegistryProviders({ workspaceRoot: resolvedWorkspaceRoot }).catch((err) => {
    console.error("[hermesproof] registry load failed (non-fatal):", err?.message);
    return { ok: false, providers: [] };
  });
  const nextHermesAgent = new HermesAgentBridge({
    orchestrator: nextAnon,
    enabled: process.env.HERMES_AGENT_ENABLED === "1",
    scope: process.env.HERMES_AGENT_SCOPE
      ? process.env.HERMES_AGENT_SCOPE.split(",").map((s) => s.trim()).filter(Boolean)
      : null,
    projectGoals: process.env.HERMES_AGENT_PROJECT_GOALS || null,
    registryProviders: registryLoad.providers || [],
  });

  await nextManager.init();
  await nextSkills.init();
  await nextReputation.init();
  await nextDispatch.init();
  await nextA2a.init();
  await nextAnon.init();

  return {
    workspaceRoot: resolvedWorkspaceRoot,
    stateDirName: nextManager.stateDirName,
    registryProviderCount: (registryLoad.providers || []).length,
    registryLoadOk: registryLoad.ok !== false,
    manager: nextManager,
    gates: nextGates,
    skills: nextSkills,
    reputation: nextReputation,
    dispatch: nextDispatch,
    a2a: nextA2a,
    anon: nextAnon,
    hermesAgent: nextHermesAgent,
    activatedUtc: new Date().toISOString()
  };
}

function workspaceSnapshot() {
  return {
    ok: true,
    workspace_root: runtime?.workspaceRoot || null,
    state_dir: manager?.paths?.stateDir || null,
    state_dir_name: runtime?.stateDirName || null,
    registry_provider_count: runtime?.registryProviderCount || 0,
    registry_load_ok: runtime?.registryLoadOk === true,
    activated_utc: runtime?.activatedUtc || null,
    env_vars_used: {
      MCP_LOCK_WORKSPACE: process.env.MCP_LOCK_WORKSPACE || null,
      HERMES3D_WORKSPACE: process.env.HERMES3D_WORKSPACE || null,
      MCP_LOCK_STATE_DIR: process.env.MCP_LOCK_STATE_DIR || null
    },
    recent_workspace_switches: workspaceSwitchHistory.slice(-10)
  };
}

async function activateWorkspace(
  workspaceRoot,
  { owner = "system", reason = "startup", validateExists = false, allowActiveLocks = false } = {}
) {
  const raw = String(workspaceRoot || "").trim();
  if (!raw) throw new Error("workspaceRoot is required");
  if (validateExists && !path.isAbsolute(raw)) {
    throw new Error(`workspaceRoot must be an absolute path for runtime switching: ${raw}`);
  }
  const resolvedWorkspaceRoot = path.resolve(raw);
  if (validateExists) await assertExistingWorkspaceDirectory(resolvedWorkspaceRoot);

  const previousWorkspaceRoot = runtime?.workspaceRoot || null;
  if (
    validateExists &&
    previousWorkspaceRoot &&
    previousWorkspaceRoot !== resolvedWorkspaceRoot &&
    manager &&
    !allowActiveLocks
  ) {
    const activeLocks = await manager.listLocks();
    if (activeLocks.count > 0) {
      throw new Error(
        `active locks exist in current workspace ${previousWorkspaceRoot}; release them or pass allowActiveLocks=true`
      );
    }
  }
  const nextRuntime = await buildRuntime(resolvedWorkspaceRoot);
  runtime = nextRuntime;
  manager = nextRuntime.manager;
  gates = nextRuntime.gates;
  skills = nextRuntime.skills;
  reputation = nextRuntime.reputation;
  dispatch = nextRuntime.dispatch;
  a2a = nextRuntime.a2a;
  anon = nextRuntime.anon;
  hermesAgent = nextRuntime.hermesAgent;
  process.env.MCP_LOCK_WORKSPACE = resolvedWorkspaceRoot;

  const entry = {
    ts_utc: new Date().toISOString(),
    owner,
    reason,
    previous_workspace_root: previousWorkspaceRoot,
    workspace_root: resolvedWorkspaceRoot
  };
  workspaceSwitchHistory.push(entry);
  if (workspaceSwitchHistory.length > 25) workspaceSwitchHistory.shift();

  return {
    ok: true,
    status: previousWorkspaceRoot === resolvedWorkspaceRoot ? "unchanged" : "switched",
    previous_workspace_root: previousWorkspaceRoot,
    workspace_root: resolvedWorkspaceRoot,
    state_dir: manager.paths.stateDir,
    state_dir_name: nextRuntime.stateDirName,
    registry_provider_count: nextRuntime.registryProviderCount,
    registry_load_ok: nextRuntime.registryLoadOk,
    reason,
    recent_workspace_switches: workspaceSwitchHistory.slice(-10)
  };
}

await activateWorkspace(configuredWorkspaceRoot, { owner: "system", reason: "startup", validateExists: false });

const server = new McpServer({
  name: "hermes3d-lock-orchestrator",
  version: "0.7.0"
});

// Tightened owner regex: lowercase + digits + hyphen, must start with a letter,
// 2-64 chars. Rejects whitespace, control chars, prompt-injection markers.
const Owner = z
  .string()
  .regex(/^[a-z][a-z0-9-]{1,63}$/, "owner must match ^[a-z][a-z0-9-]{1,63}$")
  .describe("Unique agent/session owner, e.g. claude-lead, codex-impl-01, windsurf-cascade.");

const Files = z.array(z.string().min(1)).min(1).describe("Workspace-relative file paths to lock, release, or hand off.");
const WorkspaceRoot = z.string().min(1).describe("Absolute local workspace directory to govern with HermesProof locks.");
const JsonObject = z.record(z.any()).optional().default({});
const EventStatus = z.enum(["outbox", "handled", "failed", "all"]).default("outbox");
const EventType = z.enum([
  "task.enqueued",
  "task.claimed",
  "task.released",
  "task.blocked",
  "task.recovered",
  "agent.presence",
  "message.sent",
  "message.acked",
  "unlock.requested",
  "work.completed",
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
const PresenceStatus = z.enum(["working", "idle", "blocked", "waiting", "reviewing", "testing", "done"]).default("working");
const MessageType = z.enum(["note", "unlock_request", "handoff", "blocker", "completion", "ping"]).default("note");
const MessagePriority = z.enum(["low", "normal", "high", "urgent"]).default("normal");
const MessageAckStatus = z.enum(["acknowledged", "done", "dismissed"]).default("acknowledged");
const CompletionStatus = z.enum(["completed", "blocked", "partial"]).default("completed");
const LegacyPathId = z
  .string()
  .min(2)
  .max(128)
  .regex(/^[A-Za-z0-9._-]+$/, "id must match ^[A-Za-z0-9._-]+$")
  .refine((id) => !id.includes(".."), "id must not contain parent refs");
const TaskId = LegacyPathId.describe("Stable task id safe for use as a state-file path component.");
const OptionalTaskId = z.union([LegacyPathId, z.literal("")]).default("");

function toolResult(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }]
  };
}

function toolError(err) {
  return toolResult({ ok: false, status: "error", message: err?.message || String(err) });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function queueCounts(queue) {
  return {
    pending: queue?.pending?.length || 0,
    claimed: queue?.claimed?.length || 0,
    blocked: queue?.blocked?.length || 0,
    done: queue?.done?.length || 0
  };
}

function clampNumber(value, { min, max, fallback }) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function secondsFromNow(seconds) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function isPastIso(iso) {
  return typeof iso === "string" && new Date(iso).getTime() < Date.now();
}

function presencePath(owner) {
  return path.join(manager.paths.presenceDir, `${owner}.json`);
}

function inboxDir(owner) {
  return path.join(manager.paths.inboxDir, owner);
}

function inboxMessagePath(owner, messageId) {
  return path.join(inboxDir(owner), `${messageId}.json`);
}

function normalizeTags(values = []) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean)
    .map((value) => value.replace(/[^a-z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 64))
    .filter(Boolean)
  )].sort();
}

async function updatePresenceRecord({
  owner,
  role = "agent",
  status = "working",
  taskId = "",
  files = [],
  skills = [],
  taskTypes = [],
  note = "",
  ttlSeconds = 120,
  canInterrupt = true,
  waitingOn = "",
  etaUtc = "",
  emit = true
} = {}) {
  const normalizedFiles = Array.isArray(files) && files.length ? manager.normalizeFiles(files) : [];
  const ttl = clampNumber(ttlSeconds, { min: 30, max: 86_400, fallback: 120 });
  const previous = await readJson(presencePath(owner), null);
  const record = {
    owner,
    role,
    status,
    task_id: taskId || null,
    files: normalizedFiles,
    skills: normalizeTags(skills),
    task_types: normalizeTags(taskTypes),
    note,
    can_interrupt: canInterrupt !== false,
    waiting_on: waitingOn || null,
    eta_utc: etaUtc || null,
    updated_utc: utcNow(),
    expires_utc: secondsFromNow(ttl),
    ttl_seconds: ttl
  };
  await writeJsonAtomic(presencePath(owner), record);
  const changed =
    !previous ||
    previous.status !== record.status ||
    previous.task_id !== record.task_id ||
    previous.waiting_on !== record.waiting_on;
  if (emit && changed) {
    await manager.emitManualEvent({
      event_type: "agent.presence",
      owner,
      task_id: taskId || null,
      files: normalizedFiles,
      summary: `${owner} is ${status}`,
      next_actor: status === "blocked" ? "human" : "unassigned",
      recommended_action: status === "blocked" ? "fix_scope" : "acknowledge",
      payload: { role, status, note, can_interrupt: record.can_interrupt, waiting_on: record.waiting_on }
    });
  }
  return { ok: true, status: "updated", presence: { ...record, is_stale: false } };
}

async function listPresenceRecords({ includeStale = true } = {}) {
  await ensureDir(manager.paths.presenceDir);
  const names = await fs.readdir(manager.paths.presenceDir).catch(() => []);
  const records = [];
  for (const name of names.filter((item) => item.endsWith(".json"))) {
    const record = await readJson(path.join(manager.paths.presenceDir, name), null);
    if (!record) continue;
    const isStale = isPastIso(record.expires_utc);
    if (!includeStale && isStale) continue;
    records.push({ ...record, is_stale: isStale });
  }
  records.sort((a, b) => Number(a.is_stale) - Number(b.is_stale) || a.owner.localeCompare(b.owner));
  return { ok: true, workspace_root: manager.workspaceRoot, count: records.length, presence: records };
}

async function findAgentCandidates({
  requiredSkills = [],
  taskType = "",
  includeBusy = true,
  limit = 10
} = {}) {
  const required = normalizeTags(requiredSkills);
  const taskTag = normalizeTags(taskType ? [taskType] : [])[0] || "";
  const [presence, locks] = await Promise.all([
    listPresenceRecords({ includeStale: false }),
    manager.listLocks()
  ]);
  const lockCounts = new Map();
  for (const lock of locks.locks) {
    lockCounts.set(lock.owner, (lockCounts.get(lock.owner) || 0) + 1);
  }
  const candidates = [];
  for (const record of presence.presence) {
    const skills = normalizeTags(record.skills || []);
    const taskTypes = normalizeTags(record.task_types || []);
    const missing = required.filter((skill) => !skills.includes(skill));
    if (missing.length) continue;
    if (taskTag && taskTypes.length && !taskTypes.includes(taskTag)) continue;
    const busy = ["working", "reviewing", "testing"].includes(record.status);
    if (!includeBusy && busy) continue;
    const activeLockCount = lockCounts.get(record.owner) || 0;
    const score =
      100 +
      required.length * 10 +
      (taskTag && taskTypes.includes(taskTag) ? 10 : 0) +
      (record.status === "idle" ? 20 : 0) +
      (record.status === "waiting" ? 10 : 0) +
      (record.can_interrupt ? 5 : -20) -
      activeLockCount * 3;
    candidates.push({
      owner: record.owner,
      role: record.role,
      status: record.status,
      skills,
      task_types: taskTypes,
      can_interrupt: record.can_interrupt,
      active_lock_count: activeLockCount,
      score,
      missing_required_skills: missing,
      note: record.note || ""
    });
  }
  candidates.sort((a, b) => b.score - a.score || a.owner.localeCompare(b.owner));
  const bounded = clampNumber(limit, { min: 1, max: 50, fallback: 10 });
  return {
    ok: true,
    workspace_root: manager.workspaceRoot,
    required_skills: required,
    task_type: taskTag || null,
    count: candidates.length,
    candidates: candidates.slice(0, bounded)
  };
}

async function sendInboxMessage({
  sender,
  recipients,
  type = "note",
  priority = "normal",
  subject = "",
  body = "",
  taskId = "",
  files = [],
  requiresAck = true,
  metadata = {}
} = {}) {
  const normalizedFiles = Array.isArray(files) && files.length ? manager.normalizeFiles(files) : [];
  const now = utcNow();
  const written = [];
  for (const recipient of [...new Set(recipients)]) {
    const messageId = `msg_${shaId(`${sender}:${recipient}:${subject}:${now}:${Math.random()}`, 16)}`;
    const message = {
      id: messageId,
      status: "unread",
      type,
      priority,
      sender,
      recipient,
      subject,
      body,
      task_id: taskId || null,
      files: normalizedFiles,
      requires_ack: requiresAck !== false,
      metadata,
      created_utc: now,
      acked_utc: null,
      ack_status: null,
      ack_note: null
    };
    await ensureDir(inboxDir(recipient));
    await writeJsonAtomic(inboxMessagePath(recipient, messageId), message);
    written.push(message);
  }
  await manager.emitManualEvent({
    event_type: "message.sent",
    owner: sender,
    task_id: taskId || null,
    files: normalizedFiles,
    summary: subject || `Message from ${sender}`,
    next_actor: "unassigned",
    recommended_action: requiresAck === false ? "acknowledge" : "review_handoff",
    payload: {
      type,
      priority,
      recipients: [...new Set(recipients)],
      message_ids: written.map((message) => message.id),
      metadata
    }
  });
  return { ok: true, status: "sent", count: written.length, messages: written };
}

async function readInbox({ owner, includeAcked = false, type = "", limit = 50 } = {}) {
  await ensureDir(inboxDir(owner));
  const names = await fs.readdir(inboxDir(owner)).catch(() => []);
  const messages = [];
  for (const name of names.filter((item) => item.endsWith(".json"))) {
    const message = await readJson(path.join(inboxDir(owner), name), null);
    if (!message) continue;
    if (!includeAcked && message.acked_utc) continue;
    if (type && message.type !== type) continue;
    messages.push(message);
  }
  messages.sort((a, b) => String(b.created_utc).localeCompare(String(a.created_utc)));
  const bounded = clampNumber(limit, { min: 1, max: 500, fallback: 50 });
  return { ok: true, owner, count: messages.length, messages: messages.slice(0, bounded) };
}

async function ackInboxMessage({ owner, messageId, status = "acknowledged", note = "" } = {}) {
  const file = inboxMessagePath(owner, messageId);
  const message = await readJson(file, null);
  if (!message) return { ok: false, status: "missing", message_id: messageId };
  message.status = status;
  message.acked_utc = utcNow();
  message.ack_status = status;
  message.ack_note = note;
  await writeJsonAtomic(file, message);
  await manager.emitManualEvent({
    event_type: "message.acked",
    owner,
    task_id: message.task_id || null,
    files: message.files || [],
    summary: `Message ${status}: ${message.subject || message.id}`,
    next_actor: "unassigned",
    recommended_action: "acknowledge",
    payload: { message_id: message.id, sender: message.sender, status, note }
  });
  return { ok: true, status, message };
}

async function getUnlockState({ requester, files }) {
  const requestedFiles = manager.normalizeFiles(files);
  const [locks, state] = await Promise.all([
    manager.listLocks(),
    manager.getStateSummary()
  ]);
  const locksByFile = new Map(locks.locks.map((lock) => [lock.file, lock]));
  const unlocked = [];
  const ownedByRequester = [];
  const blocked = [];
  const stale = [];
  for (const file of requestedFiles) {
    const lock = locksByFile.get(file);
    if (!lock) {
      unlocked.push(file);
    } else if (lock.owner === requester) {
      ownedByRequester.push(file);
    } else if (lock.is_stale) {
      stale.push(lock);
      blocked.push(lock);
    } else {
      blocked.push(lock);
    }
  }
  const relevantHandoffs = state.handoffs.filter((handoff) =>
    handoff.requester === requester &&
    Array.isArray(handoff.files) &&
    handoff.files.some((file) => requestedFiles.includes(file))
  );
  const denied = relevantHandoffs.filter((handoff) => handoff.status === "denied");
  const pending = relevantHandoffs.filter((handoff) => handoff.status === "requested");
  let status = "blocked";
  if (blocked.length === 0) status = "ready";
  else if (denied.length) status = "denied";
  else if (stale.length === blocked.length) status = "stale_available";
  else if (pending.length) status = "pending";
  return {
    ok: true,
    status,
    workspace_root: manager.workspaceRoot,
    requested_files: requestedFiles,
    unlocked,
    owned_by_requester: ownedByRequester,
    blocked,
    stale,
    pending_handoffs: pending,
    denied_handoffs: denied,
    relevant_handoffs: relevantHandoffs
  };
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
  "hermes_get_workspace",
  {
    title: "Get active workspace",
    description: "Read the active workspace root, state directory, environment mapping, and recent runtime workspace switches.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  },
  async () => {
    try { return toolResult(workspaceSnapshot()); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_set_workspace",
  {
    title: "Set active workspace",
    description: "Switch the active workspace root for subsequent HermesProof tool calls. The target path has to be an existing absolute directory.",
    inputSchema: {
      owner: Owner.default("agent"),
      workspaceRoot: WorkspaceRoot,
      reason: z.string().default(""),
      allowActiveLocks: z.boolean().default(false)
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false }
  },
  async (args) => {
    try {
      const result = await activateWorkspace(args.workspaceRoot, {
        owner: args.owner,
        reason: args.reason || "runtime workspace switch",
        validateExists: true,
        allowActiveLocks: args.allowActiveLocks === true
      });
      const evidence = await manager.appendEvidence({
        owner: args.owner,
        kind: "workspace.switch",
        summary: `HermesProof workspace ${result.status}: ${result.workspace_root}`,
        data: {
          previous_workspace_root: result.previous_workspace_root,
          workspace_root: result.workspace_root,
          reason: result.reason,
          allow_active_locks: args.allowActiveLocks === true
        }
      });
      return toolResult({ ...result, evidence: evidence.evidence });
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_live_status",
  {
    title: "Live coordination status",
    description: "Read a compact coordination snapshot for the active workspace: locks, stale locks, queue counts, outbox events, and anonymous-agent state.",
    inputSchema: {
      includeEvents: z.boolean().default(true),
      includeAgents: z.boolean().default(true),
      includePresence: z.boolean().default(true),
      eventLimit: z.number().int().min(1).max(50).default(20)
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    try {
      const [state, events, agentState, presence] = await Promise.all([
        manager.getStateSummary(),
        args?.includeEvents === false ? null : manager.listEvents({ status: "outbox", limit: args?.eventLimit || 20 }),
        args?.includeAgents === false ? null : anon.getState(),
        args?.includePresence === false ? null : listPresenceRecords({ includeStale: true })
      ]);
      const staleLocks = state.locks.filter((lock) => lock.is_stale);
      return toolResult({
        ok: true,
        workspace_root: state.workspace_root,
        state_dir: state.state_dir,
        active_lock_count: state.locks.length,
        stale_lock_count: staleLocks.length,
        stale_locks: staleLocks,
        queue_counts: queueCounts(state.queue),
        handoff_count: state.handoffs.length,
        task_count: state.tasks.length,
        outbox_event_count: events?.count || 0,
        recent_outbox_events: events?.events || [],
        anonymous_agents: agentState || null,
        presence: presence?.presence || [],
        workspace: workspaceSnapshot()
      });
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_update_presence",
  {
    title: "Update agent presence",
    description: "Write the caller's live status, current task, owned files, wait reason, interrupt preference, and expiry.",
    inputSchema: {
      owner: Owner,
      role: z.string().default("agent"),
      status: PresenceStatus,
      taskId: OptionalTaskId,
      files: z.array(z.string()).default([]),
      skills: z.array(z.string()).default([]),
      taskTypes: z.array(z.string()).default([]),
      note: z.string().default(""),
      ttlSeconds: z.number().int().min(30).max(86_400).default(120),
      canInterrupt: z.boolean().default(true),
      waitingOn: z.string().default(""),
      etaUtc: z.string().default("")
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    try {
      return toolResult(await updatePresenceRecord({
        owner: args.owner,
        role: args.role,
        status: args.status,
        taskId: args.taskId || "",
        files: args.files || [],
        skills: args.skills || [],
        taskTypes: args.taskTypes || [],
        note: args.note || "",
        ttlSeconds: args.ttlSeconds,
        canInterrupt: args.canInterrupt !== false,
        waitingOn: args.waitingOn || "",
        etaUtc: args.etaUtc || ""
      }));
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_list_presence",
  {
    title: "List agent presence",
    description: "List live and stale agent presence records for the active workspace.",
    inputSchema: {
      includeStale: z.boolean().default(true)
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    try { return toolResult(await listPresenceRecords({ includeStale: args?.includeStale !== false })); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_find_agents",
  {
    title: "Find agents by skills",
    description: "Rank live agents by advertised skills, task affinity, interrupt preference, and current lock load.",
    inputSchema: {
      requiredSkills: z.array(z.string()).default([]),
      taskType: z.string().default(""),
      includeBusy: z.boolean().default(true),
      limit: z.number().int().min(1).max(50).default(10)
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    try {
      return toolResult(await findAgentCandidates({
        requiredSkills: args?.requiredSkills || [],
        taskType: args?.taskType || "",
        includeBusy: args?.includeBusy !== false,
        limit: args?.limit || 10
      }));
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_send_message",
  {
    title: "Send agent message",
    description: "Send a durable inbox message to one or more agents in the active workspace.",
    inputSchema: {
      sender: Owner,
      recipients: z.array(Owner).min(1),
      type: MessageType,
      priority: MessagePriority,
      subject: z.string().min(1).max(200),
      body: z.string().default(""),
      taskId: OptionalTaskId,
      files: z.array(z.string()).default([]),
      requiresAck: z.boolean().default(true),
      metadata: z.record(z.any()).default({})
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false }
  },
  async (args) => {
    try {
      return toolResult(await sendInboxMessage({
        sender: args.sender,
        recipients: args.recipients,
        type: args.type,
        priority: args.priority,
        subject: args.subject,
        body: args.body || "",
        taskId: args.taskId || "",
        files: args.files || [],
        requiresAck: args.requiresAck !== false,
        metadata: args.metadata || {}
      }));
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_get_inbox",
  {
    title: "Get agent inbox",
    description: "Read durable inbox messages for one owner, with optional acknowledged-message filtering.",
    inputSchema: {
      owner: Owner,
      includeAcked: z.boolean().default(false),
      type: z.string().default(""),
      limit: z.number().int().min(1).max(500).default(50)
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    try {
      return toolResult(await readInbox({
        owner: args.owner,
        includeAcked: args.includeAcked === true,
        type: args.type || "",
        limit: args.limit || 50
      }));
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_ack_message",
  {
    title: "Acknowledge message",
    description: "Mark one inbox message acknowledged, done, or dismissed and emit an acknowledgement event.",
    inputSchema: {
      owner: Owner,
      messageId: LegacyPathId,
      status: MessageAckStatus,
      note: z.string().default("")
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    try {
      return toolResult(await ackInboxMessage({
        owner: args.owner,
        messageId: args.messageId,
        status: args.status,
        note: args.note || ""
      }));
    } catch (err) { return toolError(err); }
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
      taskId: TaskId.optional().describe("Stable task id, e.g. CP-UX-A-CODEX."),
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
      taskId: TaskId,
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
      taskId: OptionalTaskId,
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
  "hermes_complete_work",
  {
    title: "Complete work and release",
    description: "Record completion evidence, release owned locks, optionally release the task, update presence, and notify recipients.",
    inputSchema: {
      owner: Owner,
      taskId: OptionalTaskId,
      files: z.array(z.string()).default([]),
      summary: z.string().min(1).max(2000),
      status: CompletionStatus,
      evidenceKind: z.string().default("completion"),
      data: z.record(z.any()).default({}),
      releaseFiles: z.boolean().default(true),
      releaseTask: z.boolean().default(true),
      notifyRecipients: z.array(Owner).default([])
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: false }
  },
  async (args) => {
    try {
      const locks = await manager.listLocks();
      const files = Array.isArray(args.files) && args.files.length
        ? manager.normalizeFiles(args.files)
        : locks.locks.filter((lock) => lock.owner === args.owner).map((lock) => lock.file);
      const evidence = await manager.appendEvidence({
        owner: args.owner,
        taskId: args.taskId || "",
        kind: args.evidenceKind || "completion",
        summary: args.summary,
        data: {
          status: args.status,
          files,
          ...args.data
        }
      });
      const releaseResult = args.releaseFiles === false
        ? { ok: true, status: "skipped", released: [], blocked: [], missing: [] }
        : await manager.releaseFiles({ owner: args.owner, files, note: args.summary });
      const taskResult = args.releaseTask === false || !args.taskId
        ? { ok: true, status: "skipped" }
        : await manager.releaseTask({ owner: args.owner, taskId: args.taskId, note: args.summary });
      const previousPresence = await readJson(presencePath(args.owner), null);
      const presence = await updatePresenceRecord({
        owner: args.owner,
        role: previousPresence?.role || "agent",
        status: args.status === "blocked" ? "blocked" : "done",
        taskId: args.taskId || "",
        files: [],
        skills: previousPresence?.skills || [],
        taskTypes: previousPresence?.task_types || [],
        note: args.summary,
        ttlSeconds: 300,
        canInterrupt: true
      });
      let notifications = [];
      if (Array.isArray(args.notifyRecipients) && args.notifyRecipients.length) {
        const sent = await sendInboxMessage({
          sender: args.owner,
          recipients: args.notifyRecipients,
          type: "completion",
          priority: "normal",
          subject: `Work ${args.status}: ${args.taskId || args.owner}`,
          body: args.summary,
          taskId: args.taskId || "",
          files,
          requiresAck: false,
          metadata: { evidence_id: evidence.evidence.id, status: args.status }
        });
        notifications = sent.messages;
      }
      await manager.emitManualEvent({
        event_type: "work.completed",
        owner: args.owner,
        task_id: args.taskId || null,
        files,
        summary: args.summary,
        next_actor: "unassigned",
        recommended_action: args.status === "blocked" ? "fix_scope" : "acknowledge",
        payload: {
          status: args.status,
          evidence_id: evidence.evidence.id,
          released: releaseResult.released || [],
          blocked: releaseResult.blocked || [],
          missing: releaseResult.missing || []
        }
      });
      return toolResult({
        ok: releaseResult.ok !== false && taskResult.ok !== false,
        status: args.status,
        evidence: evidence.evidence,
        release: releaseResult,
        task: taskResult,
        presence: presence.presence,
        notifications,
        next_tools: ["hermes_live_status"]
      });
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_heartbeat",
  {
    title: "Heartbeat owned locks",
    description: "Refresh locks for a running task/session so other agents know the owner is still active.",
    inputSchema: {
      owner: Owner,
      taskId: OptionalTaskId
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
      taskId: OptionalTaskId
    },
    annotations: { readOnlyHint: false, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    try { return toolResult(await manager.requestHandoff(args)); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_request_unlock",
  {
    title: "Request unlock",
    description: "Create handoff requests for locked files without requiring the requester to know each current owner first.",
    inputSchema: {
      requester: Owner,
      files: Files,
      reason: z.string().default(""),
      taskId: OptionalTaskId,
      priority: MessagePriority,
      neededByUtc: z.string().default(""),
      deadlineMinutes: z.number().int().min(1).max(1440).default(30)
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    try {
      const requestedFiles = manager.normalizeFiles(args.files);
      const locks = await manager.listLocks();
      const locksByFile = new Map(locks.locks.map((lock) => [lock.file, lock]));
      const unlocked = [];
      const ownedByRequester = [];
      const lockedByOwner = new Map();
      const staleLocked = [];

      for (const file of requestedFiles) {
        const lock = locksByFile.get(file);
        if (!lock) {
          unlocked.push(file);
          continue;
        }
        if (lock.owner === args.requester) {
          ownedByRequester.push(file);
          continue;
        }
        if (lock.is_stale) {
          staleLocked.push(lock);
          continue;
        }
        const group = lockedByOwner.get(lock.owner) || [];
        group.push(file);
        lockedByOwner.set(lock.owner, group);
      }

      const handoffRequests = [];
      const notifications = [];
      const failures = [];
      for (const [currentOwner, files] of lockedByOwner.entries()) {
        const result = await manager.requestHandoff({
          requester: args.requester,
          currentOwner,
          files,
          reason: args.reason || "unlock requested",
          taskId: args.taskId || ""
        });
        if (result.ok) {
          handoffRequests.push(result.handoff);
          const notification = await sendInboxMessage({
            sender: args.requester,
            recipients: [currentOwner],
            type: "unlock_request",
            priority: args.priority || "normal",
            subject: `Unlock requested by ${args.requester}`,
            body: args.reason || "Unlock requested for coordinated work.",
            taskId: args.taskId || "",
            files,
            requiresAck: true,
            metadata: {
              handoff_request_id: result.handoff.id,
              needed_by_utc: args.neededByUtc || null,
              deadline_minutes: args.deadlineMinutes || 30
            }
          });
          notifications.push(...notification.messages);
        } else {
          failures.push({ current_owner: currentOwner, files, result });
        }
      }

      const status = failures.length
        ? "partial"
        : handoffRequests.length
          ? staleLocked.length ? "requested_with_stale" : "requested"
          : staleLocked.length ? "stale_available" : "not_needed";
      if (handoffRequests.length || staleLocked.length) {
        await manager.emitManualEvent({
          event_type: "unlock.requested",
          owner: args.requester,
          task_id: args.taskId || null,
          files: requestedFiles,
          summary: `Unlock requested by ${args.requester}`,
          next_actor: "unassigned",
          recommended_action: "review_handoff",
          payload: {
            priority: args.priority || "normal",
            handoff_request_ids: handoffRequests.map((handoff) => handoff.id),
            stale_files: staleLocked.map((lock) => lock.file),
            needed_by_utc: args.neededByUtc || null,
            deadline_minutes: args.deadlineMinutes || 30
          }
        });
      }
      return toolResult({
        ok: failures.length === 0,
        status,
        workspace_root: manager.workspaceRoot,
        requested_files: requestedFiles,
        unlocked,
        owned_by_requester: ownedByRequester,
        stale_locked: staleLocked,
        handoff_requests: handoffRequests,
        notifications,
        failures,
        next_tools: [
          ...(handoffRequests.length ? ["hermes_wait_for_unlock", "hermes_get_inbox", "hermes_approve_handoff"] : []),
          ...(staleLocked.length ? ["hermes_recover_stale_locks"] : [])
        ]
      });
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_wait_for_unlock",
  {
    title: "Wait for unlock",
    description: "Wait until requested files are available, transferred, denied, stale, or timed out.",
    inputSchema: {
      requester: Owner,
      files: Files,
      timeoutMs: z.number().int().min(0).max(120_000).default(30_000),
      pollMs: z.number().int().min(250).max(5_000).default(1_000)
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    try {
      const timeoutMs = clampNumber(args?.timeoutMs, { min: 0, max: 120_000, fallback: 30_000 });
      const pollMs = clampNumber(args?.pollMs, { min: 250, max: 5_000, fallback: 1_000 });
      const deadline = Date.now() + timeoutMs;
      let state = await getUnlockState({ requester: args.requester, files: args.files });
      while (!["ready", "denied", "stale_available"].includes(state.status) && Date.now() < deadline) {
        await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
        state = await getUnlockState({ requester: args.requester, files: args.files });
      }
      return toolResult({
        ...state,
        status: ["ready", "denied", "stale_available"].includes(state.status) ? state.status : "timeout",
        timeout_ms: timeoutMs,
        poll_ms: pollMs,
        next_tools:
          state.status === "ready"
            ? ["hermes_lock_files"]
            : state.status === "stale_available"
              ? ["hermes_recover_stale_locks"]
              : state.status === "denied"
                ? ["hermes_send_message", "hermes_find_agents"]
                : ["hermes_live_status", "hermes_get_inbox"]
      });
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_approve_handoff",
  {
    title: "Approve or deny handoff",
    description: "Approve or deny a handoff request. Only the current lock owner can approve. Approval transfers lock ownership; denial keeps the lock.",
    inputSchema: {
      owner: Owner,
      requestId: LegacyPathId,
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
  "hermes_wait_for_events",
  {
    title: "Wait for events",
    description: "Long-poll the active workspace event outbox and return events newer than an optional event id.",
    inputSchema: {
      status: EventStatus,
      afterEventId: z.string().default(""),
      limit: z.number().int().min(1).max(100).default(25),
      timeoutMs: z.number().int().min(0).max(55_000).default(15_000),
      pollMs: z.number().int().min(250).max(5_000).default(1_000)
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    try {
      const status = args?.status || "outbox";
      const limit = Math.max(1, Math.min(100, Number(args?.limit || 25)));
      const afterEventId = String(args?.afterEventId || "");
      const timeoutMs = Math.max(0, Math.min(55_000, Number(args?.timeoutMs || 15_000)));
      const pollMs = Math.max(250, Math.min(5_000, Number(args?.pollMs || 1_000)));
      const deadline = Date.now() + timeoutMs;
      let listed = null;
      let events = [];

      do {
        listed = await manager.listEvents({ status, limit: 500 });
        events = listed.events || [];
        if (afterEventId) {
          const index = events.findIndex((event) => event.event_id === afterEventId);
          events = index >= 0
            ? events.slice(index + 1)
            : events.filter((event) => String(event.event_id || "") > afterEventId);
        }
        if (events.length || Date.now() >= deadline) break;
        await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
      } while (Date.now() <= deadline);

      const limitedEvents = events.slice(0, limit);
      return toolResult({
        ok: true,
        status: limitedEvents.length ? "events" : "timeout",
        workspace_root: manager.workspaceRoot,
        event_status: status,
        count: limitedEvents.length,
        total_seen: listed?.count || 0,
        after_event_id: afterEventId || null,
        last_event_id: limitedEvents.at(-1)?.event_id || afterEventId || null,
        timeout_ms: timeoutMs,
        poll_ms: pollMs,
        events: limitedEvents
      });
    } catch (err) { return toolError(err); }
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
      task_id: TaskId,
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
    description: "Run non-destructive pre-flight checks: workspace exists, state dir is writable, env vars set, git presence, Node version. Returns findings with suggested fixes. Result is cached for 30s; pass force_refresh=true to re-probe.",
    inputSchema: {
      force_refresh: z.boolean().optional()
        .describe("Bypass the 30s in-memory cache and re-probe the environment. Default false.")
    },
    annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    try {
      return toolResult(await manager.doctor({ force_refresh: args?.force_refresh === true }));
    } catch (err) { return toolError(err); }
  }
);

// ---------------------------------------------------------------------------
// v0.7 — Anonymous orchestration: skill-rotation, reputation, dispatch, A2A
// ---------------------------------------------------------------------------

registerTool(
  "hermes_list_agents",
  {
    title: "List agents",
    description: "List active agents with their role, skill histogram, reputation score, and dispatch ranking for an optional task_type. Combines anonymous orchestrator state with skill-rotation and reputation data. Pass task_type to see routing recommendations.",
    inputSchema: {
      task_type: z.string().optional()
        .describe("Task type to compute dispatch ranking for (e.g. 'gate', 'review', 'build'). Optional."),
      include_history: z.boolean().optional()
        .describe("Include recent reputation events. Default false.")
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    try {
      // P1-14 (audit 2026-05-03): also pull anonymous orchestrator state so a
      // newly-claimed role with no recorded task is still visible. Pre-fix the
      // tool described "active agents with their role" but the implementation
      // only built actors from skill+reputation ledgers, missing role claimers.
      const [allSkills, leaderboard, anonState] = await Promise.all([
        skills.listActors(),
        reputation.leaderboard(),
        anon.getState(),
      ]);
      const repMap = Object.fromEntries(leaderboard.map((a) => [a.actor_id, a]));

      // Build per-actor roles map from anon-orch state. Each actor can hold
      // multiple roles concurrently (e.g. BUILDER + GATE-SMITH).
      const rolesByActor = new Map();
      const anonActorIds = new Set();
      for (const [role, claimers] of Object.entries(anonState.active_roles || {})) {
        for (const claim of claimers) {
          anonActorIds.add(claim.actor_id);
          if (!rolesByActor.has(claim.actor_id)) rolesByActor.set(claim.actor_id, []);
          rolesByActor.get(claim.actor_id).push({
            role,
            claimed_at: claim.claimed_at,
            expires_at: claim.expires_at,
            purpose: claim.purpose ?? null,
          });
        }
      }

      const allActorIds = [...new Set([
        ...Object.keys(allSkills),
        ...leaderboard.map((a) => a.actor_id),
        ...anonActorIds,
      ])];

      let dispatchRanks = {};
      if (args?.task_type) {
        const ranked = await dispatch.rankActors(args.task_type, allActorIds);
        for (const r of ranked) dispatchRanks[r.actor_id] = r.dispatch_score;
      }

      // include_history requires per-actor recent_events; reputation.leaderboard()
      // does not surface them (only score/total_outcomes), so resolve them via
      // reputation.getScore() per actor only when the flag is set.
      const historyMap = {};
      if (args?.include_history) {
        const records = await Promise.all(allActorIds.map((id) => reputation.getScore(id)));
        for (let i = 0; i < allActorIds.length; i++) {
          historyMap[allActorIds[i]] = records[i]?.recent_events ?? [];
        }
      }

      const agents = allActorIds.map((actor_id) => {
        const skill = allSkills[actor_id] ?? { task_counts: {}, last_active_ts: 0, total_tasks: 0 };
        const rep = repMap[actor_id] ?? { score: 1.0, total_outcomes: 0 };
        const entry = {
          actor_id,
          reputation_score: rep.score,
          total_outcomes: rep.total_outcomes,
          total_tasks: skill.total_tasks,
          task_counts: skill.task_counts,
          last_active_ts: skill.last_active_ts,
          roles: rolesByActor.get(actor_id) ?? [],
        };
        if (args?.task_type) entry.dispatch_score = dispatchRanks[actor_id] ?? 0;
        if (args?.include_history) entry.recent_events = historyMap[actor_id] ?? [];
        return entry;
      });

      agents.sort((a, b) => b.reputation_score - a.reputation_score);
      return toolResult({ agents, count: agents.length });
    } catch (err) { return toolError(err); }
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
  "hermes_record_outcome",
  {
    title: "Record outcome",
    description: "Record a task outcome (merge/lgtm/timeout/reject) for an actor. Updates their rolling reputation score. Used by CI, review gates, and the merge-master pattern. Outcomes: merge=+1.0, lgtm=+0.5, timeout=-0.25, reject=-1.0.",
    inputSchema: {
      actor_id: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/)
        .describe("Actor ID that produced the outcome."),
      outcome: z.enum(["merge", "lgtm", "timeout", "reject"])
        .describe("Outcome type: merge | lgtm | timeout | reject"),
      context: z.string().max(200).optional()
        .describe("Optional free-text annotation (PR number, gate name, etc.).")
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  },
  async (args) => {
    try {
      const result = await reputation.recordOutcome(args.actor_id, args.outcome, args.context);
      await skills.recordTask(args.actor_id, "outcome_" + args.outcome);
      return toolResult(result);
    } catch (err) { return toolError(err); }
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
  "hermes_record_task",
  {
    title: "Record task",
    description: "Record that an actor performed a task of a given type. Updates their skill histogram for load-balanced routing. Task types: gate, lock, review, handoff, build, docs, test, infra.",
    inputSchema: {
      actor_id: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/)
        .describe("Actor ID performing the task."),
      task_type: z.string().min(1).max(40)
        .describe("Task type identifier (gate | lock | review | handoff | build | docs | test | infra).")
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  },
  async (args) => {
    try {
      const result = await skills.recordTask(args.actor_id, args.task_type);
      return toolResult(result);
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_anonymous_state",
  {
    title: "Read anonymous orchestrator state",
    description: "Read-only view of active role claims and (redacted) active user session. Hash field is redacted.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
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
  "hermes_dispatch_recommend",
  {
    title: "Dispatch recommendation",
    description: "Get a routing recommendation: which actor from a candidate list is best suited for the given task_type, based on reputation and skill-balance. Returns actor_id, composite score, and reasoning string.",
    inputSchema: {
      task_type: z.string().min(1).max(40)
        .describe("Task type to route."),
      candidates: z.array(z.string().regex(/^[a-z][a-z0-9-]{1,63}$/)).min(1).max(50)
        .describe("Candidate actor IDs to choose from.")
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    try {
      const result = await dispatch.recommend(args.task_type, args.candidates);
      return toolResult(result);
    } catch (err) { return toolError(err); }
  }
);

// A2A protocol tools

registerTool(
  "hermes_a2a_create_task",
  {
    title: "A2A: create task",
    description: "Create an Agent-to-Agent task. Returns a task_id and initial status 'submitted'. The submitting agent is responsible for transitioning the task to 'working' once execution begins.",
    inputSchema: {
      agent_id: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/)
        .describe("Agent submitting the task."),
      task_type: z.string().min(1).max(40)
        .describe("Task type (e.g. gate_run, review, build, merge_check)."),
      input: z.record(z.unknown()).optional()
        .describe("Task parameters, opaque to the orchestrator.")
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  },
  async (args) => {
    try {
      const result = await a2a.createTask({ agent_id: args.agent_id, task_type: args.task_type, input: args.input });
      return toolResult(result);
    } catch (err) { return toolError(err); }
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
  "hermes_a2a_get_task",
  {
    title: "A2A: get task",
    description: "Get the current state of an A2A task by ID. Returns status, input, output (if completed), and error (if failed).",
    inputSchema: {
      task_id: z.string().min(1).max(80)
        .describe("A2A task ID returned by hermes_a2a_create_task.")
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    try {
      const task = await a2a.getTask(args.task_id);
      if (!task) return toolResult({ ok: false, reason: "task not found" });
      return toolResult(task);
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_user_check_authorization",
  {
    title: "Check AS_USER authorization for an action",
    description: "Returns { allowed, reason, granted_by } for the given action name against the currently active AS_USER session. Lazy-clears expired sessions.",
    inputSchema: { action: z.string().min(1).max(128) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  async ({ action }) => {
    try { return toolResult(await anon.checkUserAuthorization(action)); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_a2a_update_task",
  {
    title: "A2A: update task",
    description: "Transition an A2A task to a new status. Valid transitions: submitted→working, working→{input_required,completed,failed,canceled}, input_required→{working,canceled}. Terminal states (completed,failed,canceled) cannot be changed.",
    inputSchema: {
      task_id: z.string().min(1).max(80)
        .describe("A2A task ID."),
      status: z.enum(["working", "input_required", "completed", "failed", "canceled"])
        .describe("New status."),
      output: z.record(z.unknown()).optional()
        .describe("Task result, set when transitioning to 'completed'."),
      error: z.string().max(500).optional()
        .describe("Error message, set when transitioning to 'failed'.")
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  },
  async (args) => {
    try {
      const result = await a2a.updateTask(args.task_id, args.status, { output: args.output, error: args.error });
      return toolResult(result);
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_agent_health",
  {
    title: "Hermes Agent bridge health probe",
    description: "Probes the configured DeepSeek/MiniMax/SiliconFlow/LM-Studio providers in failover order. Returns the first healthy provider + model. Bridge is disabled by default (set HERMES_AGENT_ENABLED=1).",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  },
  async () => {
    try { return toolResult(await hermesAgent.healthCheck()); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_a2a_list_tasks",
  {
    title: "A2A: list tasks",
    description: "List A2A tasks, optionally filtered by agent_id, status, or task_type. Tasks older than 24h are excluded (auto-archived). Results sorted newest first.",
    inputSchema: {
      agent_id: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/).optional()
        .describe("Filter to tasks submitted by this agent."),
      status: z.enum(["submitted", "working", "input_required", "completed", "failed", "canceled"]).optional()
        .describe("Filter by status."),
      task_type: z.string().min(1).max(40).optional()
        .describe("Filter by task type.")
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    try {
      const tasks = await a2a.listTasks({ agent_id: args?.agent_id, status: args?.status, task_type: args?.task_type });
      return toolResult({ tasks, count: tasks.length });
    } catch (err) { return toolError(err); }
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

// ---------------------------------------------------------------------------
// Shutdown handlers (audit P1-8, 2026-05-03)
// ---------------------------------------------------------------------------
// Pre-fix, the server relied on Node defaults for SIGTERM/SIGINT and on the
// MCP SDK closing stdio when the client disconnected. In-flight async work
// (mutex chains, appendChainedJsonLine, atomic-rename writes, evidence
// appends) could be interrupted mid-step by an immediate process exit,
// leaving torn state — the same family of risks the supervisor's own
// shutdown story addresses for the wrapper layer.
//
// This handler:
//   1. Records the shutdown intent to stderr (visible to the supervisor's log).
//   2. Tells the MCP transport to close — the SDK awaits any in-flight tool
//      handler returns before resolving close().
//   3. Exits 0 (clean) when close succeeded — the supervisor doesn't flag a
//      crash + respawn. Exits 1 if transport.close() threw, since a torn
//      shutdown is signal we want the supervisor (and operators) to see, NOT
//      a clean stop. CodeRabbit follow-up on PR #48 (2026-05-03 audit).
//
// stdin EOF is the MCP-client-disconnect signal; the SDK already exits the
// transport's read loop on EOF, but without an explicit handler the process
// keeps running with nothing to do. Treating EOF as a clean shutdown closes
// the gap.
let _shuttingDown = false;
async function gracefulShutdown(reason) {
  if (_shuttingDown) return;
  _shuttingDown = true;
  process.stderr.write(`[hermesproof] shutdown: ${reason}\n`);
  let exitCode = 0;
  try {
    if (typeof transport.close === "function") {
      await transport.close();
    } else if (typeof server.close === "function") {
      await server.close();
    }
  } catch (err) {
    process.stderr.write(`[hermesproof] shutdown error: ${err?.message || err}\n`);
    exitCode = 1;
  }
  process.exit(exitCode);
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.stdin.on("end", () => gracefulShutdown("stdin EOF (client disconnect)"));
