param(
    [switch]$PromptForServiceAccountToken
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

if ($PSVersionTable.PSVersion.Major -lt 7) {
    [Console]::Out.WriteLine('{"operation":"codecks-live-validation","status":"setup-failed"}')
    exit 1
}

$processScope = [EnvironmentVariableTarget]::Process
$userScope = [EnvironmentVariableTarget]::User
$machineScope = [EnvironmentVariableTarget]::Machine
$previous = @{}
$names = @()
$pushedLocation = $false
$exitCode = 1
$report = [ordered]@{
    operation = 'codecks-live-validation'
    status = 'setup-failed'
}

function Get-FirstEnvironmentValue {
    param([Parameter(Mandatory)][string]$Name)

    foreach ($scope in @($processScope, $userScope, $machineScope)) {
        $value = [Environment]::GetEnvironmentVariable($Name, $scope)
        if (-not [string]::IsNullOrWhiteSpace($value)) {
            return $value
        }
    }
    return $null
}

function Set-ProcessEnvironmentValue {
    param(
        [Parameter(Mandatory)][string]$Name,
        [AllowNull()][string]$Value
    )

    [Environment]::SetEnvironmentVariable($Name, $Value, $processScope)
}

try {
    $repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
    Push-Location $repositoryRoot
    $pushedLocation = $true

    $requiredNames = @(
        'PI_ONEPASSWORD_OP_EXECUTABLE',
        'PI_ONEPASSWORD_CODECKS_ACCOUNT',
        'PI_ONEPASSWORD_CODECKS_REFERENCE',
        'PI_CODECKS_READONLY_AUTH_TOKEN',
        'OP_SERVICE_ACCOUNT_TOKEN'
    )
    $conflictingNames = @(
        [Environment]::GetEnvironmentVariables($processScope).Keys |
            ForEach-Object { [string]$_ } |
            Where-Object {
                $_ -match '^OP_CONNECT(?:_|$)' -or
                $_ -match '^OP_SESSION'
            }
    )
    $names = @($requiredNames + $conflictingNames | Select-Object -Unique)

    foreach ($name in $names) {
        $previous[$name] = [Environment]::GetEnvironmentVariable($name, $processScope)
    }
    foreach ($name in $conflictingNames) {
        Set-ProcessEnvironmentValue -Name $name -Value $null
    }

    $opExecutable = (Get-Command op -CommandType Application -ErrorAction Stop).Source
    $nodeExecutable = (Get-Command node -CommandType Application -ErrorAction Stop).Source
    Set-ProcessEnvironmentValue -Name 'PI_ONEPASSWORD_OP_EXECUTABLE' -Value $opExecutable

    $account = Get-FirstEnvironmentValue -Name 'PI_ONEPASSWORD_CODECKS_ACCOUNT'
    if ([string]::IsNullOrWhiteSpace($account)) {
        $account = Read-Host 'Codecks account slug' -MaskInput
    }
    Set-ProcessEnvironmentValue -Name 'PI_ONEPASSWORD_CODECKS_ACCOUNT' -Value $account

    $reference = Get-FirstEnvironmentValue -Name 'PI_ONEPASSWORD_CODECKS_REFERENCE'
    if ([string]::IsNullOrWhiteSpace($reference)) {
        $reference = Read-Host 'Codecks token op:// reference' -MaskInput
    }
    Set-ProcessEnvironmentValue -Name 'PI_ONEPASSWORD_CODECKS_REFERENCE' -Value $reference

    $serviceAccountToken = if ($PromptForServiceAccountToken) {
        Read-Host '1Password service-account token' -MaskInput
    }
    else {
        Get-FirstEnvironmentValue -Name 'OP_SERVICE_ACCOUNT_TOKEN'
    }
    if ([string]::IsNullOrWhiteSpace($serviceAccountToken)) {
        $serviceAccountToken = Read-Host '1Password service-account token' -MaskInput
    }
    Set-ProcessEnvironmentValue -Name 'OP_SERVICE_ACCOUNT_TOKEN' -Value $serviceAccountToken

    Remove-Variable account, reference, serviceAccountToken -ErrorAction SilentlyContinue

    & $opExecutable whoami *> $null
    $onePasswordAuthExit = $LASTEXITCODE

    Set-ProcessEnvironmentValue -Name 'PI_CODECKS_READONLY_AUTH_TOKEN' -Value $env:PI_ONEPASSWORD_CODECKS_REFERENCE
    & $opExecutable run -- $nodeExecutable -e `
        'process.exit(process.env.PI_CODECKS_READONLY_AUTH_TOKEN?.trim() ? 0 : 1)' `
        *> $null
    $referenceResolutionExit = $LASTEXITCODE

    $liveLines = @(& npm run --silent live:codecks-readonly-auth 2>$null)
    $liveLauncherExit = $LASTEXITCODE
    $liveText = $liveLines -join ''
    $liveResult = $null
    try {
        $candidate = $liveText | ConvertFrom-Json -ErrorAction Stop
        if (
            $candidate.operation -eq 'codecks-readonly-auth' -and
            $candidate.category -is [string] -and
            $candidate.status -is [string] -and
            $candidate.durationMs -is [ValueType]
        ) {
            $liveResult = [ordered]@{
                operation = 'codecks-readonly-auth'
                category = [string]$candidate.category
                status = [string]$candidate.status
                durationMs = [int]$candidate.durationMs
            }
        }
    }
    catch {
        $liveResult = $null
    }

    $succeeded =
        $onePasswordAuthExit -eq 0 -and
        $referenceResolutionExit -eq 0 -and
        $liveLauncherExit -eq 0 -and
        $null -ne $liveResult -and
        $liveResult.status -eq 'success'

    $report = [ordered]@{
        operation = 'codecks-live-validation'
        status = if ($succeeded) { 'success' } else { 'failed' }
        onePasswordAuthExit = [int]$onePasswordAuthExit
        referenceResolutionExit = [int]$referenceResolutionExit
        liveLauncherExit = [int]$liveLauncherExit
        liveResult = $liveResult
    }
    $exitCode = if ($succeeded) { 0 } else { 1 }
}
catch {
    $report = [ordered]@{
        operation = 'codecks-live-validation'
        status = 'setup-failed'
    }
    $exitCode = 1
}
finally {
    foreach ($name in $names) {
        try {
            [Environment]::SetEnvironmentVariable($name, $previous[$name], $processScope)
        }
        catch {
            # Keep cleanup failures non-diagnostic so no environment value is exposed.
        }
    }
    if ($pushedLocation) {
        Pop-Location
    }
}

[Console]::Out.WriteLine(($report | ConvertTo-Json -Compress -Depth 4))
exit $exitCode
