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

func TestAPISettingsPasteImagePreview(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, webSettingsFile), []byte(`{"version":2,"default":{"theme":"vscode_dark"}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	prev := settings
	settings = &settingsStore{}
	settings.load(dir)
	t.Cleanup(func() { settings = prev })

	s := &server{}
	post := func(enabled any) SettingsSnapshot {
		t.Helper()
		b, _ := json.Marshal(map[string]any{"enabled": enabled})
		r := httptest.NewRequest(http.MethodPost, "/api/settings/paste-image-preview", bytes.NewReader(b))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		s.serveAPI(w, r)
		if w.Code != http.StatusOK {
			t.Fatalf("%v -> %d %s", enabled, w.Code, w.Body.String())
		}
		var snap SettingsSnapshot
		if err := json.Unmarshal(w.Body.Bytes(), &snap); err != nil {
			t.Fatal(err)
		}
		return snap
	}

	// Ausente no arquivo = ligado.
	if !settings.snapshot().PasteImagePreview {
		t.Fatalf("padrão deveria ser ligado")
	}
	off := post(false)
	if off.PasteImagePreview {
		t.Fatalf("desligar: %+v", off)
	}
	on := post(true)
	if !on.PasteImagePreview {
		t.Fatalf("ligar: %+v", on)
	}

	// Sem enabled = 400.
	r := httptest.NewRequest(http.MethodPost, "/api/settings/paste-image-preview", bytes.NewReader([]byte(`{}`)))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.serveAPI(w, r)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("sem enabled: %d", w.Code)
	}
}
