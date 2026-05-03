import fs from "node:fs/promises";
import path from "node:path";
import {
  addMinutesIso,
  appendChainedJsonLine,
  appendJsonLine,
  ensureDir,
  initStateDirs,
  isExpired,
  lockDirForPath,
  lockMetadataFile,
  normalizeWorkspacePath,
  pathExists,
  readJson,
  safeWorkspaceRoot,
  shaId,
  statePaths,
  utcNow,
  verifyChainedLog,
  writeJsonAtomic
} from "./fs-utils.mjs";
import { EventManager } from "./event-manager.mjs";
import { QueueManager } from "./queue-manager.mjs";
import { makeMutex } from "./mutex.mjs";

const DEFAULT_TTL_MINUTES = 90;
// hermes_doctor is read-only and called frequently by clients (every reconnect,
// every health-check). The actual probe spans 5 syscalls + a write+rm probe; on
// busy worktrees that's measurable. v0.5.1 caches the result for DOCTOR_CACHE_TTL_MS
// per-instance. Cache invalidates on TTL or explicit force_refresh.
const DOCTOR_CACHE_TTL_MS = 30_000;

export class HermesLockManager {
  constructor({ workspaceRoot, stateDirName } = {}) {
    this.workspaceRoot = safeWorkspaceRoot(workspaceRoot);
    this.paths = statePaths(this.workspaceRoot, stateDirName);
    this.stateDirName = this.paths.stateDirName;
    this.eventManager = new EventManager({ workspaceRoot: this.workspaceRoot, stateDirName: this.stateDirName });
    this.queueManager = new QueueManager({
      workspaceRoot: this.workspaceRoot,
      stateDirName: this.stateDirName,
      eventManager: this.eventManager
    });
    this._doctorCache = null; // { result, expiresAt, computedAtMs }
    this._doctorInflight = null; // dedupe concurrent uncached calls
    // Serialize concurrent heartbeat calls — pre-fix, two heartbeats from
    // the same owner could read the same metadata, both push a "heartbeat"
    // history entry, and last-writer-wins on the disk write would drop
    // one entry. The 2026-05-03 audit cross-confirmed this gap.
    this._heartbeatMutex = makeMutex();
  }

  async init() {
    await initStateDirs(this.paths);
    await this.eventManager.init();
    await this.queueManager.init();
    await this.writeDefaultConfig();
    return this.getStateSummary();
  }

  async writeDefaultConfig() {
    if (await pathExists(this.paths.configFile)) return;
    await writeJsonAtomic(this.paths.configFile, {
      name: "MCP Lock Orchestrator",
      workspace_root: this.workspaceRoot,
      state_dir_name: this.stateDirName,
      default_ttl_minutes: DEFAULT_TTL_MINUTES,
      policy: {
        require_task_claim_before_locks: true,
        lock_transaction_order: "sorted normalized paths",
        stale_lock_recovery: "manual tool call only",
        shell_execution: "gate allowlist only"
      },
      created_utc: utcNow()
    });
  }

  getPolicy() {
    return {
      ok: true,
      workspace_root: this.workspaceRoot,
      state_dir: this.paths.stateDir,
      state_dir_name: this.stateDirName,
      default_ttl_minutes: DEFAULT_TTL_MINUTES,
      policy: {
        require_task_claim_before_locks: true,
        lock_transaction_order: "sorted normalized paths",
        atomic_lock_acquisition: true,
        rollback_on_partial_conflict: true,
        stale_lock_recovery: "manual tool call only",
        shell_execution: "gate allowlist only",
        path_escape_protection: true,
        single_tool_serialization: true
      },
      env_vars_used: {
        MCP_LOCK_WORKSPACE: process.env.MCP_LOCK_WORKSPACE || null,
        HERMES3D_WORKSPACE: process.env.HERMES3D_WORKSPACE || null,
        MCP_LOCK_STATE_DIR: process.env.MCP_LOCK_STATE_DIR || null
      }
    };
  }

