package main

// agent_procs.go — "Processos deixados pelos agentes".
//
// Um agente (Claude Code) que roda um comando pelo shell (npm run dev, build,
// Chrome headless, servidor) às vezes o deixa rodando. A cada minuto o Studio
// olha a árvore de processos do Windows e de cada distro do WSL que já está
// rodando (nunca liga uma parada), acha os processos iniciados por comando de
// um agente e, os que passaram do tempo (padrão 30 min), vão para uma faixa
// no Studio e para um aviso na bandeja, com Encerrar, Ignorar e Lembrar em 1 h.
// Nada é encerrado sem a pessoa pedir.
//
// "Iniciado por comando do agente": descendente do agente por um shell
// (claude -> bash -> npm -> node). Filhos diretos do agente que não são shell
// são servidores MCP e ficam de fora, assim como os hooks do Beth Studio e o
// que tiver "mcp" na linha de comando. Um processo visto assim continua na
// lista quando o agente sai (fica órfão), enquanto o mesmo processo existir.

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// --- modelo neutro (Windows e Linux) -------------------------------------

// apNode: um processo, do Windows ou do Linux.
type apNode struct {
	PID, PPID int
	Name      string // nome do executável, minúsculo, sem .exe
	Cmd       string
	Start     int64   // unix (s)
	CPUSec    float64 // tempo de CPU acumulado (s)
	Mem       uint64  // bytes
	Cwd       string  // só do agente, quando se sabe
	Pane      int     // WEZTERM_PANE do processo (só dos agentes), se HasPane
	HasPane   bool
	TTY       string // Linux: o terminal do agente (/dev/pts/N); vazio = sem terminal
}

// apKey identifica um processo sem confundir PIDs reciclados.
type apKey struct {
	Side   string // windows | wsl
	Distro string
	PID    int
	Start  int64
}

func (k apKey) id() string {
	return fmt.Sprintf("%s|%s|%d|%d", k.Side, k.Distro, k.PID, k.Start)
}

var apShells = map[string]bool{"bash": true, "sh": true, "zsh": true, "dash": true, "fish": true, "pwsh": true, "powershell": true}

// apSkip: nunca são "deixados pelo agente".
func apSkip(n apNode) bool {
	switch n.Name {
	case "claude", "claude.exe", "conhost", "openconsole", "node-pty", "winpty-agent":
		return true
	}
	if strings.HasPrefix(n.Name, "bethstudio") {
		return true // hooks e ferramentas do próprio Studio (ponte-hook, agent-hook)
	}
	return strings.Contains(strings.ToLower(n.Cmd), "mcp")
}

func apIsAgent(n apNode) bool { return n.Name == "claude" }

// apCandidates: os processos iniciados por comando de um agente. Para cada
// filho do agente que é shell, desce pelos shells e pega o primeiro processo
// que não é shell em cada ramo (a árvore dele vai junto ao encerrar).
// Devolve também o agente de cada um.
func apCandidates(nodes []apNode) map[int]int {
	byPID := map[int]apNode{}
	kids := map[int][]apNode{}
	for _, n := range nodes {
		byPID[n.PID] = n
	}
	for _, n := range nodes {
		if p, ok := byPID[n.PPID]; ok && n.PPID != n.PID && p.Start <= n.Start+2 {
			kids[n.PPID] = append(kids[n.PPID], n)
		}
	}
	out := map[int]int{} // pid -> pid do agente
	for _, a := range nodes {
		if !apIsAgent(a) {
			continue
		}
		var walk func(sh apNode, depth int)
		walk = func(sh apNode, depth int) {
			if depth > 8 {
				return
			}
			for _, c := range kids[sh.PID] {
				switch {
				case apShells[c.Name]:
					walk(c, depth+1)
				case apSkip(c):
				default:
					out[c.PID] = a.PID
				}
			}
		}
		for _, c := range kids[a.PID] {
			if apShells[c.Name] {
				walk(c, 0)
			}
		}
	}
	return out
}

