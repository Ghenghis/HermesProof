import fs from "node:fs";
import path from "node:path";

function resolveCandidate(rawPath, cwd) {
  return path.isAbsolute(rawPath) ? rawPath : path.resolve(cwd, rawPath);
}

export function resolveEnvFile({
  env = process.env,
  cwd = process.cwd(),
  existsSync = fs.existsSync,
  onMissing = () => {}
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

  candidates.push({
    source: "cwd.env",
    path: path.resolve(cwd, ".env"),
    explicit: false
  });

  for (const candidate of candidates) {
    if (existsSync(candidate.path)) {
      return candidate.path;
    }
    if (candidate.explicit) {
      onMissing(candidate.source);
    }
  }

  return null;
}