  async event(type, payload) {
    await appendJsonLine(this.paths.eventsFile, {
      ts_utc: utcNow(),
      type,
      ...payload
    });
    const mapped = mapLegacyEvent(type, payload);
    if (mapped) await this.eventManager.emitEvent(mapped);
  }

  async emitManualEvent(args) {
    return await this.eventManager.emitEvent(args);
  }

  async listEvents(args) {
    return await this.eventManager.listEvents(args);
  }

  async markEventHandled(args) {
    return await this.eventManager.markEventHandled(args);
  }

  async enqueueTask(args) {
    return await this.queueManager.enqueueTask(args);
  }

  async listPendingTasks(args) {
    return await this.queueManager.listPendingTasks(args);
  }

  async pickTask(args) {
    return await this.queueManager.pickTask(args);
  }

  async recoverStaleTasks(args) {
    return await this.queueManager.recoverStaleTasks(args);
  }

  async emitGateEvent({ owner, result }) {
    const report = result?.report || {};
    const ok = result?.ok === true;
    return await this.eventManager.emitEvent({
      event_type: ok ? "gate.passed" : "gate.failed",
      owner,
      task_id: null,
      summary: `${report.gate_id || "gate"}: ${ok ? "PASS" : "FAIL"}`,
      next_actor: ok ? "unassigned" : "claude",
      recommended_action: ok ? "acknowledge" : "fix_scope",
      payload: {
        gate_id: report.gate_id,
        report_id: report.id,
        status: result?.status,
        exit_code: report.exit_code,
        timed_out: report.timed_out
      }
    });
  }

  normalizeFiles(files) {
    if (!Array.isArray(files) || files.length === 0) {
      throw new Error("files must be a non-empty array");
    }
    return [...new Set(files.map((f) => normalizeWorkspacePath(this.workspaceRoot, f)))].sort();
  }

  async claimTask({ owner, role = "agent", taskId, title = "", files = [], reason = "" }) {
    assertOwner(owner);
    const id = taskId || `task_${shaId(`${owner}:${Date.now()}`, 12)}`;
    const taskFile = path.join(this.paths.tasksDir, `${id}.json`);
    const existing = await readJson(taskFile, null);
    if (existing && existing.status !== "released" && existing.owner !== owner) {
      return {
        ok: false,
        status: "blocked",
        message: `task ${id} is already claimed by ${existing.owner}`,
        task: existing
      };
    }

    const normalizedFiles = Array.isArray(files) && files.length ? this.normalizeFiles(files) : [];
    const task = {
      id,
      owner,
      role,
      title,
      status: "claimed",
      files: normalizedFiles,
      reason,
      claimed_utc: existing?.claimed_utc || utcNow(),
      heartbeat_utc: utcNow(),
      released_utc: null
    };
    await writeJsonAtomic(taskFile, task);
    await this.event("task.claimed", { owner, task_id: id, files: normalizedFiles, reason });
    return { ok: true, status: "claimed", task };
  }

  async releaseTask({ owner, taskId, note = "" }) {
    assertOwner(owner);
    assertId(taskId, "taskId");
    const taskFile = path.join(this.paths.tasksDir, `${taskId}.json`);
    const task = await readJson(taskFile, null);
    if (!task) return await this.queueManager.completeTask({ owner, task_id: taskId, note });
    if (task.owner !== owner) {
      return { ok: false, status: "blocked", message: `task belongs to ${task.owner}, not ${owner}` };
    }
    task.status = "released";
    task.released_utc = utcNow();
    task.release_note = note;
    await writeJsonAtomic(taskFile, task);
    await this.event("task.released", { owner, task_id: taskId, note });
    return { ok: true, status: "released", task };
  }

