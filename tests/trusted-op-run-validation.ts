import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import {
  OnePasswordOperationError,
  createFixedChildContract,
  createServiceAccountInvocationEnvironment,
  runBoundedOpRun,
  validateSecretReference,
  validateTrustedExecutable,
} from "../extensions/shared/onepassword-trusted.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const expectError = async (operation: () => Promise<unknown>, code: string, sensitive: string[]): Promise<void> => {
  try {
    await operation();
  } catch (error) {
    assert(error instanceof OnePasswordOperationError, "Expected a normalized 1Password error.");
    assert(error.code === code, `Expected ${code}, received ${error.code}.`);
    for (const value of sensitive) {
      assert(!error.message.includes(value), "Expected normalized error not to disclose sensitive input.");
    }
    return;
  }
  throw new Error("Expected operation to fail.");
};

type FakeChild = ChildProcess & {
  readonly stdout: EventEmitter;
  readonly stderr: EventEmitter;
  killed: boolean;
  killAttempts: number;
};

const createFakeChild = ({ closeOnKill = true, killSucceeds = true }: {
  closeOnKill?: boolean;
  killSucceeds?: boolean;
} = {}): FakeChild => {
  const child = new EventEmitter() as FakeChild;
  Object.assign(child, {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    killed: false,
    killAttempts: 0,
    kill: () => {
      child.killAttempts += 1;
      child.killed = true;
      if (closeOnKill) queueMicrotask(() => child.emit("close", null));
      return killSucceeds;
    },
  });
  return child;
};

