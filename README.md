# Pi OnePassword

Least-privilege 1Password support for **trusted Pi integrations**, plus defense-in-depth protection for generic Pi Bash processes.

## What this package does

This package provides package-owned helpers for a fixed, trusted integration to use a configured 1Password reference without returning its resolved value to the model. It also removes 1Password service-account, Connect, and session credentials from generic Pi Bash child environments.

It does **not** register a general-purpose secret reader, raw-secret tool, arbitrary command runner, or general HTTP/Bearer-token client.

### References are not plaintext

An `op://...` value is a **reference**: an identifier for a 1Password value. It can be held in trusted user-level integration configuration or passed to a trusted helper without being the credential itself. Vault, item, and field names may still be sensitive metadata, so treat references appropriately.

**Plaintext** is the value produced when 1Password resolves a reference. Plaintext must not appear in model prompts, tool arguments or results, session history, project files, command text or arguments, diagnostics, logs, tests, or fixtures. The reference and service-account token are supplied only to the trusted 1Password invocation. Its fixed `op run -- <trusted child>` contract resolves the reference, then the fixed trusted child receives plaintext only through its designated environment variable; the reference itself does not reach that consumer. Public results contain only fixed outcome categories, status, and bounded timing.

## Trust and authorization model

### Trusted integration helpers, not model-facing tools

`extensions/shared/onepassword-trusted.ts` and the operation-specific helpers are APIs for deliberately trusted extension code. They require:

- an absolute trusted 1Password executable and absolute fixed child executable; never `PATH` lookup;
- a configured reference bound only through a fixed child environment variable, never child arguments;
- an explicitly supplied `OP_SERVICE_ACCOUNT_TOKEN`; conflicting service-account, Connect, and session inputs are removed case-insensitively before invocation; and
- a fixed child, arguments, destination, and operation that return only redacted results.

A model-facing integration must offer a complete fixed operation, not accept an arbitrary reference, executable, destination, operation, or request payload merely because it needs a credential. No registered Pi helper returns a resolved secret value. The non-registered Codecks protocol adapter is the narrow exception: its only successful output is the required v1 credential response to its trusted `pi-codecks` parent; it never exposes that value to a Pi model-facing operation.

### Service-account grants are the authority boundary

Use a separate, least-privilege 1Password service account for each meaningful automation trust domain. Its server-enforced vault and action grants define the maximum authority; package checks and logical reference aliases do not grant access or replace those grants. Missing service-account configuration fails without falling back to a personal, Connect, or session identity.

Provide the service-account token through a trusted launcher or user environment. Do not put it in package configuration, project configuration, source files, prompts, or command arguments.

### Trusted user-level configuration is not OS isolation

Trusted user-level configuration may hold an absolute executable path, a reference or logical binding, and fixed non-secret operation metadata. It is part of this package's trusted computing base: it must not be model-controlled or project-selected. It is **not** protected from arbitrary modification by the same operating-system user and is not an OS sandbox.

Likewise, this package trusts the Pi host, intentionally installed extensions, the configured executable, and the OS user. It cannot protect against malicious trusted extensions, same-user process inspection/debugging/memory access, a compromised OS account, or separately installed personal 1Password facilities.

## Available fixed contracts

- `runBoundedOpRun()` is the internal bounded fixed-child primitive. It discards child output, bounds cancellation, timeout, and output, and exposes only fixed accepted exit categories.
- Repository-only Phase 3 tests retain a deterministic loopback fake identity operation to exercise the bounded `op run` boundary. It is not packaged or a public runtime contract.
- `runCodecksReadonlyAuthCheck()` is a trusted API for the separately owned `pi-codecks` no-argument read-only identity child. Trusted user-level configuration supplies the absolute 1Password and Codecks child paths, configured reference, and safe account metadata. `pi-onepassword` injects the reference and service-account identity, strips ambient Codecks credential variables, and maps only fixed exit categories to a redacted result.
- `extensions/integrations/codecks-credential-helper.mjs` is a stable, non-registered Codecks external-credential-helper v1 adapter. It is launched directly by `pi-codecks`, not loaded as a Pi extension or model-facing tool. It validates one non-secret Codecks request, uses the fixed `op run -- <current Node child>` contract, and returns one credential only to trusted `pi-codecks` memory. It has no dependency on `pi-codecks` and provides no discovery, cache, refresh, lease, network client, or general secret-reader API.

