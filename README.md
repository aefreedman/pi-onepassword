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
- `extensions/integrations/codecks-credential-helper.mjs` is the stable, non-registered Codecks external-credential-helper v1 adapter. It is launched directly by `pi-codecks`, not loaded as a Pi extension or model-facing tool. It validates one non-secret Codecks request, uses the fixed `op run -- <current Node child>` contract, and returns one credential only to trusted `pi-codecks` memory. It has no dependency on `pi-codecks` and provides no discovery, cache, refresh, lease, network client, or general secret-reader API.

The adapter path is stable package content, but a launcher must resolve it to an absolute installed path. Account-backed validation is optional and separately authorized; deterministic tests use inert fakes only.

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
npm run pack:composition
npm run pack:dry-run
```

`pack:smoke` keeps the normal package smoke independent of any sibling. `pack:composition` generates both package tarballs, installs only those tarballs into a neutral temporary project, and verifies that both installed package roots are real non-symlink paths inside that project. Its fixture imports the installed `pi-codecks` production external-provider exact-read path and installed adapter only; this repository's development `tsx` loader is an external test harness, not a consumer dependency. With inert fake `op` and injected fake fetch, it proves success and selected-helper failure without network, local sibling runtime imports, links, or credentials. `scan:sensitive` scans repository text and npm-installed packed bytes with bounded high-signal patterns; every match fails unless an exact inert file/value pair is allowlisted. It is evidence, not proof that secrets are impossible or absent.

### Optional live external-provider validation

Live execution remains **separately authorized**. When separately authorized, run this repository-only PowerShell 7 wrapper **outside a Pi/model session**:

```powershell
pwsh -NoProfile -File .\scripts\live-codecks-readonly-auth-check.ps1 -PromptForCodecksAccount -PromptForReference -PromptForServiceAccountToken
```

The retained filename is a migration aid; it now configures the normal `pi-codecks` external-provider path, not the retired fixed identity child. It derives this package's fixed `extensions/integrations/codecks-credential-helper.mjs` adapter and the fixed local sibling `pi-codecks` repository, then invokes only `npm run --silent validate:external-provider-live`. It reuses non-empty process-, user-, then machine-level `CODECKS_ACCOUNT`, `PI_ONEPASSWORD_CODECKS_REFERENCE`, and `OP_SERVICE_ACCOUNT_TOKEN` values, with masked prompts only for missing values. A matching outer straight quote pair is normalized from a copied reference. Use `-PromptForCodecksAccount`, `-PromptForReference`, and/or `-PromptForServiceAccountToken` to override stale inherited values without command history; the command above forces all three one-line masked prompts.

The wrapper sets and restores only process-scope configuration, strips conflicting 1Password Connect/session and ambient Codecks token/reference/provider variables case-insensitively, suppresses all child diagnostics, and emits exactly one redacted JSON object with `operation`, `status`, `category`, and `durationMs`. It accepts only the sibling launcher's fixed categories, including the pre-existing `authentication_rejected` category, rejects malformed or expanded child output, and clamps `durationMs` to `0..60000`; absent or invalid child output reports `invalid_configuration` with duration `0`. It preserves those categories unchanged, so an upstream identity-classification refinement requires no 1Password protocol or allowlist change. It never performs a preliminary `op` command, prints account/reference/token/path data, accepts model arguments, or changes user/machine environment settings. Missing local packages, adapter, configuration, or authentication fail closed.

### Launch a normal Pi Codecks session

The fixed identity validator can continue to report `authentication_rejected`; that category does not establish whether the token can make a normal Codecks read. To test the normal `pi-codecks` tool path (for example, `codecks_card_get`) in a **fresh interactive Pi process**, separately authorize the live test and run this trusted local source-checkout launcher from PowerShell 7:

```powershell
& 'C:\path\to\pi-onepassword\scripts\start-pi-codecks-external-helper.ps1'
```

It prompts once, with masked input, for the Codecks account slug, `op://` reference, and 1Password service-account token; a copied reference may have one matching outer straight quote pair. It resolves this checkout's fixed `extensions/integrations/codecks-credential-helper.mjs` adapter and the `op` and `pi` applications from the trusted local `PATH`, then starts `pi` with no arguments. The account, reference, and token are process-only child environment values, never Pi arguments, output, persisted configuration, or user/machine environment settings. It removes case-insensitive ambient direct Codecks, external-provider, 1Password Connect/session, and alternate service-token settings before launch, does not set `PI_CODECKS_ALLOW_LIVE_VALIDATION`, waits for Pi, returns Pi's exit code, and restores the invoking PowerShell process environment exactly.

This is intentionally a repository-only setup script, not a packed runtime asset: use the source checkout path above rather than an installed package path. It registers no tool or operation and does not perform a preliminary `op` command, network request, identity check, or validation acknowledgement. Once Pi is open, use the normal consumer tool under that consumer's own confirmation and authorization policy.

### Behavioral-validation boundary

This package intentionally registers no model-facing secret-consuming tool, skill, prompt, or configuration subsystem: its only Pi registration is the Bash safety extension. Therefore provider-backed agent behavior is not a meaningful or available validation target. Deterministic tests instead enforce the code/tool contracts that exist: fixed operation-specific helpers, reference-only configuration, explicit service-account selection and fail-closed absence, redacted results, and Bash sanitization. A consumer package that registers a model-facing operation must validate its own agent behavior and confirmation policy.

All package tests use inert fakes and do not contact 1Password, an external network, or an account. Historical characterization records under `tests/` describe the pre-rebuild behavior only; they are not current configuration or security guidance.

## License

MIT. See `LICENSE`.
