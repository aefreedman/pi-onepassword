# Changelog

## 0.2.0 - 2026-08-11

### Added

- Trusted fixed-child `op run` helpers for integration-specific credential use. They require absolute executables, an explicit service-account token from a trusted launcher, a reference bound only through a designated child environment variable, and fixed child arguments and destination.
- Bounded timeout, cancellation, output-limit, and redacted-result handling for trusted 1Password operations.
- Deterministic Bash-extension, supported-surface, sensitive-content, packed-manifest, and credential-free packed-consumer validation.

### Changed

- Bash command text mentioning `op` or `op://...` is blocked as lexical defense in depth, while generic Bash child environments remove service-account, Connect, and session credentials case-insensitively on every platform.
- Public guidance now distinguishes references from plaintext, trusted integration helpers from model-facing tools, service-account grants from package checks, and trusted configuration from OS isolation.
