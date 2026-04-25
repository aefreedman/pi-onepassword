import { __bashOpGuardInternals } from "../extensions/shared/bash-op-guard-core.ts";

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

  console.log("PASS: bash op guard validation succeeded");
};

main();
