//go:build windows

package main

// studio_restart_windows.go — "Reiniciar Beth Studio (terminais continuam)"
// na bandeja: abre um Studio novo e sai. O novo espera este processo (e o
// WebView2 dele) terminar antes de pegar a trava de instância e a pasta de
// dados do WebView2. O host e os terminais não são tocados.

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// studioRelaunchExe: o bethstudio-web.exe da pasta do Studio. Depois de uma
// instalação com o Studio aberto, o exe em uso foi renomeado para
// "<nome>.<n>.running" e o novo está no nome normal: abre o novo.
func studioRelaunchExe() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	cand := filepath.Join(filepath.Dir(exe), "bethstudio-web.exe")
	if st, err := os.Stat(cand); err == nil && !st.IsDir() {
		return cand
	}
	return exe
}

// relaunchArgs: os mesmos argumentos, trocando um --after-pid antigo pelo nosso.
func relaunchArgs(args []string, pid int) []string {
	var out []string
	for i := 0; i < len(args); i++ {
		a := args[i]
		if a == "--after-pid" || a == "-after-pid" {
			i++
			continue
		}
		if strings.HasPrefix(a, "--after-pid=") || strings.HasPrefix(a, "-after-pid=") {
			continue
		}
		out = append(out, a)
	}
	return append(out, "--after-pid", strconv.Itoa(pid))
}

func restartStudio() {
	exe := studioRelaunchExe()
	if exe == "" {
		trayMessage("Reiniciar Beth Studio", "Não achei o programa do Beth Studio para abrir de novo.")
		return
	}
	cmd := exec.Command(exe, relaunchArgs(os.Args[1:], os.Getpid())...)
	cmd.Dir = filepath.Dir(exe)
	if err := cmd.Start(); err != nil {
		trayMessage("Reiniciar Beth Studio", fmt.Sprintf("Não consegui abrir o Beth Studio de novo: %v\n\nO Studio continua aberto.", err))
		return
	}
	_ = cmd.Process.Release()
	lifeLog(fmt.Sprintf("reiniciando o Studio pela bandeja (novo pid %d, %s); o host e os terminais continuam", cmd.Process.Pid, exe))
	quitStudio()
}

func trayMessage(title, text string) {
	t, _ := windows.UTF16PtrFromString(text)
	h, _ := windows.UTF16PtrFromString(title)
	_, _, _ = trayProcMessageBox.Call(0, uintptr(unsafe.Pointer(t)), uintptr(unsafe.Pointer(h)), mbIconWarning|mbSetFg|mbTopmost)
}

// waitStudioGone espera o Studio anterior sair (até 30 s) e depois o WebView2
// dele (até 10 s), para a janela nova não brigar pela pasta de dados.
func waitStudioGone(pid int) {
	start := time.Now()
	if h, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(pid)); err == nil {
		ev, _ := windows.WaitForSingleObject(h, 30000)
		_ = windows.CloseHandle(h)
		if ev == uint32(windows.WAIT_TIMEOUT) {
			log.Printf("studio: o Studio anterior (pid %d) não saiu em 30 s; seguindo", pid)
		}
	}
	for time.Since(start) < 40*time.Second {
		ps, err := readProcesses()
		if err != nil {
			break
		}
		left := 0
		for _, p := range ps {
			if int(p.PPID) == pid && strings.EqualFold(p.Name, "msedgewebview2.exe") {
				left++
			}
		}
		if left == 0 {
			break
		}
		time.Sleep(200 * time.Millisecond)
	}
	log.Printf("studio: o Studio anterior (pid %d) saiu em %s", pid, time.Since(start).Round(10*time.Millisecond))
}
