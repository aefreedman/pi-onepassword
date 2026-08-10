import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  OnePasswordOperationError,
  createFixedChildContract,
  createServiceAccountInvocationEnvironment,
  validateSecretReference,
  validateTrustedExecutable,
} from "../extensions/shared/onepassword-trusted.ts";
import * as bashGuardCore from "../extensions/shared/bash-op-guard-core.ts";
import * as environmentHelpers from "../extensions/shared/onepassword-env.ts";
import * as trusted from "../extensions/shared/onepassword-trusted.ts";

const referenceText = "op://Configured Vault/identity/token";
const serviceToken = "inert-service-account-token";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { pi?: Record<string, unknown> };
assert.deepEqual(packageJson.pi?.extensions, ["./extensions/bash-op-guard.ts"], "The only model-facing registration must be the Bash safety extension.");
assert.equal("skills" in (packageJson.pi ?? {}), false, "This package does not register a skill/model operation.");
assert.equal("prompts" in (packageJson.pi ?? {}), false, "This package does not register a prompt/model operation.");

assert.deepEqual(Object.keys(bashGuardCore).sort(), [
  "__bashOpGuardInternals",
  "commandMentionsBlockedOp",
  "commandRunsBlockedOp",
], "Bash guard core exports must remain the exact supported set.");
assert.deepEqual(Object.keys(environmentHelpers).sort(), [
  "isSecretOnePasswordEnvironmentVariable",
  "sanitizeOnePasswordEnvironment",
], "Environment helper exports must remain the exact supported set.");
assert.deepEqual(Object.keys(trusted).sort(), [
  "OnePasswordOperationError",
  "createFixedChildContract",
  "createServiceAccountInvocationEnvironment",
  "isConflictingOnePasswordCredentialEnvironmentName",
  "runBoundedOpRun",
  "validateSecretReference",
  "validateTrustedExecutable",
], "Trusted helper exports must remain the exact supported set.");
const reference = validateSecretReference(referenceText);
const child = createFixedChildContract({
  executable: validateTrustedExecutable("/trusted/fixed-readonly-child"),
  referenceEnvironmentName: "FIXED_OPERATION_TOKEN",
});
const environment = createServiceAccountInvocationEnvironment({ OP_CONNECT_TOKEN: "ambient-connect", OP_SESSION_WORK: "ambient-session" }, serviceToken, child.referenceEnvironmentName, reference);
assert.equal(environment.FIXED_OPERATION_TOKEN, referenceText, "Configured references remain identifiers at the trusted op boundary.");
assert.equal(environment.OP_SERVICE_ACCOUNT_TOKEN, serviceToken, "The trusted invocation explicitly selects its service account.");
assert.equal("OP_CONNECT_TOKEN" in environment, false, "Connect authentication must not survive service-account selection.");
assert.equal("OP_SESSION_WORK" in environment, false, "Session authentication must not survive service-account selection.");

assert.throws(
  () => createServiceAccountInvocationEnvironment({}, undefined, child.referenceEnvironmentName, reference),
  (error: unknown) => error instanceof OnePasswordOperationError && error.code === "service-account-required",
  "Missing service-account configuration must fail closed rather than falling back to ambient identity.",
);
assert.throws(
  () => createFixedChildContract({ executable: validateTrustedExecutable("/trusted/fixed-readonly-child"), args: [referenceText], referenceEnvironmentName: "TOKEN" }),
  (error: unknown) => error instanceof OnePasswordOperationError && error.code === "invalid-configuration",
  "The operation contract must reject a reference in child arguments.",
);

console.log("PASS: supported surface validation succeeded (code/tool contracts; no provider-backed agent operation is registered).");
