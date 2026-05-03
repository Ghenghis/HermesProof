import fs from "node:fs/promises";
import path from "node:path";
import {
  ensureDir,
  moveFileAtomic,
  normalizeWorkspacePath,
  pathExists,
  readJson,
  safeWorkspaceRoot,
  statePaths,
  utcNow,
  writeJsonAtomic
} from "./fs-utils.mjs";
import { EventManager } from "./event-manager.mjs";
import { makeMutex } from "./mutex.mjs";

export const TASK_SCHEMA_VERSION = 1;
const DEFAULT_TTL_MINUTES = 120;
const TASK_STATES = ["pending", "claimed", "blocked", "done"];
// v0.5.1 perf: cap parallel readJson() calls inside readTasks() so a directory
// with thousands of tasks doesn't open thousands of FDs at once. 16 keeps us
// fast on SSDs and below the default ulimit on every supported platform.
export const READ_TASKS_CONCURRENCY = 16;

export class QueueManager {
  constructor({ workspaceRoot, stateDirName, eventManager } = {}) {
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    this.workspaceRoot = safeWorkspaceRoot(workspaceRoot);
    this.paths = statePaths(this.workspaceRoot, stateDirName);
    this.eventManager = eventManager || new EventManager({
      workspaceRoot: this.workspaceRoot,
      stateDirName: this.paths.stateDirName
    });
    this._initialized = false;
    // v0.5.1 perf: O(1) heartbeat-by-id. Map<task_id, { file, owner }>. Kept in
    // sync with the on-disk `tasks/claimed/` directory by claimPendingTask,
    // completeTask, blockTask, and recoverStaleTasks. Reconciled with disk on
    // init() and on every recoverStaleTasks call so stale entries cannot linger
    // across server restarts or external mutations.
    this._claimedIndex = new Map();
    // Serialize concurrent heartbeats — without this, two simultaneous
    // heartbeat() calls for the same owner can both read+write the same
    // task file, dropping one heartbeat_utc update. The 2026-05-03 audit
    // cross-confirmed this gap.
    this._heartbeatMutex = makeMutex();
  }

  async init() {
    if (this._initialized) return;
    for (const dir of [
      this.paths.tasksPendingDir,
      this.paths.tasksClaimedDir,
      this.paths.tasksBlockedDir,
      this.paths.tasksDoneDir
    ]) {
      await ensureDir(dir);
    }
    await this.eventManager.init();
    await this._reconcileClaimedIndex();
    this._initialized = true;
  }

  /**
   * Rebuild the in-memory `_claimedIndex` from disk. Called from `init()` and
   * from `recoverStaleTasks()` so the index never drifts from the filesystem,
   * even across crashes or external mutations.
   */
  async _reconcileClaimedIndex() {
    const next = new Map();
    const items = await this.readTasks("claimed");
    for (const { file, task } of items) {
      if (!isTaskVersion(task)) continue;
      next.set(task.task_id, { file, owner: task.claimed_by || null });
    }
    this._claimedIndex = next;
  }

  async enqueueTask({
    task_id,
    taskId,
    title = "",
    summary = "",
    handoff_path = "",
    branch_hint = "",
    files_hint = [],
    priority = 0,
    target_owner_pattern = ".*",
    ttl_minutes = DEFAULT_TTL_MINUTES,
    data = {},
    enqueued_by = "unknown"
  }) {
    await this.init();
    const id = normalizeTaskId(task_id || taskId);
    assertValidOwnerPattern(target_owner_pattern);
    const existing = await this.findTask(id);
    if (existing) {
      return { ok: true, status: "already_enqueued", task: existing.task, state: existing.state, idempotent: true };
    }
    const files = normalizeFilesHint(this.workspaceRoot, files_hint);
    const task = {
      task_schema_version: TASK_SCHEMA_VERSION,
      task_id: id,
      title,
      summary,
      handoff_path,
      branch_hint,
      files_hint: files,
      priority: normalizePriority(priority),
      target_owner_pattern,
      enqueued_by,
      enqueued_utc: utcNow(),
      claimed_by: null,
      claimed_utc: null,
      ttl_minutes: normalizeTtl(ttl_minutes),
      heartbeat_utc: null,
      done_utc: null,
      blocked_reason: null,
      data: data && typeof data === "object" ? data : {}
    };
    const pending = this.taskPath("pending", id);
    await writeJsonAtomic(pending, task);
    await this.eventManager.emitEvent({
      event_type: "task.enqueued",
      task_id: id,
      owner: enqueued_by,
      files,
      summary: `Task enqueued: ${id}`,
      next_actor: "codex",
      recommended_action: "acknowledge",
      payload: {
        task_id: id,
        priority: task.priority,
        target_owner_pattern,
        handoff_path,
        branch_hint
      }
    });
    return { ok: true, status: "enqueued", task };
  }

