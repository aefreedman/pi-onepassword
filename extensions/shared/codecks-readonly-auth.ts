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
} from "./onepassword-trusted.ts";

/**
 * Explicit trust boundary for the separately configured pi-codecks child.
 * This only validates a trusted user-level absolute path; pi-onepassword has
 * no runtime package dependency through which it could prove package origin.
 */
export type TrustedUserConfiguredCodecksClientExecutable = TrustedExecutable & {
  readonly __trustedUserConfiguredCodecksClientExecutable: unique symbol;
};

export function validateTrustedUserConfiguredCodecksClientExecutable(value: string): TrustedUserConfiguredCodecksClientExecutable {
  return validateTrustedExecutable(value) as TrustedUserConfiguredCodecksClientExecutable;
}

// pi-codecks owns this versioned child protocol. This package only injects the
// reference and service-account identity into its bounded fixed child.
const CODECKS_TOKEN_ENV = "PI_CODECKS_READONLY_AUTH_TOKEN";
const CODECKS_ACCOUNT_ENV = "PI_CODECKS_READONLY_AUTH_ACCOUNT";
const CODECKS_EXIT = {
  authenticated: 0,
  authenticationRejected: 10,
  malformedResponse: 11,
  responseTooLarge: 12,
  invalidConfiguration: 13,
  unavailable: 14,
} as const;

export type CodecksReadonlyAuthCheck = Readonly<{
  /**
   * Trusted user-level configuration for pi-codecks's no-argument child.
   * No model-facing API or tool accepts or constructs this value.
   */
  trustedCodecksClientExecutable: TrustedUserConfiguredCodecksClientExecutable;
  /** Trusted profile metadata; pi-codecks validates it as an account slug. */
  account: string;
  /** Absolute, user-configured 1Password CLI path. */
  opExecutable: TrustedExecutable;
  /** Configured reference; its resolved token is never returned. */
  reference: SecretReference;
  /** Supplied by the trusted launcher, never configuration. */
  serviceAccountToken: string | undefined;
}>;

export type CodecksReadonlyAuthResult = Readonly<{
  operation: "codecks-readonly-auth";
  category:
    | "authenticated"
    | "authentication-rejected"
    | "malformed-response"
    | "response-too-large"
    | "invalid-configuration"
    | "unavailable"
    | "timed-out"
    | "cancelled"
    | "output-limit-exceeded";
  status: "success" | "unauthorized" | "invalid-response" | "response-too-large" | "invalid-configuration" | "unavailable";
  durationMs: number;
}>;

export type CodecksReadonlyAuthOptions = Readonly<{
  signal?: AbortSignal;
  limits?: Partial<BoundedExecutionLimits>;
  /** Dependency injection for deterministic fake-backed orchestration tests. */
  spawnProcess?: SpawnBoundedProcess;
  inheritedEnvironment?: NodeJS.ProcessEnv;
}>;

/**
 * Runs the trusted user-configured pi-codecks identity child through `op run`.
 * This is a trusted-package API, not a registered model-facing tool. It fixes
 * Node, no child arguments, credential environment name, and operation;
 * pi-codecks owns the selected child protocol and exit codes. Residual trust:
 * pi-onepassword validates the configured path is absolute but cannot prove it
 * names pi-codecks's export without a released cross-package runtime contract.
 */
export async function runCodecksReadonlyAuthCheck(
  check: CodecksReadonlyAuthCheck,
  options: CodecksReadonlyAuthOptions = {},
): Promise<CodecksReadonlyAuthResult> {
  const startedAt = Date.now();
  const child = createFixedChildContract({
    executable: validateTrustedExecutable(process.execPath),
    args: [check.trustedCodecksClientExecutable],
    referenceEnvironmentName: CODECKS_TOKEN_ENV,
    environment: { [CODECKS_ACCOUNT_ENV]: check.account },
  });

  try {
    const result = await runBoundedOpRun({
      opExecutable: validateTrustedExecutable(check.opExecutable),
      child,
      reference: validateSecretReference(check.reference),
      serviceAccountToken: check.serviceAccountToken,
      inheritedEnvironment: sanitizeCodecksCredentialEnvironment(options.inheritedEnvironment ?? process.env),
      limits: options.limits,
      signal: options.signal,
      spawnProcess: options.spawnProcess,
      acceptedExitCodes: Object.values(CODECKS_EXIT),
    });
    return publicResult(result.exitCode, elapsed(startedAt));
  } catch (error) {
    return publicErrorResult(error, elapsed(startedAt));
  }
}

function publicResult(exitCode: number, durationMs: number): CodecksReadonlyAuthResult {
  switch (exitCode) {
    case CODECKS_EXIT.authenticated:
      return { operation: "codecks-readonly-auth", category: "authenticated", status: "success", durationMs };
    case CODECKS_EXIT.authenticationRejected:
      return { operation: "codecks-readonly-auth", category: "authentication-rejected", status: "unauthorized", durationMs };
    case CODECKS_EXIT.malformedResponse:
      return { operation: "codecks-readonly-auth", category: "malformed-response", status: "invalid-response", durationMs };
    case CODECKS_EXIT.responseTooLarge:
      return { operation: "codecks-readonly-auth", category: "response-too-large", status: "response-too-large", durationMs };
    case CODECKS_EXIT.invalidConfiguration:
      return { operation: "codecks-readonly-auth", category: "invalid-configuration", status: "invalid-configuration", durationMs };
    default:
      return { operation: "codecks-readonly-auth", category: "unavailable", status: "unavailable", durationMs };
  }
}

function publicErrorResult(error: unknown, durationMs: number): CodecksReadonlyAuthResult {
  let category: CodecksReadonlyAuthResult["category"] = "unavailable";
  if (error instanceof OnePasswordOperationError) {
    if (error.code === "aborted") category = "cancelled";
    else if (error.code === "timed-out") category = "timed-out";
    else if (error.code === "output-limit-exceeded") category = "output-limit-exceeded";
    else if (error.code === "invalid-configuration" || error.code === "service-account-required") category = "invalid-configuration";
  }
  return {
    operation: "codecks-readonly-auth",
    category,
    status: category === "invalid-configuration" ? "invalid-configuration" : "unavailable",
    durationMs,
  };
}

function sanitizeCodecksCredentialEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const sanitized = Object.create(null) as NodeJS.ProcessEnv;
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined || isCodecksCredentialEnvironmentName(name) || /^PI_CODECKS_READONLY_AUTH_(?:TOKEN|ACCOUNT)$/i.test(name)) continue;
    sanitized[name] = value;
  }
  return sanitized;
}

function isCodecksCredentialEnvironmentName(name: string): boolean {
  return /^CODECKS_(?:API_)?TOKEN$/i.test(name)
    || /^CODECKS_PROFILE_[A-Z0-9_]+_(?:API_)?TOKEN$/i.test(name);
}

function elapsed(startedAt: number): number {
  return Math.max(0, Math.min(60_000, Date.now() - startedAt));
}
