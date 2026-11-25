package main

// cpu_limit.go — "Limitar CPU dos terminais": um teto em % da CPU do PC para
// o host e tudo o que ele abriu (shells, agentes, builds), sem encerrar nada.
// No Windows é um job object com teto rígido (os processos novos entram no
// job sozinhos). Os terminais WSL rodam na VM do WSL, fora do job: lá o teto
// vira uma quantidade de núcleos (taskset nos processos do usuário da distro).
// No macOS o teto é um duty-cycle (SIGCONT/SIGSTOP) na árvore do host
// (cpu_limit_darwin.go). O limite pode ter prazo; ao vencer, tudo volta ao
// normal. A parte Windows está em cpu_limit_windows.go.

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

// CPULimitState é gravado em dataDir()/cpu-limit.json: o limite continua
// depois de reiniciar o Studio, e um prazo vencido com o Studio fechado é
// desfeito na próxima subida.
type CPULimitState struct {
	Percent int   `json:"percent"` // 0 = sem limite
	Until   int64 `json:"until"`   // unix; 0 = até remover
	WSL     bool  `json:"wsl"`
	// Restore: há processos para devolver (o limite saiu e a devolução não terminou)
	Restore     bool `json:"restore,omitempty"`
	LastPercent int  `json:"last_percent,omitempty"`
	LastMinutes int  `json:"last_minutes,omitempty"`
}

// CPULimitView é o que a interface recebe (evento cpu_limit e GET).
type CPULimitView struct {
	CPULimitState
	Total    int    `json:"total"`       // núcleos lógicos do PC
	WSLCores int    `json:"wsl_cores"`   // núcleos que o WSL usa com o limite
	AppWin   int    `json:"applied_win"` // processos no teto (Windows), última passada
	AppWSL   int    `json:"applied_wsl"`
	Err      string `json:"error,omitempty"`
}

type cpuLimiter struct {
	mu     sync.Mutex
	file   string
	st     CPULimitState
	total  int
	appWin int
	appWSL int
	err    string
	wake   chan struct{}
	// resetAff: a próxima passada também desfaz afinidade (limite novo ou tirado)
	resetAff bool
}

func newCPULimiter(file string, total int) *cpuLimiter {
	l := &cpuLimiter{file: file, total: total, wake: make(chan struct{}, 1)}
	if file != "" {
		if b, err := os.ReadFile(file); err == nil {
			_ = json.Unmarshal(b, &l.st)
		}
	}
	return l
}

var cpuLimit = newCPULimiter(filepath.Join(dataDir(), "cpu-limit.json"), runtime.NumCPU())