  async lockFiles({ owner, role = "agent", taskId = "", files, reason = "", ttlMinutes = DEFAULT_TTL_MINUTES }) {
    assertOwner(owner);
    const normalizedFiles = this.normalizeFiles(files);
    const ttl = normalizeTtl(ttlMinutes);
    const acquired = [];
    const conflicts = [];

    for (const file of normalizedFiles) {
      const lockDir = lockDirForPath(this.paths, file);
      const metadataFile = lockMetadataFile(lockDir);
      try {
        await fs.mkdir(lockDir, { recursive: false });
        const metadata = this.makeLockMetadata({ owner, role, taskId, file, reason, ttl });
        await writeJsonAtomic(metadataFile, metadata);
        acquired.push({ file, lock_id: metadata.lock_id, owner });
      } catch (err) {
        if (err.code !== "EEXIST") throw err;
        const existing = await readJson(metadataFile, null);
        if (existing && existing.owner === owner) {
          existing.heartbeat_utc = utcNow();
          existing.expires_utc = addMinutesIso(ttl);
          existing.reason = reason || existing.reason;
          existing.task_id = taskId || existing.task_id;
          await writeJsonAtomic(metadataFile, existing);
          acquired.push({ file, lock_id: existing.lock_id, owner, refreshed: true });
          continue;
        }
        conflicts.push({
          file,
          lock_id: existing?.lock_id || shaId(file),
          current_owner: existing?.owner || "unknown",
          current_role: existing?.role || "unknown",
          current_task_id: existing?.task_id || "unknown",
          reason: existing?.reason || "unknown",
          heartbeat_utc: existing?.heartbeat_utc || null,
          expires_utc: existing?.expires_utc || null,
          is_stale: existing?.expires_utc ? isExpired(existing.expires_utc) : false
        });
      }
    }

    if (conflicts.length > 0) {
      await this.releaseFiles({ owner, files: acquired.map((a) => a.file), note: "rollback partial lock acquisition after conflict" });
      await this.event("lock.blocked", { owner, task_id: taskId, conflicts, requested_files: normalizedFiles });
      return {
        ok: false,
        status: "blocked",
        message: "One or more files are locked by another agent. Ask for a handoff before editing.",
        conflicts,
        requested_files: normalizedFiles,
        next_tool: "hermes_request_handoff"
      };
    }

    await this.event("lock.acquired", { owner, task_id: taskId, files: normalizedFiles, reason });
    return { ok: true, status: "locked", locks: acquired, files: normalizedFiles };
  }

  makeLockMetadata({ owner, role, taskId, file, reason, ttl }) {
    const now = utcNow();
    return {
      lock_id: shaId(file),
      file,
      owner,
      role,
      task_id: taskId || null,
      reason,
      acquired_utc: now,
      heartbeat_utc: now,
      expires_utc: addMinutesIso(ttl),
      history: [
        { ts_utc: now, type: "acquired", owner, task_id: taskId || null, reason }
      ]
    };
  }

  async releaseFiles({ owner, files, note = "" }) {
    assertOwner(owner);
    const normalizedFiles = Array.isArray(files) && files.length ? this.normalizeFiles(files) : [];
    const released = [];
    const blocked = [];
    const missing = [];

    for (const file of normalizedFiles) {
      const lockDir = lockDirForPath(this.paths, file);
      const metadataFile = lockMetadataFile(lockDir);
      const metadata = await readJson(metadataFile, null);
      if (!metadata) {
        missing.push(file);
        continue;
      }
      if (metadata.owner !== owner) {
        blocked.push({ file, current_owner: metadata.owner, requested_by: owner });
        continue;
      }
      metadata.history = metadata.history || [];
      metadata.history.push({ ts_utc: utcNow(), type: "released", owner, note });
      await writeJsonAtomic(path.join(this.paths.evidenceDir, `released_${metadata.lock_id}_${Date.now()}.json`), metadata);
      await fs.rm(lockDir, { recursive: true, force: true });
      released.push(file);
    }

    if (released.length) await this.event("lock.released", { owner, files: released, note });
    return {
      ok: blocked.length === 0,
      status: blocked.length ? "partial" : "released",
      released,
      blocked,
      missing
    };
  }

