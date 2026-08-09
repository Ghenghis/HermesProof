const STALENESS_SCHEMA = "hermesproof.staleness.v1";
const STALENESS_CONTRACT_VERSION = "hermesproof.staleness.2026-07-10";
const KINDS = new Set(["document", "runner", "artifact", "installed-vsix", "ui-proof", "config", "evidence"]);
const STATUSES = new Set(["active", "passed", "failed", "blocked", "superseded"]);
const PROOF_KINDS = new Set(["runner", "installed-vsix", "ui-proof", "evidence"]);
const VSIX_KINDS = new Set(["installed-vsix", "ui-proof"]);
const FAKE_KEYS = new Set(["mock", "mocked", "fake", "stub", "stubbed", "simulated", "skip", "skipped", "uiOnly", "ui_only"]);
const SECRET = /(?:\b(?:authorization|api[-_]?key|token|password|passwd|private[-_]?token|secret)\s*[:=]|\bbearer\s+[a-z0-9._~+/-]{12,}|github_pat_|ghp_|glpat-|hf_|sk-(?:cp-)?[a-z0-9_-]{12,}|[a-z]:\\private\\)/i;

function text(value) {
  return String(value ?? "").trim();
}

function id(value) {
  return /^[a-z][a-z0-9._:-]{2,127}$/i.test(text(value));
}

function hash(value) {
  return /^[a-f0-9]{64}$/i.test(text(value));
}

function time(value) {
  const ms = Date.parse(text(value));
  return Number.isFinite(ms) ? ms : null;
}

function evidence(value) {
  return /^ev_[a-z0-9]{8,}$/i.test(text(value));
}

function fake(value, findings, path = "record") {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => fake(entry, findings, `${path}[${index}]`));
    return;
  }
  Object.entries(value).forEach(([key, entry]) => {
    if (FAKE_KEYS.has(key) && entry === true) findings.push(`${path}.${key}_forbidden`);
    fake(entry, findings, `${path}.${key}`);
  });
}

function read(value, key) {
  return text(value?.[key]);
}

function state(record) {
  if (record.findings.length > 0) return { verdict: "fail", truth: "rejected", freshness: "invalid" };
  if (record.status === "passed" && record.current === true) return { verdict: "pass", truth: "proven", freshness: "current" };
  if (record.status === "passed") return { verdict: "blocked", truth: "historical", freshness: "not-current" };
  if (record.status === "failed") return { verdict: "fail", truth: "failed", freshness: record.current === true ? "current" : "historical" };
  if (record.status === "blocked" || record.status === "active") return { verdict: "blocked", truth: "insufficient", freshness: record.current === true ? "current" : "historical" };
  return { verdict: "blocked", truth: "historical", freshness: "superseded" };
}

function validateRecord(record, current, options) {
  const findings = [];
  const kind = read(record, "kind");
  const status = read(record, "status");
  const at = time(record?.recordedAtUtc);
  const now = options.nowMs;
  if (!id(record?.id)) findings.push("record_id_invalid");
  if (!KINDS.has(kind)) findings.push("record_kind_invalid");
  if (!STATUSES.has(status)) findings.push("record_status_invalid");
  if (!at) findings.push("record_timestamp_invalid");
  if (at && at > now + options.maxClockSkewMs) findings.push("record_timestamp_future");
  if (at && now - at > options.maxAgeMs && status !== "superseded") findings.push("record_stale");
  if (!hash(record?.sha256)) findings.push("record_hash_invalid");
  if (!hash(record?.commit)) findings.push("record_commit_invalid");
  if (current.commit && read(record, "commit") !== current.commit) findings.push("record_commit_mismatch");
  if (current.contractVersion && read(record, "contractVersion") !== current.contractVersion) findings.push("record_contract_mismatch");
  if (VSIX_KINDS.has(kind) && !hash(record?.vsixSha256)) findings.push("record_vsix_hash_invalid");
  if (VSIX_KINDS.has(kind) && current.vsixSha256 && read(record, "vsixSha256") !== current.vsixSha256) findings.push("record_vsix_hash_mismatch");
  if (PROOF_KINDS.has(kind) && !id(record?.runId)) findings.push("record_run_id_invalid");
  if (status === "passed" && PROOF_KINDS.has(kind) && !evidence(record?.evidenceId)) findings.push("record_evidence_missing");
  if (status === "superseded" && !id(record?.supersededBy)) findings.push("record_supersession_missing");
  if (record?.current === true && status === "superseded") findings.push("current_record_superseded");
  if (SECRET.test(read(record, "summary"))) findings.push("record_summary_secret_signal");
  fake(record, findings);
  const result = {
    id: read(record, "id"),
    kind,
    status,
    current: record?.current === true,
    runId: read(record, "runId"),
    commit: read(record, "commit"),
    vsixSha256: read(record, "vsixSha256"),
    findings: [...new Set(findings)],
  };
  return { ...result, ...state(result) };
}

