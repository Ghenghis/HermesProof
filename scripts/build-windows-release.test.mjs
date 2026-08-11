import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  finalizeWindowsReleaseArtifact,
  createReleaseManifest,
  filterReleasePaths,
  releaseSumsFilename,
  releaseArtifactBasename,
  requireOfficialSigningKey,
  verifyReleaseManifest
} from "./build-windows-release.mjs";
import { verifyReleaseArtifact } from "../src/core/release-signing.mjs";

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

test("official release configuration fails before build work when signing key is missing", () => {
  assert.throws(
    () => requireOfficialSigningKey({ signingKeyFile: "", unsignedDevelopment: false }),
    /HERMESPROOF_RELEASE_SIGNING_KEY_FILE is required/
  );
  assert.equal(requireOfficialSigningKey({ signingKeyFile: "", unsignedDevelopment: true }), null);
});

test("unsigned development artifact names cannot be confused with official releases", () => {
  assert.equal(releaseArtifactBasename("v0.9.0-rc.1", false), "HermesProof-v0.9.0-rc.1-windows-x64");
  assert.equal(
    releaseArtifactBasename("v0.9.0-rc.1", true),
    "HermesProof-v0.9.0-rc.1-windows-x64-UNSIGNED-DEVELOPMENT"
  );
  assert.equal(releaseSumsFilename(false), "SHA256SUMS.txt");
  assert.equal(releaseSumsFilename(true), "SHA256SUMS-UNSIGNED-DEVELOPMENT.txt");
});

test("finalizes an official ZIP with exact sidecars and self-verification", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hp-release-finalize-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const artifactFile = path.join(root, "HermesProof-test.zip");
  const privateKeyFile = path.join(root, "private.pem");
  const publicKeyFile = path.join(root, "public.pem");
  const sumsFile = path.join(root, "SHA256SUMS.txt");
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  await fs.writeFile(artifactFile, "archive bytes");
  await fs.writeFile(privateKeyFile, privateKey.export({ type: "pkcs8", format: "pem" }));
  await fs.writeFile(publicKeyFile, publicKey.export({ type: "spki", format: "pem" }));
  const result = await finalizeWindowsReleaseArtifact({
    artifactFile,
    sumsFile,
    privateKeyFile,
    publicKeyFile
  });
  assert.equal(result.official, true);
  assert.equal(result.checksumFile, artifactFile + ".sha256");
  assert.equal(result.signatureFile, artifactFile + ".sig");
  assert.equal(await fs.readFile(sumsFile, "utf8"), result.sha256 + "  HermesProof-test.zip\n");
  const verified = await verifyReleaseArtifact({ artifactFile, publicKeyFile });
  assert.equal(verified.ok, true, JSON.stringify(verified));
});

test("finalization rejects a private key that does not match the pinned key", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hp-release-wrong-key-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const artifactFile = path.join(root, "HermesProof-test.zip");
  const privateKeyFile = path.join(root, "private.pem");
  const publicKeyFile = path.join(root, "public.pem");
  const first = crypto.generateKeyPairSync("ed25519");
  const second = crypto.generateKeyPairSync("ed25519");
  await fs.writeFile(artifactFile, "archive bytes");
  await fs.writeFile(privateKeyFile, first.privateKey.export({ type: "pkcs8", format: "pem" }));
  await fs.writeFile(publicKeyFile, second.publicKey.export({ type: "spki", format: "pem" }));
  await assert.rejects(
    () => finalizeWindowsReleaseArtifact({
      artifactFile,
      sumsFile: path.join(root, "SHA256SUMS.txt"),
      privateKeyFile,
      publicKeyFile
    }),
    /does not match pinned public key/
  );
});
