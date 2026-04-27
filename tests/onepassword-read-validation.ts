import { __onePasswordReadInternals } from "../extensions/shared/onepassword-read.ts";

const assert = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const expectThrows = (fn: () => unknown, message: string): void => {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  assert(threw, message);
};

const main = (): void => {
  const ref = "op:" + "//Shared Vault/Codecks/token";
  const env = { AGENT_OP_ALLOWED_VAULTS: "shared vault, other" } as NodeJS.ProcessEnv;

  assert(
    __onePasswordReadInternals.parseVaultFromOnePasswordRef(ref) === "Shared Vault",
    "Expected vault segment to parse from 1Password reference.",
  );

  assert(
    __onePasswordReadInternals.getAllowedOnePasswordVaults(env).has("shared vault"),
    "Expected AGENT_OP_ALLOWED_VAULTS to populate allow-list.",
  );

  __onePasswordReadInternals.assertOnePasswordRefAllowed(ref, env);
  expectThrows(
    () => __onePasswordReadInternals.assertOnePasswordRefAllowed(ref, { AGENT_OP_ALLOWED_VAULTS: "other" } as NodeJS.ProcessEnv),
    "Expected non-allow-listed vault to be rejected.",
  );

  const value = __onePasswordReadInternals.readOnePasswordRef(ref, {
    env,
    executable: "op",
    execFile: (command, args) => {
      assert(command === "op", "Expected op executable.");
      assert(Array.isArray(args) && args[0] === "read" && args[1] === ref, "Expected op read invocation.");
      return "secret-value\n" as never;
    },
  });

  assert(value === "secret-value", "Expected read helper to trim secret output.");

  console.log("PASS: onepassword read helper validation succeeded");
};

main();
