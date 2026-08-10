import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const helper = path.join(root, "extensions", "integrations", "codecks-credential-helper.mjs");
const temporary = mkdtempSync(path.join(os.tmpdir(), "pi-onepassword-codecks-helper-"));
const tracePath = path.join(temporary, "trace.json");
const fakeSource = path.join(temporary, "fake-op.mjs");
// Node treats its first argument as a script path. This transient file lets its
// absolute executable act as a no-shell fake `op run` executable on Windows.
const runner = path.join(root, "run");
const serviceToken = "inert-" + "service-account-token";

writeFileSync(fakeSource, `#!/usr/bin/env node
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const launch = process.argv.slice(2);
const [command, ...rest] = launch[0] === "run" ? launch : ["run", ...launch];
const invocation = [command, ...rest];
const noMasking = rest[0] === "--no-masking";
const [delimiter, child, ...args] = noMasking ? rest.slice(1) : rest;
const serviceAccount = "inert-" + "service-account-token";
if (command !== "run" || delimiter !== "--" || !child || !args.includes("--input-type=module") || !args.includes("--eval") || process.env.OP_SERVICE_ACCOUNT_TOKEN !== serviceAccount) process.exit(64);
if (process.env.TEST_TRACE_FILE) writeFileSync(process.env.TEST_TRACE_FILE, JSON.stringify({ invocation, child, args, names: Object.keys(process.env).sort() }));
const mode = process.env.TEST_MODE;
if (mode === "malformed") { process.stdout.write("not-json"); process.exit(0); }
if (mode === "extra") { process.stdout.write('{"version":1,"credential":"inert-codecks-credential-value"}x'); process.exit(0); }
if (mode === "oversized") { process.stdout.write("x".repeat(9000)); process.exit(0); }
if (mode === "stderr") { process.stderr.write("inert-vendor-diagnostic"); process.exit(0); }
if (mode === "nonzero") process.exit(9);
if (mode === "hang") await new Promise(() => {});
const env = { ...process.env, PI_ONEPASSWORD_CODECKS_CREDENTIAL: "inert-codecks-credential-value" };
delete env.OP_SERVICE_ACCOUNT_TOKEN;
const spawned = spawn(child, args, { env, stdio: ["ignore", "pipe", "pipe"] });
const stdout = [];
spawned.stdout.on("data", (chunk) => stdout.push(chunk));
spawned.stderr.pipe(process.stderr);
spawned.once("error", () => process.exit(65));
spawned.once("close", (code) => {
  const output = Buffer.concat(stdout).toString("utf8");
  // Match 1Password's default stdout masking: only this exact private-protocol
  // opt-out may preserve the resolved value for the trusted adapter parent.
  process.stdout.write(noMasking ? output : output.replaceAll("inert-codecks-credential-value", "[REDACTED]"));
  process.exit(code ?? 65);
});
`);
writeFileSync(runner, readFileSync(fakeSource));
chmodSync(runner, 0o755);

function invoke(request: unknown, overrides: NodeJS.ProcessEnv = {}, timeoutMs = 1_500, cancelAfterMs?: number): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const environment: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      PI_ONEPASSWORD_OP_EXECUTABLE: process.execPath,
      PI_ONEPASSWORD_CODECKS_REFERENCE: '"op://Fake Vault/codecks/token"',
      OP_SERVICE_ACCOUNT_TOKEN: serviceToken,
      TEST_TRACE_FILE: tracePath,
      CODECKS_TOKEN: "inert-ambient-codecks-token",
      codecks_profile_WORK_api_token: "inert-profile-codecks-token",
      CODECKS_CREDENTIAL_PROVIDER: "external-helper",
      CODECKS_CREDENTIAL_HELPER_MODULE: "/untrusted/helper.mjs",
      CODECKS_PROFILE: "WORK",
      OP_CONNECT_TOKEN: "inert-connect-token",
      op_session_work: "inert-session-token",
      OP_SERVICE_ACCOUNT_TOKEN_OLD: "inert-old-service-token",
      PI_ONEPASSWORD_TEST_SENTINEL: "must-not-reach-child",
      NODE_OPTIONS: "--no-warnings",
      NODE_PATH: "/untrusted/node-path",
      ...overrides,
    };
    const child = spawn(process.execPath, [helper], { env: environment, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (value) => { stdout += value; });
    child.stderr.on("data", (value) => { stderr += value; });
    child.stdin.end(JSON.stringify(request));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    const cancellation = cancelAfterMs === undefined ? undefined : setTimeout(() => child.kill("SIGTERM"), cancelAfterMs);
    child.once("close", (status) => { clearTimeout(timer); clearTimeout(cancellation); resolve({ status, stdout, stderr }); });
  });
}

