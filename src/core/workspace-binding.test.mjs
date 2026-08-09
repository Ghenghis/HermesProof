import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  WorkspaceBindingError,
  WorkspaceBindingManager,
  loadOrCreateWorkspaceBindingSecret
} from "./workspace-binding.mjs";

async function withWorkspaces(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hermesproof-binding-"));
  const one = path.join(root, "one");
  const two = path.join(root, "two");
  await mkdir(one);
  await mkdir(two);
  try {
    await fn({ root, one, two });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function fingerprintFactory(headRef) {
  return async (workspaceRoot) => ({
    canonical_root: path.resolve(workspaceRoot),
    workspace_root_hash: "root:" + path.resolve(workspaceRoot),
    git_common_dir_hash: "git:" + path.resolve(workspaceRoot),
    branch: "release/test",
    head: headRef.value,
    remotes_digest: "remotes:test"
  });
}

async function rejectsCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof WorkspaceBindingError);
    assert.equal(error.code, code);
    return true;
  });
}

test("workspace handle verifies only for its exact workspace, principal, policy, and fingerprint", async () => {
  await withWorkspaces(async ({ one, two }) => {
    const headRef = { value: "a".repeat(40) };
    const manager = new WorkspaceBindingManager({
      secret: Buffer.alloc(32, 7),
      now: () => 1_000_000,
      nonceFactory: () => "handle-1",
      fingerprintWorkspace: fingerprintFactory(headRef)
    });

    const binding = await manager.bind({
      workspaceRoot: one,
      principal: "codex-impl-01",
      policyDigest: "policy-v1",
      ttlMs: 60_000
    });
    const verified = await manager.verify({
      token: binding.token,
      workspaceRoot: one,
      principal: "codex-impl-01",
      policyDigest: "policy-v1"
    });

    assert.equal(verified.handle_id, "handle-1");
    assert.equal(verified.workspace_root, path.resolve(one));
    assert.equal(verified.expires_at_ms, 1_060_000);

    await rejectsCode(manager.verify({
      token: binding.token,
      workspaceRoot: two,
      principal: "codex-impl-01",
      policyDigest: "policy-v1"
    }), "WORKSPACE_MISMATCH");
    await rejectsCode(manager.verify({
      token: binding.token,
      workspaceRoot: one,
      principal: "other-agent",
      policyDigest: "policy-v1"
    }), "PRINCIPAL_MISMATCH");
    await rejectsCode(manager.verify({
      token: binding.token,
      workspaceRoot: one,
      principal: "codex-impl-01",
      policyDigest: "policy-v2"
    }), "POLICY_MISMATCH");

    headRef.value = "b".repeat(40);
    await rejectsCode(manager.verify({
      token: binding.token,
      workspaceRoot: one,
      principal: "codex-impl-01",
      policyDigest: "policy-v1"
    }), "WORKSPACE_DRIFT");
  });
});

test("tampered, foreign-secret, malformed, and expired handles fail closed", async () => {
  await withWorkspaces(async ({ one }) => {
    let now = 5_000;
    const options = {
      now: () => now,
      nonceFactory: () => "handle-2",
      fingerprintWorkspace: fingerprintFactory({ value: "c".repeat(40) })
    };
    const manager = new WorkspaceBindingManager({
      ...options,
      secret: Buffer.alloc(32, 3)
    });
    const binding = await manager.bind({
      workspaceRoot: one,
      principal: "codex-impl-01",
      policyDigest: "policy-v1",
      ttlMs: 100
    });

    const [payload, signature] = binding.token.split(".");
    const replacement = payload.at(-1) === "A" ? "B" : "A";
    const tampered = payload.slice(0, -1) + replacement + "." + signature;
    await rejectsCode(manager.verify({
      token: tampered,
      workspaceRoot: one,
      principal: "codex-impl-01",
      policyDigest: "policy-v1"
    }), "INVALID_SIGNATURE");

    const restartedWithWrongSecret = new WorkspaceBindingManager({
      ...options,
      secret: Buffer.alloc(32, 4)
    });
    await rejectsCode(restartedWithWrongSecret.verify({
      token: binding.token,
      workspaceRoot: one,
      principal: "codex-impl-01",
      policyDigest: "policy-v1"
    }), "INVALID_SIGNATURE");

    await rejectsCode(manager.verify({
      token: "not-a-binding",
      workspaceRoot: one,
      principal: "codex-impl-01",
      policyDigest: "policy-v1"
    }), "MALFORMED_TOKEN");

    now = 5_101;
    await rejectsCode(manager.verify({
      token: binding.token,
      workspaceRoot: one,
      principal: "codex-impl-01",
      policyDigest: "policy-v1"
    }), "EXPIRED_TOKEN");
  });
});

test("persisted workspace binding secret survives a service restart", async () => {
  await withWorkspaces(async ({ root }) => {
    const stateDir = path.join(root, "state");
    const first = await loadOrCreateWorkspaceBindingSecret(stateDir);
    const second = await loadOrCreateWorkspaceBindingSecret(stateDir);

    assert.equal(first.length, 32);
    assert.deepEqual(second, first);
  });
});
