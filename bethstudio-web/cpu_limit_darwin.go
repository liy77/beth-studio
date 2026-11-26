//go:build darwin

package main

// cpu_limit_darwin.go — teto de CPU no macOS.
//
// Antes: duty-cycle SIGCONT/SIGSTOP na árvore do host. Isso fazia o zsh
// imprimir `[N] + pid suspended (signal) cursor-agent` (e qualquer TUI
// interativa) o tempo todo — SIGSTOP em filho de shell = job control.
//
// Agora: renice (setpriority) na árvore. Limite mais “macio”, sem suspender
// processos. O teto de RAM ainda pode pausar (SIGSTOP) se estourar.

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const cpuLimitEvery = 20 * time.Second

// Com que frequência relemos a árvore (processos novos: cursor-agent, builds…).
const darwinLimitRefresh = 2 * time.Second

type darwinHostLimits struct {
	mu         sync.Mutex
	cancel     context.CancelFunc
	cpuPercent int
	ramBytes   uint64
	pids       []int
}

var darLimits darwinHostLimits

func (t *darwinHostLimits) setCPU(pids []int, percent int) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if percent < 0 {
		percent = 0
	}
	if pids != nil {
		t.pids = append([]int(nil), pids...)
	}
	t.cpuPercent = percent
	t.restartLocked()
}

func (t *darwinHostLimits) setRAM(pids []int, bytes uint64) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if pids != nil {
		t.pids = append([]int(nil), pids...)
	}
	t.ramBytes = bytes
	t.restartLocked()
}

func (t *darwinHostLimits) clearAll() {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.cancel != nil {
		t.cancel()
		t.cancel = nil
	}
	list := append([]int(nil), t.pids...)
	t.cpuPercent, t.ramBytes = 0, 0
	if len(list) > 0 {
		signalTree(list, syscall.SIGCONT)
		setTreeNice(list, 0)
	}
}

