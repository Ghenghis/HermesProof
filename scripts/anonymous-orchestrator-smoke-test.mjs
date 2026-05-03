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
  const grant = await orch.grantUserSession({
    granted_by: "hermes-agent",
    session_id: "sess-12345678",
    scope: ["read_state"],
  });
  assert.equal(grant.ok, true);
  const rev = await orch.revokeUserSession({ session_id: "sess-12345678" });
  assert.equal(rev.ok, true);
});

test("user session double-grant rejected without revoke", async () => {
  const { orch } = await makeWorkspace();
  await orch.grantUserSession({
    granted_by: "hermes-agent",
    session_id: "sess-aaaaaaaa",
    scope: ["read_state"],
  });
  await assert.rejects(
    () => orch.grantUserSession({
      granted_by: "hermes-agent",
      session_id: "sess-bbbbbbbb",
      scope: ["read_state"],
    }),
    /active user session exists/
  );
});

test("user session granted_by validated", async () => {
  const { orch } = await makeWorkspace();
  await assert.rejects(
    () => orch.grantUserSession({
      granted_by: "imposter",
      session_id: "sess-12345678",
      scope: ["read_state"],
    }),
    /invalid granted_by/
  );
});

test("user session id minimum length enforced", async () => {
  const { orch } = await makeWorkspace();
  await assert.rejects(
    () => orch.grantUserSession({
      granted_by: "hermes-agent",
      session_id: "short",
      scope: ["read_state"],
    }),
    /must be a string ≥ 8 chars/
  );
});

test("P0-5 hardening: scope is required and must be non-empty array", async () => {
  const { orch } = await makeWorkspace();
  // null scope rejected
  await assert.rejects(
    () => orch.grantUserSession({ granted_by: "hermes-agent", session_id: "sess-pppppppp" }),
    /scope is required.*non-empty array/
  );
  // empty array rejected
  await assert.rejects(
    () => orch.grantUserSession({ granted_by: "hermes-agent", session_id: "sess-pppppppp", scope: [] }),
    /scope is required.*non-empty array/
  );
  // non-string entry rejected
  await assert.rejects(
    () => orch.grantUserSession({ granted_by: "hermes-agent", session_id: "sess-pppppppp", scope: [42] }),
    /scope entries must be non-empty strings/
  );
});

test('P0-5 hardening: granted_by:"human" requires HERMES_HUMAN_GRANT_SECRET env + matching human_secret', async () => {
  const { orch } = await makeWorkspace();
  // No env set → reject
  delete process.env.HERMES_HUMAN_GRANT_SECRET;
  await assert.rejects(
    () => orch.grantUserSession({
      granted_by: "human",
      session_id: "sess-humanaaa",
      scope: ["read_state"],
      human_secret: "anything",
    }),
    /HERMES_HUMAN_GRANT_SECRET env var/
  );
  // Env set but no human_secret arg → reject
  process.env.HERMES_HUMAN_GRANT_SECRET = "the-real-secret";
  try {
    await assert.rejects(
      () => orch.grantUserSession({
        granted_by: "human",
        session_id: "sess-humanaaa",
        scope: ["read_state"],
      }),
      /requires human_secret/
    );
    // Wrong human_secret → reject
    await assert.rejects(
      () => orch.grantUserSession({
        granted_by: "human",
        session_id: "sess-humanaaa",
        scope: ["read_state"],
        human_secret: "wrong-secret",
      }),
      /human_secret does not match/
    );
    // Correct human_secret → accept
    const ok = await orch.grantUserSession({
      granted_by: "human",
      session_id: "sess-humanaaa",
      scope: ["read_state"],
      human_secret: "the-real-secret",
    });
    assert.equal(ok.ok, true);
  } finally {
    delete process.env.HERMES_HUMAN_GRANT_SECRET;
  }
});

