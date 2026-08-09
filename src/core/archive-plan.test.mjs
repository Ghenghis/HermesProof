import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ARCHIVE_PLAN_CONTRACT_VERSION,
  ARCHIVE_PLAN_SCHEMA,
  evaluateArchivePlan,
} from "./archive-plan.mjs";

function sum(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hp-archive-"));
  const source = path.join(root, "source");
  const archive = path.join(root, "archive");
  await fs.mkdir(path.join(source, "test-results"), { recursive: true });
  await fs.mkdir(archive, { recursive: true });
  await fs.writeFile(path.join(source, "test-results", "proof.json"), "real proof", "utf8");
  return { root, source, archive };
}

function plan(paths, sha = sum("real proof")) {
  return evaluateArchivePlan({
    schema: ARCHIVE_PLAN_SCHEMA,
    contractVersion: ARCHIVE_PLAN_CONTRACT_VERSION,
    sourceRoot: paths.source,
    archiveRoot: paths.archive,
    allowedSourceRoots: [paths.source],
    allowedArchiveRoots: [paths.archive],
    archiveId: "candidate-20260710",
    manifest: {
      schema: "hermesproof.expected-diff-manifest.v2",
      releaseClaimAllowed: false,
      entries: [{ path: "test-results/proof.json", status: "??", classification: "KEEP_TEST_PROOF", sha256: sha }],
    },
  });
}

describe("archive plan", () => {
  it("creates a hash-bound proposal without moving or deleting a source artifact", async () => {
    const paths = await fixture();
    try {
      const result = await plan(paths);
      assert.equal(result.ok, true);
      assert.equal(result.execution.movePerformed, false);
      assert.equal(result.execution.deleteSourceAllowed, false);
      assert.equal(result.entries[0].archiveRelativePath, "candidate-20260710/test-results/proof.json");
      assert.equal(await fs.readFile(path.join(paths.source, "test-results", "proof.json"), "utf8"), "real proof");
      await assert.rejects(fs.stat(path.join(paths.archive, "candidate-20260710", "test-results", "proof.json")));
    } finally {
      await fs.rm(paths.root, { recursive: true, force: true });
    }
  });

  it("blocks a stale or incomplete plan without treating the source as disposable", async () => {
    const paths = await fixture();
    try {
      const result = await plan(paths, "a".repeat(64));
      assert.equal(result.ok, false);
      assert.ok(result.findings.includes("entry_hash_mismatch:test-results/proof.json"));
      assert.equal(await fs.readFile(path.join(paths.source, "test-results", "proof.json"), "utf8"), "real proof");
    } finally {
      await fs.rm(paths.root, { recursive: true, force: true });
    }
  });
});
