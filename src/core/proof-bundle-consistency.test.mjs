import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { inspectProofBundleConsistency } from "./proof-bundle-consistency.mjs";

function bundleForDigest(digest) {
  const payload = Buffer.from(JSON.stringify({
    spec: { data: { hash: { algorithm: "sha256", value: digest } } }
  })).toString("base64");
  return JSON.stringify({ rekorBundle: { Payload: { body: payload } } });
}

test("proof bundle consistency accepts a bundle bound to the current proof", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hermesproof-proof-bundle-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const proofFile = path.join(root, "latest.json");
  const bundleFile = proofFile + ".cosign.bundle";
  await writeFile(proofFile, "current proof\n", "utf8");
  const baseline = await inspectProofBundleConsistency({ proofFile, bundleFile });
  await writeFile(bundleFile, bundleForDigest(baseline.proofSha256), "utf8");
  const result = await inspectProofBundleConsistency({ proofFile, bundleFile });
  assert.equal(result.present, true);
  assert.equal(result.matches, true);
});

test("proof bundle consistency rejects a stale signed digest", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hermesproof-proof-bundle-stale-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const proofFile = path.join(root, "latest.json");
  const bundleFile = proofFile + ".cosign.bundle";
  await writeFile(proofFile, "current proof\n", "utf8");
  await writeFile(bundleFile, bundleForDigest("0".repeat(64)), "utf8");
  const result = await inspectProofBundleConsistency({ proofFile, bundleFile });
  assert.equal(result.present, true);
  assert.equal(result.matches, false);
});

test("repository never retains a stale proof bundle", async () => {
  const root = path.resolve(import.meta.dirname, "../..");
  const result = await inspectProofBundleConsistency({
    proofFile: path.join(root, "PROOF", "latest.json"),
    bundleFile: path.join(root, "PROOF", "latest.json.cosign.bundle")
  });
  assert.equal(result.present && !result.matches, false);
});
