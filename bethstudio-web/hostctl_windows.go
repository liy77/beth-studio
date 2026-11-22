//go:build windows

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
	"sync"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// realHostCtl é o hostCtl de verdade, no Windows.
type realHostCtl struct{}

func newHostCtl() hostCtl { return realHostCtl{} }

func (realHostCtl) Running() bool {
	name, err := windows.UTF16PtrFromString(hostMutex())
	if err != nil {
		return false
	}
	h, err := windows.OpenMutex(windows.SYNCHRONIZE, false, name)
	if err != nil {
		return false
	}
	_ = windows.CloseHandle(h)
	return true
}

// Start sobe o bethstudio-host.exe ao lado do Studio, desanexado e sem
// console, como a GUI sempre fez. O Studio já tirou do próprio ambiente as
// variáveis de sessão de agente (agentenv.go), então o host herda um ambiente limpo.
func (c realHostCtl) Start() error {
	if c.Running() {
		return nil
	}
	exe, err := hostExePath()
	if err != nil {
		return err
	}
	// A atualização com o host vivo deixa bethstudio-host.exe.new: a troca é
	// aqui, com o host parado (antes só a GUI antiga fazia isso).
	for _, l := range applyPendingHostFiles(filepath.Dir(exe)) {
		lifeLog("atualização do host: " + l)
	}
	cmd := exec.Command(exe)
	cmd.Dir = filepath.Dir(exe)
	cmd.Env = append(os.Environ(), "BETHSTUDIO_ACTIVE=1", "WTINATOR_ACTIVE=1")
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: windows.CREATE_NO_WINDOW | windows.DETACHED_PROCESS | windows.CREATE_NEW_PROCESS_GROUP,
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("não foi possível iniciar o host: %w", err)
	}
	pid := cmd.Process.Pid
	go func() { _ = cmd.Wait() }()
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		if c.Running() {
			if _, err := os.Stat(hostSockPath()); err == nil {
				log.Printf("host: iniciado pelo Studio (pid %d)", pid)
				return nil
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	return fmt.Errorf("o host (pid %d) não ficou pronto em 8 s", pid)
}

// RequestQuit: grava quem pediu (host.quit-request) e sinaliza o evento de
// saída do host. Se ele não sair em 5 s, encerra o processo pelo pid file.
// Só é chamado depois de o usuário confirmar "Encerrar tudo".
func (c realHostCtl) RequestQuit(requester string) error {
	exe, _ := os.Executable()
	_ = os.MkdirAll(filepath.Dir(quitRequestPath()), 0o755)
	_ = os.WriteFile(quitRequestPath(), []byte(quitRequestText(time.Now(), os.Getpid(), exe, requester)), 0o644)
	name, err := windows.UTF16PtrFromString(hostQuitEvent())
	if err != nil {
		return err
	}
	ev, err := windows.OpenEvent(windows.EVENT_MODIFY_STATE, false, name)
	if err != nil {
		return errHostQuitUnavailable
	}
	defer windows.CloseHandle(ev)
	if err := windows.SetEvent(ev); err != nil {
		return err
	}
	for i := 0; i < 50; i++ {
		if !c.Running() {
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return c.terminateByPidFile()
}

func (c realHostCtl) terminateByPidFile() error {
	b, err := os.ReadFile(hostPidPath())
	if err != nil {
		return fmt.Errorf("o host não saiu e não há host.pid: %w", err)
	}
	pid, err := strconv.ParseUint(strings.TrimSpace(string(b)), 10, 32)
	if err != nil {
		return err
	}
	h, err := windows.OpenProcess(windows.PROCESS_TERMINATE, false, uint32(pid))
	if err != nil {
		return err
	}
	defer windows.CloseHandle(h)
	lifeLog(fmt.Sprintf("o host não saiu em 5 s; encerrando o pid %d a pedido do usuário", pid))
	return windows.TerminateProcess(h, 0)
}

// guiCheck: o resultado do GUIRunning, guardado. A janela nativa saiu na Fase
// B; procurar por ela tira uma foto de todos os processos do PC (Toolhelp32),
// e o supervisor pergunta a cada 2 s. Com 600 processos isso custava ~0,4
// núcleo em modo kernel (medido em 2026-11-21). "Não está" vale 60 s;
// "está" é conferido de novo a cada vez, para assumir logo quando ela sair.
var guiCheck struct {
	mu  sync.Mutex
	at  time.Time
	yes bool
}

const guiCheckTTL = 60 * time.Second

// GUIRunning: existe um bethterm-gui.exe (a GUI antiga) rodando?
func (realHostCtl) GUIRunning() bool {
	if ignoreOldGUI() {
		return false
	}
	guiCheck.mu.Lock()
	defer guiCheck.mu.Unlock()
	if !guiCheck.yes && !guiCheck.at.IsZero() && time.Since(guiCheck.at) < guiCheckTTL {
		return false
	}
	guiCheck.yes = guiProcessRunning()
	guiCheck.at = time.Now()
	return guiCheck.yes
}

func guiProcessRunning() bool {
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return false
	}
	defer windows.CloseHandle(snap)
	var pe windows.ProcessEntry32
	pe.Size = uint32(unsafe.Sizeof(pe))
	if err := windows.Process32First(snap, &pe); err != nil {
		return false
	}
	for {
		if strings.EqualFold(windows.UTF16ToString(pe.ExeFile[:]), guiExeName) {
			return true
		}
		if err := windows.Process32Next(snap, &pe); err != nil {
			return false
		}
	}
}
