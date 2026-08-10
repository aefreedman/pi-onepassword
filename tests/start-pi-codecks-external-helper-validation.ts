import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const launcherPath = path.join(repositoryRoot, "scripts", "start-pi-codecks-external-helper.ps1");
const source = readFileSync(launcherPath, "utf8");
const pwsh = process.env.PWSH_PATH ?? "pwsh";
const isWindows = process.platform === "win32";
const commandExtension = isWindows ? ".cmd" : "";
const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pi-onepassword-pi-launcher-validation-"));
const binDir = path.join(tempRoot, "bin");
const auditPath = path.join(tempRoot, "pi-environment.txt");
const argsPath = path.join(tempRoot, "pi-arguments.txt");
const fakeOp = path.join(binDir, `op${commandExtension}`);
const fakePi = path.join(binDir, `pi${commandExtension}`);

function quotePowerShell(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function cleanEnvironment(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (/^(?:OP_|PI_ONEPASSWORD_|CODECKS_|PI_CODECKS_)/i.test(key) || ["FAKE_AUDIT", "FAKE_ARGS", "FAKE_PI_EXIT"].includes(key)) delete environment[key];
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

function launch(values: Record<string, string>, prompts: readonly string[], exitCode = 0) {
  const command = `${setProcessEnvironmentCommand(values)}; ${mockedReadHostCommand(prompts)}; & ${quotePowerShell(launcherPath)}; exit $LASTEXITCODE`;
  return runPowerShell(["-Command", command], cleanEnvironment({ FAKE_PI_EXIT: String(exitCode) }));
}

function capturedEnvironment(): Map<string, string> {
  const entries = new Map<string, string>();
  for (const line of readFileSync(auditPath, "utf8").split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator > 0) entries.set(line.slice(0, separator), line.slice(separator + 1));
  }
  return entries;
}

function valuesNamed(environment: Map<string, string>, name: string): Array<[string, string]> {
  return [...environment].filter(([key]) => key.toUpperCase() === name.toUpperCase());
}

const selectedBindingNames = [
  "CODECKS_ACCOUNT",
  "CODECKS_CREDENTIAL_PROVIDER",
  "CODECKS_CREDENTIAL_HELPER_MODULE",
  "PI_ONEPASSWORD_OP_EXECUTABLE",
  "PI_ONEPASSWORD_CODECKS_REFERENCE",
  "OP_SERVICE_ACCOUNT_TOKEN",
] as const;

/**
 * A deterministic Windows logical-environment model for the launcher's
 * snapshot/restore algorithm. It lets non-Windows CI cover case-insensitive
 * aliases while the real launcher test below covers the native provider.
 */
function restoreWindowsLogicalEnvironment(initial: Record<string, string>): Map<string, { name: string; value: string }> {
  const environment = new Map<string, { name: string; value: string }>();
  const previous = new Map<string, { name: string; value: string | null }>();
  const changed: string[] = [];
  const keyFor = (name: string) => name.toUpperCase();
  for (const [name, value] of Object.entries(initial)) environment.set(keyFor(name), { name, value });
  const remember = (name: string) => {
    const key = keyFor(name);
    if (!previous.has(key)) {
      const entry = environment.get(key);
      previous.set(key, { name: entry?.name ?? name, value: entry?.value ?? null });
      changed.push(key);
    }
  };
  for (const name of selectedBindingNames) remember(environment.get(keyFor(name))?.name ?? name);
  for (const entry of [...environment.values()]) {
    if (/^(?:OP_(?:CONNECT|SESSION)(?:_|$)|OP_SERVICE_ACCOUNT_TOKEN(?:_|$)|CODECKS_|PI_ONEPASSWORD_(?:CODECKS_REFERENCE|OP_EXECUTABLE)$|PI_CODECKS_ALLOW_LIVE_VALIDATION$)/i.test(entry.name)) {
      remember(entry.name);
      environment.delete(keyFor(entry.name));
    }
  }
  for (const name of selectedBindingNames) {
    for (const entry of [...environment.values()]) {
      if (keyFor(entry.name) === keyFor(name)) {
        remember(entry.name);
        environment.delete(keyFor(entry.name));
      }
    }
    remember(name);
    environment.set(keyFor(name), { name, value: "launcher-value" });
  }
  for (const key of changed) {
    const entry = previous.get(key)!;
    if (entry.value === null) environment.delete(key);
    else environment.set(key, { name: entry.name, value: entry.value });
  }
  return environment;
}

function restoreInPlace(values: Record<string, string>, names: readonly string[], prompts: readonly string[]) {
  const command = [
    setProcessEnvironmentCommand(values),
    mockedReadHostCommand(prompts),
    `. ${quotePowerShell(launcherPath)}`,
    "$exitCode = Start-PiCodecksExternalHelper",
    `$names = @(${names.map(quotePowerShell).join(", ")})`,
    "$processEntries = [Environment]::GetEnvironmentVariables([EnvironmentVariableTarget]::Process); $restored = [ordered]@{}; $nativeAbsent = [ordered]@{}; foreach ($name in $names) { $matchingKey = @($processEntries.Keys | Where-Object { [string]::Equals([string]$_, $name, [StringComparison]::OrdinalIgnoreCase) } | Select-Object -First 1); $restored[$name] = if ($matchingKey.Count -eq 0) { $null } else { [string]$processEntries[$matchingKey[0]] }; if ($IsWindows) { & $env:ComSpec /d /c \"if defined $name (exit /b 1) else (exit /b 0)\"; $nativeAbsent[$name] = $LASTEXITCODE -eq 0 } }",
    "[Console]::Out.WriteLine(([pscustomobject]@{ exitCode = $exitCode; restored = $restored; nativeAbsent = $nativeAbsent } | ConvertTo-Json -Compress -Depth 3))",
    "exit $exitCode",
  ].join("; ");
  const result = runPowerShell(["-Command", command], cleanEnvironment());
  assert.equal(result.status, 0, `restoration harness failed: ${result.stderr}`);
  return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)!) as { exitCode: number; restored: Record<string, string | null>; nativeAbsent: Record<string, boolean> };
}

