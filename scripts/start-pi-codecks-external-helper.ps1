Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

function Start-PiCodecksExternalHelper {
    $processScope = [EnvironmentVariableTarget]::Process
    # POSIX retains each ordinal spelling, while Windows has one logical,
    # case-insensitive process key. The latter prevents a canonical alias from
    # being recorded as absent after its mixed-case original was removed.
    $environmentNameComparer = if ($IsWindows) { [System.StringComparer]::OrdinalIgnoreCase } else { [System.StringComparer]::Ordinal }
    $previous = [System.Collections.Generic.Dictionary[string, object]]::new($environmentNameComparer)
    $changedNames = [System.Collections.Generic.List[string]]::new()
    $selectedBindingNames = @(
        'CODECKS_ACCOUNT',
        'CODECKS_CREDENTIAL_PROVIDER',
        'CODECKS_CREDENTIAL_HELPER_MODULE',
        'PI_ONEPASSWORD_OP_EXECUTABLE',
        'PI_ONEPASSWORD_CODECKS_REFERENCE',
        'OP_SERVICE_ACCOUNT_TOKEN'
    )

    function Get-ProcessEnvironmentNames {
        return @(Get-ChildItem Env: | ForEach-Object { [string]$_.Name })
    }

    function Remember-ProcessEnvironmentName {
        param([Parameter(Mandatory)][string]$Name)

        if (-not $previous.ContainsKey($Name)) {
            $entry = @(Get-ChildItem Env: | Where-Object { [string]$_.Name -ceq $Name } | Select-Object -First 1)
            $previous[$Name] = if ($entry.Count -eq 0) { $null } else { [string]$entry[0].Value }
            $changedNames.Add($Name)
        }
    }

    function Remember-SelectedProcessEnvironmentBindings {
        # Snapshot the bindings that this launcher owns before sanitization
        # removes any matching case variant. On Windows retain the one actual
        # spelling; on POSIX retain every ordinal spelling independently.
        foreach ($selectedName in $selectedBindingNames) {
            $matches = @(Get-ChildItem Env: | Where-Object {
                [string]::Equals([string]$_.Name, $selectedName, [StringComparison]::OrdinalIgnoreCase)
            })
            if ($matches.Count -eq 0) {
                Remember-ProcessEnvironmentName -Name $selectedName
            }
            elseif ($IsWindows) {
                Remember-ProcessEnvironmentName -Name ([string]$matches[0].Name)
            }
            else {
                foreach ($match in $matches) {
                    Remember-ProcessEnvironmentName -Name ([string]$match.Name)
                }
            }
        }
    }

    function Write-ProcessEnvironmentValue {
        param([Parameter(Mandatory)][string]$Name, [AllowNull()][string]$Value)

        # The Env: provider updates the native environment inherited by Pi.
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
        param([Parameter(Mandatory)][string]$Name, [Parameter(Mandatory)][string]$Value)

        # Remove every existing logical spelling before creating the intended
        # canonical spelling. On Windows the case-insensitive snapshot map
        # treats it as the same original key; POSIX restores every exact variant.
        foreach ($existingName in Get-ProcessEnvironmentNames) {
            if ([string]::Equals($existingName, $Name, [StringComparison]::OrdinalIgnoreCase)) {
                Remove-ProcessEnvironmentName -Name $existingName
            }
        }
        Remember-ProcessEnvironmentName -Name $Name
        Write-ProcessEnvironmentValue -Name $Name -Value $Value
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

    function Resolve-TrustedPathApplication {
        param([Parameter(Mandatory)][string]$Name)

        $command = Get-Command $Name -CommandType Application -ErrorAction Stop | Select-Object -First 1
        $candidate = if (-not [string]::IsNullOrWhiteSpace([string]$command.Path)) { [string]$command.Path } else { [string]$command.Source }
        if (-not [IO.Path]::IsPathRooted($candidate) -or -not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            throw "Trusted $Name application is unavailable."
        }
        return (Resolve-Path -LiteralPath $candidate).Path
    }

    try {
        if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'PowerShell 7 is required.' }

        $repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
        $adapterPath = Join-Path $repositoryRoot 'extensions/integrations/codecks-credential-helper.mjs'
        if (-not (Test-Path -LiteralPath $adapterPath -PathType Leaf)) { throw 'Required local adapter is unavailable.' }
        $adapterPath = (Resolve-Path -LiteralPath $adapterPath).Path
        $opExecutable = Resolve-TrustedPathApplication -Name 'op'
        $piExecutable = Resolve-TrustedPathApplication -Name 'pi'

        # Prompts are intentionally masked and accept no command-line values.
        $account = Read-Host 'Codecks account slug' -MaskInput
        $reference = Normalize-CopiedSecretReference -Value (Read-Host 'Codecks token reference' -MaskInput)
        $serviceAccountToken = Read-Host '1Password service-account token' -MaskInput
        if ([string]::IsNullOrWhiteSpace($account) -or [string]::IsNullOrWhiteSpace($reference) -or [string]::IsNullOrWhiteSpace($serviceAccountToken)) {
            throw 'Required trusted configuration was not supplied.'
        }

        Remember-SelectedProcessEnvironmentBindings
        foreach ($name in Get-ProcessEnvironmentNames) {
            if ($name -match '^(?:OP_(?:CONNECT|SESSION)(?:_|$)|OP_SERVICE_ACCOUNT_TOKEN(?:_|$)|CODECKS_|PI_ONEPASSWORD_(?:CODECKS_REFERENCE|OP_EXECUTABLE)$|PI_CODECKS_ALLOW_LIVE_VALIDATION$)') {
                Remove-ProcessEnvironmentName -Name $name
            }
        }

        Set-ProcessEnvironmentValue -Name 'CODECKS_ACCOUNT' -Value $account
        Set-ProcessEnvironmentValue -Name 'CODECKS_CREDENTIAL_PROVIDER' -Value 'external-helper'
        Set-ProcessEnvironmentValue -Name 'CODECKS_CREDENTIAL_HELPER_MODULE' -Value $adapterPath
        Set-ProcessEnvironmentValue -Name 'PI_ONEPASSWORD_OP_EXECUTABLE' -Value $opExecutable
        Set-ProcessEnvironmentValue -Name 'PI_ONEPASSWORD_CODECKS_REFERENCE' -Value $reference
        Set-ProcessEnvironmentValue -Name 'OP_SERVICE_ACCOUNT_TOKEN' -Value $serviceAccountToken
        Remove-Variable account, reference, serviceAccountToken -ErrorAction SilentlyContinue

        # Construct Pi's native child environment explicitly. Windows can retain
        # a removed Env: spelling as an empty command-processor variable, so
        # relying on process mutation alone would not prove its absence in Pi.
        $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
        $startInfo.FileName = $piExecutable
        $startInfo.UseShellExecute = $false
        $startInfo.Environment.Clear()
        $allowedCredentialNames = @(
            'CODECKS_ACCOUNT',
            'CODECKS_CREDENTIAL_PROVIDER',
            'CODECKS_CREDENTIAL_HELPER_MODULE',
            'PI_ONEPASSWORD_OP_EXECUTABLE',
            'PI_ONEPASSWORD_CODECKS_REFERENCE',
            'OP_SERVICE_ACCOUNT_TOKEN'
        )
        foreach ($entry in Get-ChildItem Env:) {
            $name = [string]$entry.Name
            $blocked = $name -match '^(?:OP_(?:CONNECT|SESSION)(?:_|$)|OP_SERVICE_ACCOUNT_TOKEN(?:_|$)|CODECKS_|PI_ONEPASSWORD_(?:CODECKS_REFERENCE|OP_EXECUTABLE)$|PI_CODECKS_ALLOW_LIVE_VALIDATION$)'
            if (-not $blocked -or $allowedCredentialNames -ccontains $name) {
                $startInfo.Environment[$name] = [string]$entry.Value
            }
        }

        # No model-facing arguments or validation acknowledgement are supplied;
        # no redirected handles means Pi remains interactive in this terminal.
        $piProcess = [System.Diagnostics.Process]::new()
        $piProcess.StartInfo = $startInfo
        if (-not $piProcess.Start()) { throw 'Unable to start Pi.' }
        $piProcess.WaitForExit()
        return $piProcess.ExitCode
    }
    finally {
        foreach ($name in $changedNames) {
            try { Write-ProcessEnvironmentValue -Name $name -Value $previous[$name] } catch {}
        }
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    exit (Start-PiCodecksExternalHelper)
}
