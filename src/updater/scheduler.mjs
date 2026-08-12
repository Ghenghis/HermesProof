import crypto from "node:crypto";

export function deterministicJitterMinutes(machineId, maximumMinutes = 45) {
  if (typeof machineId !== "string" || machineId.length === 0) throw new Error("machineId is required");
  if (!Number.isSafeInteger(maximumMinutes) || maximumMinutes < 0 || maximumMinutes > 240) {
    throw new Error("jitter range is invalid");
  }
  if (maximumMinutes === 0) return 0;
  const value = crypto.createHash("sha256").update(machineId).digest().readUInt32BE(0);
  return value % (maximumMinutes + 1);
}

function insideWindow(hour, window) {
  if (!window) return true;
  const { startHour, endHour } = window;
  if (
    !Number.isInteger(startHour) ||
    !Number.isInteger(endHour) ||
    startHour < 0 ||
    startHour > 23 ||
    endHour < 0 ||
    endHour > 23 ||
    startHour === endHour
  ) {
    throw new Error("maintenance window is invalid");
  }
  return startHour < endHour
    ? hour >= startHour && hour < endHour
    : hour >= startHour || hour < endHour;
}

export function autoUpdateDecision({
  now = new Date(),
  lastAttemptUtc = null,
  cadenceHours = 6,
  jitterMinutes = 45,
  machineId,
  consecutiveFailures = 0,
  maintenanceWindowUtc = null,
  channel = "stable",
  previewAcknowledged = false
} = {}) {
  if (channel === "preview" && !previewAcknowledged) {
    throw new Error("preview channel requires explicit acknowledgement");
  }
  if (!["stable", "preview"].includes(channel)) throw new Error("update channel is invalid");
  if (!Number.isFinite(cadenceHours) || cadenceHours < 1 || cadenceHours > 168) {
    throw new Error("update cadence is invalid");
  }
  if (!Number.isSafeInteger(consecutiveFailures) || consecutiveFailures < 0) {
    throw new Error("failure count is invalid");
  }
  const current = new Date(now);
  if (Number.isNaN(current.getTime())) throw new Error("current time is invalid");
  if (!insideWindow(current.getUTCHours(), maintenanceWindowUtc)) {
    return { due: false, reason: "outside_maintenance_window", channel };
  }
  const jitter = deterministicJitterMinutes(machineId, jitterMinutes);
  const backoffHours = consecutiveFailures === 0 ? 0 : Math.min(2 ** consecutiveFailures, 24);
  const requiredMs = Math.max(
    cadenceHours * 60 * 60 * 1000 + jitter * 60 * 1000,
    backoffHours * 60 * 60 * 1000
  );
  if (!lastAttemptUtc) {
    return { due: true, reason: "never_attempted", channel, jitterMinutes: jitter, backoffHours, missedRun: false };
  }
  const last = new Date(lastAttemptUtc);
  if (Number.isNaN(last.getTime()) || last > current) throw new Error("last attempt time is invalid");
  const elapsedMs = current.getTime() - last.getTime();
  return {
    due: elapsedMs >= requiredMs,
    reason: elapsedMs >= requiredMs ? "due" : "not_due",
    channel,
    jitterMinutes: jitter,
    backoffHours,
    missedRun: elapsedMs >= (cadenceHours + 1) * 60 * 60 * 1000,
    nextEligibleUtc: new Date(last.getTime() + requiredMs).toISOString()
  };
}
