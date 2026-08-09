const HELPER_RUNTIME_SCHEMA = "hermesproof.helper-runtime.v1";
const HELPER_RUNTIME_CONTRACT_VERSION = "hermesproof.helper-runtime.2026-07-10";
const RUNTIMES = new Set(["zeroclaw", "hermes-agent"]);
const LOCATIONS = new Set(["local", "vps"]);
const STATUSES = new Set(["completed", "failed", "blocked"]);
const FAKE_KEYS = new Set(["mock", "mocked", "fake", "stub", "stubbed", "simulated", "skip", "skipped", "uiOnly", "ui_only"]);
const SECRET = /(?:\b(?:authorization|api[-_]?key|token|password|passwd|private[-_]?token|secret)\s*[:=]|\bbearer\s+[a-z0-9._~+/-]{12,}|github_pat_|ghp_|glpat-|hf_|sk-(?:cp-)?[a-z0-9_-]{12,}|[a-z]:\\private\\)/i;

function text(value) {
  return String(value ?? "").trim();
}

function code(findings, value) {
  findings.push(value);
}

function digest(value) {
  return /^[a-f0-9]{64}$/i.test(text(value));
}

function commit(value) {
  return /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(text(value));
}

function time(value) {
  return Number.isFinite(Date.parse(text(value)));
}

function id(value) {
  return /^[a-z][a-z0-9._:-]{2,127}$/i.test(text(value));
}

function evidence(value) {
  return /^ev_[a-z0-9]{8,}$/i.test(text(value));
}

function fake(value, findings, path = "envelope") {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => fake(entry, findings, `${path}[${index}]`));
    return;
  }
  Object.entries(value).forEach(([key, entry]) => {
    if (FAKE_KEYS.has(key) && entry === true) code(findings, `${path}.${key}_forbidden`);
    fake(entry, findings, `${path}.${key}`);
  });
}

function clean(value) {
  const summary = text(value).slice(0, 800);
  return SECRET.test(summary) ? "[REDACTED]" : summary;
}

function result(input, findings) {
  return {
    ok: findings.length === 0,
    contractVersion: HELPER_RUNTIME_CONTRACT_VERSION,
    runId: text(input?.runId),
    worker: {
      id: text(input?.worker?.id),
      runtime: text(input?.worker?.runtime),
      location: text(input?.worker?.location),
    },
    workspace: {
      commit: text(input?.workspace?.commit),
      vsixSha256: text(input?.workspace?.vsixSha256),
    },
    status: text(input?.status),
    evidenceId: text(input?.hermesProof?.evidenceId),
    summary: clean(input?.summary),
    secret_values_returned: false,
    findings,
  };
}

export function evaluateHelperRuntimeEnvelope(input = {}) {
  const findings = [];
  if (text(input.schema) !== HELPER_RUNTIME_SCHEMA) code(findings, "schema_invalid");
  if (text(input.contractVersion) !== HELPER_RUNTIME_CONTRACT_VERSION) code(findings, "contract_version_mismatch");
  if (!id(input.runId)) code(findings, "run_id_invalid");
  if (!id(input.taskId)) code(findings, "task_id_invalid");
  if (!id(input.worker?.id)) code(findings, "worker_id_invalid");
  if (!RUNTIMES.has(text(input.worker?.runtime))) code(findings, "worker_runtime_invalid");
  if (!LOCATIONS.has(text(input.worker?.location))) code(findings, "worker_location_invalid");
  if (!commit(input.workspace?.commit)) code(findings, "workspace_commit_invalid");
  if (!digest(input.workspace?.vsixSha256)) code(findings, "workspace_vsix_sha256_invalid");
  if (!Array.isArray(input.scope) || input.scope.length === 0 || input.scope.some((entry) => !id(entry))) code(findings, "scope_invalid");
  if (!time(input.startedAtUtc) || !time(input.finishedAtUtc)) code(findings, "timestamps_invalid");
  if (time(input.startedAtUtc) && time(input.finishedAtUtc) && Date.parse(input.finishedAtUtc) < Date.parse(input.startedAtUtc)) code(findings, "timestamps_non_monotonic");
  if (!STATUSES.has(text(input.status))) code(findings, "status_invalid");
  if (input.runner?.statusOk !== true) code(findings, "runner_status_not_ok");
  if (input.runner?.timedOut !== false) code(findings, "runner_timed_out_or_missing");
  if (input.runner?.exitCode !== 0) code(findings, "runner_exit_code_invalid");
  if (input.secretValuesReturned !== false) code(findings, "secret_values_returned");
  if (!Array.isArray(input.artifacts) || input.artifacts.length === 0) code(findings, "artifacts_missing");
  for (const artifact of Array.isArray(input.artifacts) ? input.artifacts : []) {
    if (!id(artifact?.id) || !digest(artifact?.sha256)) code(findings, "artifact_invalid");
  }
  if (text(input.status) === "completed" && !evidence(input.hermesProof?.evidenceId)) code(findings, "evidence_id_missing");
  if (SECRET.test(text(input.summary))) code(findings, "summary_contains_secret_signal");
  fake(input, findings);
  return result(input, [...new Set(findings)]);
}

export function evaluateHelperRuntimeConsensus(input = {}) {
  const findings = [];
  const runs = Array.isArray(input.runs) ? input.runs.map(evaluateHelperRuntimeEnvelope) : [];
  if (runs.length === 0) code(findings, "runs_missing");
  const locations = Array.isArray(input.requiredLocations) ? input.requiredLocations : [];
  if (locations.length === 0 || locations.some((entry) => !LOCATIONS.has(text(entry)))) code(findings, "required_locations_invalid");
  for (const run of runs) {
    if (!run.ok) code(findings, `worker_invalid:${run.worker.location}:${run.worker.id}`);
  }
  const complete = runs.filter((run) => run.status === "completed");
  if (complete.length !== runs.length) code(findings, "worker_not_completed");
  const fields = ["runId", "workspace.commit", "workspace.vsixSha256"];
  for (const field of fields) {
    const values = runs.map((run) => field.split(".").reduce((current, key) => current?.[key], run));
    if (new Set(values).size > 1) code(findings, `consensus_mismatch:${field}`);
  }
  for (const location of locations) {
    if (!runs.some((run) => run.worker.location === location)) code(findings, `required_location_missing:${location}`);
  }
  if (new Set(runs.map((run) => run.worker.id)).size !== runs.length) code(findings, "worker_identity_not_distinct");
  return {
    ok: findings.length === 0,
    contractVersion: HELPER_RUNTIME_CONTRACT_VERSION,
    runId: runs[0]?.runId || "",
    evidenceIds: runs.map((run) => run.evidenceId).filter(Boolean),
    secret_values_returned: false,
    findings: [...new Set(findings)],
    runs,
  };
}

export { HELPER_RUNTIME_CONTRACT_VERSION, HELPER_RUNTIME_SCHEMA };
