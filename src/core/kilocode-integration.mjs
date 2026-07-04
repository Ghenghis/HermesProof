import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_PRIVATE_ROOT = "G:\\private";

const KILOCODE_TASK_TYPE = "kilocode_openhands_delegation";
const KILOCODE_INFRASTRUCTURE_TASK_TYPE = "kilocode_infrastructure_proof";
const VALID_MODES = new Set(["normal", "authorized_reverse_engineering", "yolo"]);
const KILOCODE_GUARDRAILS_FILE = "kilocode_guardrails.json";
const KILOCODE_PROGRESS_FILE = "kilocode_progress.json";
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

  return {
    ok: fakeFindings.length === 0,
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
      "hermes_kilocode_record_delegation",
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

  if (!evaluation.ok) {
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
    ok: true,
    status: "recorded",
    secret_values_returned: false,
    evaluation,
    release_ready: evaluation.release_ready,
    evidence: evidenceResult.evidence,
    next_tool: evaluation.release_ready ? "hermes_kilocode_checkpoint_progress" : "hermes_kilocode_policy_check",
  };
}

export {
  KILOCODE_INFRASTRUCTURE_TASK_TYPE,
  KILOCODE_PERMISSION_NAMES,
  KILOCODE_TASK_TYPE,
  DEFAULT_KILOCODE_GUARDRAILS,
  evaluateKilocodeInfrastructureProof,
  evaluateKilocodePolicy,
  kilocodeStatusSnapshot,
  normalizeKilocodeGuardrails,
  recordKilocodeProgressCheckpoint,
  recordKilocodeDelegation,
  recordKilocodeInfrastructureProof,
  readKilocodeGuardrails,
  redactIntegrationText,
  setKilocodeGuardrails,
};
