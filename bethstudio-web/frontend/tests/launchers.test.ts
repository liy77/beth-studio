import { test } from "node:test";
import assert from "node:assert/strict";
import { folderLabel, launchFolders, launcherSide, suggestedLaunchers } from "../src/lib/launchers.ts";

test("pastas do atalho: a dele primeiro, depois as do mesmo lado", () => {
  const folders = [
    { path: "C:\\Repo\\X", side: "windows" as const },
    { path: "/mnt/k/a", side: "wsl" as const },
    { path: "/home/u/p", side: "wsl" as const },
  ];
  assert.deepEqual(launchFolders({ id: "1", name: "c", shell_id: "wsl.debian", cwd: "/home/u/p" }, folders), ["/home/u/p", "/mnt/k/a"]);
  assert.deepEqual(launchFolders({ id: "2", name: "c", shell_id: "pwsh" }, folders), ["C:\\Repo\\X"]);
  assert.equal(launcherSide({ shell_id: "wsl.default" }), "wsl");
});

test("sugestões e rótulo de pasta", () => {
  const s = suggestedLaunchers([
    { id: "cmd", label: "cmd" },
    { id: "pwsh", label: "PowerShell 7" },
    { id: "wsl.debian", label: "WSL · Debian" },
  ]);
  assert.deepEqual(
    s.map((x) => `${x.name}|${x.shell_id}|${x.command}`),
    ["Claude Code (WSL)|wsl.debian|claude", "Claude Code (Windows)|pwsh|claude", "Codex (WSL)|wsl.debian|codex"],
  );
  assert.equal(folderLabel("/mnt/kingston/mcu/repo/infra"), "…/repo/infra");
  assert.equal(folderLabel("C:\\x"), "C:\\x");
});
