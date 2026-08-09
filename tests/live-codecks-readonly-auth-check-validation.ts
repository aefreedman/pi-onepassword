import assert from "node:assert/strict";
import { spawnSync, type ChildProcess, type SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  launchLiveCodecksReadonlyAuthCheck,
  type LiveCodecksReadonlyAuthOutput,
} from "../scripts/live-codecks-readonly-auth-check.ts";
import type { CodecksReadonlyAuthCheck, CodecksReadonlyAuthResult } from "../extensions/shared/codecks-readonly-auth.ts";

const token = "live-token-SENTINEL-must-not-disclose";
const reference = "op://Automation Vault/live-auth/token";
const account = "account-sentinel";
const opExecutable = "/path-SENTINEL/to/op";
const clientPath = resolve(fileURLToPath(new URL("..", import.meta.url)), "..", "pi-codecks", "src", "integrations", "codecks-readonly-auth-client.mjs");
const sentinels = [token, reference, account, opExecutable, clientPath];
const initialEnvironment = { ...process.env };

const npmCli = process.env.npm_execpath;
assert(npmCli, "Expected npm to provide its CLI entry point for the spawned command.");
// Invoke npm's CLI entry point directly for Windows-safe execution of this exact command.
const npmArguments = ["run", "--silent", "live:codecks-readonly-auth"];
const cli = spawnSync(process.execPath, [npmCli, ...npmArguments], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  env: {
    ...initialEnvironment,
    PI_ONEPASSWORD_CODECKS_ACCOUNT: "account-sentinel!",
  },
  encoding: "utf8",
  windowsHide: true,
});
assert.equal(cli.error, undefined, "Expected npm to spawn successfully.");
assert.equal(cli.status, 1, "Expected the silent npm launcher to exit 1 for invalid configuration.");
assert.equal(cli.stderr, "", "Expected no diagnostic output from the silent npm launcher.");
const cliOutput = JSON.parse(cli.stdout) as LiveCodecksReadonlyAuthOutput;
assert.equal(cliOutput.category, "invalid-configuration");
assertPublicOutput(cliOutput, cli.stdout, "silent npm invalid configuration");
assert.equal(cli.stdout, `${JSON.stringify(cliOutput)}\n`, "Expected exactly one launcher JSON line from silent npm.");

let observedCheck: CodecksReadonlyAuthCheck | undefined;
const success = await run({
  runCheck: async (check) => {
    observedCheck = check;
    return result("authenticated", "success");
  },
});
assert.equal(success.exitCode, 0, "Expected authenticated validation to exit successfully.");
assert.equal(success.output.category, "authenticated");
assert.equal(success.output.status, "success");
assert.equal(observedCheck?.opExecutable, opExecutable, "Expected only the configured absolute op executable.");
assert.equal(observedCheck?.account, account, "Expected configured account wiring.");
assert.equal(observedCheck?.reference, reference, "Expected configured reference wiring.");
assert.equal(observedCheck?.serviceAccountToken, token, "Expected inherited service account token wiring.");
assert.equal(observedCheck?.trustedCodecksClientExecutable, clientPath, "Expected the fixed sibling Codecks client path.");
assertPublicOutput(success.output, success.line, "successful wiring");

for (const copiedReference of [`"${reference}"`, `'${reference}'`]) {
  let normalizedReference: string | undefined;
  const quoted = await run({
    environment: { ...environment(), PI_ONEPASSWORD_CODECKS_REFERENCE: copiedReference },
    runCheck: async (check) => {
      normalizedReference = check.reference;
      return result("authenticated", "success");
    },
  });
  assert.equal(quoted.exitCode, 0, "Expected a copied reference with matching outer quotes to be accepted.");
  assert.equal(normalizedReference, reference, "Expected one matching outer quote pair to be removed.");
  assertPublicOutput(quoted.output, quoted.line, "quoted copied reference");
}

let invocation: { executable: string; args: readonly string[]; options: SpawnOptions } | undefined;
const fakeChild = createExitZeroChild();
const defaultHelper = await run({
  // Deliberately omit runCheck: this exercises runCodecksReadonlyAuthCheck.
  spawnProcess: (executable, args, options) => {
    invocation = { executable, args, options };
    queueMicrotask(() => fakeChild.emit("close", 0));
    return fakeChild;
  },
});
assert.equal(defaultHelper.exitCode, 0, "Expected the real helper's benign fake child result to succeed.");
assert.equal(defaultHelper.output.category, "authenticated");
assert.equal(invocation?.executable, opExecutable, "Expected only the configured op executable to be spawned.");
assert.deepEqual(
  invocation?.args,
  ["run", "--", process.execPath, clientPath],
  "Expected the fixed real-helper invocation shape.",
);
for (const sensitive of [token, reference, account, opExecutable]) {
  assert.equal(JSON.stringify(invocation?.args).includes(sensitive), false, `Expected argv not to disclose ${sensitive}.`);
}
assert.equal(invocation?.options.env?.OP_SERVICE_ACCOUNT_TOKEN, token, "Expected the service account token only in the helper environment.");
assert.equal(invocation?.options.env?.PI_CODECKS_READONLY_AUTH_TOKEN, reference, "Expected the reference only in the fixed child environment.");
assert.equal(invocation?.options.env?.PI_CODECKS_READONLY_AUTH_ACCOUNT, account, "Expected the account only in the fixed child environment.");
assertPublicOutput(defaultHelper.output, defaultHelper.line, "real helper no-network regression");

