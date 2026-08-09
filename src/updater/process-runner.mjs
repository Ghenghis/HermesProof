import { spawn } from "node:child_process";

const BASE_ENVIRONMENT = [
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "TEMP",
  "TMP",
  "HOME",
  "USERPROFILE",
  "LOCALAPPDATA",
  "APPDATA"
];

function redacted(value, secrets) {
  let output = String(value ?? "");
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length > 0) output = output.split(secret).join("[REDACTED]");
  }
  return output;
}

function childEnvironment(environment, allowlist) {
  const output = {};
  for (const key of BASE_ENVIRONMENT) {
    if (typeof process.env[key] === "string") output[key] = process.env[key];
  }
  for (const key of allowlist) {
    if (typeof environment[key] === "string") output[key] = environment[key];
  }
  return output;
}

export async function runProcess({
  command,
  args = [],
  cwd,
  environment = {},
  environmentAllowlist = [],
  timeoutMs = 120_000,
  maxOutputBytes = 2 * 1024 * 1024,
  redact = [],
  stdin
} = {}) {
  if (typeof command !== "string" || command.length === 0) throw new Error("process command is required");
  if (!Array.isArray(args) || args.some((item) => typeof item !== "string")) throw new Error("process arguments must be strings");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error("process timeout is invalid");
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1) throw new Error("process output limit is invalid");

  return await new Promise((resolve, reject) => {
    let settled = false;
    let bytes = 0;
    const stdout = [];
    const stderr = [];
    const child = spawn(command, args, {
      cwd,
      env: childEnvironment(environment, environmentAllowlist),
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });

    const finishError = (message, details = {}) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      const error = new Error(redacted(message, redact));
      Object.assign(error, details);
      reject(error);
    };

    const accept = (target) => (chunk) => {
      const buffer = Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > maxOutputBytes) {
        finishError("process output limit exceeded");
        return;
      }
      target.push(buffer);
    };

    child.stdout.on("data", accept(stdout));
    child.stderr.on("data", accept(stderr));
    child.on("error", (error) => finishError("process failed to start: " + error.message, { cause: error }));
    child.on("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const result = {
        exitCode,
        signal,
        stdout: redacted(Buffer.concat(stdout).toString("utf8"), redact),
        stderr: redacted(Buffer.concat(stderr).toString("utf8"), redact)
      };
      if (exitCode !== 0) {
        const error = new Error(
          "process exited with code " + exitCode + (result.stderr ? ": " + result.stderr.trim() : "")
        );
        Object.assign(error, result);
        reject(error);
        return;
      }
      resolve(result);
    });

    const timer = setTimeout(() => {
      finishError("process timed out after " + timeoutMs + "ms", { timedOut: true });
    }, timeoutMs);
    timer.unref?.();

    if (stdin !== undefined) child.stdin.end(stdin);
    else child.stdin.end();
  });
}

export { BASE_ENVIRONMENT as PROCESS_BASE_ENVIRONMENT };
