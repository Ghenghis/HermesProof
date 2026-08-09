#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

function takeOption(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(name + " requires a value");
  return value;
}

function parse(argv) {
  if (!Array.isArray(argv) || argv.length === 0) return { command: "status", json: false };
  const [command, ...rest] = argv;
  const options = { command, json: false, apply: false, force: false, ackPreview: false };
  const positionals = [];
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value === "--json") options.json = true;
    else if (value === "--apply") options.apply = true;
    else if (value === "--force") options.force = true;
    else if (value === "--ack-preview") options.ackPreview = true;
    else if (value === "--cadence-hours") options.cadenceHours = Number(takeOption(rest, index++, value));
    else if (value === "--jitter-minutes") options.jitterMinutes = Number(takeOption(rest, index++, value));
    else if (value === "--retain") options.retain = Number(takeOption(rest, index++, value));
    else if (value.startsWith("--")) throw new Error("unknown updater option: " + value);
    else positionals.push(value);
  }
  options.positionals = positionals;
  return options;
}

function humanSummary(result) {
  const status = result.status || (result.ok ? "ok" : "failed");
  const sha = result.currentSha || result.candidateSha || result.sha;
  return "HermesProof updater: " + status + (sha ? " (" + sha + ")" : "");
}

async function defaultManagerFactory() {
  const { createProductionUpdateManager } = await import("../src/updater/production-update-manager.mjs");
  return await createProductionUpdateManager();
}

export async function runUpdateCli(argv = process.argv.slice(2), {
  managerFactory = defaultManagerFactory,
  write = (value) => process.stdout.write(value + "\n")
} = {}) {
  const args = parse(argv);
  const manager = await managerFactory();
  let result;
  switch (args.command) {
    case "status":
      if (args.positionals.length) throw new Error("status accepts no arguments");
      result = await manager.status();
      break;
    case "check":
      if (args.positionals.length) throw new Error("check accepts no arguments");
      result = await manager.check();
      break;
    case "apply":
      if (args.positionals.length) throw new Error("apply accepts no arguments");
      result = await manager.apply();
      break;
    case "rollback":
      if (args.positionals.length) throw new Error("rollback accepts no arguments");
      result = await manager.rollback();
      break;
    case "channel": {
      const channel = args.positionals[0];
      if (!channel || args.positionals.length !== 1) throw new Error("channel requires stable or preview");
      if (channel === "preview" && !args.ackPreview) throw new Error("preview channel requires --ack-preview");
      result = await manager.channel({ channel, acknowledgePreview: args.ackPreview });
      break;
    }
    case "auto": {
      const action = args.positionals[0] || "run";
      if (args.positionals.length > 1) throw new Error("auto accepts one action");
      if (action === "run") result = await manager.auto({ force: args.force });
      else if (action === "enable" || action === "disable") {
        result = await manager.configureAuto({
          enabled: action === "enable",
          cadenceHours: args.cadenceHours ?? 6,
          jitterMinutes: args.jitterMinutes ?? 45
        });
      } else throw new Error("auto action must be run, enable, or disable");
      break;
    }
    case "cleanup": {
      if (args.positionals.length) throw new Error("cleanup accepts no positional arguments");
      const dryRun = !args.apply;
      result = {
        ...(await manager.cleanup({ retain: args.retain ?? 2, dryRun })),
        dryRun
      };
      break;
    }
    case "evidence": {
      const sha = args.positionals[0];
      if (!sha || args.positionals.length !== 1) throw new Error("evidence requires one release SHA");
      result = await manager.evidence({ sha });
      break;
    }
    default:
      throw new Error("unknown updater command: " + args.command);
  }
  write(args.json ? JSON.stringify(result) : humanSummary(result));
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runUpdateCli().then((result) => {
    process.exitCode = result?.ok === false ? 1 : 0;
  }).catch((error) => {
    process.stderr.write("HermesProof updater failed: " + error.message + "\n");
    process.exitCode = 1;
  });
}
