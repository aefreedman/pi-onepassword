import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { packageRoot, pack, runNpm } from "./package-archive.mjs";

const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pi-onepassword-pack-smoke-"));
const archiveDir = path.join(tempRoot, "archive");
const consumerDir = path.join(tempRoot, "consumer");
try {
  mkdirSync(archiveDir, { recursive: true });
  mkdirSync(consumerDir, { recursive: true });
  writeFileSync(path.join(consumerDir, "package.json"), `${JSON.stringify({ name: "pi-onepassword-neutral-smoke", private: true, version: "0.0.0" }, null, 2)}\n`);
  const packed = pack({ destination: archiveDir });
  const archivePath = path.join(archiveDir, packed.filename);
  assert.ok(existsSync(archivePath), "expected npm pack to create a tarball");

  const cleanEnv = { ...process.env, npm_config_offline: "true" };
  for (const name of Object.keys(cleanEnv)) if (/^(?:OP_|PI_ONEPASSWORD_|CODECKS_)/i.test(name)) delete cleanEnv[name];
  runNpm(["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock", "@earendil-works/pi-coding-agent@0.84.1", archivePath], { cwd: consumerDir, env: cleanEnv });

  const installedRoot = path.join(consumerDir, "node_modules", "@aefree", "pi-onepassword");
  const packageJson = JSON.parse(await import("node:fs/promises").then(({ readFile }) => readFile(path.join(installedRoot, "package.json"), "utf8")));
  assert.equal(packageJson.name, "@aefree/pi-onepassword");
  assert.deepEqual(packageJson.pi?.extensions, ["./extensions/bash-op-guard.ts"]);
  for (const relativePath of [
    "extensions/bash-op-guard.ts",
    "extensions/integrations/codecks-credential-helper.mjs",
    "extensions/shared/onepassword-trusted.ts",
    "extensions/shared/onepassword-env.ts",
    "README.md",
    "CHANGELOG.md",
    "LICENSE",
  ]) assert.ok(existsSync(path.join(installedRoot, relativePath)), `expected installed package asset: ${relativePath}`);
  for (const excludedPath of ["tests", "scripts", ".github", "package-lock.json", "tsconfig.json"]) {
    assert.equal(existsSync(path.join(installedRoot, excludedPath)), false, `did not expect repository-only path: ${excludedPath}`);
  }

  const fakeOp = path.join(consumerDir, "fake-op.mjs");
  const child = path.join(consumerDir, "fixed-child.mjs");
  const fixture = path.join(consumerDir, "smoke.mjs");
  writeFileSync(fakeOp, `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
const [, , command, delimiter, child, ...args] = process.argv;
if (command !== "run" || delimiter !== "--" || !child) process.exit(64);
const env = { ...process.env, PI_PACKED_AUTH_TOKEN: "inert-packed-resolved-token" };
delete env.OP_SERVICE_ACCOUNT_TOKEN;
process.exit(spawnSync(child, args, { env, stdio: "ignore" }).status ?? 1);
`);
  writeFileSync(child, `#!/usr/bin/env node
if (process.env.PI_PACKED_AUTH_TOKEN !== "inert-packed-resolved-token") process.exit(1);
if (process.env.OP_SERVICE_ACCOUNT_TOKEN) process.exit(2);
process.exit(0);
`);
  writeFileSync(path.join(consumerDir, "run"), `
const { spawn } = require("node:child_process");
const [delimiter, child, ...args] = process.argv.slice(2);
const serviceAccount = "inert-packed-" + "service-account-token";
if (delimiter !== "--" || !child || process.env.OP_SERVICE_ACCOUNT_TOKEN !== serviceAccount) process.exit(64);
if (process.env.CODECKS_TOKEN || process.env.PI_ONEPASSWORD_CODECKS_REFERENCE) process.exit(65);
const env = { ...process.env, PI_ONEPASSWORD_CODECKS_CREDENTIAL: "inert-packed-codecks-credential" };
delete env.OP_SERVICE_ACCOUNT_TOKEN;
const launched = spawn(child, args, { env, stdio: ["ignore", "pipe", "pipe"] });
launched.stdout.pipe(process.stdout); launched.stderr.pipe(process.stderr);
launched.once("error", () => process.exit(66));
launched.once("close", (code) => process.exit(code ?? 66));
`);
  writeFileSync(fixture, `
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
const root = ${JSON.stringify(installedRoot)};
const trusted = await import(pathToFileURL(root + "/extensions/shared/onepassword-trusted.ts").href);
const env = await import(pathToFileURL(root + "/extensions/shared/onepassword-env.ts").href);
const bashCore = await import(pathToFileURL(root + "/extensions/shared/bash-op-guard-core.ts").href);
const helper = root + "/extensions/integrations/codecks-credential-helper.mjs";
const bashExtension = await import(pathToFileURL(root + "/extensions/bash-op-guard.ts").href);
const reference = trusted.validateSecretReference("op://Smoke Vault/identity/token");
const token = "inert-packed-service-account-token";
const child = trusted.createFixedChildContract({ executable: trusted.validateTrustedExecutable(process.execPath), args: [${JSON.stringify(child)}], referenceEnvironmentName: "PI_PACKED_AUTH_TOKEN" });
const result = await trusted.runBoundedOpRun({ opExecutable: trusted.validateTrustedExecutable(${JSON.stringify(fakeOp)}), child, reference, serviceAccountToken: token, inheritedEnvironment: { OP_CONNECT_TOKEN: "ambient", OP_SESSION_WORK: "ambient" }, spawnProcess: (_exe, args, options) => spawn(process.execPath, [${JSON.stringify(fakeOp)}, ...args], options) });
assert.deepEqual(result, { operation: "op-run", exitCode: 0 });
const helperResult = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [helper], { cwd: process.cwd(), env: { PATH: process.env.PATH, PI_ONEPASSWORD_OP_EXECUTABLE: process.execPath, PI_ONEPASSWORD_CODECKS_REFERENCE: '"op://Smoke Vault/codecks/token"', OP_SERVICE_ACCOUNT_TOKEN: token, CODECKS_TOKEN: "inert-ambient-codecks-token" }, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = ""; let stderr = "";
  child.stdout.on("data", (value) => { stdout += value; }); child.stderr.on("data", (value) => { stderr += value; });
  child.stdin.end(JSON.stringify({ version: 1, service: "codecks", account: "smoke-account" }));
  child.once("error", reject); child.once("close", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error("packed credential helper failed")));
});
assert.deepEqual(helperResult, { stdout: '{"version":1,"credential":"inert-packed-codecks-credential"}', stderr: "" });
assert.deepEqual(result, { operation: "op-run", exitCode: 0 });
assert.equal(JSON.stringify(result).includes(token), false);
assert.equal(JSON.stringify(result).includes(reference), false);
assert.deepEqual(env.sanitizeOnePasswordEnvironment({ PATH: "/safe", Op_Service_Account_Token: token, OP_SESSION_WORK: "ambient" }), { PATH: "/safe" });
await assert.rejects(() => trusted.runBoundedOpRun({ opExecutable: trusted.validateTrustedExecutable(${JSON.stringify(fakeOp)}), child, reference, serviceAccountToken: undefined }), (error) => error?.code === "service-account-required");
let registeredTool;
let toolCallHandler;
bashExtension.default({ registerTool: (tool) => { registeredTool = tool; }, on: (event, handler) => { if (event === "tool_call") toolCallHandler = handler; } });
assert.equal(registeredTool?.name, "bash");
assert.equal(typeof toolCallHandler, "function");
assert.equal(bashCore.commandRunsBlockedOp("op whoami"), true);
console.log("isolated packed trusted-helper, adapter, and extension smoke passed");
`);
  const tsxLoader = pathToFileURL(path.join(packageRoot, "node_modules", "tsx", "dist", "loader.mjs")).href;
  const result = spawnSync(process.execPath, ["--import", tsxLoader, fixture], { cwd: consumerDir, env: cleanEnv, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, `packed helper fixture failed:\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /isolated packed trusted-helper, adapter, and extension smoke passed/);
  console.log("Packed tarball smoke test passed in a credential-free neutral temporary project.");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
