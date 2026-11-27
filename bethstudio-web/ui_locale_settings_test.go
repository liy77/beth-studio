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

func TestAPISettingsTermImagesReduceMotionLocale(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, webSettingsFile), []byte(`{"version":2,"default":{"theme":"vscode_dark"}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	prev := settings
	settings = &settingsStore{}
	settings.load(dir)
	t.Cleanup(func() { settings = prev })

	s := &server{}
	postEnabled := func(path string, enabled any) SettingsSnapshot {
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
	postLocale := func(locale string) SettingsSnapshot {
		t.Helper()
		b, _ := json.Marshal(map[string]any{"locale": locale})
		r := httptest.NewRequest(http.MethodPost, "/api/settings/ui-locale", bytes.NewReader(b))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		s.serveAPI(w, r)
		if w.Code != http.StatusOK {
			t.Fatalf("locale %s -> %d %s", locale, w.Code, w.Body.String())
		}
		var snap SettingsSnapshot
		if err := json.Unmarshal(w.Body.Bytes(), &snap); err != nil {
			t.Fatal(err)
		}
		return snap
	}

	snap0 := settings.snapshot()
	if !snap0.TermInlineImages {
		t.Fatalf("imagens no terminal deveriam vir ligadas: %+v", snap0)
	}
	if snap0.ReduceMotion {
		t.Fatalf("reduzir movimento deveria vir desligado: %+v", snap0)
	}
	if snap0.UILocale != "pt" {
		t.Fatalf("idioma padrão pt: %+v", snap0)
	}

	offImg := postEnabled("/api/settings/term-inline-images", false)
	if offImg.TermInlineImages {
		t.Fatalf("desligar imagens: %+v", offImg)
	}
	onMotion := postEnabled("/api/settings/reduce-motion", true)
	if !onMotion.ReduceMotion {
		t.Fatalf("ligar reduzir movimento: %+v", onMotion)
	}
	en := postLocale("en-US")
	if en.UILocale != "en" {
		t.Fatalf("locale en: %+v", en)
	}
	pt := postLocale("pt")
	if pt.UILocale != "pt" {
		t.Fatalf("locale pt: %+v", pt)
	}
}
