//go:build darwin

package main

import (
	"context"
	"strings"
	"time"

	"golang.org/x/sys/unix"
)

func systemRAMTotal() uint64 {
	n, err := unix.SysctlUint64("hw.memsize")
	if err != nil || n == 0 {
		return 8 << 30
	}
	return n
}

func applyDarwinRAMLimit(bytes uint64) (applied int, used uint64, frozen bool, err error) {
	tree, err := hostTreeDarwin()
	if err != nil {
		if bytes == 0 {
			darLimits.setRAM(nil, 0)
			return 0, 0, false, nil
		}
		return 0, 0, false, err
	}
	used = darwinTreeRSS(tree)
	frozen = bytes > 0 && used > bytes
	darLimits.setRAM(tree, bytes)
	return len(tree), used, frozen, nil
}

func (h *hub) runRAMLimit(ctx context.Context) {
	t := time.NewTimer(5 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			darLimits.setRAM(nil, 0)
			return
		case <-t.C:
		case <-ramLimit.wake:
		}
		p := ramLimit.plan(time.Now())
		if !p.idle() {
			var n int
			var used uint64
			var frozen bool
			var msgs []string
			bytes := uint64(0)
			if p.Bytes > 0 {
				bytes = uint64(p.Bytes)
			}
			k, u, fr, err := applyDarwinRAMLimit(bytes)
			n, used, frozen = k, u, fr
			if err != nil {
				msgs = append(msgs, err.Error())
			}
			ramLimit.done(p, n, used, frozen, strings.Join(msgs, " · "))
			h.publishRAMLimit()
			if p.Expired {
				lifeLog("limite de RAM dos terminais venceu; tudo volta ao normal")
				trayBalloon("RAM dos terminais de volta ao normal", "O prazo do limite acabou. Os terminais voltaram a usar a RAM sem teto.")
			}
		}
		t.Reset(cpuLimitEvery)
	}
}
