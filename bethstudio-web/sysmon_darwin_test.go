//go:build darwin

package main

import "testing"

func TestDarwinProcName(t *testing.T) {
	cases := map[string]string{
		"/Applications/Beth Studio.app/Contents/MacOS/Beth Studio":          "Beth Studio",
		"/Applications/Beth Studio.app/Contents/MacOS/bethstudio-host":      "bethstudio-host",
		"/Applications/Beth Studio.app/Contents/MacOS/bethstudio cli bridge": "bethstudio",
		"/bin/zsh":     "zsh",
		"-/bin/zsh":    "zsh",
		"-zsh":         "zsh",
		"/usr/bin/node --title x": "node",
	}
	for in, want := range cases {
		if got := darwinProcName(in); got != want {
			t.Errorf("darwinProcName(%q)=%q want %q", in, got, want)
		}
	}
}

func TestDarwinPSLineBethStudio(t *testing.T) {
	ln := "54436     1       28:15  10:04.32  65568 /Applications/Beth Studio.app/Contents/MacOS/Beth Studio"
	m := darwinPSLine.FindStringSubmatch(ln)
	if m == nil {
		t.Fatal("no match")
	}
	if m[1] != "54436" || m[5] != "65568" {
		t.Fatalf("cols: %v", m)
	}
	if got := darwinProcName(m[6]); got != "Beth Studio" {
		t.Fatalf("name=%q", got)
	}
}

func TestBuildBethStudioDarwin(t *testing.T) {
	host := &procInfo{PID: 10, Name: "bethstudio-host", PrivateWS: 10 << 20, CPU: 1.5}
	studio := &procInfo{PID: 20, Name: "Beth Studio", PrivateWS: 20 << 20, CPU: 2}
	bridge := &procInfo{PID: 21, PPID: 20, Name: "bethstudio", PrivateWS: 5 << 20, CPU: 0.5}
	helper := &procInfo{PID: 22, PPID: 20, Name: "com.apple.WebKit", PrivateWS: 8 << 20, CPU: 0.2}
	all := []*procInfo{host, studio, bridge, helper}
	tree := buildTree(all)
	out := buildBethStudioDarwin(tree, all, host)
	if len(out) < 3 {
		t.Fatalf("got %d rows: %+v", len(out), out)
	}
	roles := map[string]bool{}
	for _, b := range out {
		roles[b.Role] = true
		if b.PrivateWS == 0 {
			t.Errorf("%s has zero RSS", b.Label)
		}
	}
	for _, want := range []string{"host", "studio", "bridge"} {
		if !roles[want] {
			t.Errorf("missing role %s", want)
		}
	}
}
