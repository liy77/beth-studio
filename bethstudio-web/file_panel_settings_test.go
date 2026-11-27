package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestAPISettingsFilesSideEditorAndFollow(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, webSettingsFile), []byte(`{"version":2,"default":{"theme":"vscode_dark"}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	prev := settings
	settings = &settingsStore{}
	settings.load(dir)
	t.Cleanup(func() { settings = prev })

	s := &server{}
	post := func(path string, enabled any) SettingsSnapshot {
		t.Helper()
		b, _ := json.Marshal(map[string]any{"enabled": enabled})
		r := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(b))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		s.serveAPI(w, r)
		if w.Code != http.StatusOK {
			t.Fatalf("%s %v -> %d %s", path, enabled, w.Code, w.Body.String())
		}
		var snap SettingsSnapshot
		if err := json.Unmarshal(w.Body.Bytes(), &snap); err != nil {
			t.Fatal(err)
		}
		return snap
	}

	snap0 := settings.snapshot()
	if snap0.FilesSideEditor || snap0.FollowAgentFile {
		t.Fatalf("padrão deveria ser desligado: %+v", snap0)
	}
	onSide := post("/api/settings/files-side-editor", true)
	if !onSide.FilesSideEditor {
		t.Fatalf("ligar side editor: %+v", onSide)
	}
	onFollow := post("/api/settings/follow-agent-file", true)
	if !onFollow.FollowAgentFile {
		t.Fatalf("ligar follow: %+v", onFollow)
	}
	off := post("/api/settings/follow-agent-file", false)
	if off.FollowAgentFile {
		t.Fatalf("desligar follow: %+v", off)
	}
}
