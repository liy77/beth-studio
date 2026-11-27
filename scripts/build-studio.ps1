# Wrapper → bethstudio-web\build.ps1
[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    $Rest
)
$Web = Resolve-Path (Join-Path $PSScriptRoot '..\bethstudio-web')
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Web 'build.ps1') @Rest
exit $LASTEXITCODE
