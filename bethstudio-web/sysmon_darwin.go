//go:build darwin

package main

// sysmon_darwin.go — Gerenciador de tarefas no macOS: RAM/CPU do sistema,
// processos do Beth Studio e CPU/RAM de cada terminal (árvore sob o host).

import (
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"

	"golang.org/x/sys/unix"
)

// pid ppid etime time rss args…  (args pode ter espaços: "Beth Studio")
var darwinPSLine = regexp.MustCompile(`^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(.*)$`)

type sampler struct {
	prevCPU map[uint32]int64 // CPUTime em segundos (ps -o time=)
	prevAt  time.Time
	ncpu    int
	hist    []float64
	stable  map[procKey]paneMatch
}

func newSampler() *sampler {
	return &sampler{
		prevCPU: map[uint32]int64{},
		ncpu:    runtime.NumCPU(),
		stable:  map[procKey]paneMatch{},
	}
}

func (s *sampler) close() {}

func (s *sampler) prime(panes func() []PaneLite) {
	_ = s.sample(func() []PaneLite { return nil })
	time.Sleep(250 * time.Millisecond)
	_ = s.sample(panes)
	s.hist = nil
}

func (s *sampler) sample(panes func() []PaneLite) *SysmonSnapshot {
	start := time.Now()
	snap := &SysmonSnapshot{At: start}
	readDarwinMemory(&snap.System)
	snap.System.UptimeSec = darwinUptime()
	if n, err := unix.SysctlUint64("hw.ncpu"); err == nil && n > 0 {
		s.ncpu = int(n)
	}
	if s.ncpu <= 0 {
		s.ncpu = runtime.NumCPU()
	}

	procs, _ := readDarwinProcesses()
	snap.System.Procs = len(procs)

	// CPU% por processo (fração da máquina inteira), como no Windows.
	dt := start.Sub(s.prevAt)
	next := map[uint32]int64{}
	for _, p := range procs {
		next[p.PID] = p.CPUTime
		if old, ok := s.prevCPU[p.PID]; ok && !s.prevAt.IsZero() && dt > 50*time.Millisecond && p.PID != 0 {
			delta := float64(p.CPUTime - old) // segundos de CPU
			if delta < 0 {
				delta = 0
			}
			p.CPU = delta / (dt.Seconds() * float64(s.ncpu)) * 100
			if p.CPU < 0 {
				p.CPU = 0
			}
		}
	}
	s.prevCPU, s.prevAt = next, start

	var sysCPU float64
	for _, p := range procs {
		sysCPU += p.CPU
	}
	if sysCPU > 100 {
		sysCPU = 100
	}
	snap.System.CPU = round1(sysCPU)
	snap.CPUHistory = s.pushHist(snap.System.CPU)

	var root unix.Statfs_t
	if unix.Statfs("/", &root) == nil && root.Blocks > 0 {
		bsize := uint64(root.Bsize)
		total := root.Blocks * bsize
		free := root.Bavail * bsize
		snap.Disk = DiskStat{Drive: "/", Total: total, Free: free}
	}
	snap.GPU = GPUStat{Available: false, Note: "GPU detalhada ainda não no Mac"}

	tree := buildTree(procs)
	host := findDarwinHost(procs, tree)
	paneList := []PaneLite{}
	if panes != nil {
		paneList = panes()
	}
	titles := map[procKey]string{}
	snap.Terminals, snap.Match, s.stable = buildTerminals(tree, host, paneList, titles, s.stable)
	if snap.Match.Note == "" {
		snap.Match.Note = "no Mac a associação terminal↔processo usa a ordem sob o host (sem título de console)"
	}
	snap.BethStudio = buildBethStudioDarwin(tree, procs, host)
	snap.WSL = WSLStat{Note: "WSL só no Windows"}
	snap.SampleMs = float64(time.Since(start).Milliseconds())
	return snap
}

func (s *sampler) pushHist(v float64) []float64 {
	s.hist = append(s.hist, round1(v))
	if len(s.hist) > 60 {
		s.hist = s.hist[len(s.hist)-60:]
	}
	out := make([]float64, len(s.hist))
	copy(out, s.hist)
	return out
}

