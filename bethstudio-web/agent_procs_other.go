//go:build !windows

package main

import (
	"context"
	"errors"
	"net/http"
)

func (h *hub) runAgentProcs(ctx context.Context) { <-ctx.Done() }

func apKill(it AgentProc, _ []apNode) error { return errors.New("só no Windows") }

func serveWSLRunning(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"running": []string{}})
}
