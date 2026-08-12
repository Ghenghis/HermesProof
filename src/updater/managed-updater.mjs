import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const SCHEMA = "hermesproof.managed-updater.v1";
const SHA_RE = /^[0-9a-f]{40,64}$/;
const SERVERS = ["hermes3d-locks", "hp-mha-serena"];
const LOCK_STALE_MS = 30 * 60 * 1000;

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return structuredClone(fallback);
    throw new Error("Invalid updater state at " + file + ": " + error.message);
  }
}

async function writeJsonAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = file + ".tmp-" + crypto.randomUUID();
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  await fs.rename(temporary, file);
}

function validateSha(sha) {
  if (typeof sha !== "string" || !SHA_RE.test(sha)) throw new Error("candidate SHA is invalid");
  return sha;
}

function reasonOf(value, fallback) {
  return typeof value?.reason === "string" && value.reason ? value.reason : fallback;
}

export class ManagedUpdater {
  constructor({
    managedRoot,
    source,
    verifier,
    clientInstaller,
    clientRestorer = async () => ({ ok: true, status: "not_required" }),
    probe,
    clock = () => new Date()
  } = {}) {
    if (!path.isAbsolute(managedRoot || "")) throw new Error("managedRoot must be absolute");
    for (const [name, value] of Object.entries({ source, verifier, clientInstaller, clientRestorer, probe })) {
      if (!value || (name === "source" ? typeof value.resolve !== "function" || typeof value.stage !== "function" : typeof value !== "function")) {
        throw new Error(name + " dependency is invalid");
      }
    }
    this.root = path.resolve(managedRoot);
    this.source = source;
    this.verifier = verifier;
    this.clientInstaller = clientInstaller;
    this.clientRestorer = clientRestorer;
    this.probe = probe;
    this.clock = clock;
    this.paths = {
      state: path.join(this.root, "state"),
      active: path.join(this.root, "state", "active-release.json"),
      registry: path.join(this.root, "state", "releases.json"),
      journal: path.join(this.root, "state", "activation-transaction.json"),
      lock: path.join(this.root, "state", "updater.lock"),
      releases: path.join(this.root, "releases"),
      staging: path.join(this.root, "staging"),
      quarantine: path.join(this.root, "quarantine"),
      evidence: path.join(this.root, "evidence")
    };
  }

