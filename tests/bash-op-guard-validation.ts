import { __bashOpGuardInternals } from "../extensions/shared/bash-op-guard-core.ts";
import { sanitizeOnePasswordEnvironment } from "../extensions/shared/onepassword-env.ts";

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const expectBlocked = (command: string): void => {
  assert(__bashOpGuardInternals.commandRunsBlockedOp(command), `Expected command to be blocked: ${command}`);
};

const expectAllowed = (command: string): void => {
  assert(!__bashOpGuardInternals.commandRunsBlockedOp(command), `Expected command to be allowed: ${command}`);
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
  expectBlocked("echo op://Automation/item/field");
  expectBlocked("find . -exec op read foo \\;");
  expectBlocked("printf '%s\\n' foo | xargs op read");

  expectAllowed("cm status");
  expectAllowed("git diff --stat");
  expectAllowed("zsh -lc \"cm status\"");
  expectAllowed("echo onepassword-tools");

  // This deterministic lexical bypass would execute `op whoami` after the shell
  // interprets the octal escapes. It documents that the guard is not an
  // authorization boundary; this test does not execute the command.
  expectAllowed("printf '\\157\\160 whoami' | sh");

  const secretEnvironmentNames = [
    "OP_CONNECT_TOKEN",
    "OP_CONNECT_TOKEN_GITHUB",
    "OP_SERVICE_ACCOUNT_TOKEN",
    "OP_SERVICE_ACCOUNT_TOKEN_GITHUB",
    "OP_SERVICE_ACCOUNT_TOKEN_WORK",
    "OP_SESSION_PERSONAL",
    "OP_SESSION",
  ];
  const environment: Record<string, string> = { PATH: "/usr/bin", OP_CONNECT_HOST: "https://connect.example" };
  for (const name of secretEnvironmentNames) environment[name] = "inert-test-placeholder";

  const sanitized = sanitizeOnePasswordEnvironment(environment);
  assert(sanitized.PATH === "/usr/bin", "Expected unrelated environment variables to remain available.");
  assert(sanitized.OP_CONNECT_HOST === "https://connect.example", "Expected non-secret 1Password connection metadata to remain available.");
  for (const name of secretEnvironmentNames) {
    assert(!(name in sanitized), `Expected secret-bearing ${name} to be removed from Bash environments.`);
  }

  // Windows environment names are case-insensitive. Enforce the same behavior
  // on every platform so mixed-case credentials never reach a Bash child.
  const mixedCaseEnvironment = {
    Op_Service_Account_Token: "inert-service-account-token",
    op_connect_token: "inert-test-placeholder",
    op_session_personal: "inert-test-placeholder",
  };
  const mixedCaseSanitized = sanitizeOnePasswordEnvironment(mixedCaseEnvironment);
  for (const name of Object.keys(mixedCaseEnvironment)) {
    assert(!(name in mixedCaseSanitized), `Expected mixed-case ${name} to be removed.`);
  }

  console.log("PASS: bash op guard validation succeeded");
};

main();
