import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const SAFE_ENV = ["PATH", "Path", "SYSTEMROOT", "SystemRoot", "COMSPEC", "ComSpec", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "LANG", "LC_ALL"];

async function sha256File(file) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

function sanitizedEnvironment(workspaceRoot) {
  const env = { MCP_LOCK_WORKSPACE: workspaceRoot, HERMESPROOF_WORKSPACE: workspaceRoot };
  for (const key of SAFE_ENV) if (process.env[key] !== undefined) env[key] = process.env[key];
  return env;
}

export function createLocalProcessAdapter({ workspaceRoot, spawnFn = spawn, stopTimeoutMs = 5000 } = {}) {
  const root = path.resolve(workspaceRoot || "");
  if (!workspaceRoot || !path.isAbsolute(root)) throw new TypeError("absolute workspaceRoot is required");
  const children = new Map();

  async function verify(manifest, lease) {
    if (path.resolve(lease?.workspace || "") !== root) throw new Error("runtime lease workspace mismatch");
    const executable = manifest?.command?.[0];
    if (!executable || !path.isAbsolute(executable)) throw new Error("runtime executable must be an absolute path");
    const stat = await fs.stat(executable);
    if (!stat.isFile()) throw new Error("runtime executable is not a file");
    const actual = await sha256File(executable);
    if (actual !== manifest.executable_sha256) throw new Error("runtime executable digest mismatch");
    if (manifest.entrypoint_sha256) {
      const entrypoint = manifest.command[1];
      if (!entrypoint || !path.isAbsolute(entrypoint)) throw new Error("hashed runtime entrypoint must be absolute");
      if (await sha256File(entrypoint) !== manifest.entrypoint_sha256) throw new Error("runtime entrypoint digest mismatch");
    }
  }

  return {
    async start(manifest, lease) {
      await verify(manifest, lease);
      const existing = children.get(manifest.id);
      if (existing && existing.exitCode === null) return { pid: existing.pid, reused: true };
      const child = spawnFn(manifest.command[0], manifest.command.slice(1), {
        cwd: root,
        env: sanitizedEnvironment(root),
        shell: false,
        windowsHide: true,
        stdio: "ignore"
      });
      await new Promise((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      children.set(manifest.id, child);
      child.once("exit", () => {
        if (children.get(manifest.id) === child) children.delete(manifest.id);
      });
      return { pid: child.pid, reused: false };
    },

    async health(manifest) {
      const child = children.get(manifest.id);
      return { ok: Boolean(child && child.exitCode === null && !child.killed), pid: child?.pid ?? null };
    },

    async stop(manifest) {
      const child = children.get(manifest.id);
      if (!child || child.exitCode !== null) {
        children.delete(manifest.id);
        return { ok: true, stopped: false };
      }
      const waitForExit = () => new Promise((resolve) => {
        if (child.exitCode !== null) return resolve(true);
        let settled = false;
        const finish = (exited) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          child.off("exit", onExit);
          resolve(exited);
        };
        const onExit = () => finish(true);
        const timer = setTimeout(() => finish(false), stopTimeoutMs);
        child.once("exit", onExit);
      });
      child.kill("SIGTERM");
      const graceful = await waitForExit();
      if (!graceful && child.exitCode === null) {
        child.kill("SIGKILL");
        await waitForExit();
      }
      children.delete(manifest.id);
      return { ok: true, stopped: true };
    }
  };
}
