//go:build windows

package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	procIsProcessInJob        = windows.NewLazySystemDLL("kernel32.dll").NewProc("IsProcessInJob")
	procSetProcessAffinityMsk = windows.NewLazySystemDLL("kernel32.dll").NewProc("SetProcessAffinityMask")
	procGetProcessAffinityMsk = windows.NewLazySystemDLL("kernel32.dll").NewProc("GetProcessAffinityMask")
)

const (
	jobCPURateEnable  = 0x1
	jobCPURateHardCap = 0x4
	cpuLimitEvery     = 20 * time.Second
)

type jobCPURate struct{ Flags, Rate uint32 }

// cpuJob: o job do teto. Tem nome para o Studio reiniciado reabrir o mesmo
// (os processos continuam nele; só o teto muda). Nunca tem KILL_ON_JOB_CLOSE:
// fechar o Studio não encerra nada.
var cpuJob windows.Handle

func cpuJobHandle() (windows.Handle, error) {
	if cpuJob != 0 {
		return cpuJob, nil
	}
	name := `Local\BethStudioCpuLimit`
	if id := os.Getenv("BETHSTUDIO_HOST_ID"); id != "" {
		name += "-" + id
	}
	p, _ := windows.UTF16PtrFromString(name)
	h, err := windows.CreateJobObject(nil, p)
	if err != nil {
		return 0, err
	}
	cpuJob = h
	return h, nil
}

func setJobCPURate(job windows.Handle, percent int) error {
	r := jobCPURate{}
	if percent > 0 {
		r = jobCPURate{Flags: jobCPURateEnable | jobCPURateHardCap, Rate: uint32(percent * 100)}
	}
	_, err := windows.SetInformationJobObject(job, windows.JobObjectCpuRateControlInformation, uintptr(unsafe.Pointer(&r)), uint32(unsafe.Sizeof(r)))
	return err
}

func jobActiveProcesses(job windows.Handle) int {
	var ji struct {
		TotalUserTime, TotalKernelTime, ThisPeriodUser, ThisPeriodKernel int64
		PageFaults, Total, Active, Terminated                            uint32
	}
	if windows.QueryInformationJobObject(job, windows.JobObjectBasicAccountingInformation, uintptr(unsafe.Pointer(&ji)), uint32(unsafe.Sizeof(ji)), nil) != nil {
		return 0
	}
	return int(ji.Active)
}

// hostTree: o host em execução e todos os descendentes (Windows).
func hostTree() ([]uint32, error) {
	b, err := os.ReadFile(hostPidPath())
	if err != nil {
		return nil, errors.New("o host não está rodando")
	}
	pid64, err := strconv.ParseUint(strings.TrimSpace(string(b)), 10, 32)
	if err != nil {
		return nil, err
	}
	procs, err := readProcesses()
	if err != nil {
		return nil, err
	}
	root := uint32(pid64)
	kids := map[uint32][]*procInfo{}
	var rootInfo *procInfo
	for _, p := range procs {
		if p.PID == root {
			rootInfo = p
		}
		kids[p.PPID] = append(kids[p.PPID], p)
	}
	if rootInfo == nil || !strings.EqualFold(rootInfo.Name, "bethstudio-host.exe") {
		return nil, errors.New("o host não está rodando")
	}
	out := []uint32{root}
	for i := 0; i < len(out); i++ {
		for _, k := range kids[out[i]] {
			// pid reaproveitado: o filho tem de ter nascido depois do pai
			if k.PID != out[i] && k.Created >= rootInfo.Created {
				out = append(out, k.PID)
			}
		}
	}
	return out, nil
}

// applyWinCPULimit põe o host e os descendentes no job com o teto (percent > 0)
// ou tira o teto (0). Ao tirar, também devolve todos os núcleos a quem estava
// preso por afinidade. Devolve quantos processos estão no job.
func applyWinCPULimit(percent int, resetAff bool) (int, error) {
	job, err := cpuJobHandle()
	if err != nil {
		return 0, fmt.Errorf("job: %w", err)
	}
	if err := setJobCPURate(job, percent); err != nil {
		return 0, fmt.Errorf("teto: %w", err)
	}
	tree, err := hostTree()
	if err != nil {
		if percent == 0 {
			return 0, nil // sem host, nada a devolver
		}
		return 0, err
	}
	return applyJobTree(job, percent, tree, resetAff), nil
}

