import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createGitSource, validateGitLabRemote } from "./git-source.mjs";
import { runProcess } from "./process-runner.mjs";

async function createBareFixture(t) {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "hp-git-source-"));
  t.after(() => fs.rm(fixture, { recursive: true, force: true }));
  const working = path.join(fixture, "working");
  const bare = path.join(fixture, "remote.git");
  await fs.mkdir(working);
  await runProcess({ command: "git", args: ["init", "--bare", bare] });
  await runProcess({ command: "git", args: ["init", working] });
  await fs.writeFile(path.join(working, "package.json"), "{\"name\":\"fixture\"}\n", "utf8");
  await runProcess({ command: "git", args: ["-C", working, "add", "package.json"] });
  await runProcess({
    command: "git",
    args: [
      "-C", working,
      "-c", "user.name=HermesProof Test",
      "-c", "user.email=test@example.invalid",
      "commit", "-m", "fixture"
    ]
  });
  await runProcess({ command: "git", args: ["-C", working, "branch", "-M", "main"] });
  await runProcess({ command: "git", args: ["-C", working, "remote", "add", "origin", bare] });
  await runProcess({ command: "git", args: ["-C", working, "push", "-u", "origin", "main"] });
  const sha = (await runProcess({ command: "git", args: ["-C", working, "rev-parse", "HEAD"] })).stdout.trim();
  return { fixture, bare, sha };
}

test("Git source resolves and stages an exact immutable SHA from an allowlisted channel", async (t) => {
  const { fixture, bare, sha } = await createBareFixture(t);
  const source = createGitSource({
    remoteUrl: bare,
    allowedRemotes: [bare],
    allowLocalForTests: true,
    channels: {
      stable: "refs/heads/main",
      preview: "refs/heads/main"
    }
  });
  const resolved = await source.resolve({ channel: "stable" });
  assert.equal(resolved.sha, sha);
  assert.equal(resolved.ref, "refs/heads/main");
  assert.equal(resolved.remote, path.resolve(bare));

  const directory = path.join(fixture, "staged");
  await fs.mkdir(directory);
  const staged = await source.stage({ sha, directory, channel: "stable" });
  assert.equal(staged.sha, sha);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, "package.json"), "utf8")), { name: "fixture" });
  const head = (await runProcess({ command: "git", args: ["-C", directory, "rev-parse", "HEAD"] })).stdout.trim();
  assert.equal(head, sha);
});

test("Git source rejects channel drift, unknown channels, and unallowlisted remotes", async (t) => {
  const { fixture, bare } = await createBareFixture(t);
  const source = createGitSource({
    remoteUrl: bare,
    allowedRemotes: [bare],
    allowLocalForTests: true,
    channels: { stable: "refs/heads/main" }
  });
  const directory = path.join(fixture, "drift");
  await fs.mkdir(directory);
  await assert.rejects(source.stage({ sha: "f".repeat(40), directory, channel: "stable" }), /channel no longer resolves/);
  await assert.rejects(source.resolve({ channel: "nightly" }), /unknown update channel/);
  assert.throws(
    () => createGitSource({ remoteUrl: path.join(fixture, "other.git"), allowedRemotes: [bare], allowLocalForTests: true }),
    /remote is not allowlisted/
  );
});

test("production GitLab remote validation rejects credentials, redirects, query data, and other hosts", () => {
  assert.equal(
    validateGitLabRemote("https://gitlab.com/Ghenghis/HermesProof.git"),
    "https://gitlab.com/Ghenghis/HermesProof.git"
  );
  for (const remote of [
    "http://gitlab.com/Ghenghis/HermesProof.git",
    "https://token@gitlab.com/Ghenghis/HermesProof.git",
    "https://gitlab.com.evil.invalid/Ghenghis/HermesProof.git",
    "https://gitlab.com/Ghenghis/HermesProof.git?token=secret",
    "https://gitlab.com/Ghenghis/HermesProof.git#redirect"
  ]) {
    assert.throws(() => validateGitLabRemote(remote), /invalid GitLab remote/);
  }
});
