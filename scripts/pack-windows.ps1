# Wrapper → pack-bethstudio-setup.ps1 na raiz.
[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    $Rest
)
$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'pack-bethstudio-setup.ps1') @Rest
exit $LASTEXITCODE
