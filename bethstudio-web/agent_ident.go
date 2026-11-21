package main

// agent_ident.go — qual agente roda em cada terminal (Claude, Codex,
// OpenCode, Cursor, Grok, Gemini), para a grade e a lista mostrarem uma
// etiqueta e dar para achar um terminal livre.
//
// Pelo processo, não pela tela: a tela de um terminal onde o agente já saiu
// ainda mostra "claude --resume ...". O terminal vem da variável WEZTERM_PANE
// que o host põe em todo processo do terminal (no WSL desde o patch 0205);
// sem ela (terminal WSL aberto por um host antigo), pela pasta do agente, se
// só um terminal WSL estiver naquela pasta.

import (
	"encoding/json"
	"path"
	"sort"
	"strconv"
	"strings"
)

// Agentes reconhecidos (o id vai para a interface).
var agentIDs = []string{"claude", "codex", "opencode", "cursor", "grok", "gemini"}

// agentServerArgs: o agente rodando como servidor em segundo plano (o
// app-server do Codex, servidor MCP, daemon). Ele herda o terminal de onde
// foi aberto e continua depois que a sessão sai: não é "agente no terminal".
var agentServerArgs = []string{" app-server", "--managed-daemon", " mcp", "mcp-server", " daemon", " serve", "--headless"}

func agentIsServer(cmd string) bool {
	c := " " + strings.ToLower(cmd)
	for _, a := range agentServerArgs {
		if strings.Contains(c, a) {
			return true
		}
	}
	return false
}

// agentOfNode: o agente que este processo é ("" = nenhum).
func agentOfNode(n apNode) string {
	if agentIsServer(n.Cmd) {
		return ""
	}
	switch n.Name {
	case "claude":
		return "claude"
	case "codex":
		return "codex"
	case "opencode":
		return "opencode"
	case "cursor-agent":
		return "cursor"
	case "grok":
		return "grok"
	case "gemini":
		return "gemini"
	case "node", "bun", "deno", "nodejs":
	default:
		return ""
	}
	// CLI em JavaScript: olha o script na linha de comando
	for _, tok := range strings.Fields(strings.ReplaceAll(n.Cmd, `\`, "/")) {
		low := strings.ToLower(strings.Trim(tok, `"'`))
		if strings.HasPrefix(low, "-") {
			continue
		}
		base := strings.TrimSuffix(strings.TrimSuffix(path.Base(low), ".js"), ".mjs")
		switch {
		case strings.Contains(low, "@anthropic-ai/claude-code") || base == "claude":
			return "claude"
		case strings.Contains(low, "@openai/codex") || base == "codex":
			return "codex"
		case strings.Contains(low, "opencode"):
			return "opencode"
		case strings.Contains(low, "cursor-agent"):
			return "cursor"
		case strings.Contains(low, "grok-cli") || base == "grok":
			return "grok"
		case strings.Contains(low, "@google/gemini-cli") || base == "gemini":
			return "gemini"
		}
	}
	return ""
}

// paneAgents: terminal -> agente. O agente mais antigo do terminal vence (o
// Claude que chamou outro agente continua sendo o do terminal).
//
// Processo com WEZTERM_PANE: vai para esse terminal. Sem ela (terminal WSL
// aberto por um host antigo), pela pasta: wslCwds é a pasta Linux de cada
// terminal WSL. Só contam agentes ligados a um terminal (/dev/pts/N; sessões
// em segundo plano não), um por terminal (pts). Numa pasta com N terminais
// sem etiqueta e exatamente N terminais de agente do mesmo tipo, todos
// recebem a etiqueta; com números diferentes, nenhum (não dá para saber qual).
func paneAgents(nodes []apNode, wslCwds map[int]string) map[int]string {
	sorted := append([]apNode(nil), nodes...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].Start < sorted[j].Start })
	out := map[int]string{}
	type loose struct{ agent, tty string }
	byCwd := map[string][]loose{}
	seenTTY := map[string]bool{}
	for _, n := range sorted {
		a := agentOfNode(n)
		if a == "" {
			continue
		}
		if n.HasPane {
			if _, ok := out[n.Pane]; !ok {
				out[n.Pane] = a
			}
			continue
		}
		if n.Cwd == "" || wslCwds == nil || !strings.HasPrefix(n.TTY, "/dev/pts/") || seenTTY[n.TTY] {
			continue
		}
		seenTTY[n.TTY] = true
		key := strings.ToLower(strings.TrimRight(n.Cwd, "/"))
		byCwd[key] = append(byCwd[key], loose{a, n.TTY})
	}
	for cwd, ags := range byCwd {
		var panes []int
		for p, c := range wslCwds {
			if _, done := out[p]; !done && strings.ToLower(strings.TrimRight(c, "/")) == cwd {
				panes = append(panes, p)
			}
		}
		if len(panes) == 0 || len(panes) != len(ags) {
			continue
		}
		same := true
		for _, x := range ags {
			same = same && x.agent == ags[0].agent
		}
		if !same {
			continue
		}
		for _, p := range panes {
			out[p] = ags[0].agent
		}
	}
	return out
}

// wslPaneCwds: a pasta Linux de cada terminal WSL da lista.
func wslPaneCwds(list []byte) map[int]string {
	var ev struct {
		Panes []struct {
			ID   int    `json:"pane_id"`
			Cwd  string `json:"cwd"`
			Kind string `json:"kind"`
		} `json:"panes"`
	}
	out := map[int]string{}
	if json.Unmarshal(list, &ev) != nil {
		return out
	}
	for _, p := range ev.Panes {
		if p.Kind == "wsl" {
			if c := wslLinuxCwd(p.Cwd); c != "" && c != "/" {
				out[p.ID] = c
			}
		}
	}
	return out
}

// publishPaneAgents espalha {"ev":"pane_agents","agents":{"3":"claude"}} quando muda.
func (h *hub) publishPaneAgents(m map[int]string) {
	obj := map[string]string{}
	for k, v := range m {
		obj[strconv.Itoa(k)] = v
	}
	b, err := json.Marshal(map[string]any{"ev": "pane_agents", "agents": obj})
	if err != nil {
		return
	}
	h.mu.Lock()
	same := string(b) == string(h.paneAgentsMsg)
	h.paneAgentsMsg = b
	cs := h.clientsLocked()
	h.mu.Unlock()
	if same {
		return
	}
	for _, c := range cs {
		c.enqueue(b)
	}
}
