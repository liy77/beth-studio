package main

// agent_procs_windows.go — coleta (a cada minuto) e encerramento dos
// "Processos deixados pelos agentes" (agent_procs.go).

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

const apEvery = time.Minute

// filetime (100 ns desde 1601) -> unix (s)
func apUnix(ft int64) int64 { return (ft - 116444736000000000) / 10000000 }

var apCmdCache = struct {
	sync.Mutex
	m map[procKey]string
}{m: map[procKey]string{}}

// apCmdline: a linha de comando (ProcessCommandLineInformation, Windows 8.1+).
func apCmdline(p *procInfo) string {
	k := p.key()
	apCmdCache.Lock()
	if c, ok := apCmdCache.m[k]; ok {
		apCmdCache.Unlock()
		return c
	}
	apCmdCache.Unlock()
	c := ""
	if h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, p.PID); err == nil {
		buf := make([]byte, 8<<10)
		var ret uint32
		const processCommandLineInformation = 60
		if windows.NtQueryInformationProcess(h, processCommandLineInformation, unsafe.Pointer(&buf[0]), uint32(len(buf)), &ret) == nil {
			us := (*windows.NTUnicodeString)(unsafe.Pointer(&buf[0]))
			if us.Length > 0 && us.Buffer != nil {
				c = windows.UTF16PtrToString(us.Buffer)
				if n := int(us.Length / 2); n < len(c) {
					c = c[:n]
				}
			}
		}
		_ = windows.CloseHandle(h)
	}
	apCmdCache.Lock()
	if len(apCmdCache.m) > 4000 {
		apCmdCache.m = map[procKey]string{}
	}
	apCmdCache.m[k] = c
	apCmdCache.Unlock()
	return c
}

func apWindowsNodes() ([]apNode, map[int]*procInfo, error) {
	ps, err := readProcesses()
	if err != nil {
		return nil, nil, err
	}
	byPID := map[int]*procInfo{}
	for _, p := range ps {
		byPID[int(p.PID)] = p
	}
	name := func(p *procInfo) string { return strings.TrimSuffix(strings.ToLower(p.Name), ".exe") }
	// pasta de cada claude.exe: o registro de sessões do próprio Claude
	cwd := map[int]string{}
	if h := windowsHomeDir(); h != "" {
		for _, s := range readClaudeSessions(filepath.Join(h, ".claude", "sessions")) {
			cwd[s.PID] = s.Cwd
		}
	}
	nodes := make([]apNode, 0, len(ps))
	for _, p := range ps {
		n := apNode{PID: int(p.PID), PPID: int(p.PPID), Name: name(p), Start: apUnix(p.Created), CPUSec: float64(p.CPUTime) / 1e7, Mem: p.WS}
		// linha de comando só de quem é filho de shell (os candidatos): poucos
		if par, ok := byPID[int(p.PPID)]; ok && apShells[name(par)] {
			n.Cmd = apCmdline(p)
		}
		if n.Name == "claude" {
			n.Cwd = cwd[n.PID]
		}
		nodes = append(nodes, n)
	}
	return nodes, byPID, nil
}

// apRunningDistros: só as distros que já estão rodando (nunca liga uma parada).
func apRunningDistros() []string {
	o, err := runHiddenOutput(3*time.Second, system32("wsl.exe"), "-l", "--running", "-q")
	names := parseWSLRunningNames(o)
	if err != nil && len(names) == 0 {
		return nil
	}
	var out []string
	for _, n := range names {
		if safeDistroName(n) && !wslHelperDistro(n) {
			out = append(out, n)
		}
	}
	return out
}

func apLinuxNodes(distro string) ([]apNode, error) {
	// confere de novo logo antes: `wsl -d X` ligaria uma distro que acabou de parar
	still := false
	for _, d := range apRunningDistros() {
		still = still || d == distro
	}
	if !still {
		return nil, errors.New("parada")
	}
	o, err := runHiddenOutput(10*time.Second, system32("wsl.exe"), "-d", distro, "-e", "sh", "-c", apLinuxScript)
	if err != nil && len(o) == 0 {
		return nil, err
	}
	return parseLinuxProcs(string(o)), nil
}

// runAgentProcs: o laço de um minuto. Só trabalha com o monitor ligado.
func (h *hub) runAgentProcs(ctx context.Context) {
	t := time.NewTimer(30 * time.Second) // deixa o Studio subir primeiro
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		cfg := settings.agentProcs()
		if !cfg.Off {
			h.scanAgentProcs(cfg.Minutes)
		}
		t.Reset(apEvery)
	}
}

