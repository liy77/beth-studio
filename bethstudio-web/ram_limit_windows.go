//go:build windows

package main

import (
	"context"
	"fmt"
	"strings"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

func systemRAMTotal() uint64 {
	var m memoryStatusEx
	m.Length = uint32(unsafe.Sizeof(m))
	if r, _, _ := smGlobalMemoryStatusEx.Call(uintptr(unsafe.Pointer(&m))); r == 0 {
		return 8 << 30
	}
	if m.TotalPhys == 0 {
		return 8 << 30
	}
	return m.TotalPhys
}

func setJobMemoryLimit(job windows.Handle, bytes uint64) error {
	var info windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION
	if err := windows.QueryInformationJobObject(job, windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info)), nil); err != nil {
		return err
	}
	if bytes > 0 {
		info.BasicLimitInformation.LimitFlags |= windows.JOB_OBJECT_LIMIT_JOB_MEMORY
		info.JobMemoryLimit = uintptr(bytes)
	} else {
		info.BasicLimitInformation.LimitFlags &^= windows.JOB_OBJECT_LIMIT_JOB_MEMORY
		info.JobMemoryLimit = 0
	}
	_, err := windows.SetInformationJobObject(job, windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info)))
	return err
}

func hostTreeUsedBytes() (uint64, int, error) {
	tree, err := hostTree()
	if err != nil {
		return 0, 0, err
	}
	procs, err := readProcesses()
	if err != nil {
		return 0, len(tree), err
	}
	byPID := map[uint32]*procInfo{}
	for _, p := range procs {
		byPID[p.PID] = p
	}
	var used uint64
	for _, pid := range tree {
		if p := byPID[pid]; p != nil {
			used += p.WS
		}
	}
	return used, len(tree), nil
}

// applyWinRAMLimit: bytes > 0 põe teto de memória no job; 0 remove.
func applyWinRAMLimit(bytes uint64) (applied int, used uint64, err error) {
	job, err := cpuJobHandle()
	if err != nil {
		return 0, 0, fmt.Errorf("job: %w", err)
	}
	if err := setJobMemoryLimit(job, bytes); err != nil {
		return 0, 0, fmt.Errorf("teto de RAM: %w", err)
	}
	used, n, uerr := hostTreeUsedBytes()
	if uerr != nil {
		if bytes == 0 {
			return 0, 0, nil
		}
		return 0, 0, uerr
	}
	if bytes > 0 {
		tree, terr := hostTree()
		if terr != nil {
			return 0, used, terr
		}
		n = applyJobTree(job, 1, tree, false)
	}
	return n, used, nil
}

func (h *hub) runRAMLimit(ctx context.Context) {
	t := time.NewTimer(5 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		case <-ramLimit.wake:
		}
		p := ramLimit.plan(time.Now())
		if !p.idle() {
			var n int
			var used uint64
			var msgs []string
			k, u, err := applyWinRAMLimit(uint64(max64(p.Bytes, 0)))
			n, used = k, u
			if err != nil {
				msgs = append(msgs, err.Error())
			}
			ramLimit.done(p, n, used, false, strings.Join(msgs, " · "))
			h.publishRAMLimit()
			if p.Expired {
				lifeLog("limite de RAM dos terminais venceu; tudo volta ao normal")
				trayBalloon("RAM dos terminais de volta ao normal", "O prazo do limite acabou. Os terminais voltaram a usar a RAM sem teto.")
			}
		}
		t.Reset(cpuLimitEvery)
	}
}

func max64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
