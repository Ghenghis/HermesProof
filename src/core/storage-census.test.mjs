import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  evaluateStorageCensus,
  STORAGE_CENSUS_CONTRACT_VERSION,
  STORAGE_CENSUS_SCHEMA,
} from "./storage-census.mjs";

async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hp-storage-"));
  await fs.mkdir(path.join(dir, "test-results"), { recursive: true });
  await fs.mkdir(path.join(dir, "cache"), { recursive: true });
  await fs.writeFile(path.join(dir, "test-results", "proof.vsix"), "proof", "utf8");
  await fs.writeFile(path.join(dir, "cache", "build.tmp"), "temp", "utf8");
  return dir;
}

function scan(dir, overrides = {}) {
  return evaluateStorageCensus({
    schema: STORAGE_CENSUS_SCHEMA,
    contractVersion: STORAGE_CENSUS_CONTRACT_VERSION,
    allowedRoots: [dir],
    roots: [dir],
    maxFiles: 10,
    maxDepth: 4,
    groupDepth: 1,
    ...overrides,
  });
}

describe("storage census", () => {
  it("classifies known proof and temporary artifacts without changing them", async () => {
    const dir = await fixture();
    try {
      const result = await scan(dir);
      assert.equal(result.ok, true);
      assert.equal(result.verdict, "pass");
      assert.deepEqual(result.destructive_actions_performed, []);
      assert.equal(result.reports[0].groups[0].retention.includes("review") || result.reports[0].groups[0].retention.includes("retain"), true);
      assert.ok(result.reports[0].classifications.includes("proof"));
      assert.ok(result.reports[0].classifications.includes("dependency"));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("blocks unknown roots and incomplete scans instead of calling data disposable", async () => {
    const dir = await fixture();
    try {
      const blocked = await scan(dir, { roots: [path.dirname(dir)] });
      assert.equal(blocked.ok, false);
      assert.ok(blocked.findings.some((finding) => finding.startsWith("root_outside_allowlist:")));
      const partial = await scan(dir, { maxFiles: 1 });
      assert.equal(partial.ok, false);
      assert.ok(partial.findings.some((finding) => finding.endsWith(":file_limit_reached")));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
