import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type SpawnOptions } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import {
  runFixedAuthenticatedReadCheck,
  type FixedAuthenticatedReadResult,
} from "./support/fixed-authenticated-read.ts";
import { validateSecretReference, validateTrustedExecutable } from "../extensions/shared/onepassword-trusted.ts";
import { sanitizeOnePasswordEnvironment } from "../extensions/shared/onepassword-env.ts";
import { startFakeAuthenticatedService, type FakeAuthenticatedServiceMode } from "./fixtures/fake-authenticated-service.ts";

const serviceAccountToken = "inert-service-account-token";
const resolvedToken = "inert-resolved-secret-sentinel";
const referenceText = "op://Fake Automation/fixed-auth/token";
const fakeOp = fileURLToPath(new URL("./fixtures/fake-op-run.mjs", import.meta.url));
const testClient = fileURLToPath(new URL("./fixtures/fixed-authenticated-read-client.mjs", import.meta.url));

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const main = async (): Promise<void> => {
  const tempDirectory = await mkdtemp(join(tmpdir(), "pi-onepassword-fake-"));
  try {
    const clientSource = await readFile(testClient, "utf8");
    assert(clientSource.includes("http://127.0.0.1:43123/v1/identity"), "Expected the repository-only test client to use its literal fixed identity destination.");
    assert(!clientSource.includes("PI_ONEPASSWORD_TEST_BASE_URL") && !clientSource.includes("setTimeout("), "Expected the repository-only test client to have no destination override or socket timeout.");

    const success = await runCase("success", tempDirectory);
    assert(success.result.category === "authenticated" && success.result.status === "success", "Expected a bounded authenticated result.");
    assert(success.service.requests.length === 1, "Expected exactly one fixed fake-service request.");
    assert(success.service.requests[0]?.method === "GET" && success.service.requests[0]?.url === "/v1/identity", "Expected only the fixed read-only endpoint.");
    assert(success.service.requests[0]?.authorization === `Bearer ${resolvedToken}`, "Expected internal fake-op token injection.");
    assertNoDisclosure(success.result, success.argv, success.trace, "success result or execution shape");
    assert(success.childTrace, "Expected the successful fake child to record its secret-free execution shape.");
    assert(!success.childTrace.childEnvironmentNames.includes("OP_SERVICE_ACCOUNT_TOKEN"), "Expected service-account token to stay out of the fixed child.");
    assert(!success.childTrace.childEnvironmentNames.includes("OP_CONNECT_TOKEN"), "Expected Connect token to stay out of the fixed child.");
    assert(!success.childTrace.childEnvironmentNames.includes("OP_SESSION_PERSONAL"), "Expected session token to stay out of the fixed child.");

    const rejected = await runCase("rejected", tempDirectory);
    assert(rejected.result.category === "authentication-rejected" && rejected.result.status === "unauthorized", "Expected redacted rejected-authentication category.");
    assertNoDisclosure(rejected.result, rejected.argv, rejected.trace, "rejected-authentication result or execution shape");

    const noServiceAccount = await runFixedAuthenticatedReadCheck({
      opExecutable: validateTrustedExecutable("/trusted/fake-op"),
      reference: validateSecretReference(referenceText),
      serviceAccountToken: undefined,
    });
    assert(noServiceAccount.category === "failed" && noServiceAccount.status === "unavailable", "Expected missing service-account authentication to fail without fallback.");
    assertNoDisclosure(noServiceAccount, [], { childExecutable: "", childArgs: [], childEnvironmentNames: [] }, "missing-authentication result");

    const overrideDestination = "http://127.0.0.1:1";
    const overrideIgnored = await runCase("success", tempDirectory, {
      inheritedEnvironment: { PI_ONEPASSWORD_TEST_BASE_URL: overrideDestination },
    });
    assert(overrideIgnored.result.category === "authenticated", "Expected an ambient destination override to be ignored.");
    assert(overrideIgnored.service.requests.length === 1, "Expected the literal fixed destination despite an ambient override.");
    assert(!overrideIgnored.argv.some((argument) => argument.includes(overrideDestination)), "Expected the ambient destination override to stay out of child arguments.");
    assertNoDisclosure(overrideIgnored.result, overrideIgnored.argv, overrideIgnored.trace, "ambient destination override result or execution shape");

    const malformed = await runCase("malformed", tempDirectory);
    assert(malformed.result.category === "malformed-response" && malformed.result.status === "invalid-response", "Expected malformed response category.");
    assertNoDisclosure(malformed.result, malformed.argv, malformed.trace, "malformed-response result or execution shape");

    const oversized = await runCase("oversized", tempDirectory);
    assert(oversized.result.category === "response-too-large" && oversized.result.status === "response-too-large", "Expected bounded oversized response category.");
    assertNoDisclosure(oversized.result, oversized.argv, oversized.trace, "oversized-response result or execution shape");

    const timedOut = await runCase("timeout", tempDirectory, { limits: { timeoutMs: 25, terminationGraceMs: 25 } });
    assert(timedOut.result.category === "timed-out" && timedOut.result.status === "unavailable", "Expected redacted timeout result.");
    assertNoDisclosure(timedOut.result, timedOut.argv, timedOut.trace, "timeout result or execution shape");

    const controller = new AbortController();
    const cancellation = runCase("timeout", tempDirectory, { signal: controller.signal, limits: { timeoutMs: 1_000, terminationGraceMs: 25 } });
    setTimeout(() => controller.abort(), 25);
    const cancelled = await cancellation;
    assert(cancelled.result.category === "cancelled" && cancelled.result.status === "unavailable", "Expected redacted cancellation result.");
    assertNoDisclosure(cancelled.result, cancelled.argv, cancelled.trace, "cancellation result or execution shape");

    const genericBashEnvironment = sanitizeOnePasswordEnvironment({
      PATH: "/inert/bin",
      OP_SERVICE_ACCOUNT_TOKEN: serviceAccountToken,
      op_connect_token: "inert-connect-token",
      Op_Session_Personal: "inert-session-token",
    });
    assert(JSON.stringify(genericBashEnvironment) === JSON.stringify({ PATH: "/inert/bin" }), "Expected generic Bash environment to omit all 1Password credentials.");


    console.log("PASS: fixed authenticated read validation succeeded");
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
};

async function runCase(
  mode: FakeAuthenticatedServiceMode,
  tempDirectory: string,
  options: {
    signal?: AbortSignal;
    limits?: { timeoutMs?: number; terminationGraceMs?: number };
    inheritedEnvironment?: NodeJS.ProcessEnv;
  } = {},
): Promise<{
  result: FixedAuthenticatedReadResult;
  service: Awaited<ReturnType<typeof startFakeAuthenticatedService>>;
  argv: readonly string[];
  trace: Trace;
  childTrace?: Trace;
}> {
  const service = await startFakeAuthenticatedService(mode);
  const traceFile = join(tempDirectory, `${mode}-${Math.random().toString(16).slice(2)}.json`);
  let argv: readonly string[] = [];
  let trace: Trace = { childExecutable: "", childArgs: [], childEnvironmentNames: [] };
  try {
    const result = await runFixedAuthenticatedReadCheck({
      opExecutable: validateTrustedExecutable("/trusted/fake-op"),
      reference: validateSecretReference(referenceText),
      serviceAccountToken,
    }, {
      ...options,
      inheritedEnvironment: {
        PATH: process.env.PATH,
        OP_CONNECT_TOKEN: "inert-connect-token",
        OP_SESSION_PERSONAL: "inert-session-token",
        PI_ONEPASSWORD_TEST_TRACE_FILE: traceFile,
        ...options.inheritedEnvironment,
      },
      spawnProcess: (_executable: string, args: readonly string[], spawnOptions: SpawnOptions): ChildProcess => {
        argv = [...args];
        // Capture the non-secret command shape synchronously: timeout and
        // cancellation can stop the fake before it writes its optional trace.
        trace = {
          childExecutable: String(args[2] ?? ""),
          childArgs: args.slice(3),
          childEnvironmentNames: Object.keys(spawnOptions.env ?? {}).sort(),
        };
        // The injected fake observes the exact Phase 2 environment while the
        // production helper retains ownership of the real op command shape.
        return spawn(process.execPath, [fakeOp, ...args.slice(2)], spawnOptions);
      },
    });
    const childTrace = await readFile(traceFile, "utf8")
      .then((contents) => JSON.parse(contents) as Trace)
      .catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      });
    return { result, service, argv, trace, childTrace };
  } finally {
    await service.close();
  }
}

type Trace = Readonly<{ childExecutable: string; childArgs: readonly string[]; childEnvironmentNames: readonly string[] }>;

function assertNoDisclosure(result: FixedAuthenticatedReadResult, argv: readonly string[], trace: Trace, context: string): void {
  const rendered = JSON.stringify({ result, argv, trace });
  for (const sensitive of [serviceAccountToken, resolvedToken, referenceText]) {
    assert(!rendered.includes(sensitive), `Expected ${context} not to disclose ${sensitive}.`);
  }
  assert(result.durationMs >= 0 && result.durationMs <= 60_000, "Expected bounded non-secret timing.");
}

void main();
