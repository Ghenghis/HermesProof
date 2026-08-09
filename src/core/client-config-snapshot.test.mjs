import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createClientConfigSnapshot,
  finalizeClientConfigSnapshot,
  restoreClientConfigSnapshot
} from "./client-config-snapshot.mjs";

test("client config snapshot restores changed existing files and removes installer-created files", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hp-client-snapshot-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const existing = path.join(root, "configs", "existing.json");
  const created = path.join(root, "configs", "created.json");
  await fs.mkdir(path.dirname(existing), { recursive: true });
  await fs.writeFile(existing, '{"before":true}\n', "utf8");

  const snapshot = await createClientConfigSnapshot({
    files: [existing, created],
    backupRoot: path.join(root, "backups"),
    now: new Date("2026-08-09T12:00:00.000Z")
  });
  await fs.writeFile(existing, '{"after":true}\n', "utf8");
  await fs.writeFile(created, '{"installed":true}\n', "utf8");
  const finalized = await finalizeClientConfigSnapshot({ manifestFile: snapshot.manifestFile });

  const restored = await restoreClientConfigSnapshot({
    manifestFile: snapshot.manifestFile,
    manifestSha256: finalized.manifestSha256,
    allowedFiles: [existing, created]
  });
  assert.equal(restored.ok, true);
  assert.equal(await fs.readFile(existing, "utf8"), '{"before":true}\n');
  await assert.rejects(fs.access(created), /ENOENT/);
});

test("restore refuses to overwrite user changes made after installation", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hp-client-snapshot-drift-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "config.json");
  await fs.writeFile(file, '{"before":1}', "utf8");
  const snapshot = await createClientConfigSnapshot({ files: [file], backupRoot: path.join(root, "backups") });
  await fs.writeFile(file, '{"installed":1}', "utf8");
  const finalized = await finalizeClientConfigSnapshot({ manifestFile: snapshot.manifestFile });
  await fs.writeFile(file, '{"user-change":1}', "utf8");

  await assert.rejects(
    restoreClientConfigSnapshot({ manifestFile: snapshot.manifestFile, manifestSha256: finalized.manifestSha256, allowedFiles: [file] }),
    /changed after installation/
  );
  assert.equal(await fs.readFile(file, "utf8"), '{"user-change":1}');
});

test("restore rejects a manifest target outside the explicit allowlist", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hp-client-snapshot-scope-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "config.json");
  await fs.writeFile(file, "before", "utf8");
  const snapshot = await createClientConfigSnapshot({ files: [file], backupRoot: path.join(root, "backups") });
  await fs.writeFile(file, "after", "utf8");
  const finalized = await finalizeClientConfigSnapshot({ manifestFile: snapshot.manifestFile });
  await assert.rejects(
    restoreClientConfigSnapshot({ manifestFile: snapshot.manifestFile, manifestSha256: finalized.manifestSha256, allowedFiles: [] }),
    /not explicitly allowed/
  );
});

test("restore rejects a tampered snapshot manifest before reading its targets", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hp-client-snapshot-manifest-tamper-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "config.json");
  await fs.writeFile(file, "before", "utf8");
  const snapshot = await createClientConfigSnapshot({ files: [file], backupRoot: path.join(root, "backups") });
  await fs.writeFile(file, "after", "utf8");
  const finalized = await finalizeClientConfigSnapshot({ manifestFile: snapshot.manifestFile });
  const manifest = JSON.parse(await fs.readFile(snapshot.manifestFile, "utf8"));
  manifest.entries[0].file = path.join(root, "unrelated.json");
  await fs.writeFile(snapshot.manifestFile, JSON.stringify(manifest), "utf8");
  await assert.rejects(
    restoreClientConfigSnapshot({ manifestFile: snapshot.manifestFile, manifestSha256: finalized.manifestSha256, allowedFiles: [file] }),
    /manifest hash mismatch/
  );
});
