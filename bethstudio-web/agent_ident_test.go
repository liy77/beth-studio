package main

import "testing"

func TestAgentOfNode(t *testing.T) {
	cases := []struct {
		n    apNode
		want string
	}{
		{apNode{Name: "claude"}, "claude"},
		{apNode{Name: "codex"}, "codex"},
		{apNode{Name: "opencode"}, "opencode"},
		{apNode{Name: "cursor-agent"}, "cursor"},
		{apNode{Name: "grok"}, "grok"},
		{apNode{Name: "node", Cmd: `node C:\Users\u\AppData\Roaming\npm\node_modules\@openai\codex\bin\codex.js`}, "codex"},
		{apNode{Name: "node", Cmd: "node /usr/local/bin/grok --model x"}, "grok"},
		{apNode{Name: "node", Cmd: "node /home/u/.local/share/cursor-agent/versions/1/index.js"}, "cursor"},
		{apNode{Name: "node", Cmd: "node /usr/lib/node_modules/@google/gemini-cli/dist/index.js"}, "gemini"},
		{apNode{Name: "node", Cmd: "node vite --port 5173"}, ""},
		{apNode{Name: "bash", Cmd: "bash -c claude --resume x"}, ""},
		{apNode{Name: "cursor"}, ""}, // o editor Cursor não é o agente
	}
	for _, c := range cases {
		if got := agentOfNode(c.n); got != c.want {
			t.Errorf("%+v: %q, quero %q", c.n, got, c.want)
		}
	}
}

func TestPaneAgents(t *testing.T) {
	nodes := []apNode{
		{PID: 1, Name: "claude", Start: 10, HasPane: true, Pane: 4},
		{PID: 2, Name: "codex", Start: 20, HasPane: true, Pane: 4}, // chamado pelo Claude: o terminal continua Claude
		{PID: 3, Name: "codex", Start: 5, HasPane: true, Pane: 7},
		// sem WEZTERM_PANE (WSL antigo)
		{PID: 10, Name: "claude", Cwd: "/r/a", TTY: "/dev/pts/1"},
		{PID: 11, Name: "claude", Cwd: "/r/a", TTY: "/dev/pts/1"}, // mesmo terminal: conta uma vez
		{PID: 12, Name: "claude", Cwd: "/r/b", TTY: "/dev/pts/2"},
		{PID: 13, Name: "claude", Cwd: "/r/b", TTY: "/dev/pts/3"},
		{PID: 14, Name: "claude", Cwd: "/r/c", TTY: "/dev/pts/4"}, // 1 agente, 2 terminais: ninguém
		{PID: 15, Name: "codex", Cwd: "/r/d", TTY: ""},           // segundo plano: não conta
	}
	cwds := map[int]string{20: "/r/a/", 21: "/r/b", 22: "/r/b", 23: "/r/c", 24: "/r/c", 25: "/r/d"}
	got := paneAgents(nodes, cwds)
	want := map[int]string{4: "claude", 7: "codex", 20: "claude", 21: "claude", 22: "claude"}
	if len(got) != len(want) {
		t.Fatalf("%v", got)
	}
	for k, v := range want {
		if got[k] != v {
			t.Fatalf("terminal %d: %q (%v)", k, got[k], got)
		}
	}
}

func TestParseLinuxAG(t *testing.T) {
	out := "NOW 100\n 5 1 50 1 100 claude claude\n 6 1 50 1 100 codex codex\nAG 5 12 /dev/pts/3 /home/u/p q\nAG 6 - - /x\n"
	ns := parseLinuxProcs(out)
	if len(ns) != 2 || !ns[0].HasPane || ns[0].Pane != 12 || ns[0].TTY != "/dev/pts/3" || ns[0].Cwd != "/home/u/p q" {
		t.Fatalf("%+v", ns)
	}
	if ns[1].HasPane || ns[1].TTY != "" || ns[1].Cwd != "/x" {
		t.Fatalf("%+v", ns[1])
	}
}