  async listPendingTasks({ owner_filter = "", limit = 50 } = {}) {
    await this.init();
    const tasks = [];
    for (const item of await this.readTasks("pending")) {
      if (!isTaskVersion(item.task)) continue;
      if (owner_filter && !ownerMatches(owner_filter, item.task.target_owner_pattern)) continue;
      tasks.push(item.task);
    }
    tasks.sort(compareTasks);
    const bounded = Math.max(1, Math.min(500, Number(limit || 50)));
    return { ok: true, status: "pending", count: tasks.length, tasks: tasks.slice(0, bounded) };
  }

  async pickTask({ owner, prefer_task_id = "", preferTaskId = "" }) {
    assertOwner(owner);
    await this.init();
    const preferred = prefer_task_id || preferTaskId;
    if (preferred) {
      const id = normalizeTaskId(preferred);
      const found = await this.readTask("pending", id);
      if (!found) return { ok: false, status: "no_pending_tasks_for_owner", message: `pending task not found: ${id}` };
      return await this.claimPendingTask({ owner, item: { task: found, file: this.taskPath("pending", id) } });
    }
    const pending = (await this.readTasks("pending")).sort((a, b) => compareTasks(a.task, b.task));
    let sawMismatch = false;
    for (const item of pending) {
      if (!isTaskVersion(item.task)) {
        await this.blockPendingTask(item, "unknown_schema_version");
        continue;
      }
      if (!ownerMatches(owner, item.task.target_owner_pattern)) {
        sawMismatch = true;
        continue;
      }
      return await this.claimPendingTask({ owner, item });
    }
    return {
      ok: false,
      status: sawMismatch ? "task_owner_mismatch" : "no_pending_tasks_for_owner",
      message: sawMismatch ? `no pending tasks match owner: ${owner}` : `no pending tasks for owner: ${owner}`
    };
  }

  async completeTask({ owner, task_id, note = "" }) {
    assertOwner(owner);
    await this.init();
    const id = normalizeTaskId(task_id);
    const claimed = await this.readTask("claimed", id);
    if (!claimed) return { ok: false, status: "missing", message: `claimed task not found: ${id}` };
    if (claimed.claimed_by !== owner) {
      return { ok: false, status: "blocked", message: `task belongs to ${claimed.claimed_by}, not ${owner}`, task: claimed };
    }
    claimed.done_utc = utcNow();
    claimed.done_note = note;
    const source = this.taskPath("claimed", id);
    const done = this.taskPath("done", id);
    await moveFileAtomic(source, done);
    await writeJsonAtomic(done, claimed);
    this._claimedIndex.delete(id); // v0.5.1: keep heartbeat index in sync.
    await this.eventManager.emitEvent({
      event_type: "task.released",
      task_id: id,
      owner,
      files: claimed.files_hint || [],
      summary: `Queued task done: ${id}`,
      next_actor: "claude",
      recommended_action: "review_pr",
      payload: { task_id: id, note }
    });
    return { ok: true, status: "done", task: claimed };
  }

