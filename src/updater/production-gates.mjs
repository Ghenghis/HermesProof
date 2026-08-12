import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { runProcess } from "./process-runner.mjs";

function outputDigest(result) {
  return crypto.createHash("sha256")
    .update((result.stdout || "") + "\n" + (result.stderr || ""))
    .digest("hex");
}

async function commandResult(runner, options) {
  try {
    const result = await runner(options);
    return {
      ok: true,
      details: {
        command: path.basename(options.command),
        argv: options.args,
        output_sha256: outputDigest(result)
      }
    };
  } catch (error) {
    return {
      ok: false,
      reason: error.message,
      details: {
        command: path.basename(options.command),
        argv: options.args
      }
    };
  }
}

async function defaultProbe(options) {
  const { probeCandidateServer } = await import("../../scripts/updater-candidate-probe.mjs");
  return await probeCandidateServer(options);
}

export function createProductionCandidateGates({
  runner = runProcess,
  probe = defaultProbe
} = {}) {
  if (typeof runner !== "function" || typeof probe !== "function") {
    throw new Error("production gate dependencies are invalid");
  }
  const node = process.execPath;
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";

  return {
    "source-integrity": async ({ sha, directory }) => {
      try {
        const head = await runner({
          command: "git",
          args: ["-C", directory, "rev-parse", "HEAD"],
          timeoutMs: 30_000,
          maxOutputBytes: 64 * 1024
        });
        const status = await runner({
          command: "git",
          args: ["-C", directory, "status", "--porcelain=v1", "--untracked-files=no"],
          timeoutMs: 30_000,
          maxOutputBytes: 256 * 1024
        });
        if (head.stdout.trim() !== sha) return { ok: false, reason: "staged HEAD does not match candidate SHA" };
        if (status.stdout.trim()) return { ok: false, reason: "tracked candidate files are dirty" };
        return { ok: true, details: { sha, clean: true } };
      } catch (error) {
        return { ok: false, reason: error.message };
      }
    },
    "dependency-locks": async ({ directory }) => {
      try {
        const lock = await fs.lstat(path.join(directory, "package-lock.json"));
        if (lock.isSymbolicLink() || !lock.isFile() || lock.size < 2) {
          return { ok: false, reason: "package-lock.json is invalid" };
        }
      } catch (error) {
        return { ok: false, reason: "package-lock.json is required: " + error.message };
      }
      return await commandResult(runner, {
        command: npm,
        args: ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
        cwd: directory,
        timeoutMs: 600_000,
        maxOutputBytes: 4 * 1024 * 1024
      });
    },
    "serena-config": async ({ directory }) => {
      try {
        const raw = await fs.readFile(path.join(directory, ".serena", "project.yml"), "utf8");
        if (!/^languages:\s*$/m.test(raw) || !/^\s*-\s*typescript\s*$/m.test(raw)) {
          return { ok: false, reason: "Serena languages must include typescript" };
        }
        if (!/^read_only:\s*true\s*$/m.test(raw)) {
          return { ok: false, reason: "Serena project must be read_only" };
        }
      } catch (error) {
        return { ok: false, reason: "Serena project config is invalid: " + error.message };
      }
      return await commandResult(runner, {
        command: node,
        args: [
          "--test",
          "src/hp-mha-serena/serena-catalog.test.mjs",
          "src/hp-mha-serena/context-installer.test.mjs",
          "scripts/serena-integration-e2e.test.mjs"
        ],
        cwd: directory,
        timeoutMs: 300_000,
        maxOutputBytes: 4 * 1024 * 1024
      });
    },
    "test-suite": async ({ directory }) => await commandResult(runner, {
      command: npm,
      args: ["test"],
      cwd: directory,
      timeoutMs: 900_000,
      maxOutputBytes: 8 * 1024 * 1024
    }),
    "registry-and-docs-drift": async ({ directory }) => await commandResult(runner, {
      command: npm,
      args: ["run", "docs:check"],
      cwd: directory,
      timeoutMs: 180_000,
      maxOutputBytes: 4 * 1024 * 1024
    }),
    "hp-mha-merkle": async ({ directory }) => await commandResult(runner, {
      command: npm,
      args: ["run", "hp-mha:smoke-e2e"],
      cwd: directory,
      timeoutMs: 300_000,
      maxOutputBytes: 4 * 1024 * 1024
    }),
    "mcp-hermes3d-locks": async ({ directory }) => {
      try {
        const result = await probe({
          candidateRoot: directory,
          workspaceRoot: directory,
          server: "hermes3d-locks"
        });
        return result?.ok ? { ok: true, details: result } : { ok: false, reason: result?.reason || "core MCP probe failed" };
      } catch (error) {
        return { ok: false, reason: error.message };
      }
    },
    "mcp-hp-mha-serena": async ({ directory }) => {
      try {
        const result = await probe({
          candidateRoot: directory,
          workspaceRoot: directory,
          server: "hp-mha-serena"
        });
        return result?.ok ? { ok: true, details: result } : { ok: false, reason: result?.reason || "composite MCP probe failed" };
      } catch (error) {
        return { ok: false, reason: error.message };
      }
    },
    "secrets-and-sbom": async ({ directory }) => {
      const sbom = await commandResult(runner, {
        command: node,
        args: ["scripts/sbom-generator.mjs", "--root", directory],
        cwd: directory,
        timeoutMs: 60_000,
        maxOutputBytes: 2 * 1024 * 1024
      });
      if (!sbom.ok) return sbom;
      const scan = await commandResult(runner, {
        command: node,
        args: [
          "--test",
          "scripts/mcp-scan-static-gate.test.mjs",
          "scripts/release-checksum-test.mjs",
          "scripts/secret-rotation-smoke-test.mjs"
        ],
        cwd: directory,
        timeoutMs: 180_000,
        maxOutputBytes: 4 * 1024 * 1024
      });
      return scan.ok
        ? { ok: true, details: { sbom: sbom.details, scans: scan.details } }
        : scan;
    }
  };
}
