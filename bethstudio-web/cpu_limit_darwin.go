//go:build darwin

package main

// cpu_limit_darwin.go — teto de CPU no macOS via duty-cycle (SIGCONT/SIGSTOP)
// na árvore do host. O mesmo loop respeita o teto de RAM (ram_limit_darwin.go).

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

const darwinThrottlePeriod = 100 * time.Millisecond

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

func darwinLimitLoop(ctx context.Context, pids []int, cpuPercent int, ramBytes uint64) {
	on := time.Duration(cpuPercent) * darwinThrottlePeriod / 100
	off := darwinThrottlePeriod - on
	if cpuPercent > 0 {
		if on < time.Millisecond {
			on = time.Millisecond
		}
		if off < 0 {
			off = 0
		}
	}
	for {
		select {
		case <-ctx.Done():
			signalTree(pids, syscall.SIGCONT)
			return
		default:
		}
		if ramBytes > 0 && darwinTreeRSS(pids) > ramBytes {
			signalTree(pids, syscall.SIGSTOP)
			select {
			case <-ctx.Done():
				signalTree(pids, syscall.SIGCONT)
				return
			case <-time.After(200 * time.Millisecond):
			}
			continue
		}
		if cpuPercent <= 0 {
			signalTree(pids, syscall.SIGCONT)
			select {
			case <-ctx.Done():
				signalTree(pids, syscall.SIGCONT)
				return
			case <-time.After(200 * time.Millisecond):
			}
			continue
		}
		signalTree(pids, syscall.SIGCONT)
		select {
		case <-ctx.Done():
			signalTree(pids, syscall.SIGCONT)
			return
		case <-time.After(on):
		}
		if off <= 0 {
			continue
		}
		signalTree(pids, syscall.SIGSTOP)
		select {
		case <-ctx.Done():
			signalTree(pids, syscall.SIGCONT)
			return
		case <-time.After(off):
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
