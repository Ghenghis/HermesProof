import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createSystemSchedulerAdapter } from "./system-scheduler-adapter.mjs";

test("system scheduler adapter executes exact Windows plan and disables without shell", async () => {
  const calls = [];
  const adapter = createSystemSchedulerAdapter({ execFileFn: async (file, args) => calls.push([file, args]) });
  const plan = { adapter: "windows-task-scheduler", executable: "schtasks.exe", arguments: ["/Create", "/TN", "HermesProof-deep-doctor"], task_name: "HermesProof-deep-doctor" };
  await adapter.enable(plan);
  await adapter.disable(plan);
  assert.deepEqual(calls[0], ["schtasks.exe", plan.arguments]);
  assert.deepEqual(calls[1], ["schtasks.exe", ["/Change", "/TN", plan.task_name, "/DISABLE"]]);
});

test("system scheduler adapter writes and controls user systemd units", async () => {
  const unitDir = await fs.mkdtemp(path.join(os.tmpdir(), "hp-units-"));
  const calls = [];
  const adapter = createSystemSchedulerAdapter({ execFileFn: async (file, args) => calls.push([file, args]), userUnitDir: unitDir });
  const plan = { adapter: "systemd-timer", service_name: "hermesproof-deep-doctor.service", timer_name: "hermesproof-deep-doctor.timer", service_unit: "[Service]\nType=oneshot\n", timer_unit: "[Timer]\nOnUnitActiveSec=15min\n" };
  try {
    await adapter.enable(plan);
    assert.equal((await fs.stat(path.join(unitDir, plan.service_name))).isFile(), true);
    assert.deepEqual(calls.at(-1), ["systemctl", ["--user", "enable", "--now", plan.timer_name]]);
    await adapter.disable(plan);
    assert.deepEqual(calls.at(-1), ["systemctl", ["--user", "disable", "--now", plan.timer_name]]);
  } finally {
    await fs.rm(unitDir, { recursive: true, force: true });
  }
});
