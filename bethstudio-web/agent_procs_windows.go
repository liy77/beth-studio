package main

// agent_procs_windows.go — coleta (a cada minuto) e encerramento dos
// "Processos deixados pelos agentes" (agent_procs.go).

import (
	"context"
	"errors"
	"fmt"
	"net/http"
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
		// linha de comando só de quem é filho de shell (os candidatos) e dos
		// runtimes de JavaScript (Codex, Grok... rodam em node): poucos
		if par, ok := byPID[int(p.PPID)]; ok && apShells[name(par)] {
			n.Cmd = apCmdline(p)
		} else if n.Name == "node" || n.Name == "bun" || n.Name == "deno" || agentOfNode(n) != "" {
			// runtimes de JavaScript e os próprios agentes (para separar o
			// servidor em segundo plano, ex. "codex app-server", da sessão)
			n.Cmd = apCmdline(p)
		}
		if n.Name == "claude" {
			n.Cwd = cwd[n.PID]
		}
		// o terminal de cada agente: WEZTERM_PANE no ambiente do processo
		if agentOfNode(n) != "" {
			if pn, ok := apPaneEnv(p); ok {
				n.Pane, n.HasPane = pn, true
			}
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

// apIdentEvery: de quanto em quanto tempo a etiqueta do agente de cada
// terminal é atualizada. O monitor de processos esquecidos usa a mesma leitura
// uma vez por minuto.
const apIdentEvery = 15 * time.Second

// runAgentProcs: lê os processos (Windows e WSL já ligados) a cada 15 s para
// as etiquetas de agente e, a cada minuto, alimenta o monitor de processos.
func (h *hub) runAgentProcs(ctx context.Context) {
	t := time.NewTimer(8 * time.Second) // deixa o Studio subir primeiro
	defer t.Stop()
	var lastMonitor time.Time
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		h.scanProcesses(&lastMonitor)
		t.Reset(apIdentEvery)
	}
}

func (h *hub) scanProcesses(lastMonitor *time.Time) {
	now := time.Now()
	win, _, werr := apWindowsNodes()
	running := apRunningDistros()
	linux := map[string][]apNode{}
	for _, d := range running {
		if nodes, err := apLinuxNodes(d); err == nil {
			linux[d] = nodes
		}
	}
	// etiquetas: um mapa só para os dois lados (os ids de terminal são do host)
	h.mu.Lock()
	list := h.lastList
	h.mu.Unlock()

	agents := paneAgents(win, nil)
	cwds := wslPaneCwds(list)
	for _, nodes := range linux {
		for k, v := range paneAgents(nodes, cwds) {
			if _, ok := agents[k]; !ok {
				agents[k] = v
			}
		}
	}

	h.publishPaneAgents(agents)
	var live []apNode
	live = append(live, win...)
	for _, nodes := range linux {
		live = append(live, nodes...)
	}
	persistLiveAgents(agentSessionsDir(), settings.hostID(), live)

	cfg := settings.agentProcs()
	if cfg.Off || now.Sub(*lastMonitor) < apEvery-time.Second {
		return
	}
	*lastMonitor = now
	minutes := cfg.Minutes
	var fresh []AgentProc
	var items []AgentProc
	if werr == nil {
		items, fresh = agentProcs.update("windows", "", win, now, minutes)
	}
	for _, d := range running {
		nodes, ok := linux[d]
		if !ok {
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

// apKill encerra a árvore do comando do agente que contém o processo
// (apKillRoot: o pipeline inteiro, não só o estágio listado), conferindo que é
// o mesmo processo da lista (PID reciclado não é encerrado).
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
	for _, pid := range apSubtree(nodes, apKillRoot(nodes, it.PID)) {
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
	for _, pid := range apSubtree(nodes, apKillRoot(nodes, it.PID)) {
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

// serveWSLRunning: GET /api/wsl/running -> {running: [...]}. As telas que
// conferem algo dentro do WSL sozinhas só fazem isso nas distros já ligadas.
func serveWSLRunning(w http.ResponseWriter, _ *http.Request) {
	r := apRunningDistros()
	if r == nil {
		r = []string{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"running": r})
}