// apSubtree: o processo e seus descendentes (para encerrar), mais fundos primeiro.
func apSubtree(nodes []apNode, root int) []int {
	byPID := map[int]apNode{}
	kids := map[int][]int{}
	for _, n := range nodes {
		byPID[n.PID] = n
	}
	for _, n := range nodes {
		if p, ok := byPID[n.PPID]; ok && n.PPID != n.PID && p.Start <= n.Start+2 {
			kids[n.PPID] = append(kids[n.PPID], n.PID)
		}
	}
	order := []int{root}
	seen := map[int]bool{root: true}
	for i := 0; i < len(order); i++ {
		for _, k := range kids[order[i]] {
			if !seen[k] {
				seen[k] = true
				order = append(order, k)
			}
		}
	}
	for i, j := 0, len(order)-1; i < j; i, j = i+1, j-1 {
		order[i], order[j] = order[j], order[i]
	}
	return order
}

// --- estado do monitor ----------------------------------------------------

// AgentProc: um item da faixa.
type AgentProc struct {
	ID       string  `json:"id"`
	Side     string  `json:"side"`
	Distro   string  `json:"distro,omitempty"`
	PID      int     `json:"pid"`
	Name     string  `json:"name"`
	Cmd      string  `json:"cmd,omitempty"`
	Started  int64   `json:"started"`
	CPU      float64 `json:"cpu"` // núcleos, média do último minuto
	Mem      uint64  `json:"mem"`
	AgentCwd string  `json:"agent_cwd,omitempty"`
	Orphan   bool    `json:"orphan,omitempty"` // o agente já saiu
}

type apSeen struct {
	key      apKey
	agentCwd string
	lastCPU  float64
	lastAt   time.Time
}

type agentProcMonitor struct {
	mu      sync.Mutex
	seen    map[string]*apSeen // processos já reconhecidos como do agente
	ignored map[string]bool
	snooze  map[string]time.Time
	items   []AgentProc
	alerted map[string]bool // já avisados na bandeja
	nodes   map[string][]apNode

	// Ignorar, Lembrar em 1 h e "já avisado" sobrevivem a reiniciar o Studio
	// (antes voltava tudo a cada reinício): ficam num arquivo, por processo.
	holdFile    string // "" = não grava (testes)
	holds       []apHold
	holdsLoaded bool
}

// apHold: o que a pessoa decidiu sobre um processo (enquanto ele existir).
type apHold struct {
	Side    string `json:"side"`
	Distro  string `json:"distro,omitempty"`
	PID     int    `json:"pid"`
	Start   int64  `json:"start"`
	Ignored bool   `json:"ignored,omitempty"`
	Until   int64  `json:"until,omitempty"` // lembrar depois (unix)
	Alerted bool   `json:"alerted,omitempty"`
}

func (h apHold) is(k apKey) bool {
	return h.Side == k.Side && h.Distro == k.Distro && h.PID == k.PID && apAbs(h.Start-k.Start) <= 3
}

func newAgentProcMonitor(holdFile string) *agentProcMonitor {
	return &agentProcMonitor{seen: map[string]*apSeen{}, ignored: map[string]bool{}, snooze: map[string]time.Time{}, alerted: map[string]bool{}, nodes: map[string][]apNode{}, holdFile: holdFile}
}

var agentProcs = newAgentProcMonitor(filepath.Join(dataDir(), "agent-procs-hold.json"))

func (m *agentProcMonitor) loadHoldsLocked() {
	if m.holdsLoaded {
		return
	}
	m.holdsLoaded = true
	if m.holdFile == "" {
		return
	}
	if b, err := os.ReadFile(m.holdFile); err == nil {
		_ = json.Unmarshal(b, &m.holds)
	}
}

func (m *agentProcMonitor) saveHoldsLocked() {
	if m.holdFile == "" {
		return
	}
	b, err := json.Marshal(m.holds)
	if err == nil {
		_ = writeAtomic(m.holdFile, b)
	}
}

// setHoldLocked atualiza (ou cria) o registro do processo e grava.
func (m *agentProcMonitor) setHoldLocked(k apKey, f func(*apHold)) {
	for i := range m.holds {
		if m.holds[i].is(k) {
			f(&m.holds[i])
			m.saveHoldsLocked()
			return
		}
	}
	h := apHold{Side: k.Side, Distro: k.Distro, PID: k.PID, Start: k.Start}
	f(&h)
	m.holds = append(m.holds, h)
	m.saveHoldsLocked()
}

// AgentProcSettings: Configurações > Processos dos agentes.
type AgentProcSettings struct {
	Off     bool `json:"off,omitempty"`
	Minutes int  `json:"minutes,omitempty"`
}

