param(
    [switch]$PromptForServiceAccountToken
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

function Invoke-CodecksExternalProviderLiveValidation {
    param(
        [switch]$PromptForServiceAccountToken
    )

    $processScope = [EnvironmentVariableTarget]::Process
    $userScope = [EnvironmentVariableTarget]::User
    $machineScope = [EnvironmentVariableTarget]::Machine
    # Environment keys on POSIX are case-sensitive. Keep each exact spelling so
    # restoring a canonical setting cannot overwrite a distinct inherited key.
    $script:previous = [System.Collections.Generic.Dictionary[string, object]]::new([System.StringComparer]::Ordinal)
    $script:changedNames = [System.Collections.Generic.List[string]]::new()
    $exitCode = 1
    $report = [ordered]@{ operation = 'codecks-external-provider-live-validation'; status = 'not_authenticated' }

    function Get-ProcessEnvironmentNames {
        return @(Get-ChildItem Env: | ForEach-Object { [string]$_.Name })
    }

    function Get-CaseInsensitiveEnvironmentValue {
        param([Parameter(Mandatory)][string]$Name, [Parameter(Mandatory)][EnvironmentVariableTarget]$Scope)

        if ($Scope -eq $processScope) {
            foreach ($entry in Get-ChildItem Env:) {
                if ([string]::Equals([string]$entry.Name, $Name, [StringComparison]::OrdinalIgnoreCase) -and -not [string]::IsNullOrWhiteSpace([string]$entry.Value)) { return [string]$entry.Value }
            }
            return $null
        }
        foreach ($key in [Environment]::GetEnvironmentVariables($Scope).Keys) {
            if ([string]::Equals([string]$key, $Name, [StringComparison]::OrdinalIgnoreCase)) {
                $value = [Environment]::GetEnvironmentVariable([string]$key, $Scope)
                if (-not [string]::IsNullOrWhiteSpace($value)) { return $value }
            }
        }
        return $null
    }

    function Get-FirstEnvironmentValue {
        param([Parameter(Mandatory)][string]$Name)

        foreach ($scope in @($processScope, $userScope, $machineScope)) {
            $value = Get-CaseInsensitiveEnvironmentValue -Name $Name -Scope $scope
            if (-not [string]::IsNullOrWhiteSpace($value)) { return $value }
        }
        return $null
    }

    function Normalize-CopiedSecretReference {
        param([Parameter(Mandatory)][string]$Value)

        $trimmed = $Value.Trim()
        if ($trimmed.Length -ge 2) {
            $first = $trimmed[0]
            $last = $trimmed[$trimmed.Length - 1]
            if (($first -eq [char]34 -and $last -eq [char]34) -or ($first -eq [char]39 -and $last -eq [char]39)) {
                return $trimmed.Substring(1, $trimmed.Length - 2).Trim()
            }
        }
        return $trimmed
    }

    function Remember-ProcessEnvironmentName {
        param([Parameter(Mandatory)][string]$Name)

        if (-not $script:previous.ContainsKey($Name)) {
            $existing = @(Get-ChildItem Env: | Where-Object { [string]$_.Name -ceq $Name } | Select-Object -First 1)
            $script:previous[$Name] = if ($existing.Count -eq 0) { $null } else { [string]$existing[0].Value }
            $script:changedNames.Add($Name)
        }
    }

    function Write-ProcessEnvironmentValue {
        param([Parameter(Mandatory)][string]$Name, [AllowNull()][string]$Value)

        # The Env: provider updates the native environment inherited by a
        # PowerShell native command; Environment.SetEnvironmentVariable alone
        # can leave a stale Windows command-processor entry behind.
        if ($null -eq $Value) {
            Remove-Item -LiteralPath "Env:$Name" -ErrorAction SilentlyContinue
        }
        else {
            Set-Item -LiteralPath "Env:$Name" -Value $Value
        }
    }

    function Remove-ProcessEnvironmentName {
        param([Parameter(Mandatory)][string]$Name)

        Remember-ProcessEnvironmentName -Name $Name
        Write-ProcessEnvironmentValue -Name $Name -Value $null
    }

    function Set-ProcessEnvironmentValue {
        param([Parameter(Mandatory)][string]$Name, [AllowNull()][string]$Value)

        # Windows process names are case-insensitive: one canonical setting is
        # sufficient. POSIX alternatives are removed and restored independently.
        if ($IsWindows) {
            Remember-ProcessEnvironmentName -Name $Name
            Write-ProcessEnvironmentValue -Name $Name -Value $Value
            return
        }
        foreach ($key in Get-ProcessEnvironmentNames) {
            if ([string]::Equals($key, $Name, [StringComparison]::OrdinalIgnoreCase) -and $key -cne $Name) {
                Remove-ProcessEnvironmentName -Name $key
            }
        }
        Remember-ProcessEnvironmentName -Name $Name
        Write-ProcessEnvironmentValue -Name $Name -Value $Value
    }

    function Invoke-ExternalProviderValidation {
        param([Parameter(Mandatory)][string]$WorkingDirectory)

        $npmExecutable = (Get-Command npm -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
        $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
        $startInfo.WorkingDirectory = $WorkingDirectory
        $startInfo.UseShellExecute = $false
        $startInfo.RedirectStandardOutput = $true
        $startInfo.RedirectStandardError = $true
        if ($IsWindows) {
            $startInfo.FileName = $env:ComSpec
            foreach ($argument in @('/d', '/s', '/c', 'npm run --silent validate:external-provider-live')) { $startInfo.ArgumentList.Add($argument) }
        }
        else {
            $startInfo.FileName = $npmExecutable
            foreach ($argument in @('run', '--silent', 'validate:external-provider-live')) { $startInfo.ArgumentList.Add($argument) }
        }

        # Build the native child environment explicitly. Windows can retain an
        # empty inherited spelling after process-scope removal; do not pass it
        # to the validator at all.
        $allowedCredentialNames = @(
            'CODECKS_CREDENTIAL_PROVIDER',
            'CODECKS_CREDENTIAL_HELPER_MODULE',
            'PI_ONEPASSWORD_CODECKS_REFERENCE',
            'OP_SERVICE_ACCOUNT_TOKEN'
        )
        $startInfo.Environment.Clear()
        foreach ($entry in Get-ChildItem Env:) {
            $key = [string]$entry.Name
            $blocked = $key -match '^OP_(?:CONNECT|SESSION)(?:_|$)' -or $key -match '^CODECKS_(?:TOKEN|API_TOKEN|TOKEN_REF|TOKEN_OP_REF)$' -or $key -match '^CODECKS_PROFILE_[A-Z0-9_]+_(?:TOKEN|API_TOKEN|TOKEN_REF|TOKEN_OP_REF)$' -or $key -match '^CODECKS_CREDENTIAL_(?:PROVIDER|HELPER_MODULE)$' -or $key -match '^PI_ONEPASSWORD_CODECKS_REFERENCE$'
            if (-not $blocked -or $allowedCredentialNames -ccontains $key) {
                $startInfo.Environment[$key] = [string]$entry.Value
            }
        }

        $process = [System.Diagnostics.Process]::new()
        $process.StartInfo = $startInfo
        if (-not $process.Start()) { throw 'Unable to start external-provider validation.' }
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        $process.WaitForExit()
        $lines = @($stdout.GetAwaiter().GetResult() -split "`r?`n" | Where-Object { $_ -ne '' })
        [void]$stderr.GetAwaiter().GetResult()
        return [pscustomobject]@{ lines = $lines; exitCode = $process.ExitCode }
    }

    try {
        if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'PowerShell 7 is required.' }

        $repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
        $adapterPath = Join-Path $repositoryRoot 'extensions/integrations/codecks-credential-helper.mjs'
        $siblingRoot = Join-Path $repositoryRoot '../pi-codecks'
        $siblingManifest = Join-Path $siblingRoot 'package.json'
        if (-not (Test-Path -LiteralPath $adapterPath -PathType Leaf) -or -not (Test-Path -LiteralPath $siblingManifest -PathType Leaf)) { throw 'Required local package path is unavailable.' }
        $adapterPath = (Resolve-Path -LiteralPath $adapterPath).Path
        $siblingRoot = (Resolve-Path -LiteralPath $siblingRoot).Path

        foreach ($key in Get-ProcessEnvironmentNames) {
            if ($key -match '^OP_(?:CONNECT|SESSION)(?:_|$)' -or $key -match '^CODECKS_(?:TOKEN|API_TOKEN|TOKEN_REF|TOKEN_OP_REF)$' -or $key -match '^CODECKS_PROFILE_[A-Z0-9_]+_(?:TOKEN|API_TOKEN|TOKEN_REF|TOKEN_OP_REF)$' -or $key -match '^CODECKS_CREDENTIAL_(?:PROVIDER|HELPER_MODULE)$') {
                Remove-ProcessEnvironmentName -Name $key
            }
        }

        $opExecutable = (Get-Command op -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
        if (-not [IO.Path]::IsPathRooted($opExecutable)) { throw '1Password executable is not absolute.' }

        $account = Get-FirstEnvironmentValue -Name 'CODECKS_ACCOUNT'
        if ([string]::IsNullOrWhiteSpace($account)) { $account = Read-Host 'Codecks account' -MaskInput }
        $reference = Get-FirstEnvironmentValue -Name 'PI_ONEPASSWORD_CODECKS_REFERENCE'
        if ([string]::IsNullOrWhiteSpace($reference)) { $reference = Read-Host 'Codecks token reference' -MaskInput }
        # On Windows a process key has one logical spelling. Preserve the raw
        # copied value before normalization even when the Env: provider cannot
        # retrieve that inherited spelling through Environment APIs.
        if ($IsWindows) {
            Remember-ProcessEnvironmentName -Name 'PI_ONEPASSWORD_CODECKS_REFERENCE'
            if ($null -eq $script:previous['PI_ONEPASSWORD_CODECKS_REFERENCE']) { $script:previous['PI_ONEPASSWORD_CODECKS_REFERENCE'] = $reference }
        }
        $reference = Normalize-CopiedSecretReference -Value $reference
        $serviceAccountToken = if ($PromptForServiceAccountToken) { Read-Host '1Password service-account token' -MaskInput } else { Get-FirstEnvironmentValue -Name 'OP_SERVICE_ACCOUNT_TOKEN' }
        if ([string]::IsNullOrWhiteSpace($serviceAccountToken)) { $serviceAccountToken = Read-Host '1Password service-account token' -MaskInput }

        Set-ProcessEnvironmentValue -Name 'CODECKS_CREDENTIAL_PROVIDER' -Value 'external-helper'
        Set-ProcessEnvironmentValue -Name 'CODECKS_CREDENTIAL_HELPER_MODULE' -Value $adapterPath
        Set-ProcessEnvironmentValue -Name 'PI_CODECKS_ALLOW_LIVE_VALIDATION' -Value '1'
        Set-ProcessEnvironmentValue -Name 'CODECKS_ACCOUNT' -Value $account
        Set-ProcessEnvironmentValue -Name 'PI_ONEPASSWORD_OP_EXECUTABLE' -Value $opExecutable
        Set-ProcessEnvironmentValue -Name 'PI_ONEPASSWORD_CODECKS_REFERENCE' -Value $reference
        Set-ProcessEnvironmentValue -Name 'OP_SERVICE_ACCOUNT_TOKEN' -Value $serviceAccountToken
        Remove-Variable account, reference, serviceAccountToken -ErrorAction SilentlyContinue

        # Launches only `npm run --silent validate:external-provider-live`.
        $validation = Invoke-ExternalProviderValidation -WorkingDirectory $siblingRoot
        $candidate = $null
        try { $candidate = (($validation.lines -join '') | ConvertFrom-Json -ErrorAction Stop) } catch {}
        if ($validation.exitCode -eq 0 -and $candidate.status -eq 'authenticated' -and $candidate.category -eq 'authenticated') {
            $report.status = 'authenticated'
            $exitCode = 0
        }
    }
    catch {
        # A single fixed report is the only public failure evidence.
    }
    finally {
        foreach ($name in $script:changedNames) {
            try { Write-ProcessEnvironmentValue -Name $name -Value $script:previous[$name] } catch {}
        }
    }

    return [pscustomobject]@{ report = [pscustomobject]$report; exitCode = $exitCode }
}

if ($MyInvocation.InvocationName -ne '.') {
    $result = Invoke-CodecksExternalProviderLiveValidation -PromptForServiceAccountToken:$PromptForServiceAccountToken
    [Console]::Out.WriteLine(($result.report | ConvertTo-Json -Compress -Depth 2))
    exit $result.exitCode
}
