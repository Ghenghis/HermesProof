/**
 * AnonymousOrchestrator — role-based coordination layer on top of the lock manager.
 *
 * Implements:
 *   - Anonymous role rotation (BUILDER, CRITIC, SCRIBE, GATE-SMITH, DOC-KEEPER, WATCHDOG)
 *   - USER role reserved for the human OR the Hermes-Agent-as-User bridge
 *   - Authorization guard: actions requiring USER approval are blocked unless an
 *     active AS_USER session exists (issued either by the actual human or by
 *     the Hermes Agent bridge once it's been authorized for the project)
 *
 * The state lives at `.hermes3d_orchestrator/anonymous_orchestrator.json`,
 * sibling to the existing lock-manager state file.
 *
 * Foolproofing:
 *   - Dual writes (JSON file + evidence ledger entry) keep the audit trail
 *   - TTL on USER sessions auto-expire (default 8h)
 *   - Session revocation is a one-shot operation (emit revoke event, clear state)
 *   - Handles MCP disconnect: file-based state survives, reconciles on next call
 */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { writeJsonAtomic, ensureDir, readJson } from "./fs-utils.mjs";

const ROLES = Object.freeze({
  BUILDER: "BUILDER",
  CRITIC: "CRITIC",
  SCRIBE: "SCRIBE",
  GATE_SMITH: "GATE-SMITH",
  DOC_KEEPER: "DOC-KEEPER",
  WATCHDOG: "WATCHDOG",
  USER: "USER",
});

const USER_SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8h default
const ROLE_CLAIM_TTL_MS = 30 * 60 * 1000; // 30min — agents must renew claims

export class AnonymousOrchestrator {
  /**
   * @param {object} options
   * @param {string} options.workspaceRoot
   * @param {string} [options.stateDirName=".hermes3d_orchestrator"]
   */
  constructor({ workspaceRoot, stateDirName = ".hermes3d_orchestrator" } = {}) {
    if (!workspaceRoot) throw new Error("AnonymousOrchestrator requires workspaceRoot");
    this.workspaceRoot = workspaceRoot;
    this.stateDir = path.join(workspaceRoot, stateDirName);
    this.stateFile = path.join(this.stateDir, "anonymous_orchestrator.json");
    this.evidenceFile = path.join(this.stateDir, "evidence.ndjson");
  }

  async init() {
    await ensureDir(this.stateDir);
    const existing = await readJson(this.stateFile, null);
    if (!existing) {
      await writeJsonAtomic(this.stateFile, {
        schema_version: 1,
        active_roles: {},
        active_user_session: null,
        history: [],
      });
    }
  }

  async _readState() {
    return (
      (await readJson(this.stateFile, null)) ?? {
        schema_version: 1,
        active_roles: {},
        active_user_session: null,
        history: [],
      }
    );
  }

  async _writeState(state) {
    await writeJsonAtomic(this.stateFile, state);
  }

  async _appendEvidence(entry) {
    await ensureDir(this.stateDir);
    const line =
      JSON.stringify({
        ts: new Date().toISOString(),
        ...entry,
      }) + "\n";
    await fs.appendFile(this.evidenceFile, line, "utf8");
  }

  /**
   * An agent claims a role for itself.
   * @param {object} args
   * @param {string} args.role - one of ROLES
   * @param {string} args.actor_id - opaque self-chosen id, e.g. `claude-impl-04`
   * @param {string} [args.purpose] - free-text reason
   */
  async claimRole({ role, actor_id, purpose }) {
    if (!Object.values(ROLES).includes(role)) {
      throw new Error(`unknown role: ${role}`);
    }
    if (role === ROLES.USER) {
      throw new Error("USER role cannot be self-claimed; call grantUserSession instead");
    }
    if (!/^[a-z][a-z0-9-]{1,63}$/.test(actor_id)) {
      throw new Error(`invalid actor_id: ${actor_id}`);
    }
    const state = await this._readState();
    const now = Date.now();
    const expiresAt = now + ROLE_CLAIM_TTL_MS;
    state.active_roles[role] = state.active_roles[role] || [];
    // Same actor reclaiming the role just renews TTL
    const existingIdx = state.active_roles[role].findIndex((r) => r.actor_id === actor_id);
    if (existingIdx !== -1) {
      state.active_roles[role][existingIdx].expires_at = expiresAt;
      state.active_roles[role][existingIdx].purpose = purpose ?? state.active_roles[role][existingIdx].purpose;
    } else {
      state.active_roles[role].push({
        actor_id,
        purpose: purpose ?? null,
        claimed_at: now,
        expires_at: expiresAt,
      });
    }
    state.history.push({ kind: "role_claim", role, actor_id, ts: now });
    state.history = state.history.slice(-200); // bounded
    await this._writeState(state);
    await this._appendEvidence({ kind: "role_claim", role, actor_id, purpose });
    return { ok: true, role, actor_id, expires_at: expiresAt };
  }

