import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_PRIVATE_ROOT = "G:\\private";

const KILOCODE_TASK_TYPE = "kilocode_openhands_delegation";
const KILOCODE_INFRASTRUCTURE_TASK_TYPE = "kilocode_infrastructure_proof";
const KILOCODE_AGENT_BUS_TASK_TYPE = "kilocode_agent_bus_event";
const KILOCODE_INSTALLED_VSIX_TASK_TYPE = "kilocode_installed_vsix_release_proof";
const KILOCODE_ROADMAP_TASK_TYPE = "kilocode_roadmap_completion_proof";
const VALID_MODES = new Set(["normal", "authorized_reverse_engineering", "yolo"]);
const KILOCODE_GUARDRAILS_FILE = "kilocode_guardrails.json";
const KILOCODE_PROGRESS_FILE = "kilocode_progress.json";
const KILOCODE_INSTALLED_VSIX_SCHEMA = "kilocode.installed_vsix.release.v1";
const KILOCODE_ROADMAP_SCHEMA = "kilocode.roadmap_completion.v1";
const KILOCODE_E2E_CONTRACT_VERSION = "kilocode.e2e-proof-contract.2026-07-10";
const VALID_AGENT_BUS_SCHEMAS = new Set(["kilo.agent.bus.v1", "hermesproof.kilo.agent.bus.v1"]);
const REQUIRED_INSTALLED_VSIX_GATES = Object.freeze([
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
  "gate11-aider-repair",
  "gate12-goose-session",
  "gate13-openhands-session",
  "gate14-release-channel",
  "gate15-recovered-tabs-baseline",
  "gate16-phase7-replay-features",
  "gate17-conductor",
  "gate18-experiment-ledger",
  "gate19-lane-score",
  "gate20-private-update-hardening",
  "gate21-evolve-lane",
]);
const INSTALLED_VSIX_GATE_ALIASES = Object.freeze({
  "gate11-aider": "gate11-aider-repair",
  "gate12-goose": "gate12-goose-session",
  "gate13-openhands": "gate13-openhands-session",
  "gate15-recovered-tabs": "gate15-recovered-tabs-baseline",
  "gate16-phase-7": "gate16-phase7-replay-features",
  "gate16-phase7": "gate16-phase7-replay-features",
  "gate19-lane-bandit": "gate19-lane-score",
  "gate21-kilo-evolve": "gate21-evolve-lane",
});
const ROADMAP_REQUIRED_DOCS = Object.freeze([
  "ROADMAP.md",
  "ACTION_PLAN.md",
  "HANDOFF.md",
  "docs/current-e2e-recovery-contract-2026-07-10.md",
  "docs/real-e2e-proof-governance.md",
  "ci/e2e-gate-proof-policy.json",
]);
const KILOCODE_REQUIRED_PREFLIGHTS = Object.freeze([
  "dirty-workspace",
  "visible-ui-driver",
  "settings-ui-driver",
  "settings-webview",
  "speech-tab",
  "speech-playback",
  "lanes-tab",
  "settings-nav-loop",
  "migration-dismissal",
  "chat-focus",
  "chat-task",
  "chat-routing-surface",
  "sidecar-route",
  "sidecar-runner",
  "sidecar-transport",
  "hermesproof",
  "artifact-audit",
  "gates-11-21-plan",
  "roadmap-proof",
]);
const VALID_AGENT_BUS_EVENT_TYPES = new Set([
  "task.requested",
  "task.claimed",
  "task.started",
  "handoff.sent",
  "message.sent",
  "proof.attached",
  "task.completed",
  "task.failed",
  "worker.cleanup",
  "status.updated",
]);
const VALID_AGENT_BUS_SUBSTRATES = new Set([
  "kilo",
  "cao",
  "agent_orchestrator",
  "openhands",
  "aider",
  "goose",
  "opencode",
  "gitlab",
  "vps",
  "cloudflare",
  "unknown",
]);
const COMPLETION_AGENT_BUS_EVENTS = new Set(["task.completed"]);
const PROOF_AGENT_BUS_EVENTS = new Set(["proof.attached", "task.completed"]);
const VALID_INFRASTRUCTURE_RESOURCES = new Set([
  "cloudflare_edge",
  "vps_origin",
  "gitlab_runner",
  "edge_and_origin",
  "delivery_pipeline",
]);
const INFRASTRUCTURE_PASS_STATUSES = new Set(["pass", "passed", "ok", "ready", "enabled", "protected", "blocked"]);
const INFRASTRUCTURE_WARN_STATUSES = new Set(["warn", "warning", "partial", "limited", "permission_denied", "already_configured"]);
const INFRASTRUCTURE_FAIL_STATUSES = new Set(["fail", "failed", "error", "missing", "unreachable", "disabled", "skipped"]);
const REQUIRED_INFRASTRUCTURE_CHECKS = Object.freeze({
  cloudflare_edge: [
    "cloudflare.waf_rules_enabled",
    "cloudflare.secret_probe_blocked",
    "cloudflare.scanner_ua_blocked",
  ],
  vps_origin: [
    "vps.ssh_health",
    "vps.origin_guard_installed",
    "vps.homepage_ok",
    "vps.secret_probe_blocked",
    "vps.resource_headroom",
  ],
  gitlab_runner: [
    "gitlab.runner_registered",
    "gitlab.runner_self_hosted",
    "gitlab.runner_executor_ready",
    "gitlab.pipeline_smoke_passed",
    "gitlab.runner_secret_scope_checked",
  ],
});

const DEFAULT_KILOCODE_GUARDRAILS = Object.freeze({
  mvp_first: true,
  no_new_ideas_mode: false,
  force_mvp_gui_first: true,
  require_visual_proof: true,
  screenshot_on_checkpoint: true,
  block_until_usable: true,
  hyperfocus_visual_mode: false,
  focus_mode: false,
  visual_milestone_step_interval: 3,
  visual_milestone_minutes: 45,
});

const KILOCODE_PERMISSION_NAMES = Object.freeze([
  "openhands_delegate",
  "openhands_workspace_write",
  "openhands_external_network",
  "openhands_browser",
  "openhands_docker",
  "openhands_install",
  "openhands_ssh",
  "openhands_deploy",
  "openhands_destructive",
  "openhands_secret_access",
]);

