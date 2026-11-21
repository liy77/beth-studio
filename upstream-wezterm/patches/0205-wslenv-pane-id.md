# 0205 — `WEZTERM_PANE` crosses into WSL

**Status:** Implemented 2026-11-21.

## Why

The Studio feature **Retomar sessões do Claude** (`bethstudio-web/agent_resume.go`)
needs to know which Claude Code session runs in which terminal, so that after
the host restarts it can type `claude --resume <id>` in the recreated
terminal. A Claude hook (`bethstudio-tool.exe agent-hook`) records the session
id with the pane id taken from `WEZTERM_PANE`, which `mux/src/domain.rs` sets
for every spawned terminal.

In a WSL terminal the variable did not arrive: `wsl.exe` imports only the
names listed in `WSLENV`, and the host listed only
`TERM:COLORTERM:TERM_PROGRAM:TERM_PROGRAM_VERSION`.

## What

`config/src/config.rs` (`build_prog`) appends `WEZTERM_PANE` to that list.
Since `WSLENV` itself is shared both ways, a Windows program started from
inside WSL (the hook runs the Windows `bethstudio-tool.exe`) gets it too.

Only terminals started by a host with this patch have it; terminals that
were already open keep the old environment.

## Files

- `config/src/config.rs`

## Revert

Drop `:WEZTERM_PANE` from the `WSLENV` string, remove row 0205 from
`PATCHES.md` and this file.
