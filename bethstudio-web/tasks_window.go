package main

// tasks_window.go — Gerenciador de tarefas em janela OS própria.
//
//	CLI: bethstudio-web --tasks
//	API: POST /api/sysmon/window -> {ok:true}
//
// Um processo à parte (como --db / --sftp), para não ficar sob o vidro
// nativo da barra lateral do Studio.

import (
	"context"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"time"
)

const tasksWindowTitle = "Gerenciador de tarefas"

func (s *server) serveSysmonWindow(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "use POST", http.StatusMethodNotAllowed)
		return
	}
	if s.hub.readOnly {
		writeJSON(w, http.StatusForbidden, map[string]any{"ok": false, "error": "modo somente leitura"})
		return
	}
	if err := openTasksWindow(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// runTasksMode: processo só com o gerenciador (sem bandeja, sem supervisor).
func runTasksMode(noWindow, devtools bool, port int, winSize, devOrig string) {
	if !claimTasksWindow() {
		return
	}
	defer releaseTasksClaim()
	attachParentConsole()
	logClose := setupLog()
	defer logClose()

	settings.load(dataDir())
	secrets.load(dataDir())

	token := randomToken()
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		fatal("não foi possível abrir a porta local: %v", err)
	}
	addr := ln.Addr().(*net.TCPAddr)
	base := fmt.Sprintf("http://127.0.0.1:%d", addr.Port)
	url := fmt.Sprintf("%s/?t=%s&mode=tasks", base, token)

	hub := newHub(false)
	srv := &http.Server{
		Handler:           newServer(token, addr.Port, strings.TrimSpace(devOrig), hub),
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			log.Printf("http: %v", err)
		}
	}()

	windowTitle = tasksWindowTitle
	webviewDataName = "WebView2-tasks"
	log.Printf("bethstudio-web tasks: em %s", base)
	fmt.Fprintln(os.Stdout, url)

	if noWindow {
		select {}
	}
	w, ht := 1180, 800
	if _, err := fmt.Sscanf(winSize, "%dx%d", &w, &ht); err != nil || w < 800 || ht < 500 {
		w, ht = 1180, 800
	}
	if err := openWindow(url, devtools, w, ht); err != nil {
		messageBox("Beth Studio · "+tasksWindowTitle, "Não foi possível abrir a janela:\n\n"+err.Error())
	}
	log.Printf("bethstudio-web tasks: encerrando")
	shutCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutCtx)
}
