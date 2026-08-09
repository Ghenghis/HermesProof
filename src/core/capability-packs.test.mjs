import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { CapabilityPackManager, validateCapabilityPack } from "./capability-packs.mjs";
import { KILO_BACKEND_CAPABILITY_PACK } from "./kilo-backend-kit.mjs";

const kiloPack = {
  id: "kilo-backend",
  namespace: "io.hermesproof.kilo",
  version: "7.4.20",
  source: {
    type: "npm",
    package: "@kilocode/cli",
    integrity: "sha512-u/9CvTuf5TkiHFqe5YDFcsglL1XWMDJ3f4Cjn6qIEMHPSrN4HBOLxog5kifrBoYjmmhhgfX73C8DyXKRwXGwxA=="
  },
  capabilities: ["kilo.cli", "kilo.serve", "mcp.client"],
  permissions: ["workspace:read", "process:child"],
  executable_sha256: "c".repeat(64),
  schema_sha256: "d".repeat(64),
  sbom: { format: "spdx-json", sha256: "e".repeat(64) },
  health_probe: { type: "command", args: ["--version"] },
  rollback: { strategy: "content-addressed-previous" },
  locality: "local",
  cost: "zero",
  default_enabled: false
};

test("pack validation requires pinned supply-chain and rollback metadata", () => {
  assert.equal(validateCapabilityPack(kiloPack).ok, true);
  assert.throws(
    () => validateCapabilityPack({ ...kiloPack, version: "latest" }),
    /pinned version/i
  );
  assert.throws(
    () => validateCapabilityPack({ ...kiloPack, source: { type: "npm", package: "@kilocode/cli" } }),
    /integrity/i
  );
});

test("resolver selects the smallest local zero-cost set and plans no global mutation", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hps-packs-"));
  try {
    const manager = new CapabilityPackManager({
      workspaceRoot,
      catalog: [
        kiloPack,
        {
          ...kiloPack,
          id: "remote-kilo",
          namespace: "io.example.remote",
          source: { type: "https", url: "https://example.invalid/kilo", integrity: "sha256-" + "f".repeat(64) },
          locality: "remote",
          cost: "paid"
        }
      ]
    });
    await manager.init();
    const resolved = manager.resolve(["kilo.cli", "mcp.client"]);
    assert.deepEqual(resolved.selected_pack_ids, ["kilo-backend"]);
    const plan = manager.plan("kilo-backend");
    assert.equal(plan.global_install, false);
    assert.equal(plan.enabled_after_install, false);
    assert.match(plan.sandbox_path, /capability-packs/);
    assert.equal(plan.source.version, "7.4.20");
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("dry-run never installs; verified apply remains disabled and drift quarantines", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hps-packs-"));
  const calls = [];
  try {
    const manager = new CapabilityPackManager({
      workspaceRoot,
      catalog: [kiloPack],
      installer: async ({ plan }) => {
        calls.push(plan.pack_id);
        return {
          executable_sha256: kiloPack.executable_sha256,
          schema_sha256: kiloPack.schema_sha256,
          package_integrity: kiloPack.source.integrity
        };
      }
    });
    await manager.init();
    const dry = await manager.install({ packId: "kilo-backend", apply: false });
    assert.equal(dry.status, "planned");
    assert.equal(calls.length, 0);

    const installed = await manager.install({ packId: "kilo-backend", apply: true });
    assert.equal(installed.status, "installed");
    assert.equal(installed.enabled, false);
    assert.deepEqual(calls, ["kilo-backend"]);

    const drift = await manager.verifyInstalled("kilo-backend", {
      executable_sha256: "0".repeat(64),
      schema_sha256: kiloPack.schema_sha256,
      package_integrity: kiloPack.source.integrity
    });
    assert.equal(drift.status, "quarantined");
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("dynamic provenance records the installed executable and generated SBOM hashes", async () => {
  assert.equal(validateCapabilityPack(KILO_BACKEND_CAPABILITY_PACK).ok, true);
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hps-packs-dynamic-"));
  try {
    const receipt = {
      executable_sha256: "f".repeat(64),
      schema_sha256: KILO_BACKEND_CAPABILITY_PACK.schema_sha256,
      package_integrity: KILO_BACKEND_CAPABILITY_PACK.source.integrity,
      sbom_sha256: "1".repeat(64)
    };
    const manager = new CapabilityPackManager({
      workspaceRoot,
      catalog: [KILO_BACKEND_CAPABILITY_PACK],
      installer: async () => receipt
    });
    await manager.init();
    const result = await manager.install({ packId: "kilo-backend", apply: true });
    assert.equal(result.status, "installed");
    assert.equal(result.receipt.executable_sha256, "f".repeat(64));
    assert.equal(result.receipt.sbom_sha256, "1".repeat(64));
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});
