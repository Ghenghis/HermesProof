import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createUpdaterPathPolicy,
  validateGitRef,
  validateReleaseSha
} from "./path-policy.mjs";

test("updater path policy keeps release state inside a dedicated managed root", async (t) => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "hp-path-policy-"));
  t.after(() => fs.rm(fixture, { recursive: true, force: true }));
  const home = path.join(fixture, "home");
  const repository = path.join(fixture, "repository");
  const root = path.join(home, ".hermesproof-managed");
  await fs.mkdir(repository, { recursive: true });

  const policy = await createUpdaterPathPolicy({
    managedRoot: root,
    homeDirectory: home,
    repositoryRoot: repository
  });

  assert.equal(policy.managedRoot, path.resolve(root));
  assert.equal(policy.releaseDirectory("a".repeat(40)), path.join(path.resolve(root), "releases", "a".repeat(40)));
  assert.throws(() => policy.assertContained(path.join(root, "..", "escape")), /outside managed root/);
});

test("updater path policy refuses filesystem, home, repository, and nested repository roots", async (t) => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "hp-path-policy-refuse-"));
  t.after(() => fs.rm(fixture, { recursive: true, force: true }));
  const home = path.join(fixture, "home");
  const repository = path.join(home, "projects", "HermesProof");
  await fs.mkdir(repository, { recursive: true });

  for (const managedRoot of [path.parse(fixture).root, home, repository, path.join(repository, "managed")]) {
    await assert.rejects(
      createUpdaterPathPolicy({ managedRoot, homeDirectory: home, repositoryRoot: repository }),
      /unsafe managed root/
    );
  }
});

test("updater path policy rejects an existing junction or symlink escape", async (t) => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "hp-path-policy-link-"));
  t.after(() => fs.rm(fixture, { recursive: true, force: true }));
  const home = path.join(fixture, "home");
  const outside = path.join(fixture, "outside");
  const root = path.join(home, ".hermesproof-managed");
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(outside, { recursive: true });
  const linked = path.join(root, "releases");
  try {
    await fs.symlink(outside, linked, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "EACCES"].includes(error?.code)) return t.skip("link creation is not permitted on this host");
    throw error;
  }

  await assert.rejects(
    createUpdaterPathPolicy({ managedRoot: root, homeDirectory: home }),
    /link or junction/
  );
});

test("release SHAs and Git refs use strict allowlists", () => {
  assert.equal(validateReleaseSha("f".repeat(40)), "f".repeat(40));
  assert.equal(validateGitRef("refs/heads/main"), "refs/heads/main");
  assert.equal(validateGitRef("refs/heads/release/hp-mha-serena-shippable"), "refs/heads/release/hp-mha-serena-shippable");
  for (const sha of ["abc", "A".repeat(40), "f".repeat(39) + "/"]) {
    assert.throws(() => validateReleaseSha(sha), /invalid release SHA/);
  }
  for (const ref of ["main", "refs/heads/../main", "refs/tags/v1;calc", "refs/heads/main lock"]) {
    assert.throws(() => validateGitRef(ref), /invalid Git ref/);
  }
});
