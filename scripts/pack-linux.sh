#!/bin/bash
# Empacota / instala host + CLI do Beth Studio no Linux.
# A janela nativa do Studio (WebView) ainda é Windows/macOS; aqui sobe o host
# persistente e o CLI `bethstudio` para quem usa o mux no Linux.
#
# Uso:
#   ./scripts/pack-linux.sh              # só compila → dist/linux/
#   ./scripts/pack-linux.sh --install    # compila + instala em ~/.local
#   ./scripts/pack-linux.sh --skip-rust  # reusa binários já em target/release
#
# Prefixo: BETHSTUDIO_PREFIX (padrão: $HOME/.local)
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
dist_default="$root/upstream-wezterm/target/release"
out_dir="$root/dist/linux"
prefix="${BETHSTUDIO_PREFIX:-$HOME/.local}"
skip_rust=0
do_install=0

for arg in "$@"; do
  case "$arg" in
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

need() { command -v "$1" >/dev/null 2>&1 || { echo "falta: $1" >&2; exit 1; }; }
need cargo

echo "==> Beth Studio (Linux): host + CLI"
if [[ "$skip_rust" -eq 0 ]]; then
  need rustup
  echo "==> cargo +nightly build --release (wezterm + wezterm-mux-server)"
  (
    cd "$root/upstream-wezterm"
    # Perl no PATH ajuda openssl-sys em alguns setups
    export PATH="${PATH:-}"
    cargo +nightly build --release -p wezterm -p wezterm-mux-server
  )
fi

cli="$dist_default/bethstudio"
host="$dist_default/bethstudio-host"
# Nomes sem .exe (Linux)
[[ -f "$cli" ]] || cli="$dist_default/wezterm"
[[ -f "$host" ]] || host="$dist_default/wezterm-mux-server"

if [[ ! -x "$cli" && ! -f "$cli" ]]; then
  echo "binário CLI não encontrado em $dist_default (bethstudio / wezterm)" >&2
  exit 1
fi
if [[ ! -x "$host" && ! -f "$host" ]]; then
  echo "binário host não encontrado em $dist_default (bethstudio-host / wezterm-mux-server)" >&2
  exit 1
fi

mkdir -p "$out_dir"
cp -f "$cli" "$out_dir/bethstudio"
cp -f "$host" "$out_dir/bethstudio-host"
chmod +x "$out_dir/bethstudio" "$out_dir/bethstudio-host"

# Launcher: sobe o host se precisar e deixa o CLI no PATH
cat > "$out_dir/bethstudio-host.service.example" <<EOF
# Exemplo systemd user — copie para ~/.config/systemd/user/
[Unit]
Description=Beth Studio host (PTY)
[Service]
ExecStart=$prefix/bin/bethstudio-host
Restart=on-failure
[Install]
WantedBy=default.target
EOF

cat > "$out_dir/README.txt" <<EOF
Beth Studio — pacote Linux (host + CLI)
=======================================
Binários: bethstudio, bethstudio-host

A interface gráfica (Studio) hoje é Windows e macOS.
Neste Linux você usa o host persistente e o CLI da ponte.

Instalar:
  ./scripts/pack-linux.sh --install

Depois:
  bethstudio-host &          # ou o unit systemd de exemplo
  bethstudio cli bridge      # se for anexar um cliente
EOF

echo "OK: $out_dir/bethstudio"
echo "OK: $out_dir/bethstudio-host"

if [[ "$do_install" -eq 1 ]]; then
  bindir="$prefix/bin"
  sharedir="$prefix/share/bethstudio"
  mkdir -p "$bindir" "$sharedir"
  cp -f "$out_dir/bethstudio" "$bindir/bethstudio"
  cp -f "$out_dir/bethstudio-host" "$bindir/bethstudio-host"
  cp -f "$out_dir/README.txt" "$sharedir/README.txt"
  cp -f "$out_dir/bethstudio-host.service.example" "$sharedir/"
  chmod +x "$bindir/bethstudio" "$bindir/bethstudio-host"
  echo "OK: instalado em $bindir"
  echo "    (garanta que $bindir está no PATH)"
  echo "    Studio com janela: use Windows ou macOS por enquanto."
fi
