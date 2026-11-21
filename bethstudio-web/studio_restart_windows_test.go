//go:build windows

package main

import (
	"strings"
	"testing"
)

func TestRelaunchArgs(t *testing.T) {
	got := strings.Join(relaunchArgs([]string{"--devtools", "--after-pid", "12", "--port=0", "--after-pid=7"}, 99), " ")
	if got != "--devtools --port=0 --after-pid 99" {
		t.Fatal(got)
	}
	if got := strings.Join(relaunchArgs(nil, 5), " "); got != "--after-pid 5" {
		t.Fatal(got)
	}
}
