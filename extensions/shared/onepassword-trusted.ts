import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { isAbsolute as isPosixAbsolute } from "node:path/posix";
import { isAbsolute as isWindowsAbsolute } from "node:path/win32";

const OP_REFERENCE_PREFIX = "op:" + "//";
const DEFAULT_LIMITS: BoundedExecutionLimits = {
  timeoutMs: 10_000,
  terminationGraceMs: 250,
  stdoutBytes: 64 * 1024,
  stderrBytes: 64 * 1024,
  outputBytes: 128 * 1024,
};

export type SecretReference = string & { readonly __secretReference: unique symbol };
export type TrustedExecutable = string & { readonly __trustedExecutable: unique symbol };

export type FixedChildContract = Readonly<{
  executable: TrustedExecutable;
  args: readonly string[];
  referenceEnvironmentName: string;
}>;

export type BoundedExecutionLimits = Readonly<{
  timeoutMs: number;
  /** Maximum time to await close/error after termination is requested. */
  terminationGraceMs: number;
  stdoutBytes: number;
  stderrBytes: number;
  outputBytes: number;
}>;

export type PublicOpRunResult = Readonly<{
  operation: "op-run";
  /** A fixed, allowlisted child outcome; never child output. */
  exitCode: number;
}>;

export type OnePasswordOperationErrorCode =
  | "invalid-configuration"
  | "service-account-required"
  | "aborted"
  | "timed-out"
  | "output-limit-exceeded"
  | "failed";

/** A deliberately non-secret error suitable for an integration's public result. */
export class OnePasswordOperationError extends Error {
  constructor(readonly code: OnePasswordOperationErrorCode) {
    super(`1Password operation ${code.replaceAll("-", " ")}.`);
    this.name = "OnePasswordOperationError";
  }
}