export function evaluateStaleness(input = {}) {
  const options = {
    nowMs: Number.isFinite(Number(input.nowMs)) ? Number(input.nowMs) : Date.now(),
    maxAgeMs: Number.isFinite(Number(input.maxAgeMs)) ? Math.max(1000, Number(input.maxAgeMs)) : 15 * 60 * 1000,
    maxClockSkewMs: Number.isFinite(Number(input.maxClockSkewMs)) ? Math.max(0, Number(input.maxClockSkewMs)) : 2 * 60 * 1000,
  };
  const findings = [];
  const current = {
    commit: text(input.current?.commit),
    vsixSha256: text(input.current?.vsixSha256),
    contractVersion: text(input.current?.contractVersion),
  };
  if (text(input.schema) !== STALENESS_SCHEMA) findings.push("schema_invalid");
  if (text(input.contractVersion) !== STALENESS_CONTRACT_VERSION) findings.push("contract_version_mismatch");
  if (!hash(current.commit)) findings.push("current_commit_invalid");
  if (!hash(current.vsixSha256)) findings.push("current_vsix_hash_invalid");
  if (!current.contractVersion) findings.push("current_contract_missing");
  const records = Array.isArray(input.records) ? input.records : [];
  if (records.length === 0) findings.push("records_missing");
  const reviewed = records.map((record) => validateRecord(record, current, options));
  for (const record of reviewed) {
    for (const finding of record.findings) findings.push(`${record.id || "record"}:${finding}`);
  }
  const required = Array.isArray(input.requiredKinds) ? input.requiredKinds.map(text) : [];
  const requirements = [];
  for (const kind of required) {
    if (!KINDS.has(kind)) {
      findings.push(`required_kind_invalid:${kind}`);
      requirements.push({ kind, verdict: "fail", truth: "rejected", recordIds: [] });
      continue;
    }
    const matches = reviewed.filter((record) => record.kind === kind && record.verdict === "pass");
    if (matches.length === 0) {
      findings.push(`required_kind_missing_or_stale:${kind}`);
      requirements.push({ kind, verdict: "blocked", truth: "insufficient", recordIds: [] });
      continue;
    }
    requirements.push({ kind, verdict: "pass", truth: "proven", recordIds: matches.map((record) => record.id) });
  }
  const grouped = new Map();
  for (const record of reviewed.filter((entry) => entry.runId)) {
    const items = grouped.get(record.runId) || [];
    items.push(record);
    grouped.set(record.runId, items);
  }
  for (const [runId, items] of grouped) {
    for (const key of ["commit", "vsixSha256"]) {
      const values = new Set(items.map((item) => item[key]).filter(Boolean));
      if (values.size > 1) findings.push(`run_lineage_mismatch:${runId}:${key}`);
    }
  }
  for (const record of reviewed) {
    if (record.current && record.status === "failed") findings.push(`current_record_failed:${record.id}`);
    if (record.current && (record.status === "blocked" || record.status === "active")) findings.push(`current_record_blocked:${record.id}`);
  }
  const codes = [...new Set(findings)];
  const failed = codes.some((finding) => !finding.startsWith("required_kind_missing_or_stale:") && !finding.startsWith("current_record_blocked:"));
  const blocked = !failed && (codes.some((finding) => finding.startsWith("required_kind_missing_or_stale:") || finding.startsWith("current_record_blocked:")) || reviewed.some((record) => record.current && record.verdict === "blocked"));
  const verdict = failed ? "fail" : blocked ? "blocked" : "pass";
  return {
    ok: verdict === "pass",
    verdict,
    truth: verdict === "pass" ? "proven" : verdict === "blocked" ? "insufficient" : "rejected",
    schema: STALENESS_SCHEMA,
    contractVersion: STALENESS_CONTRACT_VERSION,
    current,
    maxAgeMs: options.maxAgeMs,
    maxClockSkewMs: options.maxClockSkewMs,
    secret_values_returned: false,
    findings: codes,
    requirements,
    records: reviewed,
  };
}

export { STALENESS_CONTRACT_VERSION, STALENESS_SCHEMA };
