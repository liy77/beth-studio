package main

// launchers.go — atalhos para abrir agentes pelo celular.
//
// Um atalho é: nome, shell, pasta padrão e comando ("claude", "codex
// --full-auto"...). Ficam nas configurações deste PC (Configurações >
// Celular). O celular só escolhe um atalho e, se quiser, troca a pasta por
// uma das pastas dos terminais abertos do mesmo lado (Windows ou WSL); não
// abre terminal com comando livre. Criar e editar atalhos pelo celular só com
// a chave "O celular pode editar os atalhos" ligada no PC (desligada por
// padrão).
//
//	GET  /api/launchers                -> {launchers, phone_edit, shells}         (Studio)
//	POST /api/launchers {launchers, phone_edit}                                    (Studio, só no PC)
//	GET  /api/phone/launchers          -> {launchers, can_edit, shells, folders}  (celular)
//	POST /api/phone/launchers {launchers}                                          (celular, se can_edit)
//	POST /api/phone/launch {id, cwd}   -> {pane_id}                                (celular)

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

// Launcher: um atalho.
type Launcher struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	ShellID string `json:"shell_id"`
	Cwd     string `json:"cwd,omitempty"`
	Command string `json:"command,omitempty"`
}

// LauncherSettings: os atalhos e a chave de edição pelo celular.
type LauncherSettings struct {
	Items     []Launcher `json:"items,omitempty"`
	PhoneEdit bool       `json:"phone_edit,omitempty"`
}

const maxLaunchers = 30

func launcherIsWSL(shellID string) bool { return strings.HasPrefix(shellID, "wsl.") }

// cleanLaunchers valida e normaliza a lista (ids novos para quem não tem).
func cleanLaunchers(in []Launcher) ([]Launcher, error) {
	if len(in) > maxLaunchers {
		return nil, fmt.Errorf("no máximo %d atalhos", maxLaunchers)
	}
	out := make([]Launcher, 0, len(in))
	seen := map[string]bool{}
	for i, l := range in {
		l.Name = strings.TrimSpace(l.Name)
		l.Cwd = strings.TrimSpace(l.Cwd)
		l.Command = strings.TrimSpace(l.Command)
		l.ShellID = strings.TrimSpace(l.ShellID)
		n := i + 1
		switch {
		case l.Name == "" || utf8.RuneCountInString(l.Name) > 40:
			return nil, fmt.Errorf("atalho %d: nome de 1 a 40 caracteres", n)
		case !shellIDRe.MatchString(l.ShellID):
			return nil, fmt.Errorf("%s: escolha o shell", l.Name)
		case len(l.Cwd) > 1024 || strings.ContainsAny(l.Cwd, "\x00\r\n"):
			return nil, fmt.Errorf("%s: pasta inválida", l.Name)
		case len(l.Command) > 300 || strings.ContainsAny(l.Command, "\x00\r\n"):
			return nil, fmt.Errorf("%s: o comando tem que ser uma linha só, até 300 caracteres", l.Name)
		}
		if launcherIsWSL(l.ShellID) && l.Cwd != "" && !strings.HasPrefix(l.Cwd, "/") && !strings.HasPrefix(l.Cwd, "~") {
			return nil, fmt.Errorf("%s: no WSL a pasta é um caminho Linux (/home/..., /mnt/c/...)", l.Name)
		}
		if !launcherIsWSL(l.ShellID) && l.Cwd != "" && windowsCwd(l.Cwd) == "" {
			return nil, fmt.Errorf(`%s: no Windows a pasta começa com a unidade (C:\...)`, l.Name)
		}
		if !reqIDRe.MatchString(l.ID) || seen[l.ID] {
			l.ID = "l" + randomToken()[:10]
		}
		seen[l.ID] = true
		out = append(out, l)
	}
	return out, nil
}

func (st *settingsStore) launchers() LauncherSettings {
	st.mu.Lock()
	defer st.mu.Unlock()
	if st.s.Launchers == nil {
		return LauncherSettings{}
	}
	c := *st.s.Launchers
	c.Items = append([]Launcher(nil), c.Items...)
	return c
}

func (st *settingsStore) setLaunchers(l LauncherSettings) error {
	st.mu.Lock()
	defer st.mu.Unlock()
	st.s.Launchers = &l
	return st.saveLocked()
}

// launchFolder: uma pasta de terminal aberto, para o celular escolher.
type launchFolder struct {
	Path string `json:"path"`
	Side string `json:"side"` // windows | wsl
}

// recentFolders: as pastas dos terminais abertos, sem repetir, por lado.
func recentFolders(list []byte) []launchFolder {
	var ev struct {
		Panes []struct {
			Cwd  string `json:"cwd"`
			Kind string `json:"kind"`
		} `json:"panes"`
	}
	if json.Unmarshal(list, &ev) != nil {
		return []launchFolder{}
	}
	seen := map[string]bool{}
	out := []launchFolder{}
	for _, p := range ev.Panes {
		var f launchFolder
		switch {
		case p.Kind == "wsl":
			f = launchFolder{wslLinuxCwd(p.Cwd), "wsl"}
		case windowsShells[p.Kind] != "":
			f = launchFolder{windowsCwd(p.Cwd), "windows"}
		default:
			continue
		}
		if f.Path == "" || f.Path == "/" {
			continue
		}
		k := f.Side + "|" + strings.ToLower(f.Path)
		if !seen[k] {
			seen[k] = true
			out = append(out, f)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Side != out[j].Side {
			return out[i].Side < out[j].Side
		}
		return strings.ToLower(out[i].Path) < strings.ToLower(out[j].Path)
	})
	return out
}

