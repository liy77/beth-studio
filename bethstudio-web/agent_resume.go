package main

// agent_resume.go — "Retomar sessões do Claude" depois que o host reinicia.
//
// Um hook do Claude Code (`bethstudio-tool.exe agent-hook`, nos eventos
// SessionStart e SessionEnd) grava, para cada terminal, qual sessão do Claude
// roda nele: o terminal vem de WEZTERM_PANE (o host põe essa variável em todo
// terminal; o patch 0205 a leva também para dentro do WSL) e o host vem do
// host.pid, como em toda identidade de pane do Studio. Um arquivo por terminal
// em <dados>\agent-sessions.
//
// A receita da restauração (pane_specs.go) leva o id da sessão de cada
// terminal. Quando o host volta vazio e o Studio recria os terminais, cada
// terminal que tinha uma sessão vira uma oferta: a faixa do Studio mostra
// "Retomar" (ou o Studio retoma sozinho, se a pessoa escolheu isso), que
// digita `claude --resume <id>` no terminal novo.

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

var agentSessionIDRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9-]{7,79}$`)

// agentRecord: o que o hook grava por terminal.
type agentRecord struct {
	Agent     string `json:"agent"` // "claude"
	SessionID string `json:"session_id"`
	Pane      int    `json:"pane"`
	Host      string `json:"host"`
	Cwd       string `json:"cwd,omitempty"`
	Side      string `json:"side,omitempty"` // windows | wsl
	At        int64  `json:"at"`             // unix: último SessionStart
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
	pane, err := strconv.Atoi(strings.TrimSpace(os.Getenv("WEZTERM_PANE")))
	if err != nil || pane < 0 || !agentSessionIDRe.MatchString(input.SessionID) {
		return 0 // fora de um terminal do Beth Studio, ou sem sessão
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
	now := time.Now().Unix()
	if input.Event == "SessionEnd" {
		var old agentRecord
		if raw, err := os.ReadFile(file); err == nil && json.Unmarshal(raw, &old) == nil && old.SessionID == input.SessionID {
			old.Ended = now
			if out, err := json.Marshal(old); err == nil {
				_ = writeAtomic(file, out)
			}
		}
		return 0
	}
	rec := agentRecord{Agent: "claude", SessionID: input.SessionID, Pane: pane, Host: host, Cwd: input.Cwd, Side: side, At: now}
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
	recs map[int]agentRecord
}

// agentRecordsFor: as sessões gravadas para os terminais do host `host`
// (lido no máximo a cada 3 s; a lista chega a cada 2 s). Arquivos de hosts
// antigos com mais de 14 dias são apagados.
func agentRecordsFor(dir, host string) map[int]agentRecord {
	agentRecCache.mu.Lock()
	defer agentRecCache.mu.Unlock()
	if agentRecCache.host == host && time.Since(agentRecCache.at) < 3*time.Second && agentRecCache.recs != nil {
		return agentRecCache.recs
	}
	out := map[int]agentRecord{}
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
		if agentSessionIDRe.MatchString(r.SessionID) {
			out[r.Pane] = r
		}
	}
	agentRecCache.at, agentRecCache.host, agentRecCache.recs = time.Now(), host, out
	return out
}

// attachAgentSessions põe na receita a sessão de cada terminal.
func attachAgentSessions(specs []paneSpec, recs map[int]agentRecord) []paneSpec {
	for i := range specs {
		if r, ok := recs[specs[i].PaneID]; ok {
			specs[i].Resume = &resumeSpec{Agent: r.Agent, SessionID: r.SessionID, Ended: r.Ended != 0, At: r.At}
		}
	}
	return specs
}

// resumeSpec: a sessão do agente que rodava no terminal (na receita).
type resumeSpec struct {
	Agent     string `json:"agent"`
	SessionID string `json:"session_id"`
	Ended     bool   `json:"ended,omitempty"` // a pessoa tinha saído do Claude
	At        int64  `json:"at,omitempty"`
}

// --- configuração ---------------------------------------------------------

// AgentResumeSettings: Configurações > Retomar sessões.
type AgentResumeSettings struct {
	// ask (padrão): a faixa oferece "Retomar"; auto: retoma sozinho as sessões
	// que estavam abertas; off: não oferece.
	Mode string `json:"mode,omitempty"`
	// Comando digitado no terminal; {id} vira o id da sessão.
	Command string `json:"command,omitempty"`
}

const defaultResumeCommand = "claude --resume {id}"

func (a AgentResumeSettings) normalized() AgentResumeSettings {
	switch a.Mode {
	case "ask", "auto", "off":
	default:
		a.Mode = "ask"
	}
	if strings.TrimSpace(a.Command) == "" {
		a.Command = defaultResumeCommand
	}
	return a
}

func validResumeCommand(c string) error {
	c = strings.TrimSpace(c)
	switch {
	case c == "":
		return nil
	case len(c) > 200:
		return errors.New("comando grande demais (até 200 caracteres)")
	case strings.ContainsAny(c, "\r\n\x00"):
		return errors.New("o comando tem que ser uma linha só")
	case !strings.Contains(c, "{id}"):
		return errors.New("o comando precisa ter {id} no lugar do id da sessão")
	}
	return nil
}

// resumeCommandFor: o texto digitado no terminal (sem o Enter).
func resumeCommandFor(tmpl, sid string) (string, error) {
	if !agentSessionIDRe.MatchString(sid) {
		return "", errors.New("id de sessão inválido")
	}
	if tmpl = strings.TrimSpace(tmpl); tmpl == "" {
		tmpl = defaultResumeCommand
	}
	return strings.ReplaceAll(tmpl, "{id}", sid), nil
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
		if s.Resume == nil || !agentSessionIDRe.MatchString(s.Resume.SessionID) {
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
func (h *hub) resumeIn(o resumeOffer, tmpl string) error {
	if h.bridge == nil {
		return errBridgeDown
	}
	cmd, err := resumeCommandFor(tmpl, o.SessionID)
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
				_ = h.resumeIn(o, cfg.Command)
			}
		}()
		return
	}
	h.setResumeOffers(offers)
}

// --- API -----------------------------------------------------------------

// serveAgentResume:
//
//	GET  /api/agent-resume                  -> {settings, offers, tool}
//	POST /api/agent-resume/settings {mode, command}
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
		writeJSON(w, http.StatusOK, map[string]any{"settings": settings.agentResume(), "offers": offers, "tool": ponteToolPath(), "default_command": defaultResumeCommand, "distros": distros})
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
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&body) != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "pedido inválido"})
			return
		}
		if err := validResumeCommand(body.Command); err != nil {
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
			tmpl := settings.agentResume().Command
			for _, o := range taken {
				if err := s.hub.resumeIn(o, tmpl); err != nil {
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