const VALID_TRIGGERS = new Set([
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

const VALID_RISKS = new Set(["low", "medium", "high", "critical"]);
const VALID_PROGRESS_STATUS = new Set(["planned", "working", "blocked", "usable", "verified", "complete"]);
const ASK_TRIGGERS = new Set(["ssh", "vps", "install", "deploy", "destructive"]);
const DELEGATE_TRIGGERS = new Set([
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
]);
const LOCAL_ONLY_TRIGGERS = new Set(["simple_edit", "read_only"]);

const SECRET_SIGNAL = /(?:\b(?:authorization|api[-_]?key|token|password|passwd|private[-_]?token|secret)\s*[:=]|\bbearer\s+[a-z0-9._~+/-]{12,}|github_pat_|ghp_|glpat-|hf_|sk-(?:cp-)?[a-z0-9_-]{12,})/i;

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function truncateText(value, max = 800) {
  const text = String(value || "").trim();
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

function configuredPrivateRoot(options = {}) {
  return String(options.privateRoot || process.env.HERMESPROOF_PRIVATE_ROOT || DEFAULT_PRIVATE_ROOT).trim();
}

function redactString(value, options = {}) {
  const max = Number.isFinite(Number(options.max)) ? Number(options.max) : 800;
  const privateRoot = configuredPrivateRoot(options);
  let text = String(value ?? "");

  text = text.replace(
    /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,
    "[REDACTED_PRIVATE_KEY]"
  );
  text = text.replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, "$1[REDACTED]");
  text = text.replace(
    /\b(sk-(?:cp-)?[A-Za-z0-9_-]{12,}|github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|hf_[A-Za-z0-9]{20,})\b/g,
    "[REDACTED_TOKEN]"
  );
  text = text.replace(
    /\b(authorization|api[-_]?key|token|secret|password|passwd|private[-_]?token)\s*[:=]\s*([^\s,;'"`<>]+)/gi,
    "$1=[REDACTED]"
  );
  text = text.replace(
    /\b([A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE_TOKEN))\s*[:=]\s*([^\s,;'"`<>]+)/g,
    "$1=[REDACTED]"
  );
  text = text.replace(/(https?:\/\/)([^/\s:@]+):([^/\s@]+)@/gi, "$1[REDACTED]@");
  text = text.replace(/\b[A-Za-z]:[\\/]+private(?:[\\/][^\s'"`<>]*)?/gi, "[PRIVATE_ROOT]");

  if (privateRoot) {
    const variants = new Set([
      privateRoot,
      privateRoot.replace(/\\/g, "/"),
      privateRoot.replace(/\//g, "\\"),
    ]);
    for (const variant of variants) {
      if (!variant) continue;
      const pattern = new RegExp(`${escapeRegExp(variant)}(?:[\\\\/][^\\s'"\\\`<>]*)?`, "gi");
      text = text.replace(pattern, "[PRIVATE_ROOT]");
    }
  }

  return truncateText(text, max);
}

function redactValue(value, options = {}) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value == null) {
    return typeof value === "string" ? redactString(value, options) : value;
  }
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, options));
  if (typeof value === "object") {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      const safeKey = redactString(key, { ...options, max: 120 });
      if (/^(api[-_]?key|authorization|token|secret|password|passwd|private[-_]?token)$/i.test(key)) {
        out[safeKey] = "[REDACTED]";
      } else {
        out[safeKey] = redactValue(entry, options);
      }
    }
    return out;
  }
  return redactString(String(value), options);
}

function redactIntegrationText(value, options = {}) {
  return redactValue(value, options);
}

function normalizeInfrastructureResource(value) {
  const cleaned = String(value || "edge_and_origin").trim().toLowerCase().replace(/[^a-z0-9_:-]+/g, "_");
  return VALID_INFRASTRUCTURE_RESOURCES.has(cleaned) ? cleaned : "edge_and_origin";
}

function normalizeInfrastructureStatus(value) {
  const cleaned = String(value || "fail").trim().toLowerCase().replace(/[^a-z0-9_:-]+/g, "_");
  if (INFRASTRUCTURE_PASS_STATUSES.has(cleaned)) return "pass";
  if (INFRASTRUCTURE_WARN_STATUSES.has(cleaned)) return "warn";
  if (INFRASTRUCTURE_FAIL_STATUSES.has(cleaned)) return "fail";
  return "fail";
}

function infrastructureRequiredChecks(resource) {
  if (resource === "edge_and_origin" || resource === "delivery_pipeline") {
    return [
      ...REQUIRED_INFRASTRUCTURE_CHECKS.cloudflare_edge,
      ...REQUIRED_INFRASTRUCTURE_CHECKS.vps_origin,
      ...(resource === "delivery_pipeline" ? REQUIRED_INFRASTRUCTURE_CHECKS.gitlab_runner : []),
    ];
  }
  return REQUIRED_INFRASTRUCTURE_CHECKS[resource] || [];
}

function normalizeInfrastructureCheck(check = {}) {
  const id = String(check.id || check.gate || check.name || "").trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "_").slice(0, 120);
  const status = normalizeInfrastructureStatus(check.status || check.result || check.verdict);
  const evidenceId = String(check.evidence_id || check.evidenceId || "").trim();
  const out = {
    id,
    status,
    evidence: redactString(check.evidence || check.summary || "", { max: 500 }),
    http_status: Number.isFinite(Number(check.http_status ?? check.httpStatus)) ? Number(check.http_status ?? check.httpStatus) : null,
    exit_code: Number.isFinite(Number(check.exit_code ?? check.exitCode)) ? Number(check.exit_code ?? check.exitCode) : null,
    latency_ms: Number.isFinite(Number(check.latency_ms ?? check.latencyMs)) ? Number(check.latency_ms ?? check.latencyMs) : null,
    rule_count: Number.isFinite(Number(check.rule_count ?? check.ruleCount)) ? Number(check.rule_count ?? check.ruleCount) : null,
    command: redactString(check.command || "", { max: 240 }),
    observed_utc: redactString(check.observed_utc || check.observedUtc || "", { max: 80 }),
    evidence_id: /^ev_[A-Za-z0-9_-]{8,}$/.test(evidenceId) ? evidenceId : "",
    secret_values_returned: false,
  };
  return out;
}

function infrastructureCheckHasConcreteSignal(check) {
  return Boolean(
    check.evidence_id ||
      check.observed_utc ||
      check.command ||
      check.http_status !== null ||
      check.exit_code !== null ||
      check.latency_ms !== null ||
      check.rule_count !== null
  );
}

function infrastructureCheckIsFake(check = {}) {
  const status = String(check.status || check.result || check.verdict || "").toLowerCase();
  return Boolean(
    check.mock === true ||
      check.mocked === true ||
      check.fake === true ||
      check.stub === true ||
      check.stubbed === true ||
      check.uiOnly === true ||
      check.ui_only === true ||
      check.hardcodedSuccess === true ||
      check.hardcoded_success === true ||
      check.skipped === true ||
      check.skip === true ||
      /mock|fake|stub|skip/.test(status)
  );
}

function normalizeAgentBusEventType(value) {
  const cleaned = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s:-]+/g, ".")
    .replace(/[^a-z0-9.]+/g, "")
    .replace(/\.+/g, ".")
    .replace(/^\.+|\.+$/g, "");
  return VALID_AGENT_BUS_EVENT_TYPES.has(cleaned) ? cleaned : "unknown";
}

function normalizeAgentBusSubstrate(value) {
  const cleaned = String(value || "unknown")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return VALID_AGENT_BUS_SUBSTRATES.has(cleaned) ? cleaned : "unknown";
}

function validEvidenceId(value) {
  return /^ev_[A-Za-z0-9_-]{8,}$/.test(String(value || "").trim());
}

function normalizeAgentBusProofRefs(envelope = {}) {
  const refs = [];
  const direct = envelope.evidence_id || envelope.evidenceId;
  if (direct) refs.push(String(direct).trim());
  const candidates = []
    .concat(Array.isArray(envelope.evidence_ids) ? envelope.evidence_ids : [])
    .concat(Array.isArray(envelope.evidenceIds) ? envelope.evidenceIds : [])
    .concat(Array.isArray(envelope.proof_refs) ? envelope.proof_refs : [])
    .concat(Array.isArray(envelope.proofRefs) ? envelope.proofRefs : []);
  for (const entry of candidates) {
    if (typeof entry === "string") refs.push(entry.trim());
    else if (entry && typeof entry === "object") refs.push(String(entry.evidence_id || entry.evidenceId || entry.id || "").trim());
  }
  return [...new Set(refs.filter(validEvidenceId))].slice(0, 20);
}

function normalizeAgentBusArtifacts(artifacts = []) {
  return (Array.isArray(artifacts) ? artifacts : [])
    .slice(0, 50)
    .map((artifact) => {
      if (typeof artifact === "string") return { path: redactString(artifact, { max: 300 }) };
      const hash = artifact?.sha256 || artifact?.hash || artifact?.artifact_hash || artifact?.artifactHash || "";
      return {
        kind: redactString(artifact?.kind || artifact?.type || "", { max: 80 }),
        path: redactString(artifact?.path || artifact?.file || "", { max: 300 }),
        sha256: redactString(hash, { max: 120 }),
        exists: typeof artifact?.exists === "boolean" ? artifact.exists : null,
        bytes: Number.isFinite(Number(artifact?.bytes ?? artifact?.size)) ? Number(artifact?.bytes ?? artifact?.size) : null,
      };
    });
}

function normalizeAgentBusChecks(checks = []) {
  return (Array.isArray(checks) ? checks : [])
    .slice(0, 100)
    .map((check) => ({
      id: redactString(check?.id || check?.gate || check?.name || "", { max: 120 }),
      status: redactString(check?.status || check?.result || "", { max: 40 }),
      evidence: redactString(check?.evidence || check?.summary || "", { max: 300 }),
      evidence_id: validEvidenceId(check?.evidence_id || check?.evidenceId) ? String(check.evidence_id || check.evidenceId).trim() : "",
      exit_code: Number.isFinite(Number(check?.exit_code ?? check?.exitCode)) ? Number(check.exit_code ?? check.exitCode) : null,
      http_status: Number.isFinite(Number(check?.http_status ?? check?.httpStatus)) ? Number(check.http_status ?? check.httpStatus) : null,
      latency_ms: Number.isFinite(Number(check?.latency_ms ?? check?.latencyMs)) ? Number(check.latency_ms ?? check.latencyMs) : null,
    }))
    .filter((check) => check.id);
}

function agentBusArtifactHasConcreteSignal(artifact = {}) {
  return Boolean(
    artifact.sha256 ||
      artifact.exists === true ||
      artifact.bytes !== null ||
      (artifact.path && artifact.kind)
  );
}

function agentBusCheckHasConcreteSignal(check = {}) {
  return Boolean(
    check.evidence_id ||
      check.exit_code !== null ||
      check.http_status !== null ||
      check.latency_ms !== null ||
      check.evidence
  );
}

function agentBusEventIsFake(envelope = {}) {
  return Boolean(
    envelope.mock === true ||
      envelope.mocked === true ||
      envelope.fake === true ||
      envelope.stub === true ||
      envelope.stubbed === true ||
      envelope.uiOnly === true ||
      envelope.ui_only === true ||
      envelope.hardcodedSuccess === true ||
      envelope.hardcoded_success === true ||
      envelope.skipped === true ||
      envelope.skip === true ||
      (Array.isArray(envelope.checks) && envelope.checks.some(infrastructureCheckIsFake))
  );
}

function evaluateKilocodeAgentBusEnvelope(envelope = {}) {
  const schema = String(envelope.schema || "").trim();
  const eventType = normalizeAgentBusEventType(envelope.event_type || envelope.eventType || envelope.type);
  const substrate = normalizeAgentBusSubstrate(envelope.substrate || envelope.source || envelope.orchestrator);
  const taskId = redactString(envelope.task_id || envelope.taskId || "", { max: 120 });
  const workerId = redactString(envelope.worker_id || envelope.workerId || envelope.agent_id || envelope.agentId || "", { max: 160 });
  const sessionId = redactString(envelope.session_id || envelope.sessionId || "", { max: 160 });
  const lane = redactString(envelope.lane || "", { max: 80 });
  const summary = redactString(envelope.summary || envelope.message || "", { max: 600 });
  const proofRefs = normalizeAgentBusProofRefs(envelope);
  const artifacts = normalizeAgentBusArtifacts(envelope.artifacts || envelope.proof_artifacts || envelope.proofArtifacts || []);
  const checks = normalizeAgentBusChecks(envelope.checks || envelope.gates || []);
  const missing = [];
  const requiredActions = [];
  const fakeFindings = [];

  if (!VALID_AGENT_BUS_SCHEMAS.has(schema)) missing.push("schema");
  if (eventType === "unknown") missing.push("event_type");
  if (!taskId) missing.push("task_id");
  if (agentBusEventIsFake(envelope)) {
    fakeFindings.push({
      reason: "mock_fake_stub_skipped_hardcoded_or_ui_only_event_claimed",
      event_type: eventType,
      substrate,
    });
  }

  const hasEvidenceRef = proofRefs.length > 0;
  const hasConcreteArtifact = artifacts.some(agentBusArtifactHasConcreteSignal);
  const hasConcreteCheck = checks.some(agentBusCheckHasConcreteSignal);
  const hasConcreteCommand =
    Boolean(envelope.command || envelope.command_summary || envelope.commandSummary) &&
    Number.isFinite(Number(envelope.exit_code ?? envelope.exitCode));
  const hasConcreteProof = hasEvidenceRef || hasConcreteArtifact || hasConcreteCheck || hasConcreteCommand;

  if (COMPLETION_AGENT_BUS_EVENTS.has(eventType) && !hasEvidenceRef) {
    missing.push("completion_evidence_id");
    requiredActions.push("Attach a valid ev_* evidence id before recording task.completed.");
  }
  if (PROOF_AGENT_BUS_EVENTS.has(eventType) && !hasConcreteProof) {
    missing.push("concrete_proof");
    requiredActions.push("Attach an ev_* id, artifact hash/path, command exit code, HTTP status, or test gate proof.");
  }
  if (fakeFindings.length) {
    requiredActions.push("Remove mocked, fake, stubbed, skipped, hardcoded, or UI-only agent-bus proof.");
  }
  if (!VALID_AGENT_BUS_SCHEMAS.has(schema)) requiredActions.push("Use schema kilo.agent.bus.v1.");
  if (eventType === "unknown") requiredActions.push("Use a known event type such as task.claimed, handoff.sent, proof.attached, task.completed, or worker.cleanup.");
  if (!taskId) requiredActions.push("Provide a stable task_id for the handoff/completion envelope.");

  const ok = missing.length === 0 && fakeFindings.length === 0;
  const status = ok
    ? "accepted"
    : fakeFindings.length
      ? "rejected_fake_or_stubbed_event"
      : COMPLETION_AGENT_BUS_EVENTS.has(eventType) && missing.includes("completion_evidence_id")
        ? "rejected_completion_without_evidence"
        : PROOF_AGENT_BUS_EVENTS.has(eventType) && missing.includes("concrete_proof")
          ? "rejected_weak_proof_event"
          : "rejected_invalid_envelope";

  return {
    ok,
    status,
    secret_values_returned: false,
    task_type: KILOCODE_AGENT_BUS_TASK_TYPE,
    schema,
    event_type: eventType,
    substrate,
    task_id: taskId,
    worker_id: workerId,
    session_id: sessionId,
    lane,
    summary,
    proof_refs: proofRefs,
    artifacts,
    checks,
    has_concrete_proof: hasConcreteProof,
    missing,
    fake_findings: fakeFindings,
    required_actions: requiredActions,
  };
}

function validSha256(value) {
  return /^[A-Fa-f0-9]{64}$/.test(String(value || "").trim());
}

function arrayFrom(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return value.split(/\r?\n/).filter(Boolean);
  return [];
}

function parseInstant(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}

function normalizeInstalledGateName(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^[0-9]+-/, "");
  if (INSTALLED_VSIX_GATE_ALIASES[raw]) return INSTALLED_VSIX_GATE_ALIASES[raw];
  if (REQUIRED_INSTALLED_VSIX_GATES.includes(raw)) return raw;
  const byPrefix = REQUIRED_INSTALLED_VSIX_GATES.find((gate) => raw === gate.replace(/^gate([0-9]+)-/, "gate$1-"));
  return byPrefix || raw;
}

function installedGateEntries(gates = {}) {
  if (Array.isArray(gates)) {
    return gates.map((gate) => ({
      name: normalizeInstalledGateName(gate?.name || gate?.gate || gate?.id || ""),
      gate,
    })).filter((entry) => entry.name);
  }
  if (gates && typeof gates === "object") {
    return Object.entries(gates).map(([name, gate]) => ({
      name: normalizeInstalledGateName(name),
      gate,
    })).filter((entry) => entry.name && entry.name !== "__readiness");
  }
  return [];
}

function parseInstalledHeartbeat(input) {
  return arrayFrom(input).map((line) => {
    const match = /^\s*([0-9]{4}-[0-9]{2}-[0-9]{2}T[^\s]+)\s+(.+?)\s*$/.exec(String(line || ""));
    return match ? { ts: match[1], ms: parseInstant(match[1]), stage: match[2] } : null;
  }).filter(Boolean);
}

function hasInstalledEvidenceId(value) {
  if (!value || typeof value !== "object") return false;
  const direct = value.evidence_id || value.evidenceId || value.hermesProofEventId || value.proofId || value.proof_id;
  if (validEvidenceId(direct)) return true;
  return Object.values(value).some((entry) => {
    if (Array.isArray(entry)) return entry.some(hasInstalledEvidenceId);
    if (entry && typeof entry === "object") return hasInstalledEvidenceId(entry);
    return false;
  });
}

function sidecarSmokeAccepted(smoke = {}) {
  if (!smoke || typeof smoke !== "object") return false;
  const calls = Array.isArray(smoke.toolCalls) ? smoke.toolCalls : [];
  return Boolean(
    smoke.ok === true &&
      smoke.expectedToolMatched === true &&
      calls.some((call) => call && call.statusOk === true) &&
      hasInstalledEvidenceId(smoke)
  );
}

function visibleCaptureAccepted(capture = {}) {
  if (!capture || typeof capture !== "object") return false;
  return Boolean(capture.ok === true && (capture.sha256 || Number(capture.size) > 0 || capture.path));
}

function visibleForegroundAccepted(proof = {}) {
  return Boolean(proof.foregroundBelongsToVsCode === true || proof.after?.foregroundBelongsToTarget === true);
}

function settingsVisibleProofAccepted(gate = {}) {
  if (!gate || typeof gate !== "object") return false;
  const proof = gate.visibleWindowProof || gate.visible_window_proof || {};
  const web = gate.visibleSettingsWebviewProof || gate.visible_settings_webview_proof || {};
  if (!proof || typeof proof !== "object") return false;
  const opened = Boolean(
    proof.settingsOpenCommandOk === true ||
      proof.settingsCommandChangedWindow === true ||
      proof.settingsCommandApiFallbackOk === true
  );
  const webview = Boolean(
    web &&
      typeof web === "object" &&
      web.ok === true &&
      web.settingsRootPresent === true &&
      Array.isArray(web.missingStableTabs) &&
      web.missingStableTabs.length === 0 &&
      Array.isArray(web.missingRequiredTabs) &&
      web.missingRequiredTabs.length === 0 &&
      web.forbiddenTabsLeaked !== true
  );
  return Boolean(
    proof.ok === true &&
      opened &&
      webview &&
      proof.settingsPanelVisible === true &&
      proof.screenshotHashChanged === true &&
      visibleForegroundAccepted(proof) &&
      visibleCaptureAccepted(proof.before) &&
      visibleCaptureAccepted(proof.after)
  );
}

function chatVisibleProofAccepted(gate = {}) {
  if (!gate || typeof gate !== "object") return false;
  const proof = gate.visibleWindowProof || gate.visible_window_proof || {};
  if (!proof || typeof proof !== "object") return false;
  return Boolean(
      proof.ok === true &&
      (gate.kiloActivityBarClicked === true || proof.activityBarClicked === true) &&
      proof.closeEditorsCommandSent === true &&
      proof.closeAfterMigrationCommandSent === true &&
      proof.activityBarClickRecorded === true &&
      proof.migrationDismissalProofOk === true &&
      Number(proof.loadWaitMs || 0) >= 20000 &&
      proof.focusCommandSent === true &&
      proof.notificationsDismissedCommandSent === true &&
      proof.newTaskCommandSent === true &&
      proof.markerTabActive !== true &&
      proof.webviewChatSmokeCommandSent === true &&
      proof.webviewChatSmokeAccepted === true &&
      proof.webviewChatSmoke?.ok === true &&
      proof.screenshotHashChanged === true &&
      visibleForegroundAccepted(proof) &&
      visibleCaptureAccepted(proof.before) &&
      visibleCaptureAccepted(proof.after)
  );
}

function installedPreflightMap(value) {
  if (!value || typeof value !== "object") return null;
  if (!Array.isArray(value)) return value;
  return Object.fromEntries(
    value
      .filter((entry) => entry && typeof entry === "object" && typeof entry.key === "string")
      .map((entry) => [entry.key, entry])
  );
}

function installedPreflightAccepted(value) {
  return Boolean(value?.preflight_ok === true || value?.preflightOk === true || value?.ok === true);
}

function installedFakePaths(value, prefix = "$") {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => installedFakePaths(entry, `${prefix}[${index}]`));
  }
  return Object.entries(value).flatMap(([key, entry]) => {
    const here = `${prefix}.${key}`;
    const found = ["mock", "mocked", "fake", "stub", "stubbed", "simulated", "skip", "skipped", "uiOnly", "ui_only"].includes(key) && entry === true
      ? [here]
      : [];
    if (!entry || typeof entry !== "object") return found;
    return [...found, ...installedFakePaths(entry, here)];
  });
}

