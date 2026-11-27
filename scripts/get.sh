#!/bin/bash
# Beth Studio — instalação fácil (macOS e Linux) a partir do GitHub.
#
#   curl -fsSL https://raw.githubusercontent.com/rodrigo-mcu/beth-studio/main/scripts/get.sh | bash
#
# Opções / env:
#   REPO=rodrigo-mcu/beth-studio
#   BETHSTUDIO_PREFIX=$HOME/.local     (Linux: onde vão os binários do tarball)
#   BETHSTUDIO_SRC=$HOME/.cache/beth-studio-src  (clone quando não há asset)
#   --dmg     macOS: só DMG
#   --help
set -euo pipefail

REPO="${REPO:-rodrigo-mcu/beth-studio}"
want_dmg=0
for arg in "$@"; do
  case "$arg" in
    --dmg) want_dmg=1 ;;
    -h|--help)
      sed -n '2,14p' "$0"
      exit 0
      ;;
  esac
done

need() { command -v "$1" >/dev/null 2>&1 || { echo "falta: $1" >&2; exit 1; }; }
need curl
need python3

api="https://api.github.com/repos/${REPO}/releases/latest"
echo "==> Beth Studio — get"
echo "    https://github.com/${REPO}/releases/latest"

json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'User-Agent: BethStudio-get' "$api")"
tag="$(printf '%s' "$json" | python3 -c 'import sys,json; print(json.load(sys.stdin)["tag_name"])')"
echo "Versão: $tag"

os="$(uname -s)"
arch="$(uname -m)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

install_linux_tarball() {
  local url="$1"
  local prefix="${BETHSTUDIO_PREFIX:-$HOME/.local}"
  local bindir="$prefix/bin"
  local archive="$tmpdir/bethstudio-linux.archive"
  echo "==> baixando pacote Linux"
  curl -fsSL -o "$archive" "$url"
  mkdir -p "$tmpdir/extract" "$bindir"
  case "$url" in
    *.zip)
      need unzip
      unzip -q "$archive" -d "$tmpdir/extract"
      ;;
    *.tar.xz)
      tar -xJf "$archive" -C "$tmpdir/extract"
      ;;
    *)
      tar -xzf "$archive" -C "$tmpdir/extract"
      ;;
  esac
  local cli host
  cli="$(find "$tmpdir/extract" -type f -name bethstudio | head -1)"
  host="$(find "$tmpdir/extract" -type f -name bethstudio-host | head -1)"
  if [[ -z "$cli" || -z "$host" ]]; then
    echo "pacote sem bethstudio / bethstudio-host" >&2
    return 1
  fi
  cp -f "$cli" "$bindir/bethstudio"
  cp -f "$host" "$bindir/bethstudio-host"
  chmod +x "$bindir/bethstudio" "$bindir/bethstudio-host"
  echo "OK: $bindir/bethstudio"
  echo "OK: $bindir/bethstudio-host"
  echo "    (garanta que $bindir está no PATH)"
  echo "    Janela do Studio: ainda Windows/macOS; aqui é host + CLI."
}

linux_from_source() {
  need git
  local dest="${BETHSTUDIO_SRC:-$HOME/.cache/beth-studio-src}"
  echo "==> sem pacote Linux no release — clonando e compilando"
  echo "    (precisa de Rust nightly; veja scripts/README.md)"
  if [[ -d "$dest/.git" ]]; then
    echo "==> atualizando $dest ($tag)"
    git -C "$dest" fetch --depth 1 origin "refs/tags/${tag}:refs/tags/${tag}" 2>/dev/null \
      || git -C "$dest" fetch --depth 1 origin "$tag" 2>/dev/null \
      || git -C "$dest" fetch --depth 1 origin main
    git -C "$dest" checkout -q "$tag" 2>/dev/null || git -C "$dest" checkout -q FETCH_HEAD
  else
    mkdir -p "$(dirname "$dest")"
    rm -rf "$dest"
    if ! git clone --depth 1 --branch "$tag" "https://github.com/${REPO}.git" "$dest" 2>/dev/null; then
      git clone --depth 1 "https://github.com/${REPO}.git" "$dest"
    fi
  fi
  (cd "$dest" && ./scripts/install)
}

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
      mkdir -p "$HOME/Downloads"
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
    linux_url="$(printf '%s' "$json" | BETHSTUDIO_ARCH="$arch" python3 -c '
import sys, json, os
rel = json.load(sys.stdin)
arch = (os.environ.get("BETHSTUDIO_ARCH") or "").lower()
if arch in ("x86_64", "amd64"):
    keys = ("x86_64", "amd64", "x64")
elif arch in ("aarch64", "arm64"):
    keys = ("aarch64", "arm64")
else:
    keys = (arch,) if arch else ()
cands = []
for a in rel.get("assets", []):
    n = (a.get("name") or "").lower()
    if not any(x in n for x in ("linux", "ubuntu", "debian")):
        continue
    if not n.endswith((".tar.gz", ".tgz", ".zip", ".tar.xz")):
        continue
    score = 1
    if "beth" in n or "studio" in n:
        score += 2
    if keys and any(k in n for k in keys):
        score += 10
    cands.append((score, a["browser_download_url"]))
cands.sort(key=lambda t: -t[0])
print(cands[0][1] if cands else "")
')"

    if [[ -n "$linux_url" ]]; then
      if install_linux_tarball "$linux_url"; then
        exit 0
      fi
      echo "(falhou extrair o asset — tentando pelo código)"
    fi
    linux_from_source
    exit 0
    ;;
  *)
    echo "Neste SO use o get.ps1 (Windows) ou o site de Releases."
    exit 2
    ;;
esac
