import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
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
