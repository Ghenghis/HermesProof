import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { makeMutex } from "./mutex.mjs";

const clone = (value) => JSON.parse(JSON.stringify(value));
const DEFAULT_RUNNER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../scripts/automation-runner.mjs");
const STATE_SCHEMA = "hermesproof.automation-state.v1";

function sameWorkspace(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export async function verifyAutomationExecutionAuthorization({
  workspaceRoot,
  stateDirectory = path.join(workspaceRoot, ".hermes3d_orchestrator"),
  jobId,
  now = () => Date.now()
} = {}) {
  const root = path.resolve(workspaceRoot || "");
  const stateRoot = path.resolve(stateDirectory || "");
  if (!workspaceRoot || !path.isAbsolute(root) ||
      (stateRoot !== root && !stateRoot.startsWith(root + path.sep))) {
    throw new Error("automation state directory must stay inside the workspace");
  }
  const automationState = JSON.parse(await fs.readFile(path.join(stateRoot, "automation-state.json"), "utf8"));
  if (automationState.schema !== STATE_SCHEMA || !Array.isArray(automationState.jobs)) {
    throw new Error("automation state is malformed");
  }
  const job = automationState.jobs.find((item) => item?.id === jobId);
  if (!job?.enabled || !job.lease_id || !job.owner || !job.task_id) {
    throw new Error("scheduled automation is not enabled with a persisted authority binding");
  }
  const runtimeState = JSON.parse(await fs.readFile(path.join(stateRoot, "runtime-lifecycle.json"), "utf8"));
  const lease = Array.isArray(runtimeState.leases)
    ? runtimeState.leases.find((item) => item?.id === job.lease_id)
    : null;
  if (!lease || lease.runtime_id !== job.runtime_id || lease.owner !== job.owner ||
      lease.task_id !== job.task_id || lease.status !== "active" ||
      !sameWorkspace(lease.workspace, root) || lease.expires_at_ms <= now()) {
    throw new Error("a matching active runtime lease is required for scheduled execution");
  }
  const task = JSON.parse(await fs.readFile(path.join(stateRoot, "tasks", job.task_id + ".json"), "utf8"));
  if (task?.id !== job.task_id || task?.owner !== job.owner || task?.status !== "claimed") {
    throw new Error("a matching claimed task is required for scheduled execution");
  }
  return {
    ok: true,
    job_id: job.id,
    runtime_id: job.runtime_id,
    lease_id: lease.id,
    owner: lease.owner,
    task_id: lease.task_id
  };
}

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
  constructor({ schedulerAdapter, leaseVerifier, workspaceRoot = process.cwd(), stateDirectory, runnerScript = DEFAULT_RUNNER, nodeExecutable = process.execPath } = {}) {
    this.schedulerAdapter = schedulerAdapter || defaultScheduler();
    this.leaseVerifier = leaseVerifier || (async () => false);
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.stateDirectory = path.resolve(stateDirectory || path.join(this.workspaceRoot, ".hermes3d_orchestrator"));
    this.stateFile = path.join(this.stateDirectory, "automation-state.json");
    this.runnerScript = path.resolve(runnerScript);
    this.nodeExecutable = path.resolve(nodeExecutable);
    this.jobs = new Map();
    this.savedJobs = new Map();
    this.initialized = false;
    this.mutationMutex = makeMutex();
  }

  async init() {
    await fs.mkdir(this.stateDirectory, { recursive: true });
    let state = { schema: STATE_SCHEMA, jobs: [] };
    try {
      state = JSON.parse(await fs.readFile(this.stateFile, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (state.schema !== STATE_SCHEMA || !Array.isArray(state.jobs)) {
      throw new Error("automation state is malformed");
    }
    this.savedJobs = new Map(state.jobs
      .filter((item) => item && typeof item.id === "string")
      .map((item) => [item.id, clone(item)]));
    this.initialized = true;
    return this;
  }

  async persist() {
    if (!this.initialized) return;
    const temporary = this.stateFile + "." + process.pid + ".tmp";
    const state = { schema: STATE_SCHEMA, jobs: [...this.jobs.values()].map(clone) };
    await fs.writeFile(temporary, JSON.stringify(state, null, 2) + "\n", "utf8");
    await fs.rename(temporary, this.stateFile);
  }

  register(job) {
    const clean = validateJob(job);
    if (this.jobs.has(clean.id)) throw new Error("Automation job already exists: " + clean.id);
    const saved = this.savedJobs.get(clean.id);
    if (saved) {
      clean.enabled = saved.enabled === true;
      if (["windows", "linux"].includes(saved.platform)) clean.platform = saved.platform;
      if (typeof saved.lease_id === "string" && saved.lease_id.length > 0) clean.lease_id = saved.lease_id;
      if (typeof saved.owner === "string" && saved.owner.length > 0) clean.owner = saved.owner;
      if (typeof saved.task_id === "string" && saved.task_id.length > 0) clean.task_id = saved.task_id;
      if (typeof saved.disabled_reason === "string") clean.disabled_reason = saved.disabled_reason;
    }
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

  async requireLease(job, leaseId, owner) {
    const valid = await this.leaseVerifier({
      runtimeId: job.runtime_id,
      leaseId,
      owner,
      workspace: this.workspaceRoot
    });
    if (!valid || typeof valid !== "object" || valid.owner !== owner ||
        typeof valid.task_id !== "string" || valid.task_id.length === 0) {
      throw new Error("A matching active runtime lease is required");
    }
    return valid;
  }

  async enableUnlocked({ jobId, platform, leaseId, owner } = {}) {
    const job = this.job(jobId);
    const lease = await this.requireLease(job, leaseId, owner);
    const previous = clone(job);
    job.platform = platform;
    job.lease_id = leaseId;
    job.owner = lease?.owner || owner;
    job.task_id = lease?.task_id;
    const plan = this.plan({ jobId, platform });
    try {
      await this.schedulerAdapter.enable({ ...plan, mutates_system: true });
    } catch (error) {
      Object.assign(job, previous);
      throw error;
    }
    job.enabled = true;
    delete job.disabled_reason;
    await this.persist();
    return { ok: true, job: clone(job) };
  }

  async enable(args = {}) {
    return this.mutationMutex(() => this.enableUnlocked(args));
  }

  async disableUnlocked({ jobId, platform } = {}) {
    const job = this.job(jobId);
    const selectedPlatform = platform || job.platform;
    if (!selectedPlatform) return { ok: true, job: clone(job) };
    const plan = this.plan({ jobId, platform: selectedPlatform });
    await this.schedulerAdapter.disable({ ...plan, mutates_system: true });
    job.enabled = false;
    job.lease_id = null;
    job.owner = null;
    job.task_id = null;
    await this.persist();
    return { ok: true, job: clone(job) };
  }

  async disable(args = {}) {
    return this.mutationMutex(() => this.disableUnlocked(args));
  }

  async cycle(args = {}) {
    return this.mutationMutex(async () => {
      const job = this.job(args.jobId);
      await this.requireLease(job, args.leaseId, args.owner);
      await this.disableUnlocked(args);
      return this.enableUnlocked(args);
    });
  }

  async killSwitch({ reason = "" } = {}) {
    return this.mutationMutex(async () => {
      let disabled = 0;
      const failures = [];
      for (const job of this.jobs.values()) {
        if (!job.enabled && !job.platform) continue;
        try {
          await this.disableUnlocked({ jobId: job.id, platform: job.platform });
          job.disabled_reason = reason;
          disabled += 1;
        } catch (error) {
          failures.push({ job_id: job.id, error: error?.message || String(error) });
        }
      }
      await this.persist();
      return { ok: failures.length === 0, disabled, failures, reason };
    });
  }

  status() {
    return { ok: true, jobs: [...this.jobs.values()].map(clone) };
  }
}
