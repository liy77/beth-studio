//go:build darwin

package main

/*
#cgo LDFLAGS: -framework Cocoa -framework WebKit -framework QuartzCore
#include <stdlib.h>
void bethOpen(const char *url, const char *title, int width, int height);
void bethSetAuxWindow(int on);
void bethRun(void);
void bethOrderFront(void);
void bethOrderFrontAsync(void);
void bethTrayInit(void);
void bethStop(void);
void bethInspect(void);
int bethAsk(const char *text, const char *title);
char *bethPickFolder(const char *initial);

void bethSidebarFrame(double windowHeight, double *top, double *bottom);
void bethEnableTermDrag(int on);
int bethScreenToClient(int sx, int sy, int *outX, int *outY);
*/
import "C"

import (
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"unsafe"
)

//export goTrayOpen
func goTrayOpen() { C.bethOrderFront() }

//export goTrayQuit
func goTrayQuit() { releaseStudioClaim(); C.bethStop() }

//export goTrayKill
func goTrayKill() {
	text := C.CString("Encerrar o Beth Studio e todos os terminais abertos?")
	title := C.CString(appTitle)
	defer C.free(unsafe.Pointer(text))
	defer C.free(unsafe.Pointer(title))
	if C.bethAsk(text, title) == 0 {
		return
	}
	ctl := newHostCtl()
	if err := ctl.RequestQuit("Studio — Encerrar tudo (confirmado pelo usuário)"); err != nil {
		messageBox(appTitle, err.Error())
		return
	}
	goTrayQuit()
}

//export goTrayInspect
func goTrayInspect() { C.bethInspect() }

// No Mac o processo filho não precisa da janela escondida do Windows.
func hideChildWindow(attr **syscall.SysProcAttr) {}

const secretsFile = "secrets.dat"

type secretStore struct {
	mu   sync.Mutex
	dir  string
	keys map[string]string
}

var secrets = &secretStore{}

func (s *secretStore) load(dir string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.dir = dir
	s.keys = map[string]string{}
	s.reloadLocked()
}

func (s *secretStore) reloadLocked() {
	if s.dir == "" {
		return
	}
	b, err := os.ReadFile(filepath.Join(s.dir, secretsFile))
	if err != nil {
		if os.IsNotExist(err) {
			s.keys = map[string]string{}
		}
		return
	}
	keys := map[string]string{}
	if json.Unmarshal(b, &keys) == nil {
		s.keys = keys
	}
}

func (s *secretStore) saveLocked() error {
	b, err := json.Marshal(s.keys)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(s.dir, secretsFile), b, 0o600)
}

func (s *secretStore) set(provider, key string) error {
	key = strings.TrimSpace(key)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.reloadLocked()
	if key == "" {
		delete(s.keys, provider)
	} else {
		s.keys[provider] = key
	}
	return s.saveLocked()
}

func (s *secretStore) get(provider string, env []string) (string, string) {
	s.mu.Lock()
	s.reloadLocked()
	k := s.keys[provider]
	s.mu.Unlock()
	if k != "" {
		return k, "salva"
	}
	for _, e := range env {
		if v := os.Getenv(e); v != "" {
			return v, "ambiente"
		}
	}
	return "", ""
}

func attachParentConsole() {}

func consoleTitlesHelperMain(string) int { return 0 }

func listWSLDistros() []string { return nil }

var stdioOK = true

func messageBox(title, text string) {
	_ = exec.Command("osascript", "-e", "display dialog "+quoteOSA(text)+" with title "+quoteOSA(title)).Run()
}

// nativePickFolder abre o NSOpenPanel (pastas). Cancelar = ("", false, nil).
func nativePickFolder(initial string) (string, bool, error) {
	var cInit *C.char
	if initial != "" {
		cInit = C.CString(initial)
		defer C.free(unsafe.Pointer(cInit))
	}
	p := C.bethPickFolder(cInit)
	if p == nil {
		return "", false, nil
	}
	defer C.free(unsafe.Pointer(p))
	return C.GoString(p), true, nil
}

func quoteOSA(s string) string {
	return `"` + strings.ReplaceAll(s, `"`, `\"`) + `"`
}

func nativeSideFrame(windowHeight float64) (top, bottom float64) {
	var t, b C.double
	C.bethSidebarFrame(C.double(windowHeight), &t, &b)
	return float64(t), float64(b)
}

func init() {
	// A thread que sobe o processo é a principal do AppKit. Sem isto o
	// runtime muda a goroutine de thread e o NSWindow nasce fora dela.
	runtime.LockOSThread()
}

func openWindow(pageURL string, devtools bool, width, height int) error {
	// AppKit recusa NSWindow fora da thread principal. A mesma thread tem de
	// criar a janela e rodar o ciclo, senão a janela nasce e não aparece.
	runtime.LockOSThread()
	aux := windowTitle != "" && windowTitle != appTitle
	if aux {
		// Terminal N: chrome embutido na página (FullSizeContentView).
		// Demais auxiliares: barra de título nativa.
		if strings.HasPrefix(windowTitle, "Terminal ") {
			C.bethSetAuxWindow(2)
		} else {
			C.bethSetAuxWindow(1)
		}
	}
	title := appTitle
	if windowTitle != "" {
		title = windowTitle
	}
	cu, ct := C.CString(pageURL), C.CString(title)
	defer C.free(unsafe.Pointer(cu))
	defer C.free(unsafe.Pointer(ct))
	C.bethOpen(cu, ct, C.int(width), C.int(height))
	if !aux {
		C.bethTrayInit()
		bringStudioForward = func() { C.bethOrderFrontAsync() }
		watchStudioFocus()
	} else {
		bringStudioForward = func() { C.bethOrderFrontAsync() }
		watchTasksFocus()
	}
	C.bethRun()
	return nil
}

func nativeSaveDialog(defaultName, ext string) (string, bool, error) {
	return "", false, errors.New("use o painel para salvar")
}

func nativeOpenDialog(initialDir string) (string, bool, error) {
	return "", false, errors.New("use a pasta da guia para abrir")
}

func openWithSystem(path string) error {
	return exec.Command("open", path).Run()
}

func cleanAgentName(s string) string { return strings.TrimSpace(s) }

func normKey(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func claudeSessionDirs(side, cwd string) []string {
	home, _ := os.UserHomeDir()
	if home == "" {
		return nil
	}
	return []string{filepath.Join(home, ".claude", "sessions")}
}

func claudeSessionName(dirs []string, sid string, pid int) string { return "" }

func windowsParentPID(pid int) int { return 0 }

func ponteDataDir() string { return dataDir() }

func listFontFamilies() []FontFamily {
	out, err := exec.Command("fc-list", ":family").Output()
	if err != nil {
		return []FontFamily{{Family: "Menlo"}, {Family: "SF Mono"}}
	}
	seen := map[string]bool{}
	var fams []FontFamily
	for _, line := range strings.Split(string(out), "\n") {
		name := strings.TrimSpace(strings.Split(line, ",")[0])
		if i := strings.LastIndex(name, ":"); i >= 0 {
			name = strings.TrimSpace(name[i+1:])
		}
		if name == "" || seen[strings.ToLower(name)] {
			continue
		}
		seen[strings.ToLower(name)] = true
		fams = append(fams, FontFamily{Family: name})
	}
	return fams
}
