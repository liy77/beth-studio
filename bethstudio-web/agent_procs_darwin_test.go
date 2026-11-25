//go:build darwin

package main

import "testing"

func TestApParseDarwinTime(t *testing.T) {
	cases := []struct {
		in   string
		want int64
	}{
		{"0:05", 5},
		{"1:02", 62},
		{"0:49.11", 49},
		{"5:50:01", 5*3600 + 50*60 + 1},
		{"01-05:50:01", 86400 + 5*3600 + 50*60 + 1},
	}
	for _, c := range cases {
		got, err := apParseDarwinTime(c.in)
		if err != nil || got != c.want {
			t.Errorf("%q: %d %v, quero %d", c.in, got, err, c.want)
		}
	}
}

func TestApDarwinNodesFindsCursor(t *testing.T) {
	nodes, err := apDarwinNodes()
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, n := range nodes {
		if agentOfNode(n) == "cursor" && n.HasPane {
			found = true
			break
		}
	}
	if !found {
		// Sem cursor-agent vivo no Mac do teste: só confere que a leitura não quebra.
		t.Log("nenhum cursor-agent com WEZTERM_PANE neste momento")
	}
}
