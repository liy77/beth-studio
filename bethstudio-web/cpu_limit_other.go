//go:build !windows && !darwin

package main

import "context"

func (h *hub) runCPULimit(ctx context.Context) { <-ctx.Done() }
