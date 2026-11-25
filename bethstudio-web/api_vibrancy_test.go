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

func TestAPISettingsUIVibrancyAndGlass(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, webSettingsFile), []byte(`{"version":2,"default":{"theme":"vscode_dark"}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	prev := settings
	settings = &settingsStore{}
	settings.load(dir)
	t.Cleanup(func() { settings = prev })

	s := &server{}
	post := func(body any) SettingsSnapshot {
		t.Helper()
		b, _ := json.Marshal(body)
		r := httptest.NewRequest(http.MethodPost, "/api/settings/ui", bytes.NewReader(b))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		s.serveAPI(w, r)
		if w.Code != http.StatusOK {
			t.Fatalf("%v -> %d %s", body, w.Code, w.Body.String())
		}
		var snap SettingsSnapshot
		if err := json.Unmarshal(w.Body.Bytes(), &snap); err != nil {
			t.Fatal(err)
		}
		return snap
	}

	on := post(map[string]any{"vibrancy": true})
	if !on.UITheme.Vibrancy {
		t.Fatalf("ligar: %+v", on.UITheme)
	}
	off := post(map[string]any{"vibrancy": false})
	if off.UITheme.Vibrancy {
		t.Fatalf("desligar: %+v", off.UITheme)
	}
	power := post(map[string]any{"glass": 40})
	if power.UITheme.Glass != 40 {
		t.Fatalf("glass: %+v", power.UITheme)
	}
	if power.UITheme.Vibrancy {
		t.Fatalf("glass não pode religar vibrancy: %+v", power.UITheme)
	}
	again := post(map[string]any{"vibrancy": true})
	if !again.UITheme.Vibrancy || again.UITheme.Glass != 40 {
		t.Fatalf("religar mantém glass: %+v", again.UITheme)
	}
}
