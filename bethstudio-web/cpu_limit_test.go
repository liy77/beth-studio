package main

import (
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCPULimitPlanLifecycle(t *testing.T) {
	file := filepath.Join(t.TempDir(), "cpu.json")
	l := newCPULimiter(file, 24)
	now := time.Unix(1_000_000, 0)
	if p := l.plan(now); !p.idle() {
		t.Fatalf("sem limite devia ficar parado: %+v", p)
	}
	if err := l.set(70, 60, true, now); err != nil {
		t.Fatal(err)
	}
	if p := l.plan(now.Add(time.Minute)); p.Win != 70 || p.WSL != 17 || p.Expired || !p.ResetAff {
		t.Fatalf("plano com limite: %+v", p)
	}
	if p := l.plan(now.Add(2 * time.Minute)); !p.idle() && p.ResetAff {
		t.Fatalf("afinidade só na primeira passada: %+v", p)
	}
	// Studio reiniciado: o limite continua
	l2 := newCPULimiter(file, 24)
	if v := l2.view(); v.Percent != 70 || v.WSLCores != 17 || !v.WSL {
		t.Fatalf("não persistiu: %+v", v)
	}
	// prazo vence (mesmo com o Studio fechado na hora): devolve tudo e avisa
	p := l2.plan(now.Add(61 * time.Minute))
	if p.Win != 0 || p.WSL != 0 || !p.Expired {
		t.Fatalf("vencido: %+v", p)
	}
	// a devolução falhou: tenta de novo, sem avisar outra vez
	l2.done(p, 0, 0, "WSL Debian: não respondeu")
	if p = l2.plan(now.Add(62 * time.Minute)); p.Win != 0 || p.WSL != 0 || p.Expired {
		t.Fatalf("nova tentativa: %+v", p)
	}
	l2.done(p, 0, 0, "")
	if p = l2.plan(now.Add(63 * time.Minute)); !p.idle() {
		t.Fatalf("devolvido, devia parar: %+v", p)
	}
	if v := l2.view(); v.LastPercent != 70 || v.LastMinutes != 60 {
		t.Fatalf("último uso perdido: %+v", v)
	}
}

func TestCPULimitWSLRemovedAndOff(t *testing.T) {
	l := newCPULimiter("", 24)
	now := time.Now()
	_ = l.set(50, 0, true, now)
	_ = l.set(50, 0, false, now) // tira o WSL do limite: devolve lá
	if p := l.plan(now); p.Win != 50 || p.WSL != 0 {
		t.Fatalf("%+v", p)
	}
	l.done(cpuPlan{Win: 50, WSL: 0}, 5, 0, "")
	if p := l.plan(now); p.Win != 50 || p.WSL != -1 {
		t.Fatalf("depois de devolver o WSL: %+v", p)
	}
	l.off()
	if p := l.plan(now); p.Win != 0 || p.WSL != 0 || p.Expired {
		t.Fatalf("voltar ao normal: %+v", p)
	}
	if err := l.set(100, 0, true, now); err == nil {
		t.Fatal("100% não é limite")
	}
}

func TestCPULimitHelpers(t *testing.T) {
	if wslCores(70, 24) != 17 || wslCores(5, 4) != 1 || wslCores(95, 2) != 2 {
		t.Fatal("wslCores")
	}
	if cpuMask(24) != 0xFFFFFF || cpuMask(64) != ^uint64(0) {
		t.Fatal("cpuMask")
	}
	if durText(90) != "1 h 30 min" || durText(0) != "até remover" || durText(30) != "30 min" {
		t.Fatal("durText")
	}
	if !strings.Contains(cpuLimitText(CPULimitState{Percent: 70}), "até você remover") {
		t.Fatal("texto")
	}
	if k, err := parseCPULinux("x\nOK 3 40 24\n"); err != nil || k != 40 {
		t.Fatal(k, err)
	}
	if _, err := parseCPULinux("NOTASKSET"); err == nil {
		t.Fatal("sem taskset devia dar erro")
	}
	if !strings.Contains(cpuLinuxScript(17), "N=17\n") {
		t.Fatal("script")
	}
}

func TestTrayCPUSub(t *testing.T) {
	label, sub := trayCPUSub(CPULimitState{})
	if label != "Limitar CPU dos terminais" || sub[0].ID != trayCPUBase || !strings.Contains(sub[2].Label, "70% da CPU por 1 h") {
		t.Fatalf("%s %+v", label, sub)
	}
	label, sub = trayCPUSub(CPULimitState{Percent: 50, LastPercent: 50, LastMinutes: 0})
	if !strings.HasPrefix(label, "CPU dos terminais: 50%") || sub[0].ID != trayCPUOff || !strings.Contains(sub[2].Label, "até eu remover") {
		t.Fatalf("%s %+v", label, sub)
	}
}
