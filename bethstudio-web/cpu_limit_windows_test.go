//go:build windows

package main

import (
	"os/exec"
	"testing"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Teste real: uma árvore de processos em laço, teto de 5%, mede o job.
func TestCPUJobCapsTreeAndChildren(t *testing.T) {
	if testing.Short() {
		t.Skip("mede CPU de verdade")
	}
	t.Setenv("BETHSTUDIO_HOST_ID", "cputest")
	old := cpuJob
	cpuJob = 0
	defer func() {
		if cpuJob != 0 {
			_ = windows.CloseHandle(cpuJob)
		}
		cpuJob = old
	}()
	// o pai abre os filhos ocupados 2 s depois de entrar no job
	cmd := exec.Command("powershell", "-NoProfile", "-Command",
		"Start-Sleep 2; $j = 1..6 | % { Start-Job { while($true){} } }; Start-Sleep 30")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer cmd.Process.Kill()
	job, err := cpuJobHandle()
	if err != nil {
		t.Fatal(err)
	}
	if err := setJobCPURate(job, 5); err != nil {
		t.Fatal(err)
	}
	if n := applyJobTree(job, 5, []uint32{uint32(cmd.Process.Pid)}, true); n < 1 {
		t.Fatalf("no job: %d", n)
	}
	used := func() float64 {
		var ji struct {
			U, K, PU, PK       int64
			PF, Tot, Act, Term uint32
		}
		_ = windows.QueryInformationJobObject(job, windows.JobObjectBasicAccountingInformation, uintptr(unsafe.Pointer(&ji)), uint32(unsafe.Sizeof(ji)), nil)
		return float64(ji.U+ji.K) / 1e7
	}
	time.Sleep(9 * time.Second)
	a := used()
	time.Sleep(4 * time.Second)
	capped := (used() - a) / 4
	ncpu := float64(cpuLimit.total)
	if capped > 0.05*ncpu*1.5 {
		t.Fatalf("com teto de 5%% usou %.2f núcleos (máx %.2f)", capped, 0.05*ncpu)
	}
	// tirar o teto: volta a gastar (6 laços)
	if err := setJobCPURate(job, 0); err != nil {
		t.Fatal(err)
	}
	time.Sleep(time.Second)
	a = used()
	time.Sleep(3 * time.Second)
	free := (used() - a) / 3
	t.Logf("com teto %.2f núcleos, sem teto %.2f", capped, free)
	if free < capped*2 {
		t.Fatalf("sem teto não voltou: %.2f", free)
	}
	if jobActiveProcesses(job) < 7 {
		t.Fatalf("os filhos não entraram no job: %d", jobActiveProcesses(job))
	}
	// encerra os filhos de teste (só os deste job)
	_ = windows.TerminateJobObject(job, 1)
}
