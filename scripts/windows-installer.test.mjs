import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const windowsPowerShell = path.join(
  process.env.SystemRoot || "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe"
);

async function parsePowerShell(file) {
  const command = "$tokens=$null;$errors=$null;[System.Management.Automation.Language.Parser]::ParseFile($env:HP_PARSE_FILE,[ref]$tokens,[ref]$errors)|Out-Null;if($errors.Count){$errors|ForEach-Object{$_.Message};exit 1}";
  await execFileAsync(windowsPowerShell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], {
    env: { ...process.env, HP_PARSE_FILE: file },
    windowsHide: true
  });
}

test("Windows installer accepts the patch version declared by canonical release facts", {
  skip: process.platform !== "win32"
}, async (t) => {
  const canonicalFacts = JSON.parse(await fs.readFile(path.join(root, "config", "release-facts.json"), "utf8"));
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "hermesproof-installer-version-"));
  t.after(() => fs.rm(fixture, { recursive: true, force: true }));
  const workspace = path.join(fixture, "workspace");
  const managedRoot = path.join(fixture, "managed");
  const installerFile = path.join(fixture, "install-hermesproof.ps1");
  await fs.mkdir(workspace, { recursive: true });
  await fs.mkdir(path.join(fixture, "scripts"), { recursive: true });
  await fs.mkdir(path.join(fixture, "config"), { recursive: true });
  await fs.copyFile(path.join(root, "install-hermesproof.ps1"), installerFile);
  await fs.writeFile(path.join(fixture, "scripts", "windows-child-path.ps1"), "# version fixture\n", "utf8");
  await fs.writeFile(
    path.join(fixture, "config", "release-facts.json"),
    JSON.stringify({ version: canonicalFacts.version, releaseTag: canonicalFacts.releaseTag }) + "\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(fixture, "release-manifest.json"),
    JSON.stringify({
      schema: "hermesproof.windows-release.v1",
      version: canonicalFacts.version,
      sourceSha: "invalid-on-purpose",
      files: []
    }) + "\n",
    "utf8"
  );

  const installerArgs = [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    installerFile,
    "-Workspace",
    workspace,
    "-ManagedRoot",
    managedRoot,
    "-SkipUserPath"
  ];
  await assert.rejects(
    execFileAsync(windowsPowerShell, installerArgs, { windowsHide: true }),
    (error) => {
      const output = `${error.stdout || ""}\n${error.stderr || ""}`;
      assert.match(output, /Invalid source SHA/);
      assert.doesNotMatch(output, /Unexpected release version/);
      return true;
    }
  );

  await fs.writeFile(
    path.join(fixture, "config", "release-facts.json"),
    JSON.stringify({ version: "999.0.0", releaseTag: "v999.0.0" }) + "\n",
    "utf8"
  );
  await assert.rejects(
    execFileAsync(windowsPowerShell, installerArgs, { windowsHide: true }),
    /Release manifest version does not match canonical release facts/
  );

  await fs.writeFile(
    path.join(fixture, "config", "release-facts.json"),
    JSON.stringify({ version: "", releaseTag: "v" }) + "\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(fixture, "release-manifest.json"),
    JSON.stringify({
      schema: "hermesproof.windows-release.v1",
      version: "",
      sourceSha: "invalid-on-purpose",
      files: []
    }) + "\n",
    "utf8"
  );
  await assert.rejects(
    execFileAsync(windowsPowerShell, installerArgs, { windowsHide: true }),
    /Release version is missing or malformed/
  );
});

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

test("Windows child PATH stays below the cmd limit and preserves Node resolution", async () => {
  const helperFile = path.join(root, "scripts", "windows-child-path.ps1");
  const currentPath = process.env.Path || process.env.PATH || "";
  const syntheticSegments = Array.from(
    { length: 512 },
    (_, index) => `C:\\HermesProof\\OversizedPathFixture\\${index.toString().padStart(4, "0")}`
  );
  const oversizedPath = [currentPath, ...syntheticSegments].filter(Boolean).join(";");
  assert.ok(oversizedPath.length > 8_191, "fixture must exceed the cmd.exe PATH boundary");
  const command = [
    ". $env:HP_PATH_HELPER",
    "$safe = Get-HermesProofChildPath -PathValue $env:HP_OVERSIZED_PATH -Prepend @($env:HP_NODE_DIR, \"$env:SystemRoot\\System32\", \"$env:SystemRoot\")",
    "if ($safe.Length -gt 8000) { throw \"safe PATH remained too long: $($safe.Length)\" }",
    "$env:Path = $safe",
    "& $env:ComSpec /d /s /c '\"node --version\"'",
    "if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }",
    "Write-Output \"safe-length=$($safe.Length)\""
  ].join("; ");

  const { stdout } = await execFileAsync(windowsPowerShell, [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    command
  ], {
    env: {
      ...process.env,
      HP_NODE_DIR: path.dirname(process.execPath),
      HP_OVERSIZED_PATH: oversizedPath,
      HP_PATH_HELPER: helperFile
    },
    windowsHide: true
  });

  assert.match(stdout, /v\d+\.\d+\.\d+/u);
  assert.match(stdout, /safe-length=\d+/u);
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

  await execFileAsync(windowsPowerShell, [
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
  await execFileAsync(windowsPowerShell, common, { env: environment, windowsHide: true });
  await execFileAsync(windowsPowerShell, [...common, "-PurgeManagedData"], { env: environment, windowsHide: true });

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
    execFileAsync(windowsPowerShell, [
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
