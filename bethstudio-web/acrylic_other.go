//go:build !windows

package main

// Acrylic é só Windows (DWM). No macOS o material da barra é Vibrancy.

func rememberHostBackground(r, g, b uint8) {}
func setHostAcrylic(on bool)                {}
func acrylicCommand(msg string) bool         { return false }
