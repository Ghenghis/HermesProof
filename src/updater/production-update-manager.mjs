import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  restoreClientConfigSnapshot
} from "../core/client-config-snapshot.mjs";
import { loadReleaseFacts } from "../core/release-facts.mjs";
import {
  writeClients
} from "../../scripts/wizard-writers.mjs";
import {
  probeCandidateServer
} from "../../scripts/updater-candidate-probe.mjs";
import { createGitSource } from "./git-source.mjs";
import { ManagedUpdater } from "./managed-updater.mjs";
import { createUpdaterPathPolicy } from "./path-policy.mjs";
import { createProductionCandidateGates } from "./production-gates.mjs";
import { createReleaseVerifier } from "./release-verifier.mjs";
import { createSystemdUserTimer } from "./systemd-user-timer.mjs";
import { UpdateManager } from "./update-manager.mjs";
import { createWindowsTaskScheduler } from "./windows-task-scheduler.mjs";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(moduleDirectory, "../..");

function machineFingerprint() {
  const identity = [os.hostname(), os.userInfo().username, process.platform, process.arch].join("|");
  return crypto.createHash("sha256").update(identity).digest("hex");
}

function secretsFromEnvironment(environment) {
  return Object.entries(environment)
    .filter(([name, value]) =>
      typeof value === "string" &&
      value.length >= 8 &&
      /(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|API_KEY)/i.test(name)
    )
    .map(([, value]) => value);
}

function unsupportedScheduler() {
  return {
    install: async () => ({ ok: false, status: "unsupported", reason: "scheduler adapter is unavailable" }),
    inspect: async () => ({ ok: false, status: "unsupported" }),
    remove: async () => ({ ok: true, status: "absent" })
  };
}

export async function createProductionUpdateManager({
  workspaceRoot = process.env.MCP_LOCK_WORKSPACE || process.env.HERMES_WORKSPACE_ROOT || process.cwd(),
  managedRoot = process.env.HERMESPROOF_MANAGED_ROOT || path.join(os.homedir(), ".hermesproof-managed"),
  repoRoot = defaultRepoRoot,
  launcherPath,
  updaterScript,
  environment = process.env,
  machineId = machineFingerprint(),
  source,
  verifier,
  clientInstaller,
  clientRestorer,
  probe,
  scheduler
} = {}) {
  const root = path.resolve(managedRoot);
  const workspace = path.resolve(workspaceRoot);
  const repository = path.resolve(repoRoot);
  const resolvedLauncherPath = path.resolve(launcherPath || environment.HERMESPROOF_LAUNCHER_PATH || path.join(repository, "scripts", "hermesproof-launch.mjs"));
  const resolvedUpdaterScript = path.resolve(updaterScript || environment.HERMESPROOF_UPDATER_LAUNCHER_PATH || path.join(repository, "scripts", "hermesproof-update.mjs"));
  await createUpdaterPathPolicy({
    managedRoot: root,
    homeDirectory: os.homedir(),
    repositoryRoot: repository
  });
  const facts = await loadReleaseFacts({ root: repository });
  const actualSource = source || createGitSource({
    remoteUrl: facts.gitlab.projectUrl + ".git",
    allowedRemotes: [facts.gitlab.projectUrl + ".git"],
    channels: facts.channels
  });
  const actualProbe = probe || (async ({ releaseDirectory, server }) =>
    await probeCandidateServer({
      candidateRoot: releaseDirectory,
      workspaceRoot: workspace,
      server
    }));
  const gates = createProductionCandidateGates();
  const actualVerifier = verifier || createReleaseVerifier({
    gates,
    evidenceRoot: path.join(root, "evidence"),
    redact: secretsFromEnvironment(environment)
  });
  const actualClientInstaller = clientInstaller || (async ({ releaseDirectory }) => {
    const result = await writeClients({
      clients: facts.install.defaultTargets,
      workspaceRoot: workspace,
      repoRoot: releaseDirectory,
      launcherPath: resolvedLauncherPath,
      env: {
        ...environment,
        HERMESPROOF_MANAGED_ROOT: root
      }
    });
    return {
      ...result,
      ok: Object.values(result.results).every((item) => item.ok !== false)
    };
  });
  const actualClientRestorer = clientRestorer || (async ({ snapshot }) => {
    if (!snapshot) return { ok: true, status: "no_snapshot" };
    return await restoreClientConfigSnapshot({
      manifestFile: snapshot.manifestFile,
      manifestSha256: snapshot.manifestSha256,
      allowedFiles: snapshot.allowedFiles
    });
  });
  const actualScheduler = scheduler || (
    process.platform === "win32"
      ? createWindowsTaskScheduler({
          nodePath: process.execPath,
          updaterScript: resolvedUpdaterScript
        })
      : process.platform === "linux"
        ? createSystemdUserTimer({
            nodePath: process.execPath,
            updaterScript: resolvedUpdaterScript,
            unitDirectory: path.join(os.homedir(), ".config", "systemd", "user")
          })
        : unsupportedScheduler()
  );
  const updater = new ManagedUpdater({
    managedRoot: root,
    source: actualSource,
    verifier: actualVerifier,
    clientInstaller: actualClientInstaller,
    clientRestorer: actualClientRestorer,
    probe: actualProbe
  });
  return new UpdateManager({
    managedRoot: root,
    updater,
    scheduler: actualScheduler,
    machineId
  });
}
