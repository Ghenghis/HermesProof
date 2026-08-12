#!/usr/bin/env node
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { publicKeyFingerprint } from "../src/core/release-signing.mjs";

const execFileAsync = promisify(execFile);

async function pathExists(file) {
  try {
    await fs.lstat(file);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function hardenWindowsPrivateKey(privateKeyFile, runFile) {
  const username = String(process.env.USERNAME || "").trim();
  const domain = String(process.env.USERDOMAIN || "").trim();
  if (!username) throw new Error("current Windows user is unavailable for private-key ACL");
  const principal = domain ? domain + "\\" + username : username;
  await runFile(
    "icacls.exe",
    [privateKeyFile, "/inheritance:r", "/grant:r", principal + ":(F)"],
    { windowsHide: true, maxBuffer: 1024 * 1024 }
  );
}

export async function generateReleaseKeyPair({
  privateKeyFile,
  publicKeyFile,
  hardenWindowsAcl = process.platform === "win32",
  execFileImpl = execFileAsync
}) {
  if (!privateKeyFile || !publicKeyFile) {
    throw new Error("privateKeyFile and publicKeyFile are required");
  }
  const privateFile = path.resolve(privateKeyFile);
  const publicFile = path.resolve(publicKeyFile);
  if (privateFile === publicFile) throw new Error("private and public key paths must differ");
  if (await pathExists(privateFile)) throw new Error("private key output already exists");
  if (await pathExists(publicFile)) throw new Error("public key output already exists");
  await fs.mkdir(path.dirname(privateFile), { recursive: true });
  await fs.mkdir(path.dirname(publicFile), { recursive: true });

  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });
  const publicPem = publicKey.export({ type: "spki", format: "pem" });
  let privateCreated = false;
  let publicCreated = false;
  try {
    await fs.writeFile(privateFile, privatePem, { flag: "wx", mode: 0o600 });
    privateCreated = true;
    await fs.writeFile(publicFile, publicPem, { flag: "wx", mode: 0o644 });
    publicCreated = true;
    if (hardenWindowsAcl) {
      await hardenWindowsPrivateKey(privateFile, execFileImpl);
    }
  } catch (error) {
    if (publicCreated) await fs.rm(publicFile, { force: true }).catch(() => {});
    if (privateCreated) await fs.rm(privateFile, { force: true }).catch(() => {});
    throw error;
  }
  return {
    ok: true,
    privateKeyFile: privateFile,
    publicKeyFile: publicFile,
    fingerprint: publicKeyFingerprint(publicKey)
  };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--private-key") options.privateKeyFile = argv[++index];
    else if (arg === "--public-key") options.publicKeyFile = argv[++index];
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error("unknown option: " + arg);
  }
  return options;
}

function usage() {
  return [
    "Usage: node scripts/generate-release-key.mjs --private-key <external.pem> --public-key <public.pem>",
    "",
    "Creates a new Ed25519 release key pair and refuses to overwrite either output.",
    "The private key must remain outside the repository."
  ].join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(usage() + "\n");
    } else {
      const result = await generateReleaseKeyPair(options);
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    }
  } catch (error) {
    process.stderr.write("Release key generation failed: " + error.message + "\n");
    process.exitCode = 1;
  }
}
