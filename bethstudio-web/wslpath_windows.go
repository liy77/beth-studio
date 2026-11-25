//go:build windows

package main

import (
	"golang.org/x/sys/windows/registry"
	"strings"
)

// listWSLDistros: nomes das distros instaladas (registro, sem rodar wsl.exe),
// a padrão primeiro.
func listWSLDistros() []string {
	k, err := registry.OpenKey(registry.CURRENT_USER, lxssKey, registry.ENUMERATE_SUB_KEYS)
	if err != nil {
		return nil
	}
	guids, _ := k.ReadSubKeyNames(-1)
	k.Close()
	def := readDefaultWSLDistro()
	var out []string
	for _, g := range guids {
		d, err := registry.OpenKey(registry.CURRENT_USER, lxssKey+`\`+g, registry.QUERY_VALUE)
		if err != nil {
			continue
		}
		name, _, err := d.GetStringValue("DistributionName")
		d.Close()
		if err != nil || name == "" || strings.HasPrefix(strings.ToLower(name), "docker-desktop") {
			continue
		}
		if name == def {
			out = append([]string{name}, out...)
		} else {
			out = append(out, name)
		}
	}
	return out
}

// readDefaultWSLDistro: nome da distro padrao, "" se nao houver WSL.
func readDefaultWSLDistro() string {
	k, err := registry.OpenKey(registry.CURRENT_USER, lxssKey, registry.QUERY_VALUE)
	if err != nil {
		return ""
	}
	guid, _, err := k.GetStringValue("DefaultDistribution")
	k.Close()
	if err != nil || guid == "" {
		return ""
	}
	d, err := registry.OpenKey(registry.CURRENT_USER, lxssKey+`\`+guid, registry.QUERY_VALUE)
	if err != nil {
		return ""
	}
	defer d.Close()
	name, _, err := d.GetStringValue("DistributionName")
	if err != nil {
		return ""
	}
	return name
}
