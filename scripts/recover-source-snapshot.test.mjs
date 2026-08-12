import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  classifyRecoveryPath,
  isPathInside,
  publicRecoveryManifest,
  sha256File,
  stableManifest
} from "./recover-source-snapshot.mjs";

test("classifyRecoveryPath admits product files and blocks unsafe or generated roots", () => {
  assert.deepEqual(classifyRecoveryPath("src/server.mjs"), { allowed: true, reason: "product-root:src" });
  assert.deepEqual(classifyRecoveryPath("scripts/hp-mha-e2e-smoke-test.mjs"), {
    allowed: true,
    reason: "product-root:scripts"
  });
  assert.deepEqual(classifyRecoveryPath(".env.example"), { allowed: true, reason: "root-file:.env.example" });
  for (const candidate of [
    "node_modules/pkg/index.js",
    "docs/.kilo/node_modules/pkg/index.js",
    ".hermes3d_orchestrator/evidence/ledger.ndjson",
    "tools/unrelated-vendor/server.js",
    "PERF/latest.json",
    ".env",
    "secrets.json",
    "../escape.txt"
  ]) {
    assert.equal(classifyRecoveryPath(candidate).allowed, false, candidate);
  }
});

test("isPathInside rejects sibling-prefix and parent traversal paths", () => {
  const root = path.resolve("C:/release");
  assert.equal(isPathInside(root, path.resolve(root, "src/server.mjs")), true);
  assert.equal(isPathInside(root, path.resolve("C:/release-other/file.mjs")), false);
  assert.equal(isPathInside(root, path.resolve(root, "../escape.mjs")), false);
});

test("sha256File hashes exact file bytes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hp-recovery-test-"));
  const file = path.join(root, "sample.txt");
  try {
    await fs.writeFile(file, "HermesProof\n", "utf8");
    assert.equal(
      await sha256File(file),
      "23ade263eb2f102e4fb512ed0dee13208f9f1a070700fd82600289e575660e34"
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("publicRecoveryManifest redacts local roots and aggregates excluded paths", () => {
  const result = publicRecoveryManifest({
    schema: "hermesproof.source-recovery.v1",
    source_root: "G:/private/source",
    destination_root: "C:/private/destination",
    selected: [{ path: "src/server.mjs", sha256: "a".repeat(64), bytes: 1 }],
    excluded: [
      { path: "tools/a", reason: "blocked-root:tools" },
      { path: "tools/b", reason: "blocked-root:tools" },
      { path: ".env", reason: "secret-like-file" }
    ]
  });
  assert.equal("source_root" in result, false);
  assert.equal("destination_root" in result, false);
  assert.match(result.source_root_sha256, /^[a-f0-9]{64}$/);
  assert.match(result.destination_root_sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.excluded_summary, {
    "blocked-root:tools": 2,
    "secret-like-file": 1
  });
  assert.equal(JSON.stringify(result).includes("private"), false);
});

test("stableManifest sorts selected and excluded paths deterministically", () => {
  const manifest = stableManifest({
    schema: "hermesproof.source-recovery.v1",
    selected: [{ path: "src/z.mjs" }, { path: "src/a.mjs" }],
    excluded: [{ path: "tools/z" }, { path: "tools/a" }]
  });
  assert.deepEqual(manifest.selected.map((entry) => entry.path), ["src/a.mjs", "src/z.mjs"]);
  assert.deepEqual(manifest.excluded.map((entry) => entry.path), ["tools/a", "tools/z"]);
});
