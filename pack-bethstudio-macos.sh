#!/bin/bash
# Compila o Beth Studio no macOS, gera Beth Studio.app + .dmg e (opcional)
# instala em /Applications.
#
# Uso:
#   ./pack-bethstudio-macos.sh              # build + DMG
#   ./pack-bethstudio-macos.sh --install    # build + DMG + copia para /Applications
#   ./pack-bethstudio-macos.sh --skip-frontend
#   ./pack-bethstudio-macos.sh --skip-rust  # reusa host/CLI já compilados
#
# Variáveis:
#   BETHSTUDIO_DIST   pasta com bethstudio e bethstudio-host (padrão: release do repo)
#   BETHSTUDIO_VERSION  carimba Info.plist / ldflags (padrão: 0.0.0-dev)
set -euo pipefail

root="$(cd "$(dirname "$0")" && pwd)"
web="$root/bethstudio-web"
frontend="$web/frontend"
dist_default="$root/upstream-wezterm/target/release"
out_dir="$root/dist/macos"
app_name="Beth Studio"
bundle="$out_dir/$app_name.app"
dmg="$out_dir/BethStudio-macOS.dmg"
stage="$out_dir/dmg-root"

skip_frontend=0
skip_rust=0
do_install=0
version="${BETHSTUDIO_VERSION:-0.0.0-dev}"

for arg in "$@"; do
  case "$arg" in
    --skip-frontend) skip_frontend=1 ;;
    --skip-rust) skip_rust=1 ;;
    --install) do_install=1 ;;
    -h|--help)
      sed -n '2,14p' "$0"
      exit 0
      ;;
    *)
      echo "opção desconhecida: $arg" >&2
      exit 2
      ;;
  esac
done

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "falta: $1" >&2; exit 1; }
}

need go
need node
need hdiutil
need lipo

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "este script só roda no macOS" >&2
  exit 1
fi

half=$(( $(sysctl -n hw.ncpu) / 2 ))
[[ "$half" -lt 1 ]] && half=1
export GOMAXPROCS="${GOMAXPROCS:-$half}"
export CGO_ENABLED=1

echo "==> pasta de saída: $out_dir"
rm -rf "$out_dir"
mkdir -p "$out_dir"

