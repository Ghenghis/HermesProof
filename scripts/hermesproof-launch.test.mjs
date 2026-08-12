import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resolveManagedServer } from "./hermesproof-launch.mjs";
import { MANAGED_UPDATER_SCHEMA } from "../src/updater/managed-updater.mjs";

const SHA = "a".repeat(40);

async function launcherFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hp-launcher-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const releaseDirectory = path.join(root, "releases", SHA);
  await fs.mkdir(path.join(root, "state"), { recursive: true });
  await fs.mkdir(path.join(releaseDirectory, "src", "hp-mha-serena"), { recursive: true });
  await fs.writeFile(path.join(releaseDirectory, "src", "server.mjs"), "export {};\n", "utf8");
  await fs.writeFile(path.join(releaseDirectory, "src", "hp-mha-serena", "server.mjs"), "export {};\n", "utf8");
  await fs.writeFile(path.join(root, "state", "active-release.json"), JSON.stringify({
    schema: MANAGED_UPDATER_SCHEMA,
    generation: 1,
    currentSha: SHA,
    previousSha: null,
    channel: "stable"
  }), "utf8");
  await fs.writeFile(path.join(root, "state", "releases.json"), JSON.stringify({
    schema: MANAGED_UPDATER_SCHEMA,
    releases: [{
      sha: SHA,
      state: "known-good",
      directory: releaseDirectory,
      evidenceDigest: "evidence-" + SHA
    }]
  }), "utf8");
  return { root, releaseDirectory };
}

test("stable launcher resolves both allowlisted servers from the active known-good release", async (t) => {
  const { root, releaseDirectory } = await launcherFixture(t);
  assert.equal(
    await resolveManagedServer({ managedRoot: root, server: "hermes3d-locks" }),
    path.join(releaseDirectory, "src", "server.mjs")
  );
  assert.equal(
    await resolveManagedServer({ managedRoot: root, server: "hp-mha-serena" }),
    path.join(releaseDirectory, "src", "hp-mha-serena", "server.mjs")
  );
});

test("stable launcher refuses unknown servers and releases not marked known-good", async (t) => {
  const { root } = await launcherFixture(t);
  await assert.rejects(resolveManagedServer({ managedRoot: root, server: "shell" }), /server is not allowlisted/);
  const registryFile = path.join(root, "state", "releases.json");
  const registry = JSON.parse(await fs.readFile(registryFile, "utf8"));
  registry.releases[0].state = "quarantined";
  await fs.writeFile(registryFile, JSON.stringify(registry), "utf8");
  await assert.rejects(resolveManagedServer({ managedRoot: root, server: "hermes3d-locks" }), /not known-good/);
});

test("stable launcher refuses path substitution and symlinked server entries", async (t) => {
  const { root, releaseDirectory } = await launcherFixture(t);
  const registryFile = path.join(root, "state", "releases.json");
  const registry = JSON.parse(await fs.readFile(registryFile, "utf8"));
  registry.releases[0].directory = path.join(root, "quarantine", SHA);
  await fs.writeFile(registryFile, JSON.stringify(registry), "utf8");
  await assert.rejects(resolveManagedServer({ managedRoot: root, server: "hermes3d-locks" }), /release directory mismatch/);

  registry.releases[0].directory = releaseDirectory;
  await fs.writeFile(registryFile, JSON.stringify(registry), "utf8");
  const serverFile = path.join(releaseDirectory, "src", "server.mjs");
  const outside = path.join(root, "outside.mjs");
  await fs.writeFile(outside, "export {};\n", "utf8");
  await fs.rm(serverFile);
  try {
    await fs.symlink(outside, serverFile, "file");
  } catch (error) {
    if (["EPERM", "EACCES"].includes(error?.code)) return t.skip("link creation is not permitted on this host");
    throw error;
  }
  await assert.rejects(resolveManagedServer({ managedRoot: root, server: "hermes3d-locks" }), /link or junction/);
});
