# 0207 — Apple Container shells on macOS (no WSL)

## What

On macOS, "Novo terminal" lists [Apple Container](https://github.com/apple/container)
entries instead of anything WSL-related:

- Running containers → `container exec -it <id> /bin/sh` (`container.exec.*`)
- Else images → `container run --rm -it <image> /bin/sh` (`container.run.*`)
- Else, if the CLI is installed but the service is down → helper shell
  `container.help` that prints `container system start` instructions

`ShellEntry` / bridge `ShellInfo` use owned `String` ids/labels so the list
can change as containers appear. A Linux folder on spawn becomes
`--workdir` for `container exec|run` (same role as WSL `--cd`).

## Why

macOS has no WSL. Apple Container is the local Linux-container surface on
Apple silicon; the Studio should offer it where Windows offers WSL.

## Files

- `wtinator/src/shells.rs`
- `wezterm/src/cli/bridge.rs`

## Revert

Restore `ShellEntry` `&'static str` fields and drop `apple_container_*`
helpers / `container_or_wsl_spawn_args`.
