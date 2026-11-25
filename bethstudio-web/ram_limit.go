package main

// ram_limit.go — "Limitar RAM dos terminais": um teto em % da RAM do PC para
// o host e tudo o que ele abriu (shells, agentes, builds), sem encerrar nada.
// No Windows é JOB_OBJECT_LIMIT_JOB_MEMORY no mesmo job do teto de CPU.
// No macOS, se a árvore passar do teto, o Studio congela (SIGSTOP) até a
// memória cair ou o limite subir — o duty-cycle de CPU compartilha o mesmo
// loop (limit_darwin.go). O limite pode ter prazo; ao vencer, tudo volta.

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// RAMLimitState é gravado em dataDir()/ram-limit.json.
type RAMLimitState struct {
	Percent     int   `json:"percent"` // 0 = sem limite
	Until       int64 `json:"until"`   // unix; 0 = até remover
	Restore     bool  `json:"restore,omitempty"`
	LastPercent int   `json:"last_percent,omitempty"`
	LastMinutes int   `json:"last_minutes,omitempty"`
}

// RAMLimitView é o que a interface recebe (evento ram_limit e GET).
type RAMLimitView struct {
	RAMLimitState
	TotalBytes uint64 `json:"total_bytes"`
	LimitBytes uint64 `json:"limit_bytes"`
	UsedBytes  uint64 `json:"used_bytes"`
	Applied    int    `json:"applied"`
	Frozen     bool   `json:"frozen"` // macOS: árvore pausada por estar acima do teto
	Err        string `json:"error,omitempty"`
}

type ramLimiter struct {
	mu      sync.Mutex
	file    string
	st      RAMLimitState
	total   uint64
	limitB  uint64
	usedB   uint64
	applied int
	frozen  bool
	err     string
	wake    chan struct{}
}

func newRAMLimiter(file string, total uint64) *ramLimiter {
	if total == 0 {
		total = 8 << 30
	}
	l := &ramLimiter{file: file, total: total, wake: make(chan struct{}, 1)}
	if file != "" {
		if b, err := os.ReadFile(file); err == nil {
			_ = json.Unmarshal(b, &l.st)
		}
	}
	return l
}

var ramLimit = newRAMLimiter(filepath.Join(dataDir(), "ram-limit.json"), systemRAMTotal())

func (l *ramLimiter) saveLocked() {
	if l.file == "" {
		return
	}
	b, _ := json.MarshalIndent(l.st, "", "  ")
	_ = os.MkdirAll(filepath.Dir(l.file), 0o755)
	tmp := l.file + ".tmp"
	if os.WriteFile(tmp, b, 0o644) == nil {
		_ = os.Rename(tmp, l.file)
	}
}

func ramBytesFor(percent int, total uint64) uint64 {
	if percent <= 0 || total == 0 {
		return 0
	}
	n := uint64(math.Round(float64(percent) * float64(total) / 100))
	const minB = 256 << 20 // 256 MiB
	if n < minB {
		n = minB
	}
	if n > total {
		n = total
	}
	return n
}

func (l *ramLimiter) view() RAMLimitView {
	l.mu.Lock()
	defer l.mu.Unlock()
	v := RAMLimitView{
		RAMLimitState: l.st,
		TotalBytes:    l.total,
		UsedBytes:     l.usedB,
		Applied:       l.applied,
		Frozen:        l.frozen,
		Err:           l.err,
	}
	if l.st.Percent > 0 {
		v.LimitBytes = ramBytesFor(l.st.Percent, l.total)
	}
	return v
}

func (l *ramLimiter) set(percent, minutes int, now time.Time) error {
	if percent < 10 || percent > 90 {
		return fmt.Errorf("escolha de 10%% a 90%%")
	}
	if minutes < 0 || minutes > 7*24*60 {
		return fmt.Errorf("prazo inválido")
	}
	l.mu.Lock()
	l.st.Percent, l.st.Until = percent, 0
	if minutes > 0 {
		l.st.Until = now.Add(time.Duration(minutes) * time.Minute).Unix()
	}
	l.st.LastPercent, l.st.LastMinutes = percent, minutes
	l.st.Restore = false
	l.err = ""
	l.saveLocked()
	l.mu.Unlock()
	l.poke()
	return nil
}