function installedPassedStages(value) {
  const stages = Array.isArray(value?.stages) ? value.stages : [];
  return new Set(stages.filter((stage) => stage?.status === "passed").map((stage) => stage.name));
}

function installedHashedCaptures(value) {
  const screenshots = Array.isArray(value?.screenshots) ? value.screenshots : [];
  return screenshots.filter((shot) => shot && typeof shot === "object" && (shot.path || shot.file) && validSha256(shot.sha256));
}

function visibleUiDriverAccepted(value = {}) {
  const driver = value.uiDriver || value.ui_driver;
  const name = typeof driver === "string" ? driver : driver?.name;
  const hash = value.vsixSha256 || value.vsix_sha256 || value.vsix?.sha256;
  const stages = installedPassedStages(value);
  const required = ["activityBar", "view", "webview", "prompt", "backendReady", "focus"];
  return name === "vscode-extension-tester" && validSha256(hash) && required.every((stage) => stages.has(stage)) && installedHashedCaptures(value).length >= 2;
}

function settingsUiDriverAccepted(value = {}) {
  const driver = value.uiDriver || value.ui_driver;
  const name = typeof driver === "string" ? driver : driver?.name;
  const hash = value.vsixSha256 || value.vsix_sha256 || value.vsix?.sha256;
  const stages = installedPassedStages(value);
  const required = ["activityBar", "view", "settingsAction", "settingsEditor", "settingsFrame", "settingsRoot"];
  const visits = Array.isArray(value.settings?.visits) ? value.settings.visits : [];
  return Boolean(
    name === "vscode-extension-tester" &&
      validSha256(hash) &&
      ["settings-navigation", "speech-health", "lanes-policy"].includes(value.scenario) &&
      required.every((stage) => stages.has(stage)) &&
      installedHashedCaptures(value).length >= 2 &&
      (visits.length > 0 || value.speech?.healthOk === true || value.lanes?.persisted === true)
  );
}

function chatUiDriverAccepted(value = {}) {
  if (!visibleUiDriverAccepted(value)) return false;
  const stages = installedPassedStages(value);
  const required = ["sendButton", "submit", "message", "routing"];
  return Boolean(
    value.scenario === "sidebar-submit" &&
      required.every((stage) => stages.has(stage)) &&
      value.submission?.clicked === true &&
      value.message?.optimisticUserRow === true &&
      value.message?.promptCleared === true &&
      value.routing?.worker === "kilo" &&
      value.routing?.source === "backend" &&
      ["starting", "running"].includes(value.routing?.phase) &&
      value.routing?.voiceIndependent === true
  );
}

