import path from "node:path";

import { runProcess } from "./process-runner.mjs";

export const WINDOWS_TASK_NAME = "HermesProof Automatic Update";

function quoted(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\"")) {
    throw new Error("scheduled command path is invalid");
  }
  return "\"" + value + "\"";
}

export function createWindowsTaskScheduler({
  nodePath = process.execPath,
  updaterScript,
  runner = runProcess,
  taskName = WINDOWS_TASK_NAME
} = {}) {
  if (!path.isAbsolute(nodePath || "") || !path.isAbsolute(updaterScript || "")) {
    throw new Error("scheduler paths must be absolute");
  }
  if (typeof runner !== "function") throw new Error("scheduler runner is invalid");
  if (typeof taskName !== "string" || taskName.length === 0) throw new Error("scheduler task name is invalid");
  const action = quoted(path.resolve(nodePath)) + " " + quoted(path.resolve(updaterScript)) + " auto --json";

  return Object.freeze({
    async install() {
      await runner({
        command: "schtasks.exe",
        args: [
          "/Create",
          "/TN", taskName,
          "/SC", "HOURLY",
          "/MO", "1",
          "/TR", action,
          "/RL", "LIMITED",
          "/F"
        ],
        timeoutMs: 30_000,
        maxOutputBytes: 128 * 1024
      });
      return { ok: true, status: "installed", taskName, cadence: "hourly_due-check" };
    },
    async inspect() {
      const result = await runner({
        command: "schtasks.exe",
        args: ["/Query", "/TN", taskName, "/FO", "LIST", "/V"],
        timeoutMs: 30_000,
        maxOutputBytes: 256 * 1024
      });
      return { ok: true, status: "installed", taskName, details: result.stdout };
    },
    async remove() {
      await runner({
        command: "schtasks.exe",
        args: ["/Delete", "/TN", taskName, "/F"],
        timeoutMs: 30_000,
        maxOutputBytes: 128 * 1024
      });
      return { ok: true, status: "removed", taskName };
    }
  });
}
