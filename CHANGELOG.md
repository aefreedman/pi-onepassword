# Changelog

## Unreleased

### Changed

- Replaced the ambient 1Password read helper with trusted, fixed-child `op run` contracts that require an explicit service-account token and absolute executables.
- Added bounded cancellation, timeout, output-limit, and non-secret error handling for trusted `op run` invocations.
- Made Bash credential sanitization case-insensitive across all platforms.
- Added a deterministic loopback fake authenticated identity check that exercises the trusted `op run` path and returns only bounded redacted outcome, status, and timing data.

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
