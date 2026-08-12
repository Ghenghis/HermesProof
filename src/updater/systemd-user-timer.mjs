import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { runProcess } from "./process-runner.mjs";

const SERVICE_NAME = "hermesproof-update.service";
const TIMER_NAME = "hermesproof-update.timer";

function systemdArgument(value) {
  if (typeof value !== "string" || value.length === 0 || /[\r\n\0]/.test(value)) {
    throw new Error("systemd command argument is invalid");
  }
  return /\s/.test(value) ? "\"" + value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + "\"" : value;
}

function canonicalCommandPath(value) {
  return value.startsWith("/") ? path.posix.normalize(value) : path.resolve(value);
}

async function writeAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = file + ".tmp-" + crypto.randomUUID();
  await fs.writeFile(temporary, value, { encoding: "utf8", flag: "wx" });
  await fs.rename(temporary, file);
}

export function createSystemdUserTimer({
  nodePath,
  updaterScript,
  unitDirectory,
  runner = runProcess
} = {}) {
  for (const [name, value] of Object.entries({ nodePath, updaterScript, unitDirectory })) {
    if (typeof value !== "string" || !path.isAbsolute(value)) throw new Error(name + " must be absolute");
  }
  if (typeof runner !== "function") throw new Error("systemd runner is invalid");
  const directory = path.resolve(unitDirectory);
  const serviceFile = path.join(directory, SERVICE_NAME);
  const timerFile = path.join(directory, TIMER_NAME);
  const service = [
    "[Unit]",
    "Description=HermesProof verified automatic update",
    "After=network-online.target",
    "",
    "[Service]",
    "Type=oneshot",
    "ExecStart=" + [
      systemdArgument(canonicalCommandPath(nodePath)),
      systemdArgument(canonicalCommandPath(updaterScript)),
      "auto",
      "--json"
    ].join(" "),
    "NoNewPrivileges=true",
    "PrivateTmp=true",
    "",
    "[Install]",
    "WantedBy=default.target",
    ""
  ].join("\n");
  const timer = [
    "[Unit]",
    "Description=Check whether a HermesProof update is due",
    "",
    "[Timer]",
    "OnBootSec=10m",
    "OnUnitActiveSec=1h",
    "Persistent=true",
    "Unit=" + SERVICE_NAME,
    "",
    "[Install]",
    "WantedBy=timers.target",
    ""
  ].join("\n");

  return Object.freeze({
    async install() {
      await writeAtomic(serviceFile, service);
      await writeAtomic(timerFile, timer);
      await runner({ command: "systemctl", args: ["--user", "daemon-reload"], timeoutMs: 30_000 });
      await runner({
        command: "systemctl",
        args: ["--user", "enable", "--now", TIMER_NAME],
        timeoutMs: 30_000
      });
      return { ok: true, status: "installed", timer: TIMER_NAME, unitDirectory: directory };
    },
    async inspect() {
      const result = await runner({
        command: "systemctl",
        args: ["--user", "status", TIMER_NAME, "--no-pager"],
        timeoutMs: 30_000,
        maxOutputBytes: 256 * 1024
      });
      return { ok: true, status: "installed", timer: TIMER_NAME, details: result.stdout };
    },
    async remove() {
      await runner({
        command: "systemctl",
        args: ["--user", "disable", "--now", TIMER_NAME],
        timeoutMs: 30_000
      }).catch(() => {});
      await fs.rm(serviceFile, { force: true });
      await fs.rm(timerFile, { force: true });
      await runner({ command: "systemctl", args: ["--user", "daemon-reload"], timeoutMs: 30_000 });
      return { ok: true, status: "removed", timer: TIMER_NAME };
    }
  });
}

export { SERVICE_NAME as SYSTEMD_UPDATE_SERVICE, TIMER_NAME as SYSTEMD_UPDATE_TIMER };
