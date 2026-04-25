import {
  commandMatches,
  stripAssignments,
  stripLeadingWrappers,
} from "./bash-command-guards";

const DIRECT_OP = /^(?:["']?[^"'\s]*[\\/])?op(?:\.exe)?(?:\s|$)/i;
const DIRECT_ALLOWLIST_WRAPPER = /^(?:["']?[^"'\s]*[\\/])?op-read-allowlist\.sh(?:\s|$)/i;
const ANY_OP_TOKEN = /(^|[^A-Za-z0-9_])(?:op(?:\.exe)?|op-read-allowlist\.sh)(?=$|[^A-Za-z0-9_])/i;
const OP_REF_TOKEN = /op:\/\//i;

export function commandMentionsBlockedOp(command: string): boolean {
  return ANY_OP_TOKEN.test(command) || OP_REF_TOKEN.test(command);
}

export function segmentRunsBlockedOp(segment: string): boolean {
  const stripped = stripLeadingWrappers(stripAssignments(segment));
  if (!stripped) return false;

  if (DIRECT_OP.test(stripped)) return true;
  if (DIRECT_ALLOWLIST_WRAPPER.test(stripped)) return true;

  const subshell = /\$\(\s*(?:sudo\s+)?(?:env\s+(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*)?(?:command\s+)?(?:time\s+)?(?:nice(?:\s+-?\d+)?\s+)?(?:["']?[^"'\s]*[\\/])?(?:op(?:\.exe)?|op-read-allowlist\.sh)(?:\s|\)|$)/i;
  if (subshell.test(stripped)) return true;

  const findExec = /(?:^|\s)-(?:exec|execdir)\s+(?:["']?[^"'\s]*[\\/])?(?:op(?:\.exe)?|op-read-allowlist\.sh)(?:\s|$)/i;
  if (findExec.test(stripped)) return true;

  const xargsExec = /(?:^|\s)xargs\b[\s\S]*?(?:^|\s)(?:op(?:\.exe)?|op-read-allowlist\.sh)(?:\s|$)/i;
  if (xargsExec.test(stripped)) return true;

  return false;
}

export function commandRunsBlockedOp(command: string): boolean {
  if (commandMentionsBlockedOp(command)) return true;
  return commandMatches(command, segmentRunsBlockedOp);
}

export const __bashOpGuardInternals = {
  commandMentionsBlockedOp,
  segmentRunsBlockedOp,
  commandRunsBlockedOp,
  stripAssignments,
  stripLeadingWrappers,
};
