import path from "node:path";

import { validateGitRef, validateReleaseSha } from "./path-policy.mjs";
import { runProcess } from "./process-runner.mjs";

const DEFAULT_REMOTE = "https://gitlab.com/Ghenghis/HermesProof.git";
const DEFAULT_CHANNELS = Object.freeze({
  stable: "refs/heads/main",
  preview: "refs/heads/release/hp-mha-serena-shippable"
});

export function validateGitLabRemote(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname.toLowerCase() !== "gitlab.com" ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname.includes("%") ||
      !/^\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+\.git$/.test(url.pathname)
    ) {
      throw new Error("invalid");
    }
    return "https://gitlab.com" + url.pathname;
  } catch {
    throw new Error("invalid GitLab remote");
  }
}

function normalizedRemote(remoteUrl, allowLocalForTests) {
  if (allowLocalForTests && path.isAbsolute(remoteUrl || "")) return path.resolve(remoteUrl);
  return validateGitLabRemote(remoteUrl);
}

function protocolArguments(local) {
  return local
    ? ["-c", "protocol.file.allow=always"]
    : ["-c", "protocol.file.allow=never", "-c", "http.followRedirects=false"];
}

export function createGitSource({
  remoteUrl = DEFAULT_REMOTE,
  allowedRemotes = [DEFAULT_REMOTE],
  allowLocalForTests = false,
  channels = DEFAULT_CHANNELS,
  runner = runProcess
} = {}) {
  if (typeof runner !== "function") throw new Error("Git process runner is invalid");
  const remote = normalizedRemote(remoteUrl, allowLocalForTests);
  const allowed = allowedRemotes.map((value) => normalizedRemote(value, allowLocalForTests));
  if (!allowed.includes(remote)) throw new Error("remote is not allowlisted");

  const channelRefs = {};
  for (const [name, ref] of Object.entries(channels || {})) {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error("invalid update channel");
    channelRefs[name] = validateGitRef(ref);
  }
  if (Object.keys(channelRefs).length === 0) throw new Error("at least one update channel is required");
  const local = allowLocalForTests && path.isAbsolute(remote);
  const gitPrefix = protocolArguments(local);

  const resolve = async ({ channel = "stable" } = {}) => {
    const ref = channelRefs[channel];
    if (!ref) throw new Error("unknown update channel");
    const result = await runner({
      command: "git",
      args: [...gitPrefix, "ls-remote", "--exit-code", remote, ref],
      timeoutMs: 60_000,
      maxOutputBytes: 64 * 1024
    });
    const record = result.stdout.trim().split(/\r?\n/).find((line) => line.endsWith("\t" + ref));
    if (!record) throw new Error("update channel did not resolve to an exact ref");
    const sha = validateReleaseSha(record.split(/\s+/)[0]);
    return { sha, ref, remote };
  };

  const stage = async ({ sha, directory, channel = "stable" } = {}) => {
    const candidateSha = validateReleaseSha(sha);
    if (typeof directory !== "string" || !path.isAbsolute(directory)) throw new Error("staging directory must be absolute");
    const current = await resolve({ channel });
    if (current.sha !== candidateSha) throw new Error("channel no longer resolves to candidate SHA");

    await runner({
      command: "git",
      args: [...gitPrefix, "clone", "--no-checkout", remote, path.resolve(directory)],
      timeoutMs: 300_000,
      maxOutputBytes: 2 * 1024 * 1024
    });
    const origin = (await runner({
      command: "git",
      args: ["-C", path.resolve(directory), "remote", "get-url", "origin"]
    })).stdout.trim();
    if (normalizedRemote(origin, allowLocalForTests) !== remote) throw new Error("staged origin does not match allowlisted remote");

    const disabledHooksPath = process.platform === "win32" ? "NUL" : "/dev/null";
    await runner({
      command: "git",
      args: ["-C", path.resolve(directory), "-c", "core.hooksPath=" + disabledHooksPath, "checkout", "--detach", candidateSha],
      timeoutMs: 120_000
    });
    const head = (await runner({
      command: "git",
      args: ["-C", path.resolve(directory), "rev-parse", "HEAD"]
    })).stdout.trim();
    if (head !== candidateSha) throw new Error("staged HEAD does not match candidate SHA");
    const status = (await runner({
      command: "git",
      args: ["-C", path.resolve(directory), "status", "--porcelain=v1", "--untracked-files=all"]
    })).stdout;
    if (status.trim()) throw new Error("staged candidate is not clean");
    return { sha: candidateSha, directory: path.resolve(directory), ref: current.ref, remote };
  };

  return Object.freeze({ remote, channels: Object.freeze({ ...channelRefs }), resolve, stage });
}

export { DEFAULT_CHANNELS as GIT_UPDATE_CHANNELS, DEFAULT_REMOTE as HERMESPROOF_GITLAB_REMOTE };
