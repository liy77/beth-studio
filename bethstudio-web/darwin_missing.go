//go:build darwin

package main

import (
	"net/http"
	"os/exec"
	"path/filepath"
	"time"

	"os"
	"strconv"
)

func fileMtime(st os.FileInfo) string { return strconv.FormatInt(st.ModTime().UnixNano(), 10) }

func serialListPorts() ([]SerialPortInfo, error) { return nil, nil }

var webviewDataName = "WebView2"

func allowForeground() {}

func sshHelperMain(string) int { return 0 }

func serialHelperMain(string) int { return 0 }

func openInSystemBrowser(raw string) { _ = exec.Command("open", raw).Run() }

func serveLocalFileCreate(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusNotImplemented, map[string]string{"error": "criar arquivo não está ligado neste build"})
}

func serveLocalFileOpenDialog(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusNotImplemented, map[string]string{"error": "abra o arquivo pela pasta da guia"})
}

func serveLocalFileReveal(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path string `json:"path"`
	}
	if sshDecodePOST(w, r, &body) {
		_ = openWithSystem(body.Path)
	}
}

func serveLocalFileSaveAs(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusNotImplemented, map[string]string{"error": "salvar como não está ligado neste build"})
}

func serveLocalFileWrite(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusNotImplemented, map[string]string{"error": "salvar não está ligado neste build"})
}

func waitStudioGone(pid int) {
	deadline := time.Now().Add(30 * time.Second)
	for processAlive(pid) && time.Now().Before(deadline) {
		time.Sleep(200 * time.Millisecond)
	}
}

func launchSFTPWindow(hostID string) error {
	self, err := os.Executable()
	if err != nil {
		return err
	}
	cmd := exec.Command(self, "--sftp", hostID)
	cmd.Dir = filepath.Dir(self)
	if err := launchDetached(cmd); err != nil {
		return err
	}
	go func() { _ = cmd.Wait() }()
	return nil
}

func platformDownloadsDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "Downloads"), nil
}

func revealDownloaded(path string) *exec.Cmd {
	return exec.Command("open", "-R", path)
}

func readDefaultWSLDistro() string { return "" }

func revealInExplorer(path string, exists bool) error {
	if exists {
		return revealDownloaded(path).Start()
	}
	return exec.Command("open", filepath.Dir(path)).Start()
}
