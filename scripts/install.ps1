# Instalação fácil do Beth Studio no Windows.
# Compila o que faltar, copia para %LOCALAPPDATA%\Beth Studio e cria atalho.
#
#   powershell -File scripts\install.ps1
#   powershell -File scripts\install.ps1 -SkipRust
#   powershell -File scripts\install.ps1 -SkipFrontend
#   powershell -File scripts\install.ps1 -Setup          # gera e abre BethStudio-Setup.exe
#   powershell -File scripts\install.ps1 -DryRun
#
# Scripts antigos (não removidos): install-bethstudio-release.ps1, pack-bethstudio-setup.ps1, release.ps1
[CmdletBinding()]
param(
    [switch]$SkipRust,
    [switch]$SkipFrontend,
    [switch]$Setup,
    [switch]$DryRun,
    [string]$Destination = (Join-Path $env:LOCALAPPDATA 'Beth Studio')
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
$Web = Join-Path $Root 'bethstudio-web'
$Dist = Join-Path $Root 'upstream-wezterm\target\release'

Write-Host 'Beth Studio — install (Windows)' -ForegroundColor Cyan
Write-Host "Repo: $Root"
Write-Host "Destino: $Destination"

# --- Studio (Go + React) ----------------------------------------------------
$studioExe = Join-Path $Web 'bethstudio-web.exe'
$needStudio = -not (Test-Path -LiteralPath $studioExe)
if ($needStudio -or -not $SkipFrontend) {
    Write-Host '==> bethstudio-web\build.ps1' -ForegroundColor Cyan
    if ($DryRun) {
        Write-Host '[DryRun] powershell -File build.ps1'
    } else {
        $buildArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $Web 'build.ps1'))
        if ($SkipFrontend -and -not $needStudio) { $buildArgs += '-SkipFrontend' }
        & powershell @buildArgs
        if ($LASTEXITCODE -ne 0) { throw 'build.ps1 falhou' }
    }
}

# --- Host + CLI (Rust) ------------------------------------------------------
$hostExe = Join-Path $Dist 'bethstudio-host.exe'
$cliExe = Join-Path $Dist 'bethstudio.exe'
if (-not $SkipRust -and (-not (Test-Path $hostExe) -or -not (Test-Path $cliExe))) {
    Write-Host '==> cargo +nightly build --release (host + CLI)' -ForegroundColor Cyan
    if ($DryRun) {
        Write-Host '[DryRun] cargo build wezterm + wezterm-mux-server'
    } else {
        $perl = 'C:\Strawberry\perl\bin'
        if (Test-Path $perl) { $env:PATH = "$perl;" + $env:PATH }
        Push-Location (Join-Path $Root 'upstream-wezterm')
        try {
            & cargo +nightly build --release -p wezterm -p wezterm-mux-server
            if ($LASTEXITCODE -ne 0) { throw 'cargo build falhou' }
        } finally { Pop-Location }
    }
}
if (-not (Test-Path $hostExe) -or -not (Test-Path $cliExe)) {
    throw "Falta $hostExe ou $cliExe. Compile o Rust ou rode sem -SkipRust."
}

# --- Setup.exe (opcional) ---------------------------------------------------
if ($Setup) {
    Write-Host '==> pack-bethstudio-setup.ps1' -ForegroundColor Cyan
    if ($DryRun) {
        Write-Host '[DryRun] pack-bethstudio-setup.ps1'
        exit 0
    }
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'pack-bethstudio-setup.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'pack-bethstudio-setup.ps1 falhou' }
    $setup = Join-Path $Root 'dist\BethStudio-Setup.exe'
    if (Test-Path $setup) {
        Write-Host "OK: $setup"
        Start-Process -FilePath $setup
    }
    exit 0
}

# --- Cópia local (sem derrubar host em execução) ----------------------------
Write-Host '==> instalando arquivos' -ForegroundColor Cyan
if ($DryRun) {
    Write-Host "[DryRun] copiaria Studio + host + CLI para $Destination"
    exit 0
}

# Reusa a lógica de “não matar o host” do instalador antigo para os bins Rust
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'install-bethstudio-release.ps1') -Destination $Destination
if ($LASTEXITCODE -ne 0) { throw 'install-bethstudio-release.ps1 falhou' }

# Studio + tool ao lado do host (o Setup também faz isso)
$tool = Join-Path $Web 'bethstudio-tool.exe'
Copy-Item -LiteralPath $studioExe -Destination (Join-Path $Destination 'bethstudio-web.exe') -Force
if (Test-Path $tool) {
    Copy-Item -LiteralPath $tool -Destination (Join-Path $Destination 'bethstudio-tool.exe') -Force
}
# Nome amigável igual ao do Setup
Copy-Item -LiteralPath $studioExe -Destination (Join-Path $Destination 'Beth Studio.exe') -Force

# ConPTY ao lado do host (se o install-release ainda não tiver)
foreach ($name in @('OpenConsole.exe', 'conpty.dll')) {
    $dst = Join-Path $Destination $name
    if (-not (Test-Path $dst)) {
        $src = Join-Path $Root "upstream-wezterm\assets\windows\conhost\$name"
        if (Test-Path $src) { Copy-Item $src $dst -Force }
    }
}

# Atalho no Menu Iniciar
$startDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
New-Item -ItemType Directory -Path $startDir -Force | Out-Null
$lnkPath = Join-Path $startDir 'Beth Studio.lnk'
$w = New-Object -ComObject WScript.Shell
$lnk = $w.CreateShortcut($lnkPath)
$lnk.TargetPath = Join-Path $Destination 'Beth Studio.exe'
$lnk.WorkingDirectory = $Destination
$lnk.Description = 'Beth Studio'
$lnk.Save()

Write-Host "OK: $Destination" -ForegroundColor Green
Write-Host "OK: atalho $lnkPath"
Write-Host 'Abra pelo menu Iniciar ou:'
Write-Host "  & '$Destination\Beth Studio.exe'"
