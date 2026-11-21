package main

import (
	"strings"
	"testing"
	"time"
)

// árvore típica: pwsh -> claude -> {mcp node, bash -> npm -> node (dev), bash -> bethstudio-tool (hook)}
func apSample(start int64) []apNode {
	return []apNode{
		{PID: 10, PPID: 1, Name: "pwsh", Start: start},
		{PID: 20, PPID: 10, Name: "claude", Start: start + 1, Cwd: `C:\repo`},
		{PID: 30, PPID: 20, Name: "node", Cmd: "node C:/x/server.js", Start: start + 2},                // MCP: filho direto
		{PID: 31, PPID: 20, Name: "cmd", Cmd: "cmd /c npx -y @modelcontextprotocol/x", Start: start + 2}, // não é shell do agente
		{PID: 40, PPID: 20, Name: "bash", Start: start + 3},
		{PID: 41, PPID: 40, Name: "npm", Cmd: "npm run dev", Start: start + 3},
		{PID: 42, PPID: 41, Name: "node", Cmd: "node vite", Start: start + 4},
		{PID: 50, PPID: 20, Name: "bash", Start: start + 5},
		{PID: 51, PPID: 50, Name: "bethstudio-tool", Cmd: "bethstudio-tool.exe ponte-hook", Start: start + 5},
		{PID: 60, PPID: 20, Name: "bash", Start: start + 6},
		{PID: 61, PPID: 60, Name: "python", Cmd: "python -m my_mcp_server", Start: start + 6},
	}
}

func TestAPCandidates(t *testing.T) {
	c := apCandidates(apSample(1000))
	if len(c) != 1 || c[41] != 20 {
		t.Fatalf("candidatos %v", c)
	}
	sub := apSubtree(apSample(1000), 41)
	if len(sub) != 2 || sub[0] != 42 || sub[1] != 41 {
		t.Fatalf("subárvore (mais fundo primeiro) %v", sub)
	}
}

func TestAPMonitorThresholdOrphanIgnore(t *testing.T) {
	m := &agentProcMonitor{seen: map[string]*apSeen{}, ignored: map[string]bool{}, snooze: map[string]time.Time{}, alerted: map[string]bool{}, nodes: map[string][]apNode{}}
	t0 := time.Unix(100000, 0)
	start := t0.Unix() - 10*60 // começou há 10 min
	items, fresh := m.update("windows", "", apSample(start), t0, 30)
	if len(items) != 0 || len(fresh) != 0 {
		t.Fatal("antes de 30 min já alertou")
	}
	t1 := t0.Add(25 * time.Minute)
	nodes := apSample(start)
	nodes[6].CPUSec = 0 // node vite
	items, fresh = m.update("windows", "", nodes, t1, 30)
	if len(items) != 1 || len(fresh) != 1 || items[0].PID != 41 || items[0].AgentCwd != `C:\repo` || items[0].Orphan {
		t.Fatalf("depois de 35 min: %+v", items)
	}
	// o agente saiu: o processo continua, órfão
	var orphan []apNode
	for _, n := range apSample(start) {
		if n.PID == 41 || n.PID == 42 {
			n.PPID = 999
			orphan = append(orphan, n)
		}
	}
	items, fresh = m.update("windows", "", orphan, t1.Add(time.Minute), 30)
	if len(items) != 1 || !items[0].Orphan || len(fresh) != 0 {
		t.Fatalf("órfão: %+v fresh=%d", items, len(fresh))
	}
	id := items[0].ID
	m.drop(id, time.Hour)
	if items, _ = m.update("windows", "", orphan, t1.Add(2*time.Minute), 30); len(items) != 0 {
		t.Fatal("lembrar em 1 h não escondeu")
	}
	m.drop(id, 0)
	if items, _ = m.update("windows", "", orphan, t1.Add(3*time.Hour), 30); len(items) != 0 {
		t.Fatal("ignorar não escondeu")
	}
	// o processo acabou: some e esquece o ignorar
	m.update("windows", "", nil, t1.Add(4*time.Hour), 30)
	if len(m.seen) != 0 || len(m.ignored) != 0 {
		t.Fatalf("não esqueceu: %v %v", m.seen, m.ignored)
	}
}

func TestAPLinuxStartJitterKeepsIdentity(t *testing.T) {
	m := &agentProcMonitor{seen: map[string]*apSeen{}, ignored: map[string]bool{}, snooze: map[string]time.Time{}, alerted: map[string]bool{}, nodes: map[string][]apNode{}}
	now := time.Unix(200000, 0)
	a := apSample(now.Unix() - 3600)
	items, _ := m.update("wsl", "Ubuntu", a, now, 30)
	if len(items) != 1 {
		t.Fatalf("%+v", items)
	}
	b := apSample(now.Unix() - 3600 + 1) // um segundo de diferença na leitura
	items2, fresh := m.update("wsl", "Ubuntu", b, now.Add(time.Minute), 30)
	if len(items2) != 1 || items2[0].ID != items[0].ID || len(fresh) != 0 {
		t.Fatalf("virou outro processo: %+v", items2)
	}
}

func TestParseLinuxProcs(t *testing.T) {
	out := strings.Join([]string{
		"NOW 5000",
		"  1     0  4000     12  1000 systemd /sbin/init",
		" 200     1  3000      5  2000 bash -bash",
		" 300   200  2000     40 50000 2.1.330 /home/u/.local/bin/claude --resume x",
		" 400   300  1900      1  1000 bash /bin/bash -c npm run dev",
		" 401   400  1900     90 80000 node node /home/u/p/node_modules/.bin/vite --port 5173",
		"CWD 300 /home/u/p",
		"",
	}, "\n")
	ns := parseLinuxProcs(out)
	if len(ns) != 5 {
		t.Fatalf("%d nós", len(ns))
	}
	var claude, vite apNode
	for _, n := range ns {
		if n.PID == 300 {
			claude = n
		}
		if n.PID == 401 {
			vite = n
		}
	}
	if claude.Name != "claude" || claude.Cwd != "/home/u/p" || claude.Start != 3000 {
		t.Fatalf("claude %+v", claude)
	}
	if vite.Mem != 80000*1024 || vite.CPUSec != 90 || !strings.Contains(vite.Cmd, "vite --port 5173") {
		t.Fatalf("vite %+v", vite)
	}
	if c := apCandidates(ns); len(c) != 1 || c[401] != 300 {
		t.Fatalf("candidatos %v", c)
	}
}

func TestAPAlertText(t *testing.T) {
	title, text := apAlertText([]AgentProc{{Name: "node", PID: 7, Side: "wsl", Distro: "Ubuntu"}}, 30)
	if !strings.Contains(title, "Processo") || !strings.Contains(text, "node (PID 7, WSL Ubuntu)") {
		t.Fatal(title, text)
	}
	_, text = apAlertText([]AgentProc{{}, {}}, 45)
	if !strings.Contains(text, "2 processos") || !strings.Contains(text, "45 min") {
		t.Fatal(text)
	}
}
