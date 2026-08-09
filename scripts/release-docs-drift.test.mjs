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

test("operations docs match the shipped Serena, scheduler, backup, and Claude Code contracts", async () => {
  const [troubleshooting, windowsInstall, reconnect] = await Promise.all([
    readFile(path.join(root, "docs", "TROUBLESHOOTING_UPDATES.md"), "utf8"),
    readFile(path.join(root, "docs", "WINDOWS_INSTALL.md"), "utf8"),
    readFile(path.join(root, "docs", "AUTO_RECONNECT.md"), "utf8"),
  ]);
  assert.match(troubleshooting, /language_servers:/);
  assert.doesNotMatch(troubleshooting, /```yaml\s+languages:/);
  assert.match(troubleshooting, /HermesProof Automatic Update/);
  assert.match(windowsInstall, /backups[\\/]clients/);
  assert.match(windowsInstall, /managed recovery data/i);
  assert.match(windowsInstall, /-SkipUserPath/);
  assert.match(windowsInstall, /-SkipSystemChanges/);
  assert.match(reconnect, /~\/\.claude\.json/);
  assert.doesNotMatch(reconnect, /In `~\/\.claude\/settings\.json`/);
});

test("signed Windows release docs require pre-extraction Ed25519 verification", async () => {
  const [readme, windowsInstall, runbook, security, coverage, diagram, page, pageDiagram] = await Promise.all([
    readFile(path.join(root, "README.md"), "utf8"),
    readFile(path.join(root, "docs", "WINDOWS_INSTALL.md"), "utf8"),
    readFile(path.join(root, "docs", "GITLAB_RELEASE_RUNBOOK.md"), "utf8"),
    readFile(path.join(root, "docs", "SECURITY_POLICY.md"), "utf8"),
    readFile(path.join(root, "docs", "README_COVERAGE_MATRIX.md"), "utf8"),
    readFile(path.join(root, "docs", "diagrams", "release-signing-flow.svg"), "utf8"),
    readFile(path.join(root, "site", "index.html"), "utf8"),
    readFile(path.join(root, "site", "diagrams", "release-signing-flow.svg"), "utf8")
  ]);
  assert.match(readme, /release-signing-flow\.svg/);
  assert.match(readme, /release:verify/);
  assert.match(windowsInstall, /\.zip\.sha256/);
  assert.match(windowsInstall, /\.zip\.sig/);
  assert.match(windowsInstall, /verify-hermesproof-release\.mjs/);
  assert.match(windowsInstall, /before (extracting|extraction)/i);
  assert.match(runbook, /HERMESPROOF_RELEASE_SIGNING_KEY_FILE/);
  assert.match(runbook, /key fingerprint/i);
  assert.match(runbook, /hermesproof-release-ed25519-public\.pem/);
  assert.match(security, /C:\\private/);
  assert.match(security, /Ed25519/);
  assert.match(coverage, /cryptographic signature/i);
  assert.match(diagram, /role="img"/);
  assert.match(diagram, /aria-labelledby=/);
  assert.match(diagram, /<title/);
  assert.match(diagram, /<desc/);
  assert.match(diagram, /Ed25519/);
  assert.match(page, /release-signing-flow\.svg/);
  assert.equal(pageDiagram, diagram);
});
