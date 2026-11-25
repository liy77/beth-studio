//go:build darwin

package main

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func openTasksWindow() error {
	if focusTasksWindow() {
		return nil
	}
	self, err := os.Executable()
	if err != nil {
		return err
	}
	if resolved, err := filepath.EvalSymlinks(self); err == nil {
		self = resolved
	}
	cmd := exec.Command(self, "--tasks")
	cmd.Dir = filepath.Dir(self)
	if err := launchDetached(cmd); err != nil {
		return fmt.Errorf("não foi possível abrir o gerenciador de tarefas: %w", err)
	}
	go func() { _ = cmd.Wait() }()
	log.Printf("tasks: janela aberta (pid %d)", cmd.Process.Pid)
	return nil
}

func focusTasksWindow() bool {
	path := tasksPIDFile()
	if path == "" {
		return false
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	pid, _ := strconv.Atoi(strings.TrimSpace(string(b)))
	if pid <= 0 || pid == os.Getpid() || !processAlive(pid) {
		return false
	}
	_ = os.WriteFile(tasksFocusFile(), []byte("focus\n"), 0o644)
	// Também ativa pelo osascript (o processo filho observa o arquivo).
	_ = exec.Command("osascript", "-e", fmt.Sprintf(`tell application "System Events" to set frontmost of first process whose unix id is %d to true`, pid)).Run()
	return true
}

func claimTasksWindow() bool {
	path := tasksPIDFile()
	if path == "" {
		return true
	}
	if b, err := os.ReadFile(path); err == nil {
		pid, _ := strconv.Atoi(strings.TrimSpace(string(b)))
		if pid > 0 && pid != os.Getpid() && processAlive(pid) {
			_ = os.WriteFile(tasksFocusFile(), []byte("focus\n"), 0o644)
			_ = exec.Command("osascript", "-e", fmt.Sprintf(`tell application "System Events" to set frontmost of first process whose unix id is %d to true`, pid)).Run()
			return false
		}
	}
	_ = os.MkdirAll(filepath.Dir(path), 0o755)
	_ = os.WriteFile(path, []byte(strconv.Itoa(os.Getpid())), 0o644)
	return true
}

func releaseTasksClaim() {
	path := tasksPIDFile()
	b, err := os.ReadFile(path)
	if err != nil {
		return
	}
	pid, _ := strconv.Atoi(strings.TrimSpace(string(b)))
	if pid == os.Getpid() {
		_ = os.Remove(path)
	}
}

func tasksPIDFile() string {
	dir := dataDir()
	if dir == "" {
		return ""
	}
	return filepath.Join(dir, "tasks.pid")
}

func tasksFocusFile() string {
	dir := dataDir()
	if dir == "" {
		return ""
	}
	return filepath.Join(dir, "tasks.focus")
}

func watchTasksFocus() {
	path := tasksFocusFile()
	if path == "" {
		return
	}
	_ = os.Remove(path)
	go func() {
		for {
			time.Sleep(400 * time.Millisecond)
			if _, err := os.Stat(path); err != nil {
				continue
			}
			_ = os.Remove(path)
			if bringStudioForward != nil {
				bringStudioForward()
			}
		}
	}()
}

// silence
var _ = syscall.SIGTERM
