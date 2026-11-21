package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const testSID = "0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0"

func TestAgentHookRecordsPaneSession(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("BETHSTUDIO_DATA_DIR", dir)
	t.Setenv("BETHSTUDIO_HOST_ID", "")
	if err := os.WriteFile(filepath.Join(dir, "host.pid"), []byte("4242"), 0o644); err != nil {
		t.Fatal(err)
	}
	host := hostIDIn(dir)
	if !strings.HasPrefix(host, "4242@") {
		t.Fatalf("host %q", host)
	}

	// fora de um terminal do Studio: nada
	t.Setenv("WEZTERM_PANE", "")
	agentHookMain(nil, strings.NewReader(`{"session_id":"`+testSID+`","hook_event_name":"SessionStart"}`))
	if files, _ := filepath.Glob(filepath.Join(dir, "agent-sessions", "*.json")); len(files) != 0 {
		t.Fatal("gravou sem WEZTERM_PANE")
	}

	t.Setenv("WEZTERM_PANE", "7")
	agentHookMain([]string{"--lado", "wsl"}, strings.NewReader(`{"session_id":"`+testSID+`","cwd":"/home/u/p","hook_event_name":"SessionStart"}`))
	agentRecCache.recs = nil
	recs := agentRecordsFor(filepath.Join(dir, "agent-sessions"), host)
	r := recs[0]
	if len(recs) != 1 || r.Pane != 7 || r.SessionID != testSID || r.Side != "wsl" || r.Cwd != "/home/u/p" || r.Ended != 0 {
		t.Fatalf("registro %+v", recs)
	}

	// id inválido não sobrescreve
	agentHookMain(nil, strings.NewReader(`{"session_id":"../../x","hook_event_name":"SessionStart"}`))
	// SessionEnd marca o fim da mesma sessão
	agentHookMain(nil, strings.NewReader(`{"session_id":"`+testSID+`","hook_event_name":"SessionEnd"}`))
	agentRecCache.recs = nil
	r = agentRecordsFor(filepath.Join(dir, "agent-sessions"), host)[0]
	if r.SessionID != testSID || r.Ended == 0 {
		t.Fatalf("depois do SessionEnd: %+v", r)
	}

	// sessão aberta antes do hook: o SessionEnd sozinho já anota (encerrada);
	// sem WEZTERM_PANE fica só a pasta
	t.Setenv("WEZTERM_PANE", "")
	other := "11111111-2222-3333-4444-555555555555"
	agentHookMain([]string{"--lado", "wsl"}, strings.NewReader(`{"session_id":"`+other+`","cwd":"/mnt/k/repo","hook_event_name":"SessionEnd"}`))
	agentRecCache.recs = nil
	var loose *agentRecord
	for _, x := range agentRecordsFor(filepath.Join(dir, "agent-sessions"), host) {
		if x.SessionID == other {
			x := x
			loose = &x
		}
	}
	if loose == nil || loose.Pane != -1 || loose.Ended == 0 || loose.Cwd != "/mnt/k/repo" {
		t.Fatalf("SessionEnd sem registro: %+v", loose)
	}

	// outro host não vale
	agentRecCache.recs = nil
	if len(agentRecordsFor(filepath.Join(dir, "agent-sessions"), "9999@1")) != 0 {
		t.Fatal("registro de outro host apareceu")
	}
}

func TestResumeOffersFromSpecs(t *testing.T) {
	specs := []paneSpec{{PaneID: 3, Title: "a", ShellID: "pwsh"}, {PaneID: 5, Title: "b", ShellID: "wsl.default"}, {PaneID: 9, ShellID: "cmd"}}
	specs = attachAgentSessions(specs, []agentRecord{
		{Agent: "claude", SessionID: testSID, Pane: 5},
		{Agent: "claude", SessionID: testSID, Pane: 9, Ended: 10},
	})
	if specs[0].Resume != nil || specs[1].Resume == nil || !specs[2].Resume.Ended {
		t.Fatalf("%+v", specs)
	}
	// a receita vai para o disco: o campo tem que sobreviver ao JSON
	b, _ := json.Marshal(specs[1])
	var back paneSpec
	if json.Unmarshal(b, &back) != nil || back.Resume == nil || back.Resume.SessionID != testSID {
		t.Fatalf("json: %s", b)
	}
	offers := resumeOffers(specs, map[int]int{3: 0, 5: 1}) // o 9 não voltou
	if len(offers) != 1 || offers[0].PaneID != 1 || offers[0].OldPane != 5 || offers[0].Title != "b" {
		t.Fatalf("ofertas %+v", offers)
	}
}

