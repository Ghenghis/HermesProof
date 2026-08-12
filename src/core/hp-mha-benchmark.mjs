import crypto from "node:crypto";

function extractJson(text) {
  if (typeof text !== "string") return null;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function containsSecretMaterial(value) {
  const text = JSON.stringify(value).toLowerCase();
  return /api[_-]?key|password|bearer\s|["']token["']\s*:|token\s*=/u.test(text);
}

export function scoreKiloBackendPlanResponse(text) {
  const plan = extractJson(text);
  const checks = {
    valid_json: Boolean(plan && typeof plan === "object" && !Array.isArray(plan)),
    pinned_pack: Array.isArray(plan?.pack_ids) && plan.pack_ids.includes("kilo-backend"),
    no_global_install: plan?.global_install === false,
    disabled_after_install: plan?.enable_after_install === false,
    least_privilege:
      Array.isArray(plan?.permissions) &&
      plan.permissions.length > 0 &&
      plan.permissions.every((item) =>
        ["workspace:read", "process:child", "loopback:http"].includes(item)
      ),
    version_probe:
      Array.isArray(plan?.health_probes) &&
      plan.health_probes.includes("kilo --version"),
    rollback: typeof plan?.rollback === "string" && plan.rollback.length >= 10,
    bounded_lease:
      Number.isInteger(plan?.lease?.ttl_seconds) &&
      plan.lease.ttl_seconds > 0 &&
      plan.lease.ttl_seconds <= 300,
    mcp_default_disabled: plan?.mcp?.default_enabled === false,
    no_secret_material: Boolean(plan) && !containsSecretMaterial(plan)
  };
  const passed = Object.values(checks).filter(Boolean).length;
  return {
    score: passed / Object.keys(checks).length,
    passed,
    total: Object.keys(checks).length,
    checks,
    response_sha256: crypto.createHash("sha256").update(String(text)).digest("hex")
  };
}

export function matrixFromMeasuredRuns(runs) {
  if (!Array.isArray(runs) || runs.length !== 4) {
    throw new TypeError("exactly four measured runs are required");
  }
  const cells = {};
  for (const run of runs) {
    if (!["s11", "s12", "s21", "s22"].includes(run?.cell)) {
      throw new TypeError("every measured run requires a unique s11/s12/s21/s22 cell");
    }
    if (cells[run.cell] !== undefined) throw new TypeError("duplicate measured matrix cell");
    if (!Number.isFinite(run.score) || run.score < 0 || run.score > 1) {
      throw new TypeError("measured scores must be within 0..1");
    }
    cells[run.cell] = run.score;
  }
  if (Object.keys(cells).length !== 4) throw new TypeError("all measured matrix cells are required");
  return cells;
}

export function verifyMeasuredMatrixEvidence(evidence) {
  if (!evidence || evidence.schema !== "hermesproof.hp-mha.measured-matrix.v1") {
    throw new TypeError("measured matrix schema is required");
  }
  if (evidence.execution_real !== true) {
    throw new TypeError("measured matrix must record a real execution");
  }
  if (!Array.isArray(evidence.models) || evidence.models.length !== 2 || new Set(evidence.models).size !== 2) {
    throw new TypeError("measured matrix requires two distinct models");
  }
  if (!Number.isInteger(evidence.repetitions_per_cell) || evidence.repetitions_per_cell < 1) {
    throw new TypeError("measured matrix requires at least one repetition per cell");
  }
  const matrix = matrixFromMeasuredRuns(evidence.runs);
  if (JSON.stringify(matrix) !== JSON.stringify(evidence.matrix)) {
    throw new TypeError("measured matrix does not match its run evidence");
  }
  for (const run of evidence.runs) {
    if (!/^[a-f0-9]{64}$/u.test(run.response_sha256 || "")) {
      throw new TypeError("every measured response requires a SHA-256 digest");
    }
    if (!Number.isFinite(run.duration_ms) || run.duration_ms < 0) {
      throw new TypeError("every measured response requires a non-negative duration");
    }
  }
  const { evidence_sha256: claimedDigest, ...payload } = evidence;
  const actualDigest = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  if (claimedDigest !== actualDigest) {
    throw new TypeError("measured matrix evidence digest mismatch");
  }
  return true;
}
