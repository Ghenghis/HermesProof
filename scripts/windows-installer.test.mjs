import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");

async function parsePowerShell(file) {
  const command = "$tokens=$null;$errors=$null;[System.Management.Automation.Language.Parser]::ParseFile($env:HP_PARSE_FILE,[ref]$tokens,[ref]$errors)|Out-Null;if($errors.Count){$errors|ForEach-Object{$_.Message};exit 1}";
  await execFileAsync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], {
    env: { ...process.env, HP_PARSE_FILE: file },
    windowsHide: true
  });
}

test("Windows installer and uninstaller parse and contain fail-safe controls", async () => {
  const installFile = path.join(root, "install-hermesproof.ps1");
  const uninstallFile = path.join(root, "uninstall-hermesproof.ps1");
  await Promise.all([parsePowerShell(installFile), parsePowerShell(uninstallFile)]);
  const install = await fs.readFile(installFile, "utf8");
  const uninstall = await fs.readFile(uninstallFile, "utf8");
  assert.match(install, /release-manifest\.json/);
  assert.match(install, /Get-FileHash/);
  assert.match(install, /hermes3d-locks/);
  assert.match(install, /hp-mha-serena/);
  assert.match(install, /hermesproof-launch\.mjs/);
  assert.match(install, /install-clients\.mjs/);
  assert.match(install, /clientSnapshot/);
  assert.match(install, /\$previousInstall\s*=\s*Read-JsonOrDefault/);
  assert.match(install, /clientSnapshot\s*=\s*\$uninstallSnapshot/);
  assert.match(install, /quarantine/i);
  assert.match(install, /AutoUpdate/);
  assert.match(install, /\[switch\]\$SkipUserPath/);
  assert.match(install, /if \(-not \$SkipUserPath\) \{[\s\S]*SetEnvironmentVariable\("Path"/);
  assert.doesNotMatch(
    install,
    /generation\s*=\s*\(if\b/,
    "Windows PowerShell executes a parenthesized inline if as a command"
  );
  assert.match(uninstall, /restore-client-snapshot\.mjs/);
  assert.match(uninstall, /PurgeManagedData/);
  assert.match(uninstall, /HermesProof Automatic Update/);
});

test("uninstaller restores the first-install client snapshot after a repair", async (t) => {
  const uninstallerFile = path.join(root, "uninstall-hermesproof.ps1");
  const uninstaller = await fs.readFile(uninstallerFile, "utf8");
  assert.match(
    uninstaller,
    /\[switch\]\$SkipSystemChanges/,
    "the isolated executable test must not touch Task Scheduler or the user PATH"
  );
  const managedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hermesproof-uninstall-lineage-"));
  t.after(() => fs.rm(managedRoot, { recursive: true, force: true }));
  const sha = "c".repeat(40);
  const scriptsDir = path.join(managedRoot, "releases", sha, "scripts");
  const stateDir = path.join(managedRoot, "state");
  const recordFile = path.join(managedRoot, "restore-arguments.json");
  const originalManifest = path.join(managedRoot, "backups", "first-install", "manifest.json");
  const repairManifest = path.join(managedRoot, "backups", "repair", "manifest.json");
  await fs.mkdir(scriptsDir, { recursive: true });
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(
    path.join(scriptsDir, "restore-client-snapshot.mjs"),
    'import fs from "node:fs"; fs.writeFileSync(process.env.HP_UNINSTALL_RECORD, JSON.stringify(process.argv.slice(2)));\n',
    "utf8"
  );
  await fs.writeFile(path.join(stateDir, "active-release.json"), JSON.stringify({
    currentSha: sha,
    clientSnapshot: { manifestFile: repairManifest, manifestSha256: "2".repeat(64) }
  }), "utf8");
  await fs.writeFile(path.join(stateDir, "install.json"), JSON.stringify({
    clientSnapshot: { manifestFile: originalManifest, manifestSha256: "1".repeat(64) }
  }), "utf8");

  await execFileAsync("powershell.exe", [
    "-NoLogo", "-NoProfile", "-NonInteractive",
    "-File", uninstallerFile,
    "-ManagedRoot", managedRoot,
    "-SkipSystemChanges"
  ], {
    env: { ...process.env, HP_UNINSTALL_RECORD: recordFile },
    windowsHide: true
  });

  assert.deepEqual(JSON.parse(await fs.readFile(recordFile, "utf8")), [
    "--manifest", originalManifest, "--sha256", "1".repeat(64)
  ]);
});

test("uninstaller restores clients once and a later purge is idempotent", async (t) => {
  const uninstallerFile = path.join(root, "uninstall-hermesproof.ps1");
  const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hermesproof-uninstall-idempotent-"));
  t.after(() => fs.rm(testRoot, { recursive: true, force: true }));
  const managedRoot = path.join(testRoot, "managed");
  const recordFile = path.join(testRoot, "restore-calls.json");
  const sha = "d".repeat(40);
  const scriptsDir = path.join(managedRoot, "releases", sha, "scripts");
  const stateDir = path.join(managedRoot, "state");
  const manifestFile = path.join(managedRoot, "backups", "first-install", "manifest.json");
  await fs.mkdir(scriptsDir, { recursive: true });
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(
    path.join(scriptsDir, "restore-client-snapshot.mjs"),
    'import fs from "node:fs"; const file=process.env.HP_UNINSTALL_RECORD; let calls=[]; try { calls=JSON.parse(fs.readFileSync(file,"utf8")); } catch {} calls.push(process.argv.slice(2)); fs.writeFileSync(file,JSON.stringify(calls));\n',
    "utf8"
  );
  await fs.writeFile(path.join(stateDir, "active-release.json"), JSON.stringify({
    currentSha: sha,
    clientSnapshot: { manifestFile, manifestSha256: "3".repeat(64) }
  }), "utf8");
  await fs.writeFile(path.join(stateDir, "install.json"), JSON.stringify({
    clientSnapshot: { manifestFile, manifestSha256: "3".repeat(64) }
  }), "utf8");

  const common = [
    "-NoLogo", "-NoProfile", "-NonInteractive",
    "-File", uninstallerFile,
    "-ManagedRoot", managedRoot,
    "-SkipSystemChanges"
  ];
  const environment = { ...process.env, HP_UNINSTALL_RECORD: recordFile };
  await execFileAsync("powershell.exe", common, { env: environment, windowsHide: true });
  await execFileAsync("powershell.exe", [...common, "-PurgeManagedData"], { env: environment, windowsHide: true });

  assert.deepEqual(JSON.parse(await fs.readFile(recordFile, "utf8")), [[
    "--manifest", manifestFile, "--sha256", "3".repeat(64)
  ]]);
  await assert.rejects(fs.access(managedRoot), /ENOENT/);
});

test("uninstaller preserves managed recovery data when client restoration fails", async (t) => {
  const uninstallerFile = path.join(root, "uninstall-hermesproof.ps1");
  const managedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hermesproof-uninstall-fail-closed-"));
  t.after(() => fs.rm(managedRoot, { recursive: true, force: true }));
  const sha = "e".repeat(40);
  const scriptsDir = path.join(managedRoot, "releases", sha, "scripts");
  const stateDir = path.join(managedRoot, "state");
  const manifestFile = path.join(managedRoot, "backups", "clients", "original", "manifest.json");
  await fs.mkdir(scriptsDir, { recursive: true });
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(
    path.join(scriptsDir, "restore-client-snapshot.mjs"),
    'process.stderr.write("simulated client drift\\n"); process.exitCode=1;\n',
    "utf8"
  );
  await fs.writeFile(path.join(stateDir, "active-release.json"), JSON.stringify({
    currentSha: sha,
    clientSnapshot: { manifestFile, manifestSha256: "4".repeat(64) }
  }), "utf8");
  await fs.writeFile(path.join(stateDir, "install.json"), JSON.stringify({
    clientSnapshot: { manifestFile, manifestSha256: "4".repeat(64) }
  }), "utf8");

  await assert.rejects(
    execFileAsync("powershell.exe", [
      "-NoLogo", "-NoProfile", "-NonInteractive",
      "-File", uninstallerFile,
      "-ManagedRoot", managedRoot,
      "-SkipSystemChanges",
      "-PurgeManagedData"
    ], { windowsHide: true }),
    /managed recovery data was preserved/i
  );
  assert.equal(await fs.stat(managedRoot).then((stat) => stat.isDirectory()), true);
  assert.equal(await fs.stat(path.join(stateDir, "install.json")).then((stat) => stat.isFile()), true);
});