test('P0-5 hardening: granted_by:"ci" requires CI=true env', async () => {
  const { orch } = await makeWorkspace();
  const savedCi = process.env.CI;
  delete process.env.CI;
  try {
    await assert.rejects(
      () => orch.grantUserSession({
        granted_by: "ci",
        session_id: "sess-ciaaaaaa",
        scope: ["read_state"],
      }),
      /CI=true env var/
    );
  } finally {
    if (savedCi !== undefined) process.env.CI = savedCi;
  }
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
  // Use hermes-agent (no env-binding requirement) to set up the test session.
  await orch.grantUserSession({
    granted_by: "hermes-agent",
    session_id: "sess-expiring",
    scope: ["anything"],
    ttl_ms: 1,
  });
  await new Promise((r) => setTimeout(r, 5));
  const r = await orch.checkUserAuthorization("anything");
  assert.equal(r.allowed, false);
  assert.match(r.reason, /expired/);
});

test("public state read redacts session hash", async () => {
  const { orch } = await makeWorkspace();
  await orch.grantUserSession({
    granted_by: "hermes-agent",
    session_id: "sess-aaaaaaaa",
    scope: ["read_state"],
  });
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

test("P0-1 + P0-3: serializes concurrent claimRole, evidence chain stays intact", async () => {
  // Pre-fix (audit P0-1): two concurrent claimRole calls could both read
  // the same active_roles[role] array, both push, both write — last-writer-
  // wins drops one entry. Pre-fix (audit P0-3): both calls' evidence
  // appends could race on `appendChainedJsonLine` and fork the chain.
  // After Wave 3, both are serialized: 50 concurrent claims for distinct
  // actors all land, AND the chained ledger has zero forks.
  const { orch, dir } = await makeWorkspace();
  const N = 50;
  const calls = Array.from({ length: N }, (_, i) =>
    orch.claimRole({ role: "BUILDER", actor_id: `racer-${i}`, purpose: `race ${i}` })
  );
  await Promise.all(calls);

  const state = await orch.getState();
  const builders = state.active_roles.BUILDER || [];
  // Each actor_id is distinct → all N must be present (no lost claims).
  assert.equal(builders.length, N, `expected ${N} BUILDER actors, got ${builders.length}`);
  const ids = new Set(builders.map((b) => b.actor_id));
  assert.equal(ids.size, N, "all actor_ids must be unique and preserved");

  // Verify the chained ledger is intact — every entry from this orch's
  // _appendEvidence ran through appendChainedJsonLine (P0-3 fix), so
  // verifyChainedLog must see a clean chain with no first_break.
  const { verifyChainedLog, statePaths } = await import("../src/core/fs-utils.mjs");
  const ledgerFile = statePaths(dir).evidenceFile;
  const v = await verifyChainedLog(ledgerFile);
  assert.equal(v.first_break, null, `chain must be intact; got first_break=${JSON.stringify(v.first_break)}`);
  assert.ok(v.chained >= N, `expected ≥ ${N} chained entries (one per claimRole), got ${v.chained}`);
});

test("P0-4: anon-orch evidence routes to the chained ledger (not sibling evidence.ndjson)", async () => {
  const { orch, dir } = await makeWorkspace();
  await orch.claimRole({ role: "BUILDER", actor_id: "ledger-test", purpose: "ledger routing" });

  // Pre-Wave-3 the anon-orch wrote to `${stateDir}/evidence.ndjson` directly,
  // bypassing the chain. Post-fix, evidence routes through statePaths().evidenceFile
  // which is the chained ledger. Verify by checking the chained ledger has
  // a role_claim entry AND the legacy file either doesn't exist or is empty.
  const { statePaths, verifyChainedLog } = await import("../src/core/fs-utils.mjs");
  const ledger = await verifyChainedLog(statePaths(dir).evidenceFile);
  assert.ok(ledger.chained >= 1, "chained ledger must contain the claimRole evidence");

  const legacyPath = path.join(dir, ".hermes3d_orchestrator", "evidence.ndjson");
  let legacyContent = "";
  try {
    legacyContent = await fs.readFile(legacyPath, "utf8");
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  // The legacy unchained file must not have NEW entries from claimRole.
  // (Pre-fix it would have at minimum the role_claim line.)
  assert.equal(legacyContent.trim(), "", "legacy evidence.ndjson must not receive new entries post-Wave-3");
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
