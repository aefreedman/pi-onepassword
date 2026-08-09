import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import bashOpGuard from "../extensions/bash-op-guard.ts";

type RegisteredBashTool = Readonly<{
  name: string;
  execute: (
    id: string,
    params: { command: string; timeout?: number },
    signal: AbortSignal,
    onUpdate: () => void,
    context: { cwd: string },
  ) => Promise<unknown>;
}>;
type ToolCallHandler = (
  event: { toolName: string; input: { command?: unknown } },
  context: { hasUI: boolean; ui: { notify: (message: string, level: string) => void } },
) => Promise<unknown>;

let registeredTool: unknown;
let toolCallHandler: unknown;
const api = {
  registerTool(tool: unknown) {
    registeredTool = tool;
  },
  on(event: string, handler: unknown) {
    if (event === "tool_call") toolCallHandler = handler;
  },
} as unknown as ExtensionAPI;

bashOpGuard(api);

assert(registeredTool && typeof registeredTool === "object", "Expected the real Bash extension to register a tool.");
assert(toolCallHandler && typeof toolCallHandler === "function", "Expected the real Bash extension to register a tool_call hook.");
const bashTool = registeredTool as RegisteredBashTool;
const handleToolCall = toolCallHandler as ToolCallHandler;
assert.equal(bashTool.name, "bash", "Expected the registered tool to be Pi's Bash surface.");

const notifications: string[] = [];
const context = { hasUI: true, ui: { notify: (message: string) => notifications.push(message) } };
const blocked = await handleToolCall({ toolName: "bash", input: { command: "op whoami" } }, context);
assert.deepEqual(blocked, {
  block: true,
  reason: "Bash command text mentioning `op` or `op://` is blocked. Use explicit 1Password integrations instead of invoking the 1Password CLI from `bash`.",
});
assert.equal(notifications.length, 1, "Expected blocked Bash text to produce a UI warning when UI is available.");

const falsePositive = await handleToolCall({ toolName: "bash", input: { command: "echo op documentation" } }, context);
assert.deepEqual(falsePositive, blocked, "Expected the documented lexical false-positive limitation.");
const bypass = await handleToolCall({ toolName: "bash", input: { command: "printf '\\157\\160 whoami' | sh" } }, context);
assert.equal(bypass, undefined, "Expected the documented runtime-construction bypass limitation.");

const credentialNames = ["OP_SERVICE_ACCOUNT_TOKEN", "op_connect_token", "Op_Session_Personal"] as const;
const original = new Map(credentialNames.map((name) => [name, process.env[name]]));
try {
  for (const name of credentialNames) process.env[name] = "inert-extension-harness-value";
  const probe = "process.stdout.write([process.env.OP_SERVICE_ACCOUNT_TOKEN, process.env.op_connect_token, process.env.Op_Session_Personal].some(Boolean) ? 'leaked' : 'clean')";
  const command = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(probe)}`;
  const result = await bashTool.execute("extension-sanitization", { command, timeout: 1_000 }, new AbortController().signal, () => {}, { cwd: process.cwd() });
  assert.match(JSON.stringify(result), /clean/, "Expected the registered Bash tool's spawn hook to sanitize 1Password credentials.");
  assert.doesNotMatch(JSON.stringify(result), /inert-extension-harness-value/, "Expected no test credential value in the Bash result.");
} finally {
  for (const [name, value] of original) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

console.log("PASS: real Bash extension harness validation succeeded");
