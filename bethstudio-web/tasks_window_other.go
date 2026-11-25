//go:build !windows && !darwin

package main

import "fmt"

func openTasksWindow() error {
	return fmt.Errorf("o gerenciador de tarefas em janela própria ainda não existe nesta plataforma")
}

func claimTasksWindow() bool { return true }

func releaseTasksClaim() {}
