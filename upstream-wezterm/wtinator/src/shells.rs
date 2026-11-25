// Shells offered when a terminal is opened (Beth Studio's "novo terminal" list).
//
// Extracted from the old native context menu (patch 0198) so the host CLI
// bridge keeps the same list after the native window was removed.

/// One shell entry for the "New tab" picker.
pub struct ShellEntry {
    pub id: String,
    pub label: String,
    /// Full command line: program + args. Stored as `Vec<String>` because
    /// `config::keyassignment::SpawnCommand::args` takes `Vec<String>`.
    pub args: Vec<String>,
}

/// Default shells offered in the "New tab" picker.
///
/// On Windows, the available shells are:
///   - `cmd.exe` (the Windows console)
///   - `powershell.exe` (Windows PowerShell 5.1)
///   - `pwsh.exe` (PowerShell 7+)
///   - `wsl.exe` (WSL2 — default distro)
///   - `wsl.exe -d <DistroName>` (named WSL distros)
///   - Git Bash (if installed)
///
/// On macOS: login/zsh/bash, then [Apple Container](https://github.com/apple/container)
/// entries (running containers via `container exec`, or images via `container run`).
pub fn default_shells() -> Vec<ShellEntry> {
    #[cfg(windows)]
    let mut shells = windows_shells();
    #[cfg(not(windows))]
    let mut shells = unix_shells();

    // Patch 0183: user-defined entries from the data dir's shells.json.
    shells.extend(custom_shells());

    shells
}

#[cfg(windows)]
fn windows_shells() -> Vec<ShellEntry> {
    let mut shells = vec![
        ShellEntry {
            id: "cmd".into(),
            label: "cmd.exe".into(),
            args: vec!["cmd.exe".to_string()],
        },
        ShellEntry {
            id: "powershell".into(),
            label: "PowerShell 5.1".into(),
            args: vec!["powershell.exe".to_string(), "-NoLogo".to_string()],
        },
        ShellEntry {
            id: "pwsh".into(),
            label: "PowerShell 7+".into(),
            args: vec!["pwsh.exe".to_string(), "-NoLogo".to_string()],
        },
        ShellEntry {
            id: "wsl.default".into(),
            label: "WSL (default distro)".into(),
            args: vec!["wsl.exe".to_string()],
        },
        ShellEntry {
            id: "wsl.ubuntu".into(),
            label: "WSL — Ubuntu".into(),
            args: vec![
                "wsl.exe".to_string(),
                "-d".to_string(),
                "Ubuntu".to_string(),
            ],
        },
        ShellEntry {
            id: "gitbash".into(),
            label: "Git Bash".into(),
            args: vec![
                "C:\\Program Files\\Git\\bin\\bash.exe".to_string(),
                "--login".to_string(),
            ],
        },
    ];

    if let Some(path) = moba_local_bash_path() {
        shells.push(ShellEntry {
            id: "mobaxterm.local".into(),
            label: "MobaXterm local bash".into(),
            args: vec![path, "--login".to_string()],
        });
    }
    shells
}

/// Shells offered on macOS and Linux: the login shell, then zsh and bash
/// when they exist and are not already the login shell. On macOS, Apple
/// Container (https://github.com/apple/container) replaces WSL.
#[cfg(not(windows))]
fn unix_shells() -> Vec<ShellEntry> {
    let mut shells = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let login = std::env::var("SHELL").ok().filter(|p| {
        !p.is_empty() && std::path::Path::new(p).is_file()
    });
    if let Some(path) = login {
        let label = std::path::Path::new(&path)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("shell")
            .to_string();
        seen.insert(path.clone());
        shells.push(ShellEntry {
            id: "login".into(),
            label,
            // Interactive, not a login shell. On macOS `zsh -l` sources
            // /etc/zprofile, which runs path_helper and holds the prompt
            // for more than a second. ~/.zshrc still runs.
            args: vec![path],
        });
    }
    for (id, label, path) in [
        ("zsh", "zsh", "/bin/zsh"),
        ("bash", "bash", "/bin/bash"),
    ] {
        if seen.contains(path) || !std::path::Path::new(path).is_file() {
            continue;
        }
        seen.insert(path.to_string());
        shells.push(ShellEntry {
            id: id.into(),
            label: label.into(),
            args: vec![path.to_string()],
        });
    }
    if shells.is_empty() {
        shells.push(ShellEntry {
            id: "sh".into(),
            label: "sh".into(),
            args: vec!["/bin/sh".to_string()],
        });
    }
    #[cfg(target_os = "macos")]
    shells.extend(apple_container_shells());
    shells
}

/// Apple Container CLI shells (macOS only). Running containers first
/// (`container exec -it`), else images (`container run --rm -it`), else a
/// helper shell that explains how to start the service.
#[cfg(target_os = "macos")]
fn apple_container_shells() -> Vec<ShellEntry> {
    let Some(bin) = container_bin() else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    if let Ok(ids) = container_lines(&bin, &["list", "-q"]) {
        for id in ids {
            if id.is_empty() || !seen.insert(id.clone()) {
                continue;
            }
            let safe = shell_id_token(&id);
            out.push(ShellEntry {
                id: format!("container.exec.{safe}"),
                label: format!("Container · {id}"),
                args: vec![
                    bin.clone(),
                    "exec".into(),
                    "-it".into(),
                    id,
                    "/bin/sh".into(),
                ],
            });
        }
    }
    if out.is_empty() {
        if let Ok(images) = container_lines(&bin, &["image", "list", "-q"]) {
            for img in images.into_iter().take(16) {
                if img.is_empty() || !seen.insert(img.clone()) {
                    continue;
                }
                let safe = shell_id_token(&img);
                out.push(ShellEntry {
                    id: format!("container.run.{safe}"),
                    label: format!("Container · {img}"),
                    args: vec![
                        bin.clone(),
                        "run".into(),
                        "--rm".into(),
                        "-it".into(),
                        img,
                        "/bin/sh".into(),
                    ],
                });
            }
        }
    }
    if out.is_empty() {
        out.push(ShellEntry {
            id: "container.help".into(),
            label: "Apple Container".into(),
            args: vec![
                "/bin/zsh".into(),
                "-lc".into(),
                format!(
                    "echo 'Apple Container (https://github.com/apple/container)'; \
                     '{bin}' system status || true; \
                     echo; \
                     echo 'Se o serviço estiver parado: {bin} system start'; \
                     echo 'Depois: {bin} run -it ubuntu:latest /bin/bash'; \
                     echo; \
                     exec /bin/zsh"
                ),
            ],
        });
    }
    out
}