function invokeWithoutNoMasking(): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [runner, "run", "--", process.execPath, "--input-type=module", "--eval", "process.stdout.write(JSON.stringify({version:1,credential:process.env.PI_ONEPASSWORD_CODECKS_CREDENTIAL}))"], {
      env: { ...process.env, OP_SERVICE_ACCOUNT_TOKEN: serviceToken, PI_ONEPASSWORD_CODECKS_CREDENTIAL: "inert-codecks-credential-value" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (value) => { stdout += value; });
    child.stderr.on("data", (value) => { stderr += value; });
    child.once("close", (status) => resolve({ status, stdout, stderr }));
  });
}

function invokeWithOpenStdin(input: string, signalAfterMs?: number): Promise<{ status: number | null; stdout: string; stderr: string; elapsedMs: number; forced: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [helper], {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        PI_ONEPASSWORD_OP_EXECUTABLE: process.execPath,
        PI_ONEPASSWORD_CODECKS_REFERENCE: '"op://Fake Vault/codecks/token"',
        OP_SERVICE_ACCOUNT_TOKEN: serviceToken,
        TEST_TRACE_FILE: tracePath,
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const started = Date.now();
    let stdout = "";
    let stderr = "";
    let forced = false;
    child.stdout.on("data", (value) => { stdout += value; });
    child.stderr.on("data", (value) => { stderr += value; });
    // The writer intentionally never ends stdin. The helper must destroy it
    // itself on every abort path rather than waiting for this parent.
    child.stdin.on("error", () => {});
    child.stdin.write(input);
    const signal = signalAfterMs === undefined ? undefined : setTimeout(() => child.kill("SIGTERM"), signalAfterMs);
    const watchdog = setTimeout(() => { forced = true; child.kill("SIGKILL"); }, 1_500);
    child.once("close", (status) => {
      clearTimeout(signal);
      clearTimeout(watchdog);
      resolve({ status, stdout, stderr, elapsedMs: Date.now() - started, forced });
    });
  });
}

