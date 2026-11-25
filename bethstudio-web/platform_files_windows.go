//go:build windows

package main

import (
	"golang.org/x/sys/windows"
	"os"
	"os/exec"
	"path/filepath"
)

func platformDownloadsDir() (string, error) {
	return windows.KnownFolderPath(windows.FOLDERID_Downloads, 0)
}

func revealDownloaded(path string) *exec.Cmd {
	return exec.Command("explorer.exe", "/select,"+path)
}

func openWithSystem(path string) error {
	return windows.ShellExecute(0, nil, windows.StringToUTF16Ptr(path), nil, nil, windows.SW_SHOWNORMAL)
}

// ponteDataDir: como dataDir, mas sem depender do ambiente — chamado pelo
// WSL via interop, o processo não recebe APPDATA nem USERPROFILE.
func ponteDataDir() string {
	if os.Getenv("APPDATA") != "" || os.Getenv("BETHSTUDIO_DATA_DIR") != "" {
		return dataDir()
	}
	base, err := windows.KnownFolderPath(windows.FOLDERID_RoamingAppData, 0)
	if err != nil || base == "" {
		return dataDir()
	}
	d := filepath.Join(base, "bethstudio")
	if _, err := os.Stat(d); err != nil {
		legacy := filepath.Join(base, "wezterminator")
		if st, err := os.Stat(legacy); err == nil && st.IsDir() {
			return legacy
		}
	}
	return d
}
