import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  appendChainedJsonLine,
  canonicalJSON,
  ensureDir,
  moveFileAtomic,
  normalizeWorkspacePath,
  pathExists,
  readJson,
  shaId,
  statePaths,
  utcNow,
  writeJsonAtomic
} from "./fs-utils.mjs";

export const EVENT_SCHEMA_VERSION = 1;

export const EVENT_TYPES = new Set([
  "task.claimed",
  "task.released",
  "task.blocked",
  "handoff.created",
  "handoff.approved",
  "handoff.denied",
  "lock.acquired",
  "lock.released",
  "lock.recovered",
  "evidence.appended",
  "gate.failed",
  "gate.passed",
  "pr.opened"
]);

export const NEXT_ACTORS = new Set(["claude", "codex", "human", "unassigned"]);
export const RECOMMENDED_ACTIONS = new Set([
  "review_pr",
  "fix_scope",
  "merge",
  "review_handoff",
  "acknowledge",
  "none"
]);

export class EventManager {
  constructor({ workspaceRoot, stateDirName } = {}) {
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.paths = statePaths(this.workspaceRoot, stateDirName);
  }

  async init() {
    await ensureDir(this.paths.eventsOutboxDir);
    await ensureDir(this.paths.eventsHandledDir);
    await ensureDir(this.paths.eventsFailedDir);
    await ensureDir(this.paths.reviewPacketsDir);
  }

  async emitEvent({
    event_type,
    task_id = null,
    owner = null,
    branch = null,
    files = [],
    summary = "",
    next_actor = "unassigned",
    recommended_action = "none",
    payload = {}
  }) {
    await this.init();
    validateEventType(event_type);
    validateEnum(next_actor, NEXT_ACTORS, "next_actor");
    validateEnum(recommended_action, RECOMMENDED_ACTIONS, "recommended_action");
    const created_utc = utcNow();
    const normalizedFiles = Array.isArray(files)
      ? [...new Set(files.map((file) => normalizeWorkspacePath(this.workspaceRoot, file)))].sort()
      : [];
    const nonce = crypto.randomBytes(8).toString("hex");
    const event = {
      event_schema_version: EVENT_SCHEMA_VERSION,
      event_id: makeEventId(created_utc, {
        event_type,
        task_id,
        owner,
        summary,
        payload,
        nonce
      }),
      event_type,
      created_utc,
      workspace_root: this.workspaceRoot,
      task_id: task_id || null,
      owner: owner || null,
      branch: branch || await currentBranch(this.workspaceRoot),
      files: normalizedFiles,
      summary,
      evidence_ids: task_id ? await this.evidenceIdsForTask(task_id) : [],
      next_actor,
      recommended_action,
      payload: payload || {}
    };
    const outboxPath = this.eventPath("outbox", event.event_id);
    await writeJsonAtomic(outboxPath, event);
    await this.appendBookkeepingEvidence(event);
    return { ok: true, status: "emitted", event, path: outboxPath };
  }

  async listEvents({ status = "outbox", limit = 50 } = {}) {
    await this.init();
    const statuses = status === "all" ? ["outbox", "handled", "failed"] : [status];
    for (const value of statuses) validateStatus(value);
    const events = [];
    for (const value of statuses) {
      const dir = this.dirForStatus(value);
      const files = await fs.readdir(dir).catch(() => []);
      for (const file of files.filter((name) => name.endsWith(".json"))) {
        const event = await readJson(path.join(dir, file), null);
        if (event) events.push({ status: value, ...event });
      }
    }
    events.sort((a, b) =>
      String(a.created_utc || "").localeCompare(String(b.created_utc || "")) ||
      String(a.event_id || "").localeCompare(String(b.event_id || ""))
    );
    const bounded = Math.max(1, Math.min(500, Number(limit || 50)));
    return { ok: true, status, count: events.length, events: events.slice(0, bounded) };
  }

