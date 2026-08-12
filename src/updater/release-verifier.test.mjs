import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  CANDIDATE_REQUIRED_GATES,
  createReleaseVerifier
} from "./release-verifier.mjs";

const SHA = "d".repeat(40);

function passingGates(events = []) {
  return Object.fromEntries(CANDIDATE_REQUIRED_GATES.map((name) => [
    name,
    async () => {
      events.push(name);
      return { ok: true, details: { name, status: "verified" } };
    }
  ]));
}

test("candidate verifier requires every named gate and writes digest-bound evidence", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hp-release-verifier-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const candidate = path.join(root, "candidate");
  const evidenceRoot = path.join(root, "evidence");
  await fs.mkdir(candidate);
  const events = [];
  const verifier = createReleaseVerifier({
    gates: passingGates(events),
    evidenceRoot,
    clock: () => new Date("2026-08-09T12:00:00.000Z")
  });

  const result = await verifier({ sha: SHA, directory: candidate, channel: "stable" });
  assert.equal(result.ok, true);
  assert.match(result.evidenceDigest, /^[0-9a-f]{64}$/);
  assert.deepEqual(events, CANDIDATE_REQUIRED_GATES);
  assert.equal(result.gates.length, CANDIDATE_REQUIRED_GATES.length);
  const evidence = JSON.parse(await fs.readFile(result.evidenceFile, "utf8"));
  assert.equal(evidence.sha, SHA);
  assert.equal(evidence.evidenceDigest, result.evidenceDigest);
  assert.deepEqual(evidence.gates.map((gate) => gate.name), CANDIDATE_REQUIRED_GATES);
  assert.equal(
    JSON.parse(await fs.readFile(path.join(candidate, ".hermesproof", "candidate-evidence.json"), "utf8")).evidenceDigest,
    result.evidenceDigest
  );
});

test("candidate verifier fails closed on missing, skipped, or failed gates", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hp-release-verifier-fail-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const candidate = path.join(root, "candidate");
  await fs.mkdir(candidate);

  const missing = passingGates();
  delete missing[CANDIDATE_REQUIRED_GATES[0]];
  assert.throws(
    () => createReleaseVerifier({ gates: missing, evidenceRoot: path.join(root, "missing") }),
    /required candidate gate is missing/
  );

  for (const bad of [
    { ok: true, skipped: true, reason: "not installed" },
    { ok: false, reason: "Merkle verification failed" }
  ]) {
    const gates = passingGates();
    gates["hp-mha-merkle"] = async () => bad;
    const verifier = createReleaseVerifier({ gates, evidenceRoot: path.join(root, cryptoName(bad)) });
    const result = await verifier({ sha: SHA, directory: candidate, channel: "stable" });
    assert.equal(result.ok, false);
    assert.match(result.reason, /hp-mha-merkle/);
  }
});

test("candidate evidence redacts secrets from gate errors and details", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hp-release-verifier-redact-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const candidate = path.join(root, "candidate");
  await fs.mkdir(candidate);
  const secret = "glpat-secret-value";
  const gates = passingGates();
  gates["secrets-and-sbom"] = async () => {
    throw new Error("scanner saw " + secret);
  };
  const verifier = createReleaseVerifier({
    gates,
    evidenceRoot: path.join(root, "evidence"),
    redact: [secret]
  });
  const result = await verifier({ sha: SHA, directory: candidate, channel: "stable" });
  assert.equal(result.ok, false);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
  assert.match(result.reason, /\[REDACTED\]/);
});

function cryptoName(value) {
  return value.skipped ? "skipped" : "failed";
}
