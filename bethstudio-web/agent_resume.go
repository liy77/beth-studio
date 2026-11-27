package main

// agent_resume.go — retomar sessões de agentes depois que o host reinicia.
//
// Duas fontes alimentam <dados>/agent-sessions (um arquivo por terminal):
//
//  1. Hook do Claude Code (`bethstudio-tool agent-hook`, SessionStart/SessionEnd):
//     id preciso da conversa via WEZTERM_PANE.
//  2. Scan de processos (a cada ~15 s): qualquer agente vivo no terminal
//     (Claude, Cursor, Codex, Grok, Gemini, OpenCode). Se o argv não trouxer
//     o id, grava "last" e na retomada usa o continue/`--last` daquela CLI.
//
// A receita (pane_specs.go) leva Agent + SessionID. Depois da restauração o
// Studio digita o comando certo no terminal novo (auto por padrão).

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const agentHookFlag = "agent-hook"

// sessionLast: sem id conhecido — na retomada usa o continue/`--last` do agente.
const sessionLast = "last"

var agentSessionIDRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9-]{7,79}$`)

func validAgentSessionID(s string) bool {
	return s == sessionLast || agentSessionIDRe.MatchString(s)
}

// Comandos por agente. {id} só nos que retomam por id; "last" usa agentContinueCmd.
var agentResumeCmd = map[string]string{
	"claude":   "claude --resume {id}",
	"cursor":   "cursor-agent --resume={id}",
	"codex":    "codex resume {id}",
	"grok":     "grok --resume {id}",
	"gemini":   "gemini --resume {id}",
	"opencode": "opencode --session {id}",
}

var agentContinueCmd = map[string]string{
	"claude":   "claude --continue",
	"cursor":   "cursor-agent --continue",
	"codex":    "codex resume --last",
	"grok":     "grok --continue",
	"gemini":   "gemini --resume latest",
	"opencode": "opencode --continue",
}

// agentRecord: o que o hook / o scan grava por terminal.
type agentRecord struct {
	Agent     string `json:"agent"` // claude | cursor | codex | grok | gemini | opencode
	SessionID string `json:"session_id"`
	Pane      int    `json:"pane"`
	Host      string `json:"host"`
	Cwd       string `json:"cwd,omitempty"`
	Side      string `json:"side,omitempty"` // windows | wsl
	At        int64  `json:"at"`             // unix: último SessionStart / scan
	Ended     int64  `json:"ended,omitempty"`
}

func agentSessionsDir() string { return filepath.Join(ponteDataDir(), "agent-sessions") }

// hostIDIn: a mesma identidade de settingsStore.hostID (pid@mtime do host.pid).
func hostIDIn(dir string) string {
	p := filepath.Join(dir, "host.pid")
	if id := hostID(); id != "" {
		p = filepath.Join(dir, "hosts", id+".pid")
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return ""
	}
	fi, err := os.Stat(p)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b)) + "@" + strconv.FormatInt(fi.ModTime().Unix(), 10)
}

func agentRecordFile(dir, host string, pane int) string {
	h := strings.NewReplacer("@", "_", ":", "_", `\`, "_", "/", "_").Replace(host)
	return filepath.Join(dir, fmt.Sprintf("%s-%d.json", h, pane))
}

// agentHookMain roda dentro do hook do Claude: nunca falha, nunca escreve na
// saída (o Claude mostraria) e termina rápido.
func agentHookMain(args []string, in io.Reader) int {
	var input struct {
		SessionID string `json:"session_id"`
		Cwd       string `json:"cwd"`
		Event     string `json:"hook_event_name"`
	}
	b, _ := io.ReadAll(io.LimitReader(in, 1<<20))
	_ = json.Unmarshal(b, &input)
	if !agentSessionIDRe.MatchString(input.SessionID) {
		return 0
	}
	// Sem WEZTERM_PANE (terminal WSL aberto por um host sem o patch 0205, ou
	// fora do Studio): grava só pela pasta; o Studio casa pela pasta se der.
	pane, err := strconv.Atoi(strings.TrimSpace(os.Getenv("WEZTERM_PANE")))
	if err != nil || pane < 0 {
		pane = -1
		if strings.TrimSpace(input.Cwd) == "" {
			return 0
		}
	}
	side := "windows"
	for i := 0; i+1 < len(args); i++ {
		if args[i] == "--lado" && args[i+1] == "wsl" {
			side = "wsl"
		}
	}
	data := ponteDataDir()
	host := hostIDIn(data)
	if host == "" {
		return 0
	}
	dir := filepath.Join(data, "agent-sessions")
	_ = os.MkdirAll(dir, 0o755)
	file := agentRecordFile(dir, host, pane)
	if pane < 0 {
		file = filepath.Join(dir, strings.TrimSuffix(filepath.Base(agentRecordFile(dir, host, 0)), "-0.json")+"-s-"+input.SessionID+".json")
	}
	now := time.Now().Unix()
	rec := agentRecord{Agent: "claude", SessionID: input.SessionID, Pane: pane, Host: host, Cwd: input.Cwd, Side: side, At: now}
	if input.Event == "SessionEnd" {
		// Sessão aberta antes de o hook existir também conta: a pessoa sai do
		// Claude e a sessão fica anotada (encerrada) para retomar depois.
		var old agentRecord
		if raw, err := os.ReadFile(file); err == nil && json.Unmarshal(raw, &old) == nil && old.SessionID == input.SessionID {
			rec = old
		}
		rec.Ended = now
	}
	if out, err := json.Marshal(rec); err == nil {
		_ = writeAtomic(file, out)
	}
	return 0
}

// --- leitura no Studio ----------------------------------------------------

var agentRecCache struct {
	mu   sync.Mutex
	at   time.Time
	host string
	recs []agentRecord
}

// agentRecordsFor: as sessões gravadas para os terminais do host `host`
// (lido no máximo a cada 3 s; a lista chega a cada 2 s). Arquivos de hosts
// antigos com mais de 14 dias são apagados.
func agentRecordsFor(dir, host string) []agentRecord {
	agentRecCache.mu.Lock()
	defer agentRecCache.mu.Unlock()
	if agentRecCache.host == host && time.Since(agentRecCache.at) < 3*time.Second && agentRecCache.recs != nil {
		return agentRecCache.recs
	}
	var out []agentRecord
	files, _ := filepath.Glob(filepath.Join(dir, "*.json"))
	for _, f := range files {
		st, err := os.Stat(f)
		if err != nil || st.IsDir() || st.Size() > 16<<10 {
			continue
		}
		raw, err := os.ReadFile(f)
		var r agentRecord
		if err != nil || json.Unmarshal(raw, &r) != nil {
			continue
		}
		if r.Host != host {
			if time.Since(st.ModTime()) > 14*24*time.Hour {
				_ = os.Remove(f)
			}
			continue
		}
		if validAgentSessionID(r.SessionID) {
			out = append(out, r)
		}
	}
	if out == nil {
		out = []agentRecord{}
	}
	agentRecCache.at, agentRecCache.host, agentRecCache.recs = time.Now(), host, out
	return out
}

// sameCwd: pastas iguais sem ligar para maiúsculas, barras e barra no fim.
func sameCwd(a, b string) bool {
	n := func(s string) string {
		s = strings.ReplaceAll(strings.TrimSpace(s), `\`, "/")
		return strings.ToLower(strings.TrimRight(s, "/"))
	}
	return a != "" && b != "" && n(a) == n(b)
}

// attachAgentSessions põe na receita a sessão de cada terminal.
//
// Registro com terminal: vai para esse terminal. Registro só com a pasta: vai
// para o terminal do mesmo lado (WSL ou Windows) nessa pasta, se for o único
// terminal ali sem sessão; com mais de um registro na pasta, o mais recente.
func attachAgentSessions(specs []paneSpec, recs []agentRecord) []paneSpec {
	set := func(i int, r agentRecord) {
		specs[i].Resume = &resumeSpec{Agent: r.Agent, SessionID: r.SessionID, Ended: r.Ended != 0, At: r.At}
	}
	byPane := map[int]agentRecord{}
	var loose []agentRecord
	for _, r := range recs {
		if r.Pane >= 0 {
			if old, ok := byPane[r.Pane]; !ok || r.At >= old.At {
				byPane[r.Pane] = r
			}
		} else {
			loose = append(loose, r)
		}
	}
	for i := range specs {
		if r, ok := byPane[specs[i].PaneID]; ok {
			set(i, r)
		}
	}
	sort.SliceStable(loose, func(i, j int) bool { return loose[i].At > loose[j].At })
	used := map[string]bool{}
	for _, r := range loose {
		key := r.Side + "|" + strings.ToLower(r.Cwd)
		if used[key] {
			continue // a pasta já recebeu a sessão mais recente
		}
		match := -1
		for i := range specs {
			wsl := specs[i].Kind == "wsl"
			if (r.Side == "wsl") != wsl || specs[i].Tool != nil || !sameCwd(specs[i].Cwd, r.Cwd) {
				continue
			}
			if match >= 0 {
				match = -2 // dois terminais na mesma pasta: não dá para saber qual
				break
			}
			match = i
		}
		used[key] = true
		if match >= 0 && specs[match].Resume == nil {
			set(match, r)
		}
	}
	return specs
}

// resumeSpec: a sessão do agente que rodava no terminal (na receita).
type resumeSpec struct {
	Agent     string `json:"agent"`
	SessionID string `json:"session_id"` // id real ou "last"
	Ended     bool   `json:"ended,omitempty"` // a pessoa tinha saído (só Claude/hook)
	At        int64  `json:"at,omitempty"`
}

// --- configuração ---------------------------------------------------------

// AgentResumeSettings: Configurações > Retomar sessões.
type AgentResumeSettings struct {
	// auto (padrão): retoma sozinho as sessões que estavam abertas; ask: a faixa
	// oferece "Retomar"; off: não oferece.
	Mode string `json:"mode,omitempty"`
	// Override por agente do comando com id ({id} obrigatório). Vazio = padrão da CLI.
	Commands map[string]string `json:"commands,omitempty"`
	// Override por agente do continue/`--last` (sem {id}). Vazio = padrão da CLI.
	Continue map[string]string `json:"continue,omitempty"`
	// Legado: um único comando do Claude. Migrado para Commands["claude"].
	Command string `json:"command,omitempty"`
}

const defaultResumeCommand = "claude --resume {id}"

// Ordem na UI / API de padrões.
var agentResumeOrder = []string{"claude", "cursor", "codex", "grok", "gemini", "opencode"}

func (a AgentResumeSettings) normalized() AgentResumeSettings {
	switch a.Mode {
	case "ask", "auto", "off":
	default:
		a.Mode = "auto"
	}
	if a.Commands == nil {
		a.Commands = map[string]string{}
	}
	if a.Continue == nil {
		a.Continue = map[string]string{}
	}
	// Migra o campo antigo (só Claude).
	if c := strings.TrimSpace(a.Command); c != "" && strings.TrimSpace(a.Commands["claude"]) == "" {
		a.Commands["claude"] = c
	}
	a.Commands = cleanAgentCmdMap(a.Commands, true)
	a.Continue = cleanAgentCmdMap(a.Continue, false)
	if c := a.Commands["claude"]; c != "" {
		a.Command = c
	} else {
		a.Command = defaultResumeCommand
	}
	return a
}

func cleanAgentCmdMap(in map[string]string, needID bool) map[string]string {
	out := map[string]string{}
	for _, id := range agentResumeOrder {
		c := strings.TrimSpace(in[id])
		if c == "" {
			continue
		}
		if err := validAgentCmd(c, needID); err != nil {
			continue
		}
		out[id] = c
	}
	return out
}

func validAgentCmd(c string, needID bool) error {
	c = strings.TrimSpace(c)
	switch {
	case c == "":
		return nil
	case len(c) > 200:
		return errors.New("comando grande demais (até 200 caracteres)")
	case strings.ContainsAny(c, "\r\n\x00"):
		return errors.New("o comando tem que ser uma linha só")
	case needID && !strings.Contains(c, "{id}"):
		return errors.New("o comando com id precisa ter {id}")
	case !needID && strings.Contains(c, "{id}"):
		return errors.New("o comando de continuar não usa {id}")
	}
	return nil
}

func validResumeCommand(c string) error { return validAgentCmd(c, true) }

func validResumeSettings(a AgentResumeSettings) error {
	for id, c := range a.Commands {
		if err := validAgentCmd(c, true); err != nil {
			return fmt.Errorf("%s (com id): %w", id, err)
		}
	}
	for id, c := range a.Continue {
		if err := validAgentCmd(c, false); err != nil {
			return fmt.Errorf("%s (continuar): %w", id, err)
		}
	}
	if a.Command != "" {
		if err := validAgentCmd(a.Command, true); err != nil {
			return err
		}
	}
	return nil
}

// resumeDefaultsJSON: catálogo embutido para a UI (rótulo + padrões).
func resumeDefaultsJSON() []map[string]string {
	labels := map[string]string{
		"claude": "Claude", "cursor": "Cursor", "codex": "Codex",
		"grok": "Grok", "gemini": "Gemini", "opencode": "OpenCode",
	}
	out := make([]map[string]string, 0, len(agentResumeOrder))
	for _, id := range agentResumeOrder {
		out = append(out, map[string]string{
			"id": id, "label": labels[id],
			"resume": agentResumeCmd[id], "continue": agentContinueCmd[id],
		})
	}
	return out
}

// resumeCommandFor: o texto digitado no terminal (sem o Enter).
// sid "last" (ou vazio) → continue/`--last`; senão resume com id.
// cfg.Commands / cfg.Continue sobrescrevem o padrão da CLI.
func resumeCommandFor(agent string, cfg AgentResumeSettings, sid string) (string, error) {
	agent = strings.ToLower(strings.TrimSpace(agent))
	if agent == "" {
		agent = "claude"
	}
	cfg = cfg.normalized()
	useLast := sid == "" || sid == sessionLast
	if !useLast && !agentSessionIDRe.MatchString(sid) {
		return "", errors.New("id de sessão inválido")
	}
	if useLast {
		if c := strings.TrimSpace(cfg.Continue[agent]); c != "" {
			return c, nil
		}
		cmd := agentContinueCmd[agent]
		if cmd == "" {
			return "", fmt.Errorf("agente %q sem comando de continuar", agent)
		}
		return cmd, nil
	}
	tmpl := strings.TrimSpace(cfg.Commands[agent])
	if tmpl == "" {
		tmpl = agentResumeCmd[agent]
	}
	if tmpl == "" {
		return "", fmt.Errorf("agente %q sem comando de retomar", agent)
	}
	return strings.ReplaceAll(tmpl, "{id}", sid), nil
}

// sessionIDFromCmd: tenta achar o id no argv do agente; senão "last".
func sessionIDFromCmd(agent, cmd string) string {
	fields := strings.Fields(cmd)
	for i, f := range fields {
		switch {
		case f == "--resume" || f == "-r" || f == "--session" || f == "-s":
			if i+1 < len(fields) && !strings.HasPrefix(fields[i+1], "-") && agentSessionIDRe.MatchString(fields[i+1]) {
				return fields[i+1]
			}
		case strings.HasPrefix(f, "--resume="):
			if id := strings.TrimPrefix(f, "--resume="); agentSessionIDRe.MatchString(id) {
				return id
			}
		case strings.HasPrefix(f, "--session="):
			if id := strings.TrimPrefix(f, "--session="); agentSessionIDRe.MatchString(id) {
				return id
			}
		case agent == "codex" && f == "resume" && i+1 < len(fields):
			if agentSessionIDRe.MatchString(fields[i+1]) {
				return fields[i+1]
			}
		}
	}
	return sessionLast
}

// persistLiveAgents anota, a partir dos processos vivos, qual agente está em
// cada terminal. Não apaga registro quando o agente sai (vale para o próximo
// restore). Não troca um id preciso do hook do Claude por "last".
func persistLiveAgents(dir, host string, nodes []apNode) {
	if host == "" || len(nodes) == 0 {
		return
	}
	_ = os.MkdirAll(dir, 0o755)
	now := time.Now().Unix()
	seen := map[int]bool{}
	for _, n := range nodes {
		agent := agentOfNode(n)
		if agent == "" || !n.HasPane || n.Pane < 0 || seen[n.Pane] {
			continue
		}
		seen[n.Pane] = true
		sid := sessionIDFromCmd(agent, n.Cmd)
		file := agentRecordFile(dir, host, n.Pane)
		if raw, err := os.ReadFile(file); err == nil {
			var old agentRecord
			if json.Unmarshal(raw, &old) == nil && old.Host == host && old.Agent == agent &&
				agentSessionIDRe.MatchString(old.SessionID) && !agentSessionIDRe.MatchString(sid) {
				old.Ended = 0
				old.At = now
				if old.Cwd == "" && n.Cwd != "" {
					old.Cwd = n.Cwd
				}
				if out, err := json.Marshal(old); err == nil {
					_ = writeAtomic(file, out)
				}
				continue
			}
		}
		rec := agentRecord{Agent: agent, SessionID: sid, Pane: n.Pane, Host: host, Cwd: n.Cwd, At: now}
		if out, err := json.Marshal(rec); err == nil {
			_ = writeAtomic(file, out)
		}
	}
	agentRecCache.mu.Lock()
	agentRecCache.recs = nil
	agentRecCache.mu.Unlock()
}

func (st *settingsStore) agentResume() AgentResumeSettings {
	st.mu.Lock()
	defer st.mu.Unlock()
	if st.s.AgentResume == nil {
		return AgentResumeSettings{}.normalized()
	}
	return st.s.AgentResume.normalized()
}

func (st *settingsStore) setAgentResume(a AgentResumeSettings) error {
	st.mu.Lock()
	defer st.mu.Unlock()
	a = a.normalized()
	st.s.AgentResume = &a
	return st.saveLocked()
}

// --- ofertas depois da restauração ---------------------------------------

// resumeOffer: um terminal recriado que tinha uma sessão do agente.
type resumeOffer struct {
	PaneID    int    `json:"pane_id"` // id NOVO
	OldPane   int    `json:"old_pane"`
	Title     string `json:"title,omitempty"`
	Cwd       string `json:"cwd,omitempty"`
	Agent     string `json:"agent"`
	SessionID string `json:"session_id"`
	Ended     bool   `json:"ended,omitempty"`
}

// resumeOffers monta as ofertas a partir da receita e do mapa velho -> novo.
func resumeOffers(specs []paneSpec, m map[int]int) []resumeOffer {
	var out []resumeOffer
	for _, s := range specs {
		if s.Resume == nil || !validAgentSessionID(s.Resume.SessionID) {
			continue
		}
		nid, ok := m[s.PaneID]
		if !ok {
			continue
		}
		out = append(out, resumeOffer{PaneID: nid, OldPane: s.PaneID, Title: s.Title, Cwd: s.Cwd, Agent: s.Resume.Agent, SessionID: s.Resume.SessionID, Ended: s.Resume.Ended})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].PaneID < out[j].PaneID })
	return out
}

// setResumeOffers guarda e espalha as ofertas ({"ev":"agent_resume"}).
func (h *hub) setResumeOffers(offers []resumeOffer) {
	if offers == nil {
		offers = []resumeOffer{}
	}
	b, err := json.Marshal(map[string]any{"ev": "agent_resume", "offers": offers})
	if err != nil {
		return
	}
	h.mu.Lock()
	h.resumeList = offers
	h.resumeMsg = b
	cs := h.clientsLocked()
	h.mu.Unlock()
	for _, c := range cs {
		c.enqueue(b)
	}
}

func (h *hub) takeResumeOffers(ids []int, all bool) []resumeOffer {
	h.mu.Lock()
	want := map[int]bool{}
	for _, id := range ids {
		want[id] = true
	}
	var take, keep []resumeOffer
	for _, o := range h.resumeList {
		if all || want[o.PaneID] {
			take = append(take, o)
		} else {
			keep = append(keep, o)
		}
	}
	h.mu.Unlock()
	h.setResumeOffers(keep)
	return take
}

// resumeIn digita o comando de retomar no terminal e depois o Enter (separado,
// para o shell não tomar o Enter como parte de uma colagem).
func (h *hub) resumeIn(o resumeOffer, cfg AgentResumeSettings) error {
	if h.bridge == nil {
		return errBridgeDown
	}
	cmd, err := resumeCommandFor(o.Agent, cfg, o.SessionID)
	if err != nil {
		return err
	}
	if err := h.bridge.write(map[string]any{"op": "send", "pane_id": o.PaneID, "data": cmd}); err != nil {
		return err
	}
	time.Sleep(300 * time.Millisecond)
	if err := h.bridge.write(map[string]any{"op": "send", "pane_id": o.PaneID, "data": "\r"}); err != nil {
		return err
	}
	lifeLog(fmt.Sprintf("retomar: sessão %s do %s no terminal #%d (era #%d)", o.SessionID, o.Agent, o.PaneID, o.OldPane))
	return nil
}

// afterRestoreResume: chamado no fim da restauração.
func (h *hub) afterRestoreResume(specs []paneSpec, m map[int]int) {
	cfg := settings.agentResume()
	if cfg.Mode == "off" {
		return
	}
	offers := resumeOffers(specs, m)
	if len(offers) == 0 {
		return
	}
	if cfg.Mode == "auto" {
		var rest []resumeOffer
		var run []resumeOffer
		for _, o := range offers {
			if o.Ended {
				rest = append(rest, o)
			} else {
				run = append(run, o)
			}
		}
		h.setResumeOffers(rest)
		go func() {
			time.Sleep(3 * time.Second) // o shell novo ainda está subindo (perfil do PowerShell, WSL)
			for _, o := range run {
				_ = h.resumeIn(o, cfg)
			}
		}()
		return
	}
	h.setResumeOffers(offers)
}

// --- API -----------------------------------------------------------------

// serveAgentResume:
//
//	GET  /api/agent-resume                  -> {settings, offers, tool, defaults}
//	POST /api/agent-resume/settings {mode, commands, continue}
//	POST /api/agent-resume/run      {pane_ids, all}   (retoma)
//	POST /api/agent-resume/dismiss  {pane_ids, all}   (esquece a oferta)
//	POST /api/agent-resume/setup    {target, distro, action: add|remove|check}
func (s *server) serveAgentResume(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/agent-resume")
	if path == "" || path == "/" {
		s.hub.mu.Lock()
		offers := append([]resumeOffer{}, s.hub.resumeList...)
		s.hub.mu.Unlock()
		distros := listWSLDistros()
		if distros == nil {
			distros = []string{}
		}
		cfg := settings.agentResume()
		writeJSON(w, http.StatusOK, map[string]any{
			"settings": cfg, "offers": offers, "tool": ponteToolPath(),
			"default_command": cfg.Command, "defaults": resumeDefaultsJSON(), "distros": distros,
		})
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
	switch path {
	case "/settings":
		var body AgentResumeSettings
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&body) != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "pedido inválido"})
			return
		}
		if err := validResumeSettings(body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		if err := settings.setAgentResume(body); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"settings": settings.agentResume()})
	case "/run", "/dismiss":
		var body struct {
			PaneIDs []int `json:"pane_ids"`
			All     bool  `json:"all"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&body) != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "pedido inválido"})
			return
		}
		taken := s.hub.takeResumeOffers(body.PaneIDs, body.All)
		if path == "/run" {
			cfg := settings.agentResume()
			for _, o := range taken {
				if err := s.hub.resumeIn(o, cfg); err != nil {
					writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
					return
				}
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "count": len(taken)})
	case "/setup":
		var body struct {
			Target string `json:"target"`
			Distro string `json:"distro"`
			Action string `json:"action"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&body) != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "pedido inválido"})
			return
		}
		on, out, err := agentHookSetup(r, body.Target, body.Distro, body.Action)
		resp := map[string]any{"ok": on, "output": out}
		if err != nil {
			resp["error"] = err.Error()
		}
		writeJSON(w, http.StatusOK, resp)
	default:
		http.NotFound(w, r)
	}
}

// --- hook no settings.json do Claude ---------------------------------------

const agentHookMarker = "agent-hook"

var agentHookEvents = []string{"SessionStart", "SessionEnd"}

func agentHookCommand(tool string, wsl bool) string {
	if wsl {
		return shSingleQuote(windowsPathToWSLMount(tool)) + " " + agentHookMarker + " --lado wsl"
	}
	return `"` + strings.ReplaceAll(tool, `\`, "/") + `" ` + agentHookMarker
}

func agentHookIsOurs(h any) bool {
	m, ok := h.(map[string]any)
	if !ok {
		return false
	}
	cmd, _ := m["command"].(string)
	return strings.Contains(cmd, " "+agentHookMarker) && strings.Contains(strings.ToLower(cmd), "bethstudio-tool")
}

func agentHookSetup(r *http.Request, target, distro, action string) (bool, string, error) {
	switch action {
	case "add", "remove", "check":
	default:
		return false, "", errors.New("ação inválida")
	}
	tool := ponteToolPath()
	if tool == "" && action == "add" {
		return false, "", errors.New("não achei o bethstudio-tool.exe ao lado do Studio")
	}
	path, err := ponteHookSettingsPath(r.Context(), target, distro)
	if err != nil {
		return false, "", err
	}
	spec := claudeHookSpec{
		events: agentHookEvents,
		isOurs: agentHookIsOurs,
		entry: func() map[string]any {
			return map[string]any{"type": "command", "command": agentHookCommand(tool, target == "wsl"), "timeout": 10}
		},
	}
	on, msg, err := claudeHookApply(path, action, spec)
	if err != nil {
		return false, "", err
	}
	if action == "check" {
		if on {
			msg = "Ligado neste lado."
		} else {
			msg = "Desligado neste lado."
		}
	}
	return on, msg + "\n(" + path + ")", nil
}