  async releaseRole({ role, actor_id }) {
    const state = await this._readState();
    if (state.active_roles[role]) {
      state.active_roles[role] = state.active_roles[role].filter((r) => r.actor_id !== actor_id);
      if (state.active_roles[role].length === 0) delete state.active_roles[role];
    }
    state.history.push({ kind: "role_release", role, actor_id, ts: Date.now() });
    state.history = state.history.slice(-200);
    await this._writeState(state);
    await this._appendEvidence({ kind: "role_release", role, actor_id });
    return { ok: true };
  }

  /**
   * Issue an AS_USER session — typically called by the Hermes Agent bridge
   * after the user has authorized Hermes Agent to act on their behalf.
   * Can also be called directly by the human (via a future CLI/UI).
   *
   * @param {object} args
   * @param {string} args.granted_by - "human" | "hermes-agent" | "ci"
   * @param {string} args.session_id - opaque caller-chosen id
   * @param {object} [args.scope] - capability filter (whitelist of action names)
   * @param {number} [args.ttl_ms]
   */
  async grantUserSession({ granted_by, session_id, scope, ttl_ms }) {
    if (!["human", "hermes-agent", "ci"].includes(granted_by)) {
      throw new Error(`invalid granted_by: ${granted_by}`);
    }
    if (!session_id || typeof session_id !== "string" || session_id.length < 8) {
      throw new Error("session_id must be a string ≥ 8 chars");
    }
    const state = await this._readState();
    const now = Date.now();
    if (state.active_user_session && state.active_user_session.expires_at > now) {
      throw new Error("an active user session exists; revoke it first");
    }
    const session = {
      session_id,
      granted_by,
      scope: scope ?? null,
      issued_at: now,
      expires_at: now + (ttl_ms ?? USER_SESSION_TTL_MS),
      hash: crypto.createHash("sha256").update(`${granted_by}:${session_id}:${now}`).digest("hex"),
    };
    state.active_user_session = session;
    state.history.push({ kind: "user_session_grant", granted_by, session_id, ts: now });
    state.history = state.history.slice(-200);
    await this._writeState(state);
    await this._appendEvidence({ kind: "user_session_grant", granted_by, session_id, hash: session.hash });
    return { ok: true, session };
  }

  async revokeUserSession({ session_id }) {
    const state = await this._readState();
    if (!state.active_user_session || state.active_user_session.session_id !== session_id) {
      return { ok: false, reason: "no matching active session" };
    }
    const revoked = state.active_user_session;
    state.active_user_session = null;
    state.history.push({ kind: "user_session_revoke", session_id, ts: Date.now() });
    state.history = state.history.slice(-200);
    await this._writeState(state);
    await this._appendEvidence({ kind: "user_session_revoke", session_id });
    return { ok: true, revoked };
  }

  /**
   * Check whether an action requiring USER authorization is currently allowed.
   *
   * @param {string} actionName - canonical action identifier
   * @returns {Promise<{allowed: boolean, reason: string, granted_by?: string}>}
   */
  async checkUserAuthorization(actionName) {
    const state = await this._readState();
    const session = state.active_user_session;
    if (!session) {
      return { allowed: false, reason: "no active user session" };
    }
    if (session.expires_at <= Date.now()) {
      // Lazy clear of expired session
      state.active_user_session = null;
      await this._writeState(state);
      await this._appendEvidence({ kind: "user_session_expired_lazy", session_id: session.session_id });
      return { allowed: false, reason: "user session expired" };
    }
    if (session.scope && Array.isArray(session.scope) && !session.scope.includes(actionName)) {
      return {
        allowed: false,
        reason: `action ${actionName} not in scope of active user session`,
        granted_by: session.granted_by,
      };
    }
    return { allowed: true, reason: "ok", granted_by: session.granted_by };
  }

  async getState() {
    const state = await this._readState();
    // Strip session.hash from public read (defense in depth — don't leak the hash to all callers)
    if (state.active_user_session) {
      const { hash, ...rest } = state.active_user_session;
      return { ...state, active_user_session: rest };
    }
    return state;
  }

  /**
   * Prune expired role claims and user sessions. Called by watchdog or doctor.
   */
  async tickExpirations() {
    const state = await this._readState();
    const now = Date.now();
    let changed = false;
    for (const role of Object.keys(state.active_roles)) {
      const before = state.active_roles[role].length;
      state.active_roles[role] = state.active_roles[role].filter((r) => r.expires_at > now);
      if (state.active_roles[role].length === 0) delete state.active_roles[role];
      if (state.active_roles[role]?.length !== before) changed = true;
    }
    if (state.active_user_session && state.active_user_session.expires_at <= now) {
      await this._appendEvidence({
        kind: "user_session_expired_tick",
        session_id: state.active_user_session.session_id,
      });
      state.active_user_session = null;
      changed = true;
    }
    if (changed) await this._writeState(state);
    return { ok: true, pruned: changed };
  }
}

export { ROLES };
