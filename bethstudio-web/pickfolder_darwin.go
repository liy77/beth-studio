//go:build darwin

package main

// pickfolder_darwin.go — POST /api/pick-folder {"initial"?} abre o
// NSOpenPanel (pastas) e devolve o caminho, como no Windows.

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
)

// Um dialogo nativo por vez (igual ao saveDialogBusy do Windows).
var pickFolderBusy sync.Mutex

func pickFolderInitial(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	clean, err := validateLocalPath(raw)
	if err != nil {
		return ""
	}
	st, err := os.Stat(clean)
	if err != nil || !st.IsDir() {
		return ""
	}
	return clean
}

func servePickFolder(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "método não permitido", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Initial string `json:"initial"`
	}
	err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&req)
	if err != nil && err != io.EOF {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "JSON inválido"})
		return
	}
	if !pickFolderBusy.TryLock() {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "já existe uma janela de pastas aberta"})
		return
	}
	defer pickFolderBusy.Unlock()
	path, picked, err := nativePickFolder(pickFolderInitial(req.Initial))
	if err != nil {
		log.Printf("pick-folder: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "não foi possível abrir a janela de pastas"})
		return
	}
	if !picked {
		writeJSON(w, http.StatusOK, map[string]any{"picked": false})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"picked": true, "path": path})
}
