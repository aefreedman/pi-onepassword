# Pi OnePassword

Least-privilege 1Password helpers and Bash safety policy for trusted Pi extensions.

## Purpose

This package keeps 1Password credentials out of generic Pi Bash subprocesses and provides small, package-owned helpers for trusted integrations. It is not a model-facing secret reader and does not provide process isolation from Pi, installed extensions, or other code running as the same operating-system user.

## Trusted integration contracts

`extensions/shared/onepassword-trusted.ts` is for trusted extension code only:

- `validateSecretReference()` accepts a syntactically valid `op://...` identifier without resolving it.
- `validateTrustedExecutable()` requires an absolute, trusted CLI or child executable; it never falls back to `PATH`.
- `createFixedChildContract()` defines a fixed child executable, fixed arguments, and a reference environment binding. It rejects references in child arguments.
- `createServiceAccountInvocationEnvironment()` explicitly sets `OP_SERVICE_ACCOUNT_TOKEN` and removes conflicting service-account, Connect, and session inputs case-insensitively.
- `runBoundedOpRun()` invokes `op run -- <fixed trusted child>` with cancellation, timeout, and output limits. It discards child output and reports only normalized, non-secret results and errors. A caller may allowlist a few fixed non-secret exit codes for an operation-specific result.
- `runFixedAuthenticatedReadCheck()` is the deterministic Phase 3 integration: it invokes a package-owned child through the production `op run` helper, sends only `GET /v1/identity` to its fixed loopback fake service, and returns only an operation name, category, status class, and bounded timing. It accepts no model-selected URL, HTTP method, executable, operation, token, or raw secret argument.

Provide the service-account token through a trusted launcher or user environment, not package or project configuration. Give that dedicated service account only the vault access and actions needed by the fixed integration. References identify a value but are not a security boundary by themselves.

No helper resolves or returns a referenced secret value. The fixed authenticated-read integration is intentionally not registered as a Pi tool: it exists solely to prove the fake-backed boundary. Registering a user-facing tool requires a separately agreed real-consumer contract and trusted user-level configuration for that consumer; it must remain fixed-operation and must not accept arbitrary destinations or credentials.

## Bash guard

The Pi Bash extension blocks obvious `op` and `op://...` usage and strips service-account, Connect-token, and session credentials from Bash child environments. Credential-name matching is case-insensitive on all platforms, including Windows.

The command-text block is accidental-use prevention only. Shell runtime construction can bypass lexical detection, so it is not an authorization or isolation boundary.

## Install

Recommended as a global package.

```bash
pi install git:git@github.com:aefreedman/pi-onepassword.git
```

For local development:

```bash
pi install <path-to-pi-onepassword>
```

## Testing

```bash
npm test
npm pack --dry-run
```

All package tests use inert fakes. The authenticated-read test starts an in-process loopback-only fake service; it does not contact 1Password, an external network, or an account.

## License

MIT. See `LICENSE`.
