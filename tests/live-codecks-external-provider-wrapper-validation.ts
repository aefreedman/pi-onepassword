import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrapperPath = path.join(repositoryRoot, "scripts", "live-codecks-readonly-auth-check.ps1");
const source = readFileSync(wrapperPath, "utf8");
const pwsh = process.env.PWSH_PATH ?? "pwsh";
const isWindows = process.platform === "win32";
const commandExtension = isWindows ? ".cmd" : "";
const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pi-onepassword-wrapper-validation-"));
const binDir = path.join(tempRoot, "bin");
const auditPath = path.join(tempRoot, "npm-environment.txt");
const argsPath = path.join(tempRoot, "npm-arguments.txt");
const fakeOp = path.join(binDir, `op${commandExtension}`);
const fakeNpm = path.join(binDir, `npm${commandExtension}`);

function quotePowerShell(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function cleanEnvironment(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (/^(?:OP_|PI_ONEPASSWORD_|CODECKS_|PI_CODECKS_)/i.test(key) || key === "FAKE_AUDIT" || key === "FAKE_ARGS" || key === "FAKE_NPM_MODE") delete environment[key];
  }
  environment.PATH = `${binDir}${path.delimiter}${process.env.PATH ?? ""}`;
  return { ...environment, FAKE_AUDIT: auditPath, FAKE_ARGS: argsPath, ...overrides };
}

function runPowerShell(args: readonly string[], env: NodeJS.ProcessEnv) {
  const result = spawnSync(pwsh, ["-NoProfile", ...args], { encoding: "utf8", env, windowsHide: true });
  if (result.error) throw result.error;
  return result;
}

function setProcessEnvironmentCommand(values: Record<string, string>): string {
  return Object.entries(values)
    .map(([name, value]) => `Set-Item -LiteralPath ${quotePowerShell(`Env:${name}`)} -Value ${quotePowerShell(value)}`)
    .join("; ");
}

function mockedReadHostCommand(values: readonly string[]): string {
  return [
    "$global:mockedPromptValues = [System.Collections.Generic.Queue[string]]::new()",
    ...values.map((value) => `[void]$global:mockedPromptValues.Enqueue(${quotePowerShell(value)})`),
    "function global:Read-Host { param([string]$Prompt, [switch]$MaskInput); if (-not $MaskInput) { throw 'Expected masked prompt.' }; return $global:mockedPromptValues.Dequeue() }",
  ].join("; ");
}

function runWrapper(values: Record<string, string>, mode = "success", flags: readonly string[] = [], mockedReadHostValues?: readonly string[]) {
  const prefix = mockedReadHostValues === undefined ? "" : `${mockedReadHostCommand(mockedReadHostValues)}; `;
  const command = `${setProcessEnvironmentCommand(values)}; ${prefix}& ${quotePowerShell(wrapperPath)} ${flags.join(" ")}; exit $LASTEXITCODE`;
  return runPowerShell(["-Command", command], cleanEnvironment(mode === "success" ? {} : { FAKE_NPM_MODE: mode }));
}

function parseSingleReport(result: ReturnType<typeof runPowerShell>) {
  assert.equal(result.stderr, "", `wrapper must suppress diagnostics: ${result.stderr}`);
  const lines = result.stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 1, "wrapper must emit exactly one JSON line");
  const report = JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(report), ["operation", "status", "category", "durationMs"]);
  assert.equal(report.operation, "codecks-external-provider-live-validation");
  assert.equal(typeof report.status, "string");
  assert.equal(typeof report.category, "string");
  assert.equal(typeof report.durationMs, "number");
  assert.ok(report.durationMs >= 0 && report.durationMs <= 60_000, "duration must be publicly bounded");
  assert.equal(JSON.stringify(report).includes("inert-"), false, "report must be redacted");
  assert.equal(JSON.stringify(report).includes("op://"), false, "report must not expose a reference");
  assert.equal(JSON.stringify(report).includes("sentinel"), false, "report must not expose child diagnostics");
  return report;
}

function capturedEnvironment(): Map<string, string> {
  const output = readFileSync(auditPath, "utf8");
  const entries = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    const delimiter = line.indexOf("=");
    if (delimiter > 0) entries.set(line.slice(0, delimiter), line.slice(delimiter + 1));
  }
  return entries;
}

function valuesNamed(environment: Map<string, string>, name: string): Array<[string, string]> {
  return [...environment].filter(([key]) => key.toUpperCase() === name.toUpperCase());
}

