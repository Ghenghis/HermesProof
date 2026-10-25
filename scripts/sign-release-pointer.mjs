#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import { signReleasePointer, verifyReleasePointer } from "../src/core/release-pointer.mjs";

// Blesses a commit SHA for OTA auto-activation on a channel. Requires the
// SAME offline Ed25519 private key used to sign packaged releases -- this is
// a deliberate, manual, operator-only step. There is no code path anywhere
// in this project that lets a candidate commit sign its own pointer.
//
// Usage:
//   node scripts/sign-release-pointer.mjs --sha <40-or-64-hex> --channel stable \
//     --private-key <path-to-offline-key.pem> [--public-key <path>] [--out <path>]
//
// Run this once you've decided a specific commit is safe to let the managed
// updater (src/updater/managed-updater.mjs) auto-activate on machines that
// enable the "release-pointer-signature" gate. Copy the resulting JSON file
// to each such machine's <managedRoot>/trust/release-pointer-<channel>.json.

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "..");

function parseArgs(argv) {
  const options = { channel: "stable" };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--sha") options.sha = argv[++index];
    else if (arg === "--channel") options.channel = argv[++index];
    else if (arg === "--private-key") options.privateKeyFile = argv[++index];
    else if (arg === "--public-key") options.publicKeyFile = argv[++index];
    else if (arg === "--out") options.pointerFile = argv[++index];
    else if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error("unknown option: " + arg);
  }
  return options;
}

function usage() {
  return [
    "Usage: node scripts/sign-release-pointer.mjs --sha <hex> [options]",
    "",
    "Options:",
    "  --sha <hex>          Required. The commit SHA to bless (40 or 64 hex chars).",
    "  --channel <name>     Update channel (default: stable).",
    "  --private-key <file> Required. Your offline Ed25519 release-signing private key.",
    "  --public-key <file>  Default: config/hermesproof-release-ed25519-public.pem",
    "  --out <file>         Default: config/release-pointer-<channel>.json",
    "                       Copy this file to <managedRoot>/trust/release-pointer-<channel>.json",
    "                       on every machine that should treat this SHA as blessed.",
    "  --json               Emit machine-readable JSON",
    "  --help               Show this help"
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage() + "\n");
    return;
  }
  if (!args.sha) throw new Error("--sha is required");
  if (!args.privateKeyFile) throw new Error("--private-key is required (your offline release-signing key)");
  const publicKeyFile = args.publicKeyFile || path.join(repoRoot, "config", "hermesproof-release-ed25519-public.pem");
  const pointerFile = args.pointerFile || path.join(repoRoot, "config", "release-pointer-" + args.channel + ".json");

  const signed = await signReleasePointer({
    sha: args.sha,
    channel: args.channel,
    privateKeyFile: args.privateKeyFile,
    publicKeyFile,
    pointerFile
  });

  // Immediately re-verify what was just written, the same way the updater's
  // gate will -- catches a mismatched key or a typo'd SHA before it's copied
  // anywhere, rather than discovering it via a confusing gate failure later.
  const reverified = await verifyReleasePointer({
    pointerFile: signed.pointerFile,
    publicKeyFile,
    expectedSha: args.sha,
    expectedChannel: args.channel
  });
  if (!reverified.ok) {
    throw new Error("wrote a pointer that failed its own re-verification: " + reverified.reason);
  }

  if (args.json) {
    process.stdout.write(JSON.stringify(signed) + "\n");
  } else {
    process.stdout.write("[SIGNED] release pointer written and re-verified\n");
    process.stdout.write("SHA:     " + signed.sha + "\n");
    process.stdout.write("Channel: " + signed.channel + "\n");
    process.stdout.write("Key:     " + signed.keyFingerprint + "\n");
    process.stdout.write("File:    " + signed.pointerFile + "\n");
    process.stdout.write("\nCopy this file to <managedRoot>/trust/release-pointer-" + signed.channel + ".json\n");
    process.stdout.write("on every machine that should accept this SHA via the release-pointer-signature gate.\n");
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    await main();
  } catch (error) {
    if (process.argv.includes("--json")) process.stdout.write(JSON.stringify({ ok: false, reason: error.message }) + "\n");
    else process.stderr.write("[FAIL] " + error.message + "\n");
    process.exitCode = 1;
  }
}