const rejected = await run({ runCheck: async () => result("authentication-rejected", "unauthorized") });
assert.equal(rejected.exitCode, 1, "Expected rejected authentication to be non-success.");
assert.equal(rejected.output.category, "authentication-rejected");
assert.equal(rejected.output.status, "unauthorized");
assertPublicOutput(rejected.output, rejected.line, "authentication rejection");

for (const invalidEnvironment of [
  { ...environment(), ["PI_ONEPASSWORD_OP_EXECUTABLE"]: undefined },
  { ...environment(), ["PI_ONEPASSWORD_OP_EXECUTABLE"]: "op" },
  { ...environment(), ["PI_ONEPASSWORD_CODECKS_ACCOUNT"]: "account-sentinel!" },
  { ...environment(), ["PI_ONEPASSWORD_CODECKS_REFERENCE"]: "reference-SENTINEL-not-valid" },
  { ...environment(), ["PI_ONEPASSWORD_CODECKS_REFERENCE"]: `"${reference}'` },
  { ...environment(), OP_SERVICE_ACCOUNT_TOKEN: "   " },
]) {
  const invalid = await run({ environment: invalidEnvironment, runCheck: async () => { throw new Error("must not run"); } });
  assert.equal(invalid.exitCode, 1, "Expected invalid configuration to be non-success.");
  assert.equal(invalid.output.category, "invalid-configuration");
  assert.equal(invalid.output.status, "invalid-configuration");
  assertPublicOutput(invalid.output, invalid.line, "invalid configuration");
}

const failed = await run({ runCheck: async () => { throw new Error(`failure ${token} ${reference} ${account} ${opExecutable}`); } });
assert.equal(failed.exitCode, 1);
assert.equal(failed.output.category, "unavailable");
assertPublicOutput(failed.output, failed.line, "redacted operational failure");

console.log("PASS: live Codecks readonly authentication launcher validation succeeded");

function environment(): NodeJS.ProcessEnv {
  return {
    PI_ONEPASSWORD_OP_EXECUTABLE: opExecutable,
    PI_ONEPASSWORD_CODECKS_ACCOUNT: account,
    PI_ONEPASSWORD_CODECKS_REFERENCE: reference,
    OP_SERVICE_ACCOUNT_TOKEN: token,
  };
}

async function run(overrides: Parameters<typeof launchLiveCodecksReadonlyAuthCheck>[0]): Promise<{
  output: LiveCodecksReadonlyAuthOutput;
  exitCode: 0 | 1;
  line: string;
}> {
  let line = "";
  const launched = await launchLiveCodecksReadonlyAuthCheck({
    environment: environment(),
    ...overrides,
    write: (value) => { line += value; },
  });
  return { ...launched, line };
}

function result(
  category: CodecksReadonlyAuthResult["category"],
  status: CodecksReadonlyAuthResult["status"],
): CodecksReadonlyAuthResult {
  return { operation: "codecks-readonly-auth", category, status, durationMs: 1 };
}

function createExitZeroChild(): ChildProcess & EventEmitter {
  const child = new EventEmitter() as ChildProcess & EventEmitter;
  Object.assign(child, {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: () => true,
  });
  return child;
}

function assertPublicOutput(output: LiveCodecksReadonlyAuthOutput, line: string, context: string): void {
  assert.deepEqual(Object.keys(output).sort(), ["category", "durationMs", "operation", "status"], `Expected exact output schema for ${context}.`);
  assert.equal(output.operation, "codecks-readonly-auth");
  assert(Number.isInteger(output.durationMs) && output.durationMs >= 0 && output.durationMs <= 60_000, `Expected bounded duration for ${context}.`);
  assert.equal(line, `${JSON.stringify(output)}\n`, `Expected exactly one JSON object for ${context}.`);
  for (const sentinel of sentinels) assert.equal(line.includes(sentinel), false, `Expected ${context} not to disclose ${sentinel}.`);
}
