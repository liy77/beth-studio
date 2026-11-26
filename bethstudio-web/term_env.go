package main

import "fmt"

// Variáveis de ambiente do processo --term (janela destacada). A URL/token
// nunca vão na linha de comando.
const (
	termEnvURL   = "BETHSTUDIO_TERM_URL"
	termEnvAPI   = "BETHSTUDIO_TERM_API"
	termEnvToken = "BETHSTUDIO_TERM_TOKEN"
)

func termTitle(pane int) string { return fmt.Sprintf("Terminal %d", pane) }
