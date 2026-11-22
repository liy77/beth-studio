package main

import (
	"fmt"
	"os"
	"path/filepath"
)

// hostLockedFiles: o que o host em execução mantém travado. Um instalador que
// encontra o host vivo grava cada um como <nome>.new; a próxima subida do host
// aplica (mesma lista de wtinator::host::HOST_LOCKED_FILES, patches 0128/0141).
var hostLockedFiles = []string{"bethstudio-host.exe", "OpenConsole.exe", "conpty.dll"}

// applyPendingHostFiles troca cada <nome>.new de dir pelo arquivo final, como
// wtinator::host::apply_pending_binary fazia quando a GUI subia o host. Só pode
// ser chamado com o host parado. Um .new mais velho que o instalado é sobra de
// uma instalação antiga e é descartado (patch 0144). Devolve uma linha por
// arquivo tratado, para o host-life.log.
func applyPendingHostFiles(dir string) []string {
	var out []string
	for _, name := range hostLockedFiles {
		target := filepath.Join(dir, name)
		pending := target + ".new"
		pi, err := os.Stat(pending)
		if err != nil || !pi.Mode().IsRegular() {
			continue
		}
		if ti, err := os.Stat(target); err == nil && !pi.ModTime().After(ti.ModTime()) {
			_ = os.Remove(pending)
			out = append(out, fmt.Sprintf("descartado %s.new (mais velho que o instalado)", name))
			continue
		}
		bak := target + ".bak"
		_ = os.Remove(bak)
		if _, err := os.Stat(target); err == nil {
			if err := os.Rename(target, bak); err != nil {
				out = append(out, fmt.Sprintf("não foi possível trocar %s: %v", name, err))
				continue
			}
		}
		if err := os.Rename(pending, target); err != nil {
			_ = os.Rename(bak, target) // volta o antigo: melhor que ficar sem host
			out = append(out, fmt.Sprintf("não foi possível aplicar %s.new: %v", name, err))
			continue
		}
		out = append(out, fmt.Sprintf("aplicado %s.new (o anterior ficou em %s.bak)", name, name))
	}
	return out
}