  async blockTask({ owner, task_id, reason }) {
    assertOwner(owner);
    await this.init();
    const id = normalizeTaskId(task_id);
    const claimed = await this.readTask("claimed", id);
    if (!claimed) return { ok: false, status: "missing", message: `claimed task not found: ${id}` };
    if (claimed.claimed_by !== owner) {
      return { ok: false, status: "blocked", message: `task belongs to ${claimed.claimed_by}, not ${owner}`, task: claimed };
    }
    claimed.blocked_reason = reason || "blocked";
    claimed.blocked_utc = utcNow();
    const source = this.taskPath("claimed", id);
    const blocked = this.taskPath("blocked", id);
    await moveFileAtomic(source, blocked);
    await writeJsonAtomic(blocked, claimed);
    this._claimedIndex.delete(id); // v0.5.1: keep heartbeat index in sync.
    await this.eventManager.emitEvent({
      event_type: "task.blocked",
      task_id: id,
      owner,
      files: claimed.files_hint || [],
      summary: claimed.blocked_reason,
      next_actor: "claude",
      recommended_action: "fix_scope",
      payload: { task_id: id, blocked_reason: claimed.blocked_reason }
    });
    return { ok: true, status: "blocked", task: claimed };
  }

  /**
   * Recover stale (TTL-expired) tasks back to pending.
   *
   * v0.5.1: each task is processed in its own try/catch so a single failure
   * (filesystem race, IO error, malformed JSON) cannot abort the whole batch.
   * The result now includes a `failures` array describing per-task errors.
   * After processing, the in-memory `_claimedIndex` is reconciled with disk.
   */
  async recoverStaleTasks({ owner, files = [], note = "" }) {
    assertOwner(owner);
    await this.init();
    const requested = Array.isArray(files) && files.length
      ? new Set(files.map((value) => normalizeTaskId(value)))
      : null;
    const recovered = [];
    const failures = [];
    const items = await this.readTasks("claimed");
    for (const item of items) {
      const task = item.task;
      if (!isTaskVersion(task)) continue;
      if (requested && !requested.has(task.task_id)) continue;
      if (!isTaskExpired(task)) continue;
      try {
        task.claimed_by = null;
        task.claimed_utc = null;
        task.heartbeat_utc = null;
        task.recovered_by = owner;
        task.recovered_utc = utcNow();
        task.recovery_note = note;
        const pending = this.taskPath("pending", task.task_id);
        await moveFileAtomic(item.file, pending);
        await writeJsonAtomic(pending, task);
        await this.eventManager.emitEvent({
          event_type: "task.recovered",
          task_id: task.task_id,
          owner,
          files: task.files_hint || [],
          summary: `Stale task recovered: ${task.task_id}`,
          next_actor: "unassigned",
          recommended_action: "acknowledge",
          payload: { task_id: task.task_id, note }
        });
        recovered.push(task.task_id);
      } catch (err) {
        // Per-task failure: collect and continue. The whole batch must not
        // abort because one task hit a transient error.
        failures.push({
          task_id: task.task_id,
          error: err && err.message ? err.message : String(err),
          code: err && err.code ? err.code : null
        });
      }
    }
    // Reconcile the heartbeat index against disk so any tasks moved out of
    // claimed/ are dropped from the Map.
    await this._reconcileClaimedIndex();
    return {
      ok: failures.length === 0,
      status: failures.length === 0 ? "recovered" : "partial",
      recovered,
      failures
    };
  }

