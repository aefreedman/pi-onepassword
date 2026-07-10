# Pi OnePassword

Pi package for 1Password-related shell safety policy.

## Purpose

This package centralizes how Pi is allowed to interact with 1Password:

- block raw `op` / `op://...` usage from the generic `bash` tool
- strip 1Password service-account tokens from Pi bash-tool subprocess environments
- keep 1Password access routed through explicit integrations instead of ad hoc shell commands
- provide shared helper code for allow-listed 1Password reads used by explicit integrations

## Included behavior

### Bash guard

- Blocks direct `op` / `op://...` usage from the `bash` tool.
- Blocks helper wrappers such as `op-read-allowlist.sh` from generic shell execution.
- Strips secret-bearing 1Password credentials from Pi bash-tool subprocess environments, including service-account tokens, `OP_CONNECT_TOKEN`, and `OP_SESSION_*` values.

### Allow-listed read helper

`extensions/shared/onepassword-read.ts` owns the shared helper for integrations that need to read a 1Password reference deliberately. It uses `AGENT_OP_ALLOWED_VAULTS` as a harness-agnostic comma-separated vault allow-list.

The helper runs `op` from `PATH` by default. Set `PI_ONEPASSWORD_OP_EXECUTABLE` to an absolute CLI path when `op` is not on `PATH`; an integration's explicit `executable` option takes precedence over this environment override. If no executable is found, the helper reports the PATH/override remedy without including the requested 1Password reference.

Generic shell commands remain blocked. Package integrations should import or wrap this helper rather than asking agents to run `op` from `bash`.

## Install

Recommended as a global package.

From GitHub:

```bash
pi install git:git@github.com:aefreedman/pi-onepassword.git
```

Local development install:

```bash
pi install <path-to-pi-onepassword>
```

## Notes

This package does not expose a general-purpose model-facing secret-reading tool. It provides guardrails and shared helper code so secret reads happen only through explicit integrations that can apply allow-lists and redaction.

## Testing

```bash
npm test
```

## License

MIT. See `LICENSE`.
