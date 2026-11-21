package main

import (
	"strings"
	"testing"
)

func TestCleanLaunchers(t *testing.T) {
	out, err := cleanLaunchers([]Launcher{
		{Name: " Claude ", ShellID: "wsl.debian", Cwd: "/mnt/k/repo", Command: "claude"},
		{ID: "lkeep", Name: "Codex", ShellID: "pwsh", Cwd: `C:\repo`, Command: "codex"},
	})
	if err != nil || len(out) != 2 || out[0].Name != "Claude" || out[0].ID == "" || out[1].ID != "lkeep" {
		t.Fatalf("%v %+v", err, out)
	}
	bad := []Launcher{
		{Name: "", ShellID: "pwsh"},
		{Name: "x", ShellID: "bad id!"},
		{Name: "x", ShellID: "pwsh", Command: "a\nb"},
		{Name: "x", ShellID: "wsl.debian", Cwd: `C:\repo`},
		{Name: "x", ShellID: "pwsh", Cwd: "/home/u"},
		{Name: strings.Repeat("n", 41), ShellID: "pwsh"},
	}
	for _, b := range bad {
		if _, err := cleanLaunchers([]Launcher{b}); err == nil {
			t.Fatalf("aceitou %+v", b)
		}
	}
	// ids repetidos viram ids novos
	out, _ = cleanLaunchers([]Launcher{{ID: "la", Name: "a", ShellID: "cmd"}, {ID: "la", Name: "b", ShellID: "cmd"}})
	if out[0].ID == out[1].ID {
		t.Fatal("id repetido")
	}
}

func TestRecentFoldersAndAllowed(t *testing.T) {
	list := []byte(`{"panes":[
		{"cwd":"file://h/mnt/k/repo/a","kind":"wsl"},
		{"cwd":"file:///C:/Repo/X","kind":"pwsh"},
		{"cwd":"file://h/mnt/k/repo/a","kind":"wsl"},
		{"cwd":"","kind":"cmd"},
		{"cwd":"file://h/home/u","kind":"ssh"}
	]}`)
	f := recentFolders(list)
	if len(f) != 2 || f[0].Side != "windows" || f[1].Path != "/mnt/k/repo/a" {
		t.Fatalf("%+v", f)
	}
	wsl := Launcher{ShellID: "wsl.debian", Cwd: "/home/u/proj"}
	if !launchCwdAllowed(wsl, "", f) || !launchCwdAllowed(wsl, "/home/u/proj", f) || !launchCwdAllowed(wsl, "/mnt/k/repo/a", f) {
		t.Fatal("pasta permitida recusada")
	}
	if launchCwdAllowed(wsl, f[0].Path, f) || launchCwdAllowed(wsl, "/etc", f) {
		t.Fatal("pasta de outro lado ou qualquer aceita")
	}
}