  async markEventHandled({ event_id, handled_by, note = "" }) {
    await this.init();
    assertEventId(event_id);
    if (!handled_by || typeof handled_by !== "string") throw new Error("handled_by is required");
    const source = this.eventPath("outbox", event_id);
    const handled = this.eventPath("handled", event_id);
    const failed = this.eventPath("failed", event_id);
    if (await pathExists(handled)) {
      return { ok: true, status: "event_already_handled", event_id, path: handled };
    }
    if (await pathExists(failed)) {
      return { ok: false, status: "event_already_failed", event_id, path: failed };
    }
    const event = await readJson(source, null);
    if (!event) return { ok: false, status: "missing", message: `event not found in outbox: ${event_id}` };
    if (event.event_schema_version !== EVENT_SCHEMA_VERSION) {
      event.error = "unknown_schema_version";
      event.failed_utc = utcNow();
      event.failed_by = handled_by;
      await writeJsonAtomic(source, event);
      await moveFileAtomic(source, failed);
      return { ok: false, status: "unknown_schema_version", event_id, path: failed };
    }
    await moveFileAtomic(source, handled);
    event.handled_utc = utcNow();
    event.handled_by = handled_by;
    event.handled_note = note;
    await writeJsonAtomic(handled, event);
    await this.appendBookkeepingEvidence(event, {
      kind: "event-handled",
      summary: `Handled event ${event_id}`,
      handled_by,
      note
    });
    return { ok: true, status: "handled", event, path: handled };
  }

  async failEvent({ event_id, failed_by = "event-manager", error = "processing_failed" }) {
    await this.init();
    assertEventId(event_id);
    const source = this.eventPath("outbox", event_id);
    const failed = this.eventPath("failed", event_id);
    const event = await readJson(source, null);
    if (!event) return { ok: false, status: "missing", event_id };
    await moveFileAtomic(source, failed);
    event.failed_utc = utcNow();
    event.failed_by = failed_by;
    event.error = error;
    await writeJsonAtomic(failed, event);
    return { ok: true, status: "failed", event, path: failed };
  }

  async evidenceIdsForTask(taskId) {
    const entries = await readEvidenceEntries(this.paths.evidenceFile);
    return entries
      .filter((entry) => entry && entry.task_id === taskId && typeof entry.entry_hash === "string")
      .map((entry) => entry.id)
      .filter(Boolean);
  }

  eventPath(status, eventId) {
    validateStatus(status);
    assertEventId(eventId);
    return path.join(this.dirForStatus(status), `${eventId}.json`);
  }

  dirForStatus(status) {
    validateStatus(status);
    if (status === "outbox") return this.paths.eventsOutboxDir;
    if (status === "handled") return this.paths.eventsHandledDir;
    return this.paths.eventsFailedDir;
  }

  async appendBookkeepingEvidence(event, override = {}) {
    const entry = {
      id: `ev_${shaId(`event-manager:${event.event_id}:${Date.now()}`, 16)}`,
      ts_utc: utcNow(),
      owner: "event-manager",
      task_id: event.task_id || null,
      kind: override.kind || "event-emitted",
      summary: override.summary || `Emitted ${event.event_type} ${event.event_id}`,
      data: {
        system: "event-manager",
        event_id: event.event_id,
        event_type: event.event_type,
        ...override
      }
    };
    return await appendChainedJsonLine(this.paths.evidenceFile, entry);
  }
}

export async function readEvidenceEntries(file) {
  let raw;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

function makeEventId(createdUtc, payload) {
  const compact = createdUtc.replace(/[-:.]/g, "").replace("T", "T").replace("Z", "Z");
  const digest = crypto.createHash("sha256").update(canonicalJSON(payload)).digest("hex").slice(0, 6);
  return `evt_${compact}_${digest}`;
}

async function currentBranch(workspaceRoot) {
  const result = spawnSync("git", ["branch", "--show-current"], {
    cwd: workspaceRoot,
    encoding: "utf8",
    shell: false
  });
  const branch = (result.stdout || "").trim();
  return branch || null;
}

function validateEventType(value) {
  if (!EVENT_TYPES.has(value)) throw new Error(`event_type must be one of: ${[...EVENT_TYPES].join(", ")}`);
}

function validateEnum(value, allowed, name) {
  if (!allowed.has(value)) throw new Error(`${name} must be one of: ${[...allowed].join(", ")}`);
}

function validateStatus(value) {
  if (!["outbox", "handled", "failed"].includes(value)) {
    throw new Error("status must be outbox, handled, failed, or all");
  }
}

function assertEventId(eventId) {
  if (typeof eventId !== "string" || !/^evt_[A-Za-z0-9TZ]+_[a-f0-9]{6}$/.test(eventId)) {
    throw new Error("invalid event_id: must match evt_<utc_iso_compact>_<6hex>");
  }
}