// applyJobTree: põe os processos no job (percent > 0). Com resetAff (o
// usuário acabou de ligar, mudar ou tirar o limite), também devolve todos os
// núcleos a quem estava preso por afinidade, para não somar dois limites.
func applyJobTree(job windows.Handle, percent int, tree []uint32, resetAff bool) int {
	all := cpuMask(cpuLimit.total)
	for _, pid := range tree {
		if percent > 0 {
			h, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE|windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
			if err != nil {
				continue
			}
			var in int32
			r, _, _ := procIsProcessInJob.Call(uintptr(h), uintptr(job), uintptr(unsafe.Pointer(&in)))
			if r == 0 || in == 0 {
				_ = windows.AssignProcessToJobObject(job, h)
			}
			_ = windows.CloseHandle(h)
		}
		if !resetAff {
			continue
		}
		h, err := windows.OpenProcess(windows.PROCESS_SET_INFORMATION|windows.PROCESS_QUERY_INFORMATION, false, pid)
		if err != nil {
			continue
		}
		var pm, sm uintptr
		if r, _, _ := procGetProcessAffinityMsk.Call(uintptr(h), uintptr(unsafe.Pointer(&pm)), uintptr(unsafe.Pointer(&sm))); r != 0 && sm != 0 && pm != sm {
			want := sm
			if uint64(all) < uint64(sm) {
				want = uintptr(all)
			}
			_, _, _ = procSetProcessAffinityMsk.Call(uintptr(h), want)
		}
		_ = windows.CloseHandle(h)
	}
	return jobActiveProcesses(job)
}

// applyWSLCPULimit: cores > 0 prende nos últimos núcleos; 0 devolve todos.
// Só mexe nas distros já ligadas (não liga nenhuma).
func applyWSLCPULimit(cores int) (int, error) {
	held := 0
	var errs []string
	for _, d := range apRunningDistros() {
		o, err := runHiddenOutput(20*time.Second, system32("wsl.exe"), "-d", d, "-e", "sh", "-c", cpuLinuxScript(cores))
		if err != nil && len(o) == 0 {
			errs = append(errs, d+": "+err.Error())
			continue
		}
		k, perr := parseCPULinux(string(o))
		if perr != nil {
			errs = append(errs, d+": "+perr.Error())
			continue
		}
		held += k
	}
	if len(errs) > 0 {
		return held, errors.New("WSL " + strings.Join(errs, "; "))
	}
	return held, nil
}

// runCPULimit: aplica o limite de 20 em 20 s (o que o host abriu depois entra
// no job sozinho; no WSL os terminais novos nascem do init e precisam da
// passada), desfaz ao vencer o prazo e avisa na bandeja.
func (h *hub) runCPULimit(ctx context.Context) {
	t := time.NewTimer(5 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		case <-cpuLimit.wake:
		}
		p := cpuLimit.plan(time.Now())
		if !p.idle() {
			var win, wsl int
			var msgs []string
			if p.Win >= 0 {
				n, err := applyWinCPULimit(p.Win, p.ResetAff)
				win = n
				if err != nil {
					msgs = append(msgs, err.Error())
				}
			}
			if p.WSL >= 0 {
				n, err := applyWSLCPULimit(p.WSL)
				wsl = n
				if err != nil {
					msgs = append(msgs, err.Error())
				}
			}
			cpuLimit.done(p, win, wsl, strings.Join(msgs, " · "))
			h.publishCPULimit()
			if p.Expired {
				lifeLog("limite de CPU dos terminais venceu; tudo volta ao normal")
				trayBalloon("CPU dos terminais de volta ao normal", "O prazo do limite acabou. Os terminais voltaram a usar a CPU toda.")
			}
		}
		t.Reset(cpuLimitEvery)
	}
}
