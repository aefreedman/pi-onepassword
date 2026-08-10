import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function runNpm(args, options = {}) {
  const npmCli = process.env.npm_execpath;
  const command = npmCli ? process.execPath : (process.platform === "win32" ? "npm.cmd" : "npm");
  const commandArgs = npmCli ? [npmCli, ...args] : args;
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? packageRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
    // Node cannot directly spawn a .cmd shim; npm's own invocation provides
    // npm_execpath, but direct Node smoke commands do not.
    shell: process.platform === "win32" && !npmCli,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`npm ${args.join(" ")} failed with exit code ${result.status}${details ? `:\n${details}` : ""}`);
  }
  return result;
}

export function pack({ dryRun = false, destination } = {}) {
  const args = ["pack", "--json", "--ignore-scripts"];
  if (dryRun) args.push("--dry-run");
  if (destination) args.push("--pack-destination", destination);
  const payload = JSON.parse(runNpm(args).stdout);
  const result = Array.isArray(payload) ? payload[0] : payload;
  if (!result || !Array.isArray(result.files) || typeof result.filename !== "string") {
    throw new Error("npm pack returned an unexpected manifest shape");
  }
  return result;
}