try {
  mkdirSync(binDir, { recursive: true });
  if (isWindows) {
    writeFileSync(fakeOp, "@echo off\r\nexit /b 0\r\n");
    writeFileSync(fakePi, "@echo off\r\nset > \"%FAKE_AUDIT%\"\r\n( echo %* ) > \"%FAKE_ARGS%\"\r\necho fake Pi started\r\nexit /b %FAKE_PI_EXIT%\r\n");
  } else {
    writeFileSync(fakeOp, "#!/bin/sh\nexit 0\n");
    writeFileSync(fakePi, "#!/bin/sh\nenv > \"$FAKE_AUDIT\"\nprintf '%s\\n' \"$@\" > \"$FAKE_ARGS\"\nprintf '%s\\n' 'fake Pi started'\nexit \"${FAKE_PI_EXIT:-0}\"\n");
    chmodSync(fakeOp, 0o755);
    chmodSync(fakePi, 0o755);
  }

  const parse = runPowerShell(["-Command", `[scriptblock]::Create([IO.File]::ReadAllText(${quotePowerShell(launcherPath)})) | Out-Null`], cleanEnvironment());
  assert.equal(parse.status, 0, `PowerShell parser rejected launcher: ${parse.stderr}`);

  const promptAccount = "inert-launcher-account";
  const copiedReference = '  "op://Inert Vault/codecks/token"  ';
  const normalizedReference = "op://Inert Vault/codecks/token";
  const serviceAccount = "inert-launcher-service-account";
  const initial: Record<string, string> = {
    CODECKS_ACCOUNT: "ambient-account",
    CODECKS_CREDENTIAL_PROVIDER: "ambient-provider",
    CODECKS_CREDENTIAL_HELPER_MODULE: "ambient-helper",
    CODECKS_TOKEN: "inert-direct-token",
    cOdEcKs_ApI_tOkEn: "inert-api-token",
    CODECKS_PROFILE_WORK_TOKEN_REF: "op://ambient/profile/token",
    PI_ONEPASSWORD_CODECKS_REFERENCE: "op://ambient/reference/token",
    PI_ONEPASSWORD_OP_EXECUTABLE: "ambient-op",
    PI_CODECKS_ALLOW_LIVE_VALIDATION: "1",
    OP_SERVICE_ACCOUNT_TOKEN_OLD: "inert-old-service-token",
    oP_cOnNeCt_Token: "inert-connect-token",
    oP_sEsSiOn_Work: "inert-session-token",
  };
  initial["OP_" + "SERVICE_ACCOUNT_TOKEN"] = "inert-ambient-service-account";
  if (!isWindows) Object.assign(initial, {
    codecks_account: "ambient-lower-account",
    codecks_credential_provider: "ambient-lower-provider",
    codecks_credential_helper_module: "ambient-lower-helper",
    pi_onepassword_codecks_reference: "op://ambient/lower/reference",
    op_service_account_token: "inert-lower-service-account",
  });

  const success = launch(initial, [promptAccount, copiedReference, serviceAccount]);
  assert.equal(success.status, 0, `launcher must return Pi's successful exit code: ${success.stderr}`);
  assert.equal(success.stderr, "", "launcher must not write diagnostics to stderr");
  assert.match(success.stdout, /^fake Pi started\r?\n$/, "launcher must inherit Pi terminal output only");
  for (const value of [promptAccount, copiedReference, normalizedReference, serviceAccount]) {
    assert.equal(success.stdout.includes(value), false, "launcher output must not expose prompted configuration");
    assert.equal(success.stderr.includes(value), false, "launcher diagnostics must not expose prompted configuration");
  }
  assert.ok(["", "ECHO is off."].includes(readFileSync(argsPath, "utf8").trim()), "Pi must receive no launcher/model arguments");

  const duringRun = capturedEnvironment();
  assert.deepEqual(valuesNamed(duringRun, "CODECKS_ACCOUNT"), [["CODECKS_ACCOUNT", promptAccount]]);
  assert.deepEqual(valuesNamed(duringRun, "CODECKS_CREDENTIAL_PROVIDER"), [["CODECKS_CREDENTIAL_PROVIDER", "external-helper"]]);
  assert.deepEqual(valuesNamed(duringRun, "CODECKS_CREDENTIAL_HELPER_MODULE"), [["CODECKS_CREDENTIAL_HELPER_MODULE", path.join(repositoryRoot, "extensions", "integrations", "codecks-credential-helper.mjs")]]);
  assert.deepEqual(valuesNamed(duringRun, "PI_ONEPASSWORD_OP_EXECUTABLE"), [["PI_ONEPASSWORD_OP_EXECUTABLE", fakeOp]]);
  assert.deepEqual(valuesNamed(duringRun, "PI_ONEPASSWORD_CODECKS_REFERENCE"), [["PI_ONEPASSWORD_CODECKS_REFERENCE", normalizedReference]]);
  assert.deepEqual(valuesNamed(duringRun, "OP_SERVICE_ACCOUNT_TOKEN"), [["OP_SERVICE_ACCOUNT_TOKEN", serviceAccount]]);
  assert.equal(valuesNamed(duringRun, "PI_CODECKS_ALLOW_LIVE_VALIDATION").length, 0, "normal Pi launch must not inherit a live-validation acknowledgement");
  const allowedCodecksNames = ["CODECKS_ACCOUNT", "CODECKS_CREDENTIAL_PROVIDER", "CODECKS_CREDENTIAL_HELPER_MODULE"];
  for (const key of duringRun.keys()) {
    if (/^CODECKS_/i.test(key)) assert.equal(allowedCodecksNames.includes(key), true, `ambient Codecks configuration leaked to Pi: ${key}`);
    assert.equal(/^(?:OP_(?:CONNECT|SESSION)(?:_|$)|OP_SERVICE_ACCOUNT_TOKEN(?:_|$)|CODECKS_(?:TOKEN|API_TOKEN|TOKEN_REF|TOKEN_OP_REF)$|CODECKS_PROFILE_[A-Z0-9_]+_(?:TOKEN|API_TOKEN|TOKEN_REF|TOKEN_OP_REF)$|CODECKS_CREDENTIAL_(?:PROVIDER|HELPER_MODULE)$|PI_ONEPASSWORD_(?:CODECKS_REFERENCE|OP_EXECUTABLE)$|PI_CODECKS_ALLOW_LIVE_VALIDATION$)/i.test(key) && !["CODECKS_CREDENTIAL_PROVIDER", "CODECKS_CREDENTIAL_HELPER_MODULE", "PI_ONEPASSWORD_OP_EXECUTABLE", "PI_ONEPASSWORD_CODECKS_REFERENCE", "OP_SERVICE_ACCOUNT_TOKEN"].includes(key), false, `conflicting environment leaked to Pi: ${key}`);
  }
  assert.equal(readFileSync(argsPath, "utf8").includes(serviceAccount), false, "Pi argv must not contain the service token");
  assert.equal(readFileSync(argsPath, "utf8").includes(normalizedReference), false, "Pi argv must not contain the reference");

  const singleQuoted = launch(initial, [promptAccount, "  'op://Inert Single Quote/codecks/token'  ", serviceAccount]);
  assert.equal(singleQuoted.status, 0, "one matching outer single-quote pair must normalize");
  assert.deepEqual(valuesNamed(capturedEnvironment(), "PI_ONEPASSWORD_CODECKS_REFERENCE"), [["PI_ONEPASSWORD_CODECKS_REFERENCE", "op://Inert Single Quote/codecks/token"]]);

  const nonzero = launch(initial, [promptAccount, copiedReference, serviceAccount], 37);
  assert.equal(nonzero.status, 37, "launcher must propagate Pi's exit code");

  const restorationNames = [
    "CODECKS_ACCOUNT", "CODECKS_CREDENTIAL_PROVIDER", "CODECKS_CREDENTIAL_HELPER_MODULE", "CODECKS_TOKEN", "cOdEcKs_ApI_tOkEn", "CODECKS_PROFILE_WORK_TOKEN_REF",
    "PI_ONEPASSWORD_CODECKS_REFERENCE", "PI_ONEPASSWORD_OP_EXECUTABLE", "PI_CODECKS_ALLOW_LIVE_VALIDATION", "OP_SERVICE_ACCOUNT_TOKEN", "OP_SERVICE_ACCOUNT_TOKEN_OLD", "oP_cOnNeCt_Token", "oP_sEsSiOn_Work",
    ...(!isWindows ? ["codecks_account", "codecks_credential_provider", "codecks_credential_helper_module", "pi_onepassword_codecks_reference", "op_service_account_token"] : []),
  ];
  const restorationCommand = [
    `${setProcessEnvironmentCommand(initial)}`,
    mockedReadHostCommand([promptAccount, copiedReference, serviceAccount]),
    `. ${quotePowerShell(launcherPath)}`,
    "$exitCode = Start-PiCodecksExternalHelper",
    `$names = @(${restorationNames.map(quotePowerShell).join(", ")})`,
    "$processEntries = [Environment]::GetEnvironmentVariables([EnvironmentVariableTarget]::Process); $restored = [ordered]@{}; foreach ($name in $names) { $restored[$name] = if ($processEntries.Contains($name)) { [Environment]::GetEnvironmentVariable($name, [EnvironmentVariableTarget]::Process) } else { $null } }",
    "[Console]::Out.WriteLine(([pscustomobject]@{ exitCode = $exitCode; restored = $restored } | ConvertTo-Json -Compress -Depth 3))",
    "exit $exitCode",
  ].join("; ");
  const restoration = runPowerShell(["-Command", restorationCommand], cleanEnvironment());
  assert.equal(restoration.status, 0, `restoration harness failed: ${restoration.stderr}`);
  const restored = JSON.parse(restoration.stdout.trim().split(/\r?\n/).at(-1)!);
  assert.equal(restored.exitCode, 0);
  const restoredValues = restored.restored as Record<string, string | null>;
  for (const name of restorationNames) assert.equal(restoredValues[name], initial[name] ?? null, `finally must restore ${name} exactly`);

  // Each binding starts with a deliberately mixed spelling. The native run
  // proves POSIX preserves every exact variant; on Windows querying its one
  // logical key proves the original value survives the launcher's finally path.
  const mixedSelectedInitial: Record<string, string> = {
    cOdEcKs_aCcOuNt: "mixed-account",
    cOdEcKs_cReDeNtIaL_pRoViDeR: "mixed-provider",
    cOdEcKs_cReDeNtIaL_hElPeR_mOdUlE: "mixed-helper",
    pI_oNePaSsWoRd_oP_eXeCuTaBlE: "mixed-op",
    pI_oNePaSsWoRd_cOdEcKs_rEfErEnCe: "mixed-reference",
    oP_sErViCe_aCcOuNt_tOkEn: "mixed-token",
  };
  const mixedSelectedNames = Object.keys(mixedSelectedInitial);
  const mixedRestorationNames = isWindows ? selectedBindingNames : [...mixedSelectedNames, ...selectedBindingNames];
  const mixedRestored = restoreInPlace(mixedSelectedInitial, mixedRestorationNames, [promptAccount, copiedReference, serviceAccount]);
  assert.equal(mixedRestored.exitCode, 0);
  for (const [name, value] of Object.entries(mixedSelectedInitial)) {
    const queriedName = isWindows ? selectedBindingNames[mixedSelectedNames.indexOf(name)] : name;
    assert.equal(mixedRestored.restored[queriedName], value, `finally must retain the mixed-case logical value for ${name}`);
  }
  if (!isWindows) {
    for (const name of selectedBindingNames) assert.equal(mixedRestored.restored[name], null, `finally must not leave a canonical alias for ${name}`);
  }

  // Snapshot all absent owned bindings before the launcher creates them, then
  // prove that finally removes every one again.
  const absentRestored = restoreInPlace({}, selectedBindingNames, [promptAccount, copiedReference, serviceAccount]);
  assert.equal(absentRestored.exitCode, 0);
  for (const name of selectedBindingNames) {
    // Windows exposes a removed process variable as an empty provider entry,
    // even though a native child treats it as absent. Its logical value is
    // therefore empty there and null on POSIX.
    assert.equal(absentRestored.restored[name], isWindows ? "" : null, `finally must keep initially absent ${name} absent as the platform permits`);
    if (isWindows) assert.equal(absentRestored.nativeAbsent[name], true, `a native Windows child must observe initially absent ${name} as absent`);
  }

  const modelMixed = restoreWindowsLogicalEnvironment(mixedSelectedInitial);
  for (const [name, value] of Object.entries(mixedSelectedInitial)) {
    const restoredEntry = modelMixed.get(name.toUpperCase());
    assert.deepEqual(restoredEntry, { name, value }, `Windows-mode restoration must retain ${name} exactly`);
  }
  const modelAbsent = restoreWindowsLogicalEnvironment({});
  for (const name of selectedBindingNames) assert.equal(modelAbsent.has(name), false, `Windows-mode restoration must keep initially absent ${name} absent`);

  assert.match(source, /\$environmentNameComparer = if \(\$IsWindows\) \{ \[System\.StringComparer\]::OrdinalIgnoreCase \} else \{ \[System\.StringComparer\]::Ordinal \}/);
  assert.match(source, /function Remember-SelectedProcessEnvironmentBindings/);
  assert.ok(source.indexOf("Remember-SelectedProcessEnvironmentBindings") < source.indexOf("foreach ($name in Get-ProcessEnvironmentNames)"), "selected bindings must be snapshotted before sanitization");
  assert.match(source, /function Start-PiCodecksExternalHelper/);
  assert.match(source, /Read-Host 'Codecks account slug' -MaskInput/);
  assert.match(source, /Read-Host 'Codecks token reference' -MaskInput/);
  assert.match(source, /Read-Host '1Password service-account token' -MaskInput/);
  assert.match(source, /Resolve-TrustedPathApplication -Name 'op'/);
  assert.match(source, /Resolve-TrustedPathApplication -Name 'pi'/);
  assert.doesNotMatch(source, /PI_CODECKS_ALLOW_LIVE_VALIDATION' -Value|SetEnvironmentVariable\([^\n]+(?:User|Machine)/);
  console.log("PASS: trusted interactive Pi Codecks launcher validation succeeded");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
