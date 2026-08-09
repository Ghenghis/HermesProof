import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { checkReleaseDocs, renderReleaseDocs } from "./generate-release-docs.mjs";

const root = path.resolve(import.meta.dirname, "..");

test("generated release documentation matches the canonical facts", async () => {
  const rendered = await renderReleaseDocs({ root });
  assert.match(rendered.markdown, /121 core MCP tools/);
  assert.match(rendered.markdown, /34 governed composite MCP tools/);
  assert.match(rendered.markdown, /Serena 1\.6\.2\.dev0/);
  assert.equal(rendered.json.servers.composite.tools, 34);
  assert.equal(rendered.json.gitlab.projectUrl, "https://gitlab.com/Ghenghis/HermesProof");

  const result = await checkReleaseDocs({ root });
  assert.deepEqual(result, { ok: true, drift: [] });
});

test("README and Pages site are GitLab-first and link the current diagrams", async () => {
  const [readme, page, styles] = await Promise.all([
    readFile(path.join(root, "README.md"), "utf8"),
    readFile(path.join(root, "site", "index.html"), "utf8"),
    readFile(path.join(root, "site", "styles.css"), "utf8"),
  ]);

  for (const content of [readme, page]) {
    assert.match(content, /gitlab\.com\/Ghenghis\/HermesProof/i);
    assert.match(content, /ecosystem-e2e\.svg/);
    assert.match(content, /updater-lifecycle-animated\.svg/);
  }
  assert.doesNotMatch(readme, /github\.com\/Ghenghis\/HermesProof/i);
  assert.match(page, /0\.9\.0-rc\.1/);
  assert.match(page, /121/);
  assert.match(page, /34/);
  assert.match(styles, /prefers-reduced-motion/);
});