  async initialize() {
    const rootStat = await fs.lstat(this.root).catch((error) =>
      error?.code === "ENOENT" ? null : Promise.reject(error)
    );
    if (rootStat?.isSymbolicLink()) throw new Error("managed root is a link or junction");
    for (const directory of [
      this.paths.state,
      this.paths.releases,
      this.paths.staging,
      this.paths.quarantine,
      this.paths.evidence
    ]) {
      await fs.mkdir(directory, { recursive: true });
      const stat = await fs.lstat(directory);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error("managed directory is a link or invalid: " + directory);
      }
      const relative = path.relative(this.root, await fs.realpath(directory));
      if (!relative || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
        throw new Error("managed directory escapes the managed root");
      }
    }
    await this.recoverInterruptedActivation();
  }

  async recoverInterruptedActivation() {
    const journal = await readJson(this.paths.journal, null);
    if (!journal) return { ok: true, status: "none" };
    if (journal.schema !== SCHEMA || journal.phase !== "activating") {
      throw new Error("activation journal is invalid");
    }
    const sha = validateSha(journal.sha);
    if (!journal.previous || journal.previous.schema !== SCHEMA) {
      throw new Error("activation journal previous state is invalid");
    }
    const expectedDirectory = path.resolve(this.paths.releases, sha);
    if (path.resolve(journal.releaseDirectory || "") !== expectedDirectory) {
      throw new Error("activation journal release directory is invalid");
    }
    const current = await this.activeState();
    const restored = {
      ...journal.previous,
      generation: Math.max(Number(current.generation) || 0, Number(journal.previous.generation) || 0) + 1,
      previousSha: sha,
      recoveredUtc: this.clock().toISOString()
    };
    await writeJsonAtomic(this.paths.active, restored);
    let clientRecovery;
    try {
      clientRecovery = await this.clientRestorer({
        snapshot: journal.clientSnapshot || null,
        sha,
        releaseDirectory: expectedDirectory,
        reason: "interrupted activation"
      });
    } catch (error) {
      clientRecovery = { ok: false, reason: error.message };
    }
    const reason = clientRecovery?.ok === false
      ? "interrupted activation; client recovery failed: " + reasonOf(clientRecovery, "unknown recovery error")
      : "interrupted activation recovered fail-closed";
    await this.recordRelease({
      sha,
      state: "quarantined",
      reason,
      phase: "interrupted-activation",
      directory: expectedDirectory,
      recordedUtc: this.clock().toISOString()
    });
    await fs.unlink(this.paths.journal);
    return { ok: clientRecovery?.ok !== false, status: "recovered", sha, clientRecovery };
  }

  async activeState() {
    return await readJson(this.paths.active, {
      schema: SCHEMA,
      generation: 0,
      currentSha: null,
      previousSha: null,
      channel: "stable",
      evidenceDigest: null
    });
  }

  async registry() {
    return await readJson(this.paths.registry, { schema: SCHEMA, releases: [] });
  }

  async status() {
    await this.initialize();
    const [active, registry] = await Promise.all([this.activeState(), this.registry()]);
    return {
      ok: true,
      schema: SCHEMA,
      managedRoot: this.root,
      generation: active.generation,
      currentSha: active.currentSha,
      previousSha: active.previousSha,
      channel: active.channel,
      evidenceDigest: active.evidenceDigest,
      quarantined: registry.releases.filter((item) => item.state === "quarantined")
    };
  }

  async check({ channel = "stable" } = {}) {
    await this.initialize();
    const candidate = await this.source.resolve({ channel });
    const sha = validateSha(candidate.sha);
    const active = await this.activeState();
    return {
      ok: true,
      channel,
      currentSha: active.currentSha,
      candidateSha: sha,
      updateAvailable: active.currentSha !== sha,
      ref: candidate.ref,
      remote: candidate.remote
    };
  }

  async withLock(action) {
    await this.initialize();
    try {
      await fs.mkdir(this.paths.lock, { recursive: false });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const stat = await fs.lstat(this.paths.lock);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error("updater lock is a link or invalid");
      }
      const owner = await readJson(path.join(this.paths.lock, "owner.json"), null);
      const started = Date.parse(owner?.startedUtc || "");
      const age = this.clock().getTime() - started;
      if (!Number.isFinite(started) || age < 0 || age <= LOCK_STALE_MS) {
        throw new Error("another updater transaction is active");
      }
      const stale = this.paths.lock + ".stale-" + crypto.randomUUID();
      await fs.rename(this.paths.lock, stale);
      await fs.rm(stale, { recursive: true, force: false });
      await fs.mkdir(this.paths.lock, { recursive: false });
    }
    await writeJsonAtomic(path.join(this.paths.lock, "owner.json"), {
      schema: SCHEMA,
      pid: process.pid,
      startedUtc: this.clock().toISOString()
    });
    try {
      return await action();
    } finally {
      await fs.rm(this.paths.lock, { recursive: true, force: false }).catch(() => {});
    }
  }

  async recordRelease(entry) {
    const registry = await this.registry();
    registry.releases = registry.releases.filter((item) => item.sha !== entry.sha);
    registry.releases.push(entry);
    await writeJsonAtomic(this.paths.registry, registry);
  }

  async quarantine({ sha, directory, reason, phase }) {
    const destination = path.join(
      this.paths.quarantine,
      sha + "-" + this.clock().toISOString().replace(/[:.]/g, "-")
    );
    try {
      await fs.rename(directory, destination);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const entry = {
      sha,
      state: "quarantined",
      reason,
      phase,
      directory: destination,
      recordedUtc: this.clock().toISOString()
    };
    await this.recordRelease(entry);
    return entry;
  }

  async apply({ channel = "stable" } = {}) {
    return await this.withLock(async () => {
      const check = await this.check({ channel });
      if (!check.updateAvailable) {
        return { ok: true, status: "current", currentSha: check.currentSha };
      }
      const sha = check.candidateSha;
      const registry = await this.registry();
      const blocked = registry.releases.find((item) => item.sha === sha && item.state === "quarantined");
      if (blocked) return { ok: false, status: "quarantined", sha, reason: blocked.reason };

      const stagingDirectory = path.join(this.paths.staging, sha + "-" + crypto.randomUUID());
      await fs.mkdir(stagingDirectory, { recursive: false });
      try {
        await this.source.stage({ sha, directory: stagingDirectory, channel });
        const verification = await this.verifier({ sha, directory: stagingDirectory, channel });
        if (!verification?.ok) {
          const reason = reasonOf(verification, "candidate verification failed");
          await this.quarantine({ sha, directory: stagingDirectory, reason, phase: "verification" });
          return { ok: false, status: "quarantined", sha, reason };
        }

        const releaseDirectory = path.join(this.paths.releases, sha);
        try {
          await fs.rename(stagingDirectory, releaseDirectory);
        } catch (error) {
          if (error?.code !== "EEXIST") throw error;
          await fs.rm(stagingDirectory, { recursive: true, force: true });
        }

        const clientResult = await this.clientInstaller({ sha, releaseDirectory, channel });
        if (!clientResult?.ok) {
          const reason = reasonOf(clientResult, "client configuration failed");
          await this.quarantine({ sha, directory: releaseDirectory, reason, phase: "clients" });
          return { ok: false, status: "quarantined", sha, reason };
        }

        const previous = await this.activeState();
        const next = {
          schema: SCHEMA,
          generation: previous.generation + 1,
          currentSha: sha,
          previousSha: previous.currentSha,
          channel,
          evidenceDigest: verification.evidenceDigest || null,
          clientSnapshot: clientResult.snapshot || null,
          activatedUtc: this.clock().toISOString()
        };
        await writeJsonAtomic(this.paths.journal, {
          schema: SCHEMA,
          phase: "activating",
          sha,
          previous,
          clientSnapshot: clientResult.snapshot || null,
          releaseDirectory,
          createdUtc: this.clock().toISOString()
        });
        await writeJsonAtomic(this.paths.active, next);

        for (const server of SERVERS) {
          const health = await this.probe({ sha, releaseDirectory, server });
          if (!health?.ok) {
            await writeJsonAtomic(this.paths.active, {
              ...previous,
              generation: next.generation + 1,
              previousSha: sha,
              rolledBackUtc: this.clock().toISOString()
            });
            const clientRecovery = await this.clientRestorer({
              snapshot: clientResult.snapshot || null,
              sha,
              releaseDirectory,
              server
            });
            const probeReason = reasonOf(health, server + " post-activation probe failed");
            const reason = clientRecovery?.ok === false
              ? probeReason + "; client recovery failed: " + reasonOf(clientRecovery, "unknown recovery error")
              : probeReason;
            await this.recordRelease({
              sha,
              state: "quarantined",
              reason,
              phase: "post-activation",
              directory: releaseDirectory,
              recordedUtc: this.clock().toISOString()
            });
            await fs.unlink(this.paths.journal).catch(() => {});
            return {
              ok: false,
              status: "rolled_back",
              sha,
              reason,
              currentSha: previous.currentSha,
              clientRecovery: clientRecovery || null
            };
          }
        }

        await this.recordRelease({
          sha,
          state: "known-good",
          directory: releaseDirectory,
          evidenceDigest: verification.evidenceDigest || null,
          recordedUtc: this.clock().toISOString()
        });
        await fs.unlink(this.paths.journal);
        return {
          ok: true,
          status: "activated",
          currentSha: sha,
          previousSha: previous.currentSha,
          evidenceDigest: verification.evidenceDigest || null
        };
      } catch (error) {
        await this.quarantine({
          sha,
          directory: stagingDirectory,
          reason: error.message,
          phase: "exception"
        }).catch(() => {});
        throw error;
      }
    });
  }

  async rollback() {
    return await this.withLock(async () => {
      const active = await this.activeState();
      if (!active.previousSha) return { ok: false, status: "unavailable", reason: "no previous known-good release" };
      const registry = await this.registry();
      const previous = registry.releases.find((item) => item.sha === active.previousSha && item.state === "known-good");
      if (!previous) throw new Error("previous release is not known-good");
      const next = {
        ...active,
        generation: active.generation + 1,
        currentSha: active.previousSha,
        previousSha: active.currentSha,
        evidenceDigest: previous.evidenceDigest || null,
        rolledBackUtc: this.clock().toISOString()
      };
      await writeJsonAtomic(this.paths.active, next);
      return { ok: true, status: "rolled_back", currentSha: next.currentSha, previousSha: next.previousSha };
    });
  }

  async cleanup({ retain = 2, dryRun = true } = {}) {
    if (!Number.isSafeInteger(retain) || retain < 2 || retain > 20) {
      throw new Error("retention count is invalid");
    }
    return await this.withLock(async () => {
      const [active, registry] = await Promise.all([this.activeState(), this.registry()]);
      const knownGood = registry.releases
        .filter((item) => item.state === "known-good")
        .sort((left, right) => String(right.recordedUtc || "").localeCompare(String(left.recordedUtc || "")));
      const protectedShas = new Set([
        active.currentSha,
        active.previousSha,
        ...knownGood.slice(0, retain).map((item) => item.sha)
      ].filter(Boolean));
      const removable = knownGood
        .map((item) => validateSha(item.sha))
        .filter((sha) => !protectedShas.has(sha));
      if (dryRun) return { ok: true, status: "planned", retain, removable, removed: [] };

      const removed = [];
      for (const sha of removable) {
        const releaseDirectory = path.resolve(this.paths.releases, sha);
        const relative = path.relative(this.paths.releases, releaseDirectory);
        if (!relative || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
          throw new Error("cleanup path escapes the release root");
        }
        const stat = await fs.lstat(releaseDirectory).catch((error) => {
          if (error?.code === "ENOENT") return null;
          throw error;
        });
        if (stat?.isSymbolicLink()) throw new Error("cleanup target is a link or junction");
        if (stat) await fs.rm(releaseDirectory, { recursive: true, force: false });
        removed.push(sha);
      }
      registry.releases = registry.releases.filter((item) => !removed.includes(item.sha));
      await writeJsonAtomic(this.paths.registry, registry);
      return { ok: true, status: "removed", retain, removable, removed };
    });
  }
}

export { SCHEMA as MANAGED_UPDATER_SCHEMA, SERVERS as MANAGED_SERVER_NAMES };
