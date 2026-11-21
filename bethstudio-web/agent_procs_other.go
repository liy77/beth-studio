//go:build !windows

package main

import (
	"context"
	"errors"
)

func (h *hub) runAgentProcs(ctx context.Context) { <-ctx.Done() }

func apKill(it AgentProc, _ []apNode) error { return errors.New("só no Windows") }