function evaluateKilocodeInstalledVsixReleaseProof(proof = {}, options = {}) {
  const schema = String(proof.schema || proof.proof_schema || proof.proofSchema || "").trim();
  const contract = String(proof.contractVersion || proof.contract_version || "").trim();
  const requiredGateCount = Number.isFinite(Number(options.required_gate_count))
    ? Math.max(1, Math.round(Number(options.required_gate_count)))
    : 10;
  const requiredGates = Array.isArray(options.required_gates) && options.required_gates.length
    ? options.required_gates.map(normalizeInstalledGateName)
    : REQUIRED_INSTALLED_VSIX_GATES.slice(0, Math.min(requiredGateCount, REQUIRED_INSTALLED_VSIX_GATES.length));
  const maxHeartbeatAgeMs = Number.isFinite(Number(options.max_heartbeat_age_ms))
    ? Math.max(1000, Math.round(Number(options.max_heartbeat_age_ms)))
    : 150000;
  const maxRuntimeMs = Number.isFinite(Number(options.max_runtime_ms))
    ? Math.max(maxHeartbeatAgeMs, Math.round(Number(options.max_runtime_ms)))
    : 30 * 60 * 1000;
  const nowMs = Number.isFinite(Number(options.now_ms)) ? Number(options.now_ms) : Date.now();
  const missing = [];
  const findings = [];
  const requiredActions = [];

  if (schema !== KILOCODE_INSTALLED_VSIX_SCHEMA) {
    missing.push("schema");
    requiredActions.push(`Use schema ${KILOCODE_INSTALLED_VSIX_SCHEMA}.`);
  }

  if (contract !== KILOCODE_E2E_CONTRACT_VERSION) {
    missing.push("contract_version");
    findings.push({
      severity: "critical",
      code: "installed_vsix.contract_version_mismatch",
      message: `Installed VSIX proof contract is '${contract || "missing"}', expected '${KILOCODE_E2E_CONTRACT_VERSION}'.`,
    });
    requiredActions.push(`Emit contractVersion ${KILOCODE_E2E_CONTRACT_VERSION} from the KiloCode release runner.`);
  }

  const vsixSha256 = String(proof.vsixSha256 || proof.vsix_sha256 || proof.vsix_hash || "").trim();
  if (!validSha256(vsixSha256)) {
    missing.push("vsix_sha256");
    requiredActions.push("Bind the proof to the exact installed VSIX SHA-256 hash.");
  }

  if (proof.resultFileExists === false || /exited before writing a result file/i.test(String(proof.error?.message || ""))) {
    findings.push({
      severity: "critical",
      code: "installed_vsix.result_file_missing",
      message: "VS Code extension test exited before writing the installed smoke result file.",
    });
    requiredActions.push("Keep the VS Code test host open until the real result JSON is written.");
  }

  const startedMs = parseInstant(proof.startedAt || proof.started_at || proof.windowOpenedAt || proof.window_opened_at);
  const finishedMs = parseInstant(proof.finishedAt || proof.finished_at || proof.windowClosedAt || proof.window_closed_at);
  if (startedMs && finishedMs && finishedMs < startedMs) {
    findings.push({
      severity: "critical",
      code: "installed_vsix.timestamps_non_monotonic",
      message: "Installed VSIX proof timestamps are non-monotonic.",
    });
  }
  if (startedMs && finishedMs && finishedMs - startedMs > maxRuntimeMs) {
    findings.push({
      severity: "high",
      code: "installed_vsix.runtime_exceeded",
      message: `Installed VSIX proof runtime exceeded ${maxRuntimeMs}ms.`,
    });
  }

  const entries = installedGateEntries(proof.gates || proof.gateResults || proof.gate_results || {});
  const gateMap = new Map(entries.map((entry) => [entry.name, entry.gate]));
  const missingGates = requiredGates.filter((gate) => !gateMap.has(gate));
  if (entries.length < requiredGateCount || missingGates.length) {
    missing.push("required_gates");
    findings.push({
      severity: "critical",
      code: "installed_vsix.required_gates_missing",
      message: "Installed VSIX proof does not contain every required gate result.",
      evidence: { expected: requiredGates, present: entries.map((entry) => entry.name), missing: missingGates },
    });
    requiredActions.push("Run the installed VSIX proof until gates 1-10 all write result snapshots.");
  }

  const failedGates = entries
    .filter((entry) => entry.gate && typeof entry.gate === "object" && entry.gate.ok === false)
    .map((entry) => entry.name);
  if (failedGates.length) {
    findings.push({
      severity: "critical",
      code: "installed_vsix.gates_failed",
      message: "One or more installed VSIX gates reported failure.",
      evidence: { failed: failedGates },
    });
  }

  const snapshotGaps = requiredGates.filter((gate) => {
    const entry = gateMap.get(gate);
    if (!entry || typeof entry !== "object") return true;
    return !entry.snapshotPath && !entry.snapshot_path && !entry.gateArtifactsDir && !entry.gate_artifacts_dir;
  });
  if (snapshotGaps.length) {
    findings.push({
      severity: "critical",
      code: "installed_vsix.snapshots_missing",
      message: "Required gates are missing snapshot/artifact references.",
      evidence: { missing_snapshots: snapshotGaps },
    });
    requiredActions.push("Write per-gate snapshots/artifact paths before a gate can be accepted.");
  }

  const heartbeat = parseInstalledHeartbeat(proof.heartbeat || proof.heartbeats || proof.heartbeatLines || proof.heartbeat_lines || []);
  const badHeartbeat = heartbeat.some((entry) => entry.ms === null);
  const nonMonotonicHeartbeat = heartbeat.some((entry, idx) => idx > 0 && entry.ms !== null && heartbeat[idx - 1].ms !== null && entry.ms < heartbeat[idx - 1].ms);
  if (!heartbeat.length) {
    findings.push({
      severity: "critical",
      code: "installed_vsix.heartbeat_missing",
      message: "Installed VSIX proof has no VS Code window/gate heartbeat ledger.",
    });
    requiredActions.push("Attach the heartbeat ledger with pre-gate, still-gate, and post-gate timestamps.");
  } else {
    const last = heartbeat.filter((entry) => entry.ms !== null).at(-1);
    if (badHeartbeat || nonMonotonicHeartbeat) {
      findings.push({
        severity: "critical",
        code: "installed_vsix.heartbeat_invalid",
        message: "Installed VSIX heartbeat timestamps are invalid or non-monotonic.",
      });
    }
    if (last && !finishedMs && nowMs - last.ms > maxHeartbeatAgeMs) {
      findings.push({
        severity: "critical",
        code: "installed_vsix.heartbeat_stale",
        message: `Installed VSIX heartbeat is stale by ${nowMs - last.ms}ms.`,
      });
      requiredActions.push("Do not close or claim the VS Code smoke while a gate heartbeat is stale.");
    }
    for (const gate of requiredGates) {
      const pre = heartbeat.some((entry) => entry.stage === `pre-gate-${gate}`);
      const post = heartbeat.some((entry) => entry.stage === `post-gate-${gate}`);
      if (pre && !post) {
        findings.push({
          severity: "critical",
          code: "installed_vsix.gate_started_without_finish",
          message: `Gate ${gate} started but did not finish.`,
        });
      }
    }
  }

  const sidecars = proof.visibleSidecarToolSmokes || proof.visible_sidecar_tool_smokes || gateMap.get("gate6-sidecar-probes")?.visibleSidecarToolSmokes || {};
  const requiredSidecars = ["openhands", "aider", "goose"];
  const missingSidecars = requiredSidecars.filter((tool) => !sidecarSmokeAccepted(sidecars?.[tool]));
  if (missingSidecars.length) {
    findings.push({
      severity: "critical",
      code: "installed_vsix.visible_sidecar_proof_missing",
      message: "Visible sidecar smoke proof is missing real successful tool calls with HermesProof evidence ids.",
      evidence: { missing_sidecars: missingSidecars },
    });
    requiredActions.push("Record real HermesProof ev_* evidence for OpenHands, Aider, and Goose visible sidecar smokes.");
  }

  const settingsGate = gateMap.get("gate7-settings-panel-rendered");
  if (requiredGates.includes("gate7-settings-panel-rendered") && !settingsVisibleProofAccepted(settingsGate)) {
    findings.push({
      severity: "critical",
      code: "installed_vsix.visible_settings_window_proof_missing",
      message: "Gate 7 is missing visible VS Code settings-window proof with foreground screenshots, changed-window evidence, and Settings webview-rendered tab proof.",
    });
    requiredActions.push("Drive the Kilo settings UI in the visible VS Code window, attach before/after screenshots, and record the Settings webview-rendered stable tab proof.");
  }

  const chatGate = gateMap.get("gate9-extension-activation");
  if (requiredGates.includes("gate9-extension-activation") && !chatVisibleProofAccepted(chatGate)) {
    findings.push({
      severity: "critical",
      code: "installed_vsix.visible_chat_window_proof_missing",
      message: "Gate 9 is missing editor cleanup, visible Kilo activity-bar click, webview chat-task acceptance, no-marker-tab proof, and foreground screenshot proof.",
    });
    requiredActions.push("Close stale editor tabs, click the Kilo activity bar in the visible VS Code window, send a task through the Kilo webview/backend prompt path, and attach before/after screenshots.");
  }

  const preflights = installedPreflightMap(proof.preflightResults || proof.preflights || proof.preflight_runners);
  if (!preflights) {
    findings.push({
      severity: "critical",
      code: "installed_vsix.preflight_results_missing",
      message: "Installed VSIX release proof has no preflightResults map for known blocker areas.",
    });
    requiredActions.push("Run and attach every required KiloCode preflight before invoking HermesProof release evaluation.");
  } else {
    for (const key of KILOCODE_REQUIRED_PREFLIGHTS) {
      const preflight = preflights[key];
      if (!preflight) {
        findings.push({
          severity: "critical",
          code: "installed_vsix.preflight_missing",
          message: `Required KiloCode preflight '${key}' is missing.`,
          evidence: { preflight: key },
        });
        continue;
      }
      if (!installedPreflightAccepted(preflight)) {
        const reason = preflight.blocked_reason || preflight.blockedReason || preflight.reason || preflight.error || "no blocked reason";
        findings.push({
          severity: "critical",
          code: "installed_vsix.preflight_not_ok",
          message: `KiloCode preflight '${key}' is not ok: ${redactString(reason, { max: 300 })}`,
          evidence: { preflight: key },
        });
      }
      if (key === "visible-ui-driver" && !visibleUiDriverAccepted(preflight)) {
        findings.push({
          severity: "critical",
          code: "installed_vsix.visible_ui_driver_invalid",
          message: "visible-ui-driver must prove vscode-extension-tester, the installed VSIX hash, required DOM stages, and two hashed screenshots.",
        });
      }
      if (key === "settings-ui-driver" && !settingsUiDriverAccepted(preflight)) {
        findings.push({
          severity: "critical",
          code: "installed_vsix.settings_ui_driver_invalid",
          message: "settings-ui-driver must click Kilo Settings and prove the installed Settings editor DOM without render errors.",
        });
      }
      if (key === "chat-task" && !chatUiDriverAccepted(preflight)) {
        findings.push({
          severity: "critical",
          code: "installed_vsix.chat_ui_driver_invalid",
          message: "chat-task must prove one WebDriver Send click, a visible user turn, and backend-origin Kilo routing state.",
        });
      }
      const fake = installedFakePaths(preflight);
      if (fake.length) {
        findings.push({
          severity: "critical",
          code: "installed_vsix.preflight_fake_metadata",
          message: `KiloCode preflight '${key}' contains fake/mock/stub/simulated/skipped metadata.`,
          evidence: { preflight: key, paths: fake.slice(0, 5) },
        });
      }
    }
  }

  const fakeFindings = [];
  if (proof.mock === true || proof.mocked === true || proof.fake === true || proof.stub === true || proof.stubbed === true || proof.uiOnly === true || proof.ui_only === true || proof.skip === true || proof.skipped === true) {
    fakeFindings.push({
      reason: "mock_fake_stub_skipped_or_ui_only_installed_vsix_proof",
    });
    requiredActions.push("Remove mocked, fake, stubbed, skipped, hardcoded, or UI-only installed VSIX proof.");
  }

  const ok = missing.length === 0 && findings.length === 0 && fakeFindings.length === 0;
  return {
    ok,
    release_ready: ok,
    status: ok ? "accepted" : fakeFindings.length ? "rejected_fake_or_stubbed_proof" : "rejected_installed_vsix_proof",
    secret_values_returned: false,
    task_type: KILOCODE_INSTALLED_VSIX_TASK_TYPE,
    schema,
    expected_schema: KILOCODE_INSTALLED_VSIX_SCHEMA,
    contract_version: contract,
    expected_contract_version: KILOCODE_E2E_CONTRACT_VERSION,
    vsix_sha256: vsixSha256,
    required_gates: requiredGates,
    present_gates: entries.map((entry) => entry.name),
    missing,
    findings,
    fake_findings: fakeFindings,
    heartbeat_count: heartbeat.length,
    required_preflights: KILOCODE_REQUIRED_PREFLIGHTS,
    required_actions: [...new Set(requiredActions)],
  };
}