func hostPIDFromFile() uint32 {
	b, err := os.ReadFile(filepath.Join(dataDir(), "host.pid"))
	if err != nil {
		return 0
	}
	v, _ := strconv.ParseUint(strings.TrimSpace(string(b)), 10, 32)
	return uint32(v)
}

func findDarwinHost(procs []*procInfo, tree *procTree) *procInfo {
	want := hostPIDFromFile()
	var hosts []*procInfo
	for _, p := range procs {
		n := strings.ToLower(p.Name)
		if strings.Contains(n, "bethstudio-host") {
			hosts = append(hosts, p)
			if p.PID == want {
				return p
			}
		}
	}
	if len(hosts) == 0 {
		return nil
	}
	best := hosts[0]
	for _, h := range hosts[1:] {
		if len(tree.children[h.PID]) > len(tree.children[best.PID]) {
			best = h
		}
	}
	return best
}

func readDarwinMemory(st *SysStat) {
	total, _ := unix.SysctlUint64("hw.memsize")
	st.RAMTotal = total
	out, err := exec.Command("vm_stat").Output()
	if err != nil {
		return
	}
	page := uint64(4096)
	var free, inactive, speculative, purgeable uint64
	for _, ln := range strings.Split(string(out), "\n") {
		ln = strings.TrimSpace(ln)
		switch {
		case strings.HasPrefix(ln, "Pages free:"):
			free = vmPages(ln)
		case strings.HasPrefix(ln, "Pages inactive:"):
			inactive = vmPages(ln)
		case strings.HasPrefix(ln, "Pages speculative:"):
			speculative = vmPages(ln)
		case strings.HasPrefix(ln, "Pages purgeable:"):
			purgeable = vmPages(ln)
		case strings.Contains(ln, "page size of"):
			if i := strings.Index(ln, "page size of "); i >= 0 {
				n := strings.Fields(ln[i+len("page size of "):])
				if len(n) > 0 {
					if v, e := strconv.ParseUint(n[0], 10, 64); e == nil && v > 0 {
						page = v
					}
				}
			}
		}
	}
	avail := (free + inactive + speculative + purgeable) * page
	if avail > total {
		avail = total
	}
	st.RAMAvail = avail
	st.RAMUsed = total - avail
	if total > 0 {
		st.RAMLoad = uint32(st.RAMUsed * 100 / total)
	}
}

func vmPages(ln string) uint64 {
	parts := strings.Fields(ln)
	if len(parts) == 0 {
		return 0
	}
	s := strings.TrimSuffix(parts[len(parts)-1], ".")
	n, _ := strconv.ParseUint(s, 10, 64)
	return n
}

func darwinUptime() int64 {
	out, err := exec.Command("sysctl", "-n", "kern.boottime").Output()
	if err != nil {
		return 0
	}
	s := string(out)
	i := strings.Index(s, "sec = ")
	if i < 0 {
		return 0
	}
	rest := s[i+6:]
	var sec int64
	for j := 0; j < len(rest); j++ {
		if rest[j] < '0' || rest[j] > '9' {
			sec, _ = strconv.ParseInt(rest[:j], 10, 64)
			break
		}
	}
	if sec <= 0 {
		return 0
	}
	return time.Now().Unix() - sec
}

