# Pi OnePassword

Pi package for 1Password-related shell safety policy.

## Purpose

This package centralizes how Pi is allowed to interact with 1Password:

- block raw `op` / `op://...` usage from the generic `bash` tool
- strip 1Password service-account tokens from Pi bash-tool subprocess environments
- keep 1Password access routed through explicit Pi integrations instead of ad hoc shell commands

## Included behavior

### Bash guard

- Blocks direct `op` / `op://...` usage from the `bash` tool.
- Blocks helper wrappers such as `op-read-allowlist.sh` from generic shell execution.
- Strips `OP_SERVICE_ACCOUNT_TOKEN` and `OP_SERVICE_ACCOUNT_TOKEN_GITHUB` from Pi bash-tool subprocess environments.

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

This package does not read secrets itself. It provides guardrails so secret reads happen only through explicit integrations that can apply allow-lists and redaction.

## Testing

```bash
npm test
```

## License

MIT. See `LICENSE`.
