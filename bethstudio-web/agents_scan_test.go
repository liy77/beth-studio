package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestFindAgentBinLookPathAndHome(t *testing.T) {
	dir := t.TempDir()
	bin := filepath.Join(dir, "codex-fake")
	if err := os.WriteFile(bin, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	got := findAgentBin("codex-fake")
	if got != bin {
		t.Fatalf("LookPath: got %q want %q", got, bin)
	}
	if findAgentBin("beth-agent-nao-existe-xyz") != "" {
		t.Fatal("missing bin should be empty")
	}
}

func TestServeAgentsInstalled(t *testing.T) {
	s := &server{}
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/agents/installed", nil)
	s.serveAgentsInstalled(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d", rr.Code)
	}
	var body struct {
		Agents []installedAgent `json:"agents"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Agents == nil {
		t.Fatal("agents should be a list (possibly empty)")
	}
}
