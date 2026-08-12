import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function atomicWrite(file, text) {
  const temporary = file + "." + process.pid + ".tmp";
  await fs.writeFile(temporary, text, "utf8");
  await fs.rename(temporary, file);
}

export function createSystemSchedulerAdapter({ execFileFn = execFileAsync, userUnitDir = path.join(os.homedir(), ".config", "systemd", "user") } = {}) {
  return {
    async enable(plan) {
      if (plan.adapter === "windows-task-scheduler") {
        if (plan.executable !== "schtasks.exe" || !Array.isArray(plan.arguments) || !plan.task_name) {
          throw new Error("invalid Windows scheduler plan");
        }
        await execFileFn(plan.executable, plan.arguments, { windowsHide: true, timeout: 30_000 });
        return { ok: true, adapter: plan.adapter, task_name: plan.task_name };
      }
      if (plan.adapter === "systemd-timer") {
        if (!/^[a-z0-9._-]+\.service$/iu.test(plan.service_name || "") || !/^[a-z0-9._-]+\.timer$/iu.test(plan.timer_name || "")) {
          throw new Error("invalid systemd scheduler plan");
        }
        await fs.mkdir(userUnitDir, { recursive: true });
        await atomicWrite(path.join(userUnitDir, plan.service_name), plan.service_unit);
        await atomicWrite(path.join(userUnitDir, plan.timer_name), plan.timer_unit);
        await execFileFn("systemctl", ["--user", "daemon-reload"], { timeout: 30_000 });
        await execFileFn("systemctl", ["--user", "enable", "--now", plan.timer_name], { timeout: 30_000 });
        return { ok: true, adapter: plan.adapter, timer_name: plan.timer_name };
      }
      throw new Error("unsupported scheduler adapter");
    },

    async disable(plan) {
      if (plan.adapter === "windows-task-scheduler") {
        if (!plan.task_name) throw new Error("Windows task name is required");
        await execFileFn("schtasks.exe", ["/End", "/TN", plan.task_name], { windowsHide: true, timeout: 30_000 }).catch(() => {});
        await execFileFn("schtasks.exe", ["/Change", "/TN", plan.task_name, "/DISABLE"], { windowsHide: true, timeout: 30_000 });
        return { ok: true, disabled: plan.task_name };
      }
      if (plan.adapter === "systemd-timer") {
        if (!plan.timer_name) throw new Error("systemd timer name is required");
        if (plan.service_name) {
          await execFileFn("systemctl", ["--user", "stop", plan.service_name], { timeout: 30_000 }).catch(() => {});
        }
        await execFileFn("systemctl", ["--user", "disable", "--now", plan.timer_name], { timeout: 30_000 });
        return { ok: true, disabled: plan.timer_name };
      }
      throw new Error("unsupported scheduler adapter");
    }
  };
}