const main = async (): Promise<void> => {
  const token = "inert-service-account-token";
  const referenceText = "op://Automation Vault/fake-api/token";
  const reference = validateSecretReference(referenceText);
  const opExecutable = validateTrustedExecutable("/trusted/bin/op");
  const fixedChild = createFixedChildContract({
    executable: validateTrustedExecutable("/trusted/bin/fixed-read-only-consumer"),
    args: ["--fixed-read-only-check"],
    referenceEnvironmentName: "FIXED_CONSUMER_TOKEN",
  });

  const environment = createServiceAccountInvocationEnvironment({
    PATH: "/normal/path",
    LOG_LEVEL: "info",
    OP_SERVICE_ACCOUNT_TOKEN_OLD: "old-service-token",
    Op_Connect_Host: "https://inert-connect.example",
    op_connect_token: "inert-connect-token",
    OP_SESSION_PERSONAL: "inert-session-token",
    fixed_consumer_token: "stale-reference-binding",
  }, token, fixedChild.referenceEnvironmentName, reference);
  assert(Object.getPrototypeOf(environment) === null, "Expected a null-prototype invocation environment.");
  assert(environment.PATH === "/normal/path" && environment.LOG_LEVEL === "info", "Expected ordinary environment to remain.");
  assert(environment.OP_SERVICE_ACCOUNT_TOKEN === token, "Expected explicit service-account token.");
  assert(environment.FIXED_CONSUMER_TOKEN === referenceText, "Expected reference only in the fixed environment binding.");
  for (const name of ["OP_SERVICE_ACCOUNT_TOKEN_OLD", "Op_Connect_Host", "op_connect_token", "OP_SESSION_PERSONAL", "fixed_consumer_token"]) {
    assert(!(name in environment), `Expected conflicting ${name} to be stripped.`);
  }

  let invocation: { executable: string; args: readonly string[]; env: NodeJS.ProcessEnv; detached: boolean | undefined } | undefined;
  const successfulChild = createFakeChild();
  const resultPromise = runBoundedOpRun({
    opExecutable,
    child: fixedChild,
    reference,
    serviceAccountToken: token,
    inheritedEnvironment: { PATH: "/normal/path", OP_CONNECT_TOKEN: "old" },
    spawnProcess: (executable, args, options) => {
      invocation = { executable, args, env: options.env!, detached: options.detached };
      queueMicrotask(() => successfulChild.emit("close", 0));
      return successfulChild;
    },
  });
  const result = await resultPromise;
  assert(result.operation === "op-run" && result.exitCode === 0, "Expected a redacted public success result.");
  assert(invocation?.executable === opExecutable, "Expected configured absolute op executable.");
  assert(invocation?.detached === (process.platform !== "win32"), "Expected explicit platform process-tree configuration.");
  assert(JSON.stringify(invocation?.args) === JSON.stringify(["run", "--", fixedChild.executable, ...fixedChild.args]), "Expected bounded op run command.");
  assert(!JSON.stringify(invocation?.args).includes(token) && !JSON.stringify(invocation?.args).includes(referenceText), "Expected no credential or reference in argv.");
  assert(!JSON.stringify(result).includes(token) && !JSON.stringify(result).includes(referenceText), "Expected no sensitive public result content.");
  assert(successfulChild.killAttempts === 0, "Expected successful close not to request termination.");

  const failedChild = createFakeChild();
  await expectError(
    () => runBoundedOpRun({
      opExecutable, child: fixedChild, reference, serviceAccountToken: token,
      spawnProcess: () => {
        queueMicrotask(() => failedChild.emit("close", 1));
        return failedChild;
      },
    }),
    "failed",
    [token, referenceText],
  );
  assert(failedChild.killAttempts === 0, "Expected ordinary nonzero close not to request termination.");

  await expectError(
    () => runBoundedOpRun({
      opExecutable, child: fixedChild, reference, serviceAccountToken: undefined,
      spawnProcess: () => { throw new Error("must not spawn"); },
    }),
    "service-account-required",
    [token, referenceText],
  );

  const oversizedChild = createFakeChild({ closeOnKill: false });
  const outputLimitStarted = Date.now();
  await expectError(
    () => runBoundedOpRun({
      opExecutable, child: fixedChild, reference, serviceAccountToken: token,
      limits: { stdoutBytes: 4, stderrBytes: 4, outputBytes: 8, terminationGraceMs: 5 },
      spawnProcess: () => {
        queueMicrotask(() => oversizedChild.stdout.emit("data", "inert-resolved-secret-sentinel"));
        return oversizedChild;
      },
    }),
    "output-limit-exceeded",
    [token, referenceText, "inert-resolved-secret-sentinel"],
  );
  assert(oversizedChild.killed && oversizedChild.killAttempts === 1, "Expected oversized child output to request termination once.");
  assert(Date.now() - outputLimitStarted < 1_000, "Expected output-limit settlement without a close event.");

  const controller = new AbortController();
  const abortedChild = createFakeChild({ closeOnKill: false, killSucceeds: false });
  const abortStarted = Date.now();
  const aborted = runBoundedOpRun({
    opExecutable, child: fixedChild, reference, serviceAccountToken: token,
    limits: { terminationGraceMs: 5 }, signal: controller.signal, spawnProcess: () => abortedChild,
  });
  controller.abort();
  await expectError(() => aborted, "aborted", [token, referenceText]);
  assert(abortedChild.killed && abortedChild.killAttempts === 1, "Expected cancellation to handle a failed, non-closing kill.");
  assert(Date.now() - abortStarted < 1_000, "Expected abort settlement without a close event.");

  const timedOutChild = createFakeChild({ closeOnKill: false });
  const timeoutStarted = Date.now();
  await expectError(
    () => runBoundedOpRun({
      opExecutable, child: fixedChild, reference, serviceAccountToken: token,
      limits: { timeoutMs: 1, terminationGraceMs: 5 }, spawnProcess: () => timedOutChild,
    }),
    "timed-out",
    [token, referenceText],
  );
  assert(timedOutChild.killed && timedOutChild.killAttempts === 1, "Expected timeout to request termination once.");
  assert(Date.now() - timeoutStarted < 1_000, "Expected timeout settlement without a close event.");

  try {
    validateSecretReference("not-a-reference");
    throw new Error("Expected invalid reference to fail.");
  } catch (error) {
    assert(error instanceof OnePasswordOperationError && error.code === "invalid-configuration", "Expected secret-safe reference validation.");
    assert(!error.message.includes("not-a-reference"), "Expected validation not to echo the reference.");
  }
  try {
    createFixedChildContract({ executable: fixedChild.executable, args: [referenceText], referenceEnvironmentName: "TOKEN" });
    throw new Error("Expected reference-bearing argv to fail.");
  } catch (error) {
    assert(error instanceof OnePasswordOperationError && error.code === "invalid-configuration", "Expected fixed child argv validation.");
  }
  try {
    createFixedChildContract({ executable: fixedChild.executable, referenceEnvironmentName: "OP_SERVICE_ACCOUNT_TOKEN" });
    throw new Error("Expected credential environment override to fail.");
  } catch (error) {
    assert(error instanceof OnePasswordOperationError && error.code === "invalid-configuration", "Expected credential environment name validation.");
  }
  try {
    validateTrustedExecutable("op");
    throw new Error("Expected PATH executable to fail.");
  } catch (error) {
    assert(error instanceof OnePasswordOperationError && error.code === "invalid-configuration", "Expected absolute executable validation.");
  }

  console.log("PASS: trusted op run validation succeeded");
};

void main();
