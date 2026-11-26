//go:build darwin

package main

// term_window_darwin.go — terminal destacado no macOS: processo filho
// `Beth Studio --term <pane>` com NSWindow própria. Não sobe servidor nem
// ponte: navega no servidor do Studio que o abriu (URL/token por env).
// Enquanto a janela é arrastada, posta /api/term/drag para o Studio
// acender as zonas de soltar (abas / split).

/*
void bethEnableTermDrag(int on);
int bethScreenToClient(int sx, int sy, int *outX, int *outY);
*/
import "C"

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"time"
)

type termWinProc struct {
	cmd  *exec.Cmd
	pane int
}

func (t *termWinProc) Kill() {
	if t.cmd != nil && t.cmd.Process != nil {
		_ = t.cmd.Process.Kill()
	}
}

func (t *termWinProc) Focus() {
	if t.cmd == nil || t.cmd.Process == nil {
		return
	}
	pid := t.cmd.Process.Pid
	_ = exec.Command("osascript", "-e", fmt.Sprintf(
		`tell application "System Events" to set frontmost of first process whose unix id is %d to true`, pid,
	)).Run()
}

func launchTermWindow(s *server, pane int) error {
	self, err := os.Executable()
	if err != nil {
		return err
	}
	if resolved, err := filepath.EvalSymlinks(self); err == nil {
		self = resolved
	}
	cmd := exec.Command(self, "--term", strconv.Itoa(pane))
	cmd.Dir = filepath.Dir(self)
	cmd.Env = append(os.Environ(),
		termEnvURL+"="+fmt.Sprintf("%s/?t=%s&mode=term&pane=%d", s.origin, s.token, pane),
		termEnvAPI+"="+s.origin,
		termEnvToken+"="+s.token,
	)
	if err := launchDetached(cmd); err != nil {
		return fmt.Errorf("não foi possível abrir a janela do terminal: %w", err)
	}
	if s.hub.term.Add(pane, &termWinProc{cmd: cmd, pane: pane}) {
		_ = cmd.Process.Kill()
		return nil
	}
	go func() {
		_ = cmd.Wait()
		s.hub.term.Remove(pane)
	}()
	log.Printf("term: janela do terminal %d aberta (pid %d)", pane, cmd.Process.Pid)
	return nil
}

func studioScreenToClient(x, y int) (int, int, bool) {
	var ox, oy C.int
	if C.bethScreenToClient(C.int(x), C.int(y), &ox, &oy) == 0 {
		return -1, -1, false
	}
	return int(ox), int(oy), true
}

var (
	termDragAPI   string
	termDragToken string
	termDragPane  int
	termDragMu    sync.Mutex
	termDragLast  time.Time
)

//export goTermNativeDrag
func goTermNativeDrag(x, y, end C.int) {
	if termDragAPI == "" {
		return
	}
	now := time.Now()
	termDragMu.Lock()
	if end == 0 && now.Sub(termDragLast) < 40*time.Millisecond {
		termDragMu.Unlock()
		return
	}
	termDragLast = now
	api, tok, pane := termDragAPI, termDragToken, termDragPane
	termDragMu.Unlock()
	go postTermDrag(api, tok, pane, int(x), int(y), end != 0)
}

func postTermDrag(api, token string, pane, x, y int, end bool) {
	body, _ := json.Marshal(map[string]any{
		"pane_id": pane,
		"x":       x,
		"y":       y,
		"end":     end,
	})
	req, err := http.NewRequest(http.MethodPost, api+"/api/term/drag", bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(tokenHeader, token)
	resp, err := (&http.Client{Timeout: 2 * time.Second}).Do(req)
	if err != nil {
		return
	}
	_ = resp.Body.Close()
}

func runTermMode(pane int, devtools bool, winSize string) {
	pageURL := os.Getenv(termEnvURL)
	api := os.Getenv(termEnvAPI)
	tok := os.Getenv(termEnvToken)
	if pageURL == "" || api == "" || tok == "" {
		fatal("--term só é aberto pelo Studio (faltam URL e token)")
	}
	attachParentConsole()
	logClose := setupLog()
	defer logClose()
	settings.load(dataDir())

	termDragAPI = api
	termDragToken = tok
	termDragPane = pane
	C.bethEnableTermDrag(1)

	windowTitle = termTitle(pane)
	go func() {
		fails := 0
		client := &http.Client{Timeout: 2 * time.Second}
		for range time.Tick(3 * time.Second) {
			req, err := http.NewRequest(http.MethodGet, api+"/healthz", nil)
			if err != nil {
				continue
			}
			req.Header.Set(tokenHeader, tok)
			resp, err := client.Do(req)
			if err == nil {
				_ = resp.Body.Close()
				fails = 0
				continue
			}
			if fails++; fails >= 3 {
				log.Printf("term: Studio não responde, fechando a janela")
				os.Exit(0)
			}
		}
	}()

	w, h := 900, 600
	if _, err := fmt.Sscanf(winSize, "%dx%d", &w, &h); err != nil || w < 400 || h < 300 {
		w, h = 900, 600
	}
	log.Printf("bethstudio-web term: terminal %d", pane)
	if err := openWindow(pageURL, devtools, w, h); err != nil {
		messageBox(appTitle, "Não foi possível abrir a janela:\n\n"+err.Error())
	}
}