  /**
   * Refresh the heartbeat timestamp on one or all tasks owned by `owner`.
   *
   * v0.5.1: when a `taskId` is supplied we go directly to the file via the
   * in-memory `_claimedIndex` (O(1)) instead of scanning the whole `claimed/`
   * directory. The Map is kept in sync by claim/complete/block/recover.
   * If the Map says the task isn't claimed by us we still verify against disk
   * (the index could be stale across server restarts before init() finishes).
   */
  async heartbeat({ owner, taskId = "" }) {
    assertOwner(owner);
    await this.init();
    return this._heartbeatMutex(async () => {
      const now = utcNow();
      const touched = [];
      if (taskId) {
        const id = normalizeTaskId(taskId);
        const indexed = this._claimedIndex.get(id);
        // Fast path: index says we own it. Read+write the single file, no scan.
        if (indexed && indexed.owner === owner) {
          const task = await readJson(indexed.file, null);
          if (task && isTaskVersion(task) && task.claimed_by === owner) {
            task.heartbeat_utc = now;
            await writeJsonAtomic(indexed.file, task);
            touched.push(task.task_id);
            return touched;
          }
          // Index drifted (manual edit, prior crash). Drop and fall through.
          this._claimedIndex.delete(id);
        }
        // Cold path: index miss but caller asked for a specific id. Read the
        // canonical file directly — still O(1) — instead of scanning.
        const file = this.taskPath("claimed", id);
        const task = await readJson(file, null);
        if (task && isTaskVersion(task) && task.claimed_by === owner) {
          task.heartbeat_utc = now;
          await writeJsonAtomic(file, task);
          touched.push(task.task_id);
          // Keep the index hot for next call.
          this._claimedIndex.set(task.task_id, { file, owner });
        }
        return touched;
      }
      // Batch path (no taskId): walk all claimed tasks. This stays an O(n) scan
      // because the caller wants every task they own — there's no way to
      // shortcut "everything I own" without the same set of reads.
      for (const item of await this.readTasks("claimed")) {
        const task = item.task;
        if (!isTaskVersion(task)) continue;
        if (task.claimed_by !== owner) continue;
        task.heartbeat_utc = now;
        await writeJsonAtomic(item.file, task);
        touched.push(task.task_id);
        this._claimedIndex.set(task.task_id, { file: item.file, owner });
      }
      return touched;
    });
  }

  /**
   * v0.5.1: parallel reads with bounded concurrency (READ_TASKS_CONCURRENCY).
   * Unbounded Promise.all on a directory with thousands of files would open
   * thousands of FDs at once. The bounded queue keeps us under the per-process
   * ulimit while still exploiting parallelism on SSDs/NVMe.
   */
  async readTasks(state) {
    const dir = this.dirForState(state);
    const names = (await fs.readdir(dir).catch(() => []))
      .filter((value) => value.endsWith(".json"))
      .sort();
    if (names.length === 0) return [];
    return await mapWithConcurrency(names, READ_TASKS_CONCURRENCY, async (name) => {
      const file = path.join(dir, name);
      const task = await readJson(file, null);
      return task ? { file, task } : null;
    }).then((arr) => arr.filter(Boolean));
  }

  async readTask(state, id) {
    return await readJson(this.taskPath(state, id), null);
  }

  async findTask(id) {
    for (const state of TASK_STATES) {
      const task = await this.readTask(state, id);
      if (task) return { state, task };
    }
    return null;
  }

  taskPath(state, id) {
    return path.join(this.dirForState(state), `${normalizeTaskId(id)}.json`);
  }

  dirForState(state) {
    if (state === "pending") return this.paths.tasksPendingDir;
    if (state === "claimed") return this.paths.tasksClaimedDir;
    if (state === "blocked") return this.paths.tasksBlockedDir;
    if (state === "done") return this.paths.tasksDoneDir;
    throw new Error("task state must be pending, claimed, blocked, or done");
  }

  async claimPendingTask({ owner, item }) {
    const task = item.task;
    if (!isTaskVersion(task)) return await this.blockPendingTask(item, "unknown_schema_version");
    if (!ownerMatches(owner, task.target_owner_pattern)) {
      return { ok: false, status: "task_owner_mismatch", task };
    }
    const claimed = this.taskPath("claimed", task.task_id);
    const guard = `${claimed}.claiming`;
    const now = utcNow();
    task.claimed_by = owner;
    task.claimed_utc = now;
    task.heartbeat_utc = now;
    let guardOwned = false;
    try {
      await fs.mkdir(guard, { recursive: false });
      guardOwned = true;
      await moveFileAtomic(item.file, claimed);
      await writeJsonAtomic(claimed, task);
    } catch (err) {
      if (err.code === "EEXIST" || err.code === "ENOENT") {
        return { ok: false, status: "task_already_claimed", task_id: task.task_id };
      }
      throw err;
    } finally {
      if (guardOwned) await fs.rm(guard, { recursive: true, force: true });
    }
    // v0.5.1: register in the heartbeat index so heartbeat({ taskId }) is O(1).
    this._claimedIndex.set(task.task_id, { file: claimed, owner });
    await this.eventManager.emitEvent({
      event_type: "task.claimed",
      task_id: task.task_id,
      owner,
      files: task.files_hint || [],
      summary: `Queued task claimed: ${task.task_id}`,
      next_actor: "unassigned",
      recommended_action: "acknowledge",
      payload: {
        task_id: task.task_id,
        handoff_path: task.handoff_path,
        branch_hint: task.branch_hint,
        priority: task.priority
      }
    });
    return { ok: true, status: "claimed", task };
  }

