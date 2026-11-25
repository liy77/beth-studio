package main

// worktree.go — POST /api/worktree: a pasta de uma guia e o git dela.
//
// O painel da direita pede {path}: a pasta do terminal em foco naquela
// guia (já resolvida pelo front para um caminho que o Go abre). A resposta
// diz se essa pasta está num repositório e quais arquivos estão diferentes
// do HEAD, sem sair da pasta pedida.
//
//	POST /api/worktree       {path}           -> {path, repo, root, branch, changes}
//	POST /api/worktree/diff  {path, folder?}  -> {path, root, status, binary, patch}

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const worktreeDiffMax = 800_000 // bytes de patch na resposta

type worktreeChange struct {
	Path   string `json:"path"`
	Status string `json:"status"`
}

// worktreeGit roda git. Os testes trocam.
var worktreeGit = func(ctx context.Context, dir string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	err := cmd.Run()
	return out.Bytes(), err
}

func serveWorktree(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "use POST", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		Path string `json:"path"`
	}
	if !sshDecodePOST(w, r, &body) {
		return
	}
	clean, err := localFSClean(body.Path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	st, err := os.Stat(clean)
	if err != nil || !st.IsDir() {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "pasta não encontrada"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	root, branch, changes, repo := worktreeStatus(ctx, clean)
	writeJSON(w, http.StatusOK, map[string]any{
		"path":    clean,
		"repo":    repo,
		"root":    root,
		"branch":  branch,
		"changes": changes,
	})
}

// worktreeStatus: root, branch e mudanças dentro de dir. repo=false quando
// a pasta não está num repositório (ou o git não respondeu).
func worktreeStatus(ctx context.Context, dir string) (root, branch string, changes []worktreeChange, repo bool) {
	changes = []worktreeChange{}
	out, err := worktreeGit(ctx, dir, "rev-parse", "--show-toplevel")
	if err != nil {
		return "", "", changes, false
	}
	root = strings.TrimSpace(string(out))
	if root == "" || !pathInside(root, dir) && !pathInside(dir, root) {
		return "", "", changes, false
	}
	repo = true
	if b, err := worktreeGit(ctx, dir, "rev-parse", "--abbrev-ref", "HEAD"); err == nil {
		branch = strings.TrimSpace(string(b))
	}
	porcelain, err := worktreeGit(ctx, dir, "status", "--porcelain", "-uall", "--", ".")
	if err != nil {
		return root, branch, changes, true
	}
	relDir, relErr := filepath.Rel(root, dir)
	prefix := ""
	if relErr == nil && relDir != "." {
		prefix = filepath.ToSlash(relDir) + "/"
	}
	for _, line := range strings.Split(string(porcelain), "\n") {
		line = strings.TrimRight(line, "\r")
		if len(line) < 4 {
			continue
		}
		st := strings.TrimSpace(line[:2])
		p := line[3:]
		if i := strings.Index(p, " -> "); i >= 0 {
			p = p[i+4:]
		}
		p = strings.Trim(p, `"`)
		if p == "" {
			continue
		}
		p = filepath.ToSlash(p)
		// status -- . já limita à pasta pedida; o prefixo só entra se o git
		// devolveu o caminho a partir da raiz.
		if prefix != "" && strings.HasPrefix(strings.ToLower(p), strings.ToLower(prefix)) {
			p = p[len(prefix):]
		}
		changes = append(changes, worktreeChange{Path: p, Status: worktreeStatusLabel(st)})
	}
	return root, branch, changes, true
}

func worktreeStatusLabel(xy string) string {
	switch {
	case strings.Contains(xy, "?"):
		return "novo"
	case strings.Contains(xy, "!"):
		return "ignorado"
	case strings.Contains(xy, "D"):
		return "apagado"
	case strings.Contains(xy, "R"):
		return "renomeado"
	case strings.Contains(xy, "A"):
		return "adicionado"
	default:
		return "alterado"
	}
}

// pathInside: child está em parent (ou é o próprio parent). Compara o
// caminho limpo; no Windows não diferencia maiúsculas.
func pathInside(parent, child string) bool {
	parent = filepath.Clean(parent)
	child = filepath.Clean(child)
	if strings.EqualFold(parent, child) {
		return true
	}
	rel, err := filepath.Rel(parent, child)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

// worktreeParsePorcelain existe para o teste enxergar a mesma regra sem
// chamar o git. Mantida como função nomeada para o teste não duplicar o
// corte da linha.
func worktreeParsePorcelain(porcelain string) []worktreeChange {
	var changes []worktreeChange
	for _, line := range strings.Split(porcelain, "\n") {
		line = strings.TrimRight(line, "\r")
		if len(line) < 4 {
			continue
		}
		p := line[3:]
		if i := strings.Index(p, " -> "); i >= 0 {
			p = p[i+4:]
		}
		p = strings.Trim(p, `"`)
		if p == "" {
			continue
		}
		changes = append(changes, worktreeChange{Path: filepath.ToSlash(p), Status: worktreeStatusLabel(strings.TrimSpace(line[:2]))})
	}
	if changes == nil {
		return []worktreeChange{}
	}
	return changes
}

// errWorktreeGit é o erro que o teste injeta quando o git "falha".
var errWorktreeGit = errors.New("git")

// serveWorktreeDiff: diff do arquivo vs HEAD (ou arquivo inteiro se for novo).
func serveWorktreeDiff(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "use POST", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		Path   string `json:"path"`
		Folder string `json:"folder"`
	}
	if !sshDecodePOST(w, r, &body) {
		return
	}
	clean, err := localFSClean(body.Path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	startDir := filepath.Dir(clean)
	if body.Folder != "" {
		if f, err := localFSClean(body.Folder); err == nil {
			startDir = f
		}
	}
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	rootOut, err := worktreeGit(ctx, startDir, "rev-parse", "--show-toplevel")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "esta pasta não está num repositório git"})
		return
	}
	root := strings.TrimSpace(string(rootOut))
	if root == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "repositório git não encontrado"})
		return
	}
	rel, err := filepath.Rel(root, clean)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "arquivo fora do repositório"})
		return
	}
	relSlash := filepath.ToSlash(rel)
	status := worktreeFileStatus(ctx, root, relSlash, clean)
	patch, binary, err := worktreeFileDiff(ctx, root, relSlash, clean, status)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	truncated := false
	if len(patch) > worktreeDiffMax {
		patch = patch[:worktreeDiffMax]
		truncated = true
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"path":      clean,
		"root":      root,
		"rel":       relSlash,
		"status":    status,
		"binary":    binary,
		"patch":     patch,
		"truncated": truncated,
	})
}