function roadmapItems(proof = {}) {
  const items = proof.items || proof.roadmapItems || proof.roadmap_items || proof.actionItems || proof.action_items || [];
  return Array.isArray(items) ? items : [];
}

function hasRunnerAttestation(item = {}) {
  const runner = item.runner || item.runner_attestation || item.attestation || {};
  const command = runner.command || runner.commandOrApi || runner.command_or_api || item.command || item.commandOrApi;
  const status = runner.status || runner.exitStatus || runner.exit_status || item.exitStatus || item.exit_status;
  const duration = runner.durationMs || runner.duration_ms || item.durationMs || item.duration_ms;
  return Boolean(command && status !== undefined && duration !== undefined);
}

function hasHashedArtifact(item = {}) {
  const artifacts = item.artifacts || item.artifactPaths || item.artifact_paths || item.snapshotPaths || item.snapshot_paths || [];
  return Array.isArray(artifacts) && artifacts.some((artifact) => {
    if (typeof artifact === "string") return false;
    if (!artifact || typeof artifact !== "object") return false;
    return Boolean(artifact.path || artifact.file || artifact.snapshotPath) && validSha256(artifact.sha256 || artifact.hash);
  });
}

function evaluateKilocodeRoadmapCompletionProof(proof = {}, options = {}) {
  const schema = String(proof.schema || proof.proof_schema || proof.proofSchema || "").trim();
  const docs = arrayFrom(proof.docs || proof.updatedDocs || proof.updated_docs || proof.requiredDocs || proof.required_docs);
  const requiredDocs = Array.isArray(options.required_docs) && options.required_docs.length
    ? options.required_docs
    : ROADMAP_REQUIRED_DOCS;
  const items = roadmapItems(proof);
  const findings = [];
  const missing = [];
  const requiredActions = [];

  if (schema !== KILOCODE_ROADMAP_SCHEMA) {
    missing.push("schema");
    requiredActions.push(`Use schema ${KILOCODE_ROADMAP_SCHEMA}.`);
  }

  const absentDocs = requiredDocs.filter((doc) => !docs.includes(doc));
  if (absentDocs.length) {
    missing.push("required_docs");
    findings.push({
      severity: "high",
      code: "roadmap.required_docs_missing",
      message: "Roadmap completion proof does not list every required truth/governance document.",
      evidence: { missing_docs: absentDocs },
    });
    requiredActions.push("Update and list ROADMAP, ACTION_PLAN, HANDOFF, governance docs, and policy files.");
  }

  if (!items.length) {
    missing.push("roadmap_items");
    findings.push({
      severity: "critical",
      code: "roadmap.items_missing",
      message: "Roadmap completion proof has no roadmap/action-plan item records.",
    });
  }

  const completed = [];
  const blocked = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const id = String(item.id || item.key || item.title || "").trim();
    const status = String(item.status || item.state || "").trim().toLowerCase();
    const releaseDone = ["done", "complete", "completed", "pass", "release-ready", "release_ready"].includes(status);
    const honestBlock = ["blocked", "partial", "not_started", "not-started", "in_progress", "in-progress"].includes(status);
    if (releaseDone) completed.push(id || "(unnamed)");
    if (honestBlock) blocked.push(id || "(unnamed)");
    if (item.mock === true || item.mocked === true || item.fake === true || item.stub === true || item.stubbed === true || item.simulated === true || item.skipped === true || item.skip === true) {
      findings.push({
        severity: "critical",
        code: "roadmap.fake_or_stubbed_item",
        message: `Roadmap item ${id || "(unnamed)"} is marked with fake/mock/stub/simulated/skipped proof metadata.`,
      });
    }
    if (!releaseDone) continue;
    if (!validEvidenceId(item.evidence_id || item.evidenceId || item.hermesProofEventId || item.proofId || item.proof_id)) {
      findings.push({
        severity: "critical",
        code: "roadmap.completed_item_missing_evidence",
        message: `Completed roadmap item ${id || "(unnamed)"} has no real HermesProof ev_* id.`,
      });
    }
    if (!hasRunnerAttestation(item)) {
      findings.push({
        severity: "critical",
        code: "roadmap.completed_item_missing_runner",
        message: `Completed roadmap item ${id || "(unnamed)"} has no runner command/status/duration attestation.`,
      });
    }
    if (!hasHashedArtifact(item)) {
      findings.push({
        severity: "critical",
        code: "roadmap.completed_item_missing_hashed_artifact",
        message: `Completed roadmap item ${id || "(unnamed)"} has no hashed artifact or snapshot.`,
      });
    }
  }

  if (options.require_all_complete === true && blocked.length) {
    findings.push({
      severity: "critical",
      code: "roadmap.not_all_complete",
      message: "All-complete roadmap proof was requested, but some items are still blocked or incomplete.",
      evidence: { blocked },
    });
  }

  const ok = missing.length === 0 && findings.length === 0;
  return {
    ok,
    release_ready: ok,
    status: ok ? "accepted" : "rejected_roadmap_completion_proof",
    secret_values_returned: false,
    task_type: KILOCODE_ROADMAP_TASK_TYPE,
    schema,
    expected_schema: KILOCODE_ROADMAP_SCHEMA,
    required_docs: requiredDocs,
    completed_items: completed,
    blocked_or_incomplete_items: blocked,
    missing,
    findings,
    required_actions: [...new Set(requiredActions)],
  };
}

async function recordKilocodeAgentBusEvent({
  manager,
  owner,
  envelope = {},
  task_id = "",
} = {}) {
  if (!manager) throw new Error("manager is required");
  if (!owner) throw new Error("owner is required");

  const evaluation = evaluateKilocodeAgentBusEnvelope(envelope);
  if (!evaluation.ok) {
    return {
      ok: false,
      status: evaluation.status,
      secret_values_returned: false,
      evaluation,
    };
  }

  const payload = redactIntegrationText({
    schema: "hermesproof.kilocode.agent_bus.v1",
    ts_utc: new Date().toISOString(),
    owner,
    task_id: evaluation.task_id,
    event_type: evaluation.event_type,
    substrate: evaluation.substrate,
    worker_id: evaluation.worker_id,
    session_id: evaluation.session_id,
    lane: evaluation.lane,
    summary: evaluation.summary,
    proof_refs: evaluation.proof_refs,
    artifacts: evaluation.artifacts,
    checks: evaluation.checks,
    has_concrete_proof: evaluation.has_concrete_proof,
    source_envelope: envelope,
    secret_values_returned: false,
  }, { max: 900 });

  const evidenceResult = await manager.appendEvidence({
    owner,
    taskId: task_id || evaluation.task_id,
    kind: "kilocode.agent_bus.event",
    summary: `Kilo agent bus ${evaluation.event_type}: ${evaluation.summary || evaluation.substrate}`,
    data: payload,
  });

  return {
    ok: true,
    status: "recorded",
    secret_values_returned: false,
    task_type: KILOCODE_AGENT_BUS_TASK_TYPE,
    evaluation,
    evidence: evidenceResult.evidence,
    next_tool: evaluation.event_type === "task.completed"
      ? "hermes_kilocode_checkpoint_progress"
      : evaluation.event_type === "task.failed"
        ? "hermes_kilocode_policy_check"
        : "hermes_kilocode_record_agent_bus_event",
  };
}

