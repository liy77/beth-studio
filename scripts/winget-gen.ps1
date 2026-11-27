# Gera manifests winget a partir do último release do GitHub (zip portátil).
# O mantenedor usa isto depois de publicar um release; o usuário final usa get.ps1
# ou, quando o pacote estiver no community repo: winget install MCU.BethStudio
#
#   powershell -File scripts\winget-gen.ps1
#   powershell -File scripts\winget-gen.ps1 -Tag v0.4.1
#   powershell -File scripts\winget-gen.ps1 -Repo rodrigo-mcu/beth-studio
#
# Saída: scripts/winget/MCU.BethStudio/<versão>/
# Instalar localmente (sem estar no winget oficial):
#   winget install --manifest scripts\winget\MCU.BethStudio\<versão>
[CmdletBinding()]
param(
    [string]$Repo = 'rodrigo-mcu/beth-studio',
    [string]$Tag = '',
    [string]$PackageId = 'MCU.BethStudio'
)

$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
$OutRoot = Join-Path $PSScriptRoot 'winget'

Write-Host "==> winget-gen ($PackageId)" -ForegroundColor Cyan

if ($Tag) {
    $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/tags/$Tag" -Headers @{
        'User-Agent' = 'BethStudio-winget-gen'; 'Accept' = 'application/vnd.github+json'
    }
} else {
    $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers @{
        'User-Agent' = 'BethStudio-winget-gen'; 'Accept' = 'application/vnd.github+json'
    }
}

$tagName = $rel.tag_name
$version = $tagName.TrimStart('v')
$zip = $rel.assets | Where-Object { $_.name -like 'BethStudio-*-windows-x64.zip' } | Select-Object -First 1
if (-not $zip) { throw "Release $tagName sem zip portátil." }

# SHA do asset: prefer SHA256SUMS.txt do release
$sha = ''
$sumsAsset = $rel.assets | Where-Object { $_.name -eq 'SHA256SUMS.txt' } | Select-Object -First 1
if ($sumsAsset) {
    $sumsText = (Invoke-WebRequest -Uri $sumsAsset.browser_download_url).Content
    $line = ($sumsText -split "`n" | Where-Object { $_ -match [regex]::Escape($zip.name) } | Select-Object -First 1)
    if ($line -match '^([A-Fa-f0-9]{64})\s+') { $sha = $Matches[1].ToUpperInvariant() }
}
if (-not $sha) {
    Write-Host 'baixando zip só para hash…' -ForegroundColor Yellow
    $tmp = Join-Path $env:TEMP ("bst-winget-" + $zip.name)
    Invoke-WebRequest -Uri $zip.browser_download_url -OutFile $tmp
    $sha = (Get-FileHash -LiteralPath $tmp -Algorithm SHA256).Hash.ToUpperInvariant()
    Remove-Item $tmp -Force
}

$folderInZip = "BethStudio-$version"
$relDate = ([datetime]$rel.published_at).ToString('yyyy-MM-dd')
$dir = Join-Path $OutRoot "$PackageId\$version"
New-Item -ItemType Directory -Path $dir -Force | Out-Null

$locale = @"
# yaml-language-server: `$schema=https://aka.ms/winget-manifest.defaultLocale.1.6.0.schema.json
PackageIdentifier: $PackageId
PackageVersion: $version
PackageLocale: pt-BR
Publisher: MCU
PublisherUrl: https://github.com/rodrigo-mcu
PublisherSupportUrl: https://github.com/$Repo/issues
Author: Rodrigo
PackageName: Beth Studio
PackageUrl: https://rodrigo-mcu.github.io/beth-studio/
License: Proprietary
Copyright: Copyright (c) MCU / Rodrigo
ShortDescription: Terminal e estúdio com host persistente, agentes e arquivos.
Description: Beth Studio separa a interface do host dos terminais. Abas, divisões, arquivos, banco, SSH e voz num só programa. Atualizar a interface não mata os terminais.
Moniker: bethstudio
Tags:
- terminal
- wezterm
- agentes
- wsl
ReleaseNotesUrl: https://github.com/$Repo/releases/tag/$tagName
ManifestType: defaultLocale
ManifestVersion: 1.6.0
"@

$installer = @"
# yaml-language-server: `$schema=https://aka.ms/winget-manifest.installer.1.6.0.schema.json
PackageIdentifier: $PackageId
PackageVersion: $version
MinimumOSVersion: 10.0.17763.0
InstallerType: zip
NestedInstallerType: portable
UpgradeBehavior: install
ReleaseDate: $relDate
Installers:
- Architecture: x64
  InstallerUrl: $($zip.browser_download_url)
  InstallerSha256: $sha
  NestedInstallerFiles:
  - RelativeFilePath: $folderInZip\bethstudio-web.exe
    PortableCommandAlias: bethstudio-web
  - RelativeFilePath: $folderInZip\bethstudio.exe
    PortableCommandAlias: bethstudio
  - RelativeFilePath: $folderInZip\bethstudio-host.exe
    PortableCommandAlias: bethstudio-host
ManifestType: installer
ManifestVersion: 1.6.0
"@

$versionYaml = @"
# yaml-language-server: `$schema=https://aka.ms/winget-manifest.version.1.6.0.schema.json
PackageIdentifier: $PackageId
PackageVersion: $version
DefaultLocale: pt-BR
ManifestType: version
ManifestVersion: 1.6.0
"@

Set-Content -LiteralPath (Join-Path $dir "$PackageId.locale.pt-BR.yaml") -Value $locale -Encoding utf8
Set-Content -LiteralPath (Join-Path $dir "$PackageId.installer.yaml") -Value $installer -Encoding utf8
Set-Content -LiteralPath (Join-Path $dir "$PackageId.yaml") -Value $versionYaml -Encoding utf8

Write-Host "OK: $dir" -ForegroundColor Green
Write-Host "Teste local:"
Write-Host "  winget install --manifest `"$dir`""
Write-Host "Publicar no community: abra um PR em microsoft/winget-pkgs com manifests/m/MCU/BethStudio/$version/"