try {
  mkdirSync(binDir, { recursive: true });
  if (isWindows) {
    writeFileSync(fakeOp, "@echo off\r\nexit /b 0\r\n");
    writeFileSync(fakeNpm, "@echo off\r\nset > \"%FAKE_AUDIT%\"\r\n( echo %* ) > \"%FAKE_ARGS%\"\r\nif \"%~1\" NEQ \"run\" exit /b 97\r\nif \"%FAKE_NPM_MODE%\"==\"unavailable\" goto unavailable\r\nif \"%FAKE_NPM_MODE%\"==\"none\" exit /b 23\r\nif \"%FAKE_NPM_MODE%\"==\"malformed\" goto malformed\r\nif \"%FAKE_NPM_MODE%\"==\"extra\" goto extra\r\necho {\"status\":\"authenticated\",\"category\":\"authenticated\",\"durationMs\":47}\r\nexit /b 0\r\n:unavailable\r\necho {\"status\":\"not_authenticated\",\"category\":\"unavailable\",\"durationMs\":120000}\r\necho sentinel-vendor-diagnostic 1>&2\r\nexit /b 23\r\n:malformed\r\necho {\"status\":\"not_authenticated\"\r\nexit /b 23\r\n:extra\r\necho {\"status\":\"not_authenticated\",\"category\":\"unavailable\",\"durationMs\":1,\"unexpected\":\"sentinel\"}\r\nexit /b 23\r\n");
  } else {
    writeFileSync(fakeOp, "#!/bin/sh\nexit 0\n");
    writeFileSync(fakeNpm, "#!/bin/sh\nenv > \"$FAKE_AUDIT\"\nprintf '%s\\n' \"$@\" > \"$FAKE_ARGS\"\n[ \"$1\" = run ] || exit 97\ncase \"${FAKE_NPM_MODE:-success}\" in\n  unavailable) printf '%s\\n' '{\"status\":\"not_authenticated\",\"category\":\"unavailable\",\"durationMs\":120000}'; printf '%s\\n' 'sentinel-vendor-diagnostic' >&2; exit 23 ;;\n  none) exit 23 ;;\n  malformed) printf '%s\\n' '{\"status\":\"not_authenticated\"'; exit 23 ;;\n  extra) printf '%s\\n' '{\"status\":\"not_authenticated\",\"category\":\"unavailable\",\"durationMs\":1,\"unexpected\":\"sentinel\"}'; exit 23 ;;\nesac\nprintf '%s\\n' '{\"status\":\"authenticated\",\"category\":\"authenticated\",\"durationMs\":47}'\n");
    chmodSync(fakeOp, 0o755);
    chmodSync(fakeNpm, 0o755);
  }

  // Parse without running first, then exercise the real CLI surface in an
  // isolated child PowerShell. All three configuration values are supplied in
  // its process environment, so this test never falls through to user/machine scopes.
  const parse = runPowerShell(["-Command", `[scriptblock]::Create([IO.File]::ReadAllText(${quotePowerShell(wrapperPath)})) | Out-Null`], cleanEnvironment({}));
  assert.equal(parse.status, 0, `PowerShell parser rejected wrapper: ${parse.stderr}`);

  const selectedInput: Record<string, string> = {
    CODECKS_ACCOUNT: "inert-wrapper-account",
    PI_ONEPASSWORD_CODECKS_REFERENCE: '  "op://Inert Vault/codecks/token"  ',
    CODECKS_CREDENTIAL_PROVIDER: "ambient-provider",
    CODECKS_CREDENTIAL_HELPER_MODULE: "ambient-helper",
    PI_CODECKS_ALLOW_LIVE_VALIDATION: "ambient-live",
    cOdEcKs_ApI_tOkEn: "inert-ambient-api-token",
    oP_cOnNeCt_Token: "inert-connect-token",
    oP_sEsSiOn_Work: "inert-session-token",
  };
  selectedInput["OP_" + "SERVICE_ACCOUNT_TOKEN"] = "inert-wrapper-service-account";
  // Windows has one logical spelling per process key. POSIX accepts these as
  // independent inherited keys and must restore each exact spelling.
  if (!isWindows) Object.assign(selectedInput, {
    codecks_credential_provider: "ambient-provider-lower",
    codecks_credential_helper_module: "ambient-helper-lower",
    pi_onepassword_codecks_reference: "ambient-lower-reference",
    op_service_account_token: "ambient-lower-service-account",
  });
  const success = runWrapper(selectedInput);
  assert.equal(success.status, 0, `wrapper authentication path failed: ${success.stdout}\n${success.stderr}`);
  assert.deepEqual(parseSingleReport(success), {
    operation: "codecks-external-provider-live-validation",
    status: "authenticated",
    category: "authenticated",
    durationMs: 47,
  });
  assert.deepEqual(readFileSync(argsPath, "utf8").trim().split(/\r?\n|\s+/).filter(Boolean), ["run", "--silent", "validate:external-provider-live"]);

  const duringRun = capturedEnvironment();
  assert.deepEqual(valuesNamed(duringRun, "CODECKS_CREDENTIAL_PROVIDER"), [["CODECKS_CREDENTIAL_PROVIDER", "external-helper"]]);
  assert.deepEqual(valuesNamed(duringRun, "CODECKS_CREDENTIAL_HELPER_MODULE"), [["CODECKS_CREDENTIAL_HELPER_MODULE", path.join(repositoryRoot, "extensions", "integrations", "codecks-credential-helper.mjs")]]);
  assert.deepEqual(valuesNamed(duringRun, "PI_CODECKS_ALLOW_LIVE_VALIDATION"), [["PI_CODECKS_ALLOW_LIVE_VALIDATION", "1"]]);
  assert.deepEqual(valuesNamed(duringRun, "CODECKS_ACCOUNT"), [["CODECKS_ACCOUNT", "inert-wrapper-account"]]);
  assert.deepEqual(valuesNamed(duringRun, "PI_ONEPASSWORD_OP_EXECUTABLE"), [["PI_ONEPASSWORD_OP_EXECUTABLE", fakeOp]]);
  assert.deepEqual(valuesNamed(duringRun, "PI_ONEPASSWORD_CODECKS_REFERENCE"), [["PI_ONEPASSWORD_CODECKS_REFERENCE", "op://Inert Vault/codecks/token"]]);
  assert.deepEqual(valuesNamed(duringRun, "OP_SERVICE_ACCOUNT_TOKEN"), [["OP_SERVICE_ACCOUNT_TOKEN", "inert-wrapper-service-account"]]);
  for (const key of duringRun.keys()) {
    assert.equal(/^(?:OP_(?:CONNECT|SESSION)(?:_|$)|CODECKS_(?:TOKEN|API_TOKEN|TOKEN_REF|TOKEN_OP_REF)$|CODECKS_CREDENTIAL_(?:PROVIDER|HELPER_MODULE)$|PI_ONEPASSWORD_CODECKS_REFERENCE)$/i.test(key) && !["CODECKS_CREDENTIAL_PROVIDER", "CODECKS_CREDENTIAL_HELPER_MODULE", "PI_ONEPASSWORD_CODECKS_REFERENCE", "OP_SERVICE_ACCOUNT_TOKEN"].includes(key), false, `mixed-case ambient value leaked to npm: ${key}`);
  }

  // Exercise the executable entrypoint with inherited values present. The
  // narrow masked Read-Host mock proves each force flag wins without a real
  // interactive prompt or credential.
  const forced = runWrapper(
    selectedInput,
    "success",
    ["-PromptForCodecksAccount", "-PromptForReference", "-PromptForServiceAccountToken"],
    ["inert-prompt-account", '  "op://Inert Prompt Vault/codecks/token"  ', "inert-prompt-service-account"],
  );
  assert.equal(forced.status, 0, `forced prompt path failed: ${forced.stdout}\n${forced.stderr}`);
  assert.deepEqual(parseSingleReport(forced), {
    operation: "codecks-external-provider-live-validation",
    status: "authenticated",
    category: "authenticated",
    durationMs: 47,
  });
  const forcedDuringRun = capturedEnvironment();
  assert.deepEqual(valuesNamed(forcedDuringRun, "CODECKS_ACCOUNT"), [["CODECKS_ACCOUNT", "inert-prompt-account"]]);
  assert.deepEqual(valuesNamed(forcedDuringRun, "PI_ONEPASSWORD_CODECKS_REFERENCE"), [["PI_ONEPASSWORD_CODECKS_REFERENCE", "op://Inert Prompt Vault/codecks/token"]]);
  assert.deepEqual(valuesNamed(forcedDuringRun, "OP_SERVICE_ACCOUNT_TOKEN"), [["OP_SERVICE_ACCOUNT_TOKEN", "inert-prompt-service-account"]]);

  const unavailable = runWrapper(selectedInput, "unavailable");
  assert.equal(unavailable.status, 1, "nonzero child validation must map to wrapper failure");
  assert.deepEqual(parseSingleReport(unavailable), {
    operation: "codecks-external-provider-live-validation",
    status: "not_authenticated",
    category: "unavailable",
    durationMs: 60_000,
  });

  for (const mode of ["none", "malformed", "extra"]) {
    const failed = runWrapper(selectedInput, mode);
    assert.equal(failed.status, 1, `${mode} child output must map to wrapper failure`);
    assert.deepEqual(parseSingleReport(failed), {
      operation: "codecks-external-provider-live-validation",
      status: "not_authenticated",
      category: "invalid_configuration",
      durationMs: 0,
    });
  }

  // Dot-sourcing exposes only the narrow wrapper function to this in-process
  // child harness, allowing restoration to be observed after its finally block.
  const restorationInput: Record<string, string> = { ...selectedInput, PI_ONEPASSWORD_CODECKS_REFERENCE: "op://Inert Vault/codecks/token" };
  // Do not query two spellings of one Windows environment key: the ordered
  // PowerShell dictionary is case-insensitive there. POSIX queries every
  // exact spelling independently.
  const restoredNames = [
    "CODECKS_ACCOUNT",
    "CODECKS_CREDENTIAL_PROVIDER",
    "CODECKS_CREDENTIAL_HELPER_MODULE",
    "PI_CODECKS_ALLOW_LIVE_VALIDATION",
    "PI_ONEPASSWORD_CODECKS_REFERENCE",
    "OP_SERVICE_ACCOUNT_TOKEN",
    "cOdEcKs_ApI_tOkEn",
    "oP_cOnNeCt_Token",
    "oP_sEsSiOn_Work",
    "CODECKS_TOKEN",
    "CODECKS_TOKEN_REF",
    "OP_CONNECT_TOKEN_REF",
    ...(!isWindows ? [
      "codecks_credential_provider",
      "codecks_credential_helper_module",
      "pi_onepassword_codecks_reference",
      "op_service_account_token",
    ] : []),
  ];
  const restorationCommand = [
    `. ${quotePowerShell(wrapperPath)}`,
    "$result = Invoke-CodecksExternalProviderLiveValidation",
    `$names = @(${restoredNames.map(quotePowerShell).join(", ")})`,
    "$restored = [ordered]@{}; foreach ($name in $names) { $entry = Get-Item -LiteralPath \"Env:$name\" -ErrorAction SilentlyContinue; $restored[$name] = if ($null -eq $entry) { $null } else { [string]$entry.Value } }",
    "[Console]::Out.WriteLine(([pscustomobject]@{ exitCode = $result.exitCode; status = $result.report.status; restored = $restored } | ConvertTo-Json -Compress -Depth 3))",
    "exit $result.exitCode",
  ].join("; ");
  const restoration = runPowerShell(["-Command", restorationCommand], cleanEnvironment(restorationInput));
  assert.equal(restoration.status, 0, `in-process restoration harness failed: ${restoration.stderr}`);
  assert.equal(restoration.stderr, "");
  const restored = JSON.parse(restoration.stdout.trim());
  assert.equal(restored.exitCode, 0);
  assert.equal(restored.status, "authenticated");
  assert.equal(typeof restored.restored, "object");
  const restoredValues = restored.restored as Record<string, string | null>;
  for (const name of restoredNames.filter((name) => name in restorationInput)) {
    assert.equal(restoredValues[name], restorationInput[name], `finally must restore ${name} exactly`);
  }
  for (const name of restoredNames.filter((name) => !(name in restorationInput))) {
    assert.equal(restoredValues[name], null, `finally must keep initially absent ${name} absent`);
  }
  // On POSIX the wrapper snapshots exact case variants independently; the
  // ordinal dictionary is structural evidence for that behavior, while this
  // Windows child harness verifies the wrapper's finally path is reachable.
  assert.match(source, /Dictionary\[string, object\]\]::new\(\[System\.StringComparer\]::Ordinal\)/);
  assert.match(source, /function Invoke-CodecksExternalProviderLiveValidation/);
  for (const flag of ["PromptForCodecksAccount", "PromptForReference", "PromptForServiceAccountToken"]) {
    assert.match(source, new RegExp(`\\[switch\\]\\$${flag}`), `${flag} must be accepted by the wrapper`);
    assert.match(source, new RegExp(`-${flag}:\\$${flag}`), `${flag} must reach the direct entrypoint invocation`);
  }
  assert.match(source, /Join-Path \$repositoryRoot 'extensions\/integrations\/codecks-credential-helper\.mjs'/);
  assert.match(source, /npm run --silent validate:external-provider-live/);
  assert.doesNotMatch(source, /SetEnvironmentVariable\([^\n]+(?:User|Machine)/);
  assert.doesNotMatch(source, /& \$opExecutable\s+(?:whoami|read)\b|PI_CODECKS_READONLY_AUTH|live:codecks-readonly-auth|codecks-readonly-auth-client/i);
  console.log("PASS: external-provider live wrapper child-process validation succeeded");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