# Copia frontend/dist → webui/dist (o //go:embed). Nunca segue symlink:
# se webui/dist apontar para frontend/dist, um rm apagaria a UI recém-buildada
# e o Studio sairia sem index.html.
sync_webui_dist() {
  local src="$frontend/dist"
  local dst="$web/webui/dist"
  [[ -f "$src/index.html" ]] || {
    echo "frontend/dist/index.html ausente (vite do Studio falhou?)" >&2
    exit 1
  }
  [[ -f "$src/phone/index.html" ]] || {
    echo "frontend/dist/phone/index.html ausente (vite do celular falhou?)" >&2
    exit 1
  }
  if [[ -L "$dst" ]]; then
    echo "webui/dist é symlink → $(readlink "$dst"); removendo para não apagar a origem" >&2
    rm -f "$dst"
  fi
  # limpa destino sem tocar .gitkeep (fica no git)
  mkdir -p "$dst"
  local f
  for f in "$dst"/* "$dst"/.[!.]* "$dst"/..?*; do
    [[ -e "$f" || -L "$f" ]] || continue
    [[ "$(basename "$f")" == ".gitkeep" ]] && continue
    rm -rf "$f"
  done
  # NFS/MCUDevDisk: AppleDouble (._*) quebra cp -R e codesign.
  find "$src" \( -name '._*' -o -name '.DS_Store' \) -delete 2>/dev/null || true
  # rsync evita copiar ._* recém-criados pelo Finder no volume.
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete --exclude '.gitkeep' --exclude '._*' --exclude '.DS_Store' "$src"/ "$dst"/
  else
    cp -R "$src"/. "$dst"/
    find "$dst" \( -name '._*' -o -name '.DS_Store' \) -delete 2>/dev/null || true
  fi
  [[ -f "$dst/index.html" ]] || {
    echo "webui/dist/index.html ausente após a cópia" >&2
    exit 1
  }
  [[ -f "$dst/phone/index.html" ]] || {
    echo "webui/dist/phone/index.html ausente após a cópia" >&2
    exit 1
  }
  # confere o que o go:embed vai ver (falha cedo se a pasta estiver vazia)
  (
    cd "$web"
    go list -f '{{range .EmbedFiles}}{{println .}}{{end}}' ./webui
  ) | grep -qx 'dist/index.html' || {
    echo "go:embed não vê dist/index.html em webui/" >&2
    exit 1
  }
  echo "==> webui/dist pronto ($(find "$dst" -type f ! -name '.gitkeep' | wc -l | tr -d ' ') arquivos)"
}

# --- frontend ---------------------------------------------------------------
if [[ "$skip_frontend" -eq 0 ]]; then
  echo "==> frontend (pnpm)"
  need pnpm
  (
    cd "$frontend"
    if [[ -f pnpm-lock.yaml ]]; then
      pnpm install --frozen-lockfile
    else
      pnpm install
    fi
    # Vite só: o tsc do "pnpm build" ainda falha em unused/refs no tree atual.
    pnpm exec vite build
    pnpm exec vite build --config vite.phone.config.ts
  )
else
  echo "==> frontend: pulado (reusa frontend/dist e webui/dist)"
fi

# --- host + CLI (Rust) ------------------------------------------------------
dist="${BETHSTUDIO_DIST:-$dist_default}"
host_bin="$dist/bethstudio-host"
cli_bin="$dist/bethstudio"

if [[ "$skip_rust" -eq 0 ]]; then
  if [[ -x "$host_bin" && -x "$cli_bin" ]]; then
    echo "==> Rust: reusando $dist (já compilado)"
    skip_rust=1
  fi
fi

if [[ "$skip_rust" -eq 0 ]]; then
  echo "==> Rust (cargo +nightly release)"
  need cargo
  if ! rustup toolchain list | grep -q '^nightly'; then
    rustup toolchain install nightly -c rustc -c cargo
  fi
  (
    cd "$root/upstream-wezterm"
    cargo +nightly build --release -p wezterm -p wezterm-mux-server -j "$half"
  )
  dist="$dist_default"
  host_bin="$dist/bethstudio-host"
  cli_bin="$dist/bethstudio"
fi

[[ -x "$host_bin" ]] || { echo "falta $host_bin" >&2; exit 1; }
[[ -x "$cli_bin" ]] || { echo "falta $cli_bin" >&2; exit 1; }
file "$host_bin" | grep -q 'Mach-O' || { echo "$host_bin não é binário macOS" >&2; exit 1; }
file "$cli_bin" | grep -q 'Mach-O' || { echo "$cli_bin não é binário macOS" >&2; exit 1; }

# --- Studio (Go + WKWebView) ------------------------------------------------
# Cópia imediatamente antes do go build: o cargo pode demorar e nada deve
# empacotar um webui/dist vazio (.gitkeep) no exe.
echo "==> embutindo UI em webui/dist"
sync_webui_dist

echo "==> Studio (go build, CGO + Cocoa/WebKit)"
(
  cd "$web"
  go build -trimpath \
    -ldflags "-s -w -X main.buildTime=$(date -u +%Y-%m-%dT%H:%M:%SZ) -X main.appVersion=$version" \
    -o bethstudio-web .
  # mesmo binário com nome de ferramenta (SSH/serial helpers no host)
  cp -f bethstudio-web bethstudio-tool
)

studio_bin="$web/bethstudio-web"
[[ -x "$studio_bin" ]] || { echo "falha ao gerar $studio_bin" >&2; exit 1; }
file "$studio_bin" | grep -q 'Mach-O' || { echo "$studio_bin não é binário macOS" >&2; exit 1; }
# Sem a UI embutida o binário sobe, mas a janela mostra "index.html ausente".
# Marcador só existe no index.html do Vite (não nas mensagens de erro do Go).
if ! grep -a -q 'Abrindo Beth Studio' "$studio_bin"; then
  echo "bethstudio-web compilado sem index.html embutido" >&2
  exit 1
fi
echo "==> embed OK ($(wc -c < "$studio_bin" | tr -d ' ') bytes)"

# --- ícone .icns ------------------------------------------------------------
icns="$out_dir/AppIcon.icns"
iconset="$out_dir/AppIcon.iconset"
mkdir -p "$iconset"
src_png="$frontend/phone-public/icons/icon-512.png"
if [[ -f "$src_png" ]]; then
  for size in 16 32 128 256 512; do
    sips -z "$size" "$size" "$src_png" --out "$iconset/icon_${size}x${size}.png" >/dev/null
    dub=$((size * 2))
    if [[ "$dub" -le 1024 ]]; then
      sips -z "$dub" "$dub" "$src_png" --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
    fi
  done
  iconutil -c icns "$iconset" -o "$icns"
else
  echo "aviso: sem $src_png — app sem ícone próprio"
  icns=""
fi

# --- .app bundle ------------------------------------------------------------
echo "==> montando $app_name.app"
macos_dir="$bundle/Contents/MacOS"
res_dir="$bundle/Contents/Resources"
mkdir -p "$macos_dir" "$res_dir"

# Nomes sem .exe: hostExePath / resolveExe olham ao lado do Studio.
cp -f "$studio_bin" "$macos_dir/Beth Studio"
cp -f "$web/bethstudio-tool" "$macos_dir/bethstudio-tool"
cp -f "$host_bin" "$macos_dir/bethstudio-host"
cp -f "$cli_bin" "$macos_dir/bethstudio"
chmod +x "$macos_dir"/*

if [[ -n "$icns" && -f "$icns" ]]; then
  cp -f "$icns" "$res_dir/AppIcon.icns"
fi

cat > "$bundle/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>pt_BR</string>
  <key>CFBundleExecutable</key><string>Beth Studio</string>
  <key>CFBundleIdentifier</key><string>br.com.mcu.bethstudio</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>Beth Studio</string>
  <key>CFBundleDisplayName</key><string>Beth Studio</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$version</string>
  <key>CFBundleVersion</key><string>$version</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSSupportsAutomaticGraphicsSwitching</key><true/>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>NSMicrophoneUsageDescription</key>
  <string>O Beth Studio usa o microfone para ditado e voz nos agentes.</string>
</dict>
</plist>
EOF

# NFS/MCUDevDisk deixa arquivos AppleDouble (._*) que quebram o codesign
# ("unsealed contents" / app abre e fecha). Tira antes de assinar.
echo "==> limpando AppleDouble (._*)"
find "$bundle" \( -name '._*' -o -name '.DS_Store' \) -delete 2>/dev/null || true

# ad-hoc sign so Gatekeeper is a little less angry on local installs
if command -v codesign >/dev/null 2>&1; then
  echo "==> codesign ad-hoc"
  codesign --force --deep --options runtime --sign - \
    --identifier "br.com.mcu.bethstudio" "$bundle" 2>/dev/null || true
  codesign -vv --deep --strict "$bundle" 2>&1 | tail -3 || true
fi

# --- DMG --------------------------------------------------------------------
echo "==> gerando DMG"
rm -rf "$stage"
mkdir -p "$stage"
cp -R "$bundle" "$stage/"
ln -sf /Applications "$stage/Applications"

rm -f "$dmg"
# UDZO = zlib-compressed read-only image
hdiutil create \
  -volname "Beth Studio" \
  -srcfolder "$stage" \
  -ov -format UDZO \
  "$dmg"

rm -rf "$stage" "$iconset"

echo
echo "OK: $bundle"
echo "OK: $dmg ($(du -h "$dmg" | awk '{print $1}'))"

# --- instalar em /Applications ---------------------------------------------
if [[ "$do_install" -eq 1 ]]; then
  dest="/Applications/$app_name.app"
  echo "==> instalando em $dest"
  if [[ -d "$dest" ]]; then
    # não mata host do usuário; só troca o app
    rm -rf "$dest"
  fi
  # cp -R no volume local a partir do NFS pode recriar ._* — limpa de novo.
  cp -R "$bundle" "$dest"
  find "$dest" \( -name '._*' -o -name '.DS_Store' \) -delete 2>/dev/null || true
  if command -v codesign >/dev/null 2>&1; then
    codesign --force --deep --options runtime --sign - \
      --identifier "br.com.mcu.bethstudio" "$dest" 2>/dev/null || true
  fi
  echo "OK: instalado. Abra com: open -a 'Beth Studio'"
fi
