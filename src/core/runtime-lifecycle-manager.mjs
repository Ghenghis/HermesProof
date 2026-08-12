import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_STATE = { schema: "hermesproof.runtime-lifecycle.v1", runtimes: [], leases: [] };
const clone = (value) => JSON.parse(JSON.stringify(value));

function assertId(value, label) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._-]*$/i.test(value)) {
    throw new TypeError(label + " must be a stable identifier");
  }
}

function sameWorkspace(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function defaultAdapter() {
  const unavailable = async () => {
    throw new Error("No process adapter is configured; runtime mutation is fail-closed");
  };
  return { start: unavailable, stop: unavailable, health: unavailable };
}

export class RuntimeLifecycleManager {
  constructor({ workspaceRoot, processAdapter, now = () => Date.now() } = {}) {
    if (typeof workspaceRoot !== "string" || workspaceRoot.length === 0) {
      throw new TypeError("workspaceRoot is required");
    }
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.stateFile = path.join(this.workspaceRoot, ".hermes3d_orchestrator", "runtime-lifecycle.json");
    this.processAdapter = processAdapter || defaultAdapter();
    this.now = now;
    this.state = clone(DEFAULT_STATE);
    this.initialized = false;
  }

  async init() {
    await fs.mkdir(path.dirname(this.stateFile), { recursive: true });
    try {
      this.state = JSON.parse(await fs.readFile(this.stateFile, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      this.state = clone(DEFAULT_STATE);
    }
    this.state.runtimes = Array.isArray(this.state.runtimes) ? this.state.runtimes : [];
    this.state.leases = Array.isArray(this.state.leases) ? this.state.leases : [];
    for (const runtime of this.state.runtimes) {
      runtime.enabled = false;
      runtime.pid = null;
      runtime.active_lease_id = null;
    }
    this.initialized = true;
    await this.persist();
    return this;
  }

  assertInitialized() {
    if (!this.initialized) throw new Error("RuntimeLifecycleManager.init() must complete before use");
  }

  async persist() {
    const temporary = this.stateFile + "." + process.pid + ".tmp";
    await fs.writeFile(temporary, JSON.stringify(this.state, null, 2) + "\n", "utf8");
    await fs.rename(temporary, this.stateFile);
  }

  validateManifest(manifest) {
    if (!manifest || typeof manifest !== "object") throw new TypeError("runtime manifest is required");
    assertId(manifest.id, "runtime id");
    if (!Array.isArray(manifest.command) || manifest.command.length === 0 ||
        manifest.command.some((part) => typeof part !== "string" || part.length === 0)) {
      throw new TypeError("runtime command must be a non-empty string array");
    }
    if (!/^[a-f0-9]{64}$/i.test(manifest.executable_sha256 || "")) {
      throw new TypeError("runtime executable_sha256 must be a SHA-256 digest");
    }
    if (!Array.isArray(manifest.tools) || !Array.isArray(manifest.permissions)) {
      throw new TypeError("runtime tools and permissions must be arrays");
    }
    return clone(manifest);
  }

  async register(manifest) {
    this.assertInitialized();
    const clean = this.validateManifest(manifest);
    const existing = this.state.runtimes.find((item) => item.id === clean.id);
    const conflicting = this.state.runtimes.find((item) =>
      item.id !== clean.id && item.manifest.tools.some((tool) => clean.tools.includes(tool))
    );
    if (conflicting) throw new Error("Tool collision: " + clean.id + " overlaps " + conflicting.id);
    const runtime = {
      id: clean.id,
      manifest: clean,
      enabled: false,
      pid: null,
      generation: existing?.generation || 0,
      active_lease_id: null,
      registered_at_ms: existing?.registered_at_ms || this.now()
    };
    if (existing) Object.assign(existing, runtime);
    else this.state.runtimes.push(runtime);
    await this.persist();
    return { ok: true, runtime: clone(runtime) };
  }

  runtimeById(runtimeId) {
    const runtime = this.state.runtimes.find((item) => item.id === runtimeId);
    if (!runtime) throw new Error("Unknown runtime: " + runtimeId);
    return runtime;
  }

  leaseForPrincipal(leaseId, { workspace, owner } = {}) {
    if (typeof workspace !== "string" || workspace.length === 0 ||
        typeof owner !== "string" || owner.length === 0) {
      throw new Error("A matching active runtime lease is required");
    }
    const lease = this.state.leases.find((item) => item.id === leaseId);
    if (!lease || lease.owner !== owner || !sameWorkspace(lease.workspace, workspace)) {
      throw new Error("A matching active runtime lease is required");
    }
    return lease;
  }

  activeLease(leaseId, runtimeId, principal) {
    const lease = this.leaseForPrincipal(leaseId, principal);
    if (lease.runtime_id !== runtimeId || lease.status !== "active" ||
        lease.expires_at_ms <= this.now()) {
      throw new Error("A matching active runtime lease is required");
    }
    return lease;
  }

  async issueLease({ runtimeId, workspace, owner, taskId, permissions, ttlMs } = {}) {
    this.assertInitialized();
    const runtime = this.runtimeById(runtimeId);
    if (![workspace, owner, taskId].every((value) => typeof value === "string" && value.length > 0)) {
      throw new TypeError("workspace, owner, and taskId are required");
    }
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new TypeError("ttlMs must be positive");
    if (!Array.isArray(permissions) ||
        permissions.some((permission) => !runtime.manifest.permissions.includes(permission))) {
      throw new Error("Lease permissions exceed the runtime manifest");
    }
    const lease = {
      id: "lease_" + crypto.randomBytes(12).toString("hex"),
      runtime_id: runtimeId,
      workspace,
      owner,
      task_id: taskId,
      permissions: [...permissions],
      issued_at_ms: this.now(),
      expires_at_ms: this.now() + ttlMs,
      status: "active"
    };
    this.state.leases.push(lease);
    await this.persist();
    return { ok: true, lease: clone(lease) };
  }

  async startRuntime(runtime, lease) {
    const started = await this.processAdapter.start(clone(runtime.manifest), clone(lease));
    runtime.enabled = true;
    runtime.pid = started?.pid ?? null;
    runtime.active_lease_id = lease.id;
    runtime.generation += 1;
    try {
      const health = await this.processAdapter.health(clone(runtime.manifest), clone(lease));
      if (!health?.ok) throw new Error("Runtime health probe failed");
      runtime.health = clone(health);
    } catch (error) {
      await this.processAdapter.stop(clone(runtime.manifest), clone(lease)).catch(() => {});
      runtime.enabled = false;
      runtime.pid = null;
      runtime.active_lease_id = null;
      throw error;
    }
  }

  async enable({ runtimeId, leaseId, workspace, owner } = {}) {
    this.assertInitialized();
    const runtime = this.runtimeById(runtimeId);
    const lease = this.activeLease(leaseId, runtimeId, { workspace, owner });
    if (runtime.enabled && runtime.active_lease_id !== lease.id) {
      throw new Error("The active lease owns the runtime; revoke or expire it before another lease can enable the runtime");
    }
    if (!runtime.enabled) await this.startRuntime(runtime, lease);
    await this.persist();
    return { ok: true, runtime: clone(runtime) };
  }

  async stopRuntime(runtime, lease = null) {
    if (runtime.enabled) {
      await this.processAdapter.stop(clone(runtime.manifest), lease ? clone(lease) : null);
    }
    runtime.enabled = false;
    runtime.pid = null;
    runtime.active_lease_id = null;
  }

  async cycle({ runtimeId, leaseId, workspace, owner } = {}) {
    this.assertInitialized();
    const runtime = this.runtimeById(runtimeId);
    const lease = this.activeLease(leaseId, runtimeId, { workspace, owner });
    if (runtime.enabled && runtime.active_lease_id !== lease.id) {
      throw new Error("The active lease owns the runtime; revoke or expire it before another lease can cycle the runtime");
    }
    await this.stopRuntime(runtime, lease);
    await this.startRuntime(runtime, lease);
    await this.persist();
    return { ok: true, runtime: clone(runtime) };
  }

  async revokeLease({ leaseId, workspace, owner } = {}) {
    this.assertInitialized();
    const lease = this.leaseForPrincipal(leaseId, { workspace, owner });
    lease.status = "revoked";
    lease.revoked_at_ms = this.now();
    const runtime = this.state.runtimes.find((item) => item.active_lease_id === leaseId);
    if (runtime) await this.stopRuntime(runtime, lease);
    await this.persist();
    return { ok: true, lease: clone(lease) };
  }

  async disableUnused() {
    this.assertInitialized();
    const disabled = [];
    for (const runtime of this.state.runtimes) {
      if (!runtime.enabled) continue;
      const lease = this.state.leases.find((item) =>
        item.id === runtime.active_lease_id && item.status === "active" &&
        item.expires_at_ms > this.now()
      );
      if (!lease) {
        await this.stopRuntime(runtime);
        disabled.push(runtime.id);
      }
    }
    await this.persist();
    return { ok: true, disabled };
  }

  async status({ workspace, owner } = {}) {
    this.assertInitialized();
    if (workspace === undefined && owner === undefined) {
      return { ok: true, runtimes: clone(this.state.runtimes), leases: clone(this.state.leases) };
    }
    if (typeof workspace !== "string" || workspace.length === 0 ||
        typeof owner !== "string" || owner.length === 0) {
      throw new Error("workspace and owner are required to scope runtime status");
    }
    const leases = this.state.leases.filter((lease) =>
      lease.owner === owner && sameWorkspace(lease.workspace, workspace)
    );
    const visibleLeaseIds = new Set(leases.map((lease) => lease.id));
    const runtimes = clone(this.state.runtimes).map((runtime) => ({
      ...runtime,
      active_lease_id: visibleLeaseIds.has(runtime.active_lease_id) ? runtime.active_lease_id : null
    }));
    return { ok: true, runtimes, leases: clone(leases) };
  }
}