// launchCwdAllowed: o celular só abre na pasta do atalho ou numa pasta de
// terminal aberto do mesmo lado.
func launchCwdAllowed(l Launcher, cwd string, folders []launchFolder) bool {
	if cwd == "" || cwd == l.Cwd {
		return true
	}
	side := "windows"
	if launcherIsWSL(l.ShellID) {
		side = "wsl"
	}
	for _, f := range folders {
		if f.Side == side && f.Path == cwd {
			return true
		}
	}
	return false
}

func (h *hub) shellsList() []trayShell {
	h.mu.Lock()
	raw := h.shells
	h.mu.Unlock()
	s := parseTrayShells(raw)
	if s == nil {
		s = []trayShell{}
	}
	return s
}

type shellView struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

func shellViews(ss []trayShell) []shellView {
	out := make([]shellView, 0, len(ss))
	for _, s := range ss {
		out = append(out, shellView{s.ID, s.Label})
	}
	return out
}

// launch abre o terminal do atalho e digita o comando nele.
func (h *hub) launch(ctx context.Context, l Launcher, cwd string) (int, error) {
	if h.readOnly {
		return 0, errors.New("modo somente leitura")
	}
	if cwd == "" {
		cwd = l.Cwd
	}
	spec := paneSpec{ShellID: l.ShellID}
	if launcherIsWSL(l.ShellID) {
		spec.Kind = "wsl"
		if gate := h.wslGate; gate != nil {
			distro := wslDistroForShell(l.ShellID, "", listWSLDistros(), defaultWSLDistro())
			if distro != "" {
				if err := gate.Ensure(ctx, distro); err != nil {
					return 0, err
				}
				if strings.HasPrefix(cwd, "/") && !gate.WaitDir(ctx, distro, cwd) {
					return 0, fmt.Errorf("a pasta %s não existe no WSL %s", cwd, distro)
				}
			}
		}
	}
	pane, err := (&hubRestoreEnv{h: h}).Spawn(ctx, spec, cwd)
	if err != nil {
		return 0, err
	}
	lifeLog(fmt.Sprintf("atalho %q aberto pelo celular: terminal #%d (%s, %s): %s", l.Name, pane, l.ShellID, cwd, l.Command))
	if l.Command != "" {
		go func() {
			// o shell novo ainda está subindo (perfil do PowerShell, login do bash)
			time.Sleep(1200 * time.Millisecond)
			if h.bridge == nil {
				return
			}
			_ = h.bridge.write(map[string]any{"op": "send", "pane_id": pane, "data": l.Command})
			time.Sleep(300 * time.Millisecond)
			_ = h.bridge.write(map[string]any{"op": "send", "pane_id": pane, "data": "\r"})
		}()
	}
	return pane, nil
}

// serveLaunchers: o lado do Studio (Configurações > Celular).
func (s *server) serveLaunchers(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		ls := settings.launchers()
		if ls.Items == nil {
			ls.Items = []Launcher{}
		}
		writeJSON(w, http.StatusOK, map[string]any{"launchers": ls.Items, "phone_edit": ls.PhoneEdit, "shells": shellViews(s.hub.shellsList())})
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "use GET ou POST", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		Launchers []Launcher `json:"launchers"`
		PhoneEdit bool       `json:"phone_edit"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&body) != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "pedido inválido"})
		return
	}
	items, err := cleanLaunchers(body.Launchers)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if err := settings.setLaunchers(LauncherSettings{Items: items, PhoneEdit: body.PhoneEdit}); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"launchers": items, "phone_edit": body.PhoneEdit})
}

// servePhoneLaunchers: o lado do celular.
func (s *server) servePhoneLaunchers(w http.ResponseWriter, r *http.Request) {
	s.hub.mu.Lock()
	list := s.hub.lastList
	s.hub.mu.Unlock()
	folders := recentFolders(list)
	ls := settings.launchers()
	if ls.Items == nil {
		ls.Items = []Launcher{}
	}
	switch {
	case r.URL.Path == "/api/phone/launchers" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{"launchers": ls.Items, "can_edit": ls.PhoneEdit, "shells": shellViews(s.hub.shellsList()), "folders": folders})
	case r.URL.Path == "/api/phone/launchers" && r.Method == http.MethodPost:
		if !ls.PhoneEdit {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "Editar atalhos pelo celular está desligado (Configurações > Celular no PC)."})
			return
		}
		var body struct {
			Launchers []Launcher `json:"launchers"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&body) != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "pedido inválido"})
			return
		}
		items, err := cleanLaunchers(body.Launchers)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		if err := settings.setLaunchers(LauncherSettings{Items: items, PhoneEdit: true}); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		lifeLog(fmt.Sprintf("atalhos do celular alterados pelo celular (%d atalhos)", len(items)))
		writeJSON(w, http.StatusOK, map[string]any{"launchers": items})
	case r.URL.Path == "/api/phone/launch" && r.Method == http.MethodPost:
		var body struct {
			ID  string `json:"id"`
			Cwd string `json:"cwd"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&body) != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "pedido inválido"})
			return
		}
		var l *Launcher
		for i := range ls.Items {
			if ls.Items[i].ID == body.ID {
				l = &ls.Items[i]
			}
		}
		if l == nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "esse atalho não existe mais"})
			return
		}
		cwd := strings.TrimSpace(body.Cwd)
		if !launchCwdAllowed(*l, cwd, folders) {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "essa pasta não é a do atalho nem de um terminal aberto"})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
		defer cancel()
		pane, err := s.hub.launch(ctx, *l, cwd)
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "pane_id": pane})
	default:
		http.NotFound(w, r)
	}
}
