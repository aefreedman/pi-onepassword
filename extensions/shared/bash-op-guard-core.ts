// This is deliberately lexical defense in depth, not a shell parser or an
// authorization boundary. Runtime shell construction can evade it.
const OP_COMMAND_TOKEN = /(^|[^A-Za-z0-9_])op(?:\.exe)?(?=$|[^A-Za-z0-9_])/i;
const OP_REFERENCE_TOKEN = /op:\/\//i;

export function commandMentionsBlockedOp(command: string): boolean {
  return OP_COMMAND_TOKEN.test(command) || OP_REFERENCE_TOKEN.test(command);
}

export function commandRunsBlockedOp(command: string): boolean {
  return commandMentionsBlockedOp(command);
}

export const __bashOpGuardInternals = {
  commandMentionsBlockedOp,
  commandRunsBlockedOp,
};
