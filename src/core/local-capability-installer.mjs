import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function sha256File(file) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function defaultCommandRunner({ cwd, packageSpec }) {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  await execFileAsync(npm, ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--save-exact", packageSpec], {
    cwd,
    windowsHide: true,
    timeout: 300_000,
    maxBuffer: 8 * 1024 * 1024
  });
}

async function defaultProbeRunner({ executable, args }) {
  const command = /\.(?:c?m?js)$/iu.test(executable) ? process.execPath : executable;
  const commandArgs = command === process.execPath ? [executable, ...args] : args;
  const result = await execFileAsync(command, commandArgs, {
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: 1024 * 1024
  });
  return String(result.stdout || result.stderr || "").trim().split(/\r?\n/u)[0];
}

function assertInside(parent, candidate, label) {
  const relative = path.relative(parent, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(label + " must be a versioned child of the capability-pack root");
  }
}

export function createLocalCapabilityInstaller({ workspaceRoot, commandRunner = defaultCommandRunner, probeRunner = defaultProbeRunner } = {}) {
  const root = path.resolve(workspaceRoot || "");
  if (!workspaceRoot) throw new TypeError("workspaceRoot is required");
  const packsRoot = path.join(root, ".hermes3d_orchestrator", "capability-packs");

  async function inspectInstall({ installDir, pack }) {
    const lock = JSON.parse(await fs.readFile(path.join(installDir, "package-lock.json"), "utf8"));
    const packageKey = "node_modules/" + pack.source.package;
    const locked = lock.packages?.[packageKey];
    if (!locked || locked.version !== pack.version || locked.integrity !== pack.source.integrity) {
      throw new Error("installed package lock does not match pinned version and integrity");
    }
    const packageDir = path.join(installDir, "node_modules", ...pack.source.package.split("/"));
    const packageJson = JSON.parse(await fs.readFile(path.join(packageDir, "package.json"), "utf8"));
    if (packageJson.name !== pack.source.package || packageJson.version !== pack.version) {
      throw new Error("installed package identity mismatch");
    }
    const binValue = packageJson.bin;
    const relativeBin = typeof binValue === "string" ? binValue : binValue?.kilo || binValue?.[Object.keys(binValue || {})[0]];
    if (!relativeBin) throw new Error("installed capability pack has no executable");
    const executable = path.resolve(packageDir, relativeBin);
    assertInside(packageDir, executable, "package executable");
    const executableSha256 = await sha256File(executable);
    const lockSha256 = await sha256File(path.join(installDir, "package-lock.json"));
    const sbom = {
      spdxVersion: "SPDX-2.3",
      dataLicense: "CC0-1.0",
      SPDXID: "SPDXRef-DOCUMENT",
      name: "HermesProof capability pack " + pack.id + "@" + pack.version,
      documentNamespace: "urn:hermesproof:capability-pack:" + pack.id + ":" + executableSha256,
      packages: [{ SPDXID: "SPDXRef-Package", name: packageJson.name, versionInfo: packageJson.version, downloadLocation: "NOASSERTION", checksums: [{ algorithm: "SHA256", checksumValue: executableSha256 }] }],
      externalDocumentRefs: [{ externalDocumentId: "DocumentRef-PackageLock", spdxDocument: "urn:sha256:" + lockSha256, checksum: { algorithm: "SHA256", checksumValue: lockSha256 } }]
    };
    const sbomText = JSON.stringify(sbom, null, 2) + "\n";
    await fs.writeFile(path.join(installDir, "sbom.spdx.json"), sbomText, "utf8");
    const healthOutput = await probeRunner({ executable, args: pack.health_probe?.args || [] });
    return {
      executable_sha256: executableSha256,
      schema_sha256: pack.schema_sha256,
      package_integrity: pack.source.integrity,
      dependency_lock_sha256: lockSha256,
      sbom_sha256: crypto.createHash("sha256").update(sbomText).digest("hex"),
      executable,
      installed_path: installDir,
      health: { ok: true, output: healthOutput },
      enabled: false
    };
  }

  return async function install({ pack, plan } = {}) {
    if (pack?.source?.type !== "npm") throw new Error("local installer currently accepts pinned npm packs only");
    const finalDir = path.resolve(plan?.sandbox_path || "");
    assertInside(packsRoot, finalDir, "sandbox path");
    const expectedSuffix = path.join(pack.id, pack.version);
    if (!finalDir.endsWith(expectedSuffix)) throw new Error("sandbox path must bind pack id and version");
    const existing = await fs.stat(finalDir).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (existing) return inspectInstall({ installDir: finalDir, pack });
    await fs.mkdir(path.dirname(finalDir), { recursive: true });
    const staging = finalDir + ".staging-" + crypto.randomBytes(8).toString("hex");
    assertInside(packsRoot, staging, "staging path");
    try {
      await fs.mkdir(staging, { recursive: false });
      await fs.writeFile(path.join(staging, "package.json"), JSON.stringify({ private: true, name: "hermesproof-pack-" + pack.id, version: "0.0.0", dependencies: { [pack.source.package]: pack.version } }, null, 2) + "\n", "utf8");
      await commandRunner({ cwd: staging, packageSpec: pack.source.package + "@" + pack.version });
      const receipt = await inspectInstall({ installDir: staging, pack });
      await fs.rename(staging, finalDir);
      return { ...receipt, executable: receipt.executable.replace(staging, finalDir), installed_path: finalDir };
    } catch (error) {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  };
}