func (l *cpuLimiter) saveLocked() {
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

// wslCores: o teto em núcleos para o WSL (arredonda, no mínimo 1).
func wslCores(percent, total int) int {
	n := int(math.Round(float64(percent) * float64(total) / 100))
	if n < 1 {
		n = 1
	}
	if n > total {
		n = total
	}
	return n
}

func (l *cpuLimiter) view() CPULimitView {
	l.mu.Lock()
	defer l.mu.Unlock()
	v := CPULimitView{CPULimitState: l.st, Total: l.total, AppWin: l.appWin, AppWSL: l.appWSL, Err: l.err}
	if l.st.Percent > 0 {
		v.WSLCores = wslCores(l.st.Percent, l.total)
	}
	return v
}

// set liga ou muda o limite; minutes 0 = até remover.
func (l *cpuLimiter) set(percent, minutes int, wsl bool, now time.Time) error {
	if percent < 5 || percent > 95 {
		return fmt.Errorf("escolha de 5%% a 95%%")
	}
	if minutes < 0 || minutes > 7*24*60 {
		return fmt.Errorf("prazo inválido")
	}
	l.mu.Lock()
	if l.st.Percent > 0 && l.st.WSL && !wsl {
		l.st.Restore = true // o WSL saiu do limite: devolver lá
	}
	l.st.Percent, l.st.WSL, l.st.Until = percent, wsl, 0
	if minutes > 0 {
		l.st.Until = now.Add(time.Duration(minutes) * time.Minute).Unix()
	}
	l.st.LastPercent, l.st.LastMinutes = percent, minutes
	l.err = ""
	l.resetAff = true
	l.saveLocked()
	l.mu.Unlock()
	l.poke()
	return nil
}

// off: volta ao normal (a devolução acontece na próxima passada, já).
func (l *cpuLimiter) off() {
	l.mu.Lock()
	l.st.Percent, l.st.Until, l.st.Restore = 0, 0, true
	l.resetAff = true
	l.saveLocked()
	l.mu.Unlock()
	l.poke()
}

func (l *cpuLimiter) poke() {
	select {
	case l.wake <- struct{}{}:
	default:
	}
}

// cpuPlan: o que a passada faz agora. Win: % do teto (0 = tirar o teto,
// -1 = não mexer). WSL: núcleos (0 = devolver todos, -1 = não mexer).
// Expired: o prazo venceu nesta passada (aviso na bandeja).
type cpuPlan struct {
	Win, WSL int
	Expired  bool
	ResetAff bool
}

func (p cpuPlan) idle() bool { return p.Win < 0 && p.WSL < 0 }

func (l *cpuLimiter) plan(now time.Time) cpuPlan {
	l.mu.Lock()
	defer l.mu.Unlock()
	p := l.planLocked(now)
	if !p.idle() {
		p.ResetAff = l.resetAff || p.Win == 0
		l.resetAff = false
	}
	return p
}

func (l *cpuLimiter) planLocked(now time.Time) cpuPlan {
	expired := false
	if l.st.Percent > 0 && l.st.Until > 0 && now.Unix() >= l.st.Until {
		l.st.Percent, l.st.Until, l.st.Restore = 0, 0, true
		l.saveLocked()
		expired = true
	}
	switch {
	case l.st.Percent > 0:
		p := cpuPlan{Win: l.st.Percent, WSL: -1}
		if l.st.WSL {
			p.WSL = wslCores(l.st.Percent, l.total)
		} else if l.st.Restore {
			p.WSL = 0
		}
		return p
	case l.st.Restore:
		return cpuPlan{Win: 0, WSL: 0, Expired: expired}
	}
	return cpuPlan{Win: -1, WSL: -1}
}

// done registra o resultado de uma passada.
func (l *cpuLimiter) done(p cpuPlan, win, wsl int, err string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.appWin, l.appWSL, l.err = win, wsl, err
	if p.Win <= 0 {
		l.appWin = 0
	}
	if p.WSL <= 0 {
		l.appWSL = 0
	}
	if (p.Win == 0 || p.WSL == 0) && err == "" && l.st.Restore {
		l.st.Restore = false
		l.saveLocked()
	}
}

// cpuMask: todos os núcleos lógicos (para desfazer afinidade).
func cpuMask(total int) uint64 {
	if total >= 64 {
		return ^uint64(0)
	}
	return (uint64(1) << uint(total)) - 1
}

// cpuLimitText: "70% até 23:15" / "70% (até você remover)".
func cpuLimitText(st CPULimitState) string {
	n := fmt.Sprintf("%d%%", st.Percent)
	if st.Until == 0 {
		return n + " (até você remover)"
	}
	return n + " até " + time.Unix(st.Until, 0).Format("15:04")
}

// durText: 30 min, 1 h, 1 h 30 min.
func durText(min int) string {
	if min <= 0 {
		return "até remover"
	}
	if min < 60 {
		return fmt.Sprintf("%d min", min)
	}
	if min%60 == 0 {
		return fmt.Sprintf("%d h", min/60)
	}
	return fmt.Sprintf("%d h %d min", min/60, min%60)
}

// cpuLinuxScript: prende nos últimos N núcleos (ou devolve todos, N=0) os
// processos do usuário da distro; só chama o taskset para quem ainda não
// está com a lista certa. Saída: "OK <alterados> <na lista> <nproc>" ou
// "NOTASKSET".
func cpuLinuxScript(cores int) string {
	return strings.ReplaceAll(`N=__N__
command -v taskset >/dev/null 2>&1 || { echo NOTASKSET; exit 0; }
n=$(nproc --all)
lo=0
if [ "$N" -gt 0 ] && [ "$N" -lt "$n" ]; then lo=$((n-N)); fi
if [ "$lo" -eq "$((n-1))" ]; then list="$lo"; else list="$lo-$((n-1))"; fi
c=0; k=0
for d in /proc/[0-9]*; do
  p=${d#/proc/}
  [ "$p" -gt 1 ] || continue
  [ -O "$d" ] || continue
  nm=""; cur=""
  while read -r a b; do
    case "$a" in Name:) nm=$b ;; Cpus_allowed_list:) cur=$b; break ;; esac
  done < "$d/status" 2>/dev/null
  [ "$nm" = init ] && continue
  [ -n "$cur" ] || continue
  if [ "$cur" = "$list" ]; then k=$((k+1)); continue; fi
  taskset -a -p -c "$list" "$p" >/dev/null 2>&1 && { c=$((c+1)); k=$((k+1)); }
done
echo OK $c $k $n
`, "__N__", fmt.Sprint(cores))
}

// parseCPULinux lê a resposta do script.
func parseCPULinux(out string) (held int, err error) {
	for _, ln := range strings.Split(strings.TrimSpace(out), "\n") {
		ln = strings.TrimSpace(ln)
		if ln == "NOTASKSET" {
			return 0, fmt.Errorf("taskset não está instalado")
		}
		var c, k, n int
		if _, e := fmt.Sscanf(ln, "OK %d %d %d", &c, &k, &n); e == nil {
			return k, nil
		}
	}
	return 0, fmt.Errorf("resposta inesperada do WSL")
}

// --- hub e HTTP ----------------------------------------------------------

func (h *hub) publishCPULimit() {
	b, err := json.Marshal(map[string]any{"ev": "cpu_limit", "limit": cpuLimit.view()})
	if err != nil {
		return
	}
	h.mu.Lock()
	h.cpuLimitMsg = b
	cs := h.clientsLocked()
	h.mu.Unlock()
	for _, c := range cs {
		c.enqueue(b)
	}
}

// cpuLimitSet / cpuLimitOff: o mesmo caminho para a bandeja e o HTTP.
func (h *hub) cpuLimitSet(percent, minutes int, wsl bool) error {
	if runtime.GOOS != "windows" {
		wsl = false
	}
	if err := cpuLimit.set(percent, minutes, wsl, time.Now()); err != nil {
		return err
	}
	lifeLog(fmt.Sprintf("limite de CPU dos terminais: %d%%, %s, WSL=%v", percent, durText(minutes), wsl))
	h.publishCPULimit()
	return nil
}

func (h *hub) cpuLimitOff() {
	lifeLog("limite de CPU dos terminais removido pelo usuário")
	cpuLimit.off()
	h.publishCPULimit()
}

func (s *server) serveCPULimit(w http.ResponseWriter, r *http.Request) {
	sub := strings.TrimPrefix(r.URL.Path, "/api/cpu-limit")
	if sub == "" && r.Method == http.MethodGet {
		writeJSON(w, http.StatusOK, map[string]any{"limit": cpuLimit.view()})
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
		s.hub.cpuLimitOff()
	case "/set":
		var body struct {
			Percent int  `json:"percent"`
			Minutes int  `json:"minutes"`
			WSL     bool `json:"wsl"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&body) != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "pedido inválido"})
			return
		}
		if err := s.hub.cpuLimitSet(body.Percent, body.Minutes, body.WSL); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": err.Error()})
			return
		}
	default:
		http.NotFound(w, r)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "limit": cpuLimit.view()})
}

// cpuDefaultMinutes: o prazo quando o limite nunca foi usado (2 h).
const cpuDefaultMinutes = 120