func (a AgentProcSettings) normalized() AgentProcSettings {
	if a.Minutes < 5 || a.Minutes > 24*60 {
		a.Minutes = 30
	}
	return a
}

func (st *settingsStore) agentProcs() AgentProcSettings {
	st.mu.Lock()
	defer st.mu.Unlock()
	if st.s.AgentProcs == nil {
		return AgentProcSettings{}.normalized()
	}
	return st.s.AgentProcs.normalized()
}

func (st *settingsStore) setAgentProcs(a AgentProcSettings) error {
	st.mu.Lock()
	defer st.mu.Unlock()
	a = a.normalized()
	st.s.AgentProcs = &a
	return st.saveLocked()
}

// update recebe o retrato de um lado ("windows" ou "wsl|<distro>") e
// recalcula os itens. Devolve os itens novos (para o aviso da bandeja).
func (m *agentProcMonitor) update(side, distro string, nodes []apNode, now time.Time, minutes int) (items []AgentProc, fresh []AgentProc) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.loadHoldsLocked()
	scope := side + "|" + distro
	m.nodes[scope] = nodes
	byPID := map[int]apNode{}
	for _, n := range nodes {
		byPID[n.PID] = n
	}
	cands := apCandidates(nodes)
	// esquece o que morreu (deste lado). O início no Linux vem de "agora -
	// idade" em segundos inteiros: até 3 s de diferença é o mesmo processo.
	for id, s := range m.seen {
		if s.key.Side != side || s.key.Distro != distro {
			continue
		}
		n, ok := byPID[s.key.PID]
		if !ok || apAbs(n.Start-s.key.Start) > 3 {
			delete(m.seen, id)
			delete(m.ignored, id)
			delete(m.snooze, id)
			delete(m.alerted, id)
		}
	}
	// o registro de quem já terminou some do arquivo
	var holds []apHold
	for _, h := range m.holds {
		if h.Side == side && h.Distro == distro {
			if n, ok := byPID[h.PID]; !ok || apAbs(n.Start-h.Start) > 3 {
				continue
			}
		}
		holds = append(holds, h)
	}
	if len(holds) != len(m.holds) {
		m.holds = holds
		m.saveHoldsLocked()
	}
	known := map[int]bool{}
	for _, s := range m.seen {
		if s.key.Side == side && s.key.Distro == distro {
			known[s.key.PID] = true
		}
	}
	for pid, agent := range cands {
		if known[pid] {
			continue
		}
		k := apKey{side, distro, pid, byPID[pid].Start}
		m.seen[k.id()] = &apSeen{key: k, agentCwd: byPID[agent].Cwd}
		for _, h := range m.holds { // decisão de antes de reiniciar o Studio
			if h.is(k) {
				m.ignored[k.id()] = h.Ignored
				if h.Until > 0 {
					m.snooze[k.id()] = time.Unix(h.Until, 0)
				}
				m.alerted[k.id()] = h.Alerted
			}
		}
	}
	// refaz os itens deste lado, mantém os dos outros
	var keep []AgentProc
	for _, it := range m.items {
		if !(it.Side == side && it.Distro == distro) {
			keep = append(keep, it)
		}
	}
	limit := int64(minutes) * 60
	for id, s := range m.seen {
		if s.key.Side != side || s.key.Distro != distro {
			continue
		}
		n := byPID[s.key.PID]
		cpu := 0.0
		if !s.lastAt.IsZero() {
			if dt := now.Sub(s.lastAt).Seconds(); dt > 0 && n.CPUSec >= s.lastCPU {
				cpu = (n.CPUSec - s.lastCPU) / dt
			}
		}
		s.lastCPU, s.lastAt = n.CPUSec, now
		if now.Unix()-n.Start < limit || m.ignored[id] || now.Before(m.snooze[id]) {
			continue
		}
		_, agentAlive := cands[s.key.PID]
		it := AgentProc{ID: id, Side: side, Distro: distro, PID: n.PID, Name: n.Name, Cmd: apShortCmd(n.Cmd), Started: s.key.Start,
			CPU: round1(cpu), Mem: n.Mem, AgentCwd: s.agentCwd, Orphan: !agentAlive}
		keep = append(keep, it)
		if !m.alerted[id] {
			m.alerted[id] = true
			fresh = append(fresh, it)
			m.setHoldLocked(s.key, func(h *apHold) { h.Alerted = true })
		}
	}
	sort.Slice(keep, func(i, j int) bool { return keep[i].Started < keep[j].Started })
	m.items = keep
	return append([]AgentProc(nil), keep...), fresh
}

