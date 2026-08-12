#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { installSerenaContexts } from "../src/hp-mha-serena/context-installer.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

function parseArgs(argv) {
  const options = {
    checkOnly: false,
    serenaHome: process.env.SERENA_HOME
      ? path.resolve(process.env.SERENA_HOME)
      : path.join(os.homedir(), ".serena")
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") options.checkOnly = true;
    else if (argument === "--serena-home") {
      const value = argv[index + 1];
      if (!value) throw new Error("--serena-home requires a path");
      options.serenaHome = path.resolve(value);
      index += 1;
    } else if (argument !== "--json") {
      throw new Error("Unknown argument: " + argument);
    }
  }
  return options;
}

try {
  const options = parseArgs(process.argv.slice(2));
  const result = await installSerenaContexts({
    sourceDir: path.join(repoRoot, ".serena", "contexts"),
    ...options
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  process.stderr.write(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error)
  }, null, 2) + "\n");
  process.exitCode = 1;
}
