# Phase 1 Transport Decision

## Status: complete

Phase 1 records the documented 1Password integration contract. It does not add
an authentication, bootstrap, transport-isolation, or CLI-behavior subsystem.

## Decision

- Use a least-privilege 1Password service account, supplied through
  `OP_SERVICE_ACCOUNT_TOKEN`.
- Before invoking 1Password, remove conflicting Connect and session credentials
  from the invocation environment, including `OP_CONNECT_HOST`,
  `OP_CONNECT_TOKEN`, and `OP_SESSION_*`. Set the selected service-account
  token explicitly.
- Represent values as secret references such as
  `op://[REDACTED]/[REDACTED]/[REDACTED]`.
- Prefer `op run -- <fixed trusted command>` when a fixed trusted child command
  can consume the referenced value. Application code then does not need the
  resolved value.
- Return public results and errors that do not include service-account tokens,
  secret references, or resolved values.

These choices follow the intended service-account and CLI usage model:

- [Use secret references with 1Password CLI](https://www.1password.dev/cli/secret-references)
- [Service-account getting started](https://www.1password.dev/service-accounts/get-started.md)
- [Read environment variables](https://www.1password.dev/environments/read-environment-variables.md)

## Deterministic support test

`tests/trusted-op-run-validation.ts` is credential-free and offline. Its inert
fakes verify this package's invocation shape and non-disclosure:

- ordinary process configuration remains available while conflicting Connect,
  session, stale service-account, and case-variant reference-binding variables
  are removed;
- `op run` receives the explicit service-account token and a reference binding,
  then runs the fixed trusted child command; and
- public results and errors omit inert tokens, references, and resolved values.

The fakes verify only this package's use of the documented CLI interface; they
do not invoke 1Password or make claims about its internal implementation.
