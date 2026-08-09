import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { generateReleaseKeyPair } from "./generate-release-key.mjs";
import { publicKeyFingerprint } from "../src/core/release-signing.mjs";

async function rootFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hp-release-key-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return {
    root,
    privateKeyFile: path.join(root, "private.pem"),
    publicKeyFile: path.join(root, "public.pem")
  };
}

test("generates a matching Ed25519 key pair without returning private material", async (t) => {
  const files = await rootFixture(t);
  const result = await generateReleaseKeyPair({ ...files, hardenWindowsAcl: false });
  const privatePem = await fs.readFile(files.privateKeyFile, "utf8");
  const publicPem = await fs.readFile(files.publicKeyFile, "utf8");
  const privateKey = crypto.createPrivateKey(privatePem);
  const publicKey = crypto.createPublicKey(publicPem);
  assert.equal(privateKey.asymmetricKeyType, "ed25519");
  assert.equal(publicKey.asymmetricKeyType, "ed25519");
  assert.deepEqual(
    crypto.createPublicKey(privateKey).export({ type: "spki", format: "der" }),
    publicKey.export({ type: "spki", format: "der" })
  );
  assert.equal(result.fingerprint, publicKeyFingerprint(publicKey));
  assert.equal(Object.values(result).some((value) => String(value).includes("PRIVATE KEY")), false);
});

test("refuses to overwrite either existing key output", async (t) => {
  const privateExists = await rootFixture(t);
  await fs.writeFile(privateExists.privateKeyFile, "keep-private");
  await assert.rejects(
    () => generateReleaseKeyPair({ ...privateExists, hardenWindowsAcl: false }),
    /already exists/
  );
  assert.equal(await fs.readFile(privateExists.privateKeyFile, "utf8"), "keep-private");
  await assert.rejects(() => fs.access(privateExists.publicKeyFile));

  const publicExists = await rootFixture(t);
  await fs.writeFile(publicExists.publicKeyFile, "keep-public");
  await assert.rejects(
    () => generateReleaseKeyPair({ ...publicExists, hardenWindowsAcl: false }),
    /already exists/
  );
  assert.equal(await fs.readFile(publicExists.publicKeyFile, "utf8"), "keep-public");
  await assert.rejects(() => fs.access(publicExists.privateKeyFile));
});

test("does not create a private key when the public output path already exists", async (t) => {
  const files = await rootFixture(t);
  await fs.mkdir(files.publicKeyFile);
  await assert.rejects(
    () => generateReleaseKeyPair({ ...files, hardenWindowsAcl: false }),
    /already exists/
  );
  await assert.rejects(() => fs.access(files.privateKeyFile));
});