  async heartbeat({ owner, taskId = "" }) {
    assertOwner(owner);
    return this._heartbeatMutex(async () => {
      const locks = await this.listLocks();
      const touched = [];
      for (const lock of locks.locks) {
        if (lock.owner === owner && (!taskId || lock.task_id === taskId)) {
          const lockDir = lockDirForPath(this.paths, lock.file);
          const metadataFile = lockMetadataFile(lockDir);
          const metadata = await readJson(metadataFile, null);
          if (!metadata) continue;
          metadata.heartbeat_utc = utcNow();
          metadata.expires_utc = addMinutesIso(DEFAULT_TTL_MINUTES);
          metadata.history = metadata.history || [];
          metadata.history.push({ ts_utc: utcNow(), type: "heartbeat", owner, task_id: taskId || null });
          await writeJsonAtomic(metadataFile, metadata);
          touched.push(lock.file);
        }
      }
      const touchedTasks = await this.queueManager.heartbeat({ owner, taskId });
      await this.event("heartbeat", { owner, task_id: taskId || null, files: touched });
      return { ok: true, status: "heartbeat", touched, touched_tasks: touchedTasks };
    });
  }

  async listLocks() {
    await initStateDirs(this.paths);
    const entries = await fs.readdir(this.paths.locksDir, { withFileTypes: true }).catch(() => []);
    const locks = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const metadata = await readJson(path.join(this.paths.locksDir, entry.name, "metadata.json"), null);
      if (!metadata) continue;
      locks.push({
        ...metadata,
        is_stale: metadata.expires_utc ? isExpired(metadata.expires_utc) : false
      });
    }
    locks.sort((a, b) => a.file.localeCompare(b.file));
    return { ok: true, workspace_root: this.workspaceRoot, count: locks.length, locks };
  }

  async requestHandoff({ requester, currentOwner, files, reason = "", taskId = "" }) {
    assertOwner(requester);
    assertOwner(currentOwner, "currentOwner");
    const normalizedFiles = this.normalizeFiles(files);
    const locks = await this.listLocks();
    const relevant = locks.locks.filter((l) => normalizedFiles.includes(l.file));
    const invalid = relevant.filter((l) => l.owner !== currentOwner);
    if (invalid.length) {
      return {
        ok: false,
        status: "blocked",
        message: "Some requested files are not owned by currentOwner.",
        invalid
      };
    }
    const id = `handoff_${shaId(`${requester}:${currentOwner}:${normalizedFiles.join("|")}:${Date.now()}`, 16)}`;
    const request = {
      id,
      status: "requested",
      requester,
      current_owner: currentOwner,
      task_id: taskId || null,
      files: normalizedFiles,
      reason,
      requested_utc: utcNow(),
      decision_utc: null,
      decision_note: null
    };
    await writeJsonAtomic(path.join(this.paths.handoffsDir, `${id}.json`), request);
    await this.event("handoff.requested", { request_id: id, requester, current_owner: currentOwner, files: normalizedFiles, reason });
    return { ok: true, status: "requested", handoff: request, next_tool: "hermes_approve_handoff" };
  }

  async approveHandoff({ owner, requestId, decision = "approve", note = "" }) {
    assertOwner(owner);
    assertId(requestId, "requestId");
    if (!["approve", "deny"].includes(decision)) throw new Error("decision must be approve or deny");
    const requestFile = path.join(this.paths.handoffsDir, `${requestId}.json`);
    const request = await readJson(requestFile, null);
    if (!request) return { ok: false, status: "missing", message: `handoff not found: ${requestId}` };
    if (request.current_owner !== owner) {
      return { ok: false, status: "blocked", message: `handoff must be approved by ${request.current_owner}, not ${owner}` };
    }
    if (request.status !== "requested") {
      return { ok: false, status: request.status, message: "handoff already decided", handoff: request };
    }

    request.status = decision === "approve" ? "approved" : "denied";
    request.decision_utc = utcNow();
    request.decision_note = note;

    if (decision === "approve") {
      for (const file of request.files) {
        const lockDir = lockDirForPath(this.paths, file);
        const metadataFile = lockMetadataFile(lockDir);
        const metadata = await readJson(metadataFile, null);
        if (!metadata || metadata.owner !== owner) {
          request.status = "failed_transfer";
          request.decision_note = `lock missing or no longer owned by ${owner}: ${file}`;
          await writeJsonAtomic(requestFile, request);
          return { ok: false, status: "failed_transfer", handoff: request };
        }
        metadata.history = metadata.history || [];
        metadata.history.push({
          ts_utc: utcNow(),
          type: "handoff_approved",
          from: owner,
          to: request.requester,
          request_id: request.id,
          note
        });
        metadata.owner = request.requester;
        metadata.role = "handoff_receiver";
        metadata.task_id = request.task_id || metadata.task_id;
        metadata.heartbeat_utc = utcNow();
        metadata.expires_utc = addMinutesIso(DEFAULT_TTL_MINUTES);
        await writeJsonAtomic(metadataFile, metadata);
      }
    }

    await writeJsonAtomic(requestFile, request);
    await this.event("handoff.decided", { request_id: request.id, owner, decision, files: request.files, note });
    return { ok: true, status: request.status, handoff: request };
  }

  async recoverStaleLocks({ owner, files = [], note = "" }) {
    assertOwner(owner);
    const requested = Array.isArray(files) && files.length ? this.normalizeFiles(files) : null;
    const locks = await this.listLocks();
    const stale = locks.locks.filter((l) => l.is_stale && (!requested || requested.includes(l.file)));
    const recovered = [];
    for (const lock of stale) {
      const lockDir = lockDirForPath(this.paths, lock.file);
      const metadataFile = lockMetadataFile(lockDir);
      const metadata = await readJson(metadataFile, lock);
      metadata.history = metadata.history || [];
      metadata.history.push({ ts_utc: utcNow(), type: "stale_recovered", by: owner, note });
      await writeJsonAtomic(path.join(this.paths.evidenceDir, `stale_recovered_${metadata.lock_id}_${Date.now()}.json`), metadata);
      await fs.rm(lockDir, { recursive: true, force: true });
      recovered.push(lock.file);
    }
    await this.event("lock.stale_recovered", { owner, files: recovered, note });
    return { ok: true, status: "recovered", recovered };
  }

  async appendEvidence({ owner, taskId = "", kind = "note", summary, data = {} }) {
    assertOwner(owner);
    if (!summary || typeof summary !== "string") throw new Error("summary is required");
    const entry = {
      id: `ev_${shaId(`${owner}:${summary}:${Date.now()}`, 16)}`,
      ts_utc: utcNow(),
      owner,
      task_id: taskId || null,
      kind,
      summary,
      data
    };
    const chained = await appendChainedJsonLine(this.paths.evidenceFile, entry);
    if (data?.system !== "event-manager") {
      await this.event("evidence.appended", {
        owner,
        task_id: taskId || null,
        evidence_id: entry.id,
        entry_hash: chained.entry_hash,
        kind,
        summary
      });
    }
    return { ok: true, status: "recorded", evidence: chained };
  }

  async createBlockedHandoff({
    task_id,
    owner,
    reason,
    blocked_files = [],
    suggested_correct_paths = [],
    handoff_path,
    release_locks = false
  }) {
    assertOwner(owner);
    assertId(task_id, "task_id");
    if (!reason || typeof reason !== "string") throw new Error("reason is required");
    if (!handoff_path || typeof handoff_path !== "string") throw new Error("handoff_path is required");
    const normalizedBlocked = Array.isArray(blocked_files) && blocked_files.length
      ? this.normalizeFiles(blocked_files)
      : [];
    const handoffRel = normalizeWorkspacePath(this.workspaceRoot, handoff_path);
    const handoffFile = path.join(this.workspaceRoot, handoffRel);
    const body = [
      `# Blocked Handoff: ${task_id}`,
      "",
      `- **Owner**: ${owner}`,
      `- **Reason**: ${reason}`,
      `- **Created UTC**: ${utcNow()}`,
      "",
      "## Blocked Files",
      "",
      ...listMarkdown(normalizedBlocked),
      "",
      "## Suggested Correct Paths",
      "",
      ...listMarkdown(suggested_correct_paths),
      "",
      "## Next Actor",
      "",
      "Claude / human architect should correct the scope or issue a new handoff.",
      ""
    ].join("\n");
    await ensureDir(path.dirname(handoffFile));
    await fs.writeFile(handoffFile, body, "utf8");
    const evidence = await this.appendEvidence({
      owner,
      taskId: task_id,
      kind: "block",
      summary: `Blocked handoff created: ${reason}`,
      data: {
        handoff_path: handoffRel,
        blocked_files: normalizedBlocked,
        suggested_correct_paths
      }
    });
    let release = null;
    if (release_locks && normalizedBlocked.length) {
      release = await this.releaseFiles({ owner, files: normalizedBlocked, note: `blocked handoff ${handoffRel}` });
    }
    const emitted = await this.eventManager.emitEvent({
      event_type: "task.blocked",
      owner,
      task_id,
      files: normalizedBlocked,
      summary: reason,
      next_actor: "claude",
      recommended_action: "fix_scope",
      payload: {
        handoff_path: handoffRel,
        blocked_files: normalizedBlocked,
        suggested_correct_paths,
        evidence_id: evidence.evidence.id,
        release_locks
      }
    });
    return {
      ok: true,
      status: "blocked_handoff_created",
      handoff_path: handoffRel,
      evidence: evidence.evidence,
      event: emitted.event,
      release
    };
  }

  async verifyEvidence() {
    return await verifyChainedLog(this.paths.evidenceFile);
  }

  async getStateSummary() {
    const locks = await this.listLocks();
    const taskFiles = await fs.readdir(this.paths.tasksDir).catch(() => []);
    const handoffFiles = await fs.readdir(this.paths.handoffsDir).catch(() => []);
    const tasks = [];
    for (const file of taskFiles.filter((f) => f.endsWith(".json"))) tasks.push(await readJson(path.join(this.paths.tasksDir, file), null));
    const handoffs = [];
    for (const file of handoffFiles.filter((f) => f.endsWith(".json"))) handoffs.push(await readJson(path.join(this.paths.handoffsDir, file), null));
    const queue = {
      pending: (await this.queueManager.listPendingTasks({ limit: 500 })).tasks,
      claimed: (await this.queueManager.readTasks("claimed")).map((item) => item.task),
      blocked: (await this.queueManager.readTasks("blocked")).map((item) => item.task),
      done: (await this.queueManager.readTasks("done")).map((item) => item.task)
    };
    return {
      ok: true,
      workspace_root: this.workspaceRoot,
      state_dir: this.paths.stateDir,
      state_dir_name: this.stateDirName,
      locks: locks.locks,
      tasks: tasks.filter(Boolean).sort((a, b) => a.id.localeCompare(b.id)),
      queue,
      handoffs: handoffs.filter(Boolean).sort((a, b) => a.id.localeCompare(b.id))
    };
  }

  /**
   * Pre-flight check used by the hermes_doctor MCP tool.
   * Validates workspace existence, write permissions, env wiring, and
   * surfaces actionable findings without modifying state.
   *
   * v0.5.1: results are cached for DOCTOR_CACHE_TTL_MS (30s) per-instance to
   * avoid the syscalls on every call. Pass `{ force_refresh: true }` (snake- or
   * camel-case) to bypass and re-probe. The cached result includes a
   * `cached: true` marker plus `cache_age_ms` for observability.
   */
  async doctor(options = {}) {
    const force =
      options?.force_refresh === true ||
      options?.forceRefresh === true ||
      options?.force === true;
    const now = Date.now();
    if (!force && this._doctorCache && this._doctorCache.expiresAt > now) {
      return {
        ...this._doctorCache.result,
        cached: true,
        cache_age_ms: now - this._doctorCache.computedAtMs
      };
    }
    if (!force && this._doctorInflight) {
      // Concurrent uncached caller — share the in-flight probe rather than
      // duplicating the syscalls.
      return await this._doctorInflight;
    }
    const probe = (async () => {
      const fresh = await this._doctorProbe();
      this._doctorCache = {
        result: fresh,
        expiresAt: Date.now() + DOCTOR_CACHE_TTL_MS,
        computedAtMs: Date.now()
      };
      return { ...fresh, cached: false, cache_age_ms: 0 };
    })();
    this._doctorInflight = probe;
    try {
      return await probe;
    } finally {
      this._doctorInflight = null;
    }
  }

  /**
   * Force-clear the doctor cache. Used by tests and explicit invalidation paths
   * (e.g., after an `init()` that creates the state dir tree). Public so the
   * MCP server can wire it into mutating ops if it ever wants to.
   */
  invalidateDoctorCache() {
    this._doctorCache = null;
  }

  async _doctorProbe() {
    const findings = [];
    const checks = [];

    // 1. Workspace exists & is a directory
    let wsStat = null;
    try {
      wsStat = await fs.stat(this.workspaceRoot);
    } catch (err) {
      findings.push({
        level: "error",
        check: "workspace_exists",
        message: `workspace_root does not exist: ${this.workspaceRoot}`,
        fix: "Set MCP_LOCK_WORKSPACE or HERMES3D_WORKSPACE to an existing directory."
      });
    }
    if (wsStat && !wsStat.isDirectory()) {
      findings.push({
        level: "error",
        check: "workspace_is_dir",
        message: `workspace_root is not a directory: ${this.workspaceRoot}`,
        fix: "Point the env var at a directory, not a file."
      });
    }
    checks.push({ id: "workspace_exists", ok: !!wsStat && wsStat.isDirectory() });

    // 2. Workspace is writable. Use a probe file directly under workspaceRoot
    // so doctor() is non-destructive: it does NOT pre-create the state dir tree.
    let writable = false;
    if (wsStat && wsStat.isDirectory()) {
      try {
        const probe = path.join(this.workspaceRoot, `.mcp-lock-write-probe-${process.pid}-${Date.now()}.tmp`);
        await fs.writeFile(probe, "probe", "utf8");
        await fs.rm(probe, { force: true });
        writable = true;
      } catch (err) {
        findings.push({
          level: "error",
          check: "workspace_writable",
          message: `cannot write to workspace: ${this.workspaceRoot} :: ${err.message}`,
          fix: "Check filesystem permissions on the workspace."
        });
      }
    }
    checks.push({ id: "workspace_writable", ok: writable });

    // 3. Env vars
    const usingEnv = Boolean(process.env.MCP_LOCK_WORKSPACE || process.env.HERMES3D_WORKSPACE);
    if (!usingEnv) {
      findings.push({
        level: "warn",
        check: "env_workspace_set",
        message: "Neither MCP_LOCK_WORKSPACE nor HERMES3D_WORKSPACE is set; falling back to process.cwd().",
        fix: "Set one of those env vars to your project root in the MCP client config."
      });
    }
    checks.push({ id: "env_workspace_set", ok: usingEnv });

    // 4. Optional .git presence (informational)
    let hasGit = false;
    try {
      const gitStat = await fs.stat(path.join(this.workspaceRoot, ".git"));
      hasGit = gitStat.isDirectory();
    } catch { /* not a git repo, that's fine */ }
    if (!hasGit) {
      findings.push({
        level: "info",
        check: "git_repo",
        message: "workspace_root is not a git repo; git-* gates will fail until you `git init`.",
        fix: "Run `git init` in the workspace if you intend to use the git gates."
      });
    }
    checks.push({ id: "git_repo", ok: hasGit });

    // 5. Node version
    const nodeOk = (() => {
      const m = /^v(\d+)/.exec(process.version);
      return m ? Number(m[1]) >= 20 : false;
    })();
    if (!nodeOk) {
      findings.push({
        level: "error",
        check: "node_version",
        message: `Node ${process.version} detected; this server requires Node >= 20.`,
        fix: "Upgrade Node.js to 20 LTS or newer."
      });
    }
    checks.push({ id: "node_version", ok: nodeOk });

    return {
      ok: findings.every((f) => f.level !== "error"),
      workspace_root: this.workspaceRoot,
      state_dir: this.paths.stateDir,
      state_dir_name: this.stateDirName,
      node_version: process.version,
      platform: process.platform,
      checks,
      findings
    };
  }
}