func apAbs(v int64) int64 {
	if v < 0 {
		return -v
	}
	return v
}

func apShortCmd(c string) string {
	c = strings.Join(strings.Fields(c), " ")
	if r := []rune(c); len(r) > 300 {
		c = string(r[:300]) + "…"
	}
	return c
}

func (m *agentProcMonitor) list() []AgentProc {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]AgentProc{}, m.items...)
}

func (m *agentProcMonitor) find(id string) (AgentProc, []apNode, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, it := range m.items {
		if it.ID == id {
			return it, append([]apNode(nil), m.nodes[it.Side+"|"+it.Distro]...), true
		}
	}
	return AgentProc{}, nil, false
}

// drop tira da faixa: ignorar (até o processo acabar) ou lembrar depois.
func (m *agentProcMonitor) drop(id string, snoozeFor time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.loadHoldsLocked()
	until := time.Now().Add(snoozeFor)
	if snoozeFor > 0 {
		m.snooze[id] = until
		delete(m.alerted, id) // avisa de novo quando voltar
	} else {
		m.ignored[id] = true
	}
	if s, ok := m.seen[id]; ok {
		m.setHoldLocked(s.key, func(h *apHold) {
			if snoozeFor > 0 {
				h.Until, h.Alerted = until.Unix(), false
			} else {
				h.Ignored = true
			}
		})
	}
	var keep []AgentProc
	for _, it := range m.items {
		if it.ID != id {
			keep = append(keep, it)
		}
	}
	m.items = keep
}

// --- hub: laço e eventos ---------------------------------------------------

func (h *hub) publishAgentProcs(items []AgentProc) {
	if items == nil {
		items = []AgentProc{}
	}
	b, err := json.Marshal(map[string]any{"ev": "agent_procs", "items": items})
	if err != nil {
		return
	}
	h.mu.Lock()
	h.agentProcsMsg = b
	cs := h.clientsLocked()
	h.mu.Unlock()
	for _, c := range cs {
		c.enqueue(b)
	}
}

// apAlertText: o aviso da bandeja para os itens novos.
func apAlertText(fresh []AgentProc, minutes int) (title, text string) {
	if len(fresh) == 1 {
		p := fresh[0]
		return "Processo de agente rodando há muito tempo",
			fmt.Sprintf("%s (PID %d%s) roda há mais de %d min. Abra o Beth Studio para encerrar ou ignorar.", p.Name, p.PID, apWhere(p), minutes)
	}
	return "Processos de agentes rodando há muito tempo",
		fmt.Sprintf("%d processos deixados pelos agentes rodam há mais de %d min. Abra o Beth Studio para encerrar ou ignorar.", len(fresh), minutes)
}

func apWhere(p AgentProc) string {
	if p.Side == "wsl" {
		return ", WSL " + p.Distro
	}
	return ""
}

// --- API -------------------------------------------------------------------

