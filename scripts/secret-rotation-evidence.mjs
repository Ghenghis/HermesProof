/**
 * secret-rotation-evidence — metadata-only check that the configured
 * Hermes3D env file has been rotated within HERMES_SECRET_MAX_AGE_DAYS.
 *
 * IMPORTANT: this module never reads the env file's contents. It only
 * calls fs.stat to inspect the mtime. The env file lives outside every
 * repo workspace (G:\private\.env on Windows, ~/.config/hermes/env
 * elsewhere) so reading it from a CI workspace would be a security
 * violation; we only check metadata (mtime).
 *
 * Resolution order (first existing path wins):
 *   1. HERMES3D_VPS_ENV_FILE  (only when HERMES3D_PROFILE=vps)
 *   2. HERMES3D_ENV_FILE
 *   3. Platform default: G:\private\.env on win32, ~/.config/hermes/env elsewhere
 *
 * Outcomes:
 *   - ok:true             -> env file exists and mtime within max age
 *   - ok:false (warn)     -> env file exists but mtime is stale (rotation overdue)
 *   - ok:true (warn-not_applicable) -> env file path resolved but not present
 *   - ok:false (warn)     -> stat error other than ENOENT
 *
 * The gate is wired into truth-gates as `secrets.rotation_evidence_present`.
 * It is a "warn"-level gate (not "required") because:
 *   - CI runners don't have access to G:\private\.env
 *   - users may legitimately have rotated keys but not yet copied them
 *     to the configured path
 * The intent is to surface an honest evidence record, not to block CI.
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const DEFAULT_MAX_AGE_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Resolve the env-file path for rotation-evidence purposes.
 *
 * This is an explicit standalone resolver so the gate is independent of
 * src/core/env-file.mjs (which is geared toward dotenv loading and falls
 * through to cwd/.env — undesirable for a security gate that must check
 * a specific operator-managed file). We accept the same env vars but
 * fall back to a platform-specific default that lives outside every repo.
 *
 * @returns {{ source: string, candidate: string }}
 */
export function resolveEnvFilePath({
  env = process.env,
  platform = process.platform,
  homedir = os.homedir
} = {}) {
  const profile = (env.HERMES3D_PROFILE || "").toLowerCase();

  if (profile === "vps" && env.HERMES3D_VPS_ENV_FILE) {
    return { source: "HERMES3D_VPS_ENV_FILE", candidate: env.HERMES3D_VPS_ENV_FILE };
  }
  if (env.HERMES3D_ENV_FILE) {
    return { source: "HERMES3D_ENV_FILE", candidate: env.HERMES3D_ENV_FILE };
  }
  if (platform === "win32") {
    return { source: "default.win32", candidate: "G:\\private\\.env" };
  }
  return { source: "default.posix", candidate: path.join(homedir(), ".config", "hermes", "env") };
}

/**
 * Inspect the configured env file's mtime and decide whether rotation
 * evidence is fresh enough.
 *
 * Returns a structured outcome — never throws (caller decides whether
 * to mark required/warn/skipped on the truth-gate row).
 *
 * Outcome shape:
 *   {
 *     ok: boolean,                // overall pass/fail
 *     reason: string,              // short machine-readable code
 *     evidence: {
 *       env_source: string,
 *       env_candidate: string,
 *       env_present: boolean,
 *       mtime_iso: string|null,    // ISO timestamp (no contents)
 *       age_days: number|null,
 *       max_age_days: number
 *     },
 *     details: string              // human readable
 *   }
 */
export async function checkSecretRotationEvidence({
  env = process.env,
  platform = process.platform,
  homedir = os.homedir,
  stat = fs.stat,
  now = () => Date.now()
} = {}) {
  // Parse max age once. Accept positive integers; otherwise fall back.
  let maxAgeDays = DEFAULT_MAX_AGE_DAYS;
  const raw = env.HERMES_SECRET_MAX_AGE_DAYS;
  if (raw !== undefined && raw !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      maxAgeDays = parsed;
    }
  }

  const { source, candidate } = resolveEnvFilePath({ env, platform, homedir });

  let st;
  try {
    st = await stat(candidate);
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return {
        ok: true, // not_applicable -> WARN row but ok=true so it doesn't fail
        reason: "env_file_missing",
        evidence: {
          env_source: source,
          env_candidate: candidate,
          env_present: false,
          mtime_iso: null,
          age_days: null,
          max_age_days: maxAgeDays
        },
        details: `env file not present at ${redactCandidate(candidate)} (source=${source}); rotation gate not_applicable`
      };
    }
    return {
      ok: false,
      reason: "stat_error",
      evidence: {
        env_source: source,
        env_candidate: candidate,
        env_present: false,
        mtime_iso: null,
        age_days: null,
        max_age_days: maxAgeDays
      },
      details: `stat(${redactCandidate(candidate)}) failed: ${err && err.code ? err.code : err && err.message}`
    };
  }

  const mtimeMs = typeof st.mtimeMs === "number" ? st.mtimeMs : (st.mtime?.getTime?.() || 0);
  const ageMs = Math.max(0, now() - mtimeMs);
  const ageDays = ageMs / MS_PER_DAY;
  const mtimeIso = new Date(mtimeMs).toISOString();
  const ok = ageDays <= maxAgeDays;

  return {
    ok,
    reason: ok ? "fresh" : "stale",
    evidence: {
      env_source: source,
      env_candidate: candidate,
      env_present: true,
      mtime_iso: mtimeIso,
      age_days: Number(ageDays.toFixed(2)),
      max_age_days: maxAgeDays
    },
    details: ok
      ? `env mtime ${mtimeIso} (age ${ageDays.toFixed(1)}d <= max ${maxAgeDays}d)`
      : `env mtime ${mtimeIso} stale: age ${ageDays.toFixed(1)}d > max ${maxAgeDays}d`
  };
}

// Redact only the directory portion of the candidate path so PROOF/latest.json
// and logs don't bake in a full operator filesystem layout. Keep the leaf so
// the report is still actionable.
function redactCandidate(p) {
  const norm = String(p).replace(/\\/g, "/");
  const parts = norm.split("/");
  if (parts.length <= 2) return p;
  return `…/${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

export const _internal = { redactCandidate, DEFAULT_MAX_AGE_DAYS };
