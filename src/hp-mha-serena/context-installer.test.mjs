import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  SERENA_CONTEXT_NAMES,
  installSerenaContexts
} from "./context-installer.mjs";

const sourceDir = path.resolve(".serena", "contexts");

async function withTempHome(fn) {
  const serenaHome = await fs.mkdtemp(path.join(os.tmpdir(), "hp-serena-home-"));
  try {
    await fn(serenaHome);
  } finally {
    await fs.rm(serenaHome, { recursive: true, force: true });
  }
}

test("context catalogue includes every missing ecosystem client/provider", () => {
  assert.deepEqual(SERENA_CONTEXT_NAMES, [
    "devin",
    "kilocode",
    "lm-studio",
    "ollama",
    "windsurf"
  ]);
});

test("installer copies and hashes all repo-owned contexts", async () => {
  await withTempHome(async (serenaHome) => {
    const result = await installSerenaContexts({ sourceDir, serenaHome });
    assert.equal(result.ok, true);
    assert.equal(result.installed.length, 5);
    assert.equal(result.unchanged.length, 0);
    for (const item of result.contexts) {
      assert.match(item.sha256, /^[a-f0-9]{64}$/);
      const installed = await fs.readFile(path.join(serenaHome, "contexts", item.name + ".yml"), "utf8");
      assert.match(installed, /included_optional_tools:\s*\n\s*- get_diagnostics_for_symbol/);
    }
  });
});

test("installer is idempotent and check-only detects drift without overwriting", async () => {
  await withTempHome(async (serenaHome) => {
    await installSerenaContexts({ sourceDir, serenaHome });
    const second = await installSerenaContexts({ sourceDir, serenaHome });
    assert.equal(second.ok, true);
    assert.equal(second.installed.length, 0);
    assert.equal(second.unchanged.length, 5);

    const driftedPath = path.join(serenaHome, "contexts", "windsurf.yml");
    await fs.writeFile(driftedPath, "description: drifted\n", "utf8");
    const check = await installSerenaContexts({ sourceDir, serenaHome, checkOnly: true });
    assert.equal(check.ok, false);
    assert.deepEqual(check.drifted, ["windsurf"]);
    assert.equal(await fs.readFile(driftedPath, "utf8"), "description: drifted\n");
  });
});

test("repair preserves a timestamped backup of a drifted context", async () => {
  await withTempHome(async (serenaHome) => {
    await installSerenaContexts({ sourceDir, serenaHome });
    const target = path.join(serenaHome, "contexts", "devin.yml");
    await fs.writeFile(target, "description: user override\n", "utf8");
    const repaired = await installSerenaContexts({
      sourceDir,
      serenaHome,
      now: () => new Date("2026-08-08T12:34:56.000Z")
    });
    assert.equal(repaired.ok, true);
    assert.deepEqual(repaired.repaired, ["devin"]);
    const backup = path.join(serenaHome, "contexts", "devin.yml.bak-20260808T123456000Z");
    assert.equal(await fs.readFile(backup, "utf8"), "description: user override\n");
  });
});
