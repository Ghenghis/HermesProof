import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  SIGNATURE_SCHEMA,
  canonicalSignaturePayload,
  publicKeyFingerprint,
  signReleaseArtifact,
  verifyReleaseArtifact
} from "./release-signing.mjs";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hp-release-signing-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const artifactFile = path.join(root, "HermesProof-test.zip");
  const privateKeyFile = path.join(root, "private.pem");
  const publicKeyFile = path.join(root, "public.pem");
  await fs.writeFile(artifactFile, "verified release bytes");
  await fs.writeFile(privateKeyFile, privateKey.export({ type: "pkcs8", format: "pem" }));
  await fs.writeFile(publicKeyFile, publicKey.export({ type: "spki", format: "pem" }));
  return { root, artifactFile, privateKeyFile, publicKeyFile, publicKey };
}

test("canonical payload and public-key fingerprint have stable formats", () => {
  const { publicKey } = crypto.generateKeyPairSync("ed25519");
  const fingerprint = publicKeyFingerprint(publicKey);
  const expectedFingerprint = "sha256:" + crypto
    .createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex");
  assert.equal(fingerprint, expectedFingerprint);
  const fields = {
    schema: SIGNATURE_SCHEMA,
    algorithm: "Ed25519",
    artifact: "release.zip",
    sha256: "a".repeat(64),
    keyFingerprint: "sha256:" + "b".repeat(64)
  };
  assert.equal(
    canonicalSignaturePayload(fields).toString("utf8"),
    [
      "hermesproof.release-signature.v1",
      "Ed25519",
      "release.zip",
      "a".repeat(64),
      "sha256:" + "b".repeat(64),
      ""
    ].join("\n")
  );
});

test("signs an artifact and verifies strict sibling sidecars", async (t) => {
  const f = await fixture(t);
  const signed = await signReleaseArtifact(f);
  assert.equal(signed.checksumFile, f.artifactFile + ".sha256");
  assert.equal(signed.signatureFile, f.artifactFile + ".sig");
  assert.match(signed.sha256, /^[0-9a-f]{64}$/);
  assert.equal(signed.keyFingerprint, publicKeyFingerprint(f.publicKey));
  assert.equal(await fs.readFile(signed.checksumFile, "utf8"), signed.sha256 + "  HermesProof-test.zip\n");
  const envelope = JSON.parse(await fs.readFile(signed.signatureFile, "utf8"));
  assert.deepEqual(Object.keys(envelope), [
    "schema", "algorithm", "artifact", "sha256", "keyFingerprint", "signature"
  ]);
  const verified = await verifyReleaseArtifact({
    artifactFile: f.artifactFile,
    publicKeyFile: f.publicKeyFile
  });
  assert.equal(verified.ok, true, JSON.stringify(verified));
  assert.equal(verified.sha256, signed.sha256);
  assert.equal(verified.keyFingerprint, signed.keyFingerprint);
});

test("rejects archive bytes changed after signing", async (t) => {
  const f = await fixture(t);
  await signReleaseArtifact(f);
  await fs.appendFile(f.artifactFile, "tampered");
  const result = await verifyReleaseArtifact({ artifactFile: f.artifactFile, publicKeyFile: f.publicKeyFile });
  assert.deepEqual({ ok: result.ok, reason: result.reason }, { ok: false, reason: "artifact_digest_mismatch" });
});

test("rejects a checksum rebound to another artifact name", async (t) => {
  const f = await fixture(t);
  const signed = await signReleaseArtifact(f);
  await fs.writeFile(signed.checksumFile, signed.sha256 + "  different.zip\n");
  const result = await verifyReleaseArtifact({ artifactFile: f.artifactFile, publicKeyFile: f.publicKeyFile });
  assert.deepEqual({ ok: result.ok, reason: result.reason }, { ok: false, reason: "checksum_artifact_mismatch" });
});

test("rejects unknown signature envelope fields", async (t) => {
  const f = await fixture(t);
  const signed = await signReleaseArtifact(f);
  const envelope = JSON.parse(await fs.readFile(signed.signatureFile, "utf8"));
  envelope.untrusted = true;
  await fs.writeFile(signed.signatureFile, JSON.stringify(envelope) + "\n");
  const result = await verifyReleaseArtifact({ artifactFile: f.artifactFile, publicKeyFile: f.publicKeyFile });
  assert.deepEqual({ ok: result.ok, reason: result.reason }, { ok: false, reason: "signature_envelope_invalid" });
});

test("rejects a modified detached signature", async (t) => {
  const f = await fixture(t);
  const signed = await signReleaseArtifact(f);
  const envelope = JSON.parse(await fs.readFile(signed.signatureFile, "utf8"));
  const bytes = Buffer.from(envelope.signature, "base64");
  bytes[0] ^= 1;
  envelope.signature = bytes.toString("base64");
  await fs.writeFile(signed.signatureFile, JSON.stringify(envelope) + "\n");
  const result = await verifyReleaseArtifact({ artifactFile: f.artifactFile, publicKeyFile: f.publicKeyFile });
  assert.deepEqual({ ok: result.ok, reason: result.reason }, { ok: false, reason: "signature_invalid" });
});

test("rejects verification with a different public key", async (t) => {
  const f = await fixture(t);
  await signReleaseArtifact(f);
  const { publicKey } = crypto.generateKeyPairSync("ed25519");
  await fs.writeFile(f.publicKeyFile, publicKey.export({ type: "spki", format: "pem" }));
  const result = await verifyReleaseArtifact({ artifactFile: f.artifactFile, publicKeyFile: f.publicKeyFile });
  assert.deepEqual({ ok: result.ok, reason: result.reason }, { ok: false, reason: "key_fingerprint_mismatch" });
});

test("refuses non-Ed25519 private keys and mismatched pinned keys", async (t) => {
  const f = await fixture(t);
  const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  await fs.writeFile(f.privateKeyFile, rsa.privateKey.export({ type: "pkcs8", format: "pem" }));
  await assert.rejects(() => signReleaseArtifact(f), /Ed25519 private key/);

  const other = crypto.generateKeyPairSync("ed25519");
  await fs.writeFile(f.privateKeyFile, other.privateKey.export({ type: "pkcs8", format: "pem" }));
  await assert.rejects(() => signReleaseArtifact(f), /does not match pinned public key/);
});