The Codecks child path is trusted user-level configuration because these unreleased packages have no shared released runtime contract. This package validates it is absolute but cannot prove its package origin. Account-backed validation is optional and separately authorized; the compatibility test uses inert fakes only.

## Bash defense in depth

The Pi Bash extension removes `OP_SERVICE_ACCOUNT_TOKEN` (including suffixed forms), `OP_CONNECT_TOKEN`, and `OP_SESSION` (including suffixed forms) from generic Bash child environments. Matching is case-insensitive on every platform, including Windows.

It also blocks Bash command text that mentions `op` or `op://...`. This lexical check is accidental-use prevention only, not proof that an invocation would occur and not an authorization or isolation boundary: shell runtime construction can bypass it, while harmless text can produce false positives. Do not rely on the guard to contain a determined command or other same-user code.

## Migration from the legacy helper and allowlist

This migration is non-destructive. It never requires revealing, reading, copying, printing, or persisting an existing credential. There is no drop-in configuration loader, raw-reader replacement, or model-facing migration endpoint in this package; do not treat these helpers as one.

For each integration author, use this credential-free recipe:

1. Define the consumer-owned trusted user-level configuration contract: an absolute 1Password executable path, an absolute fixed child executable path, a reference (or approved logical binding), the child's designated reference environment-variable name, and fixed non-secret child metadata. Keep that configuration user-level and trusted, never model-controlled or project-selected.
2. Validate those inputs with the existing `validateTrustedExecutable()` and `validateSecretReference()` helpers, then construct the fixed child with `createFixedChildContract()`. Call `runBoundedOpRun()` only from the consumer's operation-specific adapter, with its fixed child, arguments, destination, accepted exit categories, and redacted public result. The reference and service-account token go to the trusted 1Password invocation; `op run` resolves the reference and supplies plaintext only to the child's designated environment variable.
3. Have the trusted launcher supply `OP_SERVICE_ACCOUNT_TOKEN` to that invocation. It must not put the token in argv, shell history, project configuration, package configuration, source files, prompts, or persisted project data. Have the 1Password administrator create or select a dedicated least-privilege service account whose server-side grants are the authorization boundary.
4. Do not retire a legacy consumer's ambient-identity or allowlist usage until that consumer has its own operation-specific adapter. Do not replace it with a model-facing `op read` call or plaintext-returning wrapper. No migration command needs to contact a vault or inspect existing values.

## Non-goals

This package does not provide a broker, daemon, privileged helper, IPC protocol, custom authorization lease, OS-level sandbox, personal-identity manager, general-purpose 1Password CLI replacement, live vault administration, or a model-facing raw-secret reader.

## Install

Recommended as a global package:

```bash
pi install git:git@github.com:aefreedman/pi-onepassword.git
```

For local development:

```bash
pi install <path-to-pi-onepassword>
```

### Codecks external-helper configuration

Configure this only in a trusted launcher or user-level environment before starting Pi. `pi-codecks` owns provider selection and launches the adapter with the current Node executable and no arguments; do not put these values in a project, prompt, tool call, or model-visible configuration.

```bash
export CODECKS_CREDENTIAL_PROVIDER=external-helper
export CODECKS_CREDENTIAL_HELPER_MODULE=/absolute/path/to/node_modules/@aefree/pi-onepassword/extensions/integrations/codecks-credential-helper.mjs
export PI_ONEPASSWORD_OP_EXECUTABLE=/absolute/path/to/op
export PI_ONEPASSWORD_CODECKS_REFERENCE='op://vault/item/field'
export OP_SERVICE_ACCOUNT_TOKEN=…
```

