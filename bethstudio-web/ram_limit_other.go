//go:build !windows && !darwin

package main

import "context"

func systemRAMTotal() uint64 { return 8 << 30 }

func (h *hub) runRAMLimit(ctx context.Context) { <-ctx.Done() }