#[cfg(target_os = "macos")]
fn container_bin() -> Option<String> {
    for p in [
        "/usr/local/bin/container",
        "/opt/homebrew/bin/container",
        "/Applications/Container.app/Contents/MacOS/container",
    ] {
        if std::path::Path::new(p).is_file() {
            return Some(p.to_string());
        }
    }
    let out = std::process::Command::new("/usr/bin/which")
        .arg("container")
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if path.is_empty() || !std::path::Path::new(&path).is_file() {
        return None;
    }
    Some(path)
}

#[cfg(target_os = "macos")]
fn container_lines(bin: &str, args: &[&str]) -> Result<Vec<String>, ()> {
    let out = std::process::Command::new(bin)
        .args(args)
        .output()
        .map_err(|_| ())?;
    if !out.status.success() {
        return Err(());
    }
    Ok(String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect())
}

/// Shell ids only allow `[a-z0-9._-]` (shells.json / bridge).
fn shell_id_token(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        if ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '.' || ch == '_' || ch == '-' {
            out.push(ch);
        } else if ch.is_ascii_uppercase() {
            out.push(ch.to_ascii_lowercase());
        } else {
            out.push('-');
        }
    }
    while out.contains("--") {
        out = out.replace("--", "-");
    }
    out.trim_matches('-').to_string()
}

#[cfg(windows)]
fn moba_local_bash_path() -> Option<String> {
    let mut candidates = Vec::new();
    if let Ok(user_profile) = std::env::var("USERPROFILE") {
        candidates.push(format!(
            "{}\\Documents\\MobaXterm\\slash\\bin\\bash.exe",
            user_profile
        ));
    }

    candidates
        .into_iter()
        .find(|path| std::path::Path::new(path).is_file())
}

/// One entry of `%APPDATA%\bethstudio\shells.json` (patch 0183).
#[derive(serde::Deserialize)]
struct CustomShell {
    id: String,
    label: String,
    args: Vec<String>,
}

/// User-defined shells, read once per process from
/// `%APPDATA%\bethstudio\shells.json`:
///
/// ```json
/// [ { "id": "my.tool", "label": "My tool log", "args": ["powershell.exe", "-NoExit", "-Command", "..."] } ]
/// ```
///
/// Invalid entries (empty args, id outside `[a-z0-9._-]`, duplicate id)
/// are skipped.
fn custom_shells() -> Vec<ShellEntry> {
    static CUSTOM: std::sync::OnceLock<Vec<(String, String, Vec<String>)>> =
        std::sync::OnceLock::new();
    CUSTOM
        .get_or_init(|| {
            let Ok(dir) = crate::session::session_dir() else {
                return Vec::new();
            };
            let Ok(text) = std::fs::read_to_string(dir.join("shells.json")) else {
                return Vec::new();
            };
            parse_custom_shells(&text)
                .into_iter()
                .map(|c| (c.id, c.label, c.args))
                .collect()
        })
        .iter()
        .map(|(id, label, args)| ShellEntry {
            id: id.clone(),
            label: label.clone(),
            args: args.clone(),
        })
        .collect()
}

fn parse_custom_shells(text: &str) -> Vec<CustomShell> {
    let Ok(list) = serde_json::from_str::<Vec<CustomShell>>(text) else {
        log::warn!("bethstudio: shells.json is not a valid list of {{id,label,args}}; ignored");
        return Vec::new();
    };
    let mut seen = std::collections::HashSet::new();
    list.into_iter()
        .filter(|c| {
            !c.args.is_empty()
                && !c.label.trim().is_empty()
                && !c.id.is_empty()
                && c.id
                    .chars()
                    .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || "._-".contains(ch))
                && seen.insert(c.id.clone())
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_shells_not_empty() {
        assert!(!default_shells().is_empty());
    }

    #[test]
    fn custom_shells_keep_valid_unique_entries() {
        let parsed = parse_custom_shells(
            r#"[
                {"id": "my.tool", "label": "My tool", "args": ["powershell.exe", "-NoExit"]},
                {"id": "my.tool", "label": "Duplicate", "args": ["cmd.exe"]},
                {"id": "Bad Id", "label": "Bad", "args": ["cmd.exe"]},
                {"id": "no.args", "label": "No args", "args": []},
                {"id": "no.label", "label": " ", "args": ["cmd.exe"]}
            ]"#,
        );
        let ids: Vec<&str> = parsed.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids, vec!["my.tool"]);
        assert!(parse_custom_shells("not json").is_empty());
    }

    #[test]
    fn shell_id_token_sanitizes() {
        assert_eq!(shell_id_token("ubuntu:latest"), "ubuntu-latest");
        assert_eq!(shell_id_token("My_Box.1"), "my_box.1");
    }
}
