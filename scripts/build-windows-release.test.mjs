import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createReleaseManifest,
  filterReleasePaths,
  verifyReleaseManifest
} from "./build-windows-release.mjs";

test("release path filter excludes secrets, caches, GitHub automation, and generated junk", () => {
  const selected = filterReleasePaths([
    "src/server.mjs",
    "scripts/hermesproof-launch.mjs",
    "install-hermesproof.ps1",
    "docs/WINDOWS_INSTALL.md",
    ".github/workflows/pages.yml",
    ".git/config",
    ".env",
    "node_modules/pkg/index.js",
    "dist/old.zip",
    "coverage/result.json",
    "tmp/cache.tmp",
    "private_keys/key.pem"
  ]);
  assert.deepEqual(selected, [
    "src/server.mjs",
    "scripts/hermesproof-launch.mjs",
    "install-hermesproof.ps1",
    "docs/WINDOWS_INSTALL.md"
  ]);
});

test("manifest hashes every payload file and detects tampering", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hermesproof-release-manifest-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "src", "server.mjs"), "export {};\n");
  await fs.writeFile(path.join(root, "package.json"), "{\"name\":\"fixture\"}\n");
  const manifest = await createReleaseManifest({
    root,
    files: ["package.json", "src/server.mjs"],
    version: "0.9.0-rc.1",
    sourceSha: "a".repeat(40)
  });
  assert.equal(manifest.files.length, 2);
  assert.equal(manifest.schema, "hermesproof.windows-release.v1");
  assert.equal((await verifyReleaseManifest({ root, manifest })).ok, true);
  await fs.writeFile(path.join(root, "src", "server.mjs"), "tampered\n");
  const failed = await verifyReleaseManifest({ root, manifest });
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.mismatches, ["src/server.mjs"]);
});
