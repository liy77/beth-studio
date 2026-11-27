# Beth Studio — instalação fácil no Windows (usuário final).
#
# Baixa o último release do GitHub e instala. Não precisa clonar o repo.
#
# One-liner (PowerShell):
#   irm https://raw.githubusercontent.com/rodrigo-mcu/beth-studio/main/scripts/get.ps1 | iex
#
# Ou:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\get.ps1
#
# Opções:
#   -WingetPrefer   tenta `winget install MCU.BethStudio` antes do download
#   -Portable       baixa o zip portátil em vez do Setup.exe
#   -Repo           dono/repo no GitHub (padrão: rodrigo-mcu/beth-studio)
[CmdletBinding()]
param(
    [switch]$WingetPrefer,
    [switch]$Portable,
    [string]$Repo = 'rodrigo-mcu/beth-studio',
    [string]$Destination = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-Step([string]$m) { Write-Host "==> $m" -ForegroundColor Cyan }

Write-Host 'Beth Studio — get (Windows)' -ForegroundColor Green
Write-Host "Release: https://github.com/$Repo/releases/latest"

if ($WingetPrefer) {
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        Write-Step 'tentando winget install MCU.BethStudio'
        & winget install -e --id MCU.BethStudio --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -eq 0) {
            Write-Host 'OK: instalado via winget.' -ForegroundColor Green
            return
        }
        Write-Host '(winget ainda sem o pacote ou falhou — baixando do GitHub)' -ForegroundColor Yellow
    }
}

Write-Step 'consultando o último release'
$rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers @{
    'User-Agent' = 'BethStudio-get'
    'Accept'     = 'application/vnd.github+json'
}
$tag = $rel.tag_name
Write-Host "Versão: $tag"

$tmp = Join-Path ([IO.Path]::GetTempPath()) ("bethstudio-get-" + [guid]::NewGuid().ToString('n'))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null

try {
    if ($Portable) {
        $asset = $rel.assets | Where-Object { $_.name -like 'BethStudio-*-windows-x64.zip' } | Select-Object -First 1
        if (-not $asset) { throw "Release $tag sem zip portátil." }
        $zip = Join-Path $tmp $asset.name
        Write-Step "baixando $($asset.name)"
        Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip
        if (-not $Destination) {
            $Destination = Join-Path $env:LOCALAPPDATA 'Beth Studio'
        }
        Write-Step "extraindo para $Destination"
        if (Test-Path $Destination) {
            # não apaga host em uso: só sobrescreve arquivos soltos
        } else {
            New-Item -ItemType Directory -Path $Destination -Force | Out-Null
        }
        Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
        $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
        if (-not $inner) { throw 'zip sem pasta interna' }
        Copy-Item -Path (Join-Path $inner.FullName '*') -Destination $Destination -Recurse -Force
        $exe = Join-Path $Destination 'bethstudio-web.exe'
        if (-not (Test-Path $exe)) { throw "faltou bethstudio-web.exe em $Destination" }
        Write-Host "OK: $Destination" -ForegroundColor Green
        Write-Host "Abra: & '$exe'"
        Start-Process -FilePath $exe
    } else {
        $asset = $rel.assets | Where-Object { $_.name -eq 'BethStudio-Setup.exe' } | Select-Object -First 1
        if (-not $asset) { throw "Release $tag sem BethStudio-Setup.exe." }
        $setup = Join-Path $tmp 'BethStudio-Setup.exe'
        Write-Step 'baixando BethStudio-Setup.exe'
        Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $setup
        # Confere SHA se o release trouxe SHA256SUMS.txt
        $sums = $rel.assets | Where-Object { $_.name -eq 'SHA256SUMS.txt' } | Select-Object -First 1
        if ($sums) {
            $sumFile = Join-Path $tmp 'SHA256SUMS.txt'
            Invoke-WebRequest -Uri $sums.browser_download_url -OutFile $sumFile
            $want = (Get-Content $sumFile | Where-Object { $_ -match 'BethStudio-Setup\.exe' } | Select-Object -First 1)
            if ($want -match '^([A-Fa-f0-9]{64})\s+') {
                $got = (Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash
                if ($got.ToUpperInvariant() -ne $Matches[1].ToUpperInvariant()) {
                    throw "SHA-256 do Setup não bate com SHA256SUMS.txt (got $got)."
                }
                Write-Host 'SHA-256 OK'
            }
        }
        Write-Step 'abrindo o instalador'
        Start-Process -FilePath $setup -Wait
        Write-Host 'OK: siga a janela do instalador.' -ForegroundColor Green
    }
} finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