func worktreeFileStatus(ctx context.Context, root, rel, abs string) string {
	porcelain, err := worktreeGit(ctx, root, "status", "--porcelain", "-uall", "--", rel)
	if err == nil {
		for _, line := range strings.Split(string(porcelain), "\n") {
			line = strings.TrimRight(line, "\r")
			if len(line) < 4 {
				continue
			}
			return worktreeStatusLabel(strings.TrimSpace(line[:2]))
		}
	}
	if _, err := os.Stat(abs); err != nil {
		return "apagado"
	}
	return "alterado"
}

func worktreeFileDiff(ctx context.Context, root, rel, abs, status string) (patch string, binary bool, err error) {
	var out []byte
	switch status {
	case "novo":
		null := "/dev/null"
		if runtime.GOOS == "windows" {
			null = "NUL"
		}
		out, err = worktreeGitDiffOK(ctx, root, "diff", "--no-index", "--", null, rel)
		if err != nil {
			// --no-index às vezes quer caminho absoluto
			out, err = worktreeGitDiffOK(ctx, root, "diff", "--no-index", "--", null, abs)
		}
	default:
		out, err = worktreeGitDiffOK(ctx, root, "diff", "HEAD", "--", rel)
	}
	if err != nil {
		return "", false, err
	}
	patch = string(out)
	if strings.Contains(patch, "Binary files") || strings.Contains(patch, "GIT binary patch") {
		return patch, true, nil
	}
	// Sem saída e arquivo existe: pode ser só mode change; ou diff vazio.
	return patch, false, nil
}

// worktreeGitDiffOK: git diff devolve exit 1 quando há mudanças — isso é ok.
func worktreeGitDiffOK(ctx context.Context, dir string, args ...string) ([]byte, error) {
	out, err := worktreeGit(ctx, dir, args...)
	if err == nil {
		return out, nil
	}
	var ee *exec.ExitError
	if errors.As(err, &ee) && ee.ExitCode() == 1 {
		return out, nil
	}
	msg := strings.TrimSpace(string(out))
	if msg == "" {
		msg = err.Error()
	}
	return nil, errors.New(msg)
}
