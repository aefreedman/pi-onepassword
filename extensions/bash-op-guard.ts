import { createBashTool, isToolCallEventType, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { commandRunsBlockedOp } from "./shared/bash-op-guard-core";
import { sanitizeOnePasswordEnvironment } from "./shared/onepassword-env";

const BLOCK_MESSAGE =
  "`op` is blocked in Pi bash commands. Use explicit 1Password integrations instead of invoking 1Password CLI from `bash`.";

export default function bashOpGuard(pi: ExtensionAPI) {
  const createSanitizedBashTool = (cwd: string) =>
    createBashTool(cwd, {
      spawnHook: ({ command, cwd, env }) => ({
        command,
        cwd,
        env: sanitizeOnePasswordEnvironment(env),
      }),
    });

  const bashTool = createSanitizedBashTool(process.cwd());

  pi.registerTool({
    ...bashTool,
    async execute(id, params, signal, onUpdate, ctx) {
      const currentBashTool = createSanitizedBashTool(ctx.cwd);
      return await currentBashTool.execute(id, params, signal, onUpdate);
    },
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return;

    const command = typeof event.input.command === "string" ? event.input.command : "";
    if (!command || !commandRunsBlockedOp(command)) return;

    if (ctx.hasUI) {
      ctx.ui.notify("Blocked bash command invoking op", "warning");
    }

    return {
      block: true,
      reason: BLOCK_MESSAGE,
    };
  });
}
