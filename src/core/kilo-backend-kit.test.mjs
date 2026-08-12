import test from "node:test";
import assert from "node:assert/strict";

import {
  KILO_BACKEND_CAPABILITY_PACK,
  assessKiloBackend,
  createKiloBackendInstallPlan,
  probeKiloBackend
} from "./kilo-backend-kit.mjs";

const rc25 = {
  extension_version: "7.10.0-rc.25",
  platform: "win32",
  commands: {
    node: { present: true, version: "22.16.0" },
    bun: { present: true, version: "1.2.20" },
    kilo: { present: false },
    git: { present: true },
    gh: { present: true },
    glab: { present: false },
    docker: { present: true, engine_ready: false },
    ollama: { present: true }
  },
  bundled_kilo: {
    present: true,
    path: "G:/Github/kilocode-2026-openhands/packages/kilo-vscode/bin/kilo.exe",
    bytes: 206884864,
    sha256: "a".repeat(64)
  },
  endpoints: {
    ollama: { ok: true, model_count: 30, embedding_models: ["bge-m3:latest"] },
    lm_studio: { ok: false }
  },
  indexing: {
    lancedb_package: true,
    qdrant_package: true
  },
  integrations: {
    hermesproof: true,
    serena: true,
    mcp_config: true,
    browser_runner: true
  }
};

test("RC25 uses its bundled CLI fallback and distinguishes optional Docker/LM Studio gaps", () => {
  const report = assessKiloBackend(rc25);
  assert.equal(report.ok, true);
  assert.equal(report.release_blockers.length, 0);
  assert.equal(report.components.kilo_cli.status, "REPLACED");
  assert.equal(report.components.kilo_cli.replacement, "bundled-rc25-cli");
  assert.equal(report.components.ollama.status, "PROVEN");
  assert.equal(report.components.docker.status, "NOT_SHIPPED");
  assert.equal(report.components.docker.release_blocking, false);
  assert.equal(report.components.lm_studio.release_blocking, false);
});

test("missing both PATH and bundled Kilo CLI creates a resolvable release blocker", () => {
  const report = assessKiloBackend({
    ...rc25,
    bundled_kilo: { present: false },
    commands: { ...rc25.commands, kilo: { present: false } }
  });
  assert.equal(report.ok, false);
  assert.deepEqual(report.release_blockers.map((item) => item.id), ["KILO-BACKEND-CLI"]);
  assert.ok(report.required_capabilities.includes("kilo.cli"));
});

test("Kilo backend pack is pinned, least privilege, dynamic-provenance, and isolated", () => {
  assert.equal(KILO_BACKEND_CAPABILITY_PACK.version, "7.4.20");
  assert.equal(KILO_BACKEND_CAPABILITY_PACK.default_enabled, false);
  assert.equal(KILO_BACKEND_CAPABILITY_PACK.source.package, "@kilocode/cli");
  assert.equal(KILO_BACKEND_CAPABILITY_PACK.executable_sha256, null);
  assert.equal(KILO_BACKEND_CAPABILITY_PACK.sbom.generated_at_install, true);
  assert.match(KILO_BACKEND_CAPABILITY_PACK.schema_sha256, /^[a-f0-9]{64}$/);
  assert.notEqual(KILO_BACKEND_CAPABILITY_PACK.schema_sha256, "d".repeat(64));
  const plan = createKiloBackendInstallPlan({
    report: assessKiloBackend({ ...rc25, bundled_kilo: { present: false } }),
    workspaceRoot: "C:/work/project"
  });
  assert.equal(plan.global_install, false);
  assert.equal(plan.enable_after_install, false);
  assert.ok(plan.pack_ids.includes("kilo-backend"));
  assert.ok(plan.health_probes.includes("kilo --version"));
});

test("live doctor composes command, bundle, endpoint, indexing, and integration probes", async () => {
  const commandFacts = {
    node: { present: true, version: "22.16.0" },
    bun: { present: true, version: "1.2.20" },
    kilo: { present: false },
    git: { present: true, version: "2.50.0" },
    gh: { present: true, version: "2.76.0" },
    glab: { present: false },
    docker: { present: true, engine_ready: false },
    ollama: { present: true, version: "0.11.4" }
  };
  const result = await probeKiloBackend({
    extensionVersion: "7.10.0-rc.25",
    bundledKiloPath: "G:/fixture/kilo.exe",
    commandProbe: async (name) => commandFacts[name],
    fileProbe: async () => ({
      present: true,
      bytes: 206884864,
      sha256: "f666f1ce9a55d3fdaf620781e34bed680c850a45f6ac85eb8bdc94c435335ab1",
      version: "0.0.0-codex-gate11-strong-model-repair-202608050735"
    }),
    endpointProbe: async (name) => name === "ollama"
      ? { ok: true, model_count: 30, embedding_models: ["bge-m3:latest"] }
      : { ok: false },
    indexing: { lancedb_package: true, qdrant_package: true },
    integrations: {
      hermesproof: true,
      serena: true,
      mcp_config: true,
      browser_runner: true
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.inventory.bundled_kilo.sha256, "f666f1ce9a55d3fdaf620781e34bed680c850a45f6ac85eb8bdc94c435335ab1");
  assert.equal(result.inventory.bundled_kilo.version, "0.0.0-codex-gate11-strong-model-repair-202608050735");
  assert.equal(result.components.docker.release_blocking, false);
  assert.deepEqual(result.release_blockers, []);
});