func (t *darwinHostLimits) restartLocked() {
	if t.cancel != nil {
		t.cancel()
		t.cancel = nil
	}
	list := append([]int(nil), t.pids...)
	if t.cpuPercent <= 0 && t.ramBytes == 0 {
		if len(list) > 0 {
			signalTree(list, syscall.SIGCONT)
			setTreeNice(list, 0)
		}
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	t.cancel = cancel
	go darwinLimitLoop(ctx, list, t.cpuPercent, t.ramBytes)
}

func hostTreeDarwin() ([]int, error) {
	b, err := os.ReadFile(hostPidPath())
	if err != nil {
		return nil, fmt.Errorf("o host não está rodando")
	}
	root, err := strconv.Atoi(strings.TrimSpace(string(b)))
	if err != nil || root <= 1 {
		return nil, fmt.Errorf("o host não está rodando")
	}
	nameOut, err := exec.Command("ps", "-p", strconv.Itoa(root), "-o", "comm=").Output()
	if err != nil {
		return nil, fmt.Errorf("o host não está rodando")
	}
	name := strings.TrimSpace(string(nameOut))
	if !strings.Contains(name, "bethstudio-host") {
		return nil, fmt.Errorf("o host não está rodando")
	}
	out, err := exec.Command("ps", "-axo", "pid=,ppid=").Output()
	if err != nil {
		return nil, err
	}
	kids := map[int][]int{}
	seen := map[int]bool{}
	for _, ln := range strings.Split(string(out), "\n") {
		ln = strings.TrimSpace(ln)
		if ln == "" {
			continue
		}
		var pid, ppid int
		if _, e := fmt.Sscanf(ln, "%d %d", &pid, &ppid); e != nil {
			continue
		}
		kids[ppid] = append(kids[ppid], pid)
		seen[pid] = true
	}
	if !seen[root] {
		return nil, fmt.Errorf("o host não está rodando")
	}
	tree := []int{root}
	for i := 0; i < len(tree); i++ {
		tree = append(tree, kids[tree[i]]...)
	}
	return tree, nil
}

func signalTree(pids []int, sig syscall.Signal) {
	me := os.Getpid()
	for _, p := range pids {
		if p <= 1 || p == me {
			continue
		}
		_ = syscall.Kill(p, sig)
	}
}

// niceForCPUPercent: teto em % → nice (0 = normal; 1..19 = menos CPU).
// 95% → nice 1; 50% → ~10; 5% → 18.
func niceForCPUPercent(percent int) int {
	if percent <= 0 {
		return 0
	}
	n := 19 - (percent*18)/100
	if n < 1 {
		n = 1
	}
	if n > 19 {
		n = 19
	}
	return n
}

func setTreeNice(pids []int, nice int) {
	me := os.Getpid()
	for _, p := range pids {
		if p <= 1 || p == me {
			continue
		}
		_ = syscall.Setpriority(syscall.PRIO_PROCESS, p, nice)
	}
}

func darwinTreeRSS(pids []int) uint64 {
	if len(pids) == 0 {
		return 0
	}
	out, err := exec.Command("ps", "-axo", "pid=,rss=").Output()
	if err != nil {
		return 0
	}
	want := map[int]bool{}
	for _, p := range pids {
		want[p] = true
	}
	var kb uint64
	for _, ln := range strings.Split(string(out), "\n") {
		ln = strings.TrimSpace(ln)
		if ln == "" {
			continue
		}
		var pid int
		var rss uint64
		if _, e := fmt.Sscanf(ln, "%d %d", &pid, &rss); e != nil {
			continue
		}
		if want[pid] {
			kb += rss
		}
	}
	return kb << 10
}

func darwinLimitLoop(ctx context.Context, seed []int, cpuPercent int, ramBytes uint64) {
	nice := niceForCPUPercent(cpuPercent)
	tick := time.NewTicker(darwinLimitRefresh)
	defer tick.Stop()

	apply := func() []int {
		tree := seed
		if t, err := hostTreeDarwin(); err == nil && len(t) > 0 {
			tree = t
			darLimits.mu.Lock()
			darLimits.pids = append([]int(nil), tree...)
			darLimits.mu.Unlock()
		}
		if ramBytes > 0 && darwinTreeRSS(tree) > ramBytes {
			// Estouro de RAM: pausa de verdade (mesmo efeito de antes).
			signalTree(tree, syscall.SIGSTOP)
			return tree
		}
		// Garante que ninguém ficou parado de um ciclo anterior / duty-cycle velho.
		signalTree(tree, syscall.SIGCONT)
		if cpuPercent > 0 {
			setTreeNice(tree, nice)
		} else {
			setTreeNice(tree, 0)
		}
		return tree
	}

	last := apply()
	for {
		select {
		case <-ctx.Done():
			signalTree(last, syscall.SIGCONT)
			setTreeNice(last, 0)
			return
		case <-tick.C:
			last = apply()
		}
	}
}

func applyDarwinCPULimit(percent int) (int, error) {
	tree, err := hostTreeDarwin()
	if err != nil {
		if percent == 0 {
			darLimits.setCPU(nil, 0)
			return 0, nil
		}
		return 0, err
	}
	darLimits.setCPU(tree, percent)
	return len(tree), nil
}

func (h *hub) runCPULimit(ctx context.Context) {
	t := time.NewTimer(5 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			darLimits.setCPU(nil, 0)
			return
		case <-t.C:
		case <-cpuLimit.wake:
		}
		p := cpuLimit.plan(time.Now())
		if !p.idle() {
			var n int
			var msgs []string
			if p.Win >= 0 {
				k, err := applyDarwinCPULimit(p.Win)
				n = k
				if err != nil {
					msgs = append(msgs, err.Error())
				}
			}
			cpuLimit.done(p, n, 0, strings.Join(msgs, " · "))
			h.publishCPULimit()
			if p.Expired {
				lifeLog("limite de CPU dos terminais venceu; tudo volta ao normal")
				trayBalloon("CPU dos terminais de volta ao normal", "O prazo do limite acabou. Os terminais voltaram a usar a CPU toda.")
			}
		}
		t.Reset(cpuLimitEvery)
	}
}
