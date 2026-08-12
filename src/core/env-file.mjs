import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function resolveCandidate(rawPath, cwd) {
  return path.isAbsolute(rawPath) ? rawPath : path.resolve(cwd, rawPath);
}

function defaultEnvFileCandidate({ platform = process.platform, homedir = os.homedir } = {}) {
  if (platform === "win32") {
    return { source: "default.win32", path: "G:\\private\\.env", explicit: false };
  }
  return { source: "default.posix", path: path.join(homedir(), ".config", "hermes", "env"), explicit: false };
}

export function envFileCandidates({
  env = process.env,
  cwd = process.cwd(),
  platform = process.platform,
  homedir = os.homedir
} = {}) {
  const profile = (env.HERMES3D_PROFILE || "").toLowerCase();
  const candidates = [];

  if (profile === "vps" && env.HERMES3D_VPS_ENV_FILE) {
    candidates.push({
      source: "HERMES3D_VPS_ENV_FILE",
      path: resolveCandidate(env.HERMES3D_VPS_ENV_FILE, cwd),
      explicit: true
    });
  }

  if (env.HERMES3D_ENV_FILE) {
    candidates.push({
      source: "HERMES3D_ENV_FILE",
      path: resolveCandidate(env.HERMES3D_ENV_FILE, cwd),
      explicit: true
    });
  }

  candidates.push(defaultEnvFileCandidate({ platform, homedir }));

  candidates.push({
    source: "cwd.env",
    path: path.resolve(cwd, ".env"),
    explicit: false
  });

  return candidates;
}

export function resolveEnvFileCandidate({
  env = process.env,
  cwd = process.cwd(),
  platform = process.platform,
  homedir = os.homedir,
  existsSync = fs.existsSync,
  onMissing = () => {}
} = {}) {
  const candidates = envFileCandidates({ env, cwd, platform, homedir });

  for (const candidate of candidates) {
    if (existsSync(candidate.path)) {
      return candidate;
    }
    if (candidate.explicit) {
      onMissing(candidate.source);
    }
  }

  return null;
}

export function resolveEnvFile(options = {}) {
  return resolveEnvFileCandidate(options)?.path || null;
}
