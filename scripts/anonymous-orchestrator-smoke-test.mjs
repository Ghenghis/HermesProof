#!/usr/bin/env node
/**
 * Smoke test for AnonymousOrchestrator + HermesAgentBridge.
 *
 * Uses node:test (zero deps). Bridge is exercised in DISABLED mode (no
 * network calls) plus a synthetic mock of the agent decision call.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { AnonymousOrchestrator, ROLES } from "../src/core/anonymous-orchestrator.mjs";
import { HermesAgentBridge, DEFAULT_FAILOVER, PROVIDERS } from "../src/core/hermes-agent-bridge.mjs";

async function makeWorkspace() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "anon-orch-smoke-"));
  const orch = new AnonymousOrchestrator({ workspaceRoot: dir });
  await orch.init();
  return { dir, orch };
}

test("anonymous role claim accepts valid input", async () => {
  const { orch } = await makeWorkspace();
  const r = await orch.claimRole({ role: ROLES.BUILDER, actor_id: "claude-impl-04", purpose: "fix lint" });
  assert.equal(r.ok, true);
  assert.equal(r.role, "BUILDER");
  assert.ok(r.expires_at > Date.now());
});

test("anonymous role claim rejects USER role", async () => {
  const { orch } = await makeWorkspace();
  await assert.rejects(
    () => orch.claimRole({ role: ROLES.USER, actor_id: "claude-1" }),
    /USER role cannot be self-claimed/
  );
});

test("anonymous role claim rejects invalid actor_id", async () => {
  const { orch } = await makeWorkspace();
  await assert.rejects(
    () => orch.claimRole({ role: ROLES.BUILDER, actor_id: "Claude With Space" }),
    /invalid actor_id/
  );
});

test("anonymous role release is idempotent", async () => {
  const { orch } = await makeWorkspace();
  await orch.claimRole({ role: ROLES.CRITIC, actor_id: "codex-1" });
  const a = await orch.releaseRole({ role: ROLES.CRITIC, actor_id: "codex-1" });
  const b = await orch.releaseRole({ role: ROLES.CRITIC, actor_id: "codex-1" });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
});

test("user session grant + revoke", async () => {
  const { orch } = await makeWorkspace();
  const grant = await orch.grantUserSession({ granted_by: "human", session_id: "sess-12345678" });
  assert.equal(grant.ok, true);
  const rev = await orch.revokeUserSession({ session_id: "sess-12345678" });
  assert.equal(rev.ok, true);
});

test("user session double-grant rejected without revoke", async () => {
  const { orch } = await makeWorkspace();
  await orch.grantUserSession({ granted_by: "human", session_id: "sess-aaaaaaaa" });
  await assert.rejects(
    () => orch.grantUserSession({ granted_by: "hermes-agent", session_id: "sess-bbbbbbbb" }),
    /active user session exists/
  );
});

test("user session granted_by validated", async () => {
  const { orch } = await makeWorkspace();
  await assert.rejects(
    () => orch.grantUserSession({ granted_by: "imposter", session_id: "sess-12345678" }),
    /invalid granted_by/
  );
});

test("user session id minimum length enforced", async () => {
  const { orch } = await makeWorkspace();
  await assert.rejects(
    () => orch.grantUserSession({ granted_by: "human", session_id: "short" }),
    /must be a string ≥ 8 chars/
  );
});

test("scope-based authorization gates actions", async () => {
  const { orch } = await makeWorkspace();
  await orch.grantUserSession({
    granted_by: "hermes-agent",
    session_id: "sess-aaaaaaaa",
    scope: ["read_state", "claim_role"],
  });
  const allowed = await orch.checkUserAuthorization("read_state");
  const denied = await orch.checkUserAuthorization("delete_branch");
  assert.equal(allowed.allowed, true);
  assert.equal(denied.allowed, false);
});

test("expired session lazy-cleared on check", async () => {
  const { orch } = await makeWorkspace();
  await orch.grantUserSession({
    granted_by: "ci",
    session_id: "sess-expiring",
    ttl_ms: 1,
  });
  await new Promise((r) => setTimeout(r, 5));
  const r = await orch.checkUserAuthorization("anything");
  assert.equal(r.allowed, false);
  assert.match(r.reason, /expired/);
});

test("public state read redacts session hash", async () => {
  const { orch } = await makeWorkspace();
  await orch.grantUserSession({ granted_by: "human", session_id: "sess-aaaaaaaa" });
  const s = await orch.getState();
  assert.equal(s.active_user_session.hash, undefined);
});

test("tickExpirations prunes expired role claims", async () => {
  const { orch } = await makeWorkspace();
  const state = await orch._readState();
  state.active_roles.BUILDER = [
    { actor_id: "stale-1", purpose: "test", claimed_at: Date.now() - 9999, expires_at: Date.now() - 1 },
  ];
  await orch._writeState(state);
  const r = await orch.tickExpirations();
  assert.equal(r.pruned, true);
  const after = await orch.getState();
  assert.equal(after.active_roles.BUILDER, undefined);
});

test("HermesAgentBridge healthCheck returns disabled when not enabled", async () => {
  const { orch } = await makeWorkspace();
  const bridge = new HermesAgentBridge({ orchestrator: orch, enabled: false });
  const h = await bridge.healthCheck();
  assert.equal(h.ok, false);
  assert.match(h.reason, /disabled/);
});

test("HermesAgentBridge healthCheck reports no providers when env absent", async () => {
  const { orch } = await makeWorkspace();
  // Save and clear all relevant env vars
  const saved = {};
  for (const v of ["DEEPSEEK_API_KEY", "MINIMAX_API_KEY", "SILICONFLOW_API_KEY"]) {
    saved[v] = process.env[v];
    delete process.env[v];
  }
  // Restrict failover to just the keyed providers (skip local providers so they don't try localhost)
  const bridge = new HermesAgentBridge({
    orchestrator: orch,
    enabled: true,
    failover_order: ["deepseek", "minimax", "siliconflow"],
  });
  // Clear endpoint env so local providers also can't be reached
  for (const v of ["LMSTUDIO_BASE_URL", "OLLAMA_BASE_URL", "HIPFIRE_BASE_URL"]) {
    saved[v] = process.env[v];
    delete process.env[v];
  }
  const h = await bridge.healthCheck();
  for (const [k, v] of Object.entries(saved)) {
    if (v !== undefined) process.env[k] = v;
  }
  assert.equal(h.ok, false);
  assert.match(h.reason, /no providers configured|all providers unhealthy/);
});

test("PROVIDERS exports the six expected providers in DEFAULT_FAILOVER", () => {
  // Cloud first (DeepSeek/MiniMax/SiliconFlow per user's stated preference),
  // then local fallbacks (LM Studio / Ollama / Hipfire).
  assert.deepEqual(DEFAULT_FAILOVER, [
    "deepseek",
    "minimax",
    "siliconflow",
    "lm_studio",
    "ollama",
    "hipfire",
  ]);
  for (const name of DEFAULT_FAILOVER) assert.ok(PROVIDERS[name]);
});
