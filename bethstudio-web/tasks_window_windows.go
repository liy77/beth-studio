//go:build windows

package main

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	tasksWindowClass = "BethStudioWeb"
	tasksWindowMutex = "Local\\BethStudioTasksWindow"
	tasksAppUserID   = "BethStudio.Tasks"
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
	allowForeground()
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: 0x08000000 | 0x00000008 | 0x00000200,
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("não foi possível abrir o gerenciador de tarefas: %w", err)
	}
	go func() { _ = cmd.Wait() }()
	log.Printf("tasks: janela aberta (pid %d)", cmd.Process.Pid)
	return nil
}

func focusTasksWindow() bool {
	class, _ := windows.UTF16PtrFromString(tasksWindowClass)
	title, _ := windows.UTF16PtrFromString(tasksWindowTitle)
	hwnd, _, _ := procFindWindowW.Call(uintptr(unsafe.Pointer(class)), uintptr(unsafe.Pointer(title)))
	if hwnd == 0 {
		return false
	}
	if iconic, _, _ := procIsIconicW.Call(hwnd); iconic != 0 {
		_, _, _ = procShowWindow.Call(hwnd, 9)
	} else {
		_, _, _ = procShowWindow.Call(hwnd, swShow)
	}
	_, _, _ = procSetForegroundWindow.Call(hwnd)
	return true
}

func claimTasksWindow() bool {
	name, _ := windows.UTF16PtrFromString(tasksWindowMutex)
	_, err := windows.CreateMutex(nil, false, name)
	if err == windows.ERROR_ALREADY_EXISTS {
		focusTasksWindow()
		return false
	}
	setTasksAppUserModelID()
	return true
}

func setTasksAppUserModelID() {
	p, err := windows.UTF16PtrFromString(tasksAppUserID)
	if err != nil {
		return
	}
	_, _, _ = procSetAppID.Call(uintptr(unsafe.Pointer(p)))
}

func releaseTasksClaim() {}