func readDarwinProcesses() ([]*procInfo, error) {
	// pid, ppid, etime, time (CPU), rss (KB), args (caminho completo do exe)
	out, err := exec.Command("ps", "-axo", "pid=,ppid=,etime=,time=,rss=,args=").Output()
	if err != nil && len(out) == 0 {
		return nil, err
	}
	now := time.Now().Unix()
	var list []*procInfo
	for _, ln := range strings.Split(string(out), "\n") {
		if strings.TrimSpace(ln) == "" {
			continue
		}
		m := darwinPSLine.FindStringSubmatch(ln)
		if m == nil {
			continue
		}
		pid, e1 := strconv.Atoi(m[1])
		ppid, e2 := strconv.Atoi(m[2])
		et, e3 := apParseDarwinTime(m[3])
		ct, e4 := apParseDarwinTime(m[4])
		rss, e5 := strconv.ParseUint(m[5], 10, 64)
		if e1 != nil || e2 != nil || e3 != nil || e4 != nil || e5 != nil {
			continue
		}
		name := darwinProcName(m[6])
		rssB := rss * 1024
		list = append(list, &procInfo{
			PID: uint32(pid), PPID: uint32(ppid), Name: name,
			// Created em unix seconds (ordenado: mais antigo = menor).
			Created:   now - et,
			CPUTime:   ct, // segundos
			WS:        rssB,
			PrivateWS: rssB,
			Private:   rssB,
		})
	}
	return list, nil
}

// darwinProcName: nome amigável a partir de `ps -o args=` (paths com espaço ok).
func darwinProcName(args string) string {
	args = strings.TrimSpace(args)
	if args == "" {
		return "?"
	}
	args = strings.TrimPrefix(args, "-")
	const macOS = ".app/Contents/MacOS/"
	if i := strings.Index(args, macOS); i >= 0 {
		rest := strings.TrimSpace(args[i+len(macOS):])
		tok := strings.Fields(rest)
		if len(tok) > 0 {
			switch tok[0] {
			case "bethstudio", "bethstudio-host", "bethstudio-web":
				return tok[0]
			}
		}
		if j := strings.Index(rest, " -"); j >= 0 {
			rest = rest[:j]
		}
		if n := strings.TrimSpace(rest); n != "" {
			return n
		}
	}
	tok := strings.Fields(args)
	if len(tok) == 0 {
		return "?"
	}
	return filepath.Base(tok[0])
}

// buildBethStudioDarwin: nomes sem .exe (Mac).
func buildBethStudioDarwin(t *procTree, all []*procInfo, host *procInfo) []BethProc {
	var out []BethProc
	seen := map[uint32]bool{}
	for _, p := range all {
		n := strings.ToLower(p.Name)
		switch {
		case strings.Contains(n, "bethstudio-host"):
			if seen[p.PID] {
				continue
			}
			seen[p.PID] = true
			role, label := "host", "Host (bethstudio-host)"
			if host != nil && p.PID != host.PID {
				role, label = "other-host", "Outro host (bethstudio-host)"
			}
			out = append(out, BethProc{Role: role, Label: label, ProcStat: p.stat()})
		case n == "beth studio" || strings.Contains(n, "bethstudio-web"):
			if seen[p.PID] {
				continue
			}
			seen[p.PID] = true
			out = append(out, BethProc{Role: "studio", Label: "Studio (Beth Studio)", ProcStat: p.stat()})
			sub := t.subtree(p)[1:]
			var bridges, helpers []*procInfo
			for _, c := range sub {
				cn := strings.ToLower(c.Name)
				if cn == "bethstudio" || strings.HasPrefix(cn, "bethstudio ") {
					bridges = append(bridges, c)
				} else if !strings.Contains(cn, "bethstudio-host") {
					helpers = append(helpers, c)
				}
			}
			for _, b := range bridges {
				if seen[b.PID] {
					continue
				}
				seen[b.PID] = true
				out = append(out, BethProc{Role: "bridge", Label: "Ponte (bethstudio cli bridge)", ProcStat: b.stat()})
			}
			if len(helpers) > 0 {
				s := sumProcs(helpers)
				s.Name, s.PID = "helpers", p.PID
				out = append(out, BethProc{
					Role:  "webview",
					Label: "Processos auxiliares da janela (" + strconv.Itoa(len(helpers)) + ")",
					ProcStat: s,
				})
			}
		}
	}
	// CLI solto (não filho do Studio).
	for _, p := range all {
		n := strings.ToLower(p.Name)
		if n != "bethstudio" || seen[p.PID] {
			continue
		}
		seen[p.PID] = true
		out = append(out, BethProc{Role: "cli", Label: "CLI (bethstudio)", ProcStat: p.stat()})
	}
	return out
}
