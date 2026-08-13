#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { config as loadDotenv } from "dotenv";
import { resolveEnvFileCandidate } from "./core/env-file.mjs";
import { HermesLockManager } from "./core/lock-manager.mjs";
import { GateRunner } from "./core/gate-runner.mjs";
import { SkillRotation } from "./core/skill-rotation.mjs";
import { ReputationTracker } from "./core/reputation.mjs";
import { CapabilityDispatch } from "./core/capability-dispatch.mjs";
import { ProviderPerformanceTracker } from "./core/provider-performance.mjs";
import { A2AStub } from "./core/a2a-stub.mjs";
import { AnonymousOrchestrator, ROLES as ANON_ROLES } from "./core/anonymous-orchestrator.mjs";
import { HermesAgentBridge } from "./core/hermes-agent-bridge.mjs";
import { evaluateHelperRuntimeConsensus, evaluateHelperRuntimeEnvelope } from "./core/helper-runtime.mjs";
import { evaluateStaleness } from "./core/staleness.mjs";
import { evaluateStorageCensus } from "./core/storage-census.mjs";
import { evaluateArchivePlan } from "./core/archive-plan.mjs";
import { evaluateWorkspaceHygiene } from "./core/workspace-hygiene.mjs";
import {
  KILOCODE_TASK_TYPE,
  evaluateKilocodeAgentBusEnvelope,
  evaluateKilocodeInstalledVsixReleaseProof,
  evaluateKilocodeInfrastructureProof,
  evaluateKilocodePolicy,
  evaluateKilocodeRoadmapCompletionProof,
  kilocodeStatusSnapshot,
  readKilocodeGuardrails,
  recordKilocodeAgentBusEvent,
  recordKilocodeInfrastructureProof,
  recordKilocodeProgressCheckpoint,
  recordKilocodeDelegation,
  setKilocodeGuardrails
} from "./core/kilocode-integration.mjs";
import { createGitLabClient, resolveGitLabConfig } from "./core/gitlab-client.mjs";
import { loadRegistryProviders } from "./core/registry-providers.mjs";
import {
  HP_HARNESS_ATTRIBUTION_GATE,
  HP_MHA_CONTRACT_VERSION,
  assertLockFilesRespectHoldoutIsolation,
  attestBenchmarkRun,
  computeTraceMetrics,
  evaluateAndRecordPromotion,
  evaluateHpMhaSubGate,
  lockExperimentPlan,
  pruneAndRecordRetention,
  readExperimentReport,
  readTraceIndex,
  recordAttribution,
  recordHarnessCard,
  searchTraceIndex,
  verifyAndRecordTraceBundle,
  writeTraceIndex
} from "./core/hp-mha.mjs";
import {
  ensureDir,
  readJson,
  shaId,
  utcNow,
  writeJsonAtomic
} from "./core/fs-utils.mjs";

let loadedEnvFileInfo = { loaded: false, source: null, status: "not_loaded" };

// Env-file resolution precedence (HermesProof v0.6+):
//   1. HERMES3D_PROFILE=vps + HERMES3D_VPS_ENV_FILE  (deploy mode)
//   2. HERMES3D_ENV_FILE                              (general dev override)
//   3. platform operator default (G:\private\.env on Windows)
//   4. ./.env in CWD                                  (legacy fallback)
// HermesProof is stdio JSON-RPC and does not parse argv; profile selection is
// driven by env vars plus the operator-default secret store. Resolved paths are
// intentionally not logged or returned by tools.
function maybeLoadDotenv() {
  const candidate = resolveEnvFileCandidate({
    onMissing(source) {
      console.error(`[hermesproof] ${source} is set but its file was not found; trying the next env-file candidate.`);
    }
  });
  if (candidate) {
    const loaded = loadDotenv({ path: candidate.path });
    if (loaded.error) {
      loadedEnvFileInfo = { loaded: false, source: candidate.source, status: "load_failed" };
      console.error("[hermesproof] selected env file could not be loaded; continuing with current environment.");
    } else {
      loadedEnvFileInfo = { loaded: true, source: candidate.source, status: "loaded" };
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
let providerPerformance;
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
  const nextProviderPerformance = new ProviderPerformanceTracker({
    workspaceRoot: resolvedWorkspaceRoot,
    stateDirName: configuredStateDirName
  });
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
    failover_order: process.env.HERMES_AGENT_FAILOVER
      ? process.env.HERMES_AGENT_FAILOVER.split(",").map((entry) => entry.trim()).filter(Boolean)
      : undefined,
    registryProviders: registryLoad.providers || [],
    providerPerformance: nextProviderPerformance,
  });

  await nextManager.init();
  await nextSkills.init();
  await nextReputation.init();
  await nextProviderPerformance.init();
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
    providerPerformance: nextProviderPerformance,
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
  providerPerformance = nextRuntime.providerPerformance;
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

server.resource(
  "hermesproof-status",
  "hermesproof://status",
  {
    title: "HermesProof status",
    description: "Read-only status for clients that probe MCP resources before calling tools.",
    mimeType: "application/json"
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify({
          ok: true,
          server: "hermes3d-lock-orchestrator",
          workspace_root: runtime?.workspaceRoot || manager?.workspaceRoot || null,
          state_dir: manager?.paths?.stateDir || null,
          resources_supported: true,
          secret_values_returned: false
        })
      }
    ]
  })
);

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
  "agent.profile.updated",
  "agent.presence",
  "message.sent",
  "message.acked",
  "assistance.requested",
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
  "gitlab.project.ready",
  "gitlab.merge_request.ready",
  "gitlab.ultimate.ready",
  "mode.testing.updated",
  "contract.updated",
  "contract.reviewed",
  "slop.detected",
  "claim.audit.passed",
  "claim.audit.failed",
  "agentic.tick",
  "agent.watchdog.poke",
  "agent.watchdog.recovery",
  "bug.reported",
  "bug.updated",
  "bug.fix_submitted",
  "pr.opened"
]);
const NextActor = z.enum(["claude", "codex", "human", "unassigned"]).default("unassigned");
const RecommendedAction = z.enum(["review_pr", "fix_scope", "merge", "review_handoff", "fix_bug", "review_fix", "run_tests", "acknowledge", "none"]).default("none");
const PresenceStatus = z.enum(["working", "idle", "blocked", "waiting", "reviewing", "testing", "done"]).default("working");
const MessageType = z.enum(["note", "unlock_request", "handoff", "assistance_request", "blocker", "completion", "ping"]).default("note");
const MessagePriority = z.enum(["low", "normal", "high", "urgent"]).default("normal");
const MessageAckStatus = z.enum(["acknowledged", "done", "dismissed"]).default("acknowledged");
const CompletionStatus = z.enum(["completed", "blocked", "partial"]).default("completed");
const TestModeState = z.enum(["testing", "release"]).default("testing");
const BugSeverity = z.enum(["critical", "high", "medium", "low", "info"]).default("medium");
const BugTicketStatus = z.enum(["open", "triaged", "assigned", "in_progress", "fix_submitted", "verified", "closed", "reopened", "wontfix", "duplicate"]).default("open");
const BugFixVerdict = z.enum(["submitted", "verified", "needs_work"]).default("submitted");
const ContractSeverity = z.enum(["critical", "high", "medium", "low", "info"]).default("medium");
const AutoTicketThreshold = z.enum(["critical", "high", "medium", "low", "never"]).default("high");
const AgentMode = z.enum(["observe", "coordinated-dev", "release-operator", "emergency-recovery"]).default("coordinated-dev");
const OptionalAgentMode = z.union([AgentMode, z.literal("")]).default("");
const GitLabVisibility = z.enum(["private", "internal", "public"]).default("private");
const GitLabNamespacePath = z
  .string()
  .max(255)
  .regex(/^$|^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/, "namespace path must be slash-separated GitLab path segments")
  .default("");
const GitLabProjectPath = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9_.-]+$/, "project path must be one GitLab path segment");
const GitLabProjectFullPath = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/, "project full path must be slash-separated GitLab path segments");
const OptionalGitLabProjectFullPath = z.union([GitLabProjectFullPath, z.literal("")]).default("");
const OptionalGitLabProjectPath = z.union([GitLabProjectPath, z.literal("")]).default("");
const GitLabOwnerRef = z
  .string()
  .min(2)
  .max(255)
  .regex(/^@[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/, "GitLab CODEOWNER refs must start with @");
const GitLabUsername = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9_.-]+$/, "GitLab usernames must be a single path segment");
const GitRemoteProtocol = z.enum(["ssh", "https"]).default("ssh");
const CLOUD_AI_ENV_NAMES = Object.freeze([
  "DEEPSEEK_API_KEY",
  "MINIMAX_API_KEY",
  "SILICONFLOW_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "GEMINI_API_KEY",
  "COHERE_API_KEY",
  "MISTRAL_API_KEY"
]);
const LOCAL_ENDPOINT_ENV_NAMES = Object.freeze(["LMSTUDIO_BASE_URL", "OLLAMA_BASE_URL", "HIPFIRE_BASE_URL"]);
const GITLAB_TOKEN_ENV_NAMES = Object.freeze([
  "GITLAB_TOKEN",
  "GLAB_TOKEN",
  "GITLAB_ACCESS_TOKEN",
  "GITLAB_PRIVATE_TOKEN",
  "GITLAB_PAT",
  "GHENGHIS_GITLAB_TOKEN"
]);
const REMOTE_GIT_ENV_NAMES = Object.freeze([...GITLAB_TOKEN_ENV_NAMES, "GH_TOKEN", "GITHUB_TOKEN"]);
const MODEL_SELECTOR_ENV_NAMES = Object.freeze([
  "DEEPSEEK_MODEL",
  "MINIMAX_MODEL",
  "SILICONFLOW_MODEL",
  "LMSTUDIO_MODEL",
  "OLLAMA_MODEL",
  "HIPFIRE_MODEL"
]);
const LegacyPathId = z
  .string()
  .min(2)
  .max(128)
  .regex(/^[A-Za-z0-9._-]+$/, "id must match ^[A-Za-z0-9._-]+$")
  .refine((id) => !id.includes(".."), "id must not contain parent refs");
const TaskId = LegacyPathId.describe("Stable task id safe for use as a state-file path component.");
const OptionalTaskId = z.union([LegacyPathId, z.literal("")]).default("");
const ComparePath = z.string().min(1).max(1000).describe("Existing file or directory path allowed for local comparison.");
const ClaimLatencyMode = z.enum(["instant", "grounded", "debate"]).default("instant");
const KilocodeProgressStatus = z.enum(["planned", "working", "blocked", "usable", "verified", "complete"]).default("working");
const KilocodeInfrastructureResource = z.enum([
  "cloudflare_edge",
  "vps_origin",
  "gitlab_runner",
  "edge_and_origin",
  "delivery_pipeline",
]).default("edge_and_origin");
const KilocodeInfrastructureCheck = z.object({
  id: z.string().min(1).max(120),
  status: z.string().min(1).max(40),
  evidence: z.string().max(500).optional(),
  http_status: z.number().int().min(100).max(599).optional(),
  exit_code: z.number().int().min(0).max(255).optional(),
  latency_ms: z.number().int().nonnegative().max(600000).optional(),
  rule_count: z.number().int().nonnegative().max(10000).optional(),
  command: z.string().max(240).optional(),
  observed_utc: z.string().max(80).optional(),
  evidence_id: z.string().max(80).optional(),
  mock: z.boolean().optional(),
  mocked: z.boolean().optional(),
  fake: z.boolean().optional(),
  stub: z.boolean().optional(),
  stubbed: z.boolean().optional(),
  ui_only: z.boolean().optional(),
  uiOnly: z.boolean().optional(),
  skipped: z.boolean().optional(),
  skip: z.boolean().optional(),
  hardcoded_success: z.boolean().optional(),
  hardcodedSuccess: z.boolean().optional(),
}).passthrough();
const KilocodeAgentBusCheck = z.object({
  id: z.string().min(1).max(120),
  status: z.string().max(40).optional(),
  result: z.string().max(40).optional(),
  evidence: z.string().max(500).optional(),
  summary: z.string().max(500).optional(),
  evidence_id: z.string().max(120).optional(),
  evidenceId: z.string().max(120).optional(),
  exit_code: z.number().int().min(0).max(255).optional(),
  exitCode: z.number().int().min(0).max(255).optional(),
  http_status: z.number().int().min(100).max(599).optional(),
  httpStatus: z.number().int().min(100).max(599).optional(),
  latency_ms: z.number().int().nonnegative().max(600000).optional(),
  latencyMs: z.number().int().nonnegative().max(600000).optional(),
  mock: z.boolean().optional(),
  mocked: z.boolean().optional(),
  fake: z.boolean().optional(),
  stub: z.boolean().optional(),
  stubbed: z.boolean().optional(),
  ui_only: z.boolean().optional(),
  uiOnly: z.boolean().optional(),
  skipped: z.boolean().optional(),
  skip: z.boolean().optional(),
  hardcoded_success: z.boolean().optional(),
  hardcodedSuccess: z.boolean().optional(),
}).passthrough();
const KilocodeAgentBusArtifact = z.object({
  kind: z.string().max(80).optional(),
  type: z.string().max(80).optional(),
  path: z.string().max(1000).optional(),
  file: z.string().max(1000).optional(),
  sha256: z.string().max(160).optional(),
  hash: z.string().max(160).optional(),
  artifact_hash: z.string().max(160).optional(),
  artifactHash: z.string().max(160).optional(),
  exists: z.boolean().optional(),
  bytes: z.number().int().nonnegative().optional(),
  size: z.number().int().nonnegative().optional(),
}).passthrough();
const KilocodeAgentBusProofRef = z.union([
  z.string().max(160),
  z.object({
    id: z.string().max(160).optional(),
    evidence_id: z.string().max(160).optional(),
    evidenceId: z.string().max(160).optional(),
  }).passthrough(),
]);
const KilocodeAgentBusEnvelope = z.object({
  schema: z.string().max(80).default("kilo.agent.bus.v1"),
  event_type: z.string().max(80).default(""),
  eventType: z.string().max(80).optional(),
  type: z.string().max(80).optional(),
  substrate: z.string().max(80).default("unknown"),
  source: z.string().max(80).optional(),
  orchestrator: z.string().max(80).optional(),
  task_id: z.string().max(160).default(""),
  taskId: z.string().max(160).optional(),
  worker_id: z.string().max(160).optional(),
  workerId: z.string().max(160).optional(),
  agent_id: z.string().max(160).optional(),
  agentId: z.string().max(160).optional(),
  session_id: z.string().max(160).optional(),
  sessionId: z.string().max(160).optional(),
  lane: z.string().max(80).optional(),
  summary: z.string().max(2000).default(""),
  message: z.string().max(2000).optional(),
  evidence_id: z.string().max(160).optional(),
  evidenceId: z.string().max(160).optional(),
  evidence_ids: z.array(z.string().max(160)).max(20).optional(),
  evidenceIds: z.array(z.string().max(160)).max(20).optional(),
  proof_refs: z.array(KilocodeAgentBusProofRef).max(20).optional(),
  proofRefs: z.array(KilocodeAgentBusProofRef).max(20).optional(),
  artifacts: z.array(KilocodeAgentBusArtifact).max(50).optional(),
  proof_artifacts: z.array(KilocodeAgentBusArtifact).max(50).optional(),
  proofArtifacts: z.array(KilocodeAgentBusArtifact).max(50).optional(),
  checks: z.array(KilocodeAgentBusCheck).max(100).optional(),
  gates: z.array(KilocodeAgentBusCheck).max(100).optional(),
  command: z.string().max(1000).optional(),
  command_summary: z.string().max(1000).optional(),
  commandSummary: z.string().max(1000).optional(),
  exit_code: z.number().int().min(0).max(255).optional(),
  exitCode: z.number().int().min(0).max(255).optional(),
  mock: z.boolean().optional(),
  mocked: z.boolean().optional(),
  fake: z.boolean().optional(),
  stub: z.boolean().optional(),
  stubbed: z.boolean().optional(),
  ui_only: z.boolean().optional(),
  uiOnly: z.boolean().optional(),
  skipped: z.boolean().optional(),
  skip: z.boolean().optional(),
  hardcoded_success: z.boolean().optional(),
  hardcodedSuccess: z.boolean().optional(),
}).passthrough();
const KilocodeInstalledVsixReleaseProof = z.object({
  schema: z.string().max(120).optional(),
  proof_schema: z.string().max(120).optional(),
  proofSchema: z.string().max(120).optional(),
  contractVersion: z.string().max(160).optional(),
  contract_version: z.string().max(160).optional(),
  vsixSha256: z.string().max(160).optional(),
  vsix_sha256: z.string().max(160).optional(),
  vsix_hash: z.string().max(160).optional(),
  resultFileExists: z.boolean().optional(),
  outputRoot: z.string().max(1000).optional(),
  output_root: z.string().max(1000).optional(),
  startedAt: z.string().max(120).optional(),
  started_at: z.string().max(120).optional(),
  finishedAt: z.string().max(120).optional(),
  finished_at: z.string().max(120).optional(),
  windowOpenedAt: z.string().max(120).optional(),
  window_opened_at: z.string().max(120).optional(),
  windowClosedAt: z.string().max(120).optional(),
  window_closed_at: z.string().max(120).optional(),
  gates: z.any().optional(),
  gateResults: z.any().optional(),
  gate_results: z.any().optional(),
  heartbeat: z.union([z.string().max(200000), z.array(z.string().max(1000)).max(5000)]).optional(),
  heartbeats: z.union([z.string().max(200000), z.array(z.string().max(1000)).max(5000)]).optional(),
  heartbeatLines: z.union([z.string().max(200000), z.array(z.string().max(1000)).max(5000)]).optional(),
  heartbeat_lines: z.union([z.string().max(200000), z.array(z.string().max(1000)).max(5000)]).optional(),
  visibleSidecarToolSmokes: z.any().optional(),
  visible_sidecar_tool_smokes: z.any().optional(),
  preflightResults: z.any().optional(),
  preflights: z.any().optional(),
  preflight_runners: z.any().optional(),
  error: z.any().optional(),
  mock: z.boolean().optional(),
  mocked: z.boolean().optional(),
  fake: z.boolean().optional(),
  stub: z.boolean().optional(),
  stubbed: z.boolean().optional(),
  ui_only: z.boolean().optional(),
  uiOnly: z.boolean().optional(),
  skipped: z.boolean().optional(),
  skip: z.boolean().optional(),
}).passthrough();
const KilocodeRoadmapCompletionProof = z.object({
  schema: z.string().max(120).optional(),
  proof_schema: z.string().max(120).optional(),
  proofSchema: z.string().max(120).optional(),
  docs: z.union([z.string().max(200000), z.array(z.string().max(1000)).max(200)]).optional(),
  updatedDocs: z.union([z.string().max(200000), z.array(z.string().max(1000)).max(200)]).optional(),
  updated_docs: z.union([z.string().max(200000), z.array(z.string().max(1000)).max(200)]).optional(),
  requiredDocs: z.union([z.string().max(200000), z.array(z.string().max(1000)).max(200)]).optional(),
  required_docs: z.union([z.string().max(200000), z.array(z.string().max(1000)).max(200)]).optional(),
  items: z.array(z.any()).max(500).optional(),
  roadmapItems: z.array(z.any()).max(500).optional(),
  roadmap_items: z.array(z.any()).max(500).optional(),
  actionItems: z.array(z.any()).max(500).optional(),
  action_items: z.array(z.any()).max(500).optional(),
}).passthrough();
const KilocodeGuardrailsPatch = z.object({
  mvp_first: z.boolean().optional(),
  no_new_ideas_mode: z.boolean().optional(),
  force_mvp_gui_first: z.boolean().optional(),
  require_visual_proof: z.boolean().optional(),
  screenshot_on_checkpoint: z.boolean().optional(),
  block_until_usable: z.boolean().optional(),
  hyperfocus_visual_mode: z.boolean().optional(),
  focus_mode: z.boolean().optional(),
  visual_milestone_step_interval: z.number().int().min(1).max(100).optional(),
  visual_milestone_minutes: z.number().int().min(5).max(1440).optional(),
}).default({});

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

function agentProfilePath(owner) {
  return path.join(manager.paths.agentProfilesDir, `${owner}.json`);
}

function bugTicketPath(ticketId) {
  return path.join(manager.paths.bugTicketsDir, `${ticketId}.json`);
}

function contractPath(contractId) {
  return path.join(manager.paths.contractsDir, `${contractId}.json`);
}

function contractReviewPath(reviewId) {
  return path.join(manager.paths.contractReviewsDir, `${reviewId}.json`);
}

function claimAuditDir() {
  return path.join(manager.paths.stateDir, "claim_audits");
}

function claimAuditPath(auditId) {
  return path.join(claimAuditDir(), `${auditId}.json`);
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

function normalizeStringList(values = [], maxItems = 100) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .map((value) => value.slice(0, 256))
  )].slice(0, maxItems);
}

function normalizeWorkspaceRoots(values = []) {
  if (!Array.isArray(values)) return [];
  const roots = [];
  for (const value of values) {
    const trimmed = String(value || "").trim();
    if (!trimmed) continue;
    roots.push(path.resolve(trimmed));
  }
  return [...new Set(roots)].slice(0, 100);
}

function uniqueSorted(values = []) {
  return [...new Set(values.filter(Boolean))].sort();
}

