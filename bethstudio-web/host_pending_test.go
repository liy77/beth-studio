package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestApplyPendingHostFiles(t *testing.T) {
	dir := t.TempDir()
	w := func(name, body string, mod time.Time) {
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(p, mod, mod); err != nil {
			t.Fatal(err)
		}
	}
	old := time.Now().Add(-48 * time.Hour)
	now := time.Now()
	w("bethstudio-host.exe", "velho", old)
	w("bethstudio-host.exe.new", "novo", now)
	w("conpty.dll", "instalado", now)
	w("conpty.dll.new", "sobra", old) // mais velho: descartar
	w("OpenConsole.exe.new", "só o novo", now)

	lines := applyPendingHostFiles(dir)
	if len(lines) != 3 {
		t.Fatalf("%v", lines)
	}
	read := func(name string) string {
		b, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			return "<ausente>"
		}
		return string(b)
	}
	if read("bethstudio-host.exe") != "novo" || read("bethstudio-host.exe.bak") != "velho" || read("bethstudio-host.exe.new") != "<ausente>" {
		t.Fatal("host não trocado")
	}
	if read("conpty.dll") != "instalado" || read("conpty.dll.new") != "<ausente>" {
		t.Fatal("sobra velha aplicada")
	}
	if read("OpenConsole.exe") != "só o novo" {
		t.Fatal("OpenConsole sem instalado não aplicado")
	}
	if !strings.Contains(strings.Join(lines, "|"), "descartado conpty.dll.new") {
		t.Fatalf("%v", lines)
	}
	if again := applyPendingHostFiles(dir); len(again) != 0 {
		t.Fatalf("segunda vez: %v", again)
	}
}
