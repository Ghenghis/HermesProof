import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { signReleaseArtifact } from "../src/core/release-signing.mjs";

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const verifier = path.join(here, "verify-hermesproof-release.mjs");

async function signedFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hp-release-cli-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const artifactFile = path.join(root, "HermesProof-test-windows-x64.zip");
  const privateKeyFile = path.join(root, "private.pem");
  const publicKeyFile = path.join(root, "public.pem");
  const standaloneVerifier = path.join(root, "verify-hermesproof-release.mjs");
  const defaultPublicKeyFile = path.join(root, "hermesproof-release-ed25519-public.pem");
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  await fs.writeFile(artifactFile, "downloaded archive");
  await fs.writeFile(privateKeyFile, privateKey.export({ type: "pkcs8", format: "pem" }));
  await fs.writeFile(publicKeyFile, publicKey.export({ type: "spki", format: "pem" }));
  await signReleaseArtifact({ artifactFile, privateKeyFile, publicKeyFile });
  await fs.copyFile(verifier, standaloneVerifier);
  await fs.copyFile(publicKeyFile, defaultPublicKeyFile);
  return { artifactFile, publicKeyFile, standaloneVerifier };
}

test("standalone verifier safely discovers one adjacent signed archive", async (t) => {
  const f = await signedFixture(t);
  const result = await execFileAsync(process.execPath, [f.standaloneVerifier, "--json"], {
    cwd: path.dirname(f.standaloneVerifier),
    windowsHide: true
  });
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true, result.stdout);
  assert.equal(path.basename(parsed.artifactFile), path.basename(f.artifactFile));
});

test("standalone verifier accepts a valid downloaded release", async (t) => {
  const f = await signedFixture(t);
  const result = await execFileAsync(process.execPath, [
    f.standaloneVerifier,
    "--artifact", f.artifactFile,
    "--public-key", f.publicKeyFile,
    "--json"
  ], { windowsHide: true });
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true, result.stdout);
  assert.match(parsed.sha256, /^[0-9a-f]{64}$/);
});

test("standalone verifier exits nonzero after archive tampering", async (t) => {
  const f = await signedFixture(t);
  await fs.appendFile(f.artifactFile, "tampered");
  await assert.rejects(
    () => execFileAsync(process.execPath, [
      f.standaloneVerifier,
      "--artifact", f.artifactFile,
      "--public-key", f.publicKeyFile,
      "--json"
    ], { windowsHide: true }),
    (error) => {
      const parsed = JSON.parse(error.stdout);
      assert.deepEqual({ ok: parsed.ok, reason: parsed.reason }, {
        ok: false,
        reason: "artifact_digest_mismatch"
      });
      return true;
    }
  );
});
