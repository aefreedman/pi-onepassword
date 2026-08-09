# Phase 0 Legacy Characterization

This is a credential-free baseline recorded before the least-privilege rebuild.

- Baseline package commit: `18a24f630f55b5fbbe5c5569651bedcd0b92df84` (`18a24f6 Release v0.1.3`).
- Package: `@aefree/pi-onepassword` version `0.1.3`; observed Pi CLI: `0.84.1`.
- Active extension from `package.json`: `./extensions/bash-op-guard.ts`.
- Validation command: `npm test`, which runs `tests/bash-op-guard-validation.ts` and `tests/onepassword-read-validation.ts`.
- Baseline `npm pack --dry-run` inventory had 11 files: `CHANGELOG.md`, `LICENSE`, `README.md`, `package.json`, `extensions/bash-op-guard.ts`, all four `extensions/shared/*.ts` files, and both validation tests.

## README claims at baseline

The README says the generic Bash tool blocks raw `op` / `op://...` use, strips service-account, Connect, and session credentials from Bash child environments, and directs integrations to the shared allow-listed read helper. It also states that the helper defaults to `op` from `PATH`, can use `PI_ONEPASSWORD_OP_EXECUTABLE` or an explicit executable override, and is not a general-purpose model-facing secret-reading tool.

## Reproducible legacy behavior

The validation tests use only inert strings and injected `execFile` fakes; they never execute `op` or contact a service.

- Textual command filtering can be bypassed by shell runtime construction: `printf '\157\160 whoami' | sh` is not detected even though it evaluates to `op whoami`.
- Credential-name matching is case-sensitive; mixed-case `Op_Service_Account_Token`, `op_connect_token`, and `op_session_personal` remain after sanitization. This is a Windows environment-name casing gap.
- `readOnePasswordRef` defaults to the bare `op` executable, passes its supplied environment unchanged (including service-account, Connect, and session credentials), supplies only `read <reference>` arguments, and returns captured stdout as trimmed plaintext.
