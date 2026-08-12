import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { validateReleaseSha } from "./path-policy.mjs";

export const CANDIDATE_REQUIRED_GATES = Object.freeze([
  "source-integrity",
  "dependency-locks",
  "serena-config",
  "test-suite",
  "registry-and-docs-drift",
  "hp-mha-merkle",
  "mcp-hermes3d-locks",
  "mcp-hp-mha-serena",
  "secrets-and-sbom"
]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(stable(value));
}

function digest(value) {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function redactValue(value, secrets) {
  let encoded = JSON.stringify(value);
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length > 0) encoded = encoded.split(secret).join("[REDACTED]");
  }
  return JSON.parse(encoded);
}

async function writeJsonAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = file + ".tmp-" + crypto.randomUUID();
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  await fs.rename(temporary, file);
}

export function createReleaseVerifier({
  gates,
  evidenceRoot,
  clock = () => new Date(),
  redact = []
} = {}) {
  if (!gates || typeof gates !== "object") throw new Error("candidate gates are required");
  for (const name of CANDIDATE_REQUIRED_GATES) {
    if (typeof gates[name] !== "function") throw new Error("required candidate gate is missing: " + name);
  }
  if (typeof evidenceRoot !== "string" || !path.isAbsolute(evidenceRoot)) {
    throw new Error("evidenceRoot must be absolute");
  }
  const root = path.resolve(evidenceRoot);

  return async ({ sha, directory, channel = "stable" } = {}) => {
    const candidateSha = validateReleaseSha(sha);
    if (typeof directory !== "string" || !path.isAbsolute(directory)) throw new Error("candidate directory must be absolute");
    const candidateDirectory = path.resolve(directory);
    const gateEvidence = [];
    let failureReason = null;

    for (const name of CANDIDATE_REQUIRED_GATES) {
      let raw;
      try {
        raw = await gates[name]({
          sha: candidateSha,
          directory: candidateDirectory,
          channel
        });
      } catch (error) {
        raw = { ok: false, reason: error.message };
      }
      const result = redactValue(raw ?? { ok: false, reason: "gate returned no result" }, redact);
      const passed = result.ok === true && result.skipped !== true;
      const evidence = {
        name,
        ok: passed,
        skipped: result.skipped === true,
        reason: typeof result.reason === "string" ? result.reason : null,
        details: result.details ?? null
      };
      evidence.digest = digest(evidence);
      gateEvidence.push(evidence);
      if (!passed) {
        const suffix = evidence.skipped
          ? "was skipped"
          : evidence.reason || "failed";
        failureReason = name + ": " + suffix;
        break;
      }
    }

    const baseEvidence = {
      schema: "hermesproof.candidate-evidence.v1",
      sha: candidateSha,
      channel,
      candidateDirectory,
      verifiedUtc: clock().toISOString(),
      ok: failureReason === null,
      reason: failureReason,
      gates: gateEvidence
    };
    const evidenceDigest = digest(baseEvidence);
    const completeEvidence = { ...baseEvidence, evidenceDigest };
    const evidenceFile = path.join(root, candidateSha + ".json");
    const candidateEvidenceFile = path.join(candidateDirectory, ".hermesproof", "candidate-evidence.json");
    await writeJsonAtomic(evidenceFile, completeEvidence);
    await writeJsonAtomic(candidateEvidenceFile, completeEvidence);

    return {
      ok: completeEvidence.ok,
      reason: completeEvidence.reason,
      evidenceDigest,
      evidenceFile,
      candidateEvidenceFile,
      gates: gateEvidence
    };
  };
}
