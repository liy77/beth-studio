// Atalhos para abrir agentes pelo celular (launchers.go). Testado em tests/launchers.test.ts.

export interface Launcher {
  id: string;
  name: string;
  shell_id: string;
  cwd?: string;
  command?: string;
}

export interface LaunchFolder {
  path: string;
  side: "windows" | "wsl";
}

export interface ShellOption {
  id: string;
  label: string;
}

export const isWslShell = (shellId: string) => shellId.startsWith("wsl.");

export const launcherSide = (l: Pick<Launcher, "shell_id">): "windows" | "wsl" => (isWslShell(l.shell_id) ? "wsl" : "windows");

/** Pastas para escolher no celular: a do atalho primeiro, depois as dos terminais abertos do mesmo lado. */
export function launchFolders(l: Launcher, folders: LaunchFolder[]): string[] {
  const side = launcherSide(l);
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (p?: string) => {
    const v = (p ?? "").trim();
    if (v && !seen.has(v.toLowerCase())) {
      seen.add(v.toLowerCase());
      out.push(v);
    }
  };
  add(l.cwd);
  for (const f of folders) if (f.side === side) add(f.path);
  return out;
}

/** Atalhos prontos para começar (o usuário ajusta pasta e shell). */
export function suggestedLaunchers(shells: ShellOption[]): Omit<Launcher, "id">[] {
  const wsl = shells.find((s) => isWslShell(s.id));
  const win = shells.find((s) => s.id === "pwsh") ?? shells.find((s) => s.id === "powershell") ?? shells.find((s) => !isWslShell(s.id));
  const out: Omit<Launcher, "id">[] = [];
  if (wsl) out.push({ name: "Claude Code (WSL)", shell_id: wsl.id, cwd: "", command: "claude" });
  if (win) out.push({ name: "Claude Code (Windows)", shell_id: win.id, cwd: "", command: "claude" });
  if (wsl) out.push({ name: "Codex (WSL)", shell_id: wsl.id, cwd: "", command: "codex" });
  return out;
}

/** Nome curto de uma pasta para botão: os dois últimos níveis. */
export function folderLabel(p: string): string {
  const parts = p.split(/[\\/]+/).filter(Boolean);
  return parts.length <= 2 ? p : "…/" + parts.slice(-2).join("/");
}