export type SpawnBoundedProcess = (
  executable: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export type RunBoundedOpRunInput = Readonly<{
  opExecutable: TrustedExecutable;
  child: FixedChildContract;
  reference: SecretReference;
  serviceAccountToken: string | undefined;
  inheritedEnvironment?: NodeJS.ProcessEnv;
  limits?: Partial<BoundedExecutionLimits>;
  signal?: AbortSignal;
  spawnProcess?: SpawnBoundedProcess;
  /** Fixed non-secret child outcomes an operation intentionally exposes. */
  acceptedExitCodes?: readonly number[];
}>;

/**
 * Validates an identifier for a 1Password value. This does not resolve it and
 * deliberately returns no diagnostic containing the supplied reference.
 */
export function validateSecretReference(value: string): SecretReference {
  const trimmed = value.trim();
  const path = trimmed.startsWith(OP_REFERENCE_PREFIX) ? trimmed.slice(OP_REFERENCE_PREFIX.length) : "";
  const segments = path.split("/");
  if (
    !path
    || segments.length < 3
    || segments.some((segment) => !segment.trim() || /[\u0000-\u001f\u007f]/.test(segment))
  ) {
    throw new OnePasswordOperationError("invalid-configuration");
  }
  return trimmed as SecretReference;
}

/** Trusted configuration must select an absolute executable, never PATH lookup. */
export function validateTrustedExecutable(value: string): TrustedExecutable {
  const trimmed = value.trim();
  if (!trimmed || !isPosixAbsolute(trimmed) && !isWindowsAbsolute(trimmed)) {
    throw new OnePasswordOperationError("invalid-configuration");
  }
  return trimmed as TrustedExecutable;
}

/**
 * Creates a fixed child contract. References are bound only through the named
 * environment variable, so neither a reference nor a token can appear in argv.
 */
export function createFixedChildContract(input: {
  executable: TrustedExecutable;
  args?: readonly string[];
  referenceEnvironmentName: string;
}): FixedChildContract {
  const executable = validateTrustedExecutable(input.executable);
  const args = [...(input.args ?? [])];
  if (
    !isReferenceEnvironmentName(input.referenceEnvironmentName)
    || isConflictingOnePasswordCredentialEnvironmentName(input.referenceEnvironmentName)
    || containsSecretReference(executable)
    || args.some((argument) => containsSecretReference(argument))
  ) {
    throw new OnePasswordOperationError("invalid-configuration");
  }
  return Object.freeze({
    executable,
    args: Object.freeze(args),
    referenceEnvironmentName: input.referenceEnvironmentName,
  });
}

/** Matches credential inputs which must not select an authentication mode. */
export function isConflictingOnePasswordCredentialEnvironmentName(name: string): boolean {
  return /^OP_SERVICE_ACCOUNT_TOKEN(?:_|$)/i.test(name)
    || /^OP_CONNECT(?:_|$)/i.test(name)
    || /^OP_SESSION(?:_|$)/i.test(name);
}

/**
 * Preserves ordinary process settings while explicitly selecting exactly one
 * service account. Matching is case-insensitive on every platform because
 * Windows environment names are case-insensitive.
 */
export function createServiceAccountInvocationEnvironment(
  inheritedEnvironment: NodeJS.ProcessEnv,
  serviceAccountToken: string | undefined,
  referenceEnvironmentName: string,
  reference: SecretReference,
): NodeJS.ProcessEnv {
  if (!serviceAccountToken?.trim()) {
    throw new OnePasswordOperationError("service-account-required");
  }
  if (
    !isReferenceEnvironmentName(referenceEnvironmentName)
    || isConflictingOnePasswordCredentialEnvironmentName(referenceEnvironmentName)
  ) {
    throw new OnePasswordOperationError("invalid-configuration");
  }
  const validatedReference = validateSecretReference(reference);

  // Avoid Object.prototype keys and model Windows' case-insensitive names on
  // every platform. The selected binding is the only spelling that survives.
  const environment = Object.create(null) as NodeJS.ProcessEnv;
  const referenceEnvironmentNameFolded = referenceEnvironmentName.toUpperCase();
  for (const [name, value] of Object.entries(inheritedEnvironment)) {
    if (
      value !== undefined
      && !isConflictingOnePasswordCredentialEnvironmentName(name)
      && name.toUpperCase() !== referenceEnvironmentNameFolded
    ) {
      environment[name] = value;
    }
  }
  environment.OP_SERVICE_ACCOUNT_TOKEN = serviceAccountToken;
  environment[referenceEnvironmentName] = validatedReference;
  return environment;
}

/**
 * Runs `op run -- <fixed trusted child>`. It captures no output for callers:
 * stream data is counted only to enforce limits, then discarded.
 */
export async function runBoundedOpRun(input: RunBoundedOpRunInput): Promise<PublicOpRunResult> {
  const limits = normalizeLimits(input.limits);
  const acceptedExitCodes = normalizeAcceptedExitCodes(input.acceptedExitCodes);
  const opExecutable = validateTrustedExecutable(input.opExecutable);
  const fixedChild = createFixedChildContract(input.child);
  const reference = validateSecretReference(input.reference);
  const args = ["run", "--", fixedChild.executable, ...fixedChild.args];
  if (args.some(containsSecretReference)) {
    throw new OnePasswordOperationError("invalid-configuration");
  }
  if (input.signal?.aborted) throw new OnePasswordOperationError("aborted");

  const environment = createServiceAccountInvocationEnvironment(
    input.inheritedEnvironment ?? process.env,
    input.serviceAccountToken,
    fixedChild.referenceEnvironmentName,
    reference,
  );
  if (args.some((argument) => argument.includes(environment.OP_SERVICE_ACCOUNT_TOKEN!))) {
    throw new OnePasswordOperationError("invalid-configuration");
  }
  const spawnProcess = input.spawnProcess ?? defaultSpawn;

  let child: ChildProcess;
  try {
    child = spawnProcess(opExecutable, args, {
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      // POSIX: isolate the command in a process group so a timeout can signal
      // its descendants too. Windows uses taskkill /t in requestTermination.
      detached: process.platform !== "win32",
      windowsHide: true,
    });
  } catch {
    throw new OnePasswordOperationError("failed");
  }

  return await awaitBoundedChild(child, limits, input.signal, acceptedExitCodes);
}

function defaultSpawn(executable: string, args: readonly string[], options: SpawnOptions): ChildProcess {
  return spawn(executable, args, options);
}

function normalizeAcceptedExitCodes(values: readonly number[] | undefined): readonly number[] {
  const codes = values === undefined ? [0] : [...new Set(values)];
  if (!codes.length || codes.length > 8 || codes.some((code) => !Number.isSafeInteger(code) || code < 0 || code > 255)) {
    throw new OnePasswordOperationError("invalid-configuration");
  }
  return Object.freeze(codes);
}

function normalizeLimits(overrides: Partial<BoundedExecutionLimits> | undefined): BoundedExecutionLimits {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 1024 * 1024) {
      throw new OnePasswordOperationError("invalid-configuration");
    }
  }
  return limits;
}