// GET  /api/agent-procs                 -> {items, settings}
// POST /api/agent-procs/kill   {id}
// POST /api/agent-procs/ignore {id}
// POST /api/agent-procs/snooze {id}     (1 h)
// POST /api/agent-procs/settings {off, minutes}
func (s *server) serveAgentProcs(w http.ResponseWriter, r *http.Request) {
	sub := strings.TrimPrefix(r.URL.Path, "/api/agent-procs")
	if sub == "" || sub == "/" {
		writeJSON(w, http.StatusOK, map[string]any{"items": agentProcs.list(), "settings": settings.agentProcs()})
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "use POST", http.StatusMethodNotAllowed)
		return
	}
	if s.hub.readOnly {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "modo somente leitura"})
		return
	}
	if sub == "/settings" {
		var body AgentProcSettings
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&body) != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "pedido inválido"})
			return
		}
		if err := settings.setAgentProcs(body); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if settings.agentProcs().Off {
			agentProcs.mu.Lock()
			agentProcs.items = nil
			agentProcs.mu.Unlock()
			s.hub.publishAgentProcs(nil)
		}
		writeJSON(w, http.StatusOK, map[string]any{"settings": settings.agentProcs()})
		return
	}
	var body struct {
		ID string `json:"id"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&body) != nil || body.ID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "pedido inválido"})
		return
	}
	switch sub {
	case "/ignore":
		agentProcs.drop(body.ID, 0)
	case "/snooze":
		agentProcs.drop(body.ID, time.Hour)
	case "/kill":
		it, nodes, ok := agentProcs.find(body.ID)
		if !ok {
			writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "esse processo não está mais na lista"})
			return
		}
		if err := apKill(it, nodes); err != nil {
			writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		lifeLog(fmt.Sprintf("processos de agente: encerrado %s (PID %d, %s%s) a pedido do usuário: %s", it.Name, it.PID, it.Side, apWhere(it), it.Cmd))
		agentProcs.drop(body.ID, 0)
	default:
		http.NotFound(w, r)
		return
	}
	s.hub.publishAgentProcs(agentProcs.list())
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// --- Linux: saída do ps ----------------------------------------------------

// apLinuxScript: uma linha por processo e a pasta de cada claude.
const apLinuxScript = `now=$(date +%s); echo NOW $now; ps -eo pid=,ppid=,etimes=,times=,rss=,comm=,args= 2>/dev/null; ps -eo pid=,args= 2>/dev/null | grep -iE 'claude|codex|opencode|cursor-agent|grok|gemini' | while read p rest; do e=$(tr '\0' '\n' < /proc/$p/environ 2>/dev/null | sed -n 's/^WEZTERM_PANE=//p'); t=$(readlink /proc/$p/fd/0 2>/dev/null); echo "AG $p ${e:--} ${t:--} $(readlink /proc/$p/cwd 2>/dev/null)"; done`

// parseLinuxProcs lê a saída de apLinuxScript.
func parseLinuxProcs(out string) []apNode {
	var now int64
	cwd := map[int]string{}
	paneOf := map[int]int{}
	ttyOf := map[int]string{}
	var nodes []apNode
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		f := strings.Fields(line)
		if f[0] == "NOW" && len(f) == 2 {
			now, _ = strconv.ParseInt(f[1], 10, 64)
			continue
		}
		if f[0] == "AG" && len(f) >= 3 {
			if pid, err := strconv.Atoi(f[1]); err == nil {
				if pn, err := strconv.Atoi(f[2]); err == nil && pn >= 0 {
					paneOf[pid] = pn
				}
				if len(f) >= 4 && f[3] != "-" {
					ttyOf[pid] = f[3]
				}
				if len(f) >= 5 {
					cwd[pid] = strings.Join(f[4:], " ")
				}
			}
			continue
		}
		if f[0] == "CWD" && len(f) >= 3 {
			if pid, err := strconv.Atoi(f[1]); err == nil {
				cwd[pid] = strings.Join(f[2:], " ")
			}
			continue
		}
		if len(f) < 6 {
			continue
		}
		pid, e1 := strconv.Atoi(f[0])
		ppid, e2 := strconv.Atoi(f[1])
		et, e3 := strconv.ParseInt(f[2], 10, 64)
		cpu, e4 := strconv.ParseFloat(f[3], 64)
		rss, e5 := strconv.ParseUint(f[4], 10, 64)
		if e1 != nil || e2 != nil || e3 != nil || e4 != nil || e5 != nil {
			continue
		}
		args := strings.Join(f[6:], " ")
		name := strings.ToLower(f[5])
		// o comm do Claude nativo às vezes é o da versão ("2.1.330"): olha o args
		if base := path.Base(strings.Fields(args + " x")[0]); base == "claude" {
			name = "claude"
		}
		nodes = append(nodes, apNode{PID: pid, PPID: ppid, Name: name, Cmd: args, Start: now - et, CPUSec: cpu, Mem: rss * 1024})
	}
	for i := range nodes {
		nodes[i].Cwd = cwd[nodes[i].PID]
		nodes[i].TTY = ttyOf[nodes[i].PID]
		if pn, ok := paneOf[nodes[i].PID]; ok {
			nodes[i].Pane, nodes[i].HasPane = pn, true
		}
	}
	return nodes
}
