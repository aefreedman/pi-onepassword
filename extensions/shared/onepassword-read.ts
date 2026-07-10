import { execFileSync } from "node:child_process";

export type OnePasswordReadOptions = {
  env?: NodeJS.ProcessEnv;
  executable?: string;
  timeoutMs?: number;
  execFile?: typeof execFileSync;
};

const DEFAULT_TIMEOUT_MS = 10000;
const OP_REF_PREFIX = "op:" + "//";

const normalizeVaultName = (value: string): string => value.trim().toLowerCase();

function getOnePasswordExecutable(options: OnePasswordReadOptions, env: NodeJS.ProcessEnv): string {
  if (options.executable !== undefined) {
    return options.executable;
  }

  const configured = env.PI_ONEPASSWORD_OP_EXECUTABLE?.trim();
  return configured || "op";
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === code);
}

export function getAllowedOnePasswordVaults(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const configured = env.AGENT_OP_ALLOWED_VAULTS ?? "";
  return new Set(
    configured
      .split(",")
      .map(normalizeVaultName)
      .filter((value) => value.length > 0),
  );
}

export function parseVaultFromOnePasswordRef(ref: string): string | undefined {
  const trimmed = ref.trim();
  if (!trimmed.startsWith(OP_REF_PREFIX)) return undefined;

  const withoutPrefix = trimmed.slice(OP_REF_PREFIX.length);
  const slashIndex = withoutPrefix.indexOf("/");
  if (slashIndex <= 0) return undefined;

  return withoutPrefix.slice(0, slashIndex).trim();
}

export function assertOnePasswordRefAllowed(ref: string, env: NodeJS.ProcessEnv = process.env): string {
  const vault = parseVaultFromOnePasswordRef(ref);
  if (!vault) {
    throw new Error("1Password reference must use an op reference with a vault segment.");
  }

  const allowedVaults = getAllowedOnePasswordVaults(env);
  if (!allowedVaults.has(normalizeVaultName(vault))) {
    throw new Error("1Password reference vault is not allowed. Set AGENT_OP_ALLOWED_VAULTS to a comma-separated vault allow-list.");
  }

  return vault;
}

export function readOnePasswordRef(ref: string, options: OnePasswordReadOptions = {}): string {
  const env = options.env ?? process.env;
  const executable = getOnePasswordExecutable(options, env);
  const timeout = Math.max(1000, Math.min(60000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  const execFile = options.execFile ?? execFileSync;
  const trimmedRef = ref.trim();

  assertOnePasswordRefAllowed(trimmedRef, env);

  let output: ReturnType<typeof execFileSync>;
  try {
    output = execFile(executable, ["read", trimmedRef], {
      encoding: "utf8",
      timeout,
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      throw new Error(
        "1Password CLI was not found. Install `op` and add it to PATH, or set PI_ONEPASSWORD_OP_EXECUTABLE to the CLI's full path.",
      );
    }
    throw error;
  }

  const secret = String(output ?? "").trim();
  if (!secret) {
    throw new Error("1Password returned an empty value.");
  }

  return secret;
}

export const __onePasswordReadInternals = {
  getAllowedOnePasswordVaults,
  parseVaultFromOnePasswordRef,
  assertOnePasswordRefAllowed,
  readOnePasswordRef,
  getOnePasswordExecutable,
};