function assertOwner(owner, name = "owner") {
  if (typeof owner !== "string" || owner.trim().length < 2) {
    throw new Error(`${name} must be a non-empty string, for example claude-lead or codex-impl-01`);
  }
}

function assertId(id, name) {
  if (typeof id !== "string" || id.trim().length < 2) throw new Error(`${name} must be a non-empty string`);
}

function normalizeTtl(ttlMinutes) {
  const ttl = Number(ttlMinutes || DEFAULT_TTL_MINUTES);
  if (!Number.isFinite(ttl) || ttl < 5 || ttl > 720) return DEFAULT_TTL_MINUTES;
  return ttl;
}

function listMarkdown(items) {
  if (!Array.isArray(items) || items.length === 0) return ["- (none)"];
  return items.map((item) => `- \`${item}\``);
}

function mapLegacyEvent(type, payload = {}) {
  const base = {
    owner: payload.owner || payload.requester || null,
    task_id: payload.task_id || null,
    files: payload.files || payload.requested_files || [],
    payload
  };
  if (type === "task.claimed") {
    return {
      ...base,
      event_type: "task.claimed",
      summary: `Task claimed: ${payload.task_id || ""}`.trim(),
      next_actor: "unassigned",
      recommended_action: "acknowledge"
    };
  }
  if (type === "task.released") {
    return {
      ...base,
      event_type: "task.released",
      summary: `Task released: ${payload.task_id || ""}`.trim(),
      next_actor: "claude",
      recommended_action: payload?.pr_url ? "review_pr" : "acknowledge"
    };
  }
  if (type === "lock.acquired") {
    return {
      ...base,
      event_type: "lock.acquired",
      summary: `Lock acquired: ${(payload.files || []).length} file(s)`,
      next_actor: "unassigned",
      recommended_action: "none"
    };
  }
  if (type === "lock.released") {
    return {
      ...base,
      event_type: "lock.released",
      summary: `Lock released: ${(payload.files || []).length} file(s)`,
      next_actor: "unassigned",
      recommended_action: "acknowledge"
    };
  }
  if (type === "lock.stale_recovered") {
    return {
      ...base,
      event_type: "lock.recovered",
      summary: `Stale locks recovered: ${(payload.files || []).length} file(s)`,
      next_actor: "human",
      recommended_action: "acknowledge"
    };
  }
  if (type === "handoff.requested") {
    return {
      ...base,
      owner: payload.requester || null,
      event_type: "handoff.created",
      summary: `Handoff requested: ${payload.request_id || ""}`.trim(),
      next_actor: "human",
      recommended_action: "review_handoff"
    };
  }
  if (type === "handoff.decided") {
    return {
      ...base,
      event_type: payload.decision === "approve" ? "handoff.approved" : "handoff.denied",
      summary: `Handoff ${payload.decision}: ${payload.request_id || ""}`.trim(),
      next_actor: "unassigned",
      recommended_action: "acknowledge"
    };
  }
  if (type === "evidence.appended") {
    return {
      ...base,
      event_type: "evidence.appended",
      summary: payload.summary || "Evidence appended",
      next_actor: "unassigned",
      recommended_action: "acknowledge"
    };
  }
  return null;
}
