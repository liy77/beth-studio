# Scripts do Beth Studio

Os scripts **continuam na raiz** (e em `bethstudio-web/`) para não quebrar atalhos e CI.
Esta pasta é o **índice**, o instalador unificado e os atalhos para o **usuário final**.

## Usuário final (sem Git, sem compilar)

Baixa o último release do GitHub.

### Windows

```powershell
irm https://raw.githubusercontent.com/rodrigo-mcu/beth-studio/main/scripts/get.ps1 | iex
```

| Alternativa | Comando |
| --- | --- |
| **winget** (depois do PR no community) | `winget install -e --id MCU.BethStudio` |
| **winget** já no repo | `winget install --manifest scripts\winget\MCU.BethStudio\0.4.1` |
| **Scoop** | `scoop install .\scripts\scoop\bethstudio.json` |
| Zip portátil | `powershell -File scripts\get.ps1 -Portable` |

Gerar manifests de um release novo: `powershell -File scripts\winget-gen.ps1`.

### macOS e Linux

```bash
curl -fsSL https://raw.githubusercontent.com/rodrigo-mcu/beth-studio/main/scripts/get.sh | bash
```

- **macOS:** baixa o DMG do release (quando existir) e abre para arrastar a `/Applications`.
- **Linux:** se o release tiver tarball (`*linux*.tar.gz` / `.zip`), instala `bethstudio` + `bethstudio-host` em `~/.local/bin`. Sem asset, clona o tag e roda `./scripts/install` (precisa de Rust nightly). A janela do Studio no Linux ainda não vem no release.

Releases: https://github.com/rodrigo-mcu/beth-studio/releases/latest

---

## Desenvolvedor (compilar do código)

| SO | Comando |
| --- | --- |
| **macOS / Linux** | `./scripts/install` |
| **Windows** (cmd) | `scripts\install.cmd` |
| **Windows** (PowerShell) | `powershell -File scripts\install.ps1` |

Atalhos na raiz: `./install` e `install.cmd`.

- **Windows:** compila + instala em `%LOCALAPPDATA%\Beth Studio` (`-Setup` → Setup.exe).
- **macOS:** `pack-bethstudio-macos.sh --install`.
- **Linux:** host+CLI em `~/.local`.

Flags: `--skip-rust`, `--skip-frontend` / `-SkipRust`, `-SkipFrontend`, `-Setup`, `-DryRun`.

---

## Catálogo (scripts atuais — não removidos)

### Rodar no dia a dia

| Script | Onde | Uso |
| --- | --- | --- |
| `run-bethstudio.cmd` | raiz | Windows: sobe o Studio (release) |
| `run-bethstudio-release.cmd` | raiz | idem |
| `run-bethstudio-debug.cmd` | raiz | Windows + `WEZTERM_LOG=debug` |
| `run-bethstudio-macos.command` | raiz | macOS: sobe o binário Go do checkout |
| `run-wezterminator-*.cmd` | raiz | aliases antigos → Studio |

### Compilar / empacotar / instalar

| Script | Onde | Uso |
| --- | --- | --- |
| `bethstudio-web/build.ps1` | web | Frontend + `bethstudio-web.exe` |
| `bethstudio-web/build.cmd` | web | wrapper do build.ps1 |
| `bethstudio-web/deploy-ui.ps1` | web | troca só a UI embutida (sem reiniciar host) |
| `pack-bethstudio-setup.ps1` | raiz | Windows: `dist/BethStudio-Setup.exe` |
| `pack-bethstudio-setup.cmd` | raiz | wrapper |
| `pack-bethstudio-macos.sh` | raiz | macOS: `.app` + DMG (+ `--install`) |
| `scripts/pack-linux.sh` | scripts | Linux: host+CLI → `~/.local` |
| `install-bethstudio-release.ps1` | raiz | copia release Rust → LocalAppData |
| `install-bethstudio-release.cmd` | raiz | wrapper |
| `install-wezterminator-release.*` | raiz | nome antigo (compat) |
| `release.ps1` | raiz | release completo Windows (zip, setup, UI, somas) |
| `scripts/install*` | scripts | **entrada unificada** (esta pasta) |

### Ferramentas / testes

| Script | Onde | Uso |
| --- | --- | --- |
| `bethstudio-web/tools/e2e-restore.ps1` | web | e2e restore |
| `bethstudio-web/tools/makesample.ps1` | web | sample de voz embutido |
| `hooks/claude-tab-status.ps1` | hooks | status de aba Claude |
| `tools/collect-licenses.py` | tools | licenças |

### Upstream (não mexer sem patch)

Scripts em `upstream-wezterm/ci/` e `upstream-wezterm/test-data/` são do wezterm vendido.

---

## Atalhos nesta pasta

Wrappers finos que só encaminham para o script da raiz / `bethstudio-web/` (mesmos argumentos):

- `scripts/run` → `run-bethstudio-macos.command` ou instrução Windows
- `scripts/pack-macos.sh` → `pack-bethstudio-macos.sh`
- `scripts/pack-windows.ps1` → `pack-bethstudio-setup.ps1`
- `scripts/build-studio.ps1` → `bethstudio-web/build.ps1`
- `scripts/get.ps1` / `get.sh` → download do release (usuário)
- `scripts/winget/` + `winget-gen.ps1` → manifests `MCU.BethStudio`
- `scripts/scoop/bethstudio.json` → Scoop
