#!/bin/bash
# Beth Studio — instalação fácil (macOS; Linux = host/CLI quando houver asset).
#
#   curl -fsSL https://raw.githubusercontent.com/rodrigo-mcu/beth-studio/main/scripts/get.sh | bash
#
# Opções:
#   REPO=rodrigo-mcu/beth-studio bash scripts/get.sh
#   --dmg     só baixa o DMG (macOS) se o release tiver
#   --help
set -euo pipefail

REPO="${REPO:-rodrigo-mcu/beth-studio}"
want_dmg=0
for arg in "$@"; do
  case "$arg" in
    --dmg) want_dmg=1 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
  esac
done

api="https://api.github.com/repos/${REPO}/releases/latest"
echo "==> Beth Studio — get"
echo "    https://github.com/${REPO}/releases/latest"

json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'User-Agent: BethStudio-get' "$api")"
tag="$(printf '%s' "$json" | python3 -c 'import sys,json; print(json.load(sys.stdin)["tag_name"])')"
echo "Versão: $tag"

os="$(uname -s)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

case "$os" in
  Darwin)
    dmg_url="$(printf '%s' "$json" | python3 -c '
import sys,json
rel=json.load(sys.stdin)
for a in rel.get("assets",[]):
  n=a.get("name","")
  if n.endswith(".dmg") or "macOS" in n or "macos" in n:
    print(a["browser_download_url"]); break
')"
    if [[ -n "$dmg_url" ]]; then
      echo "==> baixando DMG"
      curl -fsSL -o "$tmpdir/BethStudio.dmg" "$dmg_url"
      echo "==> abrindo o DMG (arraste para Applications)"
      open "$tmpdir/BethStudio.dmg"
      # não apaga o tmp até o usuário fechar — copia para ~/Downloads
      cp -f "$tmpdir/BethStudio.dmg" "$HOME/Downloads/BethStudio-${tag}.dmg"
      echo "OK: cópia em ~/Downloads/BethStudio-${tag}.dmg"
      exit 0
    fi
    echo "Este release ainda não tem DMG."
    echo "No Mac, a partir do código:"
    echo "  git clone https://github.com/${REPO}.git"
    echo "  cd beth-studio && ./scripts/install"
    echo "Ou baixe em: https://github.com/${REPO}/releases/latest"
    exit 1
    ;;
  Linux)
    echo "A janela do Studio no Linux ainda não vem no release."
    echo "Host + CLI a partir do código:"
    echo "  git clone https://github.com/${REPO}.git"
    echo "  cd beth-studio && ./scripts/install"
    exit 1
    ;;
  *)
    echo "Neste SO use o get.ps1 (Windows) ou o site de Releases."
    exit 2
    ;;
esac
