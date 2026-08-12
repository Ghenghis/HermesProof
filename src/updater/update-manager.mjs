import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { validateReleaseSha } from "./path-policy.mjs";
import { autoUpdateDecision } from "./scheduler.mjs";

const SETTINGS_SCHEMA = "hermesproof.update-settings.v1";

function defaultSettings() {
  return {
    schema: SETTINGS_SCHEMA,
    channel: "stable",
    previewAcknowledged: false,
    auto: {
      enabled: false,
      cadenceHours: 6,
      jitterMinutes: 45,
      maintenanceWindowUtc: null,
      consecutiveFailures: 0,
      lastAttemptUtc: null,
      lastResult: null
    }
  };
}

async function writeJsonAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = file + ".tmp-" + crypto.randomUUID();
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  await fs.rename(temporary, file);
}

export class UpdateManager {
  constructor({
    managedRoot,
    updater,
    scheduler,
    machineId,
    clock = () => new Date()
  } = {}) {
    if (typeof managedRoot !== "string" || !path.isAbsolute(managedRoot)) throw new Error("managedRoot must be absolute");
    for (const name of ["status", "check", "apply", "rollback"]) {
      if (typeof updater?.[name] !== "function") throw new Error("updater." + name + " is required");
    }
    for (const name of ["install", "inspect", "remove"]) {
      if (typeof scheduler?.[name] !== "function") throw new Error("scheduler." + name + " is required");
    }
    if (typeof machineId !== "string" || machineId.length === 0) throw new Error("machineId is required");
    this.root = path.resolve(managedRoot);
    this.updater = updater;
    this.scheduler = scheduler;
    this.machineId = machineId;
    this.clock = clock;
    this.settingsFile = path.join(this.root, "state", "update-settings.json");
    this.evidenceRoot = path.join(this.root, "evidence");
  }

  async settings() {
    try {
      const value = JSON.parse(await fs.readFile(this.settingsFile, "utf8"));
      if (value?.schema !== SETTINGS_SCHEMA || !value.auto || !["stable", "preview"].includes(value.channel)) {
        throw new Error("schema mismatch");
      }
      return value;
    } catch (error) {
      if (error?.code === "ENOENT") return defaultSettings();
      throw new Error("update settings are invalid: " + error.message);
    }
  }

  async saveSettings(value) {
    await writeJsonAtomic(this.settingsFile, value);
    return value;
  }

  async status() {
    const [updaterStatus, settings] = await Promise.all([this.updater.status(), this.settings()]);
    let scheduler = { ok: true, status: "disabled" };
    if (settings.auto.enabled) {
      try {
        scheduler = await this.scheduler.inspect();
      } catch (error) {
        scheduler = { ok: false, status: "error", reason: error.message };
      }
    }
    return {
      ...updaterStatus,
      channel: settings.channel,
      auto: { ...settings.auto, scheduler }
    };
  }

  async check({ channel } = {}) {
    const settings = await this.settings();
    return await this.updater.check({ channel: channel || settings.channel });
  }

  async apply({ channel } = {}) {
    const settings = await this.settings();
    return await this.updater.apply({ channel: channel || settings.channel });
  }

  async rollback() {
    return await this.updater.rollback();
  }

  async channel({ channel, acknowledgePreview = false } = {}) {
    if (!["stable", "preview"].includes(channel)) throw new Error("update channel is invalid");
    if (channel === "preview" && !acknowledgePreview) {
      throw new Error("preview channel requires explicit acknowledgement");
    }
    const settings = await this.settings();
    settings.channel = channel;
    settings.previewAcknowledged = channel === "preview" ? true : false;
    await this.saveSettings(settings);
    return { ok: true, channel, previewAcknowledged: settings.previewAcknowledged };
  }

  async configureAuto({
    enabled,
    cadenceHours = 6,
    jitterMinutes = 45,
    maintenanceWindowUtc = null
  } = {}) {
    if (typeof enabled !== "boolean") throw new Error("auto enabled must be boolean");
    autoUpdateDecision({
      now: this.clock(),
      cadenceHours,
      jitterMinutes,
      machineId: this.machineId,
      maintenanceWindowUtc,
      channel: "stable"
    });
    const schedulerResult = enabled ? await this.scheduler.install() : await this.scheduler.remove();
    const settings = await this.settings();
    settings.auto = {
      ...settings.auto,
      enabled,
      cadenceHours,
      jitterMinutes,
      maintenanceWindowUtc
    };
    await this.saveSettings(settings);
    return { ok: true, auto: settings.auto, scheduler: schedulerResult };
  }

  async auto({ force = false } = {}) {
    const settings = await this.settings();
    if (!settings.auto.enabled) return { ok: true, status: "disabled" };
    const decision = autoUpdateDecision({
      now: this.clock(),
      lastAttemptUtc: settings.auto.lastAttemptUtc,
      cadenceHours: settings.auto.cadenceHours,
      jitterMinutes: settings.auto.jitterMinutes,
      machineId: this.machineId,
      consecutiveFailures: settings.auto.consecutiveFailures,
      maintenanceWindowUtc: settings.auto.maintenanceWindowUtc,
      channel: settings.channel,
      previewAcknowledged: settings.previewAcknowledged
    });
    if (!force && !decision.due) return { ok: true, status: "not_due", decision };

    const result = await this.updater.apply({ channel: settings.channel });
    settings.auto.lastAttemptUtc = this.clock().toISOString();
    settings.auto.lastResult = {
      ok: result.ok === true,
      status: result.status || null,
      reason: result.reason || null
    };
    settings.auto.consecutiveFailures = result.ok === true
      ? 0
      : settings.auto.consecutiveFailures + 1;
    await this.saveSettings(settings);
    return { ...result, automatic: true, decision };
  }

  async cleanup({ retain = 2, dryRun = true } = {}) {
    if (!Number.isSafeInteger(retain) || retain < 2 || retain > 20) throw new Error("retention count is invalid");
    if (typeof this.updater.cleanup !== "function") return { ok: true, status: "unsupported", retain, dryRun };
    return await this.updater.cleanup({ retain, dryRun });
  }

  async evidence({ sha } = {}) {
    const releaseSha = validateReleaseSha(sha);
    const file = path.join(this.evidenceRoot, releaseSha + ".json");
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("evidence file is invalid");
    const value = JSON.parse(await fs.readFile(file, "utf8"));
    if (value?.sha !== releaseSha) throw new Error("evidence SHA binding is invalid");
    return value;
  }
}

export { SETTINGS_SCHEMA as UPDATE_SETTINGS_SCHEMA };
