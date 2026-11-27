#!/bin/bash
# Wrapper → pack-bethstudio-macos.sh na raiz.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
exec "$root/pack-bethstudio-macos.sh" "$@"
