import { __onePasswordReadInternals } from "../extensions/shared/onepassword-read.ts";

const assert = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const expectThrows = (fn: () => unknown, message: string): Error => {
  try {
    fn();
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  throw new Error(message);
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

  assert(
    __onePasswordReadInternals.getOnePasswordExecutable({}, {}) === "op",
    "Expected the bare op command when no executable is configured.",
  );
  assert(
    __onePasswordReadInternals.getOnePasswordExecutable({}, { PI_ONEPASSWORD_OP_EXECUTABLE: "/secure/bin/op" }) === "/secure/bin/op",
    "Expected PI_ONEPASSWORD_OP_EXECUTABLE to override the bare op command.",
  );
  assert(
    __onePasswordReadInternals.getOnePasswordExecutable({ executable: "/explicit/op" }, { PI_ONEPASSWORD_OP_EXECUTABLE: "/secure/bin/op" }) === "/explicit/op",
    "Expected an explicit executable option to take precedence over PI_ONEPASSWORD_OP_EXECUTABLE.",
  );

  const value = __onePasswordReadInternals.readOnePasswordRef(ref, {
    env: { ...env, PI_ONEPASSWORD_OP_EXECUTABLE: "/secure/bin/op" },
    execFile: (command, args) => {
      assert(command === "/secure/bin/op", "Expected configured op executable.");
      assert(Array.isArray(args) && args[0] === "read" && args[1] === ref, "Expected op read invocation.");
      return "secret-value\n" as never;
    },
  });

  assert(value === "secret-value", "Expected read helper to trim secret output.");

  const missingExecutableError = expectThrows(
    () => __onePasswordReadInternals.readOnePasswordRef(ref, {
      env,
      executable: "missing-op",
      execFile: () => {
        throw Object.assign(new Error("spawn missing-op ENOENT"), { code: "ENOENT" });
      },
    }),
    "Expected a missing 1Password executable to throw.",
  );
  assert(
    missingExecutableError.message.includes("PATH") && missingExecutableError.message.includes("PI_ONEPASSWORD_OP_EXECUTABLE"),
    "Expected a clear PATH and override diagnostic for a missing 1Password executable.",
  );
  assert(
    !missingExecutableError.message.includes(ref),
    "Expected the missing executable diagnostic not to include the 1Password reference.",
  );

  console.log("PASS: onepassword read helper validation succeeded");
};

main();
