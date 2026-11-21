//go:build windows

package main

// agent_env_windows.go — WEZTERM_PANE do ambiente de outro processo
// (PEB -> RTL_USER_PROCESS_PARAMETERS -> Environment), para saber em que
// terminal um agente roda (agent_ident.go). Só leitura; resultado em cache
// por processo (PID + hora de criação).

import (
	"strconv"
	"strings"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

var apEnvCache = struct {
	sync.Mutex
	m map[procKey]int // -1 = sem a variável
}{m: map[procKey]int{}}

func apPaneEnv(p *procInfo) (int, bool) {
	k := p.key()
	apEnvCache.Lock()
	v, ok := apEnvCache.m[k]
	apEnvCache.Unlock()
	if !ok {
		v = -1
		if s, found := readProcessEnvVar(p.PID, "WEZTERM_PANE"); found {
			if n, err := strconv.Atoi(strings.TrimSpace(s)); err == nil && n >= 0 {
				v = n
			}
		}
		apEnvCache.Lock()
		if len(apEnvCache.m) > 4000 {
			apEnvCache.m = map[procKey]int{}
		}
		apEnvCache.m[k] = v
		apEnvCache.Unlock()
	}
	return v, v >= 0
}

func readProcessEnvVar(pid uint32, name string) (string, bool) {
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION|windows.PROCESS_VM_READ, false, pid)
	if err != nil {
		return "", false
	}
	defer windows.CloseHandle(h)
	var pbi windows.PROCESS_BASIC_INFORMATION
	if err := windows.NtQueryInformationProcess(h, windows.ProcessBasicInformation, unsafe.Pointer(&pbi), uint32(unsafe.Sizeof(pbi)), nil); err != nil || pbi.PebBaseAddress == nil {
		return "", false
	}
	read := func(addr uintptr, dst unsafe.Pointer, n uintptr) bool {
		var got uintptr
		return windows.ReadProcessMemory(h, addr, (*byte)(dst), n, &got) == nil && got == n
	}
	var params uintptr
	if !read(uintptr(unsafe.Pointer(pbi.PebBaseAddress))+unsafe.Offsetof(windows.PEB{}.ProcessParameters), unsafe.Pointer(&params), unsafe.Sizeof(params)) || params == 0 {
		return "", false
	}
	var envPtr uintptr
	var envSize uintptr
	if !read(params+unsafe.Offsetof(windows.RTL_USER_PROCESS_PARAMETERS{}.Environment), unsafe.Pointer(&envPtr), unsafe.Sizeof(envPtr)) || envPtr == 0 {
		return "", false
	}
	if !read(params+unsafe.Offsetof(windows.RTL_USER_PROCESS_PARAMETERS{}.EnvironmentSize), unsafe.Pointer(&envSize), unsafe.Sizeof(envSize)) {
		return "", false
	}
	if envSize == 0 || envSize > 256<<10 {
		envSize = 64 << 10
	}
	buf := make([]uint16, envSize/2)
	var got uintptr
	if windows.ReadProcessMemory(h, envPtr, (*byte)(unsafe.Pointer(&buf[0])), envSize, &got) != nil && got == 0 {
		return "", false
	}
	buf = buf[:got/2]
	prefix := strings.ToUpper(name) + "="
	start := 0
	for i, c := range buf {
		if c != 0 {
			continue
		}
		if i == start {
			break // fim do bloco
		}
		kv := windows.UTF16ToString(buf[start:i])
		if strings.HasPrefix(strings.ToUpper(kv), prefix) {
			return kv[len(prefix):], true
		}
		start = i + 1
	}
	return "", false
}
