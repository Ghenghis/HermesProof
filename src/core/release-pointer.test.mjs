import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  POINTER_SCHEMA,
  canonicalPointerPayload,
  pointerKeyFingerprint,
  signReleasePointer,
  verifyReleasePointer
} from "./release-pointer.mjs";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hp-release-pointer-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const privateKeyFile = path.join(root, "private.pem");
  const publicKeyFile = path.join(root, "public.pem");
  await fs.writeFile(privateKeyFile, privateKey.export({ type: "pkcs8", format: "pem" }));
  await fs.writeFile(publicKeyFile, publicKey.export({ type: "spki", format: "pem" }));
  const pointerFile = path.join(root, "release-pointer-stable.json");
  return { root, privateKeyFile, publicKeyFile, pointerFile, publicKey };
}

test("canonical pointer payload has a stable, ordered format", () => {
  const fields = {
    schema: POINTER_SCHEMA,
    algorithm: "Ed25519",
    channel: "stable",
    sha: SHA_A,
    issuedUtc: "2026-09-22T00:00:00.000Z",
    keyFingerprint: "sha256:" + "c".repeat(64)
  };
  assert.equal(
    canonicalPointerPayload(fields).toString("utf8"),
    ["hermesproof.release-pointer.v1", "Ed25519", "stable", SHA_A, "2026-09-22T00:00:00.000Z", "sha256:" + "c".repeat(64), ""].join("\n")
  );
});

test("signs a pointer and verifies it against the expected sha/channel", async (t) => {
  const f = await fixture(t);
  const signed = await signReleasePointer({
    sha: SHA_A,
    channel: "stable",
    privateKeyFile: f.privateKeyFile,
    publicKeyFile: f.publicKeyFile,
    pointerFile: f.pointerFile
  });
  assert.equal(signed.sha, SHA_A);
  assert.equal(signed.channel, "stable");
  assert.equal(signed.keyFingerprint, pointerKeyFingerprint(f.publicKey));

  const envelope = JSON.parse(await fs.readFile(f.pointerFile, "utf8"));
  assert.deepEqual(Object.keys(envelope), ["schema", "algorithm", "channel", "sha", "issuedUtc", "keyFingerprint", "signature"]);

  const verified = await verifyReleasePointer({
    pointerFile: f.pointerFile,
    publicKeyFile: f.publicKeyFile,
    expectedSha: SHA_A,
    expectedChannel: "stable"
  });
  assert.equal(verified.ok, true, JSON.stringify(verified));
  assert.equal(verified.sha, SHA_A);
});

test("rejects a pointer for the wrong sha (the core anti-rollback/unblessed-candidate case)", async (t) => {
  const f = await fixture(t);
  await signReleasePointer({
    sha: SHA_A,
    channel: "stable",
    privateKeyFile: f.privateKeyFile,
    publicKeyFile: f.publicKeyFile,
    pointerFile: f.pointerFile
  });
  const verified = await verifyReleasePointer({
    pointerFile: f.pointerFile,
    publicKeyFile: f.publicKeyFile,
    expectedSha: SHA_B,
    expectedChannel: "stable"
  });
  assert.equal(verified.ok, false);
  assert.equal(verified.reason, "sha_not_blessed");
});

test("rejects a pointer for the wrong channel", async (t) => {
  const f = await fixture(t);
  await signReleasePointer({
    sha: SHA_A,
    channel: "stable",
    privateKeyFile: f.privateKeyFile,
    publicKeyFile: f.publicKeyFile,
    pointerFile: f.pointerFile
  });
  const verified = await verifyReleasePointer({
    pointerFile: f.pointerFile,
    publicKeyFile: f.publicKeyFile,
    expectedSha: SHA_A,
    expectedChannel: "preview"
  });
  assert.equal(verified.ok, false);
  assert.equal(verified.reason, "channel_mismatch");
});

test("rejects a pointer signed by a different key than the one pinned for verification", async (t) => {
  const f = await fixture(t);
  await signReleasePointer({
    sha: SHA_A,
    channel: "stable",
    privateKeyFile: f.privateKeyFile,
    publicKeyFile: f.publicKeyFile,
    pointerFile: f.pointerFile
  });
  const other = crypto.generateKeyPairSync("ed25519");
  const otherPublicKeyFile = path.join(f.root, "other-public.pem");
  await fs.writeFile(otherPublicKeyFile, other.publicKey.export({ type: "spki", format: "pem" }));
  const verified = await verifyReleasePointer({
    pointerFile: f.pointerFile,
    publicKeyFile: otherPublicKeyFile,
    expectedSha: SHA_A,
    expectedChannel: "stable"
  });
  assert.equal(verified.ok, false);
  assert.equal(verified.reason, "key_fingerprint_mismatch");
});

test("rejects a tampered envelope (sha edited after signing, signature no longer matches)", async (t) => {
  const f = await fixture(t);
  await signReleasePointer({
    sha: SHA_A,
    channel: "stable",
    privateKeyFile: f.privateKeyFile,
    publicKeyFile: f.publicKeyFile,
    pointerFile: f.pointerFile
  });
  const envelope = JSON.parse(await fs.readFile(f.pointerFile, "utf8"));
  envelope.sha = SHA_B;
  await fs.writeFile(f.pointerFile, JSON.stringify(envelope, null, 2) + "\n", "utf8");
  const verified = await verifyReleasePointer({
    pointerFile: f.pointerFile,
    publicKeyFile: f.publicKeyFile,
    expectedSha: SHA_B,
    expectedChannel: "stable"
  });
  assert.equal(verified.ok, false);
  assert.equal(verified.reason, "signature_invalid");
});

test("fails closed when no pointer file exists yet", async (t) => {
  const f = await fixture(t);
  const verified = await verifyReleasePointer({
    pointerFile: f.pointerFile,
    publicKeyFile: f.publicKeyFile,
    expectedSha: SHA_A,
    expectedChannel: "stable"
  });
  assert.equal(verified.ok, false);
  assert.equal(verified.reason, "pointer_missing");
});

test("signReleasePointer refuses a private key that does not match the pinned public key", async (t) => {
  const f = await fixture(t);
  const other = crypto.generateKeyPairSync("ed25519");
  const otherPrivateKeyFile = path.join(f.root, "other-private.pem");
  await fs.writeFile(otherPrivateKeyFile, other.privateKey.export({ type: "pkcs8", format: "pem" }));
  await assert.rejects(
    signReleasePointer({
      sha: SHA_A,
      channel: "stable",
      privateKeyFile: otherPrivateKeyFile,
      publicKeyFile: f.publicKeyFile,
      pointerFile: f.pointerFile
    }),
    /does not match pinned public key/
  );
});