  async blockPendingTask(item, reason) {
    const id = normalizeTaskId(item.task?.task_id || path.basename(item.file, ".json"));
    const blocked = this.taskPath("blocked", id);
    const task = {
      ...item.task,
      task_id: id,
      blocked_reason: reason,
      blocked_utc: utcNow()
    };
    await moveFileAtomic(item.file, blocked);
    await writeJsonAtomic(blocked, task);
    return { ok: false, status: reason, task };
  }
}

function normalizeTaskId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]{2,128}$/.test(value)) {
    throw new Error("task_id must match ^[A-Za-z0-9._-]{2,128}$");
  }
  return value;
}

function assertOwner(owner) {
  if (typeof owner !== "string" || owner.trim().length < 2) {
    throw new Error("owner must be a non-empty string");
  }
}

function assertValidOwnerPattern(pattern) {
  if (typeof pattern !== "string" || pattern.length > 256) {
    throw new Error("invalid_owner_pattern");
  }
  try {
    new RegExp(pattern);
  } catch {
    throw new Error("invalid_owner_pattern");
  }
}

function ownerMatches(owner, pattern) {
  try {
    return new RegExp(pattern).test(owner);
  } catch {
    return false;
  }
}

function normalizePriority(priority) {
  const value = Number(priority ?? 0);
  if (!Number.isFinite(value)) return 0;
  return Math.max(-100, Math.min(100, value));
}

function normalizeTtl(ttlMinutes) {
  const value = Number(ttlMinutes || DEFAULT_TTL_MINUTES);
  if (!Number.isFinite(value) || value < 1 || value > 10080) return DEFAULT_TTL_MINUTES;
  return value;
}

function normalizeFilesHint(workspaceRoot, filesHint) {
  if (!Array.isArray(filesHint)) return [];
  return [...new Set(filesHint.map((file) => normalizeWorkspacePath(workspaceRoot, file)))].sort();
}

function isTaskVersion(task) {
  return task && task.task_schema_version === TASK_SCHEMA_VERSION;
}

function compareTasks(a, b) {
  return Number(b.priority || 0) - Number(a.priority || 0) ||
    String(a.enqueued_utc || "").localeCompare(String(b.enqueued_utc || "")) ||
    String(a.task_id || "").localeCompare(String(b.task_id || ""));
}

function isTaskExpired(task) {
  const base = task.heartbeat_utc || task.claimed_utc;
  if (!base) return false;
  const expiresAt = Date.parse(base) + normalizeTtl(task.ttl_minutes) * 60_000;
  return Number.isFinite(expiresAt) && expiresAt < Date.now();
}

/**
 * Run `mapper` over `items` with at most `concurrency` in-flight calls. Returns
 * an array in the same order as the input. Hand-rolled to avoid an extra
 * runtime dep (`p-limit`-style). Errors short-circuit the whole batch — the
 * caller is responsible for try/catch inside the mapper if it wants
 * partial-success semantics.
 *
 * Exported for tests so we can verify the bounded behavior without touching
 * the filesystem.
 */
export async function mapWithConcurrency(items, concurrency, mapper) {
  const limit = Math.max(1, Math.min(concurrency | 0 || 1, items.length || 1));
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await mapper(items[idx], idx);
    }
  }
  const workers = [];
  for (let i = 0; i < limit; i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}
