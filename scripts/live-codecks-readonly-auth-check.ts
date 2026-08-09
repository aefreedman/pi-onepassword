import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runCodecksReadonlyAuthCheck,
  validateTrustedUserConfiguredCodecksClientExecutable,
  type CodecksReadonlyAuthCheck,
  type CodecksReadonlyAuthResult,
} from "../extensions/shared/codecks-readonly-auth.ts";
import {
  validateSecretReference,
  validateTrustedExecutable,
  type SpawnBoundedProcess,
} from "../extensions/shared/onepassword-trusted.ts";

const OP_EXECUTABLE_ENV = "PI_ONEPASSWORD_OP_EXECUTABLE";
const CODECKS_ACCOUNT_ENV = "PI_ONEPASSWORD_CODECKS_ACCOUNT";
const CODECKS_REFERENCE_ENV = "PI_ONEPASSWORD_CODECKS_REFERENCE";
const SERVICE_ACCOUNT_TOKEN_ENV = "OP_SERVICE_ACCOUNT_TOKEN";
const CODECKS_CLIENT = fileURLToPath(new URL("../../pi-codecks/src/integrations/codecks-readonly-auth-client.mjs", import.meta.url));

const PUBLIC_OUTCOMES = {
  authenticated: { category: "authenticated", status: "success" },
  "authentication-rejected": { category: "authentication-rejected", status: "unauthorized" },
  "malformed-response": { category: "malformed-response", status: "invalid-response" },
  "response-too-large": { category: "response-too-large", status: "response-too-large" },
  "invalid-configuration": { category: "invalid-configuration", status: "invalid-configuration" },
  unavailable: { category: "unavailable", status: "unavailable" },
  "timed-out": { category: "timed-out", status: "unavailable" },
  cancelled: { category: "cancelled", status: "unavailable" },
  "output-limit-exceeded": { category: "output-limit-exceeded", status: "unavailable" },
} as const;

type PublicOutcomeCategory = keyof typeof PUBLIC_OUTCOMES;
export type LiveCodecksReadonlyAuthOutput = Readonly<{
  operation: "codecks-readonly-auth";
  category: PublicOutcomeCategory;
  status: (typeof PUBLIC_OUTCOMES)[PublicOutcomeCategory]["status"];
  durationMs: number;
}>;

type RunCheck = (check: CodecksReadonlyAuthCheck) => Promise<CodecksReadonlyAuthResult>;
export type LiveCodecksReadonlyAuthLauncherDependencies = Readonly<{
  /** Test-only seams; the executable always uses process.env and the real helper. */
  environment?: NodeJS.ProcessEnv;
  runCheck?: RunCheck;
  /** Test-only fake process seam, passed only to the real helper. */
  spawnProcess?: SpawnBoundedProcess;
  write?: (line: string) => void;
}>;

/**
 * Executes the repository-only fixed Codecks validation operation. The sibling
 * client location is deliberately derived above, never accepted from callers.
 */
export async function launchLiveCodecksReadonlyAuthCheck(
  dependencies: LiveCodecksReadonlyAuthLauncherDependencies = {},
): Promise<Readonly<{ output: LiveCodecksReadonlyAuthOutput; exitCode: 0 | 1 }>> {
  const startedAt = Date.now();
  let check: CodecksReadonlyAuthCheck;
  try {
    check = readConfiguration(dependencies.environment ?? process.env);
  } catch {
    const output = fixedOutput("invalid-configuration", elapsed(startedAt));
    (dependencies.write ?? writeOutput)(`${JSON.stringify(output)}\n`);
    return { output, exitCode: 1 };
  }

  let output: LiveCodecksReadonlyAuthOutput;
  try {
    const result = dependencies.runCheck
      ? await dependencies.runCheck(check)
      : await runCodecksReadonlyAuthCheck(check, { spawnProcess: dependencies.spawnProcess });
    output = toPublicOutput(result, elapsed(startedAt));
  } catch {
    output = fixedOutput("unavailable", elapsed(startedAt));
  }
  (dependencies.write ?? writeOutput)(`${JSON.stringify(output)}\n`);
  return { output, exitCode: output.status === "success" ? 0 : 1 };
}

function readConfiguration(environment: NodeJS.ProcessEnv): CodecksReadonlyAuthCheck {
  const account = String(environment[CODECKS_ACCOUNT_ENV] ?? "").trim();
  const serviceAccountToken = environment[SERVICE_ACCOUNT_TOKEN_ENV];
  if (!isValidCodecksAccount(account) || !serviceAccountToken?.trim()) throw new Error("invalid configuration");

  return {
    trustedCodecksClientExecutable: validateTrustedUserConfiguredCodecksClientExecutable(CODECKS_CLIENT),
    account,
    opExecutable: validateTrustedExecutable(String(environment[OP_EXECUTABLE_ENV] ?? "")),
    reference: validateSecretReference(normalizeCopiedSecretReference(String(environment[CODECKS_REFERENCE_ENV] ?? ""))),
    serviceAccountToken,
  };
}

function toPublicOutput(result: CodecksReadonlyAuthResult, durationMs: number): LiveCodecksReadonlyAuthOutput {
  const category = result.category as PublicOutcomeCategory;
  const expected = PUBLIC_OUTCOMES[category];
  if (!expected || result.status !== expected.status) return fixedOutput("unavailable", durationMs);
  return { operation: "codecks-readonly-auth", category, status: expected.status, durationMs };
}

function fixedOutput(category: PublicOutcomeCategory, durationMs: number): LiveCodecksReadonlyAuthOutput {
  const outcome = PUBLIC_OUTCOMES[category];
  return { operation: "codecks-readonly-auth", category, status: outcome.status, durationMs };
}

function isValidCodecksAccount(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(value);
}

function normalizeCopiedSecretReference(value: string): string {
  const trimmed = value.trim();
  const first = trimmed.at(0);
  const last = trimmed.at(-1);
  if (trimmed.length >= 2 && (first === '"' && last === '"' || first === "'" && last === "'")) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function elapsed(startedAt: number): number {
  return Math.max(0, Math.min(60_000, Date.now() - startedAt));
}

function writeOutput(line: string): void {
  process.stdout.write(line);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void launchLiveCodecksReadonlyAuthCheck().then(({ exitCode }) => { process.exitCode = exitCode; });
}