function normalizeTicketId(value = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return `bug-${Date.now().toString(36)}-${shaId(`${manager.workspaceRoot}:${Date.now()}`, 8)}`;
  const normalized = raw.replace(/[^a-z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 96);
  if (!/^[a-z0-9][a-z0-9._-]{1,95}$/.test(normalized) || normalized.includes("..")) {
    throw new Error("ticketId must normalize to 2-96 safe path characters");
  }
  return normalized;
}

function normalizeContractId(value = "") {
  const raw = String(value || "project-contract").trim().toLowerCase();
  const normalized = raw.replace(/[^a-z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 96);
  if (!/^[a-z0-9][a-z0-9._-]{1,95}$/.test(normalized) || normalized.includes("..")) {
    throw new Error("contractId must normalize to 2-96 safe path characters");
  }
  return normalized;
}

function normalizeOptionalFiles(files = []) {
  return Array.isArray(files) && files.length ? manager.normalizeFiles(files) : [];
}

function presentEnvNames(names = []) {
  return names.filter((name) => Boolean(process.env[name]));
}

function missingGitLabTokenMessage() {
  return "Configure a supported GitLab token env var or the dedicated GitLab env file. Secret values and private file paths are never returned.";
}

function commandExists(name) {
  const cmd = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(cmd, [name], {
    encoding: "utf8",
    shell: false,
    windowsHide: true
  });
  return result.status === 0;
}

function commandPath(name) {
  const cmd = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(cmd, [name], {
    encoding: "utf8",
    shell: false,
    windowsHide: true
  });
  if (result.status !== 0) return "";
  return String(result.stdout || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0] || "";
}

async function fileExistsPath(candidate) {
  if (!candidate) return false;
  try {
    const st = await fs.stat(candidate);
    return st.isFile() || st.isDirectory();
  } catch {
    return false;
  }
}

async function resolveWinMergeExecutable() {
  const candidates = uniqueSorted([
    process.env.HERMES_WINMERGE_EXE,
    process.env.WINMERGE_EXE,
    "C:\\Program Files\\WinMerge\\WinMergeU.exe",
    "C:\\Program Files\\WinMerge\\WinMerge.exe",
    "C:\\Program Files (x86)\\WinMerge\\WinMergeU.exe",
    commandPath("WinMergeU.exe"),
    commandPath("WinMerge.exe")
  ]).map((value) => path.resolve(String(value)));
  const checked = [];
  for (const candidate of candidates) {
    checked.push(candidate);
    try {
      const st = await fs.stat(candidate);
      if (st.isFile()) {
        return { found: true, executable: candidate, checked };
      }
    } catch {}
  }
  return { found: false, executable: "", checked };
}

function compareAllowedRoots() {
  const roots = [runtime?.workspaceRoot || manager?.workspaceRoot].filter(Boolean);
  const envRoots = String(process.env.HERMES_WINMERGE_ALLOWED_ROOTS || "")
    .split(";")
    .map((value) => value.trim())
    .filter(Boolean);
  roots.push(...envRoots);
  if (process.platform === "win32") roots.push("G:\\Github");
  return uniqueSorted(roots.map((root) => path.resolve(root)));
}

async function validateComparePath(raw, label) {
  const value = String(raw || "").trim();
  if (!value) throw new Error(`${label} is required`);
  const resolved = path.resolve(value);
  const parts = resolved.split(/[\\/]+/).map((part) => part.toLowerCase());
  if (parts.includes("private") || parts.includes(".git") || path.basename(resolved).toLowerCase().includes(".env")) {
    throw new Error(`${label} must not reference private, .env, or .git paths`);
  }
  const roots = compareAllowedRoots();
  const allowed = roots.some((root) => {
    const rel = path.relative(root, resolved);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  });
  if (!allowed) {
    throw new Error(`${label} must be under active workspace or HERMES_WINMERGE_ALLOWED_ROOTS`);
  }
  if (!(await fileExistsPath(resolved))) throw new Error(`${label} does not exist: ${value}`);
  return resolved;
}

async function winMergeStatusSnapshot() {
  const resolved = await resolveWinMergeExecutable();
  return {
    ok: true,
    found: resolved.found,
    executable: resolved.executable,
    checked: resolved.checked,
    allowed_roots: compareAllowedRoots(),
    workspace_root: runtime?.workspaceRoot || manager?.workspaceRoot || null,
    usage: resolved.found
      ? "Call hermes_winmerge_compare with leftPath and rightPath to open a visual compare."
      : "Install WinMerge or set HERMES_WINMERGE_EXE to WinMergeU.exe."
  };
}

async function launchWinMergeCompare({
  owner = "system",
  leftPath,
  rightPath,
  ancestorPath = "",
  recursive = true,
  readOnly = false,
  wait = false,
  title = ""
} = {}) {
  const status = await resolveWinMergeExecutable();
  if (!status.found) {
    return { ok: false, status: "missing_winmerge", winmerge: await winMergeStatusSnapshot() };
  }
  const left = await validateComparePath(leftPath, "leftPath");
  const right = await validateComparePath(rightPath, "rightPath");
  const ancestor = ancestorPath ? await validateComparePath(ancestorPath, "ancestorPath") : "";
  const args = ["/e", "/u"];
  if (recursive) args.push("/r");
  if (readOnly) args.push("/wl", "/wr");
  if (title) args.push("/dl", `${title} left`, "/dr", `${title} right`);
  if (ancestor) args.push(left, ancestor, right);
  else args.push(left, right);
  let exitCode = null;
  let pid = null;
  if (wait) {
    const result = spawnSync(status.executable, args, {
      encoding: "utf8",
      shell: false,
      windowsHide: false,
      timeout: 10 * 60 * 1000
    });
    exitCode = result.status;
  } else {
    const child = spawn(status.executable, args, {
      detached: true,
      stdio: "ignore",
      shell: false,
      windowsHide: false
    });
    pid = child.pid;
    child.unref();
  }
  await manager.emitManualEvent({
    event_type: "evidence.appended",
    owner,
    task_id: null,
    files: [],
    summary: `WinMerge compare launched: ${path.basename(left)} vs ${path.basename(right)}`,
    next_actor: "unassigned",
    recommended_action: "review_fix",
    payload: {
      tool: "winmerge",
      executable: status.executable,
      left,
      right,
      ancestor: ancestor || null,
      recursive: Boolean(recursive),
      read_only: Boolean(readOnly),
      wait: Boolean(wait),
      pid,
      exit_code: exitCode
    }
  });
  return {
    ok: true,
    status: wait ? "completed" : "launched",
    executable: status.executable,
    pid,
    exit_code: exitCode,
    left_path: left,
    right_path: right,
    ancestor_path: ancestor || "",
    args_redacted: args.map((arg) => String(arg)),
    next_tools: ["hermes_append_evidence", "hermes_anti_slop_review", "hermes_complete_work"]
  };
}

function backendStatusSnapshot({ includeCli = true } = {}) {
  const gitlabConfig = resolveGitLabConfig();
  const present = {
    cloud_ai: presentEnvNames(CLOUD_AI_ENV_NAMES),
    local_endpoint: presentEnvNames(LOCAL_ENDPOINT_ENV_NAMES),
    remote_git: presentEnvNames(REMOTE_GIT_ENV_NAMES),
    model_selector: presentEnvNames(MODEL_SELECTOR_ENV_NAMES)
  };
  const cli = includeCli
    ? { gh: commandExists("gh"), glab: commandExists("glab"), git: commandExists("git") }
    : null;
  const gitlabEnvConfigured = Boolean(gitlabConfig.ok);
  const githubEnvConfigured = present.remote_git.includes("GH_TOKEN") || present.remote_git.includes("GITHUB_TOKEN");
  const backendEnvCount =
    present.cloud_ai.length +
    present.local_endpoint.length +
    present.remote_git.length +
    present.model_selector.length;
  const readiness = {
    cloud_ai_available: present.cloud_ai.length > 0,
    local_ai_endpoint_configured: present.local_endpoint.length > 0,
    gitlab_api_token_configured: gitlabEnvConfigured,
    gitlab_private_env_file_loaded: gitlabConfig.gitlab_env_file_status === "loaded",
    gitlab_cli_available: Boolean(cli?.glab),
    gitlab_fast_path_available: gitlabEnvConfigured,
    github_fast_path_available: githubEnvConfigured || Boolean(cli?.gh),
    model_overrides_configured: present.model_selector.length > 0,
    any_backend_configured: backendEnvCount > 0 || Boolean(cli?.gh) || Boolean(cli?.glab)
  };
  return {
    ok: true,
    workspace_root: manager?.workspaceRoot || runtime?.workspaceRoot || null,
    secret_values_returned: false,
    env_file: {
      loaded: loadedEnvFileInfo.loaded,
      source: loadedEnvFileInfo.source,
      status: loadedEnvFileInfo.status
    },
    gitlab_config: {
      configured: Boolean(gitlabConfig.ok),
      base_url: gitlabConfig.base_url,
      token_source: gitlabConfig.token_source,
      gitlab_env_file_status: gitlabConfig.gitlab_env_file_status,
      gitlab_env_file_source: gitlabConfig.gitlab_env_file_source
    },
    present_env_names: present,
    missing_recommended_env_names: {
      cloud_ai_fast_path: ["DEEPSEEK_API_KEY", "MINIMAX_API_KEY", "SILICONFLOW_API_KEY"].filter((name) => !process.env[name]),
      gitlab: GITLAB_TOKEN_ENV_NAMES.filter((name) => !process.env[name])
    },
    cli_present: cli,
    readiness,
    note: "Only env var names, booleans, and source labels are returned. Secret values and private file paths are never returned."
  };
}

function gitLabFullPath({ projectFullPath = "", namespacePath = "", projectPath = "" } = {}) {
  const direct = String(projectFullPath || "").replace(/^\/+|\/+$/g, "");
  if (direct) return direct;
  const namespace = String(namespacePath || "").replace(/^\/+|\/+$/g, "");
  const project = String(projectPath || "").replace(/^\/+|\/+$/g, "");
  return namespace ? `${namespace}/${project}` : project;
}

function splitGitLabFullPath(fullPath = "") {
  const normalized = String(fullPath || "").replace(/^\/+|\/+$/g, "");
  const parts = normalized.split("/").filter(Boolean);
  return {
    namespacePath: parts.slice(0, -1).join("/"),
    projectPath: parts.at(-1) || ""
  };
}

function redactRemoteUrl(value = "") {
  return String(value || "")
    .replace(/(https?:\/\/)([^/@\s]+@)/gi, "$1<redacted>@")
    .replace(/([?&](?:token|access_token|private_token)=)[^&\s]+/gi, "$1<redacted>");
}

function runGit(args) {
  const result = spawnSync("git", args, {
    cwd: manager.workspaceRoot,
    encoding: "utf8",
    shell: false,
    windowsHide: true
  });
  return {
    ok: result.status === 0,
    exit_code: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || ""
  };
}

function projectRemoteUrl(project, protocol = "ssh") {
  if (!project) return "";
  return protocol === "https"
    ? project.http_url_to_repo || project.web_url || ""
    : project.ssh_url_to_repo || project.http_url_to_repo || project.web_url || "";
}

function configureGitRemote({
  project,
  remoteName = "gitlab",
  protocol = "ssh",
  updateExistingRemote = false
} = {}) {
  const desiredUrl = projectRemoteUrl(project, protocol);
  if (!desiredUrl) {
    return { ok: false, status: "missing_project_remote_url", remote_name: remoteName };
  }
  const inside = runGit(["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok) {
    return {
      ok: false,
      status: "not_git_workspace",
      remote_name: remoteName,
      stderr_tail: inside.stderr.slice(-300)
    };
  }
  const existing = runGit(["remote", "get-url", remoteName]);
  if (existing.ok) {
    const existingUrl = existing.stdout.trim();
    if (existingUrl === desiredUrl) {
      return {
        ok: true,
        status: "already_configured",
        remote_name: remoteName,
        remote_url: redactRemoteUrl(existingUrl)
      };
    }
    if (!updateExistingRemote) {
      return {
        ok: false,
        status: "remote_exists_mismatch",
        remote_name: remoteName,
        existing_url: redactRemoteUrl(existingUrl),
        desired_url: redactRemoteUrl(desiredUrl),
        message: "Pass updateExistingRemote=true to replace this remote URL."
      };
    }
    const set = runGit(["remote", "set-url", remoteName, desiredUrl]);
    return {
      ok: set.ok,
      status: set.ok ? "updated" : "update_failed",
      remote_name: remoteName,
      remote_url: redactRemoteUrl(desiredUrl),
      stderr_tail: set.stderr.slice(-300)
    };
  }
  const add = runGit(["remote", "add", remoteName, desiredUrl]);
  return {
    ok: add.ok,
    status: add.ok ? "added" : "add_failed",
    remote_name: remoteName,
    remote_url: redactRemoteUrl(desiredUrl),
    stderr_tail: add.stderr.slice(-300)
  };
}

function gitWorkspaceSnapshot() {
  const inside = runGit(["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok) {
    return {
      ok: false,
      status: "not_git_workspace",
      stderr_tail: inside.stderr.slice(-300)
    };
  }
  const branch = runGit(["branch", "--show-current"]);
  const remotes = runGit(["remote", "-v"]);
  return {
    ok: true,
    status: "git_workspace",
    branch: branch.ok ? branch.stdout.trim() : "",
    remotes: remotes.ok
      ? remotes.stdout
          .split(/\r?\n/)
          .map((line) => redactRemoteUrl(line.trim()))
          .filter(Boolean)
          .slice(0, 50)
      : [],
    remote_probe_ok: remotes.ok
  };
}

async function readAgentProfile(owner) {
  return await readJson(agentProfilePath(owner), null);
}

async function registerAgentProfile({
  owner,
  displayName = "",
  host = "",
  model = "",
  mode = "coordinated-dev",
  role = "agent",
  skills = [],
  taskTypes = [],
  hostSupplies = [],
  hermesproofSupplies = [],
  workspaceRoots = [],
  defaultWorkspaceRoot = "",
  mcpServer = {},
  releaseGates = [],
  gitRemotes = [],
  notes = "",
  metadata = {},
  updatePresence = true
} = {}) {
  await ensureDir(manager.paths.agentProfilesDir);
  const previous = await readAgentProfile(owner);
  const now = utcNow();
  const profile = {
    agent_profile_schema_version: 1,
    owner,
    display_name: displayName || previous?.display_name || owner,
    host: host || previous?.host || "unknown",
    model: model || previous?.model || "unknown",
    mode,
    role: role || previous?.role || "agent",
    skills: normalizeTags(skills.length ? skills : previous?.skills || []),
    task_types: normalizeTags(taskTypes.length ? taskTypes : previous?.task_types || []),
    host_supplies: normalizeTags(hostSupplies.length ? hostSupplies : previous?.host_supplies || []),
    hermesproof_supplies: normalizeTags(hermesproofSupplies.length ? hermesproofSupplies : previous?.hermesproof_supplies || []),
    workspace_roots: normalizeWorkspaceRoots(workspaceRoots.length ? workspaceRoots : previous?.workspace_roots || []),
    default_workspace_root: defaultWorkspaceRoot ? path.resolve(defaultWorkspaceRoot) : previous?.default_workspace_root || manager.workspaceRoot,
    mcp_server: Object.keys(mcpServer || {}).length ? mcpServer : previous?.mcp_server || {},
    release_gates: normalizeStringList(releaseGates.length ? releaseGates : previous?.release_gates || []),
    git_remotes: normalizeStringList(gitRemotes.length ? gitRemotes : previous?.git_remotes || []),
    notes: notes || previous?.notes || "",
    metadata: { ...(previous?.metadata || {}), ...(metadata || {}) },
    created_utc: previous?.created_utc || now,
    updated_utc: now
  };
  await writeJsonAtomic(agentProfilePath(owner), profile);
  await manager.emitManualEvent({
    event_type: "agent.profile.updated",
    owner,
    task_id: null,
    files: [],
    summary: `Agent profile registered: ${owner}`,
    next_actor: "unassigned",
    recommended_action: "acknowledge",
    payload: {
      host: profile.host,
      model: profile.model,
      mode: profile.mode,
      skills: profile.skills,
      task_types: profile.task_types
    }
  });
  let presence = null;
  if (updatePresence) {
    const status = previous ? "idle" : "idle";
    const result = await updatePresenceRecord({
      owner,
      role: profile.role,
      status,
      skills: profile.skills,
      taskTypes: profile.task_types,
      note: profile.notes || `Profile registered for ${profile.display_name}`,
      ttlSeconds: 300,
      canInterrupt: true
    });
    presence = result.presence;
  }
  return { ok: true, status: previous ? "updated" : "registered", workspace_root: manager.workspaceRoot, profile, presence };
}

async function listAgentProfiles({
  requiredSkills = [],
  taskType = "",
  host = "",
  mode = "",
  includePresence = true,
  limit = 100
} = {}) {
  await ensureDir(manager.paths.agentProfilesDir);
  const names = await fs.readdir(manager.paths.agentProfilesDir).catch(() => []);
  const required = normalizeTags(requiredSkills);
  const taskTag = normalizeTags(taskType ? [taskType] : [])[0] || "";
  const presenceMap = new Map();
  if (includePresence) {
    const presence = await listPresenceRecords({ includeStale: true });
    for (const record of presence.presence) presenceMap.set(record.owner, record);
  }
  const profiles = [];
  for (const name of names.filter((item) => item.endsWith(".json"))) {
    const profile = await readJson(path.join(manager.paths.agentProfilesDir, name), null);
    if (!profile) continue;
    if (host && profile.host !== host) continue;
    if (mode && profile.mode !== mode) continue;
    const skills = normalizeTags(profile.skills || []);
    const taskTypes = normalizeTags(profile.task_types || []);
    if (required.some((skill) => !skills.includes(skill))) continue;
    if (taskTag && taskTypes.length && !taskTypes.includes(taskTag)) continue;
    profiles.push({
      ...profile,
      presence: includePresence ? presenceMap.get(profile.owner) || null : undefined
    });
  }
  profiles.sort((a, b) => a.owner.localeCompare(b.owner));
  const bounded = clampNumber(limit, { min: 1, max: 500, fallback: 100 });
  return { ok: true, workspace_root: manager.workspaceRoot, count: profiles.length, profiles: profiles.slice(0, bounded) };
}

async function updateAgentCapabilities({
  owner,
  skills = [],
  taskTypes = [],
  hostSupplies = [],
  hermesproofSupplies = [],
  releaseGates = [],
  gitRemotes = [],
  mode = "",
  notes = "",
  merge = true,
  updatePresence = true
} = {}) {
  const previous = await readAgentProfile(owner);
  if (!previous) return { ok: false, status: "missing", message: `agent profile not found for ${owner}` };
  const profile = {
    ...previous,
    mode: mode || previous.mode,
    skills: merge ? uniqueSorted([...normalizeTags(previous.skills || []), ...normalizeTags(skills)]) : normalizeTags(skills),
    task_types: merge ? uniqueSorted([...normalizeTags(previous.task_types || []), ...normalizeTags(taskTypes)]) : normalizeTags(taskTypes),
    host_supplies: merge ? uniqueSorted([...normalizeTags(previous.host_supplies || []), ...normalizeTags(hostSupplies)]) : normalizeTags(hostSupplies),
    hermesproof_supplies: merge ? uniqueSorted([...normalizeTags(previous.hermesproof_supplies || []), ...normalizeTags(hermesproofSupplies)]) : normalizeTags(hermesproofSupplies),
    release_gates: merge ? normalizeStringList([...(previous.release_gates || []), ...releaseGates]) : normalizeStringList(releaseGates),
    git_remotes: merge ? normalizeStringList([...(previous.git_remotes || []), ...gitRemotes]) : normalizeStringList(gitRemotes),
    notes: notes || previous.notes || "",
    updated_utc: utcNow()
  };
  await writeJsonAtomic(agentProfilePath(owner), profile);
  await manager.emitManualEvent({
    event_type: "agent.profile.updated",
    owner,
    task_id: null,
    files: [],
    summary: `Agent capabilities updated: ${owner}`,
    next_actor: "unassigned",
    recommended_action: "acknowledge",
    payload: {
      mode: profile.mode,
      skills: profile.skills,
      task_types: profile.task_types,
      host_supplies: profile.host_supplies
    }
  });
  let presence = null;
  if (updatePresence) {
    const previousPresence = await readJson(presencePath(owner), null);
    const result = await updatePresenceRecord({
      owner,
      role: profile.role || previousPresence?.role || "agent",
      status: previousPresence?.status || "idle",
      taskId: previousPresence?.task_id || "",
      files: previousPresence?.files || [],
      skills: profile.skills,
      taskTypes: profile.task_types,
      note: notes || previousPresence?.note || profile.notes || "",
      ttlSeconds: previousPresence?.ttl_seconds || 300,
      canInterrupt: previousPresence?.can_interrupt !== false,
      waitingOn: previousPresence?.waiting_on || "",
      etaUtc: previousPresence?.eta_utc || ""
    });
    presence = result.presence;
  }
  return { ok: true, status: "updated", workspace_root: manager.workspaceRoot, profile, presence };
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
  const scoredCandidates = await applyDispatchScores(candidates, taskTag);
  scoredCandidates.sort((a, b) => b.score - a.score || a.owner.localeCompare(b.owner));
  const bounded = clampNumber(limit, { min: 1, max: 50, fallback: 10 });
  return {
    ok: true,
    workspace_root: manager.workspaceRoot,
    required_skills: required,
    task_type: taskTag || null,
    count: scoredCandidates.length,
    candidates: scoredCandidates.slice(0, bounded)
  };
}

async function applyDispatchScores(candidates, taskTag) {
  if (!candidates.length) return candidates;
  if (!taskTag) {
    return candidates.map((candidate) => ({
      ...candidate,
      base_score: candidate.base_score ?? candidate.score,
      dispatch_score: null,
      routing_reason: candidate.routing_reason || "presence/lock-load only; no task type"
    }));
  }
  const ranked = await dispatch.rankActors(taskTag, candidates.map((candidate) => candidate.owner));
  const rankMap = new Map(ranked.map((entry) => [entry.actor_id, entry.dispatch_score]));
  return candidates.map((candidate) => {
    const dispatchScore = rankMap.get(candidate.owner) ?? null;
    const baseScore = candidate.base_score ?? candidate.score;
    return {
      ...candidate,
      base_score: baseScore,
      score: dispatchScore === null ? baseScore : Number((baseScore + dispatchScore * 20).toFixed(4)),
      dispatch_score: dispatchScore,
      routing_reason: dispatchScore === null
        ? "presence/lock-load only; no dispatch history"
        : `presence/lock-load plus learned dispatch score ${dispatchScore}`
    };
  });
}

async function readTestMode() {
  const mode = await readJson(manager.paths.testModeFile, null);
  if (!mode) {
    return {
      mode: "release",
      testing_enabled: false,
      updated_utc: null,
      updated_by: null,
      reason: "",
      release_blocking_open_tickets: true
    };
  }
  return {
    mode: mode.mode === "testing" ? "testing" : "release",
    testing_enabled: mode.mode === "testing",
    updated_utc: mode.updated_utc || null,
    updated_by: mode.updated_by || null,
    reason: mode.reason || "",
    release_blocking_open_tickets: mode.release_blocking_open_tickets !== false
  };
}

async function setTestModeState({ owner, mode = "testing", reason = "", releaseBlockingOpenTickets = true } = {}) {
  const normalizedMode = mode === "release" ? "release" : "testing";
  const record = {
    mode: normalizedMode,
    testing_enabled: normalizedMode === "testing",
    updated_utc: utcNow(),
    updated_by: owner,
    reason,
    release_blocking_open_tickets: releaseBlockingOpenTickets !== false
  };
  await writeJsonAtomic(manager.paths.testModeFile, record);
  const evidence = await manager.appendEvidence({
    owner,
    kind: "mode.testing",
    summary: `HermesProof workspace mode set to ${normalizedMode}`,
    data: record
  });
  await manager.emitManualEvent({
    event_type: "mode.testing.updated",
    owner,
    task_id: null,
    files: [],
    summary: `Testing mode ${normalizedMode === "testing" ? "enabled" : "disabled"}`,
    next_actor: "unassigned",
    recommended_action: normalizedMode === "testing" ? "run_tests" : "acknowledge",
    payload: record
  });
  return { ok: true, status: "updated", workspace_root: manager.workspaceRoot, mode: record, evidence: evidence.evidence };
}

async function readBugTicket(ticketId) {
  return await readJson(bugTicketPath(ticketId), null);
}

async function reportBugTicket({
  reporter,
  ticketId = "",
  title,
  summary = "",
  severity = "medium",
  files = [],
  reproduction = "",
  expected = "",
  actual = "",
  evidence = [],
  tags = [],
  assignee = "",
  enqueue = true,
  priority = 0,
  targetOwnerPattern = ".*",
  taskId = ""
} = {}) {
  const id = normalizeTicketId(ticketId);
  const now = utcNow();
  const normalizedFiles = normalizeOptionalFiles(files);
  const existing = await readBugTicket(id);
  if (existing && !["closed", "wontfix", "duplicate"].includes(existing.status)) {
    return { ok: true, status: "already_reported", workspace_root: manager.workspaceRoot, ticket: existing, idempotent: true };
  }
  const mode = await readTestMode();
  const ticket = {
    ticket_schema_version: 1,
    ticket_id: id,
    title,
    summary,
    severity,
    status: existing?.status === "closed" ? "reopened" : "open",
    reporter,
    assignee: assignee || null,
    files: normalizedFiles,
    reproduction,
    expected,
    actual,
    evidence: Array.isArray(evidence) ? evidence.slice(0, 50) : [],
    tags: normalizeTags(tags),
    task_id: taskId || `bug-${id}`,
    testing_mode_at_report: mode.mode,
    release_blocker: mode.release_blocking_open_tickets !== false && ["critical", "high", "medium"].includes(severity),
    created_utc: existing?.created_utc || now,
    updated_utc: now,
    updates: existing?.updates || [],
    fixes: existing?.fixes || []
  };
  await writeJsonAtomic(bugTicketPath(id), ticket);
  let queued = null;
  if (enqueue) {
    queued = await manager.enqueueTask({
      taskId: ticket.task_id,
      title: `Bug: ${title}`,
      summary: summary || reproduction || actual || title,
      files_hint: normalizedFiles,
      priority,
      target_owner_pattern: targetOwnerPattern,
      data: {
        kind: "bug_ticket",
        ticket_id: id,
        severity,
        release_blocker: ticket.release_blocker
      },
      enqueued_by: reporter
    });
  }
  const evidenceEntry = await manager.appendEvidence({
    owner: reporter,
    taskId: ticket.task_id,
    kind: "bug.reported",
    summary: `Bug reported: ${id} ${title}`,
    data: { ticket, queued_status: queued?.status || null }
  });
  await manager.emitManualEvent({
    event_type: "bug.reported",
    owner: reporter,
    task_id: ticket.task_id,
    files: normalizedFiles,
    summary: `Bug reported: ${id} ${title}`,
    next_actor: "unassigned",
    recommended_action: "fix_bug",
    payload: {
      ticket_id: id,
      severity,
      status: ticket.status,
      assignee: ticket.assignee,
      release_blocker: ticket.release_blocker,
      queued_status: queued?.status || null
    }
  });
  const live = await listPresenceRecords({ includeStale: false });
  const activeAgents = live.presence
    .filter((record) => record.owner !== reporter)
    .map((record) => record.owner)
    .slice(0, 25);
  let notifications = null;
  if (activeAgents.length) {
    notifications = await sendInboxMessage({
      sender: reporter,
      recipients: activeAgents,
      type: "note",
      priority: ["critical", "high"].includes(severity) ? "high" : "normal",
      subject: `Bug ticket ${id}: ${title}`,
      body: summary || reproduction || actual || title,
      taskId: ticket.task_id,
      files: normalizedFiles,
      requiresAck: false,
      metadata: {
        kind: "bug_ticket",
        ticket_id: id,
        severity,
        status: ticket.status,
        release_blocker: ticket.release_blocker
      }
    });
  }
  return {
    ok: true,
    status: "reported",
    workspace_root: manager.workspaceRoot,
    ticket,
    queued,
    notifications,
    evidence: evidenceEntry.evidence,
    next_tools: ["hermes_lock_files", "hermes_submit_bug_fix", "hermes_update_bug_ticket", "hermes_run_gate"]
  };
}

async function listBugTickets({
  status = "active",
  severity = "",
  assignee = "",
  reporter = "",
  releaseBlockersOnly = false,
  limit = 100
} = {}) {
  await ensureDir(manager.paths.bugTicketsDir);
  const names = await fs.readdir(manager.paths.bugTicketsDir).catch(() => []);
  const tickets = [];
  const terminal = new Set(["closed", "wontfix", "duplicate"]);
  for (const name of names.filter((item) => item.endsWith(".json"))) {
    const ticket = await readJson(path.join(manager.paths.bugTicketsDir, name), null);
    if (!ticket) continue;
    if (status === "active" && terminal.has(ticket.status)) continue;
    if (status !== "all" && status !== "active" && ticket.status !== status) continue;
    if (severity && ticket.severity !== severity) continue;
    if (assignee && ticket.assignee !== assignee) continue;
    if (reporter && ticket.reporter !== reporter) continue;
    if (releaseBlockersOnly && !ticket.release_blocker) continue;
    tickets.push(ticket);
  }
  const severityRank = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  tickets.sort((a, b) =>
    (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9) ||
    String(a.updated_utc || "").localeCompare(String(b.updated_utc || ""))
  );
  const bounded = clampNumber(limit, { min: 1, max: 500, fallback: 100 });
  return { ok: true, workspace_root: manager.workspaceRoot, status, count: tickets.length, tickets: tickets.slice(0, bounded) };
}

async function updateBugTicket({
  owner,
  ticketId,
  status = "",
  assignee = "",
  severity = "",
  note = "",
  tags = [],
  releaseBlocker = null,
  evidence = []
} = {}) {
  const id = normalizeTicketId(ticketId);
  const ticket = await readBugTicket(id);
  if (!ticket) return { ok: false, status: "missing", workspace_root: manager.workspaceRoot, ticket_id: id };
  const next = {
    ...ticket,
    status: status || ticket.status,
    assignee: assignee === "" ? ticket.assignee : assignee || null,
    severity: severity || ticket.severity,
    release_blocker: typeof releaseBlocker === "boolean" ? releaseBlocker : ticket.release_blocker,
    tags: tags.length ? uniqueSorted([...normalizeTags(ticket.tags || []), ...normalizeTags(tags)]) : ticket.tags || [],
    updated_utc: utcNow(),
    updates: [
      ...(ticket.updates || []),
      {
        ts_utc: utcNow(),
        owner,
        status: status || ticket.status,
        note,
        evidence: Array.isArray(evidence) ? evidence.slice(0, 25) : []
      }
    ]
  };
  await writeJsonAtomic(bugTicketPath(id), next);
  const evidenceEntry = await manager.appendEvidence({
    owner,
    taskId: next.task_id || "",
    kind: "bug.updated",
    summary: `Bug updated: ${id} -> ${next.status}`,
    data: { ticket_id: id, status: next.status, note, release_blocker: next.release_blocker }
  });
  await manager.emitManualEvent({
    event_type: "bug.updated",
    owner,
    task_id: next.task_id || null,
    files: next.files || [],
    summary: `Bug updated: ${id} -> ${next.status}`,
    next_actor: "unassigned",
    recommended_action: ["fix_submitted"].includes(next.status) ? "review_fix" : "acknowledge",
    payload: { ticket_id: id, status: next.status, severity: next.severity, release_blocker: next.release_blocker }
  });
  let notifications = null;
  if (next.assignee) {
    notifications = await sendInboxMessage({
      sender: owner,
      recipients: [next.assignee],
      type: "note",
      priority: ["critical", "high"].includes(next.severity) ? "high" : "normal",
      subject: `Bug ticket ${id} updated: ${next.status}`,
      body: note || `Ticket ${id} is now ${next.status}.`,
      taskId: next.task_id || "",
      files: next.files || [],
      requiresAck: false,
      metadata: {
        kind: "bug_ticket",
        ticket_id: id,
        status: next.status,
        severity: next.severity,
        release_blocker: next.release_blocker
      }
    });
  }
  return { ok: true, status: "updated", workspace_root: manager.workspaceRoot, ticket: next, notifications, evidence: evidenceEntry.evidence };
}

async function submitBugFix({
  owner,
  ticketId,
  summary = "",
  branch = "",
  commit = "",
  mergeRequestUrl = "",
  gates = [],
  files = [],
  verdict = "submitted",
  closeTicket = false,
  evidence = []
} = {}) {
  const id = normalizeTicketId(ticketId);
  const ticket = await readBugTicket(id);
  if (!ticket) return { ok: false, status: "missing", workspace_root: manager.workspaceRoot, ticket_id: id };
  const now = utcNow();
  const normalizedFiles = files.length ? normalizeOptionalFiles(files) : ticket.files || [];
  const fix = {
    ts_utc: now,
    owner,
    summary,
    branch,
    commit,
    merge_request_url: mergeRequestUrl,
    gates: Array.isArray(gates) ? gates.slice(0, 50) : [],
    files: normalizedFiles,
    verdict,
    evidence: Array.isArray(evidence) ? evidence.slice(0, 50) : []
  };
  const nextStatus = closeTicket || verdict === "verified" ? "verified" : verdict === "needs_work" ? "reopened" : "fix_submitted";
  const next = {
    ...ticket,
    status: nextStatus,
    updated_utc: now,
    fixes: [...(ticket.fixes || []), fix],
    updates: [
      ...(ticket.updates || []),
      {
        ts_utc: now,
        owner,
        status: nextStatus,
        note: summary,
        evidence: fix.evidence
      }
    ]
  };
  await writeJsonAtomic(bugTicketPath(id), next);
  const evidenceEntry = await manager.appendEvidence({
    owner,
    taskId: next.task_id || "",
    kind: "bug.fix_submitted",
    summary: `Bug fix ${verdict}: ${id}`,
    data: { ticket_id: id, fix, next_status: nextStatus }
  });
  await manager.emitManualEvent({
    event_type: "bug.fix_submitted",
    owner,
    task_id: next.task_id || null,
    files: normalizedFiles,
    summary: `Bug fix ${verdict}: ${id}`,
    next_actor: "unassigned",
    recommended_action: nextStatus === "verified" ? "acknowledge" : "review_fix",
    payload: {
      ticket_id: id,
      status: nextStatus,
      branch,
      commit,
      merge_request_url: mergeRequestUrl,
      gate_count: fix.gates.length
    }
  });
  const reviewers = (await listPresenceRecords({ includeStale: false })).presence
    .filter((record) => record.owner !== owner && (record.status === "idle" || record.can_interrupt))
    .map((record) => record.owner)
    .slice(0, 10);
  const notifications = reviewers.length && nextStatus !== "verified"
    ? await sendInboxMessage({
        sender: owner,
        recipients: reviewers,
        type: "note",
        priority: ["critical", "high"].includes(next.severity) ? "high" : "normal",
        subject: `Review bug fix ${id}`,
        body: summary || `A fix was submitted for ticket ${id}.`,
        taskId: next.task_id || "",
        files: normalizedFiles,
        requiresAck: false,
        metadata: {
          kind: "bug_fix",
          ticket_id: id,
          status: nextStatus,
          branch,
          commit,
          merge_request_url: mergeRequestUrl
        }
      })
    : null;
  return {
    ok: true,
    status: "submitted",
    workspace_root: manager.workspaceRoot,
    ticket: next,
    fix,
    notifications,
    evidence: evidenceEntry.evidence,
    next_tools: nextStatus === "verified" ? ["hermes_complete_work"] : ["hermes_update_bug_ticket", "hermes_run_gate"]
  };
}

function defaultProjectContract() {
  return {
    contract_schema_version: 1,
    contract_id: "project-truth-contract",
    title: "Project truth and release-safety contract",
    project: path.basename(manager.workspaceRoot),
    scope: "Shared contract for all connected agents in this workspace.",
    required_gates: [],
    required_evidence: [
      "tests or proof command output for changed behavior",
      "exact changed files",
      "truthful remaining gaps"
    ],
    protected_paths: [
      ".gitlab-ci.yml",
      ".github/",
      "src/",
      "scripts/",
      "external/",
      "package.json",
      "pyproject.toml"
    ],
    forbidden_claim_patterns: [
      "\\b100%\\s+complete\\b",
      "\\beverything\\s+(?:is\\s+)?(?:fixed|working)\\b",
      "\\bno\\s+bugs?\\s+remain\\b",
      "\\brelease[- ]ready\\b",
      "\\bproduction[- ]ready\\b",
      "\\bperfect\\b"
    ],
    risk_patterns: [
      { id: "raw-secret", severity: "critical", regex: "(glpat-[A-Za-z0-9_-]{10,}|github_pat_[A-Za-z0-9_]{10,}|ghp_[A-Za-z0-9_]{10,}|sk-[A-Za-z0-9]{20,}|PRIVATE-TOKEN\\s*[:=])" },
      { id: "prompt-injection", severity: "high", regex: "(ignore\\s+previous\\s+instructions|developer\\s+mode|reveal\\s+system\\s+prompt|disable\\s+safety)" },
      { id: "fake-proof-language", severity: "high", regex: "(truth and proof.*without.*(?:test|gate|evidence)|verified.*without.*(?:test|gate|evidence))" },
      { id: "ui-only-not-wired", severity: "high", regex: "(ui[- ]only|not\\s+wired|frontend[- ]only|placeholder\\s+success|hardcoded\\s+success|fake\\s+data|mock\\s+data|stubbed\\s+implementation)" },
      { id: "destructive-git", severity: "critical", regex: "(git\\s+reset\\s+--hard|git\\s+clean\\s+-fd|git\\s+checkout\\s+--\\s+\\.)" }
    ],
    max_files_without_review: 25,
    max_changed_lines_without_review: 1200,
    auto_ticket_threshold: "high",
    updated_utc: null,
    updated_by: "system",
    notes: "Default contract is virtual until saved. Agents can upsert stricter project-specific rules."
  };
}

async function listProjectContracts({ includeDefault = true, limit = 100 } = {}) {
  await ensureDir(manager.paths.contractsDir);
  const names = await fs.readdir(manager.paths.contractsDir).catch(() => []);
  const contracts = [];
  for (const name of names.filter((item) => item.endsWith(".json"))) {
    const contract = await readJson(path.join(manager.paths.contractsDir, name), null);
    if (contract) contracts.push(contract);
  }
  contracts.sort((a, b) => String(a.contract_id || "").localeCompare(String(b.contract_id || "")));
  if (includeDefault && !contracts.some((contract) => contract.contract_id === "project-truth-contract")) {
    contracts.unshift(defaultProjectContract());
  }
  const bounded = clampNumber(limit, { min: 1, max: 500, fallback: 100 });
  return { ok: true, workspace_root: manager.workspaceRoot, count: contracts.length, contracts: contracts.slice(0, bounded) };
}

async function readProjectContract({ contractId = "project-truth-contract" } = {}) {
  const id = normalizeContractId(contractId);
  const saved = await readJson(contractPath(id), null);
  if (saved) return { ok: true, workspace_root: manager.workspaceRoot, contract: saved, source: "saved" };
  if (id === "project-truth-contract") {
    return { ok: true, workspace_root: manager.workspaceRoot, contract: defaultProjectContract(), source: "default" };
  }
  return { ok: false, status: "missing", workspace_root: manager.workspaceRoot, contract_id: id };
}

async function upsertProjectContract({
  owner,
  contractId = "project-truth-contract",
  title = "",
  project = "",
  scope = "",
  requiredGates = [],
  requiredEvidence = [],
  protectedPaths = [],
  forbiddenClaimPatterns = [],
  riskPatterns = [],
  maxFilesWithoutReview = 25,
  maxChangedLinesWithoutReview = 1200,
  autoTicketThreshold = "high",
  notes = "",
  merge = true
} = {}) {
  const id = normalizeContractId(contractId);
  const previous = await readJson(contractPath(id), null) || (id === "project-truth-contract" ? defaultProjectContract() : {});
  const now = utcNow();
  const contract = {
    contract_schema_version: 1,
    contract_id: id,
    title: title || previous.title || id,
    project: project || previous.project || path.basename(manager.workspaceRoot),
    scope: scope || previous.scope || "",
    required_gates: merge ? uniqueSorted([...(previous.required_gates || []), ...normalizeStringList(requiredGates, 200)]) : normalizeStringList(requiredGates, 200),
    required_evidence: merge ? uniqueSorted([...(previous.required_evidence || []), ...normalizeStringList(requiredEvidence, 200)]) : normalizeStringList(requiredEvidence, 200),
    protected_paths: merge ? uniqueSorted([...(previous.protected_paths || []), ...normalizeStringList(protectedPaths, 500)]) : normalizeStringList(protectedPaths, 500),
    forbidden_claim_patterns: merge ? uniqueSorted([...(previous.forbidden_claim_patterns || []), ...normalizeStringList(forbiddenClaimPatterns, 200)]) : normalizeStringList(forbiddenClaimPatterns, 200),
    risk_patterns: merge
      ? [...(previous.risk_patterns || []), ...normalizeRiskPatterns(riskPatterns)].slice(0, 300)
      : normalizeRiskPatterns(riskPatterns),
    max_files_without_review: clampNumber(maxFilesWithoutReview ?? previous.max_files_without_review, { min: 1, max: 5000, fallback: 25 }),
    max_changed_lines_without_review: clampNumber(maxChangedLinesWithoutReview ?? previous.max_changed_lines_without_review, { min: 1, max: 100000, fallback: 1200 }),
    auto_ticket_threshold: autoTicketThreshold || previous.auto_ticket_threshold || "high",
    notes: notes || previous.notes || "",
    created_utc: previous.created_utc || now,
    updated_utc: now,
    updated_by: owner
  };
  await writeJsonAtomic(contractPath(id), contract);
  const evidenceEntry = await manager.appendEvidence({
    owner,
    kind: "contract.updated",
    summary: `Project contract updated: ${id}`,
    data: { contract_id: id, title: contract.title, project: contract.project }
  });
  await manager.emitManualEvent({
    event_type: "contract.updated",
    owner,
    task_id: null,
    files: [],
    summary: `Project contract updated: ${id}`,
    next_actor: "unassigned",
    recommended_action: "acknowledge",
    payload: { contract_id: id, title: contract.title, project: contract.project }
  });
  return { ok: true, status: "updated", workspace_root: manager.workspaceRoot, contract, evidence: evidenceEntry.evidence };
}

function normalizeRiskPatterns(patterns = []) {
  if (!Array.isArray(patterns)) return [];
  return patterns.slice(0, 300).map((pattern) => ({
    id: String(pattern?.id || "custom-risk").slice(0, 80),
    severity: ["critical", "high", "medium", "low", "info"].includes(pattern?.severity) ? pattern.severity : "medium",
    regex: String(pattern?.regex || "").slice(0, 1000),
    message: String(pattern?.message || "").slice(0, 500)
  })).filter((pattern) => pattern.regex);
}

function severityRank(severity) {
  return { info: 0, low: 1, medium: 2, high: 3, critical: 4 }[severity] ?? 0;
}

function maxSeverity(findings = []) {
  return findings.reduce((best, finding) =>
    severityRank(finding.severity) > severityRank(best) ? finding.severity : best, "info");
}

function gateStatus(gate) {
  return String(gate?.status || gate?.result || gate?.verdict || "").toLowerCase();
}

function gateClaimsPass(gate) {
  if (!gate || typeof gate !== "object") return false;
  const status = gateStatus(gate);
  return gate.ok === true || gate.passed === true || status === "pass" || status === "passed" || status === "ok";
}

function gateName(gate) {
  return String(gate?.gate || gate?.id || gate?.name || gate?.command || "").toLowerCase();
}

function gateExitCode(gate) {
  for (const key of ["exitCode", "exit_code", "code", "statusCode", "status_code"]) {
    const value = gate?.[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  }
  return null;
}

function gateHasEvidenceId(gate) {
  const values = [
    gate?.evidence_id,
    gate?.evidenceId,
    gate?.evidence?.id,
    gate?.evidence?.evidence_id,
    gate?.evidence?.evidenceId,
    gate?.evidence?.evidence?.id,
    gate?.proof_id,
    gate?.proofId,
  ];
  return values.some((value) => typeof value === "string" && /^ev_[A-Za-z0-9_-]{8,}$/.test(value));
}

function gateHasRealnessBlocker(gate) {
  if (!gate || typeof gate !== "object") return false;
  const name = gateName(gate);
  const status = gateStatus(gate);
  const exitCode = gateExitCode(gate);
  if (exitCode !== null && exitCode !== 0) return true;
  if (gate.skipped === true || gate.skip === true || /^skip/.test(status)) return true;
  if (
    /(hermesproof|hermes[._-]?evidence|evidence[._-]?chain|evidence[._-]?ledger|proof[._-]?ledger)/i.test(name) &&
    !gateHasEvidenceId(gate)
  ) return true;
  return [
    "mock",
    "mocked",
    "stub",
    "stubbed",
    "fake",
    "fakeData",
    "fake_data",
    "hardcodedSuccess",
    "hardcoded_success",
    "uiOnly",
    "ui_only",
  ].some((key) => gate[key] === true);
}

function gatePasses(gate) {
  return gateClaimsPass(gate) && !gateHasRealnessBlocker(gate);
}

function hasReviewGate(gates = []) {
  return gates.some((gate) => {
    const name = String(gate.gate || gate.id || gate.name || gate.command || "").toLowerCase();
    return gatePasses(gate) && /(review|approval|codequality|quality|ruff|test|pytest|truth|gate)/.test(name);
  });
}

function compileRegex(pattern) {
  try { return new RegExp(pattern, "i"); } catch { return null; }
}

function textMatchesAny(text, patterns = []) {
  const hits = [];
  for (const pattern of patterns) {
    const regex = compileRegex(pattern);
    if (regex && regex.test(text)) hits.push(pattern);
  }
  return hits;
}

function collectGateRealnessFindings(gates = []) {
  const findings = [];
  if (!Array.isArray(gates)) return findings;
  for (const gate of gates) {
    if (!gateClaimsPass(gate)) continue;
    const name = gateName(gate);
    const exitCode = gateExitCode(gate);
    if (exitCode !== null && exitCode !== 0) {
      findings.push({
        severity: "critical",
        code: "gate.nonzero_exit_claimed_pass",
        message: "A gate claimed pass while reporting a non-zero process exit code.",
        evidence: { gate: name || "unnamed", exit_code: exitCode }
      });
    }
    const flaggedKeys = [
      "mock",
      "mocked",
      "stub",
      "stubbed",
      "fake",
      "fakeData",
      "fake_data",
      "hardcodedSuccess",
      "hardcoded_success",
      "uiOnly",
      "ui_only",
    ].filter((key) => gate[key] === true);
    if (flaggedKeys.length) {
      findings.push({
        severity: flaggedKeys.some((key) => /hardcoded|fake|stub|ui/i.test(key)) ? "critical" : "high",
        code: "gate.fake_or_stub_claimed_pass",
        message: "A gate claimed pass while marking itself as mock, fake, stubbed, hardcoded, or UI-only.",
        evidence: { gate: name || "unnamed", flagged_keys: flaggedKeys }
      });
    }
    if (
      /(hermesproof|hermes[._-]?evidence|evidence[._-]?chain|evidence[._-]?ledger|proof[._-]?ledger)/i.test(name) &&
      !gateHasEvidenceId(gate)
    ) {
      findings.push({
        severity: "high",
        code: "gate.hermes_evidence_id_missing",
        message: "A HermesProof/evidence gate claimed pass without an evidence id.",
        evidence: { gate: name || "unnamed" }
      });
    }
  }
  return findings;
}

function collectChangedFilesFromGit() {
  const names = new Set();
  for (const args of [
    ["diff", "--name-only"],
    ["diff", "--cached", "--name-only"],
    ["ls-files", "--others", "--exclude-standard"]
  ]) {
    const result = runGit(args);
    if (!result.ok) continue;
    for (const line of result.stdout.split(/\r?\n/)) {
      const item = line.trim();
      if (item) names.add(item.replace(/\\/g, "/"));
    }
  }
  return [...names].slice(0, 1000);
}

function gitShortstat() {
  const result = runGit(["diff", "--shortstat", "HEAD"]);
  if (!result.ok) return { ok: false, raw: "", files: 0, insertions: 0, deletions: 0 };
  const raw = result.stdout.trim();
  const files = Number((raw.match(/(\d+)\s+files?\s+changed/) || [])[1] || 0);
  const insertions = Number((raw.match(/(\d+)\s+insertions?\(\+\)/) || [])[1] || 0);
  const deletions = Number((raw.match(/(\d+)\s+deletions?\(-\)/) || [])[1] || 0);
  return { ok: true, raw, files, insertions, deletions, changed_lines: insertions + deletions };
}

function protectedPathHit(file, protectedPath) {
  const normalizedFile = String(file || "").replace(/\\/g, "/");
  const normalizedProtected = String(protectedPath || "").replace(/\\/g, "/");
  if (!normalizedFile || !normalizedProtected) return false;
  if (normalizedProtected.endsWith("/")) return normalizedFile.startsWith(normalizedProtected);
  return normalizedFile === normalizedProtected || normalizedFile.startsWith(`${normalizedProtected}/`);
}

async function readSmallWorkspaceFile(relFile, maxBytes = 200_000) {
  const normalized = manager.normalizeFiles([relFile])[0];
  const abs = path.join(manager.workspaceRoot, normalized);
  const stat = await fs.stat(abs).catch(() => null);
  if (!stat || !stat.isFile() || stat.size > maxBytes) return { file: normalized, text: "", skipped: true, size: stat?.size || 0 };
  return { file: normalized, text: await fs.readFile(abs, "utf8").catch(() => ""), skipped: false, size: stat.size };
}

async function antiSlopReview({
  owner,
  taskId = "",
  summary = "",
  claims = [],
  files = [],
  gates = [],
  evidence = [],
  contractIds = [],
  createTicket = true,
  autoTicketThreshold = "",
  ticketAssignee = "",
  enqueueTicket = true,
  scanFileContent = true,
  maxFilesToScan = 25,
  maxFileScanBytes = 100_000
} = {}) {
  const startedMs = Date.now();
  const allContracts = await listProjectContracts({ includeDefault: true, limit: 500 });
  const wantedIds = normalizeStringList(contractIds, 100).map(normalizeContractId);
  const contracts = wantedIds.length
    ? allContracts.contracts.filter((contract) => wantedIds.includes(contract.contract_id))
    : allContracts.contracts;
  const explicitFileList = Array.isArray(files) && files.length > 0;
  const explicitFiles = explicitFileList ? normalizeOptionalFiles(files) : [];
  const changedFiles = explicitFiles.length ? explicitFiles : collectChangedFilesFromGit();
  const normalizedFiles = changedFiles.length ? normalizeOptionalFiles(changedFiles) : [];
  const shortstat = explicitFileList
    ? {
        ok: true,
        skipped: true,
        reason: "explicit file list supplied; skipped git diff --shortstat for low latency",
        raw: "",
        files: normalizedFiles.length,
        insertions: 0,
        deletions: 0,
        changed_lines: 0
      }
    : gitShortstat();
  const claimText = [summary, ...normalizeStringList(claims, 100)].join("\n");
  const gatesPassed = (Array.isArray(gates) ? gates : []).filter(gatePasses);
  const findings = [];
  const scanLimit = clampNumber(maxFilesToScan, { min: 0, max: 100, fallback: 25 });
  const scanByteLimit = clampNumber(maxFileScanBytes, { min: 0, max: 1_000_000, fallback: 100_000 });

  function addFinding({ severity = "medium", code, message, files: findingFiles = [], contractId = "", evidence: findingEvidence = {} }) {
    findings.push({
      severity,
      code,
      message,
      files: normalizeStringList(findingFiles, 50),
      contract_id: contractId || null,
      evidence: findingEvidence
    });
  }

  if (!contracts.length) {
    addFinding({
      severity: "medium",
      code: "contract.missing",
      message: "No project contract was available; using no shared acceptance rules is unsafe for multi-agent work."
    });
  }

  for (const finding of collectGateRealnessFindings(gates)) {
    addFinding(finding);
  }

  for (const contract of contracts) {
    const requiredGates = normalizeStringList(contract.required_gates || [], 200);
    const passedNames = new Set(gatesPassed.map((gate) => String(gate.gate || gate.id || gate.name || gate.command || "").toLowerCase()));
    const missingRequired = requiredGates.filter((required) =>
      ![...passedNames].some((passed) => passed.includes(required.toLowerCase()))
    );
    if (missingRequired.length && normalizedFiles.length) {
      addFinding({
        severity: "medium",
        code: "contract.required_gates_missing",
        message: `Required gates not proven: ${missingRequired.join(", ")}`,
        contractId: contract.contract_id,
        evidence: { missing_required_gates: missingRequired }
      });
    }

    const forbiddenHits = textMatchesAny(claimText, contract.forbidden_claim_patterns || []);
    if (forbiddenHits.length && !gatesPassed.length) {
      addFinding({
        severity: "high",
        code: "claim.unproven_completion",
        message: "Completion/release-ready language was used without passing gate evidence.",
        contractId: contract.contract_id,
        evidence: { patterns: forbiddenHits.slice(0, 10) }
      });
    }

    const protectedHits = normalizedFiles.filter((file) =>
      (contract.protected_paths || []).some((protectedPath) => protectedPathHit(file, protectedPath))
    );
    if (protectedHits.length && !hasReviewGate(gates)) {
      addFinding({
        severity: "medium",
        code: "protected_paths.no_review_gate",
        message: "Protected files changed without a passing review/test/quality gate.",
        files: protectedHits.slice(0, 25),
        contractId: contract.contract_id
      });
    }

    const maxFiles = clampNumber(contract.max_files_without_review, { min: 1, max: 5000, fallback: 25 });
    if (normalizedFiles.length > maxFiles && !hasReviewGate(gates)) {
      addFinding({
        severity: "high",
        code: "blast_radius.too_many_files",
        message: `Changed ${normalizedFiles.length} files without review/test gate evidence.`,
        files: normalizedFiles.slice(0, 25),
        contractId: contract.contract_id,
        evidence: { file_count: normalizedFiles.length, max_files_without_review: maxFiles }
      });
    }

    const maxLines = clampNumber(contract.max_changed_lines_without_review, { min: 1, max: 100000, fallback: 1200 });
    if ((shortstat.changed_lines || 0) > maxLines && !hasReviewGate(gates)) {
      addFinding({
        severity: "high",
        code: "blast_radius.too_many_lines",
        message: `Changed ${shortstat.changed_lines} lines without review/test gate evidence.`,
        contractId: contract.contract_id,
        evidence: { shortstat, max_changed_lines_without_review: maxLines }
      });
    }

    const riskPatterns = normalizeRiskPatterns(contract.risk_patterns || []);
    if (scanFileContent !== false && scanLimit > 0 && scanByteLimit > 0) {
      for (const file of normalizedFiles.slice(0, scanLimit)) {
        const read = await readSmallWorkspaceFile(file, scanByteLimit);
        if (read.skipped || !read.text) continue;
        for (const pattern of riskPatterns) {
          const regex = compileRegex(pattern.regex);
          if (regex && regex.test(read.text)) {
            addFinding({
              severity: pattern.severity,
              code: `pattern.${pattern.id}`,
              message: pattern.message || `Risk pattern matched: ${pattern.id}`,
              files: [file],
              contractId: contract.contract_id,
              evidence: { pattern_id: pattern.id }
            });
          }
        }
      }
    }
  }

  if (claimText && /(complete|done|fixed|release[- ]ready|production[- ]ready)/i.test(claimText) && !Array.isArray(evidence)) {
    addFinding({
      severity: "medium",
      code: "evidence.invalid",
      message: "Claims were supplied, but evidence was not an array of proof records."
    });
  }

  const severity = maxSeverity(findings);
  const ok = findings.length === 0;
  const reviewId = `review-${Date.now().toString(36)}-${shaId(`${owner}:${manager.workspaceRoot}:${Date.now()}`, 8)}`;
  const threshold = autoTicketThreshold || contracts.find((contract) => contract.auto_ticket_threshold)?.auto_ticket_threshold || "high";
  const ticketNeeded = createTicket !== false && threshold !== "never" && severityRank(severity) >= severityRank(threshold);
  const review = {
    review_schema_version: 1,
    review_id: reviewId,
    workspace_root: manager.workspaceRoot,
    owner,
    task_id: taskId || null,
    status: ok ? "pass" : "needs_review",
    severity,
    summary,
    files: normalizedFiles,
    shortstat,
    gates,
    evidence: Array.isArray(evidence) ? evidence.slice(0, 50) : [],
    contracts: contracts.map((contract) => contract.contract_id),
    findings,
    performance: {
      duration_ms: Date.now() - startedMs,
      explicit_file_list: explicitFileList,
      file_count: normalizedFiles.length,
      file_content_scan_enabled: scanFileContent !== false,
      max_files_to_scan: scanLimit,
      max_file_scan_bytes: scanByteLimit,
      git_shortstat_skipped: Boolean(shortstat.skipped)
    },
    created_utc: utcNow()
  };
  await writeJsonAtomic(contractReviewPath(reviewId), review);
  const evidenceEntry = await manager.appendEvidence({
    owner,
    taskId,
    kind: findings.length ? "slop.review" : "contract.reviewed",
    summary: findings.length ? `Anti-slop review needs attention: ${severity}` : "Project contract review passed",
    data: { review_id: reviewId, status: review.status, severity, finding_count: findings.length }
  });
  await manager.emitManualEvent({
    event_type: findings.length ? "slop.detected" : "contract.reviewed",
    owner,
    task_id: taskId || null,
    files: normalizedFiles,
    summary: findings.length ? `Anti-slop review found ${findings.length} issue(s)` : "Project contract review passed",
    next_actor: "unassigned",
    recommended_action: findings.length ? "fix_scope" : "acknowledge",
    payload: { review_id: reviewId, status: review.status, severity, finding_count: findings.length }
  });

  let ticket = null;
  if (ticketNeeded) {
    ticket = await reportBugTicket({
      reporter: owner,
      ticketId: `slop-${reviewId}`,
      title: `Anti-slop review ${severity}: ${summary || taskId || reviewId}`,
      summary: `HermesProof anti-slop review found ${findings.length} issue(s).`,
      severity: severity === "critical" ? "critical" : "high",
      files: normalizedFiles,
      reproduction: "Run hermes_anti_slop_review with the same task/files/gates.",
      expected: "Claims, files, gates, and evidence satisfy the shared project contract.",
      actual: findings.map((finding) => `${finding.severity}: ${finding.code} - ${finding.message}`).join("\n"),
      evidence: [{ kind: "contract_review", review_id: reviewId, findings: findings.length }],
      tags: ["anti-slop", "contract"],
      assignee: ticketAssignee || "",
      enqueue: enqueueTicket !== false,
      priority: severity === "critical" ? 100 : 75,
      taskId: `slop-${reviewId}`
    });
  }

  return {
    ok,
    status: review.status,
    workspace_root: manager.workspaceRoot,
    review,
    ticket,
    evidence: evidenceEntry.evidence,
    duration_ms: review.performance.duration_ms,
    next_tools: ok
      ? ["hermes_complete_work", "hermes_run_gate"]
      : ["hermes_report_bug", "hermes_request_assistance", "hermes_lock_files", "hermes_run_gate"]
  };
}

async function listContractReviews({ status = "all", severity = "", limit = 100 } = {}) {
  await ensureDir(manager.paths.contractReviewsDir);
  const names = await fs.readdir(manager.paths.contractReviewsDir).catch(() => []);
  const reviews = [];
  for (const name of names.filter((item) => item.endsWith(".json"))) {
    const review = await readJson(path.join(manager.paths.contractReviewsDir, name), null);
    if (!review) continue;
    if (status !== "all" && review.status !== status) continue;
    if (severity && review.severity !== severity) continue;
    reviews.push(review);
  }
  reviews.sort((a, b) => String(b.created_utc || "").localeCompare(String(a.created_utc || "")));
  const bounded = clampNumber(limit, { min: 1, max: 500, fallback: 100 });
  return { ok: true, workspace_root: manager.workspaceRoot, status, count: reviews.length, reviews: reviews.slice(0, bounded) };
}

const CLAIM_STOPWORDS = new Set([
  "about", "after", "again", "agent", "agents", "also", "because", "before", "being", "between",
  "could", "every", "from", "have", "into", "make", "more", "need", "needs", "only", "project",
  "should", "that", "their", "there", "these", "thing", "this", "those", "through", "using",
  "what", "when", "where", "which", "while", "with", "without", "would", "your"
]);

const CLAIM_RISK_PATTERNS = Object.freeze([
  { code: "secret.raw_token", type: "security", severity: "critical", regex: /(glpat-[A-Za-z0-9_-]{10,}|github_pat_[A-Za-z0-9_]{10,}|ghp_[A-Za-z0-9_]{10,}|sk-[A-Za-z0-9]{20,}|PRIVATE-TOKEN\s*[:=])/ },
  { code: "completion.release_ready", type: "completion", severity: "high", regex: /\b(release[- ]ready|production[- ]ready|complete|completed|done|finished|perfect)\b/i },
  { code: "completion.everything_fixed", type: "completion", severity: "high", regex: /\b(everything\s+(?:is\s+)?(?:fixed|working|complete)|all\s+(?:bugs?|issues?)\s+(?:are\s+)?(?:fixed|gone)|no\s+bugs?\s+remain)\b/i },
  { code: "proof.test_result", type: "test_result", severity: "medium", regex: /\b(\d+\s+(?:pass|passed|fail|failed|skip|skipped)|tests?\s+(?:pass|passed|fail|failed)|proof\s+check|truth\s+gate|ruff|pytest|npm\s+test)\b/i },
  { code: "ci.gitlab", type: "ci", severity: "medium", regex: /\b(gitlab|pipeline|merge\s+request|merge\s+train|approval|code\s+quality|dependency\s+scan|ultimate)\b/i },
  { code: "capability.tooling", type: "capability", severity: "medium", regex: /\b(mcp|tool(?:s)?|bridge|provider|model|minimax|deepseek|siliconflow|lm\s*studio|ollama|winmerge|ghidra|x64dbg|resource\s+hacker)\b/i },
  { code: "temporal.current", type: "temporal", severity: "medium", regex: /\b(today|yesterday|tomorrow|latest|current|now|as of|mid[- ]?20\d\d|20\d\d-\d\d-\d\d)\b/i },
  { code: "numeric.exact", type: "factual", severity: "low", regex: /\b\d+(?:\.\d+)?\s*(?:%|ms|s|sec|seconds?|minutes?|hours?|tools?|files?|tests?|passes?|fails?|skips?|tokens?|commits?)\b/i }
]);

function normalizeClaimAuditId(value = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return `claim-audit-${Date.now().toString(36)}-${shaId(`${manager.workspaceRoot}:${Date.now()}`, 8)}`;
  const normalized = raw.replace(/[^a-z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 96);
  if (!/^[a-z0-9][a-z0-9._-]{1,95}$/.test(normalized) || normalized.includes("..")) {
    throw new Error("auditId must normalize to 2-96 safe path characters");
  }
  return normalized;
}

function splitClaimCandidates(text = "", maxClaims = 40) {
  const bounded = clampNumber(maxClaims, { min: 1, max: 200, fallback: 40 });
  const raw = String(text || "").replace(/\r/g, "\n").slice(0, 120_000);
  const chunks = [];
  for (const line of raw.split(/\n+/)) {
    const trimmed = line
      .replace(/^\s*(?:[-*+]|\d+[.)]|\|)\s*/, "")
      .replace(/\s*\|\s*/g, " ")
      .trim();
    if (!trimmed || /^[-:| ]{3,}$/.test(trimmed)) continue;
    const sentenceParts = trimmed.split(/(?<=[.!?])\s+/);
    for (const part of sentenceParts) {
      const claim = part.trim().replace(/\s+/g, " ");
      if (claim.length >= 8) chunks.push(claim.slice(0, 700));
      if (chunks.length >= bounded) break;
    }
    if (chunks.length >= bounded) break;
  }
  return [...new Set(chunks)].slice(0, bounded);
}

function classifyClaimText(text = "") {
  const triggers = [];
  let type = "factual";
  let severity = "info";
  for (const pattern of CLAIM_RISK_PATTERNS) {
    if (pattern.regex.test(text)) {
      triggers.push(pattern.code);
      if (severityRank(pattern.severity) > severityRank(severity)) severity = pattern.severity;
      if (type === "factual" || pattern.severity === "critical" || pattern.type === "completion") type = pattern.type;
    }
  }
  if (triggers.length === 0) {
    if (/\b(should|could|recommend|best|useful|possible|smart)\b/i.test(text)) {
      type = "recommendation";
      severity = "low";
      triggers.push("recommendation.unverified");
    } else {
      severity = "low";
      triggers.push("factual.ordinary");
    }
  }
  const needsGrounding = ["critical", "high", "medium"].includes(severity) ||
    /\b(pass|passed|failed|fixed|complete|release|pipeline|latest|current|today|tool|version|commit|tag|token)\b/i.test(text);
  const confidence = severity === "critical" ? 0.1 : severity === "high" ? 0.35 : severity === "medium" ? 0.55 : 0.75;
  return { type, severity, triggers, needs_grounding: needsGrounding, confidence };
}

function decomposeClaims({ text = "", claims = [], maxClaims = 40 } = {}) {
  const explicit = Array.isArray(claims) ? claims : [];
  const rawClaims = explicit.length
    ? explicit.map((claim) => typeof claim === "string" ? { text: claim } : claim).filter(Boolean)
    : splitClaimCandidates(text, maxClaims).map((claim) => ({ text: claim }));
  const bounded = clampNumber(maxClaims, { min: 1, max: 200, fallback: 40 });
  return rawClaims.slice(0, bounded).map((claim, index) => {
    const claimText = String(claim?.text || claim?.claim || "").trim().replace(/\s+/g, " ").slice(0, 700);
    const classified = classifyClaimText(claimText);
    return {
      claim_id: String(claim?.claim_id || claim?.id || `claim-${String(index + 1).padStart(3, "0")}`),
      text: claimText,
      type: claim?.type || classified.type,
      severity: claim?.severity || classified.severity,
      confidence: Number.isFinite(Number(claim?.confidence)) ? Math.max(0, Math.min(1, Number(claim.confidence))) : classified.confidence,
      triggers: normalizeStringList([...(claim?.triggers || []), ...classified.triggers], 20),
      needs_grounding: claim?.needs_grounding ?? classified.needs_grounding,
      source: String(claim?.source || "agent_output").slice(0, 80)
    };
  }).filter((claim) => claim.text);
}

function claimTerms(text = "") {
  return [...new Set(String(text || "").toLowerCase().match(/[a-z0-9_.-]{4,}/g) || [])]
    .filter((term) => !CLAIM_STOPWORDS.has(term))
    .slice(0, 12);
}

function evidenceBlob({ evidence = [], gates = [] } = {}) {
  const safe = { evidence: Array.isArray(evidence) ? evidence.slice(0, 80) : [], gates: Array.isArray(gates) ? gates.slice(0, 80) : [] };
  return JSON.stringify(safe).toLowerCase();
}

function evidenceSupportsClaim(claim, { evidence = [], gates = [] } = {}) {
  const blob = evidenceBlob({ evidence, gates });
  if (!blob || blob === "{\"evidence\":[],\"gates\":[]}") return false;
  const terms = claimTerms(claim.text);
  const hits = terms.filter((term) => blob.includes(term)).length;
  if (claim.type === "test_result" && (Array.isArray(gates) ? gates : []).some(gatePasses)) return true;
  if (claim.type === "completion" && (Array.isArray(gates) ? gates : []).some(gatePasses) && (Array.isArray(evidence) ? evidence : []).length) return true;
  return terms.length > 0 && hits >= Math.min(2, terms.length);
}

function groundingRequestForClaim(claim) {
  let suggestedTools = ["hermes_append_evidence", "hermes_verify_evidence"];
  if (claim.type === "completion") suggestedTools = ["hermes_anti_slop_review", "hermes_run_gate", "hermes_append_evidence"];
  else if (claim.type === "test_result") suggestedTools = ["hermes_run_gate", "hermes_append_evidence"];
  else if (claim.type === "ci") suggestedTools = ["hermes_gitlab_status", "hermes_gitlab_ultimate_status", "hermes_append_evidence"];
  else if (claim.type === "security") suggestedTools = ["hermes_anti_slop_review", "hermes_report_bug"];
  else if (claim.type === "capability") suggestedTools = ["hermes_backend_status", "hermes_live_status", "hermes_append_evidence"];
  return {
    claim_id: claim.claim_id,
    reason: claim.type === "completion"
      ? "Completion/release claims need passing gates plus explicit evidence."
      : "Claim should be grounded before another agent treats it as true.",
    suggested_tools: suggestedTools,
    prompt: `Ground or disprove this claim with direct tool output or project evidence: ${claim.text}`
  };
}

function claimCorrectionPacket({ auditId, owner, taskId, latencyMode, claims, findings, groundingRequests }) {
  const risky = claims.filter((claim) => findings.some((finding) => finding.claim_id === claim.claim_id));
  return {
    audit_id: auditId,
    latency_mode: latencyMode,
    generator_instruction: "Produce factual claims with proof links, gate output, or explicit uncertainty. Avoid completion language unless gates are attached.",
    auditor_instruction: "Check each claim against evidence. Mark unsupported claims, request only targeted grounding, and never invent proof.",
    rewriter_instruction: risky.length
      ? "Rewrite only the flagged claims. Keep supported claims unchanged, add exact gaps, and replace unproven certainty with conditional language."
      : "No rewrite required unless new evidence changes a claim.",
    claims_to_fix: risky.map((claim) => ({
      claim_id: claim.claim_id,
      text: claim.text,
      severity: claim.severity,
      required_grounding: groundingRequests.filter((request) => request.claim_id === claim.claim_id)
    })),
    handoff_message: risky.length
      ? `Claim audit ${auditId} needs correction for ${risky.length} claim(s). Task ${taskId || "n/a"}, owner ${owner}.`
      : `Claim audit ${auditId} passed.`
  };
}

async function auditClaims({
  owner,
  auditId = "",
  taskId = "",
  text = "",
  claims = [],
  files = [],
  gates = [],
  evidence = [],
  contractIds = [],
  latencyMode = "instant",
  createTicket = true,
  autoTicketThreshold = "high",
  notifyAgents = true,
  generatorProvider = "",
  generatorModel = "",
  auditorProvider = "",
  auditorModel = "",
  maxClaims = 40
} = {}) {
  const startedMs = Date.now();
  const id = normalizeClaimAuditId(auditId);
  const normalizedFiles = normalizeOptionalFiles(files);
  const normalizedLatency = ["instant", "grounded", "debate"].includes(latencyMode) ? latencyMode : "instant";
  const claimList = decomposeClaims({ text, claims, maxClaims });
  const findings = [];
  const groundingRequests = [];
  const evidenceArray = Array.isArray(evidence) ? evidence.slice(0, 100) : [];
  const gateArray = Array.isArray(gates) ? gates.slice(0, 100) : [];
  const allContracts = await listProjectContracts({ includeDefault: true, limit: 500 });
  const wantedIds = normalizeStringList(contractIds, 100).map(normalizeContractId);
  const contracts = wantedIds.length
    ? allContracts.contracts.filter((contract) => wantedIds.includes(contract.contract_id))
    : allContracts.contracts;

  function addClaimFinding({ claim, severity = "medium", code, message, evidence: findingEvidence = {} }) {
    findings.push({
      severity,
      code,
      claim_id: claim?.claim_id || null,
      claim_text: claim?.text || "",
      message,
      evidence: findingEvidence
    });
  }

  for (const claim of claimList) {
    const supported = evidenceSupportsClaim(claim, { evidence: evidenceArray, gates: gateArray });
    claim.supported = supported;
    if (claim.triggers.includes("secret.raw_token")) {
      addClaimFinding({
        claim,
        severity: "critical",
        code: "claim.secret_exposure",
        message: "Claim text appears to contain a raw secret/token pattern and must not be repeated."
      });
      groundingRequests.push(groundingRequestForClaim(claim));
      continue;
    }
    if (claim.type === "completion" && !supported) {
      addClaimFinding({
        claim,
        severity: "high",
        code: "claim.unproven_completion",
        message: "Completion/release-ready wording is unsupported by passing gates and explicit evidence."
      });
      groundingRequests.push(groundingRequestForClaim(claim));
      continue;
    }
    if (claim.type === "test_result" && !supported) {
      addClaimFinding({
        claim,
        severity: "high",
        code: "claim.unproven_test_result",
        message: "Test/proof result claim lacks matching gate or evidence record."
      });
      groundingRequests.push(groundingRequestForClaim(claim));
      continue;
    }
    if (claim.needs_grounding && !supported) {
      addClaimFinding({
        claim,
        severity: severityRank(claim.severity) >= severityRank("medium") ? "medium" : "low",
        code: "claim.needs_grounding",
        message: "Factual or capability claim needs targeted grounding before reuse."
      });
      groundingRequests.push(groundingRequestForClaim(claim));
    }
  }

  const claimText = claimList.map((claim) => claim.text).join("\n");
  for (const contract of contracts) {
    const forbiddenHits = textMatchesAny(claimText, contract.forbidden_claim_patterns || []);
    if (forbiddenHits.length && !gateArray.some(gatePasses)) {
      findings.push({
        severity: "high",
        code: "contract.forbidden_claim",
        claim_id: null,
        claim_text: "",
        message: `Project contract ${contract.contract_id} flagged ungrounded forbidden claim language.`,
        evidence: { patterns: forbiddenHits.slice(0, 10), contract_id: contract.contract_id }
      });
    }
  }

  const severity = maxSeverity(findings);
  const ok = findings.length === 0;
  const groundingMode = normalizedLatency === "instant"
    ? "manual_or_agent_followup"
    : normalizedLatency === "grounded"
      ? "targeted_grounding_requested"
      : "multi_agent_debate_requested";
  const correctionPacket = claimCorrectionPacket({
    auditId: id,
    owner,
    taskId,
    latencyMode: normalizedLatency,
    claims: claimList,
    findings,
    groundingRequests
  });
  const audit = {
    audit_schema_version: 1,
    audit_id: id,
    workspace_root: manager.workspaceRoot,
    owner,
    task_id: taskId || null,
    status: ok ? "pass" : "needs_correction",
    severity,
    latency_mode: normalizedLatency,
    grounding_mode: groundingMode,
    files: normalizedFiles,
    claims: claimList,
    findings,
    grounding_requests: groundingRequests,
    correction_packet: correctionPacket,
    providers: {
      generator: generatorProvider ? { provider: generatorProvider, model: generatorModel || "" } : null,
      auditor: auditorProvider ? { provider: auditorProvider, model: auditorModel || "" } : null
    },
    contracts: contracts.map((contract) => contract.contract_id),
    performance: { duration_ms: Date.now() - startedMs, claim_count: claimList.length },
    created_utc: utcNow()
  };
  await ensureDir(claimAuditDir());
  await writeJsonAtomic(claimAuditPath(id), audit);
  const evidenceEntry = await manager.appendEvidence({
    owner,
    taskId,
    kind: ok ? "claim.audit.passed" : "claim.audit.failed",
    summary: ok ? `Claim audit passed: ${id}` : `Claim audit needs correction: ${severity}`,
    data: { audit_id: id, status: audit.status, severity, finding_count: findings.length, claim_count: claimList.length }
  });
  await manager.emitManualEvent({
    event_type: ok ? "claim.audit.passed" : "claim.audit.failed",
    owner,
    task_id: taskId || null,
    files: normalizedFiles,
    summary: ok ? `Claim audit passed: ${id}` : `Claim audit found ${findings.length} issue(s)`,
    next_actor: "unassigned",
    recommended_action: ok ? "acknowledge" : "fix_scope",
    payload: { audit_id: id, status: audit.status, severity, finding_count: findings.length, grounding_requests: groundingRequests.length }
  });

  let ticket = null;
  const threshold = autoTicketThreshold || "high";
  if (createTicket !== false && threshold !== "never" && severityRank(severity) >= severityRank(threshold)) {
    ticket = await reportBugTicket({
      reporter: owner,
      ticketId: `claim-${id}`,
      title: `Claim audit ${severity}: ${taskId || id}`,
      summary: `HermesProof claim audit found ${findings.length} unsupported or risky claim(s).`,
      severity: severity === "critical" ? "critical" : "high",
      files: normalizedFiles,
      reproduction: "Run hermes_audit_claims with the same answer/claims/evidence.",
      expected: "Agent claims are backed by direct evidence, gates, or explicit uncertainty.",
      actual: findings.map((finding) => `${finding.severity}: ${finding.code} - ${finding.message}`).join("\n"),
      evidence: [{ kind: "claim_audit", audit_id: id, findings: findings.length }],
      tags: ["claim-audit", "anti-hallucination"],
      enqueue: true,
      priority: severity === "critical" ? 100 : 80,
      taskId: `claim-${id}`
    });
  }

  let notifications = null;
  if (notifyAgents !== false && !ok) {
    const active = (await listPresenceRecords({ includeStale: false })).presence
      .filter((record) => record.owner !== owner && (record.status === "idle" || record.can_interrupt || record.status === "reviewing"))
      .map((record) => record.owner)
      .slice(0, 8);
    if (active.length) {
      notifications = await sendInboxMessage({
        sender: owner,
        recipients: active,
        type: "assistance_request",
        priority: severityRank(severity) >= severityRank("high") ? "high" : "normal",
        subject: `Claim audit needs correction: ${id}`,
        body: correctionPacket.handoff_message,
        taskId: taskId || "",
        files: normalizedFiles,
        requiresAck: false,
        metadata: { kind: "claim_audit", audit_id: id, severity, finding_count: findings.length }
      });
    }
  }

  const providerRecords = [];
  if (generatorProvider) {
    providerRecords.push(await providerPerformance.recordOutcome({
      provider_id: generatorProvider,
      model_name: generatorModel,
      task_type: "claim-generation",
      outcome: ok ? "verified" : "needs_proof",
      latency_ms: audit.performance.duration_ms,
      context: taskId || "claim-audit",
      evidence: id
    }).catch((err) => ({ ok: false, provider_id: generatorProvider, message: err.message })));
  }
  if (auditorProvider) {
    providerRecords.push(await providerPerformance.recordOutcome({
      provider_id: auditorProvider,
      model_name: auditorModel,
      task_type: "claim-auditor",
      outcome: "completed",
      latency_ms: audit.performance.duration_ms,
      context: taskId || "claim-audit",
      evidence: id
    }).catch((err) => ({ ok: false, provider_id: auditorProvider, message: err.message })));
  }

  return {
    ok,
    status: audit.status,
    workspace_root: manager.workspaceRoot,
    audit,
    ticket,
    notifications,
    provider_records: providerRecords,
    evidence: evidenceEntry.evidence,
    duration_ms: audit.performance.duration_ms,
    next_tools: ok
      ? ["hermes_complete_work", "hermes_provider_record_outcome"]
      : ["hermes_run_gate", "hermes_append_evidence", "hermes_request_assistance", "hermes_anti_slop_review"]
  };
}

async function listClaimAudits({ status = "all", severity = "", limit = 100 } = {}) {
  await ensureDir(claimAuditDir());
  const names = await fs.readdir(claimAuditDir()).catch(() => []);
  const audits = [];
  for (const name of names.filter((item) => item.endsWith(".json"))) {
    const audit = await readJson(path.join(claimAuditDir(), name), null);
    if (!audit) continue;
    if (status !== "all" && audit.status !== status) continue;
    if (severity && audit.severity !== severity) continue;
    audits.push(audit);
  }
  audits.sort((a, b) => String(b.created_utc || "").localeCompare(String(a.created_utc || "")));
  const bounded = clampNumber(limit, { min: 1, max: 500, fallback: 100 });
  return { ok: true, workspace_root: manager.workspaceRoot, status, count: audits.length, audits: audits.slice(0, bounded) };
}

function providerRolePlan(candidates = []) {
  const ids = normalizeStringList(candidates, 20).map((value) => value.toLowerCase());
  const wanted = ids.length ? ids : ["minimax", "deepinfra", "deepseek", "siliconflow", "lm-studio", "ollama"];
  const roleHints = {
    minimax: ["live-controller", "cheat-engine-chat", "window-api", "gameplay-loop"],
    deepinfra: ["authorized-reverse-engineering", "uncensored-local-analysis", "openhands-sidecar", "fallback-agent"],
    deepseek: ["reverse-research", "static-analysis", "planner", "challenger"],
    siliconflow: ["embedding-recall", "cheap-batch", "similarity-search", "profile-memory"],
    "lm-studio": ["local-vision", "offline-review", "sensitive-local-audit", "fallback-chat"],
    ollama: ["local-fallback", "fast-critic", "offline-helper"]
  };
  return wanted.map((provider) => ({
    provider,
    roles: roleHints[provider] || ["general-helper"],
    task_types: roleHints[provider] || ["general"]
  }));
}

function nextAgenticActions({ audit, mode, rankedProviders, activeAgents, keepGoing }) {
  const actions = [];
  const needsCorrection = audit?.status === "needs_correction";
  const providers = rankedProviders?.providers || [];
  const bestProvider = providers[0]?.provider_id || "";
  if (needsCorrection) {
    actions.push({
      action: "ground_claims",
      reason: "Claim audit found unsupported or risky claims.",
      tool: "hermes_run_gate",
      provider_hint: bestProvider || "deepseek",
      blocking: true
    });
    actions.push({
      action: "append_evidence",
      reason: "Attach proof output or truthful gaps before the claim can be reused.",
      tool: "hermes_append_evidence",
      provider_hint: bestProvider || "minimax",
      blocking: true
    });
    if (activeAgents.length) {
      actions.push({
        action: "request_assistance",
        reason: "Active agents are available for a fast correction/handoff.",
        tool: "hermes_request_assistance",
        target_agents: activeAgents.map((agent) => agent.owner),
        blocking: false
      });
    }
  } else {
    actions.push({
      action: keepGoing ? "continue_next_probe" : "complete_or_wait",
      reason: keepGoing ? "Current claims are grounded; continue while progress is improving." : "No correction needed and keepGoing is false.",
      tool: keepGoing ? "hermes_enqueue_task" : "hermes_complete_work",
      provider_hint: bestProvider || "minimax",
      blocking: false
    });
  }
  if (mode === "autopilot" && keepGoing) {
    actions.push({
      action: "record_progress_or_failure",
      reason: "Autopilot mode should keep provider learning fresh and stop after repeated no-progress cycles.",
      tool: "hermes_provider_record_outcome",
      provider_hint: bestProvider || "minimax",
      blocking: false
    });
  }
  return actions;
}

function ageMs(iso) {
  const ts = typeof iso === "string" ? new Date(iso).getTime() : NaN;
  return Number.isFinite(ts) ? Math.max(0, Date.now() - ts) : null;
}

function msToSeconds(ms) {
  return ms === null ? null : Math.round(ms / 1000);
}

function latestEvidenceIdForOwner(owner, state) {
  const locks = (state?.locks || []).filter((lock) => lock.owner === owner);
  for (const lock of locks) {
    const history = Array.isArray(lock.history) ? lock.history.slice().reverse() : [];
    const hit = history.find((entry) => entry.evidence_id || entry.evidenceId);
    if (hit) return hit.evidence_id || hit.evidenceId;
  }
  return null;
}

function checkpointForAgent({ record, state }) {
  const owner = record.owner;
  const locks = (state.locks || []).filter((lock) => lock.owner === owner);
  const queueClaimed = (state.queue?.claimed || []).filter((task) => task.claimed_by === owner);
  const legacyTasks = (state.tasks || []).filter((task) => task.owner === owner && task.status !== "released");
  return {
    owner,
    status: record.status,
    role: record.role,
    task_id: record.task_id || queueClaimed[0]?.task_id || legacyTasks[0]?.id || null,
    last_presence_utc: record.updated_utc || null,
    expires_utc: record.expires_utc || null,
    waiting_on: record.waiting_on || null,
    note: record.note || "",
    locks: locks.map((lock) => ({ file: lock.file, task_id: lock.task_id || null, expires_utc: lock.expires_utc || null, is_stale: lock.is_stale })),
    queue_claimed: queueClaimed.map((task) => ({
      task_id: task.task_id,
      title: task.title || "",
      heartbeat_utc: task.heartbeat_utc || null,
      claimed_utc: task.claimed_utc || null,
      ttl_minutes: task.ttl_minutes || null,
      files_hint: task.files_hint || []
    })),
    legacy_tasks: legacyTasks.map((task) => ({ id: task.id, title: task.title || "", heartbeat_utc: task.heartbeat_utc || null, files: task.files || [] })),
    last_evidence_id: latestEvidenceIdForOwner(owner, state)
  };
}

async function agentWatchdog({
  owner,
  targetOwners = [],
  idleSeconds = 300,
  staleSeconds = 180,
  taskHeartbeatSeconds = 300,
  poke = true,
  recover = false,
  enqueueRecovery = false,
  includeBusy = true,
  note = ""
} = {}) {
  const idleMs = clampNumber(idleSeconds, { min: 30, max: 86_400, fallback: 300 }) * 1000;
  const staleMs = clampNumber(staleSeconds, { min: 30, max: 86_400, fallback: 180 }) * 1000;
  const taskHeartbeatMs = clampNumber(taskHeartbeatSeconds, { min: 30, max: 86_400, fallback: 300 }) * 1000;
  const targetSet = new Set(normalizeStringList(targetOwners, 100));
  const [presence, state] = await Promise.all([
    listPresenceRecords({ includeStale: true }),
    manager.getStateSummary()
  ]);
  const agents = presence.presence
    .filter((record) => !targetSet.size || targetSet.has(record.owner))
    .filter((record) => includeBusy || ["idle", "waiting", "blocked"].includes(record.status));
  const claimedTasks = state.queue?.claimed || [];
  const taskByOwner = new Map();
  for (const task of claimedTasks) {
    if (!task.claimed_by) continue;
    const group = taskByOwner.get(task.claimed_by) || [];
    group.push(task);
    taskByOwner.set(task.claimed_by, group);
  }
  const findings = [];
  const nowIso = utcNow();
  for (const record of agents) {
    const updatedAge = ageMs(record.updated_utc);
    const expiresAge = isPastIso(record.expires_utc) ? ageMs(record.expires_utc) : 0;
    const ownedTasks = taskByOwner.get(record.owner) || [];
    const heartbeatOld = ownedTasks.some((task) => {
      const heartbeatAge = ageMs(task.heartbeat_utc || task.claimed_utc);
      return heartbeatAge !== null && heartbeatAge > taskHeartbeatMs;
    });
    const stale = record.is_stale || expiresAge > 0 || (updatedAge !== null && updatedAge > staleMs && record.status !== "done");
    const idleTooLong = ["idle", "waiting", "blocked"].includes(record.status) && updatedAge !== null && updatedAge > idleMs;
    if (!stale && !idleTooLong && !heartbeatOld) continue;
    const status = stale ? "stale" : heartbeatOld ? "heartbeat_old" : "idle_too_long";
    const checkpoint = checkpointForAgent({ record, state });
    findings.push({
      owner: record.owner,
      status,
      severity: stale || heartbeatOld ? "high" : "medium",
      presence_age_seconds: msToSeconds(updatedAge),
      expired_seconds: expiresAge > 0 ? msToSeconds(expiresAge) : 0,
      task_heartbeat_old: heartbeatOld,
      checkpoint,
      recommended_actions: [
        ...(stale ? ["hermes_recover_stale_locks", "hermes_recover_stale_tasks"] : []),
        ...(heartbeatOld ? ["hermes_send_message", "hermes_request_assistance", "hermes_recover_stale_tasks"] : []),
        ...(idleTooLong ? ["hermes_send_message", "hermes_agentic_tick"] : []),
        "hermes_list_claim_audits",
        "hermes_get_inbox"
      ]
    });
  }

  const recipients = findings.map((finding) => finding.owner);
  let messages = null;
  if (poke !== false && recipients.length) {
    messages = await sendInboxMessage({
      sender: owner,
      recipients,
      type: "ping",
      priority: findings.some((finding) => finding.severity === "high") ? "high" : "normal",
      subject: "HermesProof watchdog poke",
      body: note || "Watchdog detected stale/idle/old-heartbeat state. Please heartbeat, update presence, release/hand off locks, or resume from your checkpoint.",
      taskId: "",
      files: [],
      requiresAck: true,
      metadata: {
        kind: "agent_watchdog",
        checked_utc: nowIso,
        findings: findings.map((finding) => ({
          owner: finding.owner,
          status: finding.status,
          task_id: finding.checkpoint.task_id,
          last_evidence_id: finding.checkpoint.last_evidence_id
        }))
      }
    });
    await manager.emitManualEvent({
      event_type: "agent.watchdog.poke",
      owner,
      task_id: null,
      files: [],
      summary: `Watchdog poked ${recipients.length} agent(s)`,
      next_actor: "unassigned",
      recommended_action: "acknowledge",
      payload: { recipients, finding_count: findings.length, message_ids: messages.messages.map((message) => message.id) }
    });
  }

  let recovery = null;
  if (recover !== false && findings.length) {
    const staleLockFiles = [];
    for (const finding of findings) {
      for (const lock of finding.checkpoint.locks) {
        if (lock.is_stale) staleLockFiles.push(lock.file);
      }
    }
    const staleTaskIds = findings
      .flatMap((finding) => finding.checkpoint.queue_claimed || [])
      .filter((task) => {
        const heartbeatAge = ageMs(task.heartbeat_utc || task.claimed_utc);
        return heartbeatAge !== null && heartbeatAge > taskHeartbeatMs;
      })
      .map((task) => task.task_id);
    const recoveredLocks = staleLockFiles.length
      ? await manager.recoverStaleLocks({ owner, files: staleLockFiles, note: note || "agent watchdog stale recovery" }).catch((err) => ({ ok: false, message: err.message }))
      : null;
    const recoveredTasks = staleTaskIds.length
      ? await manager.recoverStaleTasks({ owner, files: staleTaskIds, note: note || "agent watchdog stale recovery" }).catch((err) => ({ ok: false, message: err.message }))
      : null;
    recovery = { stale_lock_files: staleLockFiles, stale_task_ids: staleTaskIds, recovered_locks: recoveredLocks, recovered_tasks: recoveredTasks };
    await manager.emitManualEvent({
      event_type: "agent.watchdog.recovery",
      owner,
      task_id: null,
      files: staleLockFiles,
      summary: `Watchdog recovery checked ${findings.length} finding(s)`,
      next_actor: "unassigned",
      recommended_action: "acknowledge",
      payload: {
        stale_lock_count: staleLockFiles.length,
        stale_task_count: staleTaskIds.length,
        recovered_locks_status: recoveredLocks?.status || null,
        recovered_tasks_status: recoveredTasks?.status || null
      }
    });
  }

  let queued = null;
  if (enqueueRecovery !== false && findings.length) {
    queued = [];
    for (const finding of findings.slice(0, 25)) {
      const taskId = `watchdog-${finding.owner}-${Date.now().toString(36)}`.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 96);
      const result = await manager.enqueueTask({
        taskId,
        title: `Recover or resume agent ${finding.owner}`,
        summary: `Watchdog finding ${finding.status}. Resume from checkpoint or recover stale ownership.`,
        files_hint: finding.checkpoint.locks.map((lock) => lock.file).slice(0, 50),
        priority: finding.severity === "high" ? 90 : 60,
        target_owner_pattern: ".*",
        ttl_minutes: 120,
        data: {
          kind: "agent_watchdog_recovery",
          finding,
          checked_utc: nowIso
        },
        enqueued_by: owner
      });
      queued.push(result.task);
    }
  }

  await manager.appendEvidence({
    owner,
    kind: "agent.watchdog",
    summary: findings.length ? `Watchdog found ${findings.length} agent issue(s)` : "Watchdog found no stale/idle agent issues",
    data: {
      finding_count: findings.length,
      targets: targetSet.size ? [...targetSet] : null,
      poked: Boolean(messages),
      recovered: Boolean(recovery),
      queued: queued?.length || 0
    }
  });
  return {
    ok: true,
    status: findings.length ? "attention_needed" : "clear",
    workspace_root: manager.workspaceRoot,
    checked_utc: nowIso,
    thresholds: {
      idle_seconds: Math.round(idleMs / 1000),
      stale_seconds: Math.round(staleMs / 1000),
      task_heartbeat_seconds: Math.round(taskHeartbeatMs / 1000)
    },
    findings,
    messages,
    recovery,
    queued,
    next_tools: findings.length
      ? ["hermes_send_message", "hermes_recover_stale_locks", "hermes_recover_stale_tasks", "hermes_pick_task", "hermes_agentic_tick"]
      : ["hermes_update_presence", "hermes_heartbeat"]
  };
}

async function agenticTick({
  owner,
  taskId = "",
  mode = "assist",
  objective = "",
  latestOutput = "",
  claims = [],
  files = [],
  gates = [],
  evidence = [],
  providerCandidates = ["minimax", "deepinfra", "deepseek", "siliconflow", "lm-studio", "ollama"],
  primaryProvider = "minimax",
  maxClaims = 40,
  keepGoing = true,
  enqueueNext = true,
  notifyAgents = true,
  createTicket = true,
  noProgressCycles = 0,
  maxNoProgressCycles = 3,
  progressSignals = []
} = {}) {
  const startedMs = Date.now();
  const normalizedMode = ["assist", "autopilot", "review"].includes(mode) ? mode : "assist";
  const normalizedFiles = normalizeOptionalFiles(files);
  const cycles = clampNumber(noProgressCycles, { min: 0, max: 1000, fallback: 0 });
  const maxCycles = clampNumber(maxNoProgressCycles, { min: 1, max: 100, fallback: 3 });
  const signals = normalizeStringList(progressSignals, 50);
  const shouldContinue = keepGoing !== false && cycles < maxCycles;
  const rankedProviders = await providerPerformance.rankProviders({
    task_type: objective || taskId || "agentic-loop",
    candidates: providerCandidates,
    min_score: 0
  }).catch((err) => ({ ok: false, providers: [], message: err.message }));
  const roles = providerRolePlan(providerCandidates);
  const activeAgents = (await listPresenceRecords({ includeStale: false })).presence
    .filter((record) => record.owner !== owner)
    .slice(0, 12);
  const audit = await auditClaims({
    owner,
    auditId: `tick-${Date.now().toString(36)}-${shaId(`${owner}:${taskId}:${Date.now()}`, 8)}`,
    taskId,
    text: latestOutput || objective,
    claims,
    files: normalizedFiles,
    gates,
    evidence,
    latencyMode: normalizedMode === "review" ? "grounded" : "instant",
    createTicket,
    notifyAgents: false,
    generatorProvider: primaryProvider,
    auditorProvider: rankedProviders.providers?.find((provider) => provider.provider_id !== primaryProvider)?.provider_id || "",
    maxClaims
  });
  const nextActions = nextAgenticActions({
    audit: audit.audit,
    mode: normalizedMode,
    rankedProviders,
    activeAgents,
    keepGoing: shouldContinue
  });
  let queued = null;
  if (enqueueNext !== false && shouldContinue && audit.status === "needs_correction") {
    queued = await manager.enqueueTask({
      taskId: `agentic-${audit.audit.audit_id}`,
      title: `Ground/correct claim audit ${audit.audit.audit_id}`,
      summary: audit.audit.correction_packet.handoff_message,
      files_hint: normalizedFiles,
      priority: audit.audit.severity === "critical" ? 100 : 80,
      target_owner_pattern: ".*",
      ttl_minutes: 120,
      data: {
        kind: "agentic_claim_correction",
        audit_id: audit.audit.audit_id,
        objective,
        next_actions: nextActions,
        provider_roles: roles
      },
      enqueued_by: owner
    });
  }
  let notifications = null;
  if (notifyAgents !== false && activeAgents.length && audit.status === "needs_correction") {
    notifications = await sendInboxMessage({
      sender: owner,
      recipients: activeAgents.map((record) => record.owner).slice(0, 8),
      type: "assistance_request",
      priority: audit.audit.severity === "critical" ? "urgent" : "high",
      subject: `Agentic tick needs help: ${taskId || audit.audit.audit_id}`,
      body: audit.audit.correction_packet.handoff_message,
      taskId,
      files: normalizedFiles,
      requiresAck: false,
      metadata: {
        kind: "agentic_tick",
        audit_id: audit.audit.audit_id,
        objective,
        next_actions: nextActions
      }
    });
  }
  const loopState = {
    ok: audit.ok,
    status: audit.status === "needs_correction" ? "needs_action" : shouldContinue ? "continue" : "stop",
    mode: normalizedMode,
    objective,
    task_id: taskId || null,
    no_progress_cycles: cycles,
    max_no_progress_cycles: maxCycles,
    keep_going: shouldContinue,
    progress_signals: signals,
    provider_roles: roles,
    ranked_providers: rankedProviders.providers || [],
    active_agents: activeAgents.map((record) => ({ owner: record.owner, status: record.status, role: record.role, can_interrupt: record.can_interrupt })),
    audit_id: audit.audit.audit_id,
    next_actions: nextActions,
    queued_task: queued?.task || null,
    notifications,
    duration_ms: Date.now() - startedMs
  };
  await manager.appendEvidence({
    owner,
    taskId,
    kind: "agentic.tick",
    summary: `Agentic tick ${loopState.status}: ${taskId || objective || audit.audit.audit_id}`,
    data: {
      audit_id: audit.audit.audit_id,
      status: loopState.status,
      action_count: nextActions.length,
      provider_count: loopState.ranked_providers.length,
      active_agent_count: loopState.active_agents.length
    }
  });
  await manager.emitManualEvent({
    event_type: "agentic.tick",
    owner,
    task_id: taskId || null,
    files: normalizedFiles,
    summary: `Agentic tick ${loopState.status}: ${taskId || objective || audit.audit.audit_id}`,
    next_actor: "unassigned",
    recommended_action: audit.status === "needs_correction" ? "fix_scope" : "acknowledge",
    payload: {
      audit_id: audit.audit.audit_id,
      status: loopState.status,
      mode: normalizedMode,
      next_actions: nextActions,
      queued_task_id: queued?.task?.task_id || null
    }
  });
  return {
    ok: audit.ok,
    workspace_root: manager.workspaceRoot,
    loop: loopState,
    audit: audit.audit,
    provider_records: audit.provider_records,
    ticket: audit.ticket,
    next_tools: shouldContinue
      ? ["hermes_pick_task", "hermes_request_assistance", "hermes_provider_rank", "hermes_audit_claims"]
      : ["hermes_complete_work", "hermes_provider_record_outcome"]
  };
}

async function requestAssistance({
  requester,
  requiredSkills = [],
  taskType = "",
  subject = "",
  body = "",
  taskId = "",
  files = [],
  priority = "normal",
  limit = 5,
  includeBusy = false,
  targetOwners = [],
  allowSelf = false,
  responseDeadlineSeconds = 300
} = {}) {
  const normalizedFiles = Array.isArray(files) && files.length ? manager.normalizeFiles(files) : [];
  const required = normalizeTags(requiredSkills);
  const taskTag = normalizeTags(taskType ? [taskType] : [])[0] || "";
  const boundedLimit = clampNumber(limit, { min: 1, max: 25, fallback: 5 });
  const responseDeadline = secondsFromNow(clampNumber(responseDeadlineSeconds, { min: 30, max: 86_400, fallback: 300 }));
  let candidates = [];
  let missingTargets = [];

  const directTargets = [...new Set(Array.isArray(targetOwners) ? targetOwners : [])]
    .filter((owner) => allowSelf || owner !== requester)
    .slice(0, boundedLimit);
  if (directTargets.length) {
    const [presence, locks] = await Promise.all([
      listPresenceRecords({ includeStale: false }),
      manager.listLocks()
    ]);
    const presenceByOwner = new Map(presence.presence.map((record) => [record.owner, record]));
    const lockCounts = new Map();
    for (const lock of locks.locks) {
      lockCounts.set(lock.owner, (lockCounts.get(lock.owner) || 0) + 1);
    }
    missingTargets = directTargets.filter((owner) => !presenceByOwner.has(owner));
    candidates = directTargets
      .map((owner) => presenceByOwner.get(owner))
      .filter(Boolean)
      .map((record) => {
        const activeLockCount = lockCounts.get(record.owner) || 0;
        const baseScore =
          100 +
          (record.status === "idle" ? 20 : 0) +
          (record.status === "waiting" ? 10 : 0) +
          (record.can_interrupt ? 5 : -20) -
          activeLockCount * 3;
        return {
          owner: record.owner,
          role: record.role,
          status: record.status,
          skills: normalizeTags(record.skills || []),
          task_types: normalizeTags(record.task_types || []),
          can_interrupt: record.can_interrupt,
          active_lock_count: activeLockCount,
          base_score: baseScore,
          score: baseScore,
          note: record.note || "",
          direct_target: true
        };
      });
  } else {
    const found = await findAgentCandidates({
      requiredSkills: required,
      taskType: taskTag,
      includeBusy,
      limit: boundedLimit + 1
    });
    candidates = (found.candidates || [])
      .filter((candidate) => allowSelf || candidate.owner !== requester)
      .slice(0, boundedLimit);
  }
  candidates = await applyDispatchScores(candidates, taskTag);
  candidates.sort((a, b) => b.score - a.score || a.owner.localeCompare(b.owner));

  if (!candidates.length) {
    await manager.emitManualEvent({
      event_type: "assistance.requested",
      owner: requester,
      task_id: taskId || null,
      files: normalizedFiles,
      summary: subject || `Assistance requested by ${requester}`,
      next_actor: "unassigned",
      recommended_action: "acknowledge",
      payload: {
        status: "no_candidates",
        required_skills: required,
        task_type: taskTag || null,
        include_busy: includeBusy,
        target_owners: directTargets,
        missing_target_owners: missingTargets
      }
    });
    return {
      ok: false,
      status: "no_candidates",
      workspace_root: manager.workspaceRoot,
      required_skills: required,
      task_type: taskTag || null,
      candidates: [],
      missing_target_owners: missingTargets,
      messages: [],
      next_tools: ["hermes_live_status", "hermes_list_presence", "hermes_find_agents", "hermes_request_assistance"]
    };
  }

  const recipients = candidates.map((candidate) => candidate.owner);
  const sent = await sendInboxMessage({
    sender: requester,
    recipients,
    type: "assistance_request",
    priority,
    subject: subject || `Assistance requested by ${requester}`,
    body,
    taskId,
    files: normalizedFiles,
    requiresAck: true,
    metadata: {
      required_skills: required,
      task_type: taskTag || null,
      requester,
      candidate_count: candidates.length,
      response_deadline_utc: responseDeadline
    }
  });
  await manager.emitManualEvent({
    event_type: "assistance.requested",
    owner: requester,
    task_id: taskId || null,
    files: normalizedFiles,
    summary: subject || `Assistance requested by ${requester}`,
    next_actor: "unassigned",
    recommended_action: "acknowledge",
    payload: {
      status: "requested",
      recipients,
      required_skills: required,
      task_type: taskTag || null,
      message_ids: sent.messages.map((message) => message.id)
    }
  });
  return {
    ok: true,
    status: "requested",
    workspace_root: manager.workspaceRoot,
    requester,
    recipients,
    required_skills: required,
    task_type: taskTag || null,
    response_deadline_utc: responseDeadline,
    missing_target_owners: missingTargets,
    candidates,
    messages: sent.messages,
    next_tools: ["hermes_wait_for_assistance", "hermes_wait_for_inbox", "hermes_ack_message", "hermes_send_message", "hermes_request_unlock"]
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

async function waitForInbox({
  owner,
  type = "",
  includeAcked = false,
  timeoutMs = 25_000,
  pollMs = 500,
  limit = 50
} = {}) {
  const start = Date.now();
  const boundedTimeout = clampNumber(timeoutMs, { min: 0, max: 120_000, fallback: 25_000 });
  const deadline = start + boundedTimeout;
  const sleepMs = clampNumber(pollMs, { min: 100, max: 5_000, fallback: 500 });
  let inbox = await readInbox({ owner, includeAcked, type, limit });
  while (inbox.count === 0 && Date.now() < deadline) {
    await sleep(Math.min(sleepMs, Math.max(0, deadline - Date.now())));
    inbox = await readInbox({ owner, includeAcked, type, limit });
  }
  return {
    ok: true,
    status: inbox.count > 0 ? "ready" : "timeout",
    owner,
    waited_ms: Math.max(0, Date.now() - start),
    type: type || null,
    count: inbox.count,
    messages: inbox.messages
  };
}

async function findInboxMessagesByIds(messageIds = []) {
  await ensureDir(manager.paths.inboxDir);
  const wanted = new Set(normalizeStringList(messageIds, 100).filter((id) => /^[A-Za-z0-9._-]+$/.test(id) && !id.includes("..")));
  if (!wanted.size) return [];
  const owners = await fs.readdir(manager.paths.inboxDir).catch(() => []);
  const found = [];
  for (const owner of owners) {
    const stat = await fs.stat(inboxDir(owner)).catch(() => null);
    if (!stat?.isDirectory?.()) continue;
    for (const messageId of wanted) {
      const message = await readJson(inboxMessagePath(owner, messageId), null);
      if (message) found.push(message);
    }
  }
  found.sort((a, b) => String(a.created_utc).localeCompare(String(b.created_utc)) || a.id.localeCompare(b.id));
  return found;
}

async function assistanceStatus({
  requester,
  messageIds = [],
  responseDeadlineUtc = "",
  timeoutSeconds = 300
} = {}) {
  const requestedIds = normalizeStringList(messageIds, 100);
  const messages = (await findInboxMessagesByIds(requestedIds))
    .filter((message) => message.type === "assistance_request")
    .filter((message) => message.sender === requester || message?.metadata?.requester === requester);
  const deadline = responseDeadlineUtc || messages.find((message) => message?.metadata?.response_deadline_utc)?.metadata?.response_deadline_utc || "";
  const fallbackDeadlineMs = messages.length
    ? new Date(messages[0].created_utc).getTime() + clampNumber(timeoutSeconds, { min: 30, max: 86_400, fallback: 300 }) * 1000
    : Date.now();
  const parsedDeadlineMs = deadline ? new Date(deadline).getTime() : NaN;
  const deadlineMs = Number.isFinite(parsedDeadlineMs) ? parsedDeadlineMs : fallbackDeadlineMs;
  const accepted = messages.filter((message) => ["acknowledged", "done"].includes(message.ack_status));
  const declined = messages.filter((message) => message.ack_status === "dismissed");
  const pending = messages.filter((message) => !message.acked_utc);
  const missing = requestedIds.filter((id) => !messages.some((message) => message.id === id));
  const allFound = requestedIds.length > 0 && missing.length === 0 && messages.length === requestedIds.length;
  const expired = Number.isFinite(deadlineMs) && Date.now() >= deadlineMs;
  const status = accepted.length
    ? "accepted"
    : allFound && declined.length === messages.length
      ? "declined"
      : expired
        ? "timeout"
        : "pending";
  const firstResponse = accepted[0] || declined[0] || null;
  return {
    ok: true,
    status,
    workspace_root: manager.workspaceRoot,
    requester,
    response_deadline_utc: Number.isFinite(deadlineMs) ? new Date(deadlineMs).toISOString() : null,
    accepted: accepted.map((message) => ({
      owner: message.recipient,
      message_id: message.id,
      ack_status: message.ack_status,
      ack_note: message.ack_note,
      acked_utc: message.acked_utc
    })),
    declined: declined.map((message) => ({
      owner: message.recipient,
      message_id: message.id,
      ack_note: message.ack_note,
      acked_utc: message.acked_utc
    })),
    pending: pending.map((message) => ({
      owner: message.recipient,
      message_id: message.id,
      priority: message.priority,
      created_utc: message.created_utc
    })),
    missing_message_ids: missing,
    first_response: firstResponse
      ? {
          owner: firstResponse.recipient,
          message_id: firstResponse.id,
          status: firstResponse.ack_status,
          note: firstResponse.ack_note,
          acked_utc: firstResponse.acked_utc
        }
      : null,
    next_tools: status === "accepted"
      ? ["hermes_send_message", "hermes_request_unlock", "hermes_complete_work"]
      : status === "timeout" || status === "declined"
        ? ["hermes_request_assistance", "hermes_find_agents", "hermes_list_presence"]
        : ["hermes_wait_for_assistance", "hermes_wait_for_events", "hermes_live_status"]
  };
}

async function waitForAssistance({
  requester,
  messageIds = [],
  responseDeadlineUtc = "",
  timeoutSeconds = 300,
  timeoutMs = 25_000,
  pollMs = 500
} = {}) {
  const start = Date.now();
  const waitMs = clampNumber(timeoutMs, { min: 0, max: 120_000, fallback: 25_000 });
  const sleepMs = clampNumber(pollMs, { min: 100, max: 5_000, fallback: 500 });
  const deadline = start + waitMs;
  let state = await assistanceStatus({ requester, messageIds, responseDeadlineUtc, timeoutSeconds });
  while (state.status === "pending" && Date.now() < deadline) {
    await sleep(Math.min(sleepMs, Math.max(0, deadline - Date.now())));
    state = await assistanceStatus({ requester, messageIds, responseDeadlineUtc, timeoutSeconds });
  }
  return { ...state, waited_ms: Math.max(0, Date.now() - start) };
}

async function ackInboxMessage({
  owner,
  messageId,
  status = "acknowledged",
  note = "",
  notifySender = true,
  replyBody = ""
} = {}) {
  const file = inboxMessagePath(owner, messageId);
  const message = await readJson(file, null);
  if (!message) return { ok: false, status: "missing", message_id: messageId };
  const alreadySameAck = Boolean(message.acked_utc) && message.ack_status === status && (message.ack_note || "") === (note || "");
  if (alreadySameAck) {
    return {
      ok: true,
      status,
      message,
      sender_notification: null,
      notification_skipped: "already_acknowledged"
    };
  }
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
  let sender_notification = null;
  if (notifySender !== false && message.sender && message.sender !== owner) {
    const sent = await sendInboxMessage({
      sender: owner,
      recipients: [message.sender],
      type: "note",
      priority: status === "dismissed" ? "normal" : message.priority || "normal",
      subject: `Ack from ${owner}: ${message.subject || message.id}`,
      body: replyBody || note || `Message ${status}.`,
      taskId: message.task_id || "",
      files: message.files || [],
      requiresAck: false,
      metadata: {
        ack_for_message_id: message.id,
        ack_status: status,
        ack_note: note,
        original_type: message.type,
        original_recipient: owner
      }
    });
    sender_notification = sent.messages[0] || null;
  }
  return { ok: true, status, message, sender_notification };
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
  "hermes_connect_project",
  {
    title: "Connect project",
    description: "Switch to a workspace, optionally ensure/wire its GitLab project over SSH/HTTPS, publish agent presence, and return redacted access/status in one call.",
    inputSchema: {
      owner: Owner,
      workspaceRoot: WorkspaceRoot,
      reason: z.string().default(""),
      allowActiveLocks: z.boolean().default(false),
      projectFullPath: OptionalGitLabProjectFullPath,
      namespacePath: GitLabNamespacePath,
      projectPath: OptionalGitLabProjectPath,
      name: z.string().default(""),
      visibility: GitLabVisibility,
      description: z.string().default(""),
      initializeWithReadme: z.boolean().default(false),
      ensureGitLabProject: z.boolean().default(false),
      addRemote: z.boolean().default(true),
      remoteName: z.string().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/).default("gitlab"),
      remoteProtocol: GitRemoteProtocol,
      updateExistingRemote: z.boolean().default(false),
      probeGitLab: z.boolean().default(false),
      joinPresence: z.boolean().default(true),
      displayName: z.string().default(""),
      host: z.string().default(""),
      model: z.string().default(""),
      mode: AgentMode,
      role: z.string().default("agent"),
      status: PresenceStatus,
      skills: z.array(z.string()).default([]),
      taskTypes: z.array(z.string()).default([]),
      hostSupplies: z.array(z.string()).default([]),
      hermesproofSupplies: z.array(z.string()).default([]),
      notes: z.string().default(""),
      taskId: OptionalTaskId,
      files: z.array(z.string()).default([]),
      ttlSeconds: z.number().int().min(30).max(86_400).default(300),
      canInterrupt: z.boolean().default(true),
      includeInbox: z.boolean().default(true),
      includeEvents: z.boolean().default(true)
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: true }
  },
  async (args) => {
    try {
      const desiredFullPath = gitLabFullPath({
        projectFullPath: args.projectFullPath,
        namespacePath: args.namespacePath,
        projectPath: args.projectPath
      });
      const split = splitGitLabFullPath(desiredFullPath);
      const namespacePath = args.namespacePath || split.namespacePath;
      const projectPath = args.projectPath || split.projectPath;
      const workspace = await activateWorkspace(args.workspaceRoot, {
        owner: args.owner,
        reason: args.reason || (desiredFullPath ? `connect project ${desiredFullPath}` : "connect workspace"),
        validateExists: true,
        allowActiveLocks: args.allowActiveLocks === true
      });

      const client = createGitLabClient();
      const gitlabStatus = await client.status({
        probe: args.probeGitLab === true,
        includeIdentity: false
      });

      let projectResult = null;
      let remote = null;
      if (desiredFullPath || projectPath) {
        if (!client.config.ok) {
          projectResult = {
            ok: false,
            status: "missing_token",
            configured: false,
            project_full_path: desiredFullPath || projectPath,
            message: missingGitLabTokenMessage()
          };
        } else if (args.ensureGitLabProject === true) {
          projectResult = await client.ensureProject({
            namespacePath,
            projectPath,
            name: args.name,
            visibility: args.visibility,
            description: args.description,
            initializeWithReadme: args.initializeWithReadme
          });
        } else {
          const project = await client.getProject(desiredFullPath || projectPath);
          projectResult = project
            ? {
                ok: true,
                status: "exists",
                created: false,
                base_url: client.config.base_url,
                token_source: client.config.token_source,
                project
              }
            : {
                ok: false,
                status: "missing",
                created: false,
                base_url: client.config.base_url,
                token_source: client.config.token_source,
                project_full_path: desiredFullPath || projectPath,
                message: "GitLab project was not found or token cannot access it. Pass ensureGitLabProject=true to create it when the namespace exists."
              };
        }
        if (projectResult?.ok && args.addRemote !== false) {
          remote = configureGitRemote({
            project: projectResult.project,
            remoteName: args.remoteName,
            protocol: args.remoteProtocol,
            updateExistingRemote: args.updateExistingRemote
          });
        }
      }

      let joined = null;
      if (args.joinPresence !== false) {
        const registered = await registerAgentProfile({
          ...args,
          workspaceRoots: [workspace.workspace_root],
          defaultWorkspaceRoot: workspace.workspace_root,
          gitRemotes: remote?.remote_url ? [remote.remote_url] : [],
          updatePresence: false
        });
        const presence = await updatePresenceRecord({
          owner: args.owner,
          role: args.role,
          status: args.status,
          taskId: args.taskId || "",
          files: args.files || [],
          skills: args.skills || [],
          taskTypes: args.taskTypes || [],
          note: args.notes || `Connected to ${workspace.workspace_root}`,
          ttlSeconds: args.ttlSeconds,
          canInterrupt: args.canInterrupt
        });
        const [inbox, events, profiles] = await Promise.all([
          args.includeInbox === false ? null : readInbox({ owner: args.owner, includeAcked: false, limit: 50 }),
          args.includeEvents === false ? null : manager.listEvents({ status: "outbox", limit: 25 }),
          listAgentProfiles({ includePresence: true, limit: 100 })
        ]);
        joined = {
          status: registered.status === "registered" ? "joined" : "refreshed",
          profile: registered.profile,
          presence: presence.presence,
          inbox,
          agent_profiles: profiles.profiles,
          recent_outbox_events: events?.events || []
        };
      }

      const state = await manager.getStateSummary();
      const git = gitWorkspaceSnapshot();
      const evidence = await manager.appendEvidence({
        owner: args.owner,
        taskId: args.taskId || "",
        kind: "project.connect",
        summary: `HermesProof project connected: ${workspace.workspace_root}`,
        data: {
          workspace_root: workspace.workspace_root,
          previous_workspace_root: workspace.previous_workspace_root,
          gitlab_status: {
            status: gitlabStatus.status,
            configured: gitlabStatus.configured,
            authenticated: gitlabStatus.authenticated,
            token_source: gitlabStatus.token_source || null,
            base_url: gitlabStatus.base_url
          },
          project: projectResult
            ? {
                ok: projectResult.ok,
                status: projectResult.status,
                created: projectResult.created,
                project: projectResult.project || null
              }
            : null,
          remote
        }
      });
      return toolResult({
        ok: true,
        status: "connected",
        workspace,
        gitlab_status: gitlabStatus,
        project: projectResult,
        remote,
        git,
        joined,
        live_summary: {
          active_lock_count: state.locks.length,
          queue_counts: queueCounts(state.queue),
          handoff_count: state.handoffs.length,
          task_count: state.tasks.length
        },
        backend_status: backendStatusSnapshot({ includeCli: true }),
        evidence: evidence.evidence,
        next_tools: [
          "hermes_live_status",
          "hermes_lock_files",
          "hermes_run_gate",
          "hermes_gitlab_create_merge_request",
          "hermes_wait_for_events",
          "hermes_get_inbox"
        ]
      });
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
      includeProfiles: z.boolean().default(false),
      includeProviderStats: z.boolean().default(true),
      eventLimit: z.number().int().min(1).max(500).default(20)
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    try {
      const [state, events, agentState, presence, profiles, providerStats] = await Promise.all([
        manager.getStateSummary(),
        args?.includeEvents === false ? null : manager.listEvents({ status: "outbox", limit: args?.eventLimit || 20 }),
        args?.includeAgents === false ? null : anon.getState(),
        args?.includePresence === false ? null : listPresenceRecords({ includeStale: true }),
        args?.includeProfiles === true ? listAgentProfiles({ includePresence: false, limit: 100 }) : null,
        args?.includeProviderStats === false ? null : providerPerformance.stats({})
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
        agent_profiles: profiles?.profiles || [],
        provider_performance: providerStats?.providers || [],
        workspace: workspaceSnapshot()
      });
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_backend_status",
  {
    title: "Backend status",
    description: "Read a redacted backend/API readiness snapshot for AI providers, local endpoints, GitHub/GitLab CLIs, and the loaded env-file source.",
    inputSchema: {
      includeCli: z.boolean().default(true)
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    try { return toolResult(backendStatusSnapshot({ includeCli: args?.includeCli !== false })); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_winmerge_status",
  {
    title: "WinMerge status",
    description: "Detect the local WinMerge executable and return safe compare roots. Secret values and private paths are not returned.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  },
  async () => {
    try { return toolResult(await winMergeStatusSnapshot()); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_winmerge_compare",
  {
    title: "Launch WinMerge compare",
    description: "Open WinMerge for a safe visual compare between two existing workspace or approved-root paths. Use this for proof-backed review of copied experiment workspaces against baselines.",
    inputSchema: {
      owner: Owner.default("system"),
      leftPath: ComparePath,
      rightPath: ComparePath,
      ancestorPath: z.string().max(1000).default("")
        .describe("Optional existing base/ancestor path for three-way compare."),
      recursive: z.boolean().default(true)
        .describe("Pass /r for recursive folder compare."),
      readOnly: z.boolean().default(false)
        .describe("Open left and right as read-only with /wl /wr when true."),
      wait: z.boolean().default(false)
        .describe("Wait for WinMerge to close. Default false so agents are not blocked."),
      title: z.string().max(120).default("")
        .describe("Optional compare title used for left/right labels.")
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false }
  },
  async (args) => {
    try { return toolResult(await launchWinMergeCompare(args)); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_gitlab_status",
  {
    title: "GitLab status",
    description: "Check GitLab configuration and optional API authentication without returning token values or private env-file paths.",
    inputSchema: {
      probe: z.boolean().default(true),
      includeIdentity: z.boolean().default(false)
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true }
  },
  async (args) => {
    try {
      const client = createGitLabClient();
      return toolResult(await client.status({
        probe: args?.probe !== false,
        includeIdentity: args?.includeIdentity === true
      }));
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_gitlab_ensure_project",
  {
    title: "GitLab ensure project",
    description: "Idempotently find or create a GitLab project using env-provided credentials, then optionally add/update a local git remote.",
    inputSchema: {
      owner: Owner,
      namespacePath: GitLabNamespacePath,
      projectPath: GitLabProjectPath,
      name: z.string().default(""),
      visibility: GitLabVisibility,
      description: z.string().default(""),
      initializeWithReadme: z.boolean().default(false),
      addRemote: z.boolean().default(false),
      remoteName: z.string().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/).default("gitlab"),
      remoteProtocol: GitRemoteProtocol,
      updateExistingRemote: z.boolean().default(false),
      taskId: OptionalTaskId
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: true }
  },
  async (args) => {
    try {
      const client = createGitLabClient();
      if (!client.config.ok) {
        return toolResult({
          ok: false,
          status: "missing_token",
          message: missingGitLabTokenMessage(),
          backend_status: backendStatusSnapshot({ includeCli: true })
        });
      }
      const result = await client.ensureProject({
        namespacePath: args.namespacePath,
        projectPath: args.projectPath,
        name: args.name,
        visibility: args.visibility,
        description: args.description,
        initializeWithReadme: args.initializeWithReadme
      });
      if (!result.ok) return toolResult(result);
      const remote = args.addRemote
        ? configureGitRemote({
            project: result.project,
            remoteName: args.remoteName,
            protocol: args.remoteProtocol,
            updateExistingRemote: args.updateExistingRemote
          })
        : null;
      const evidence = await manager.appendEvidence({
        owner: args.owner,
        taskId: args.taskId || "",
        kind: "gitlab_project",
        summary: `GitLab project ${result.status}: ${result.project.path_with_namespace}`,
        data: {
          status: result.status,
          created: result.created,
          project: result.project,
          remote
        }
      });
      await manager.emitManualEvent({
        event_type: "gitlab.project.ready",
        owner: args.owner,
        task_id: args.taskId || null,
        files: [],
        summary: `GitLab project ${result.status}: ${result.project.path_with_namespace}`,
        next_actor: "unassigned",
        recommended_action: "acknowledge",
        payload: {
          project: result.project,
          created: result.created,
          remote
        }
      });
      return toolResult({ ...result, remote, evidence: evidence.evidence });
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_gitlab_list_merge_requests",
  {
    title: "GitLab list merge requests",
    description: "List GitLab merge requests for a project using env-provided credentials; returns MR metadata only, never tokens.",
    inputSchema: {
      projectFullPath: GitLabProjectFullPath,
      state: z.enum(["opened", "closed", "merged", "locked", "all"]).default("opened"),
      sourceBranch: z.string().default(""),
      targetBranch: z.string().default(""),
      search: z.string().default(""),
      limit: z.number().int().min(1).max(100).default(20)
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true }
  },
  async (args) => {
    try {
      const client = createGitLabClient();
      if (!client.config.ok) {
        return toolResult({ ok: false, status: "missing_token", message: missingGitLabTokenMessage() });
      }
      return toolResult(await client.listMergeRequests(args));
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_gitlab_create_merge_request",
  {
    title: "GitLab create merge request",
    description: "Idempotently create a GitLab merge request for a source branch, or return the existing open MR for the same source/target pair.",
    inputSchema: {
      owner: Owner,
      projectFullPath: GitLabProjectFullPath,
      sourceBranch: z.string().min(1).max(255),
      targetBranch: z.string().min(1).max(255).default("main"),
      title: z.string().min(1).max(255),
      description: z.string().default(""),
      draft: z.boolean().default(false),
      removeSourceBranch: z.boolean().default(false),
      labels: z.array(z.string()).default([]),
      taskId: OptionalTaskId
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: true }
  },
  async (args) => {
    try {
      const client = createGitLabClient();
      if (!client.config.ok) {
        return toolResult({ ok: false, status: "missing_token", message: missingGitLabTokenMessage() });
      }
      const result = await client.createMergeRequest(args);
      const evidence = await manager.appendEvidence({
        owner: args.owner,
        taskId: args.taskId || "",
        kind: "gitlab_merge_request",
        summary: `GitLab merge request ${result.status}: ${result.merge_request.web_url}`,
        data: {
          status: result.status,
          created: result.created,
          project_full_path: result.project_full_path,
          merge_request: result.merge_request
        }
      });
      await manager.emitManualEvent({
        event_type: "gitlab.merge_request.ready",
        owner: args.owner,
        task_id: args.taskId || null,
        files: [],
        summary: `GitLab merge request ${result.status}: ${result.merge_request.web_url}`,
        next_actor: "unassigned",
        recommended_action: "review_pr",
        payload: {
          project_full_path: result.project_full_path,
          merge_request: result.merge_request,
          created: result.created
        }
      });
      return toolResult({ ...result, evidence: evidence.evidence });
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_gitlab_ultimate_status",
  {
    title: "GitLab Ultimate status",
    description: "Inspect whether a GitLab project has the high-value Ultimate governance controls HermesProof can bootstrap: merge gates, branch protection, CODEOWNER approval, approval settings, and approval rules.",
    inputSchema: {
      projectFullPath: GitLabProjectFullPath,
      defaultBranch: z.string().min(1).max(255).default("main")
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true }
  },
  async (args) => {
    try {
      const client = createGitLabClient();
      if (!client.config.ok) {
        return toolResult({ ok: false, status: "missing_token", message: missingGitLabTokenMessage() });
      }
      return toolResult(await client.ultimateGovernanceStatus({
        projectFullPath: args.projectFullPath,
        defaultBranch: args.defaultBranch || "main"
      }));
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_gitlab_bootstrap_ultimate",
  {
    title: "GitLab Ultimate bootstrap",
    description: "Idempotently capture high-value GitLab Ultimate controls for one project: protected default branch, CODEOWNER approval, MR approval settings, merge-train/pipeline gates, CODEOWNERS, GitLab CI security/proof jobs, optional approval rule, and governance MR.",
    inputSchema: {
      owner: Owner,
      projectFullPath: GitLabProjectFullPath,
      defaultBranch: z.string().min(1).max(255).default("main"),
      governanceBranch: z.string().max(255).default(""),
      dryRun: z.boolean().default(false),
      bestEffort: z.boolean().default(true),
      codeOwnerRefs: z.array(GitLabOwnerRef).default(["@Ghenghis"]),
      approverUsernames: z.array(GitLabUsername).default([]),
      approverUserIds: z.array(z.number().int().positive()).default([]),
      approverGroupIds: z.array(z.number().int().positive()).default([]),
      approvalRuleName: z.string().min(1).max(1024).default("HermesProof release approval"),
      approvalsRequired: z.number().int().min(1).max(100).default(1),
      commitReleaseFiles: z.boolean().default(true),
      createGovernanceMergeRequest: z.boolean().default(true),
      mergeMethod: z.enum(["merge", "rebase_merge", "ff"]).default("rebase_merge"),
      taskId: OptionalTaskId
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: true }
  },
  async (args) => {
    try {
      const client = createGitLabClient();
      if (!client.config.ok) {
        return toolResult({
          ok: false,
          status: "missing_token",
          message: missingGitLabTokenMessage(),
          backend_status: backendStatusSnapshot({ includeCli: true })
        });
      }
      const result = await client.bootstrapUltimateGovernance({
        projectFullPath: args.projectFullPath,
        defaultBranch: args.defaultBranch || "main",
        governanceBranch: args.governanceBranch || "",
        dryRun: args.dryRun === true,
        bestEffort: args.bestEffort !== false,
        codeOwnerRefs: args.codeOwnerRefs || ["@Ghenghis"],
        approverUsernames: args.approverUsernames || [],
        approverUserIds: args.approverUserIds || [],
        approverGroupIds: args.approverGroupIds || [],
        approvalRuleName: args.approvalRuleName || "HermesProof release approval",
        approvalsRequired: args.approvalsRequired || 1,
        commitReleaseFiles: args.commitReleaseFiles !== false,
        createGovernanceMergeRequest: args.createGovernanceMergeRequest !== false,
        mergeMethod: args.mergeMethod || "rebase_merge"
      });
      if (args.dryRun !== true) {
        const evidence = await manager.appendEvidence({
          owner: args.owner,
          taskId: args.taskId || "",
          kind: "gitlab_ultimate_bootstrap",
          summary: `GitLab Ultimate bootstrap ${result.status}: ${args.projectFullPath}`,
          data: {
            status: result.status,
            ok: result.ok,
            project_full_path: result.project_full_path,
            default_branch: result.default_branch,
            governance_branch: result.governance_branch,
            steps: result.steps
          }
        });
        await manager.emitManualEvent({
          event_type: "gitlab.ultimate.ready",
          owner: args.owner,
          task_id: args.taskId || null,
          files: [],
          summary: `GitLab Ultimate bootstrap ${result.status}: ${args.projectFullPath}`,
          next_actor: "unassigned",
          recommended_action: result.ok ? "review_pr" : "acknowledge",
          payload: {
            project_full_path: args.projectFullPath,
            status: result.status,
            ok: result.ok,
            governance_branch: result.governance_branch
          }
        });
        return toolResult({ ...result, evidence: evidence.evidence });
      }
      return toolResult(result);
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_register_agent_profile",
  {
    title: "Register agent profile",
    description: "Persist a structured agent capability profile and optionally sync it into live presence for routing.",
    inputSchema: {
      owner: Owner,
      displayName: z.string().default(""),
      host: z.string().default(""),
      model: z.string().default(""),
      mode: AgentMode,
      role: z.string().default("agent"),
      skills: z.array(z.string()).default([]),
      taskTypes: z.array(z.string()).default([]),
      hostSupplies: z.array(z.string()).default([]),
      hermesproofSupplies: z.array(z.string()).default([]),
      workspaceRoots: z.array(z.string()).default([]),
      defaultWorkspaceRoot: z.string().default(""),
      mcpServer: z.record(z.any()).default({}),
      releaseGates: z.array(z.string()).default([]),
      gitRemotes: z.array(z.string()).default([]),
      notes: z.string().default(""),
      metadata: z.record(z.any()).default({}),
      updatePresence: z.boolean().default(true)
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    try { return toolResult(await registerAgentProfile(args)); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_get_agent_profile",
  {
    title: "Get agent profile",
    description: "Read one structured agent capability profile, optionally including the current presence record.",
    inputSchema: {
      owner: Owner,
      includePresence: z.boolean().default(true)
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    try {
      const profile = await readAgentProfile(args.owner);
      if (!profile) return toolResult({ ok: false, status: "missing", owner: args.owner });
      const presence = args?.includePresence === false ? null : await readJson(presencePath(args.owner), null);
      return toolResult({ ok: true, workspace_root: manager.workspaceRoot, profile, presence });
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_list_agent_profiles",
  {
    title: "List agent profiles",
    description: "List structured agent profiles, with optional filtering by skills, task type, host, mode, and live presence.",
    inputSchema: {
      requiredSkills: z.array(z.string()).default([]),
      taskType: z.string().default(""),
      host: z.string().default(""),
      mode: OptionalAgentMode,
      includePresence: z.boolean().default(true),
      limit: z.number().int().min(1).max(500).default(100)
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    try { return toolResult(await listAgentProfiles(args || {})); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_update_agent_capabilities",
  {
    title: "Update agent capabilities",
    description: "Merge or replace profile capability tags, host supplies, release gates, remotes, and mode for an existing agent profile.",
    inputSchema: {
      owner: Owner,
      skills: z.array(z.string()).default([]),
      taskTypes: z.array(z.string()).default([]),
      hostSupplies: z.array(z.string()).default([]),
      hermesproofSupplies: z.array(z.string()).default([]),
      releaseGates: z.array(z.string()).default([]),
      gitRemotes: z.array(z.string()).default([]),
      mode: OptionalAgentMode,
      notes: z.string().default(""),
      merge: z.boolean().default(true),
      updatePresence: z.boolean().default(true)
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    try { return toolResult(await updateAgentCapabilities(args)); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_join_project",
  {
    title: "Join project",
    description: "Register or refresh an agent profile, publish live presence, and return the durable inbox plus current coordination/backend snapshot for agents joining now or later.",
    inputSchema: {
      owner: Owner,
      displayName: z.string().default(""),
      host: z.string().default(""),
      model: z.string().default(""),
      mode: AgentMode,
      role: z.string().default("agent"),
      status: PresenceStatus,
      skills: z.array(z.string()).default([]),
      taskTypes: z.array(z.string()).default([]),
      hostSupplies: z.array(z.string()).default([]),
      hermesproofSupplies: z.array(z.string()).default([]),
      workspaceRoots: z.array(z.string()).default([]),
      notes: z.string().default(""),
      taskId: OptionalTaskId,
      files: z.array(z.string()).default([]),
      ttlSeconds: z.number().int().min(30).max(86_400).default(300),
      canInterrupt: z.boolean().default(true),
      includeInbox: z.boolean().default(true),
      includeEvents: z.boolean().default(true)
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    try {
      const registered = await registerAgentProfile({
        ...args,
        displayName: args.displayName,
        taskTypes: args.taskTypes,
        updatePresence: false
      });
      const presence = await updatePresenceRecord({
        owner: args.owner,
        role: args.role,
        status: args.status,
        taskId: args.taskId || "",
        files: args.files || [],
        skills: args.skills || [],
        taskTypes: args.taskTypes || [],
        note: args.notes || `Joined ${manager.workspaceRoot}`,
        ttlSeconds: args.ttlSeconds,
        canInterrupt: args.canInterrupt
      });
      const [state, inbox, events, profiles] = await Promise.all([
        manager.getStateSummary(),
        args.includeInbox === false ? null : readInbox({ owner: args.owner, includeAcked: false, limit: 50 }),
        args.includeEvents === false ? null : manager.listEvents({ status: "outbox", limit: 25 }),
        listAgentProfiles({ includePresence: true, limit: 100 })
      ]);
      return toolResult({
        ok: true,
        status: registered.status === "registered" ? "joined" : "refreshed",
        workspace_root: manager.workspaceRoot,
        profile: registered.profile,
        presence: presence.presence,
        inbox,
        agent_profiles: profiles.profiles,
        live_summary: {
          active_lock_count: state.locks.length,
          queue_counts: queueCounts(state.queue),
          handoff_count: state.handoffs.length,
          task_count: state.tasks.length,
          recent_outbox_events: events?.events || []
        },
        backend_status: backendStatusSnapshot({ includeCli: true }),
        next_tools: ["hermes_wait_for_inbox", "hermes_request_assistance", "hermes_live_status", "hermes_pick_task", "hermes_get_inbox"]
      });
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_set_test_mode",
  {
    title: "Set testing mode",
    description: "Enable or disable workspace testing mode. Testing mode makes bug-ticket intake explicit; release mode treats open blocker tickets as release risks.",
    inputSchema: {
      owner: Owner,
      mode: TestModeState,
      reason: z.string().default(""),
      releaseBlockingOpenTickets: z.boolean().default(true)
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    try {
      return toolResult(await setTestModeState({
        owner: args.owner,
        mode: args.mode,
        reason: args.reason || "",
        releaseBlockingOpenTickets: args.releaseBlockingOpenTickets !== false
      }));
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_get_test_mode",
  {
    title: "Get testing mode",
    description: "Read the active workspace testing/release mode flag and whether open tickets block release readiness.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  },
  async () => {
    try {
      return toolResult({ ok: true, workspace_root: manager.workspaceRoot, mode: await readTestMode() });
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_upsert_project_contract",
  {
    title: "Upsert project contract",
    description: "Create or update the shared workspace contract that tells all agents what proof, gates, protected paths, and forbidden claims apply before changes are called complete.",
    inputSchema: {
      owner: Owner,
      contractId: z.string().min(1).max(96).default("project-truth-contract"),
      title: z.string().default(""),
      project: z.string().default(""),
      scope: z.string().default(""),
      requiredGates: z.array(z.string()).default([]),
      requiredEvidence: z.array(z.string()).default([]),
      protectedPaths: z.array(z.string()).default([]),
      forbiddenClaimPatterns: z.array(z.string()).default([]),
      riskPatterns: z.array(z.object({
        id: z.string().default("custom-risk"),
        severity: ContractSeverity,
        regex: z.string().min(1),
        message: z.string().default("")
      })).default([]),
      maxFilesWithoutReview: z.number().int().min(1).max(5000).default(25),
      maxChangedLinesWithoutReview: z.number().int().min(1).max(100000).default(1200),
      autoTicketThreshold: AutoTicketThreshold,
      notes: z.string().default(""),
      merge: z.boolean().default(true)
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    try { return toolResult(await upsertProjectContract(args)); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_list_project_contracts",
  {
    title: "List project contracts",
    description: "List saved project contracts plus the default truth contract if none has been saved yet.",
    inputSchema: {
      includeDefault: z.boolean().default(true),
      limit: z.number().int().min(1).max(500).default(100)
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    try { return toolResult(await listProjectContracts(args || {})); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_read_project_contract",
  {
    title: "Read project contract",
    description: "Read one shared workspace contract by id. The default contract is returned even before it is saved.",
    inputSchema: {
      contractId: z.string().min(1).max(96).default("project-truth-contract")
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    try { return toolResult(await readProjectContract(args || {})); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_anti_slop_review",
  {
    title: "Anti-slop review",
    description: "Review pending changes, claims, gates, and evidence against shared project contracts. Emits a shared event and can auto-open a release-blocking ticket before low-proof or risky changes spread.",
    inputSchema: {
      owner: Owner,
      taskId: OptionalTaskId,
      summary: z.string().default(""),
      claims: z.array(z.string()).default([]),
      files: z.array(z.string()).default([]),
      gates: z.array(z.record(z.any())).default([]),
      evidence: z.array(z.record(z.any())).default([]),
      contractIds: z.array(z.string()).default([]),
      createTicket: z.boolean().default(true),
      autoTicketThreshold: AutoTicketThreshold,
      ticketAssignee: z.union([Owner, z.literal("")]).default(""),
      enqueueTicket: z.boolean().default(true),
      scanFileContent: z.boolean().default(true),
      maxFilesToScan: z.number().int().min(0).max(100).default(25),
      maxFileScanBytes: z.number().int().min(0).max(1_000_000).default(100000)
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false }
  },
  async (args) => {
    try { return toolResult(await antiSlopReview(args)); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_list_contract_reviews",
  {
    title: "List contract reviews",
    description: "List prior anti-slop and project-contract review records from the shared workspace state.",
    inputSchema: {
      status: z.enum(["all", "pass", "needs_review"]).default("all"),
      severity: z.union([ContractSeverity, z.literal("")]).default(""),
      limit: z.number().int().min(1).max(500).default(100)
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    try { return toolResult(await listContractReviews(args || {})); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_decompose_claims",
  {
    title: "Decompose claims",
    description: "Split an agent answer into structured factual claims with deterministic risk, confidence, and grounding flags before another agent trusts it.",
    inputSchema: {
      text: z.string().default(""),
      claims: z.array(z.union([z.string(), z.record(z.any())])).default([]),
      maxClaims: z.number().int().min(1).max(200).default(40)
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    try {
      const claims = decomposeClaims(args || {});
      return toolResult({ ok: true, workspace_root: manager.workspaceRoot, count: claims.length, claims });
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_audit_claims",
  {
    title: "Audit claims",
    description: "Agentic hallucination guard: decompose/audit claims against evidence, gates, and contracts, then write a correction packet, event, optional ticket, and provider outcome.",
    inputSchema: {
      owner: Owner,
      auditId: z.string().max(96).default(""),
      taskId: OptionalTaskId,
      text: z.string().default(""),
      claims: z.array(z.union([z.string(), z.record(z.any())])).default([]),
      files: z.array(z.string()).default([]),
      gates: z.array(z.record(z.any())).default([]),
      evidence: z.array(z.record(z.any())).default([]),
      contractIds: z.array(z.string()).default([]),
      latencyMode: ClaimLatencyMode,
      createTicket: z.boolean().default(true),
      autoTicketThreshold: AutoTicketThreshold,
      notifyAgents: z.boolean().default(true),
      generatorProvider: z.string().default(""),
      generatorModel: z.string().default(""),
      auditorProvider: z.string().default(""),
      auditorModel: z.string().default(""),
      maxClaims: z.number().int().min(1).max(200).default(40)
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false }
  },
  async (args) => {
    try { return toolResult(await auditClaims(args)); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_list_claim_audits",
  {
    title: "List claim audits",
    description: "List prior anti-hallucination claim audits and correction packets from the shared workspace state.",
    inputSchema: {
      status: z.enum(["all", "pass", "needs_correction"]).default("all"),
      severity: z.union([ContractSeverity, z.literal("")]).default(""),
      limit: z.number().int().min(1).max(500).default(100)
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    try { return toolResult(await listClaimAudits(args || {})); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_agentic_tick",
  {
    title: "Agentic loop tick",
    description: "Run one bounded agentic coordination tick: audit latest output, rank providers, inspect active agents, queue grounding/fix work, notify helpers, and emit durable next actions.",
    inputSchema: {
      owner: Owner,
      taskId: OptionalTaskId,
      mode: z.enum(["assist", "autopilot", "review"]).default("assist"),
      objective: z.string().default(""),
      latestOutput: z.string().default(""),
      claims: z.array(z.union([z.string(), z.record(z.any())])).default([]),
      files: z.array(z.string()).default([]),
      gates: z.array(z.record(z.any())).default([]),
      evidence: z.array(z.record(z.any())).default([]),
      providerCandidates: z.array(z.string()).default(["minimax", "deepinfra", "deepseek", "siliconflow", "lm-studio", "ollama"]),
      primaryProvider: z.string().default("minimax"),
      maxClaims: z.number().int().min(1).max(200).default(40),
      keepGoing: z.boolean().default(true),
      enqueueNext: z.boolean().default(true),
      notifyAgents: z.boolean().default(true),
      createTicket: z.boolean().default(true),
      noProgressCycles: z.number().int().min(0).max(1000).default(0),
      maxNoProgressCycles: z.number().int().min(1).max(100).default(3),
      progressSignals: z.array(z.string()).default([])
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false }
  },
  async (args) => {
    try { return toolResult(await agenticTick(args)); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_agent_watchdog",
  {
    title: "Agent watchdog",
    description: "Detect agents that are stale, idle too long, or holding old-heartbeat tasks; optionally poke them, recover stale locks/tasks, and enqueue resume work from a checkpoint.",
    inputSchema: {
      owner: Owner,
      targetOwners: z.array(Owner).default([]),
      idleSeconds: z.number().int().min(30).max(86_400).default(300),
      staleSeconds: z.number().int().min(30).max(86_400).default(180),
      taskHeartbeatSeconds: z.number().int().min(30).max(86_400).default(300),
      poke: z.boolean().default(true),
      recover: z.boolean().default(false),
      enqueueRecovery: z.boolean().default(false),
      includeBusy: z.boolean().default(true),
      note: z.string().default("")
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false }
  },
  async (args) => {
    try { return toolResult(await agentWatchdog(args)); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_report_bug",
  {
    title: "Report bug ticket",
    description: "Create a durable workspace bug ticket from agent findings, optionally enqueueing it as a repair task for another agent.",
    inputSchema: {
      reporter: Owner,
      ticketId: z.string().max(96).default(""),
      title: z.string().min(1).max(240),
      summary: z.string().default(""),
      severity: BugSeverity,
      files: z.array(z.string()).default([]),
      reproduction: z.string().default(""),
      expected: z.string().default(""),
      actual: z.string().default(""),
      evidence: z.array(z.record(z.any())).default([]),
      tags: z.array(z.string()).default([]),
      assignee: z.union([Owner, z.literal("")]).default(""),
      enqueue: z.boolean().default(true),
      priority: z.number().int().min(-1000).max(1000).default(0),
      targetOwnerPattern: z.string().min(1).max(256).default(".*"),
      taskId: OptionalTaskId
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    try { return toolResult(await reportBugTicket(args)); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_list_bug_tickets",
  {
    title: "List bug tickets",
    description: "List active or historical workspace bug tickets, with filters for status, severity, owner, and release blockers.",
    inputSchema: {
      status: z.union([BugTicketStatus, z.enum(["active", "all"])]).default("active"),
      severity: z.union([BugSeverity, z.literal("")]).default(""),
      assignee: z.union([Owner, z.literal("")]).default(""),
      reporter: z.union([Owner, z.literal("")]).default(""),
      releaseBlockersOnly: z.boolean().default(false),
      limit: z.number().int().min(1).max(500).default(100)
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    try { return toolResult(await listBugTickets(args || {})); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_update_bug_ticket",
  {
    title: "Update bug ticket",
    description: "Triages, assigns, reopens, closes, downgrades, or annotates a workspace bug ticket with evidence.",
    inputSchema: {
      owner: Owner,
      ticketId: z.string().min(1).max(96),
      status: z.union([BugTicketStatus, z.literal("")]).default(""),
      assignee: z.union([Owner, z.literal("")]).default(""),
      severity: z.union([BugSeverity, z.literal("")]).default(""),
      note: z.string().default(""),
      tags: z.array(z.string()).default([]),
      releaseBlocker: z.union([z.boolean(), z.null()]).default(null),
      evidence: z.array(z.record(z.any())).default([])
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    try { return toolResult(await updateBugTicket(args)); } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_submit_bug_fix",
  {
    title: "Submit bug fix",
    description: "Attach a patch/fix result to a bug ticket with branch, commit, MR URL, changed files, and gate evidence for review or closure.",
    inputSchema: {
      owner: Owner,
      ticketId: z.string().min(1).max(96),
      summary: z.string().default(""),
      branch: z.string().default(""),
      commit: z.string().default(""),
      mergeRequestUrl: z.string().default(""),
      gates: z.array(z.record(z.any())).default([]),
      files: z.array(z.string()).default([]),
      verdict: BugFixVerdict,
      closeTicket: z.boolean().default(false),
      evidence: z.array(z.record(z.any())).default([])
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false }
  },
  async (args) => {
    try { return toolResult(await submitBugFix(args)); } catch (err) { return toolError(err); }
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
    description: "Rank live agents by advertised skills, task affinity, interrupt preference, current lock load, and learned dispatch history.",
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
  "hermes_request_assistance",
  {
    title: "Request agent assistance",
    description: "Ask the active agent pool for help by skills/task type, send durable inbox requests to the best candidates, and emit an assistance.requested event.",
    inputSchema: {
      requester: Owner,
      requiredSkills: z.array(z.string()).default([]),
      taskType: z.string().default(""),
      subject: z.string().min(1).max(200),
      body: z.string().default(""),
      taskId: OptionalTaskId,
      files: z.array(z.string()).default([]),
      priority: MessagePriority,
      limit: z.number().int().min(1).max(25).default(5),
      includeBusy: z.boolean().default(false),
      targetOwners: z.array(Owner).default([]),
      allowSelf: z.boolean().default(false),
      responseDeadlineSeconds: z.number().int().min(30).max(86_400).default(300)
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false }
  },
  async (args) => {
    try {
      return toolResult(await requestAssistance({
        requester: args.requester,
        requiredSkills: args.requiredSkills || [],
        taskType: args.taskType || "",
        subject: args.subject,
        body: args.body || "",
        taskId: args.taskId || "",
        files: args.files || [],
        priority: args.priority || "normal",
        limit: args.limit || 5,
        includeBusy: args.includeBusy === true,
        targetOwners: args.targetOwners || [],
        allowSelf: args.allowSelf === true,
        responseDeadlineSeconds: args.responseDeadlineSeconds || 300
      }));
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_wait_for_assistance",
  {
    title: "Wait for assistance",
    description: "Long-poll assistance request acknowledgements until an agent accepts, all candidates decline, the response deadline expires, or the wait timeout elapses.",
    inputSchema: {
      requester: Owner,
      messageIds: z.array(LegacyPathId).min(1),
      responseDeadlineUtc: z.string().default(""),
      timeoutSeconds: z.number().int().min(30).max(86_400).default(300),
      timeoutMs: z.number().int().min(0).max(120_000).default(25_000),
      pollMs: z.number().int().min(100).max(5_000).default(500)
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    try {
      return toolResult(await waitForAssistance({
        requester: args.requester,
        messageIds: args.messageIds || [],
        responseDeadlineUtc: args.responseDeadlineUtc || "",
        timeoutSeconds: args.timeoutSeconds || 300,
        timeoutMs: args.timeoutMs || 25_000,
        pollMs: args.pollMs || 500
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
  "hermes_wait_for_inbox",
  {
    title: "Wait for inbox",
    description: "Long-poll one agent's durable inbox until a matching unread message exists or the timeout expires.",
    inputSchema: {
      owner: Owner,
      type: z.union([MessageType, z.literal("")]).default(""),
      includeAcked: z.boolean().default(false),
      timeoutMs: z.number().int().min(0).max(120_000).default(25_000),
      pollMs: z.number().int().min(100).max(5_000).default(500),
      limit: z.number().int().min(1).max(500).default(50)
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    try { return toolResult(await waitForInbox(args)); } catch (err) { return toolError(err); }
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
      note: z.string().default(""),
      notifySender: z.boolean().default(true),
      replyBody: z.string().default("")
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    try {
      return toolResult(await ackInboxMessage({
        owner: args.owner,
        messageId: args.messageId,
        status: args.status,
        note: args.note || "",
        notifySender: args.notifySender !== false,
        replyBody: args.replyBody || ""
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

const TaskSetHoldoutGuardInput = z.object({
  tags: z.array(z.string()).default([]),
  task_set_id: z.string().optional()
}).passthrough();

registerTool(
  "hermes_lock_files",
  {
    title: "Lock files atomically",
    description: "Atomically lock files before editing. If any file is locked by another owner, the whole request is rolled back; the caller should request a handoff instead. HP-MHA-006 denies every public MCP request for reserved holdout paths or holdout tags regardless of a caller-supplied role; omitting or changing a manifest cannot weaken server-derived isolation.",
    inputSchema: {
      owner: Owner,
      role: z.string().default("agent"),
      taskId: OptionalTaskId,
      files: Files,
      reason: z.string().default(""),
      ttlMinutes: z.number().int().min(5).max(720).default(90),
      task_set_manifest: TaskSetHoldoutGuardInput.optional()
    },
    annotations: { readOnlyHint: false, openWorldHint: false, idempotentHint: false }
  },
  async (args) => {
    try {
      const guard = assertLockFilesRespectHoldoutIsolation({
        files: args.files,
        role: args.role,
        task_set_manifest: args.task_set_manifest
      });
      if (!guard.ok) {
        return toolResult({
          ok: false,
          status: "blocked_hp_mha_006",
          reason_codes: guard.reason_codes,
          reason: guard.reason,
          blocked_files: guard.blocked_files || args.files,
          next_tool: "hermes_request_unlock"
        });
      }
    } catch (err) {
      return toolError(err);
    }
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
    description: "Atomically claim the highest-priority eligible task matching the owner pattern. HP-MHA holdout tasks require an explicit holdout-aware role and are rejected before the queue move.",
    inputSchema: {
      owner: Owner,
      role: z.string().min(1).max(80).optional(),
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

const ProviderId = z.string().min(2).max(80).regex(/^[A-Za-z0-9._-]+$/)
  .describe("Provider routing id, e.g. minimax, deepinfra, deepseek, siliconflow, lm-studio.");
const ProviderOutcome = z.enum(["verified", "completed", "partial", "needs_proof", "failed", "timeout", "rejected"]);
const KilocodeMode = z.enum(["normal", "authorized_reverse_engineering", "yolo"]);
const KilocodeDelegationTrigger = z.enum([
  "explicit",
  "missing_tool",
  "repeated_failure",
  "ssh",
  "vps",
  "browser",
  "docker",
  "install",
  "deploy",
  "long_running",
  "stuck",
  "openhands",
  "simple_edit",
  "read_only",
  "secret_required",
  "destructive",
  "unknown",
]);
const KilocodeRisk = z.enum(["low", "medium", "high", "critical"]);
const KilocodePermissionDecision = z.enum(["allow", "ask", "deny"]);
const KilocodeSecretScanStatus = z.enum(["passed", "failed", "not_checked"]);

registerTool(
  "hermes_provider_record_outcome",
  {
    title: "Record provider outcome",
    description: "Record a proof-backed model-provider outcome for a task type. This is separate from agent reputation and lets HermesProof learn whether MiniMax, DeepSeek, SiliconFlow, LM Studio, or another provider is best for live control, planning, review, vision, reverse engineering, or release gates.",
    inputSchema: {
      provider_id: ProviderId,
      model_name: z.string().max(160).default("")
        .describe("Optional model id. Stored for routing stats but never treated as a secret."),
      task_type: z.string().min(1).max(80).default("general")
        .describe("Task lane, e.g. aice_live_controller, pacman_timer_scan, reverse_static_analysis, critic_review."),
      outcome: ProviderOutcome
        .describe("verified/completed/partial/needs_proof/failed/timeout/rejected."),
      reward: z.number().min(-1).max(1).optional()
        .describe("Optional override learning signal from -1.0 to +1.0. Omit to use the default outcome reward."),
      latency_ms: z.number().int().nonnegative().optional()
        .describe("Optional observed latency for the provider call or job."),
      context: z.string().max(300).default("")
        .describe("Short redacted context. Do not include tokens or private file contents."),
      evidence: z.string().max(300).default("")
        .describe("Proof reference such as gate name, commit, ticket, or log path. Do not include secrets.")
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  },
  async (args) => {
    try {
      const result = await providerPerformance.recordOutcome(args);
      return toolResult(result);
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_provider_stats",
  {
    title: "Provider performance stats",
    description: "Read provider performance by provider and optional task_type. Shows success/failure rates, score, recommendation, and recent redacted events when requested.",
    inputSchema: {
      provider_id: ProviderId.optional(),
      task_type: z.string().min(1).max(80).optional(),
      include_history: z.boolean().default(false)
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    try {
      return toolResult(await providerPerformance.stats({
        provider_id: args?.provider_id || "",
        task_type: args?.task_type || "",
        include_history: args?.include_history === true
      }));
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_provider_rank",
  {
    title: "Rank providers for a task",
    description: "Rank configured or supplied providers for a specific task_type using the proof-backed provider ledger. Unknown providers keep a neutral baseline so new models can be tried without being unfairly blocked.",
    inputSchema: {
      task_type: z.string().min(1).max(80).default("general"),
      candidates: z.array(ProviderId).max(50).default([])
        .describe("Optional provider ids to rank. Empty means rank providers with recorded history."),
      min_score: z.number().min(0).max(5).default(0)
        .describe("Minimum score to include. Use 0 to see every candidate.")
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    try {
      return toolResult(await providerPerformance.rankProviders({
        task_type: args?.task_type || "general",
        candidates: args?.candidates || [],
        min_score: args?.min_score ?? 0
      }));
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_workspace_hygiene",
  {
    title: "Workspace release hygiene",
    description: "Read-only dirty-to-clean inspection. A hash-bound recovery manifest can permit focused recovery work but never a release claim; only a zero-dirty tree is clean. This tool never cleans, resets, stashes, deletes, stages, commits, or checks out files.",
    inputSchema: {
      expectedManifestPath: z.string().max(500).default(""),
      allowExpectedDirty: z.boolean().default(false).describe("Compatibility input only. Expected dirty work never becomes release-ready.")
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    try {
      return toolResult(await evaluateWorkspaceHygiene({
        workspaceRoot: manager?.workspaceRoot || runtime?.workspaceRoot || process.cwd(),
        stateDirName: runtime?.stateDirName || ".hermes3d_orchestrator",
        expectedManifestPath: args?.expectedManifestPath || "",
        allowExpectedDirty: args?.allowExpectedDirty === true
      }));
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_storage_census",
  {
    title: "Inventory build and temporary storage without cleanup",
    description: "Read-only bounded storage census for approved roots. It classifies proof, protected, dependency, temporary, quarantine, and unknown artifacts by metadata only. Unknown or partial results are blocked; this tool never deletes or moves data.",
    inputSchema: {
      roots: z.array(z.string().max(500)).max(16).default([]),
      maxFiles: z.number().int().min(1).max(100000).default(10000),
      maxDepth: z.number().int().min(0).max(32).default(8),
      groupDepth: z.number().int().min(1).max(8).default(1),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    const root = manager?.workspaceRoot || runtime?.workspaceRoot || process.cwd();
    const external = String(process.env.HERMESPROOF_STORAGE_ROOTS || "").split(path.delimiter).map((item) => item.trim()).filter(Boolean);
    const allowedRoots = [root, ...external];
    const roots = args?.roots?.length ? args.roots : [root];
    return toolResult(await evaluateStorageCensus({
      schema: "hermesproof.storage-census.v1",
      contractVersion: "hermesproof.storage-census.2026-07-10",
      allowedRoots,
      roots,
      maxFiles: args?.maxFiles,
      maxDepth: args?.maxDepth,
      groupDepth: args?.groupDepth,
    }));
  }
);

registerTool(
  "hermes_archive_plan",
  {
    title: "Create a hash-bound archive proposal without moving data",
    description: "Read-only archive planner for reviewed recovery artifacts. It verifies a v2 expected-diff manifest against current source hashes and proposes separate archive paths. It never copies, moves, deletes, or purges source data; a later human-approved operator must re-verify hashes before any move.",
    inputSchema: {
      sourceRoot: z.string().min(1).max(500),
      archiveRoot: z.string().min(1).max(500),
      archiveId: z.string().min(3).max(80),
      manifest: z.record(z.unknown()),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  },
  async (args) => {
    const root = manager?.workspaceRoot || runtime?.workspaceRoot || process.cwd();
    const external = String(process.env.HERMESPROOF_STORAGE_ROOTS || "").split(path.delimiter).map((item) => item.trim()).filter(Boolean);
    const archives = String(process.env.HERMESPROOF_ARCHIVE_ROOTS || "").split(path.delimiter).map((item) => item.trim()).filter(Boolean);
    return toolResult(await evaluateArchivePlan({
      schema: "hermesproof.archive-plan.v1",
      contractVersion: "hermesproof.archive-plan.2026-07-10",
      sourceRoot: args?.sourceRoot,
      archiveRoot: args?.archiveRoot,
      archiveId: args?.archiveId,
      manifest: args?.manifest,
      allowedSourceRoots: [root, ...external],
      allowedArchiveRoots: archives,
    }));
  }
);

registerTool(
  "hermes_kilocode_status",
  {
    title: "KiloCode/OpenHands integration status",
    description: "Return redacted readiness for KiloCode using OpenHands through HermesProof: provider registry, MiniMax/OpenHands env presence, Hermes Agent bridge state, and optional provider ranking.",
    inputSchema: {
      includeProviderRank: z.boolean().default(true),
      candidates: z.array(ProviderId).max(50).default(["minimax", "deepinfra", "deepseek", "siliconflow", "lm-studio", "ollama"]),
      task_type: z.string().min(1).max(80).default(KILOCODE_TASK_TYPE)
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  async (args) => {
    try {
      const providerRanking = args?.includeProviderRank === false
        ? null
        : await providerPerformance.rankProviders({
            task_type: args?.task_type || KILOCODE_TASK_TYPE,
            candidates: args?.candidates || ["minimax", "deepinfra", "deepseek", "siliconflow", "lm-studio", "ollama"],
            min_score: 0
          });
      const savedGuardrails = await readKilocodeGuardrails({
        workspaceRoot: manager?.workspaceRoot || runtime?.workspaceRoot || ""
      });
      return toolResult(kilocodeStatusSnapshot({
        workspaceRoot: manager?.workspaceRoot || runtime?.workspaceRoot || "",
        registryProviderCount: runtime?.registryProviderCount || 0,
        registryLoadOk: runtime?.registryLoadOk === true,
        bridgeEnabled: process.env.HERMES_AGENT_ENABLED === "1",
        bridgeReason: process.env.HERMES_AGENT_ENABLED === "1" ? "enabled_by_env" : "set HERMES_AGENT_ENABLED=1 to enable autonomous Hermes Agent bridge",
        providerRanking,
        guardrails: savedGuardrails.guardrails
      }));
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_kilocode_set_guardrails",
  {
    title: "Set KiloCode project guardrails",
    description: "Update workspace-local KiloCode guardrails for MVP-first work, visual proof, usable milestones, focus mode, and hyperfocus visual mode. Stores only booleans, intervals, and a redacted reason.",
    inputSchema: {
      owner: Owner.optional(),
      reason: z.string().max(300).default(""),
      reset: z.boolean().default(false),
      mvp_first: z.boolean().optional(),
      no_new_ideas_mode: z.boolean().optional(),
      force_mvp_gui_first: z.boolean().optional(),
      require_visual_proof: z.boolean().optional(),
      screenshot_on_checkpoint: z.boolean().optional(),
      block_until_usable: z.boolean().optional(),
      hyperfocus_visual_mode: z.boolean().optional(),
      focus_mode: z.boolean().optional(),
      visual_milestone_step_interval: z.number().int().min(1).max(100).optional(),
      visual_milestone_minutes: z.number().int().min(5).max(1440).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  },
  async (args) => {
    try {
      return toolResult(await setKilocodeGuardrails({
        workspaceRoot: manager?.workspaceRoot || runtime?.workspaceRoot || "",
        ...(args || {})
      }));
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_kilocode_policy_check",
  {
    title: "KiloCode/OpenHands delegation policy",
    description: "Evaluate whether KiloCode should continue locally, ask for approval, deny, or delegate to OpenHands for a tool/capability gap. The response is redacted and does not execute actions.",
    inputSchema: {
      trigger: KilocodeDelegationTrigger.default("unknown"),
      risk: KilocodeRisk.default("medium"),
      capabilities: z.array(z.string().min(1).max(80)).max(25).default([]),
      explicit: z.boolean().default(false),
      repeated_failures: z.number().int().nonnegative().max(20).default(0),
      action_summary: z.string().max(2000).default(""),
      scope_change: z.boolean().default(false),
      visual_proof_provided: z.boolean().default(false),
      current_milestone_usable: z.boolean().default(false),
      guardrails: KilocodeGuardrailsPatch.optional()
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  async (args) => {
    try {
      const savedGuardrails = await readKilocodeGuardrails({
        workspaceRoot: manager?.workspaceRoot || runtime?.workspaceRoot || ""
      });
      return toolResult(evaluateKilocodePolicy({
        ...(args || {}),
        guardrails: {
          ...savedGuardrails.guardrails,
          ...((args || {}).guardrails || {}),
        }
      }));
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_kilocode_checkpoint_progress",
  {
    title: "Checkpoint KiloCode progress",
    description: "Record a real KiloCode milestone checkpoint with optional visual proof paths, gate results, usable/complete status, guardrail effects, and hash-chained HermesProof evidence.",
    inputSchema: {
      owner: Owner,
      milestone_id: z.string().max(100).default(""),
      milestone_goal: z.string().max(300).default(""),
      status: KilocodeProgressStatus,
      summary: z.string().max(2000).default(""),
      visual_proof_paths: z.array(z.string().min(1).max(1000)).max(20).default([]),
      gates: z.array(z.object({
        gate: z.string().min(1).max(160),
        status: z.string().min(1).max(40),
        evidence: z.string().max(500).optional(),
      })).max(50).default([]),
      next_action: z.string().max(500).default(""),
      current_milestone_usable: z.boolean().default(false),
      guardrails: KilocodeGuardrailsPatch.optional()
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  },
  async (args) => {
    try {
      const savedGuardrails = await readKilocodeGuardrails({
        workspaceRoot: manager?.workspaceRoot || runtime?.workspaceRoot || ""
      });
      return toolResult(await recordKilocodeProgressCheckpoint({
        manager,
        workspaceRoot: manager?.workspaceRoot || runtime?.workspaceRoot || "",
        ...(args || {}),
        guardrails: {
          ...savedGuardrails.guardrails,
          ...((args || {}).guardrails || {}),
        }
      }));
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_kilocode_record_delegation",
  {
    title: "Record KiloCode/OpenHands delegation",
    description: "Record a redacted KiloCode OpenHands sidecar outcome in provider-performance stats and the HermesProof evidence ledger. Do not pass raw secrets or private file contents.",
    inputSchema: {
      owner: Owner,
      task_id: z.string().max(100).default(""),
      provider_id: ProviderId.default("minimax"),
      model_name: z.string().max(160).default(""),
      openhands_conversation_id: z.string().max(160).default(""),
      trigger: KilocodeDelegationTrigger.default("unknown"),
      risk: KilocodeRisk.default("medium"),
      outcome: ProviderOutcome,
      latency_ms: z.number().int().nonnegative().optional(),
      summary: z.string().max(2000).default(""),
      evidence: z.string().max(300).default(""),
      permission_decision: KilocodePermissionDecision.default("ask"),
      secret_scan: KilocodeSecretScanStatus.default("not_checked"),
      mode: KilocodeMode.default("normal"),
      uncensored: z.boolean().default(false),
      reverse_engineering_authorized: z.boolean().default(false)
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  },
  async (args) => {
    try {
      return toolResult(await recordKilocodeDelegation({
        manager,
        providerPerformance,
        ...args
      }));
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_kilocode_evaluate_agent_bus_event",
  {
    title: "Evaluate KiloCode agent-bus event",
    description: "Evaluate a CAO/OpenHands/Aider/Goose/OpenCode handoff, proof, cleanup, or completion envelope without writing evidence. Rejects mocked, fake, stubbed, skipped, hardcoded, UI-only, or completion-without-ev_* claims.",
    inputSchema: {
      envelope: KilocodeAgentBusEnvelope,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  async (args) => {
    try {
      return toolResult(evaluateKilocodeAgentBusEnvelope((args || {}).envelope || {}));
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_kilocode_evaluate_installed_vsix_release_proof",
  {
    title: "Evaluate KiloCode installed VSIX release proof",
    description: "Evaluate the versioned KiloCode strict installed-VSIX contract without writing evidence. Requires every Kilo preflight, state-gated vscode-extension-tester UI proof, installed VSIX hashes, gate snapshots, heartbeats, real sidecar evidence, and recursive anti-fake metadata checks.",
    inputSchema: {
      proof: KilocodeInstalledVsixReleaseProof,
      required_gate_count: z.number().int().min(1).max(21).default(10),
      required_gates: z.array(z.string().min(1).max(160)).max(21).default([]),
      max_heartbeat_age_ms: z.number().int().min(1000).max(900000).default(150000),
      max_runtime_ms: z.number().int().min(60000).max(7200000).default(1800000),
      now_ms: z.number().int().positive().optional()
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  async (args) => {
    try {
      return toolResult(evaluateKilocodeInstalledVsixReleaseProof((args || {}).proof || {}, args || {}));
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_kilocode_evaluate_roadmap_completion_proof",
  {
    title: "Evaluate KiloCode roadmap completion proof",
    description: "Evaluate roadmap/action-plan completion claims without writing evidence. Completed items require real HermesProof evidence ids, runner attestation, hashed artifacts, and updated truth docs; fake, stubbed, simulated, skipped, or prose-only completion is rejected.",
    inputSchema: {
      proof: KilocodeRoadmapCompletionProof,
      required_docs: z.array(z.string().min(1).max(1000)).max(200).default([]),
      require_all_complete: z.boolean().default(false)
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  async (args) => {
    try {
      return toolResult(evaluateKilocodeRoadmapCompletionProof((args || {}).proof || {}, args || {}));
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_kilocode_record_agent_bus_event",
  {
    title: "Record KiloCode agent-bus event",
    description: "Record a redacted KiloCode/CAO/OpenHands/Aider/Goose/OpenCode agent-bus event into HermesProof. Completed tasks must reference valid ev_* evidence; fake or UI-only proof is rejected and not appended.",
    inputSchema: {
      owner: Owner,
      task_id: z.string().max(160).default("")
        .describe("Optional override task id. Defaults to envelope.task_id."),
      envelope: KilocodeAgentBusEnvelope,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  },
  async (args) => {
    try {
      return toolResult(await recordKilocodeAgentBusEvent({
        manager,
        ...(args || {})
      }));
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_kilocode_record_infrastructure_proof",
  {
    title: "Record KiloCode Cloudflare/VPS proof",
    description: "Record redacted Cloudflare edge and VPS origin proof for KiloCode release/deploy gates. Rejects mocked, fake, stubbed, skipped, hardcoded, or UI-only pass claims.",
    inputSchema: {
      owner: Owner,
      task_id: z.string().max(100).default(""),
      resource: KilocodeInfrastructureResource,
      target: z.string().max(160).default(""),
      summary: z.string().max(2000).default(""),
      checks: z.array(KilocodeInfrastructureCheck).min(1).max(100),
      proof_paths: z.array(z.string().min(1).max(1000)).max(20).default([]),
      next_action: z.string().max(500).default("")
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  },
  async (args) => {
    try {
      return toolResult(await recordKilocodeInfrastructureProof({
        manager,
        workspaceRoot: manager?.workspaceRoot || runtime?.workspaceRoot || "",
        ...(args || {})
      }));
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_kilocode_evaluate_infrastructure_proof",
  {
    title: "Evaluate KiloCode Cloudflare/VPS proof",
    description: "Evaluate Cloudflare edge and VPS origin checks without writing evidence. Use this before release/deploy claims to see missing, weak, warning, or fake proof.",
    inputSchema: {
      resource: KilocodeInfrastructureResource,
      checks: z.array(KilocodeInfrastructureCheck).min(1).max(100)
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  async (args) => {
    try {
      return toolResult(evaluateKilocodeInfrastructureProof(args || {}));
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
  "hermes_staleness_evaluate",
  {
    title: "Evaluate code, proof, document, and runner staleness",
    description: "Read-only staleness evaluation for current commit/VSIX/contract lineage. Rejects expired records, future clocks, superseded current claims, stale hashes, fake metadata, secret signals, missing evidence, and mixed-run artifacts.",
    inputSchema: {
      report: z.record(z.unknown()),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  async ({ report }) => toolResult(evaluateStaleness(report))
);

registerTool(
  "hermes_helper_runtime_evaluate",
  {
    title: "Evaluate one HermesAgent or ZeroClaw worker result",
    description: "Read-only evaluation of a redacted local or VPS helper worker envelope. Requires worker identity, run/commit/VSIX lineage, terminal runner result, artifact hashes, and real HermesProof evidence before a completed result can be accepted.",
    inputSchema: {
      envelope: z.record(z.unknown()),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  async ({ envelope }) => toolResult(evaluateHelperRuntimeEnvelope(envelope))
);

registerTool(
  "hermes_helper_runtime_evaluate_consensus",
  {
    title: "Evaluate local and VPS helper evidence consensus",
    description: "Read-only evaluation of required local/VPS helper results. Both sides must use the same run id, commit, VSIX hash, and return independently identified real evidence. A mismatch blocks the gate.",
    inputSchema: {
      required_locations: z.array(z.enum(["local", "vps"])).min(1),
      envelopes: z.array(z.record(z.unknown())).min(1),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  async ({ required_locations, envelopes }) => toolResult(evaluateHelperRuntimeConsensus({ requiredLocations: required_locations, runs: envelopes }))
);

registerTool(
  "hermes_agent_health",
  {
    title: "Hermes Agent bridge health probe",
    description: "Probes the configured HermesAgent providers in deterministic order. Default: MiniMax M3, then DeepSeek. Bridge is disabled by default (set HERMES_AGENT_ENABLED=1).",
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

// ---------------------------------------------------------------------------
// HP-MHA: HermesProof Model-Harness Attribution protocol
// ---------------------------------------------------------------------------
// Implements the HP-MHA-001..010 contract requirements from
// docs/48-Point Lever.md. Each tool emits an immutable ev_* entry into the
// HP-MHA ledger; the final promotion_evaluate verdict is the canonical
// machine-readable result for HP-HARNESS-ATTRIBUTION.

const HarnessCardInput = z.object({
  card_id: z.string().min(1),
  layers: z.object({}).passthrough()
}).passthrough();

const ExperimentPlanInput = z.object({
  experiment_id: z.string().min(1),
  design: z.enum(["locked_harness", "factorial_2x2", "factorial_NxN"]).default("factorial_2x2"),
  locked_harness_sha256: z.string().optional(),
  held_constant: z.object({}).passthrough().default({}),
  model_manifest: z.object({}).passthrough(),
  harness_card: z.object({}).passthrough(),
  task_set_manifest: z.object({}).passthrough(),
  evaluator_manifest: z.object({}).passthrough(),
  environment_manifest: z.object({}).passthrough()
}).passthrough();

const BenchmarkRunInput = z.object({
  run_id: z.string().min(1),
  experiment_id: z.string().min(1),
  model_manifest_sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  harness_manifest_sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  task_set_manifest_sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  evaluator_manifest_sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  environment_manifest_sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  trace_root_sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  outcome: z.enum(["passed", "failed", "cancelled", "crashed", "timed_out"]),
  latency_ms: z.number().int().nonnegative().optional(),
  tokens: z.number().int().nonnegative().optional(),
  cost_usd: z.number().nonnegative().optional()
}).passthrough();

const TraceBundleInput = z.object({
  bundle_id: z.string().min(1),
  retention: z.enum(["release_pinned", "failure_diagnostic", "routine_run", "duplicate_chunk"]),
  chunks: z.array(z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/i) }).passthrough()).min(1),
  root_sha256: z.string().regex(/^[a-f0-9]{64}$/i)
}).passthrough();

const AttributionInput = z.object({
  experiment_id: z.string().min(1),
  matrix: z.object({
    s11: z.number(),
    s12: z.number(),
    s21: z.number(),
    s22: z.number()
  }).strict(),
  uncertainty: z.object({}).passthrough().optional()
}).passthrough();

const PromotionDecisionInput = z.object({
  kind: z.string().min(1),
  evidence_ids: z.array(z.string().regex(/^ev_[a-z0-9]{8,}$/i)).min(1),
  run_attestations: z.array(z.object({}).passthrough()),
  plan: z.object({}).passthrough(),
  attribution: z.object({
    harness_effect_pp: z.number(),
    model_effect_pp: z.number(),
    interaction_pp: z.number()
  }).passthrough(),
  contested: z.object({}).passthrough().optional(),
  execution_real: z.boolean().optional()
}).passthrough();

const SubGateInput = z.object({
  harness_card: z.object({}).passthrough(),
  experiment_plan: z.object({}).passthrough(),
  run_attestations: z.array(z.object({}).passthrough()),
  matrix: AttributionInput.shape.matrix,
  holdout_visible_to_optimizer: z.boolean().default(false),
  execution_real: z.boolean().default(false),
  fake_signals: z.array(z.any()).default([]),
  evidence_ids: z.array(z.string().regex(/^ev_[a-z0-9]{8,}$/i)).default([])
}).passthrough();

function hpMhaContext() {
  return {
    workspaceRoot: manager?.workspaceRoot || runtime?.workspaceRoot || process.cwd(),
    stateDirName: configuredStateDirName
  };
}

registerTool(
  "hermes_hp_mha_harness_card_record",
  {
    title: "HP-MHA record a harness card",
    description: "Canonicalize and hash a complete harness configuration across the seven HP-MHA layers (execution, model, tools, context, scheduling, observability, governance). Emits ev_harness_*.",
    inputSchema: HarnessCardInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  async (args) => {
    try {
      const ctx = hpMhaContext();
      return toolResult(await recordHarnessCard({ ...ctx, harness_card: args }));
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_hp_mha_experiment_plan_lock",
  {
    title: "HP-MHA lock an experiment plan",
    description: "Lock the task set, model cells, harness cells, budgets and evaluator before execution. Enforces HP-MHA-002 (model comparison design) and HP-MHA-003 (held-constant harness claim). Emits ev_experiment_*.",
    inputSchema: ExperimentPlanInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  async (args) => {
    try {
      const ctx = hpMhaContext();
      return toolResult(await lockExperimentPlan({ ...ctx, plan: args }));
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_hp_mha_benchmark_run_attest",
  {
    title: "HP-MHA attest a benchmark run",
    description: "Bind each completed run to the locked plan and its artifacts. Implements HP-MHA-001 binding, HP-MHA-004 contamination classification, and HP-MHA-005 denominator accounting. Emits ev_run_*.",
    inputSchema: BenchmarkRunInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  async (args) => {
    try {
      const ctx = hpMhaContext();
      return toolResult(await attestBenchmarkRun({ ...ctx, run: args }));
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_hp_mha_trace_bundle_verify",
  {
    title: "HP-MHA verify a trace bundle",
    description: "Verify trace chunk hashes, recompute Merkle root, classify retention. Emits ev_trace_*.",
    inputSchema: TraceBundleInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  async (args) => {
    try {
      const ctx = hpMhaContext();
      return toolResult(await verifyAndRecordTraceBundle({ ...ctx, bundle: args }));
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_hp_mha_model_harness_attribution",
  {
    title: "HP-MHA compute model/harness attribution",
    description: "Calculate harness effect, model effect, and model-by-harness interaction from a 2x2 factorial. Implements HP-MHA-007 multi-dimensional reporting. Emits ev_attribution_*.",
    inputSchema: AttributionInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  async (args) => {
    try {
      const ctx = hpMhaContext();
      return toolResult(await recordAttribution({
        ...ctx,
        experiment_id: args.experiment_id,
        matrix: args.matrix,
        uncertainty: args.uncertainty
      }));
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_hp_mha_promotion_evaluate",
  {
    title: "HP-MHA evaluate promotion verdict",
    description: "Return PASS, FAIL, or INCONCLUSIVE under the HP-MHA contract (HP-MHA-001..010). Emits ev_promotion_* with chained ev_* evidence references.",
    inputSchema: PromotionDecisionInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  async (args) => {
    try {
      const ctx = hpMhaContext();
      return toolResult(await evaluateAndRecordPromotion({ ...ctx, decision: args }));
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_hp_mha_sub_gate",
  {
    title: `HP-MHA evaluate ${HP_HARNESS_ATTRIBUTION_GATE} sub-gate`,
    description: "Run the full HP-MHA contract against a complete input bundle and return the machine-readable verdict used by the HP-HARNESS-ATTRIBUTION release sub-gate. Read-only with respect to the candidate harness (HP-MHA-009).",
    inputSchema: SubGateInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  async (args) => {
    try {
      return toolResult({
        schema: "hermesproof.hp_mha.sub_gate.v1",
        contract_version: HP_MHA_CONTRACT_VERSION,
        gate: HP_HARNESS_ATTRIBUTION_GATE,
        ...evaluateHpMhaSubGate({
          harness_card: args.harness_card,
          experiment_plan: args.experiment_plan,
          run_attestations: args.run_attestations,
          matrix: args.matrix,
          holdout_visible_to_optimizer: args.holdout_visible_to_optimizer,
          execution_real: args.execution_real,
          fake_signals: args.fake_signals,
          evidence_ids: args.evidence_ids
        })
      });
    } catch (err) { return toolError(err); }
  }
);

const TraceMetricsInput = z.object({
  bundle: z.object({}).passthrough(),
  required_signals: z.array(z.string()).default([]),
  lookback: z.number().int().min(1).max(1000).default(5)
}).passthrough();

const TracePruneOptionsInput = z.object({
  routine_retention_ms: z.number().int().nonnegative().optional(),
  failures_required: z.boolean().default(false),
  now_ms: z.number().int().nonnegative().optional()
}).passthrough();

registerTool(
  "hermes_hp_mha_trace_metrics",
  {
    title: "HP-MHA compute trace-level metrics",
    description: "Derives recovery rate (at 1/3/5/10 steps), average control lag, and context-retention ratio from a trace bundle whose chunks carry `kind` and (optionally) `signals`. Implements HP-MHA spec §6.",
    inputSchema: TraceMetricsInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  async (args) => {
    try {
      return toolResult({
        schema: "hermesproof.hp_mha.trace_metrics.v1",
        contract_version: HP_MHA_CONTRACT_VERSION,
        ...computeTraceMetrics({
          bundle: args.bundle,
          required_signals: args.required_signals,
          lookback: args.lookback
        })
      });
    } catch (err) { return toolError(err); }
  }
);

const ExperimentReportInput = z.object({
  experiment_id: z.string().min(1),
  harness_card_id: z.string().optional()
}).passthrough();

registerTool(
  "hermes_hp_mha_experiment_report",
  {
    title: "HP-MHA compile a per-experiment evidence report",
    description: "Reads the HP-MHA evidence ledger and aggregates every ev_* entry that shares the given experiment_id (and optionally a harness_card_id) into a structured report. Returns match_count, breakdown by kind, denominator summary, last attribution triple and last promotion verdict. Read-only; mutates nothing.",
    inputSchema: ExperimentReportInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  async (args) => {
    try {
      const ctx = hpMhaContext();
      return toolResult(await readExperimentReport({
        ...ctx,
        experiment_id: args.experiment_id,
        harness_card_id: args.harness_card_id
      }));
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_hp_mha_trace_prune",
  {
    title: "HP-MHA prune HP-MHA ledger by retention class",
    description: "Walks the HP-MHA evidence ledger and classifies each entry by retention. release_pinned entries are always kept; failure_diagnostic entries require explicit failures_required=true; routine_run entries older than `routine_retention_ms` (default 7 days) are pruned; duplicate_chunk entries with the same root hash collapse. Appends an `ev_prune` summary without breaking the hash chain.",
    inputSchema: TracePruneOptionsInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  async (args) => {
    try {
      const ctx = hpMhaContext();
      return toolResult(await pruneAndRecordRetention({ ...ctx, options: args }));
    } catch (err) { return toolError(err); }
  }
);

const TraceIndexInput = TraceBundleInput;

const TraceSearchInput = z.object({
  bundle_id: z.string().min(1),
  byte_start: z.number().int().nonnegative().optional(),
  byte_end: z.number().int().nonnegative().optional(),
  kind: z.string().optional(),
  signals: z.array(z.string()).default([]),
  limit: z.number().int().min(1).max(10000).default(200)
}).passthrough();

registerTool(
  "hermes_hp_mha_trace_index_record",
  {
    title: "HP-MHA ingest a trace bundle into the searchable index",
    description: "Reads a trace bundle (same shape as `hermes_hp_mha_trace_bundle_verify`) and writes one content-addressed index row per chunk to <workspace>/.hermes3d_orchestrator/evidence/hp_mha_trace_index.ndjson. Range queries over millions of tokens never re-scan the ledger; the index is sorted by (bundle_id, byte_start).",
    inputSchema: TraceIndexInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  async (args) => {
    try {
      const ctx = hpMhaContext();
      const result = await writeTraceIndex({ ...ctx, bundle: args });
      const verified = await verifyAndRecordTraceBundle({ ...ctx, bundle: args });
      return toolResult({ ...result, merkle_ok: verified.verification_ok, evidence_id: verified.evidence_id, prev_entry_id: verified.prev_entry_id });
    } catch (err) { return toolError(err); }
  }
);

registerTool(
  "hermes_hp_mha_trace_search",
  {
    title: "HP-MHA range-search the trace index",
    description: "Returns index rows whose byte window intersects [byte_start, byte_end] (open-ended if omitted), optionally filtered by `kind` and `signals`. Read-only; never touches the ledger. For the millions-of-tokens case this is the only path that does not require scanning `hp_mha.ndjson`.",
    inputSchema: TraceSearchInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  async (args) => {
    try {
      const ctx = hpMhaContext();
      const rows = await readTraceIndex({ ...ctx, bundle_id: args.bundle_id });
      const matches = searchTraceIndex(rows, {
        byte_start: args.byte_start,
        byte_end: args.byte_end,
        kind: args.kind,
        signals: args.signals,
        limit: args.limit
      });
      return toolResult({
        schema: "hermesproof.hp_mha.trace_search.v2",
        contract_version: HP_MHA_CONTRACT_VERSION,
        bundle_id: args.bundle_id,
        requested_window: { byte_start: args.byte_start ?? null, byte_end: args.byte_end ?? null },
        filters: { kind: args.kind || null, signals: args.signals || [] },
        match_count: matches.length,
        matches
      });
    } catch (err) { return toolError(err); }
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
