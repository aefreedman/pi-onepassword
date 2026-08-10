# Changelog

## Unreleased

### Changed

- Added `extensions/integrations/codecks-credential-helper.mjs`, a stable non-registered external Codecks credential-helper v1 adapter. It accepts one bounded non-secret request, reads only trusted `PI_ONEPASSWORD_OP_EXECUTABLE`, `PI_ONEPASSWORD_CODECKS_REFERENCE`, and `OP_SERVICE_ACCOUNT_TOKEN` configuration, and uses a fixed current-Node `op run` child. Its overall deadline starts before stdin reading; failure destroys stdin, terminates any active child tree, releases local handles, and uses an unref'd grace deadline to force a silent nonzero result if termination stalls. It strips conflicting 1Password and ambient Codecks credential variables, returns one credential only to the trusted protocol parent, and fails closed without diagnostics for malformed input, lifecycle failures, timeout, cancellation, stderr, or invalid output. Deterministic fake-manager coverage and packed smoke exercise the adapter without a network, account, or sibling package dependency.
- Added repository-only TypeScript and PowerShell live Codecks read-only authentication launchers with a fixed sibling child path, masked fallback prompts, safe reuse of existing environment configuration, normalization of copied secret references with matching outer quotes, process-scope restoration, redacted authentication/reference/consumer stages, and deterministic no-network wiring/non-disclosure coverage. They are excluded from the published tarball.
- Added deterministic supported-surface, real Bash-extension harness, packed-consumer, manifest, and bounded sensitive-content validation. The packed smoke installs a generated tarball offline in a neutral credential-free project and imports the installed Bash extension, Codecks adapter, and trusted helpers without sibling-package imports. Repository and npm-installed packed-package scans fail every high-signal match unless an exact inert file/value pair is allowlisted; bounded regex scanning remains evidence, not proof of secret absence. Tests enforce code/tool contracts because the package intentionally registers no model-facing secret-consuming operation, skill, prompt, or configuration subsystem; provider-backed agent behavior is therefore not available here.
- Removed the deleted ambient-identity `onepassword-read.ts` and `AGENT_OP_ALLOWED_VAULTS` authorization model; least-privilege service-account grants now define the maximum accessible 1Password scope.
- Simplified the Bash lexical guard to block command text mentioning `op` or `op://...`, rather than claiming to prove an invocation; removed obsolete `op-read-allowlist.sh` special handling and documented/tested both false-positive and runtime-construction-bypass limits.
- Rewrote public guidance to distinguish references from plaintext, trusted integration helpers from model-facing tools, server-enforced service-account grants from package checks, and trusted user-level configuration from OS isolation. The guidance now states that the reference and service-account token go only to the trusted 1Password invocation, which resolves the reference before the fixed child receives plaintext solely in its designated environment variable. Added credential-free, non-destructive integration-author migration guidance without claiming a drop-in configuration loader, raw-reader replacement, or model-facing migration endpoint.
- Replaced the ambient 1Password read helper with trusted, fixed-child `op run` contracts that require an explicit service-account token from a trusted launcher (not argv, history, or persisted project configuration) and absolute executables.
- Added bounded cancellation, timeout, output-limit, and non-secret error handling for trusted `op run` invocations.
- Made Bash credential sanitization case-insensitive across all platforms.
- Kept the deterministic loopback fake authenticated identity operation as repository-only Phase 3 test evidence; it is no longer packaged or a public runtime contract.
- Added the first real-consumer `pi-codecks` read-only authentication contract: `pi-onepassword` injects only the configured reference and trusted account metadata into a bounded child selected by trusted user-level configuration, strips ambient Codecks credential variables, maps only Codecks-owned redacted exit categories to public results, and reports missing service-account configuration as invalid configuration.

## 0.1.3 - 2026-07-24

### Changed

- Marked Pi-bundled core dependencies as optional peers so Pi git installs do not create redundant per-package `node_modules` directories.

## 0.1.2 - 2026-07-10

- Migrated Pi extension imports and peer dependencies to the `@earendil-works` package scope.

## 0.1.1 - 2026-07-09

- Added `PI_ONEPASSWORD_OP_EXECUTABLE` for explicit integrations to locate the 1Password CLI when it is not on `PATH`; an explicit helper option still takes precedence.
- Added a clear, secret-safe diagnostic when the configured 1Password CLI executable cannot be found.
- Strip service-account, Connect, and session credentials from Bash subprocess environments.
- Added macOS CI coverage for helper tests and package validation.
