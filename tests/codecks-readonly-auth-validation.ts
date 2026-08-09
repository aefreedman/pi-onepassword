import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type SpawnOptions } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import {
  runCodecksReadonlyAuthCheck,
  type CodecksReadonlyAuthResult,
  validateTrustedUserConfiguredCodecksClientExecutable,
} from "../extensions/shared/codecks-readonly-auth.ts";
import { validateSecretReference, validateTrustedExecutable } from "../extensions/shared/onepassword-trusted.ts";

const serviceAccountToken = "inert-service-account-token";
const resolvedToken = "inert-codecks-token-sentinel";
const referenceText = "op://Fake Automation/codecks/auth-token";
const fakeOp = fileURLToPath(new URL("./fixtures/fake-op-run.mjs", import.meta.url));
const fakeCodecksClient = fileURLToPath(new URL("./fixtures/fake-codecks-readonly-auth-client.mjs", import.meta.url));

function assertNoDisclosure(value: unknown, context: string): void {
  const rendered = JSON.stringify(value);
  for (const sensitive of [serviceAccountToken, resolvedToken, referenceText]) {
    assert.equal(rendered.includes(sensitive), false, `Expected ${context} not to disclose ${sensitive}.`);
  }
}

const tempDirectory = await mkdtemp(join(tmpdir(), "pi-onepassword-codecks-"));
try {
  for (const [exitCode, category, status] of [
    [0, "authenticated", "success"],
    [10, "authentication-rejected", "unauthorized"],
    [11, "malformed-response", "invalid-response"],
    [12, "response-too-large", "response-too-large"],
    [13, "invalid-configuration", "invalid-configuration"],
    [14, "unavailable", "unavailable"],
  ] as const) {
    const observed = await runCase(tempDirectory, exitCode);
    assert.equal(observed.result.category, category);
    assert.equal(observed.result.status, status);
    assert.equal(observed.result.operation, "codecks-readonly-auth");
    assert(observed.result.durationMs >= 0 && observed.result.durationMs <= 60_000, "Expected bounded non-secret timing.");
    assert.deepEqual(observed.opTrace.childArgs, [fakeCodecksClient], "Expected the trusted user-configured no-argument Codecks child.");
    assert.deepEqual(observed.clientTrace.argv, [], "Codecks contract must not accept model-selected arguments.");
    for (const forbidden of ["OP_SERVICE_ACCOUNT_TOKEN", "CODECKS_TOKEN", "CODECKS_API_TOKEN", "PI_CODECKS_READONLY_AUTH_TOKEN"]) {
      assert.equal(observed.clientTrace.environmentNames.includes(forbidden), forbidden === "PI_CODECKS_READONLY_AUTH_TOKEN", `Unexpected child environment ${forbidden}.`);
    }
    assert(observed.clientTrace.environmentNames.includes("PI_CODECKS_READONLY_AUTH_ACCOUNT"), "Expected trusted account metadata only in child environment.");
    assertNoDisclosure(observed, `exit ${exitCode} result or execution shape`);
  }

  const missingServiceAccount = await runCodecksReadonlyAuthCheck({
    trustedCodecksClientExecutable: validateTrustedUserConfiguredCodecksClientExecutable(fakeCodecksClient),
    account: "example-team",
    opExecutable: validateTrustedExecutable("/trusted/fake-op"),
    reference: validateSecretReference(referenceText),
    serviceAccountToken: undefined,
  });
  assert.equal(missingServiceAccount.category, "invalid-configuration", "Missing service-account configuration must not fall back.");
  assert.equal(missingServiceAccount.status, "invalid-configuration");
  assertNoDisclosure(missingServiceAccount, "missing service-account result");

  const invalidAccount = await runCodecksReadonlyAuthCheck({
    trustedCodecksClientExecutable: validateTrustedUserConfiguredCodecksClientExecutable(fakeCodecksClient),
    account: "https://elsewhere.invalid",
    opExecutable: validateTrustedExecutable("/trusted/fake-op"),
    reference: validateSecretReference(referenceText),
    serviceAccountToken,
  }, {
    spawnProcess: (_executable: string, args: readonly string[], options: SpawnOptions): ChildProcess =>
      spawn(process.execPath, [fakeOp, ...args.slice(2)], options),
  });
  assert.equal(invalidAccount.category, "invalid-configuration");
  assertNoDisclosure(invalidAccount, "invalid account result");

  console.log("PASS: Codecks readonly authentication orchestration validation succeeded");
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}

async function runCase(tempDirectory: string, exitCode: number): Promise<{
  result: CodecksReadonlyAuthResult;
  opTrace: Trace;
  clientTrace: ClientTrace;
}> {
  const opTraceFile = join(tempDirectory, `op-${exitCode}-${Math.random().toString(16).slice(2)}.json`);
  const clientTraceFile = join(tempDirectory, `client-${exitCode}-${Math.random().toString(16).slice(2)}.json`);
  let opArgs: readonly string[] = [];
  const result = await runCodecksReadonlyAuthCheck({
    trustedCodecksClientExecutable: validateTrustedUserConfiguredCodecksClientExecutable(fakeCodecksClient),
    account: "example-team",
    opExecutable: validateTrustedExecutable("/trusted/fake-op"),
    reference: validateSecretReference(referenceText),
    serviceAccountToken,
  }, {
    inheritedEnvironment: {
      PATH: process.env.PATH,
      CODECKS_TOKEN: "ambient-codecks-token",
      CODECKS_API_TOKEN: "ambient-codecks-api-token",
      CODECKS_PROFILE_TEST_TOKEN: "ambient-profile-token",
      PI_CODECKS_READONLY_AUTH_TOKEN: "ambient-contract-token",
      PI_CODECKS_READONLY_AUTH_ACCOUNT: "ambient-account",
      PI_ONEPASSWORD_TEST_TRACE_FILE: opTraceFile,
      PI_ONEPASSWORD_TEST_CODECKS_TRACE_FILE: clientTraceFile,
      PI_ONEPASSWORD_TEST_CODECKS_EXIT: String(exitCode),
    },
    spawnProcess: (_executable: string, args: readonly string[], options: SpawnOptions): ChildProcess => {
      opArgs = args;
      return spawn(process.execPath, [fakeOp, ...args.slice(2)], options);
    },
  });
  const opTrace = JSON.parse(await readFile(opTraceFile, "utf8")) as Trace;
  const clientTrace = JSON.parse(await readFile(clientTraceFile, "utf8")) as ClientTrace;
  assert.deepEqual(opArgs.slice(0, 2), ["run", "--"]);
  return { result, opTrace, clientTrace };
}

type Trace = Readonly<{ childExecutable: string; childArgs: readonly string[]; childEnvironmentNames: readonly string[] }>;
type ClientTrace = Readonly<{ argv: readonly string[]; environmentNames: readonly string[] }>;
