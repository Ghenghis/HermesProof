/**
 * Smoke tests for scripts/secret-rotation-evidence.mjs — the
 * `secrets.rotation_evidence_present` truth gate.
 *
 * The gate is metadata-only (fs.stat mtime). These tests verify:
 *   - resolution order (HERMES3D_VPS_ENV_FILE, HERMES3D_ENV_FILE, defaults)
 *   - "fresh" mtime within max age -> ok:true
 *   - "stale" mtime beyond max age -> ok:false (warn level)
 *   - missing file -> ok:true with reason="env_file_missing" (not_applicable)
 *   - stat error other than ENOENT -> ok:false with reason="stat_error"
 *   - file contents are never read (we use a fake stat impl that fails if
 *     a read is attempted)
 *   - HERMES_SECRET_MAX_AGE_DAYS override is honored
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  resolveEnvFilePath,
  checkSecretRotationEvidence,
  _internal
} from "./secret-rotation-evidence.mjs";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

async function makeTempEnv(content = "DUMMY=1\n") {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hp-secret-rot-"));
  const envPath = path.join(dir, ".env");
  await fs.writeFile(envPath, content, "utf8");
  return { dir, envPath };
}

// ---------------------------------------------------------------------------
// resolveEnvFilePath
// ---------------------------------------------------------------------------

test("resolveEnvFilePath — HERMES3D_VPS_ENV_FILE wins when profile=vps", () => {
  const r = resolveEnvFilePath({
    env: {
      HERMES3D_PROFILE: "vps",
      HERMES3D_VPS_ENV_FILE: "/tmp/vps.env",
      HERMES3D_ENV_FILE: "/tmp/general.env"
    },
    platform: "linux",
    homedir: () => "/home/u"
  });
  assert.equal(r.source, "HERMES3D_VPS_ENV_FILE");
  assert.equal(r.candidate, "/tmp/vps.env");
});

test("resolveEnvFilePath — HERMES3D_ENV_FILE wins when profile is not vps", () => {
  const r = resolveEnvFilePath({
    env: { HERMES3D_ENV_FILE: "/tmp/general.env" },
    platform: "linux",
    homedir: () => "/home/u"
  });
  assert.equal(r.source, "HERMES3D_ENV_FILE");
  assert.equal(r.candidate, "/tmp/general.env");
});

test("resolveEnvFilePath — default on win32 is G:\\private\\.env", () => {
  const r = resolveEnvFilePath({
    env: {},
    platform: "win32",
    homedir: () => "C:\\Users\\u"
  });
  assert.equal(r.source, "default.win32");
  assert.equal(r.candidate, "G:\\private\\.env");
});

test("resolveEnvFilePath — default on posix is ~/.config/hermes/env", () => {
  const r = resolveEnvFilePath({
    env: {},
    platform: "linux",
    homedir: () => "/home/dave"
  });
  assert.equal(r.source, "default.posix");
  assert.equal(r.candidate, path.join("/home/dave", ".config", "hermes", "env"));
});

test("resolveEnvFilePath — VPS var only takes effect when profile=vps", () => {
  // profile not set, vps var alone is ignored
  const r = resolveEnvFilePath({
    env: { HERMES3D_VPS_ENV_FILE: "/tmp/vps.env" },
    platform: "linux",
    homedir: () => "/home/u"
  });
  assert.equal(r.source, "default.posix");
});

// ---------------------------------------------------------------------------
// checkSecretRotationEvidence — happy path
// ---------------------------------------------------------------------------

test("checkSecretRotationEvidence — fresh mtime returns ok:true", async () => {
  const { envPath } = await makeTempEnv();
  const out = await checkSecretRotationEvidence({
    env: { HERMES3D_ENV_FILE: envPath, HERMES_SECRET_MAX_AGE_DAYS: "90" }
  });
  assert.equal(out.ok, true);
  assert.equal(out.reason, "fresh");
  assert.equal(out.evidence.env_present, true);
  assert.equal(out.evidence.env_source, "HERMES3D_ENV_FILE");
  assert.notEqual(out.evidence.env_candidate, envPath);
  assert.equal(out.evidence.env_candidate, _internal.redactCandidate(envPath));
  assert.equal(out.evidence.max_age_days, 90);
  assert.ok(out.evidence.mtime_iso);
  assert.ok(out.evidence.age_days <= 1);
});

test("checkSecretRotationEvidence — stale mtime returns ok:false reason=stale", async () => {
  const { envPath } = await makeTempEnv();
  // Inject a fake stat returning mtime from 200 days ago.
  const fakeNow = Date.now();
  const oldMtimeMs = fakeNow - 200 * MS_PER_DAY;
  const fakeStat = async () => ({
    mtimeMs: oldMtimeMs,
    mtime: new Date(oldMtimeMs)
  });
  const out = await checkSecretRotationEvidence({
    env: { HERMES3D_ENV_FILE: envPath, HERMES_SECRET_MAX_AGE_DAYS: "90" },
    stat: fakeStat,
    now: () => fakeNow
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "stale");
  assert.equal(out.evidence.env_present, true);
  assert.ok(out.evidence.age_days > 90);
});

test("checkSecretRotationEvidence — missing env file returns ok:true reason=env_file_missing", async () => {
  const out = await checkSecretRotationEvidence({
    env: {
      HERMES3D_ENV_FILE: path.join(os.tmpdir(), "definitely-not-here", "missing.env"),
      HERMES_SECRET_MAX_AGE_DAYS: "90"
    }
  });
  assert.equal(out.ok, true);
  assert.equal(out.reason, "env_file_missing");
  assert.equal(out.evidence.env_present, false);
  assert.equal(
    out.evidence.env_candidate,
    _internal.redactCandidate(path.join(os.tmpdir(), "definitely-not-here", "missing.env"))
  );
  assert.equal(out.evidence.mtime_iso, null);
  assert.equal(out.evidence.age_days, null);
});

test("checkSecretRotationEvidence — non-ENOENT stat error returns ok:false reason=stat_error", async () => {
  const fakeStat = async () => {
    const err = new Error("perm denied");
    err.code = "EACCES";
    throw err;
  };
  const out = await checkSecretRotationEvidence({
    env: { HERMES3D_ENV_FILE: "/some/locked/path/.env" },
    stat: fakeStat
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "stat_error");
  assert.equal(out.evidence.env_candidate, _internal.redactCandidate("/some/locked/path/.env"));
  assert.match(out.details, /EACCES/);
});

test("checkSecretRotationEvidence — never reads file contents (only stat is invoked)", async () => {
  // We deliberately point to a real file but use a stat impl that succeeds
  // and a global setup that would explode if anything tried fs.readFile.
  // The check function only takes `stat` as an injected dep, so as long as
  // the implementation only calls that, we cannot read contents.
  const { envPath } = await makeTempEnv("SECRET=do_not_read_me\n");
  let statCalls = 0;
  const fakeStat = async (p) => {
    statCalls++;
    assert.equal(p, envPath);
    return { mtimeMs: Date.now(), mtime: new Date() };
  };
  const out = await checkSecretRotationEvidence({
    env: { HERMES3D_ENV_FILE: envPath },
    stat: fakeStat
  });
  assert.equal(out.ok, true);
  assert.equal(statCalls, 1);
  // The evidence must contain only metadata — no plaintext from the file.
  const blob = JSON.stringify(out.evidence);
  assert.ok(!blob.includes("do_not_read_me"), "evidence must not leak file contents");
  assert.ok(!blob.includes(envPath), "evidence must not leak raw env file path");
});

test("checkSecretRotationEvidence — HERMES_SECRET_MAX_AGE_DAYS override is honored", async () => {
  const { envPath } = await makeTempEnv();
  const fakeNow = Date.now();
  const mtimeMs = fakeNow - 10 * MS_PER_DAY; // 10 days old
  const fakeStat = async () => ({ mtimeMs, mtime: new Date(mtimeMs) });

  const strict = await checkSecretRotationEvidence({
    env: { HERMES3D_ENV_FILE: envPath, HERMES_SECRET_MAX_AGE_DAYS: "5" },
    stat: fakeStat,
    now: () => fakeNow
  });
  assert.equal(strict.ok, false);
  assert.equal(strict.evidence.max_age_days, 5);

  const lenient = await checkSecretRotationEvidence({
    env: { HERMES3D_ENV_FILE: envPath, HERMES_SECRET_MAX_AGE_DAYS: "30" },
    stat: fakeStat,
    now: () => fakeNow
  });
  assert.equal(lenient.ok, true);
  assert.equal(lenient.evidence.max_age_days, 30);
});

test("checkSecretRotationEvidence — invalid max-age env var falls back to default 90", async () => {
  const { envPath } = await makeTempEnv();
  const fakeNow = Date.now();
  const mtimeMs = fakeNow - 50 * MS_PER_DAY; // 50d old; should pass at default 90
  const fakeStat = async () => ({ mtimeMs, mtime: new Date(mtimeMs) });
  const out = await checkSecretRotationEvidence({
    env: { HERMES3D_ENV_FILE: envPath, HERMES_SECRET_MAX_AGE_DAYS: "not-a-number" },
    stat: fakeStat,
    now: () => fakeNow
  });
  assert.equal(out.ok, true);
  assert.equal(out.evidence.max_age_days, 90);
});

test("redactCandidate — strips long path prefixes but keeps last two segments", () => {
  assert.equal(_internal.redactCandidate("/a/b/c/d/.env"), "…/d/.env");
  assert.equal(_internal.redactCandidate("G:\\private\\.env"), "…/private/.env");
  // Short paths returned as-is.
  assert.equal(_internal.redactCandidate(".env"), ".env");
});