func TestResumeCommand(t *testing.T) {
	c, err := resumeCommandFor("", testSID)
	if err != nil || c != "claude --resume "+testSID {
		t.Fatal(c, err)
	}
	c, _ = resumeCommandFor("claude --dangerously-skip-permissions --resume {id}", testSID)
	if c != "claude --dangerously-skip-permissions --resume "+testSID {
		t.Fatal(c)
	}
	if _, err := resumeCommandFor("", "x; rm -rf /"); err == nil {
		t.Fatal("id inválido aceito")
	}
	for _, bad := range []string{"claude --resume", "a\nb {id}", strings.Repeat("x", 201) + "{id}"} {
		if validResumeCommand(bad) == nil {
			t.Fatalf("aceitou %q", bad)
		}
	}
	if validResumeCommand("") != nil || validResumeCommand("claude -r {id}") != nil {
		t.Fatal("recusou comando bom")
	}
	if (AgentResumeSettings{Mode: "x"}).normalized().Mode != "ask" {
		t.Fatal("modo padrão")
	}
}

func TestAgentHookEditKeepsOthers(t *testing.T) {
	raw := []byte(`{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"echo meu"}]},{"hooks":[{"type":"command","command":"\"C:/x/bethstudio-tool.exe\" ponte-hook","asyncRewake":true}]}]}}`)
	spec := claudeHookSpec{
		events: agentHookEvents,
		isOurs: agentHookIsOurs,
		entry: func() map[string]any {
			return map[string]any{"type": "command", "command": agentHookCommand(`C:\x\bethstudio-tool.exe`, false), "timeout": 10}
		},
	}
	out, on, err := claudeHookEdit(raw, "add", spec)
	if err != nil || !on {
		t.Fatal(err)
	}
	s := string(out)
	for _, want := range []string{"echo meu", "ponte-hook", `C:/x/bethstudio-tool.exe\" agent-hook`, "SessionEnd"} {
		if !strings.Contains(s, want) {
			t.Fatalf("falta %q em %s", want, s)
		}
	}
	if _, on, _ := claudeHookEdit(out, "check", spec); !on {
		t.Fatal("check depois do add")
	}
	// o hook da ponte não é confundido com o nosso
	if _, on, _ := claudeHookEdit(raw, "check", spec); on {
		t.Fatal("ponte-hook contou como agent-hook")
	}
	out2, _, _ := claudeHookEdit(out, "remove", spec)
	if strings.Contains(string(out2), "agent-hook") || !strings.Contains(string(out2), "ponte-hook") || !strings.Contains(string(out2), "echo meu") {
		t.Fatalf("remove: %s", out2)
	}
	if got := agentHookCommand(`C:\Users\Public\BethStudio\bethstudio-tool.exe`, true); got != `'/mnt/c/Users/Public/BethStudio/bethstudio-tool.exe' agent-hook --lado wsl` {
		t.Fatal(got)
	}
}

func TestAttachByFolder(t *testing.T) {
	specs := []paneSpec{
		{PaneID: 1, Kind: "wsl", Cwd: "/mnt/k/a"},
		{PaneID: 2, Kind: "wsl", Cwd: "/mnt/k/b"},
		{PaneID: 3, Kind: "wsl", Cwd: "/mnt/k/b"},
		{PaneID: 4, Kind: "pwsh", Cwd: `C:\Repo\X`},
		{PaneID: 5, Kind: "wsl", Cwd: "/mnt/k/c"},
	}
	a1 := "aaaaaaaa-0000-0000-0000-000000000001"
	a2 := "aaaaaaaa-0000-0000-0000-000000000002"
	specs = attachAgentSessions(specs, []agentRecord{
		{Agent: "claude", SessionID: a1, Pane: -1, Side: "wsl", Cwd: "/mnt/k/a/", At: 1},
		{Agent: "claude", SessionID: a2, Pane: -1, Side: "wsl", Cwd: "/mnt/k/a", At: 5}, // mais recente na mesma pasta
		{Agent: "claude", SessionID: testSID, Pane: -1, Side: "wsl", Cwd: "/mnt/k/b"},       // dois terminais: ninguém
		{Agent: "claude", SessionID: testSID, Pane: -1, Side: "windows", Cwd: `c:/repo/x/`},
		{Agent: "claude", SessionID: testSID, Pane: -1, Side: "windows", Cwd: "/mnt/k/c"}, // lado errado
	})
	if specs[0].Resume == nil || specs[0].Resume.SessionID != a2 {
		t.Fatalf("pasta a: %+v", specs[0].Resume)
	}
	if specs[1].Resume != nil || specs[2].Resume != nil {
		t.Fatal("pasta com dois terminais recebeu sessão")
	}
	if specs[3].Resume == nil {
		t.Fatal("Windows pela pasta")
	}
	if specs[4].Resume != nil {
		t.Fatal("registro do Windows casou com terminal WSL")
	}
}