The adapter accepts only its version-1 stdin request. It does not accept a manager executable, reference, service token, URL, request data, credential variable name, or child command through arguments or the request. It removes case-insensitive 1Password Connect/session/alternate service-account variables and ambient Codecks credential/provider variables before `op run`, then supplies the reference solely through its fixed child binding. One overall deadline begins before stdin is read; cancellation, input failure, overflow, malformed input, manager failure, stderr, or invalid output destroys stdin, terminates any active child tree, and fails closed with no response or diagnostic. It never falls back to ambient Codecks credentials.

This boundary narrows routine Codecks token exposure, but the token is necessarily returned to trusted `pi-codecks` memory to construct its HTTPS request. It is not isolation from the same OS user, trusted extensions, or a compromised host.

## Testing

```bash
npm test
npm run typecheck
npm run scan:sensitive
npm run pack:validate
npm run pack:smoke
npm run pack:dry-run
```

`pack:smoke` creates a tarball, installs it offline into a credential-free neutral temporary project, and imports the installed Bash extension, Codecks adapter, and trusted helpers through a fake local `op` process. It does not import a sibling Pi package or contact a network/account. `scan:sensitive` scans repository text and npm-installed packed bytes with bounded high-signal patterns; every match fails unless an exact inert file/value pair is allowlisted. It is evidence, not proof that secrets are impossible or absent.

### Live Codecks read-only authentication check

Run this repository-only check **outside a Pi/model session**, in a fresh PowerShell 7 shell. It launches the fixed sibling `pi-codecks` identity client through `op run`; it is not packed and has no child-path, URL, request, or credential-selection argument. It writes exactly one redacted JSON outcome. Do not use a direct `op read` command or print any supplied value.

```powershell
pwsh -NoProfile -File .\scripts\live-codecks-readonly-auth-check.ps1
```

The wrapper locates `op` and Node, reuses non-empty process-, user-, or machine-level values for `PI_ONEPASSWORD_CODECKS_ACCOUNT`, `PI_ONEPASSWORD_CODECKS_REFERENCE`, and `OP_SERVICE_ACCOUNT_TOKEN`, and prompts with masked input only for missing values. References copied with one matching outer pair of straight single or double quotes are normalized before validation and resolution. Use `-PromptForServiceAccountToken` to override a stale inherited service-account token without placing it in command history:

```powershell
pwsh -NoProfile -File .\scripts\live-codecks-readonly-auth-check.ps1 -PromptForServiceAccountToken
```

The wrapper suppresses vendor output and writes one redacted JSON report containing only fixed status values and exit codes. It verifies 1Password service-account authentication, non-disclosing reference injection, and the fixed Codecks identity operation. The account, reference, resolved Codecks token, service-account token, and executable paths are never printed. It temporarily removes conflicting 1Password Connect/session inputs, snapshots and restores every process-scope value it changes, and never mutates user- or machine-level environment settings.

### Behavioral-validation boundary

This package intentionally registers no model-facing secret-consuming tool, skill, prompt, or configuration subsystem: its only Pi registration is the Bash safety extension. Therefore provider-backed agent behavior is not a meaningful or available validation target. Deterministic tests instead enforce the code/tool contracts that exist: fixed operation-specific helpers, reference-only configuration, explicit service-account selection and fail-closed absence, redacted results, and Bash sanitization. A consumer package that registers a model-facing operation must validate its own agent behavior and confirmation policy.

All package tests use inert fakes. The authenticated-read test starts an in-process loopback-only fake service; it does not contact 1Password, an external network, or an account. Historical characterization records under `tests/` describe the pre-rebuild behavior only; they are not current configuration or security guidance.

## License

MIT. See `LICENSE`.