func (l *ramLimiter) off() {
	l.mu.Lock()
	l.st.Percent, l.st.Until, l.st.Restore = 0, 0, true
	l.saveLocked()
	l.mu.Unlock()
	l.poke()
}

func (l *ramLimiter) poke() {
	select {
	case l.wake <- struct{}{}:
	default:
	}
}

// ramPlan: Bytes > 0 aplica teto; 0 remove; -1 não mexe.
type ramPlan struct {
	Bytes   int64
	Expired bool
}

func (p ramPlan) idle() bool { return p.Bytes < 0 }

func (l *ramLimiter) plan(now time.Time) ramPlan {
	l.mu.Lock()
	defer l.mu.Unlock()
	expired := false
	if l.st.Percent > 0 && l.st.Until > 0 && now.Unix() >= l.st.Until {
		l.st.Percent, l.st.Until, l.st.Restore = 0, 0, true
		l.saveLocked()
		expired = true
	}
	switch {
	case l.st.Percent > 0:
		return ramPlan{Bytes: int64(ramBytesFor(l.st.Percent, l.total))}
	case l.st.Restore:
		return ramPlan{Bytes: 0, Expired: expired}
	}
	return ramPlan{Bytes: -1}
}

func (l *ramLimiter) done(p ramPlan, applied int, used uint64, frozen bool, err string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.applied, l.usedB, l.frozen, l.err = applied, used, frozen, err
	if p.Bytes <= 0 {
		l.applied = 0
		l.frozen = false
		if p.Bytes == 0 {
			l.limitB = 0
		}
	} else {
		l.limitB = uint64(p.Bytes)
	}
	if p.Bytes == 0 && err == "" && l.st.Restore {
		l.st.Restore = false
		l.saveLocked()
	}
}

func ramLimitText(st RAMLimitState) string {
	n := fmt.Sprintf("%d%%", st.Percent)
	if st.Until == 0 {
		return n + " (até você remover)"
	}
	return n + " até " + time.Unix(st.Until, 0).Format("15:04")
}

func (h *hub) publishRAMLimit() {
	b, err := json.Marshal(map[string]any{"ev": "ram_limit", "limit": ramLimit.view()})
	if err != nil {
		return
	}
	h.mu.Lock()
	h.ramLimitMsg = b
	cs := h.clientsLocked()
	h.mu.Unlock()
	for _, c := range cs {
		c.enqueue(b)
	}
}

func (h *hub) ramLimitSet(percent, minutes int) error {
	if err := ramLimit.set(percent, minutes, time.Now()); err != nil {
		return err
	}
	lifeLog(fmt.Sprintf("limite de RAM dos terminais: %d%%, %s", percent, durText(minutes)))
	h.publishRAMLimit()
	return nil
}

func (h *hub) ramLimitOff() {
	lifeLog("limite de RAM dos terminais removido pelo usuário")
	ramLimit.off()
	h.publishRAMLimit()
}

func (s *server) serveRAMLimit(w http.ResponseWriter, r *http.Request) {
	sub := strings.TrimPrefix(r.URL.Path, "/api/ram-limit")
	if sub == "" && r.Method == http.MethodGet {
		writeJSON(w, http.StatusOK, map[string]any{"limit": ramLimit.view()})
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "use POST", http.StatusMethodNotAllowed)
		return
	}
	if s.hub.readOnly {
		writeJSON(w, http.StatusForbidden, map[string]any{"ok": false, "error": "modo somente leitura"})
		return
	}
	switch sub {
	case "/off":
		s.hub.ramLimitOff()
	case "/set":
		var body struct {
			Percent int `json:"percent"`
			Minutes int `json:"minutes"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&body) != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "pedido inválido"})
			return
		}
		if err := s.hub.ramLimitSet(body.Percent, body.Minutes); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": err.Error()})
			return
		}
	default:
		http.NotFound(w, r)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "limit": ramLimit.view()})
}

const ramDefaultMinutes = 120
