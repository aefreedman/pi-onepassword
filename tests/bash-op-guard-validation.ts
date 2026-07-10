import { __bashOpGuardInternals } from "../extensions/shared/bash-op-guard-core.ts";
import { sanitizeOnePasswordEnvironment } from "../extensions/shared/onepassword-env.ts";

const assert = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const expectBlocked = (command: string): void => {
  assert(
    __bashOpGuardInternals.commandRunsBlockedOp(command),
    `Expected command to be blocked: ${command}`,
  );
};

const expectAllowed = (command: string): void => {
  assert(
    !__bashOpGuardInternals.commandRunsBlockedOp(command),
    `Expected command to be allowed: ${command}`,
  );
};

const main = (): void => {
  expectBlocked("op read foo");
  expectBlocked("env FOO=bar op read foo");
  expectBlocked("command op read foo");
  expectBlocked("sudo op read foo");
  expectBlocked("zsh -lc \"op read foo\"");
  expectBlocked("bash -lc \"env FOO=bar op read foo\"");
  expectBlocked("cmd /c \"op read foo\"");
  expectBlocked("pwsh -command \"op read foo\"");
  expectBlocked("echo op://vault/item/field");
  expectBlocked("./scripts/op-read-allowlist.sh foo");
  expectBlocked("find . -exec op read foo \\\;");
  expectBlocked("printf '%s\\n' foo | xargs op read");

  expectAllowed("cm status");
  expectAllowed("git diff --stat");
  expectAllowed("zsh -lc \"cm status\"");
  expectAllowed("echo onepassword-tools");

  const secretEnvironmentNames = [
    "OP_CONNECT_TOKEN",
    "OP_SERVICE_ACCOUNT_TOKEN",
    "OP_SERVICE_ACCOUNT_TOKEN_GITHUB",
    "OP_SERVICE_ACCOUNT_TOKEN_WORK",
    "OP_SESSION_PERSONAL",
    "OP_SESSION",
  ];
  const environment: Record<string, string> = {
    PATH: "/usr/bin",
    OP_CONNECT_HOST: "https://connect.example",
  };
  for (const name of secretEnvironmentNames) environment[name] = "inert-test-placeholder";

  const sanitized = sanitizeOnePasswordEnvironment(environment);
  assert(sanitized.PATH === "/usr/bin", "Expected unrelated environment variables to remain available.");
  assert(sanitized.OP_CONNECT_HOST === "https://connect.example", "Expected non-secret 1Password connection metadata to remain available.");
  for (const name of secretEnvironmentNames) {
    assert(!(name in sanitized), `Expected secret-bearing ${name} to be removed from Bash environments.`);
  }

  console.log("PASS: bash op guard validation succeeded");
};

main();
