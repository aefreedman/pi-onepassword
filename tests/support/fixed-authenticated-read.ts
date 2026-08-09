import { fileURLToPath } from "node:url";
import {
  OnePasswordOperationError,
  type BoundedExecutionLimits,
  type SpawnBoundedProcess,
  type TrustedExecutable,
  createFixedChildContract,
  runBoundedOpRun,
  validateSecretReference,
  validateTrustedExecutable,
  type SecretReference,
} from "../../extensions/shared/onepassword-trusted.ts";

const CLIENT_SCRIPT = fileURLToPath(new URL("../fixtures/fixed-authenticated-read-client.mjs", import.meta.url));
const CLIENT_EXIT = {
  authenticated: 0,
  authenticationRejected: 10,
  malformedResponse: 11,
  responseTooLarge: 12,
} as const;

export type FixedAuthenticatedReadCheck = Readonly<{
  /** Absolute, user-configured 1Password CLI path. */
  opExecutable: TrustedExecutable;
  /** A configured reference; this operation never returns its resolved value. */
  reference: SecretReference;
  /** Supplied by the trusted launcher, never configuration. */
  serviceAccountToken: string | undefined;
}>;

export type FixedAuthenticatedReadResult = Readonly<{
  operation: "fixed-authenticated-read";
  category:
    | "authenticated"
    | "authentication-rejected"
    | "malformed-response"
    | "response-too-large"
    | "failed"
    | "timed-out"
    | "cancelled"
    | "output-limit-exceeded";
  status: "success" | "unauthorized" | "invalid-response" | "response-too-large" | "unavailable";
  /** Bounded elapsed local execution time; it excludes all sensitive values. */
  durationMs: number;
}>;

export type FixedAuthenticatedReadOptions = Readonly<{
  signal?: AbortSignal;
  limits?: Partial<BoundedExecutionLimits>;
  /** Dependency injection for deterministic fake-op validation only. */
  spawnProcess?: SpawnBoundedProcess;
  inheritedEnvironment?: NodeJS.ProcessEnv;
}>;

/**
 * Executes one package-owned, read-only GET /v1/identity operation against a
 * fixed loopback fake service. It deliberately has no model-controlled URL,
 * method, executable, operation, or secret argument. It is an integration boundary
 * for deterministic validation, not a general HTTP or bearer-token client.
 */
export async function runFixedAuthenticatedReadCheck(
  check: FixedAuthenticatedReadCheck,
  options: FixedAuthenticatedReadOptions = {},
): Promise<FixedAuthenticatedReadResult> {
  const startedAt = Date.now();
  const child = createFixedChildContract({
    executable: validateTrustedExecutable(process.execPath),
    args: [CLIENT_SCRIPT],
    referenceEnvironmentName: "PI_ONEPASSWORD_FIXED_AUTH_TOKEN",
  });

  try {
    const result = await runBoundedOpRun({
      opExecutable: validateTrustedExecutable(check.opExecutable),
      child,
      reference: validateSecretReference(check.reference),
      serviceAccountToken: check.serviceAccountToken,
      inheritedEnvironment: options.inheritedEnvironment,
      limits: options.limits,
      signal: options.signal,
      spawnProcess: options.spawnProcess,
      acceptedExitCodes: Object.values(CLIENT_EXIT),
    });
    return publicResult(result.exitCode, elapsed(startedAt));
  } catch (error) {
    return publicErrorResult(error, elapsed(startedAt));
  }
}

function publicResult(exitCode: number, durationMs: number): FixedAuthenticatedReadResult {
  switch (exitCode) {
    case CLIENT_EXIT.authenticated:
      return { operation: "fixed-authenticated-read", category: "authenticated", status: "success", durationMs };
    case CLIENT_EXIT.authenticationRejected:
      return { operation: "fixed-authenticated-read", category: "authentication-rejected", status: "unauthorized", durationMs };
    case CLIENT_EXIT.malformedResponse:
      return { operation: "fixed-authenticated-read", category: "malformed-response", status: "invalid-response", durationMs };
    case CLIENT_EXIT.responseTooLarge:
      return { operation: "fixed-authenticated-read", category: "response-too-large", status: "response-too-large", durationMs };
    default:
      return { operation: "fixed-authenticated-read", category: "failed", status: "unavailable", durationMs };
  }
}

function publicErrorResult(error: unknown, durationMs: number): FixedAuthenticatedReadResult {
  let category: FixedAuthenticatedReadResult["category"] = "failed";
  if (error instanceof OnePasswordOperationError) {
    if (error.code === "aborted") category = "cancelled";
    else if (error.code === "timed-out") category = "timed-out";
    else if (error.code === "output-limit-exceeded") category = "output-limit-exceeded";
  }
  return {
    operation: "fixed-authenticated-read",
    category,
    status: "unavailable",
    durationMs,
  };
}

function elapsed(startedAt: number): number {
  return Math.max(0, Math.min(60_000, Date.now() - startedAt));
}
