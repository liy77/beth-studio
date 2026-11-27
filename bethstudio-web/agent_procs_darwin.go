//go:build darwin

package main

// agent_procs_darwin.go — a cada 15 s lê os processos do Mac e publica
// qual agente (Cursor, Codex, Claude…) roda em cada terminal, pela
// variável WEZTERM_PANE do processo (a mesma lógica do Windows).

import (
	"context"
	"errors"
	"net/http"
	"os/exec"
	"path"
	"strconv"
	"strings"
	"time"
	"unicode"

	"golang.org/x/sys/unix"
)

const apIdentEvery = 15 * time.Second

func (h *hub) runAgentProcs(ctx context.Context) {
	t := time.NewTimer(8 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		if nodes, err := apDarwinNodes(); err == nil {
			h.publishPaneAgents(paneAgents(nodes, nil))
			persistLiveAgents(agentSessionsDir(), settings.hostID(), nodes)
		}
		t.Reset(apIdentEvery)
	}
}

// apDarwinNodes: ps do Mac + WEZTERM_PANE via kern.procargs2 nos agentes.
func apDarwinNodes() ([]apNode, error) {
	out, err := exec.Command("ps", "-axo", "pid=,ppid=,etime=,time=,rss=,args=").Output()
	if err != nil && len(out) == 0 {
		return nil, err
	}
	now := time.Now().Unix()
	var nodes []apNode
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		f := strings.Fields(line)
		if len(f) < 6 {
			continue
		}
		pid, e1 := strconv.Atoi(f[0])
		ppid, e2 := strconv.Atoi(f[1])
		et, e3 := apParseDarwinTime(f[2])
		cpu, e4 := apParseDarwinTime(f[3])
		rss, e5 := strconv.ParseUint(f[4], 10, 64)
		if e1 != nil || e2 != nil || e3 != nil || e4 != nil || e5 != nil {
			continue
		}
		args := strings.Join(f[5:], " ")
		exe := strings.Fields(args)
		name := ""
		if len(exe) > 0 {
			name = strings.ToLower(path.Base(exe[0]))
		}
		n := apNode{
			PID: pid, PPID: ppid, Name: name, Cmd: args,
			Start: now - et, CPUSec: float64(cpu), Mem: rss * 1024,
		}
		if agentOfNode(n) != "" {
			if pn, ok := apDarwinPane(pid); ok {
				n.Pane, n.HasPane = pn, true
			}
		}
		nodes = append(nodes, n)
	}
	return nodes, nil
}

// apDarwinPane: WEZTERM_PANE no ambiente do processo (kern.procargs2).
func apDarwinPane(pid int) (int, bool) {
	b, err := unix.SysctlRaw("kern.procargs2", pid)
	if err != nil || len(b) < 4 {
		return 0, false
	}
	for _, part := range strings.Split(string(b), "\x00") {
		if strings.HasPrefix(part, "WEZTERM_PANE=") {
			n, err := strconv.Atoi(strings.TrimPrefix(part, "WEZTERM_PANE="))
			if err == nil && n >= 0 {
				return n, true
			}
			return 0, false
		}
	}
	return 0, false
}

// apParseDarwinTime: etime/time do ps no Mac — [[dd-]hh:]mm:ss[.ss]
func apParseDarwinTime(s string) (int64, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, strconv.ErrSyntax
	}
	neg := false
	if strings.HasPrefix(s, "-") {
		neg = true
		s = s[1:]
	}
	days := int64(0)
	if i := strings.IndexByte(s, '-'); i >= 0 {
		d, err := strconv.ParseInt(s[:i], 10, 64)
		if err != nil {
			return 0, err
		}
		days, s = d, s[i+1:]
	}
	parts := strings.Split(s, ":")
	if len(parts) < 2 || len(parts) > 3 {
		return 0, strconv.ErrSyntax
	}
	var sec float64
	for _, p := range parts {
		if p == "" || !apAllDigitsDot(p) {
			return 0, strconv.ErrSyntax
		}
	}
	switch len(parts) {
	case 2:
		m, err1 := strconv.ParseFloat(parts[0], 64)
		s2, err2 := strconv.ParseFloat(parts[1], 64)
		if err1 != nil || err2 != nil {
			return 0, strconv.ErrSyntax
		}
		sec = m*60 + s2
	case 3:
		h, err1 := strconv.ParseFloat(parts[0], 64)
		m, err2 := strconv.ParseFloat(parts[1], 64)
		s2, err3 := strconv.ParseFloat(parts[2], 64)
		if err1 != nil || err2 != nil || err3 != nil {
			return 0, strconv.ErrSyntax
		}
		sec = h*3600 + m*60 + s2
	}
	total := days*86400 + int64(sec)
	if neg {
		total = -total
	}
	return total, nil
}

func apAllDigitsDot(s string) bool {
	dot := false
	for _, r := range s {
		if r == '.' {
			if dot {
				return false
			}
			dot = true
			continue
		}
		if !unicode.IsDigit(r) {
			return false
		}
	}
	return true
}

func apKill(it AgentProc, _ []apNode) error {
	return errors.New("processos deixados pelos agentes: só no Windows")
}

func serveWSLRunning(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"running": []string{}})
}