function evaluateKilocodeInfrastructureProof({
  resource = "edge_and_origin",
  checks = [],
  proof = [],
} = {}) {
  const normalizedResource = normalizeInfrastructureResource(resource);
  const normalizedChecks = Array.isArray(checks) ? checks.map(normalizeInfrastructureCheck).filter((check) => check.id) : [];
  const originalChecks = Array.isArray(checks) ? checks : [];
  const requiredChecks = infrastructureRequiredChecks(normalizedResource);
  const byId = new Map(normalizedChecks.map((check) => [check.id, check]));
  const fakeFindings = originalChecks
    .map((check, index) => ({ check, index }))
    .filter(({ check }) => infrastructureCheckIsFake(check))
    .map(({ check, index }) => ({
      index,
      id: redactString(check.id || check.gate || check.name || `check_${index}`, { max: 120 }),
      reason: "mock_fake_stub_skipped_or_ui_only_check_claimed",
    }));
  const missingRequired = requiredChecks.filter((id) => !byId.has(id));
  const failingRequired = requiredChecks.filter((id) => {
    const check = byId.get(id);
    return check && check.status !== "pass";
  });
  const weakEvidence = normalizedChecks
    .filter((check) => check.status === "pass" && !infrastructureCheckHasConcreteSignal(check))
    .map((check) => check.id);
  const warningChecks = normalizedChecks.filter((check) => check.status === "warn").map((check) => check.id);
  const failedChecks = normalizedChecks.filter((check) => check.status === "fail").map((check) => check.id);
  const missingProof = (proof || []).filter((entry) => entry.exists === false).map((entry) => entry.path);
  const proofCount = (proof || []).filter((entry) => entry.exists === true).length;
  const releaseReady =
    normalizedChecks.length > 0 &&
    missingRequired.length === 0 &&
    failingRequired.length === 0 &&
    failedChecks.length === 0 &&
    fakeFindings.length === 0 &&
    weakEvidence.length === 0 &&
    missingProof.length === 0;
  const gateStatus = releaseReady ? (warningChecks.length ? "warn" : "pass") : "fail";
  const requiredActions = [];
  if (!normalizedChecks.length) requiredActions.push("Run real Cloudflare/VPS smoke checks before recording infrastructure proof.");
  if (missingRequired.length) requiredActions.push(`Prove missing infrastructure checks: ${missingRequired.join(", ")}.`);
  if (failingRequired.length) requiredActions.push(`Repair failing required checks: ${failingRequired.join(", ")}.`);
  if (failedChecks.length) requiredActions.push(`Repair failed infrastructure checks: ${failedChecks.join(", ")}.`);
  if (weakEvidence.length) requiredActions.push(`Attach concrete command/http/status/evidence id for passing checks: ${weakEvidence.join(", ")}.`);
  if (fakeFindings.length) requiredActions.push("Remove mocked, fake, stubbed, skipped, hardcoded, or UI-only infrastructure proof.");
  if (missingProof.length) requiredActions.push(`Attach existing proof artifacts: ${missingProof.join(", ")}.`);
  if (warningChecks.length && releaseReady) requiredActions.push(`Review warning checks before release: ${warningChecks.join(", ")}.`);
  const acceptedForRecording = fakeFindings.length === 0;

  return {
    ok: releaseReady,
    accepted_for_recording: acceptedForRecording,
    resource: normalizedResource,
    task_type: KILOCODE_INFRASTRUCTURE_TASK_TYPE,
    gate_status: gateStatus,
    release_ready: releaseReady,
    required_checks: requiredChecks,
    check_count: normalizedChecks.length,
    proof_artifact_count: proofCount,
    checks: normalizedChecks,
    warning_checks: warningChecks,
    failed_checks: failedChecks,
    missing_required_checks: missingRequired,
    failing_required_checks: failingRequired,
    weak_evidence_checks: weakEvidence,
    fake_findings: fakeFindings,
    required_actions: requiredActions,
    secret_values_returned: false,
  };
}

function normalizeTrigger(trigger) {
  const value = String(trigger || "unknown").trim().toLowerCase().replace(/[^a-z0-9_:-]+/g, "_");
  return VALID_TRIGGERS.has(value) ? value : "unknown";
}

function normalizeRisk(risk) {
  const value = String(risk || "medium").trim().toLowerCase();
  return VALID_RISKS.has(value) ? value : "medium";
}

function normalizeMode(mode) {
  const value = String(mode || "normal").trim().toLowerCase();
  if (!VALID_MODES.has(value)) return "normal";
  return value === "yolo" ? "authorized_reverse_engineering" : value;
}

function bool(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null || value === "") return fallback;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(text)) return true;
  if (["0", "false", "no", "off"].includes(text)) return false;
  return fallback;
}

function positiveInt(value, fallback, min = 1, max = 10_080) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function normalizeKilocodeGuardrails(input = {}) {
  const raw = input || {};
  const previous = { ...DEFAULT_KILOCODE_GUARDRAILS, ...(input || {}) };
  const hyperfocus = bool(previous.hyperfocus_visual_mode, DEFAULT_KILOCODE_GUARDRAILS.hyperfocus_visual_mode);
  const visualStepFallback = hyperfocus ? 2 : DEFAULT_KILOCODE_GUARDRAILS.visual_milestone_step_interval;
  const visualMinuteFallback = hyperfocus ? 30 : DEFAULT_KILOCODE_GUARDRAILS.visual_milestone_minutes;
  const visualStepValue = Object.hasOwn(raw, "visual_milestone_step_interval")
    ? previous.visual_milestone_step_interval
    : undefined;
  const visualMinuteValue = Object.hasOwn(raw, "visual_milestone_minutes")
    ? previous.visual_milestone_minutes
    : undefined;
  return {
    mvp_first: bool(previous.mvp_first, DEFAULT_KILOCODE_GUARDRAILS.mvp_first),
    no_new_ideas_mode: bool(previous.no_new_ideas_mode, DEFAULT_KILOCODE_GUARDRAILS.no_new_ideas_mode),
    force_mvp_gui_first: bool(previous.force_mvp_gui_first, DEFAULT_KILOCODE_GUARDRAILS.force_mvp_gui_first),
    require_visual_proof: bool(previous.require_visual_proof, DEFAULT_KILOCODE_GUARDRAILS.require_visual_proof),
    screenshot_on_checkpoint: bool(previous.screenshot_on_checkpoint, DEFAULT_KILOCODE_GUARDRAILS.screenshot_on_checkpoint),
    block_until_usable: bool(previous.block_until_usable, DEFAULT_KILOCODE_GUARDRAILS.block_until_usable),
    hyperfocus_visual_mode: hyperfocus,
    focus_mode: bool(previous.focus_mode, DEFAULT_KILOCODE_GUARDRAILS.focus_mode),
    visual_milestone_step_interval: positiveInt(
      visualStepValue,
      visualStepFallback,
      1,
      100
    ),
    visual_milestone_minutes: positiveInt(visualMinuteValue, visualMinuteFallback, 5, 1440),
  };
}

function guardrailFile(workspaceRoot) {
  const root = path.resolve(String(workspaceRoot || process.cwd()));
  return path.join(root, ".hermes3d_orchestrator", KILOCODE_GUARDRAILS_FILE);
}

function progressFile(workspaceRoot) {
  const root = path.resolve(String(workspaceRoot || process.cwd()));
  return path.join(root, ".hermes3d_orchestrator", KILOCODE_PROGRESS_FILE);
}

async function readKilocodeGuardrails({ workspaceRoot } = {}) {
  const file = guardrailFile(workspaceRoot);
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8"));
    return {
      ok: true,
      source: "workspace",
      secret_values_returned: false,
      guardrails: normalizeKilocodeGuardrails(parsed?.guardrails || parsed),
    };
  } catch (err) {
    if (err?.code !== "ENOENT") {
      return {
        ok: true,
        source: "default_after_read_error",
        warning: redactString(err?.message || String(err), { max: 200 }),
        secret_values_returned: false,
        guardrails: normalizeKilocodeGuardrails(),
      };
    }
    return {
      ok: true,
      source: "default",
      secret_values_returned: false,
      guardrails: normalizeKilocodeGuardrails(),
    };
  }
}

