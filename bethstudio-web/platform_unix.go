//go:build !windows

package main

import (
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
)

// launchDetached starts a child in its own process group so closing the
// Studio window does not take the host (or a detached window) with it.
func launchDetached(cmd *exec.Cmd) error {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	return cmd.Start()
}

func processAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	err := syscall.Kill(pid, 0)
	return err == nil || err == syscall.EPERM
}

// isStudioPID reports whether pid is a Beth Studio main process, not a
// recycled PID of some other program (macOS reuses PIDs quickly).
func isStudioPID(pid int) bool {
	if pid <= 0 {
		return false
	}
	out, err := exec.Command("ps", "-p", strconv.Itoa(pid), "-o", "args=").Output()
	if err != nil {
		return false
	}
	s := strings.TrimSpace(string(out))
	if s == "" {
		return false
	}
	// App bundle binary is ".../MacOS/Beth Studio"; debug builds are bethstudio-web.
	// Do not match bethstudio-host / bethstudio (bridge) — same .app path prefix.
	return strings.Contains(s, "MacOS/Beth Studio") ||
		strings.HasSuffix(s, "/bethstudio-web") ||
		strings.Contains(s, "/bethstudio-web ")
}

func terminatePID(pid int) error {
	if pid <= 1 {
		return fmt.Errorf("pid inválido")
	}
	return syscall.Kill(pid, syscall.SIGTERM)
}
