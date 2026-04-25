# Pi OnePassword

Pi package for 1Password-related Pi behavior and policy.

Current extensions:
- `bash-op-guard`

## Purpose

This package centralizes how Pi is allowed to interact with 1Password:
- blocks raw `op` / `op://...` usage from the `bash` tool
- strips 1Password service-account tokens from Pi bash-tool subprocess environments
- keeps 1Password interaction routed through explicit Pi integrations instead of ad hoc shell commands

## Included behavior

### Bash guard
- blocks `op` / `op://...` usage from the `bash` tool
- blocks helper wrappers such as `op-read-allowlist.sh`
- strips `OP_SERVICE_ACCOUNT_TOKEN` and `OP_SERVICE_ACCOUNT_TOKEN_GITHUB` from Pi bash-tool subprocess environments

## Install

Recommended as a global package:

```bash
pi install "<path-to-pi-onepassword>"
```

## License

MIT. See `LICENSE`.