async function setKilocodeGuardrails({
  workspaceRoot,
  reset = false,
  reason = "",
  owner = "",
  ...patch
} = {}) {
  const file = guardrailFile(workspaceRoot);
  const previous = reset ? normalizeKilocodeGuardrails() : (await readKilocodeGuardrails({ workspaceRoot })).guardrails;
  const merged = { ...previous, ...patch };
  if (bool(patch.hyperfocus_visual_mode, false)) {
    if (!Object.hasOwn(patch, "visual_milestone_step_interval")) merged.visual_milestone_step_interval = 2;
    if (!Object.hasOwn(patch, "visual_milestone_minutes")) merged.visual_milestone_minutes = 30;
  }
  const next = normalizeKilocodeGuardrails(merged);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    JSON.stringify(
      {
        schema: "hermesproof.kilocode.guardrails.v1",
        updated_at: new Date().toISOString(),
        updated_by: redactString(owner, { max: 120 }) || "unknown",
        reason: redactString(reason, { max: 300 }),
        guardrails: next,
        secret_values_returned: false,
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
  return {
    ok: true,
    status: reset ? "reset" : "updated",
    source: "workspace",
    secret_values_returned: false,
    guardrails: next,
  };
}

function guardrailGoals(normalized) {
  const goals = [];
  if (normalized.mvp_first) goals.push("Ship the smallest usable milestone before expanding scope.");
  if (normalized.force_mvp_gui_first) goals.push("Make the first UI/navigation path runnable early when a project has a GUI.");
  if (normalized.require_visual_proof) goals.push("Use screenshot or visible-state proof for GUI-facing progress.");
  if (normalized.block_until_usable) goals.push("Block new scope until the current milestone is usable or deliberately overridden.");
  if (normalized.focus_mode) goals.push("Keep the active task narrow until the current checkpoint is resolved.");
  if (normalized.hyperfocus_visual_mode) goals.push("Use shorter checkpoints and more visible proof while work is moving fast.");
  return goals;
}

function guardrailEffects(guardrails, {
  trigger,
  action_summary = "",
  scope_change = false,
  visual_proof_provided = false,
  current_milestone_usable = false,
} = {}) {
  const normalized = normalizeKilocodeGuardrails(guardrails);
  const summary = String(action_summary || "");
  const mentionsNewScope = scope_change || /\b(add|new|another|also|while we'?re|feature|scope|idea)\b/i.test(summary);
  const mentionsGui = /\b(gui|ui|screen|view|nav|navigation|page|panel|webview|browser|screenshot|visual)\b/i.test(summary);
  const needsVisualProof =
    normalized.require_visual_proof &&
    !visual_proof_provided &&
    !["read_only"].includes(trigger) &&
    (mentionsGui || normalized.force_mvp_gui_first || normalized.hyperfocus_visual_mode);
  const blocksNewScope =
    (normalized.block_until_usable || normalized.no_new_ideas_mode) &&
    mentionsNewScope &&
    !current_milestone_usable;
  const effects = [];
  const safeguards = [];

  if (normalized.mvp_first) safeguards.push("Keep the next step to the smallest usable milestone before expanding scope.");
  if (normalized.force_mvp_gui_first) safeguards.push("Prefer a basic runnable GUI/navigation path before backend depth when the project has a UI.");
  if (normalized.screenshot_on_checkpoint) safeguards.push("Capture screenshot or visual state at each checkpoint when a GUI exists.");
  if (normalized.hyperfocus_visual_mode) {
    safeguards.push("Hyperfocus visual mode is active: reduce invisible work and checkpoint more often.");
  }
  if (needsVisualProof) {
    effects.push("visual_proof_required");
    safeguards.push("Produce or request visual proof before continuing to the next feature slice.");
  }
  if (blocksNewScope) {
    effects.push("current_milestone_not_usable");
    safeguards.push("Do not accept new scope until the current milestone is marked usable or the user deliberately overrides.");
  }

  const requiredActions = [];
  if (needsVisualProof) {
    requiredActions.push({
      id: "capture_visual_proof",
      description: "Capture a screenshot or visible UI state proof for the current milestone before continuing.",
      next_tool: "hermes_kilocode_checkpoint_progress",
    });
  }
  if (blocksNewScope) {
    requiredActions.push({
      id: "finish_current_milestone",
      description: "Run, inspect, or repair the current milestone until it is usable before accepting new scope.",
      next_tool: "hermes_kilocode_checkpoint_progress",
    });
  }

  return {
    active: effects.length > 0 || Object.values(normalized).some(Boolean),
    effects,
    blocked_by_guardrails: blocksNewScope,
    visual_proof_required: needsVisualProof,
    checkpoint: {
      every_steps: normalized.visual_milestone_step_interval,
      every_minutes: normalized.visual_milestone_minutes,
    },
    guardrails: normalized,
    goals: guardrailGoals(normalized),
    required_actions: requiredActions,
    safeguards,
  };
}

function cleanCapability(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "_").slice(0, 80);
}

function addPermissionForTrigger(required, trigger, capabilities) {
  if (DELEGATE_TRIGGERS.has(trigger) || capabilities.size) required.add("openhands_delegate");
  if (["missing_tool", "repeated_failure", "long_running", "stuck", "openhands"].includes(trigger)) {
    required.add("openhands_workspace_write");
  }
  if (["browser", "install", "deploy", "ssh", "vps"].includes(trigger)) {
    required.add("openhands_external_network");
  }
  if (trigger === "browser") required.add("openhands_browser");
  if (trigger === "docker") required.add("openhands_docker");
  if (trigger === "install") required.add("openhands_install");
  if (trigger === "ssh" || trigger === "vps") required.add("openhands_ssh");
  if (trigger === "deploy") required.add("openhands_deploy");
  if (trigger === "destructive") required.add("openhands_destructive");
  if (trigger === "secret_required") required.add("openhands_secret_access");

  for (const capability of capabilities) {
    if (capability.includes("write") || capability.includes("edit")) required.add("openhands_workspace_write");
    if (capability.includes("browser") || capability.includes("web")) required.add("openhands_browser");
    if (capability.includes("network") || capability.includes("download")) required.add("openhands_external_network");
    if (capability.includes("docker") || capability.includes("container")) required.add("openhands_docker");
    if (capability.includes("install") || capability.includes("package")) required.add("openhands_install");
    if (capability.includes("ssh") || capability.includes("vps")) required.add("openhands_ssh");
    if (capability.includes("deploy") || capability.includes("release")) required.add("openhands_deploy");
    if (capability.includes("delete") || capability.includes("destructive")) required.add("openhands_destructive");
    if (capability.includes("secret") || capability.includes("token")) required.add("openhands_secret_access");
  }
}

function evaluateKilocodePolicy({
  trigger = "unknown",
  risk = "medium",
  capabilities = [],
  explicit = false,
  repeated_failures = 0,
  action_summary = "",
  guardrails = undefined,
  scope_change = false,
  visual_proof_provided = false,
  current_milestone_usable = false,
} = {}) {
  const normalizedTrigger = normalizeTrigger(trigger);
  const normalizedRisk = normalizeRisk(risk);
  const capabilitySet = new Set((capabilities || []).map(cleanCapability).filter(Boolean));
  const failureCount = Number.isFinite(Number(repeated_failures)) ? Math.max(0, Math.round(Number(repeated_failures))) : 0;
  const redactedSummary = redactString(action_summary, { max: 500 });
  const hasSecretSignal = SECRET_SIGNAL.test(String(action_summary || "")) || [...capabilitySet].some((cap) => cap.includes("secret") || cap.includes("token"));

  const required = new Set();
  addPermissionForTrigger(required, normalizedTrigger, capabilitySet);

  let delegate = false;
  let decision = "allow";
  let reason = "KiloCode can handle this locally.";

  if (normalizedTrigger === "secret_required" || hasSecretSignal) {
    delegate = false;
    decision = "deny";
    required.add("openhands_secret_access");
    reason = "Raw secrets must stay outside delegation prompts and logs; pass named secret references instead.";
  } else if (LOCAL_ONLY_TRIGGERS.has(normalizedTrigger) && failureCount < 2 && !explicit) {
    delegate = false;
    decision = "allow";
    reason = "No sidecar needed for a local read-only or simple-edit task.";
  } else if (DELEGATE_TRIGGERS.has(normalizedTrigger) || explicit || failureCount >= 2 || capabilitySet.size > 0) {
    delegate = true;
    reason = "OpenHands sidecar is appropriate for the requested capability gap.";
    if (ASK_TRIGGERS.has(normalizedTrigger) || normalizedRisk === "high" || normalizedRisk === "critical" || required.has("openhands_destructive")) {
      decision = "ask";
    }
  } else {
    delegate = false;
    decision = "ask";
    reason = "The trigger is unknown, so the caller should ask before delegating.";
  }

  if (!delegate) {
    required.delete("openhands_delegate");
  }

  const guardrail = guardrailEffects(guardrails, {
    trigger: normalizedTrigger,
    action_summary,
    scope_change,
    visual_proof_provided,
    current_milestone_usable,
  });
  if (guardrail.blocked_by_guardrails) {
    delegate = false;
    decision = "deny";
    reason = "KiloCode guardrails block new scope until the current milestone is marked usable.";
    required.delete("openhands_delegate");
  } else if (guardrail.visual_proof_required && decision === "allow" && delegate) {
    decision = "ask";
    reason = "Visual proof is required before continuing this delegated feature slice.";
  }

  const safeguards = [
    "Redact prompt, evidence, and provider context before storage.",
    "Record provider outcome and HermesProof evidence after delegation.",
    ...guardrail.safeguards,
  ];
  if (decision === "ask") safeguards.push("Require user or policy approval before executing risky sidecar actions.");
  if (required.has("openhands_ssh")) safeguards.push("Use explicit SSH target approval and never pass private keys in prompts.");
  if (required.has("openhands_deploy")) safeguards.push("Require deploy target confirmation and keep deployment secrets as named references.");
  if (required.has("openhands_destructive")) safeguards.push("Require a bounded path allowlist before destructive actions.");

  return {
    ok: true,
    delegate,
    decision,
    required_permissions: [...required].filter((name) => KILOCODE_PERMISSION_NAMES.includes(name)).sort(),
    reason,
    risk: normalizedRisk,
    trigger: normalizedTrigger,
    repeated_failures: failureCount,
    redacted_action_summary: redactedSummary,
    secret_values_returned: false,
    guardrails: guardrail.guardrails,
    guardrail_effects: guardrail.effects,
    guardrail_goals: guardrail.goals,
    required_actions: guardrail.required_actions,
    visual_proof_required: guardrail.visual_proof_required,
    blocked_by_guardrails: guardrail.blocked_by_guardrails,
    checkpoint: guardrail.checkpoint,
    safeguards,
  };
}

function normalizeProgressStatus(status) {
  const value = String(status || "working").trim().toLowerCase();
  return VALID_PROGRESS_STATUS.has(value) ? value : "working";
}

async function inspectProofPaths(workspaceRoot, visualProofPaths = []) {
  const root = path.resolve(String(workspaceRoot || process.cwd()));
  const out = [];
  for (const entry of visualProofPaths || []) {
    const raw = String(entry || "").trim();
    if (!raw) continue;
    const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw);
    const relative = path.relative(root, resolved);
    const insideWorkspace = Boolean(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
    const safePath = insideWorkspace ? relative.replace(/\\/g, "/") : redactString(resolved, { max: 240 });
    try {
      const stat = await fs.stat(resolved);
      out.push({
        path: safePath,
        exists: true,
        kind: stat.isDirectory() ? "directory" : "file",
        size_bytes: stat.isFile() ? stat.size : null,
        inside_workspace: insideWorkspace,
      });
    } catch (err) {
      out.push({
        path: safePath,
        exists: false,
        error: err?.code || "missing",
        inside_workspace: insideWorkspace,
      });
    }
  }
  return out;
}

async function recordKilocodeProgressCheckpoint({
  manager,
  workspaceRoot,
  owner,
  milestone_id = "",
  milestone_goal = "",
  status = "working",
  summary = "",
  visual_proof_paths = [],
  gates = [],
  next_action = "",
  current_milestone_usable = false,
  guardrails = undefined,
} = {}) {
  if (!manager) throw new Error("manager is required");
  if (!owner) throw new Error("owner is required");

  const root = path.resolve(String(workspaceRoot || manager?.workspaceRoot || process.cwd()));
  const normalizedStatus = normalizeProgressStatus(status);
  const proof = await inspectProofPaths(root, visual_proof_paths);
  const missingProof = proof.filter((entry) => !entry.exists);
  if ((visual_proof_paths || []).length && missingProof.length) {
    return {
      ok: false,
      status: "missing_visual_proof",
      secret_values_returned: false,
      message: "One or more visual proof paths do not exist; checkpoint was not recorded.",
      missing_visual_proof: missingProof,
    };
  }

  const usable = Boolean(current_milestone_usable) || ["usable", "verified", "complete"].includes(normalizedStatus);
  const guardrail = guardrailEffects(guardrails, {
    trigger: "explicit",
    action_summary: summary || milestone_goal,
    visual_proof_provided: proof.some((entry) => entry.exists),
    current_milestone_usable: usable,
  });
  const checkpoint = {
    id: `kilo_checkpoint_${Date.now()}`,
    ts_utc: new Date().toISOString(),
    owner: redactString(owner, { max: 120 }),
    milestone_id: redactString(milestone_id || "current", { max: 120 }),
    milestone_goal: redactString(milestone_goal, { max: 300 }),
    status: normalizedStatus,
    current_milestone_usable: usable,
    summary: redactString(summary, { max: 600 }),
    visual_proof: proof,
    gates: redactIntegrationText(gates, { max: 500 }),
    next_action: redactString(next_action, { max: 300 }),
    guardrail_effects: guardrail.effects,
    guardrail_goals: guardrail.goals,
    required_actions: guardrail.required_actions,
    secret_values_returned: false,
  };

  const file = progressFile(root);
  let previous = { checkpoints: [] };
  try {
    previous = JSON.parse(await fs.readFile(file, "utf8"));
  } catch {}
  const checkpoints = Array.isArray(previous.checkpoints) ? previous.checkpoints.slice(-99) : [];
  checkpoints.push(checkpoint);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    JSON.stringify(
      {
        schema: "hermesproof.kilocode.progress.v1",
        updated_at: checkpoint.ts_utc,
        latest: checkpoint,
        checkpoints,
        secret_values_returned: false,
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  const evidenceResult = await manager.appendEvidence({
    owner,
    taskId: checkpoint.milestone_id,
    kind: "kilocode.progress.checkpoint",
    summary: `KiloCode milestone ${normalizedStatus}: ${checkpoint.summary || checkpoint.milestone_goal || checkpoint.milestone_id}`,
    data: checkpoint,
  });

  return {
    ok: true,
    status: "recorded",
    secret_values_returned: false,
    checkpoint,
    evidence: evidenceResult.evidence,
    next_tool: checkpoint.required_actions.length ? "hermes_kilocode_policy_check" : "hermes_kilocode_record_delegation",
  };
}

function envPresent(env, names) {
  return names.some((name) => Boolean(env?.[name]));
}

function kilocodeStatusSnapshot({
  workspaceRoot = "",
  registryProviderCount = 0,
  registryLoadOk = false,
  bridgeEnabled = false,
  bridgeReason = "",
  providerRanking = null,
  guardrails = undefined,
  env = process.env,
} = {}) {
  const activeGuardrails = normalizeKilocodeGuardrails(guardrails);
  return {
    ok: true,
    workspace_root: workspaceRoot || null,
    secret_values_returned: false,
    registry_provider_count: Number(registryProviderCount || 0),
    registry_load_ok: Boolean(registryLoadOk),
    readiness: {
      minimax_api_key_configured: envPresent(env, ["MINIMAX_API_KEY"]),
      openhands_url_configured: envPresent(env, ["OPENHANDS_BASE_URL", "OPENHANDS_URL", "OPENHANDS_AGENT_SERVER_URL"]),
      openhands_session_key_configured: envPresent(env, ["OPENHANDS_SESSION_API_KEY", "OPENHANDS_API_KEY"]),
      private_secret_store_configured: envPresent(env, ["HERMESPROOF_PRIVATE_ROOT", "HERMES3D_ENV_FILE", "HERMES3D_VPS_ENV_FILE"]),
      hermes_agent_enabled: Boolean(bridgeEnabled),
    },
    bridge: {
      enabled: Boolean(bridgeEnabled),
      reason: bridgeEnabled ? "enabled" : bridgeReason || "disabled_by_default",
    },
    recommended_task_type: KILOCODE_TASK_TYPE,
    recommended_tools: [
      "hermes_kilocode_set_guardrails",
      "hermes_kilocode_policy_check",
      "hermes_kilocode_checkpoint_progress",
      "hermes_kilocode_evaluate_installed_vsix_release_proof",
      "hermes_kilocode_evaluate_roadmap_completion_proof",
      "hermes_kilocode_record_delegation",
      "hermes_kilocode_evaluate_agent_bus_event",
      "hermes_kilocode_record_agent_bus_event",
      "hermes_kilocode_evaluate_infrastructure_proof",
      "hermes_kilocode_record_infrastructure_proof",
      "hermes_provider_rank",
    ],
    recommended_permissions: KILOCODE_PERMISSION_NAMES,
    guardrails: activeGuardrails,
    visual_progress: {
      require_visual_proof: activeGuardrails.require_visual_proof,
      screenshot_on_checkpoint: activeGuardrails.screenshot_on_checkpoint,
      checkpoint_every_steps: activeGuardrails.visual_milestone_step_interval,
      checkpoint_every_minutes: activeGuardrails.visual_milestone_minutes,
      hyperfocus_visual_mode: activeGuardrails.hyperfocus_visual_mode,
    },
    provider_ranking: providerRanking,
  };
}

async function recordKilocodeDelegation({
  manager,
  providerPerformance,
  owner,
  task_id = "",
  provider_id = "minimax",
  model_name = "",
  openhands_conversation_id = "",
  trigger = "unknown",
  risk = "medium",
  outcome,
  latency_ms = null,
  summary = "",
  evidence = "",
  permission_decision = "ask",
  secret_scan = "not_checked",
  mode = "normal",
  uncensored = false,
  reverse_engineering_authorized = false,
} = {}) {
  if (!manager) throw new Error("manager is required");
  if (!providerPerformance) throw new Error("providerPerformance is required");
  if (!owner) throw new Error("owner is required");
  if (!outcome) throw new Error("outcome is required");

  const normalizedTrigger = normalizeTrigger(trigger);
  const normalizedRisk = normalizeRisk(risk);
  const redactedSummary = redactString(summary, { max: 600 });
  const redactedEvidence = redactString(evidence, { max: 300 });
  const redactedConversationId = redactString(openhands_conversation_id, { max: 160 });
  const safePermissionDecision = ["allow", "ask", "deny"].includes(permission_decision) ? permission_decision : "ask";
  const safeSecretScan = ["passed", "failed", "not_checked"].includes(secret_scan) ? secret_scan : "not_checked";
  const safeMode = normalizeMode(mode);
  const safeUncensored = Boolean(uncensored);
  const safeReverseEngineeringAuthorized =
    safeMode === "authorized_reverse_engineering" || Boolean(reverse_engineering_authorized);

  const providerResult = await providerPerformance.recordOutcome({
    provider_id,
    model_name,
    task_type: KILOCODE_TASK_TYPE,
    outcome,
    latency_ms,
    context: `${safeMode}: ${redactedSummary}`,
    evidence: redactedEvidence,
  });

  const evidenceResult = await manager.appendEvidence({
    owner,
    taskId: task_id,
    kind: "kilocode.openhands.delegation",
    summary: `Kilo/OpenHands delegation ${outcome}: ${redactedSummary || normalizedTrigger}`,
    data: redactIntegrationText({
      system: "kilocode-openhands-integration",
      provider_id,
      model_name,
      openhands_conversation_id: redactedConversationId,
      trigger: normalizedTrigger,
      risk: normalizedRisk,
      outcome,
      latency_ms,
      permission_decision: safePermissionDecision,
      secret_scan: safeSecretScan,
      mode: safeMode,
      uncensored: safeUncensored,
      reverse_engineering_authorized: safeReverseEngineeringAuthorized,
      evidence: redactedEvidence,
      provider_result: providerResult,
      secret_values_returned: false,
    }, { max: 600 }),
  });

  return {
    ok: true,
    status: "recorded",
    secret_values_returned: false,
    task_type: KILOCODE_TASK_TYPE,
    trigger: normalizedTrigger,
    risk: normalizedRisk,
    permission_decision: safePermissionDecision,
    secret_scan: safeSecretScan,
    mode: safeMode,
    uncensored: safeUncensored,
    reverse_engineering_authorized: safeReverseEngineeringAuthorized,
    provider_result: providerResult,
    evidence: evidenceResult.evidence,
  };
}

async function recordKilocodeInfrastructureProof({
  manager,
  workspaceRoot,
  owner,
  task_id = "",
  resource = "edge_and_origin",
  target = "",
  summary = "",
  checks = [],
  proof_paths = [],
  next_action = "",
} = {}) {
  if (!manager) throw new Error("manager is required");
  if (!owner) throw new Error("owner is required");

  const root = path.resolve(String(workspaceRoot || manager?.workspaceRoot || process.cwd()));
  const proof = await inspectProofPaths(root, proof_paths);
  const evaluation = evaluateKilocodeInfrastructureProof({
    resource,
    checks,
    proof,
  });

  if (!evaluation.accepted_for_recording) {
    return {
      ok: false,
      status: "rejected_fake_or_stubbed_proof",
      secret_values_returned: false,
      evaluation,
    };
  }

  const payload = redactIntegrationText({
    schema: "hermesproof.kilocode.infrastructure.v1",
    ts_utc: new Date().toISOString(),
    owner,
    task_id,
    resource: evaluation.resource,
    target,
    summary,
    gate_status: evaluation.gate_status,
    release_ready: evaluation.release_ready,
    checks: evaluation.checks,
    proof,
    warning_checks: evaluation.warning_checks,
    failed_checks: evaluation.failed_checks,
    missing_required_checks: evaluation.missing_required_checks,
    failing_required_checks: evaluation.failing_required_checks,
    weak_evidence_checks: evaluation.weak_evidence_checks,
    required_actions: evaluation.required_actions,
    next_action,
    secret_values_returned: false,
  }, { max: 900 });

  const evidenceResult = await manager.appendEvidence({
    owner,
    taskId: task_id || `${evaluation.resource}-infrastructure`,
    kind: "kilocode.infrastructure.proof",
    summary: `KiloCode infrastructure ${evaluation.gate_status}: ${redactString(summary || evaluation.resource, { max: 300 })}`,
    data: payload,
  });

  return {
    ok: evaluation.release_ready,
    recorded: true,
    status: evaluation.release_ready ? "recorded_release_ready" : "recorded_needs_followup",
    secret_values_returned: false,
    evaluation,
    release_ready: evaluation.release_ready,
    evidence: evidenceResult.evidence,
    next_tool: evaluation.release_ready ? "hermes_kilocode_checkpoint_progress" : "hermes_kilocode_policy_check",
  };
}

export {
  KILOCODE_AGENT_BUS_TASK_TYPE,
  KILOCODE_E2E_CONTRACT_VERSION,
  KILOCODE_INFRASTRUCTURE_TASK_TYPE,
  KILOCODE_INSTALLED_VSIX_TASK_TYPE,
  KILOCODE_PERMISSION_NAMES,
  KILOCODE_ROADMAP_TASK_TYPE,
  KILOCODE_REQUIRED_PREFLIGHTS,
  KILOCODE_TASK_TYPE,
  DEFAULT_KILOCODE_GUARDRAILS,
  evaluateKilocodeAgentBusEnvelope,
  evaluateKilocodeInstalledVsixReleaseProof,
  evaluateKilocodeInfrastructureProof,
  evaluateKilocodePolicy,
  evaluateKilocodeRoadmapCompletionProof,
  kilocodeStatusSnapshot,
  normalizeKilocodeGuardrails,
  recordKilocodeAgentBusEvent,
  recordKilocodeProgressCheckpoint,
  recordKilocodeDelegation,
  recordKilocodeInfrastructureProof,
  readKilocodeGuardrails,
  redactIntegrationText,
  setKilocodeGuardrails,
};
