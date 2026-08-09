import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const [childExecutable, ...childArgs] = process.argv.slice(2);
const expectedReference = "op://Fake Automation/fixed-auth/token";
const resolvedToken = "inert-resolved-secret-sentinel";

if (!childExecutable || process.env.OP_SERVICE_ACCOUNT_TOKEN !== "inert-service-account-token") process.exit(40);
if (process.env.PI_ONEPASSWORD_FIXED_AUTH_TOKEN !== expectedReference) process.exit(41);

const childEnvironment = { ...process.env, PI_ONEPASSWORD_FIXED_AUTH_TOKEN: resolvedToken };
delete childEnvironment.OP_SERVICE_ACCOUNT_TOKEN;
for (const name of Object.keys(childEnvironment)) {
  if (/^OP_CONNECT(?:_|$)/i.test(name) || /^OP_SESSION(?:_|$)/i.test(name)) delete childEnvironment[name];
}

// Tests may inspect only this secret-free execution shape, never environment values.
if (process.env.PI_ONEPASSWORD_TEST_TRACE_FILE) {
  writeFileSync(process.env.PI_ONEPASSWORD_TEST_TRACE_FILE, JSON.stringify({
    childExecutable,
    childArgs,
    childEnvironmentNames: Object.keys(childEnvironment).sort(),
  }));
}

const child = spawn(childExecutable, childArgs, { env: childEnvironment, stdio: ["ignore", "pipe", "pipe"] });
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
child.once("error", () => process.exit(42));
child.once("close", (code) => process.exit(code ?? 42));