func (h *hub) scanAgentProcs(minutes int) {
	now := time.Now()
	var fresh []AgentProc
	var items []AgentProc
	if nodes, _, err := apWindowsNodes(); err == nil {
		items, fresh = agentProcs.update("windows", "", nodes, now, minutes)
	}
	running := apRunningDistros()
	for _, d := range running {
		nodes, err := apLinuxNodes(d)
		if err != nil {
			continue
		}
		var f []AgentProc
		items, f = agentProcs.update("wsl", d, nodes, now, minutes)
		fresh = append(fresh, f...)
	}
	// distro que parou: os itens dela somem
	agentProcs.mu.Lock()
	alive := map[string]bool{"": true}
	for _, d := range running {
		alive[d] = true
	}
	var keep []AgentProc
	for _, it := range agentProcs.items {
		if it.Side == "windows" || alive[it.Distro] {
			keep = append(keep, it)
		}
	}
	agentProcs.items = keep
	agentProcs.mu.Unlock()
	items = agentProcs.list()
	h.publishAgentProcs(items)
	if len(fresh) > 0 {
		title, text := apAlertText(fresh, minutes)
		trayBalloon(title, text)
	}
}

// apKill encerra o processo e os descendentes dele, conferindo que é o mesmo
// processo da lista (PID reciclado não é encerrado).
func apKill(it AgentProc, _ []apNode) error {
	if it.Side == "wsl" {
		return apKillLinux(it)
	}
	nodes, byPID, err := apWindowsNodes()
	if err != nil {
		return err
	}
	root, ok := byPID[it.PID]
	if !ok || apAbs(apUnix(root.Created)-it.Started) > 3 {
		return errors.New("o processo já terminou")
	}
	self := os.Getpid()
	host := int(hostPIDFromFile())
	var firstErr error
	for _, pid := range apSubtree(nodes, it.PID) {
		if pid == self || pid == host || pid <= 4 {
			continue
		}
		p := byPID[pid]
		if p == nil || isConsoleHost(p.Name) || strings.HasPrefix(strings.ToLower(p.Name), "bethstudio") {
			continue
		}
		h, err := windows.OpenProcess(windows.PROCESS_TERMINATE|windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
		if err != nil {
			if firstErr == nil && pid == it.PID {
				firstErr = err
			}
			continue
		}
		// confere a hora de criação de novo antes de encerrar
		var c, e, k, u windows.Filetime
		if windows.GetProcessTimes(h, &c, &e, &k, &u) == nil && int64(c.Nanoseconds()/100)+116444736000000000 != p.Created {
			_ = windows.CloseHandle(h)
			continue
		}
		if err := windows.TerminateProcess(h, 1); err != nil && firstErr == nil && pid == it.PID {
			firstErr = err
		}
		_ = windows.CloseHandle(h)
	}
	if firstErr != nil {
		return fmt.Errorf("não consegui encerrar: %w", firstErr)
	}
	return nil
}

func apKillLinux(it AgentProc) error {
	if !safeDistroName(it.Distro) {
		return errors.New("distro inválida")
	}
	nodes, err := apLinuxNodes(it.Distro)
	if err != nil {
		return fmt.Errorf("o WSL %s não respondeu: %w", it.Distro, err)
	}
	var root *apNode
	for i := range nodes {
		if nodes[i].PID == it.PID {
			root = &nodes[i]
		}
	}
	if root == nil || apAbs(root.Start-it.Started) > 3 {
		return errors.New("o processo já terminou")
	}
	var pids []string
	for _, pid := range apSubtree(nodes, it.PID) {
		if pid > 1 {
			pids = append(pids, strconv.Itoa(pid))
		}
	}
	list := strings.Join(pids, " ")
	// TERM primeiro; o que não sair em 3 s leva KILL
	script := "kill -TERM " + list + " 2>/dev/null; sleep 3; kill -KILL " + list + " 2>/dev/null; exit 0"
	if _, err := runHiddenOutput(15*time.Second, system32("wsl.exe"), "-d", it.Distro, "-e", "sh", "-c", script); err != nil {
		return fmt.Errorf("não consegui encerrar no WSL: %w", err)
	}
	return nil
}
