package main

// agents_scan.go — GET /api/agents/installed: quais CLIs de agente estão
// no PATH deste computador (Claude, Codex, Cursor, Grok, Gemini).

import (
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

type installedAgent struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Command string `json:"command"`
	Path    string `json:"path"`
}

var agentScanSpecs = []struct {
	id, name, cmd string
}{
	{"claude", "Claude Code", "claude"},
	{"codex", "Codex", "codex"},
	{"cursor", "Cursor Agent", "cursor-agent"},
	{"grok", "Grok", "grok"},
	{"gemini", "Gemini CLI", "gemini"},
}

func findAgentBin(name string) string {
	if p, err := exec.LookPath(name); err == nil {
		return p
	}
	home, _ := os.UserHomeDir()
	var cands []string
	if home != "" {
		cands = append(cands,
			filepath.Join(home, ".local", "bin", name),
			filepath.Join(home, ".local", "bin", name+".exe"),
		)
		if runtime.GOOS == "windows" {
			cands = append(cands,
				filepath.Join(home, "AppData", "Local", "Programs", name, name+".exe"),
				filepath.Join(os.Getenv("LOCALAPPDATA"), name+".exe"),
			)
		}
	}
	if runtime.GOOS == "darwin" {
		cands = append(cands,
			filepath.Join("/opt/homebrew/bin", name),
			filepath.Join("/usr/local/bin", name),
		)
	}
	if runtime.GOOS == "windows" {
		cands = append(cands, name+".exe")
	}
	for _, p := range cands {
		if p == "" {
			continue
		}
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p
		}
	}
	return ""
}

func scanInstalledAgents() []installedAgent {
	out := make([]installedAgent, 0, len(agentScanSpecs))
	for _, s := range agentScanSpecs {
		if p := findAgentBin(s.cmd); p != "" {
			out = append(out, installedAgent{ID: s.id, Name: s.name, Command: s.cmd, Path: p})
		}
	}
	return out
}

func (s *server) serveAgentsInstalled(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "método não permitido", http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"agents": scanInstalledAgents()})
}
