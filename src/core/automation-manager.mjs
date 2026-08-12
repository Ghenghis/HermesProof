import path from "node:path";
import { fileURLToPath } from "node:url";

const clone = (value) => JSON.parse(JSON.stringify(value));
const DEFAULT_RUNNER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../scripts/automation-runner.mjs");

function quoted(value) {
  const text = String(value);
  if (/["\r\n]/u.test(text)) throw new TypeError("scheduler paths cannot contain quotes or newlines");
  return "\"" + text + "\"";
}

function defaultScheduler() {
  const unavailable = async () => {
    throw new Error("No scheduler adapter is configured; system mutation is fail-closed");
  };
  return { enable: unavailable, disable: unavailable };
}

function validateJob(job) {
  if (!job || typeof job !== "object") throw new TypeError("automation job is required");
  if (typeof job.id !== "string" || !/^[a-z0-9][a-z0-9._-]*$/i.test(job.id)) {
    throw new TypeError("automation job id is invalid");
  }
  if (!Number.isInteger(job.interval_minutes) || job.interval_minutes < 1) {
    throw new TypeError("automation interval must be at least one minute");
  }
  if (typeof job.action !== "string" || !/^[a-z][a-z0-9._-]*$/i.test(job.action) ||
      /(token|secret|password|key=|--)/i.test(job.action)) {
    throw new TypeError("automation action must be a safe registered recipe without secrets");
  }
  if (typeof job.runtime_id !== "string" || job.runtime_id.length === 0) {
    throw new TypeError("automation runtime_id is required");
  }
  return { ...clone(job), enabled: false };
}

export class AutomationManager {
  constructor({ schedulerAdapter, leaseVerifier, workspaceRoot = process.cwd(), runnerScript = DEFAULT_RUNNER, nodeExecutable = process.execPath } = {}) {
    this.schedulerAdapter = schedulerAdapter || defaultScheduler();
    this.leaseVerifier = leaseVerifier || (async () => false);
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.runnerScript = path.resolve(runnerScript);
    this.nodeExecutable = path.resolve(nodeExecutable);
    this.jobs = new Map();
  }

  register(job) {
    const clean = validateJob(job);
    if (this.jobs.has(clean.id)) throw new Error("Automation job already exists: " + clean.id);
    this.jobs.set(clean.id, clean);
    return { ok: true, job: clone(clean) };
  }

  job(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error("Unknown automation job: " + jobId);
    return job;
  }

  plan({ jobId, platform } = {}) {
    const job = this.job(jobId);
    const runnerArgs = [this.nodeExecutable, this.runnerScript, "--workspace", this.workspaceRoot, "--job", job.id];
    if (platform === "windows") {
      const taskName = "HermesProof-" + job.id;
      const taskCommand = runnerArgs.map(quoted).join(" ");
      return {
        schema: "hermesproof.automation-plan.v1",
        job_id: job.id,
        adapter: "windows-task-scheduler",
        executable: "schtasks.exe",
        task_name: taskName,
        arguments: ["/Create", "/TN", taskName, "/SC", "MINUTE", "/MO",
          String(job.interval_minutes), "/TR", taskCommand, "/RL", "LIMITED", "/F"],
        mutates_system: false
      };
    }
    if (platform === "linux") {
      const baseName = "hermesproof-" + job.id;
      const execStart = runnerArgs.map(quoted).join(" ");
      return {
        schema: "hermesproof.automation-plan.v1",
        job_id: job.id,
        adapter: "systemd-timer",
        service_name: baseName + ".service",
        timer_name: baseName + ".timer",
        service_unit: "[Unit]\nDescription=HermesProof " + job.id + "\n[Service]\nType=oneshot\nWorkingDirectory=" + quoted(this.workspaceRoot) + "\nExecStart=" + execStart + "\n",
        timer_unit: "[Unit]\nDescription=HermesProof " + job.id + " timer\n[Timer]\nOnBootSec=1min\nOnUnitActiveSec=" + job.interval_minutes + "min\nPersistent=true\n[Install]\nWantedBy=timers.target\n",
        mutates_system: false
      };
    }
    throw new TypeError("platform must be windows or linux");
  }

  async requireLease(job, leaseId) {
    const valid = await this.leaseVerifier({ runtimeId: job.runtime_id, leaseId });
    if (!valid) throw new Error("A matching active runtime lease is required");
  }

  async enable({ jobId, platform, leaseId } = {}) {
    const job = this.job(jobId);
    await this.requireLease(job, leaseId);
    const plan = this.plan({ jobId, platform });
    await this.schedulerAdapter.enable({ ...plan, mutates_system: true });
    job.enabled = true;
    job.platform = platform;
    job.lease_id = leaseId;
    return { ok: true, job: clone(job) };
  }

  async disable({ jobId, platform } = {}) {
    const job = this.job(jobId);
    const selectedPlatform = platform || job.platform;
    if (!selectedPlatform) return { ok: true, job: clone(job) };
    const plan = this.plan({ jobId, platform: selectedPlatform });
    if (job.enabled) await this.schedulerAdapter.disable({ ...plan, mutates_system: true });
    job.enabled = false;
    job.lease_id = null;
    return { ok: true, job: clone(job) };
  }

  async cycle({ jobId, platform, leaseId } = {}) {
    await this.disable({ jobId, platform });
    return this.enable({ jobId, platform, leaseId });
  }

  async killSwitch({ reason = "" } = {}) {
    let disabled = 0;
    for (const job of this.jobs.values()) {
      if (!job.enabled) continue;
      await this.disable({ jobId: job.id, platform: job.platform });
      job.disabled_reason = reason;
      disabled += 1;
    }
    return { ok: true, disabled, reason };
  }

  status() {
    return { ok: true, jobs: [...this.jobs.values()].map(clone) };
  }
}
