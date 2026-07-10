# Changelog

## 0.1.2 - 2026-07-10

- Migrated Pi extension imports and peer dependencies to the `@earendil-works` package scope.

## 0.1.1 - 2026-07-09

- Added `PI_ONEPASSWORD_OP_EXECUTABLE` for explicit integrations to locate the 1Password CLI when it is not on `PATH`; an explicit helper option still takes precedence.
- Added a clear, secret-safe diagnostic when the configured 1Password CLI executable cannot be found.
- Strip service-account, Connect, and session credentials from Bash subprocess environments.
- Added macOS CI coverage for helper tests and package validation.