const request = { version: 1, service: "codecks", account: "example-account", profile: "work" };
try {
  const defaultMasked = await invokeWithoutNoMasking();
  assert.equal(defaultMasked.status, 0, "fake op must model successful default masking");
  assert.equal(defaultMasked.stderr, "", "fake op default masking must remain diagnostic-free");
  assert.equal(defaultMasked.stdout, '{"version":1,"credential":"[REDACTED]"}', "without --no-masking, the fake op must replace the inert resolved value in stdout");
  assert.notEqual(defaultMasked.stdout, '{"version":1,"credential":"inert-codecks-credential-value"}', "a real-token protocol expectation must fail under default masking");

  const success = await invoke(request);
  assert.equal(success.status, 0, "expected configured helper to succeed");
  assert.equal(success.stderr, "", "helper must not use stderr");
  assert.deepEqual(JSON.parse(success.stdout), { version: 1, credential: "inert-codecks-credential-value" });
  assert.equal(success.stdout, '{"version":1,"credential":"inert-codecks-credential-value"}', "expected exactly one protocol response");
  const trace = JSON.parse(readFileSync(tracePath, "utf8")) as { invocation: string[]; child: string; args: string[]; names: string[] };
  assert.deepEqual(trace.invocation.slice(0, 4), ["run", "--no-masking", "--", process.execPath], "op run must use the exact private-protocol invocation and fixed current Node child");
  assert.equal(trace.child, process.execPath, "op run must use the fixed current Node child");
  assert.deepEqual(trace.args.slice(0, 2), ["--input-type=module", "--eval"], "fixed child arguments must be canonical");
  assert.equal(trace.args.join("\n").includes("op://"), false, "reference must not be in child argv");
  for (const forbidden of ["CODECKS_TOKEN", "codecks_profile_WORK_api_token", "CODECKS_CREDENTIAL_PROVIDER", "CODECKS_CREDENTIAL_HELPER_MODULE", "CODECKS_PROFILE", "OP_CONNECT_TOKEN", "op_session_work", "OP_SERVICE_ACCOUNT_TOKEN_OLD", "PI_ONEPASSWORD_CODECKS_REFERENCE", "PI_ONEPASSWORD_TEST_SENTINEL", "NODE_OPTIONS", "NODE_PATH"]) assert.equal(trace.names.includes(forbidden), false, `expected ${forbidden} to be removed`);
  assert.equal(trace.names.includes("OP_SERVICE_ACCOUNT_TOKEN"), true, "op receives only the canonical service-account spelling");
  assert.equal(trace.names.includes("PI_ONEPASSWORD_CODECKS_CREDENTIAL"), true, "op receives the fixed reference binding");

  const quoted = await invoke({ version: 1, service: "codecks", account: "example-account" }, { PI_ONEPASSWORD_CODECKS_REFERENCE: "'op://Fake Vault/codecks/token'" });
  assert.equal(quoted.status, 0, "a matching outer straight quote pair must normalize");

  for (const [badRequest, env] of [
    [{ version: 2, service: "codecks", account: "example-account" }, {}],
    [{ version: 1, service: "other", account: "example-account" }, {}],
    [{ version: 1, service: "codecks", account: "" }, {}],
    [{ version: 1, service: "codecks", account: "example-account", ignored: true }, {}],
    [{ version: 1, service: "codecks", account: "a".repeat(9_000) }, {}],
    [request, { PI_ONEPASSWORD_OP_EXECUTABLE: "op" }],
    [request, { PI_ONEPASSWORD_CODECKS_REFERENCE: "not-a-reference" }],
    [request, { OP_SERVICE_ACCOUNT_TOKEN: "" }],
  ] as const) {
    const result = await invoke(badRequest, env);
    assert.notEqual(result.status, 0, "invalid request/configuration must fail closed");
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  }

  for (const mode of ["malformed", "extra", "oversized", "stderr", "nonzero"]) {
    const result = await invoke(request, { TEST_MODE: mode }, 12_000);
    assert.notEqual(result.status, 0, `${mode} must fail closed`);
    assert.equal(result.stdout, "", `${mode} must not return a credential`);
    assert.equal(result.stderr, "", `${mode} must not disclose child diagnostics`);
    assert.equal(result.stdout.includes("inert-codecks-credential-value"), false);
    assert.equal(result.stderr.includes("inert-vendor-diagnostic"), false);
  }
  const timedOut = await invoke(request, { TEST_MODE: "hang" }, 12_000);
  assert.notEqual(timedOut.status, 0, "a stalled manager must time out");
  assert.equal(timedOut.stdout, "");
  assert.equal(timedOut.stderr, "");
  const cancelled = await invoke(request, { TEST_MODE: "hang" }, 1_500, 25);
  assert.notEqual(cancelled.status, 0, "parent cancellation must fail closed");
  assert.equal(cancelled.stdout, "");
  assert.equal(cancelled.stderr, "");

  const openStdinSignal = await invokeWithOpenStdin(JSON.stringify(request), 25);
  assert.equal(openStdinSignal.forced, false, "SIGTERM with open stdin must settle before the watchdog");
  assert.notEqual(openStdinSignal.status, 0, "SIGTERM with open stdin must fail closed");
  assert.equal(openStdinSignal.stdout, "", "SIGTERM with open stdin must not produce a partial response");
  assert.equal(openStdinSignal.stderr, "", "SIGTERM with open stdin must remain silent");
  assert(openStdinSignal.elapsedMs < 1_000, "SIGTERM with open stdin must honor the bounded abort deadline");

  const openStdinOverflow = await invokeWithOpenStdin("x".repeat(8 * 1024 + 1));
  assert.equal(openStdinOverflow.forced, false, "oversized open stdin must settle before the watchdog");
  assert.notEqual(openStdinOverflow.status, 0, "oversized open stdin must fail closed");
  assert.equal(openStdinOverflow.stdout, "", "oversized open stdin must not produce a response");
  assert.equal(openStdinOverflow.stderr, "", "oversized open stdin must remain silent");
  assert(openStdinOverflow.elapsedMs < 1_000, "oversized open stdin must honor the bounded abort deadline");

  const unavailable = await invoke(request, { PI_ONEPASSWORD_OP_EXECUTABLE: path.join(temporary, "missing-op") });
  assert.notEqual(unavailable.status, 0, "spawn failure must fail closed");
  assert.equal(unavailable.stdout, "");
  assert.equal(unavailable.stderr, "");

  console.log("PASS: Codecks credential helper adapter validation succeeded");
} finally {
  rmSync(temporary, { recursive: true, force: true });
  unlinkSync(runner);
}