function awaitBoundedChild(
  child: ChildProcess,
  limits: BoundedExecutionLimits,
  signal: AbortSignal | undefined,
  acceptedExitCodes: readonly number[],
): Promise<PublicOpRunResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let failure: OnePasswordOperationErrorCode | undefined;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let outputBytes = 0;

    const finish = (error?: OnePasswordOperationError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(terminationDeadline);
      signal?.removeEventListener("abort", abort);
      releaseLocalHandles(child);
      if (error) reject(error);
      else resolve({ operation: "op-run", exitCode: 0 });
    };
    let terminationDeadline: ReturnType<typeof setTimeout> | undefined;
    const stop = (code: OnePasswordOperationErrorCode) => {
      if (failure) return;
      failure = code;
      requestTermination(child);
      // A malformed or already-detached child may never emit close/error. Do
      // not let cancellation, timeout, or output limits leave callers pending.
      terminationDeadline = setTimeout(
        () => finish(new OnePasswordOperationError(failure!)),
        limits.terminationGraceMs,
      );
    };
    const count = (stream: "stdout" | "stderr", value: unknown) => {
      const bytes = Buffer.isBuffer(value) ? value.length : Buffer.byteLength(String(value));
      outputBytes += bytes;
      if (stream === "stdout") stdoutBytes += bytes;
      else stderrBytes += bytes;
      if (
        outputBytes > limits.outputBytes
        || stdoutBytes > limits.stdoutBytes
        || stderrBytes > limits.stderrBytes
      ) stop("output-limit-exceeded");
    };
    const abort = () => stop("aborted");
    const timeout = setTimeout(() => stop("timed-out"), limits.timeoutMs);

    child.stdout?.on("data", (value) => count("stdout", value));
    child.stderr?.on("data", (value) => count("stderr", value));
    child.once("error", () => finish(new OnePasswordOperationError(failure ?? "failed")));
    child.once("close", (code) => {
      if (failure) finish(new OnePasswordOperationError(failure));
      else if (typeof code === "number" && acceptedExitCodes.includes(code)) {
        finishResult(code);
      } else finish(new OnePasswordOperationError("failed"));
    });

    function finishResult(exitCode: number): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(terminationDeadline);
      signal?.removeEventListener("abort", abort);
      releaseLocalHandles(child);
      resolve({ operation: "op-run", exitCode });
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function releaseLocalHandles(child: ChildProcess): void {
  // This only releases local resources. Process-tree termination is requested
  // exclusively by stop() for timeout, abort, and output-limit failures.
  try { child.stdout?.destroy(); } catch { /* stream may already be closed */ }
  try { child.stderr?.destroy(); } catch { /* stream may already be closed */ }
  try { child.unref(); } catch { /* custom test/process implementations may not support it */ }
}

/**
 * Requests termination without making settlement depend on its success.
 *
 * POSIX children are launched detached, so their PID is also the process-group
 * ID and a negative PID kills the group. On Windows taskkill /t reaches the
 * process tree. Either mechanism can be evaded by a child that deliberately
 * creates a new session/tree; the grace deadline in awaitBoundedChild remains
 * the promise-settlement guarantee in that case.
 */
function requestTermination(child: ChildProcess): void {
  const pid = child.pid;
  const directKill = () => {
    try { child.kill("SIGKILL"); } catch { /* bounded settlement handles failed kills */ }
  };

  if (process.platform === "win32" && typeof pid === "number" && pid > 0) {
    try {
      const taskkill = spawn("taskkill", ["/pid", String(pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      });
      taskkill.once("error", directKill);
      taskkill.once("close", (code) => {
        if (code !== 0) directKill();
      });
      // The caller's settlement is independently bounded; a stuck taskkill
      // helper must not keep the parent event loop alive.
      taskkill.unref();
      return;
    } catch {
      directKill();
      return;
    }
  }

  if (process.platform !== "win32" && typeof pid === "number" && pid > 0) {
    try {
      process.kill(-pid, "SIGKILL");
      return;
    } catch {
      // A custom spawner may not have created a process group; kill directly.
    }
  }
  directKill();
}

function isReferenceEnvironmentName(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function containsSecretReference(value: string): boolean {
  return value.toLowerCase().includes(OP_REFERENCE_PREFIX);
}
