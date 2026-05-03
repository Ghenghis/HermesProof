import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  isArtifactName,
  classifyArtifact,
  ARTIFACT_EXTENSIONS,
  runReleaseChecksumGate
} from "./release-checksum.mjs";

test("isArtifactName accepts known release extensions, rejects sidecars and dotfiles", () => {
  assert.equal(isArtifactName("hermesproof-0.6.0.tgz"), true);
  assert.equal(isArtifactName("hermesproof-0.6.0.tar.gz"), true);
  assert.equal(isArtifactName("hermesproof.zip"), true);
  // sidecars are NOT artifacts
  assert.equal(isArtifactName("hermesproof-0.6.0.tgz.sha256"), false);
  assert.equal(isArtifactName("hermesproof-0.6.0.tgz.sig"), false);
  assert.equal(isArtifactName("hermesproof-0.6.0.tgz.cosign.bundle"), false);
  // dotfiles excluded
  assert.equal(isArtifactName(".gitkeep"), false);
  assert.equal(isArtifactName(""), false);
  // unknown extensions excluded
  assert.equal(isArtifactName("README.md"), false);
});

test("ARTIFACT_EXTENSIONS is a frozen non-empty list", () => {
  assert.ok(Object.isFrozen(ARTIFACT_EXTENSIONS));
  assert.ok(ARTIFACT_EXTENSIONS.length > 5);
});

test("classifyArtifact: ok when both .sha256 and .sig sidecars are present", () => {
  const files = new Set([
    "hp-0.6.0.tgz",
    "hp-0.6.0.tgz.sha256",
    "hp-0.6.0.tgz.sig"
  ]);
  const r = classifyArtifact({ name: "hp-0.6.0.tgz", files });
  assert.equal(r.ok, true);
  assert.deepEqual(r.missing, []);
  assert.equal(r.checksum_sidecar, "hp-0.6.0.tgz.sha256");
  assert.equal(r.signature_sidecar, "hp-0.6.0.tgz.sig");
});

test("classifyArtifact: cosign bundle counts as a valid signature", () => {
  const files = new Set([
    "hp-0.6.0.tgz",
    "hp-0.6.0.tgz.sha256",
    "hp-0.6.0.tgz.cosign.bundle"
  ]);
  const r = classifyArtifact({ name: "hp-0.6.0.tgz", files });
  assert.equal(r.ok, true);
  assert.equal(r.signature_sidecar, "hp-0.6.0.tgz.cosign.bundle");
});

test("classifyArtifact: missing sha256 surfaced", () => {
  const files = new Set(["hp.tgz", "hp.tgz.sig"]);
  const r = classifyArtifact({ name: "hp.tgz", files });
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ["sha256"]);
});

test("classifyArtifact: missing both sidecars surfaced", () => {
  const files = new Set(["hp.tgz"]);
  const r = classifyArtifact({ name: "hp.tgz", files });
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ["sha256", "signature"]);
});

test("runReleaseChecksumGate: dormant when no dist/release dirs exist", async () => {
  const sb = await fs.mkdtemp(path.join(os.tmpdir(), "hp-rc-empty-"));
  try {
    const r = await runReleaseChecksumGate({ root: sb });
    assert.equal(r.ok, true);
    assert.match(r.details, /no release artifacts/);
  } finally {
    await fs.rm(sb, { recursive: true, force: true });
  }
});

test("runReleaseChecksumGate: passes when every artifact has both sidecars", async () => {
  const sb = await fs.mkdtemp(path.join(os.tmpdir(), "hp-rc-pass-"));
  try {
    const dist = path.join(sb, "dist");
    await fs.mkdir(dist, { recursive: true });
    const artifact = path.join(dist, "hp-0.6.0.tgz");
    await fs.writeFile(artifact, "fake tarball bytes");
    const sha = crypto.createHash("sha256").update("fake tarball bytes").digest("hex");
    await fs.writeFile(`${artifact}.sha256`, `${sha}  hp-0.6.0.tgz\n`);
    await fs.writeFile(`${artifact}.sig`, "fake-sig");
    const r = await runReleaseChecksumGate({ root: sb, verifySha256: true });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.evidence.artifacts.length, 1);
    assert.equal(r.evidence.artifacts[0].sha256_match, true);
  } finally {
    await fs.rm(sb, { recursive: true, force: true });
  }
});

test("runReleaseChecksumGate: fails when an artifact lacks a signature sidecar", async () => {
  const sb = await fs.mkdtemp(path.join(os.tmpdir(), "hp-rc-fail-"));
  try {
    const dist = path.join(sb, "dist");
    await fs.mkdir(dist, { recursive: true });
    await fs.writeFile(path.join(dist, "hp.zip"), "z");
    await fs.writeFile(path.join(dist, "hp.zip.sha256"), "deadbeef".repeat(8) + "  hp.zip\n");
    const r = await runReleaseChecksumGate({ root: sb });
    assert.equal(r.ok, false);
    assert.equal(r.evidence.failing.length, 1);
    assert.deepEqual(r.evidence.failing[0].missing, ["signature"]);
  } finally {
    await fs.rm(sb, { recursive: true, force: true });
  }
});

test("runReleaseChecksumGate: detects sha256 mismatch when --verify-sha256 set", async () => {
  const sb = await fs.mkdtemp(path.join(os.tmpdir(), "hp-rc-mismatch-"));
  try {
    const dist = path.join(sb, "dist");
    await fs.mkdir(dist, { recursive: true });
    const artifact = path.join(dist, "hp.tgz");
    await fs.writeFile(artifact, "real bytes");
    // Sidecar contains a wrong hash.
    await fs.writeFile(`${artifact}.sha256`, "0".repeat(64) + "  hp.tgz\n");
    await fs.writeFile(`${artifact}.sig`, "sig");
    const r = await runReleaseChecksumGate({ root: sb, verifySha256: true });
    assert.equal(r.ok, false);
    assert.equal(r.evidence.sha_mismatches.length, 1);
  } finally {
    await fs.rm(sb, { recursive: true, force: true });
  }
});
