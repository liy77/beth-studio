package main

// localfile.go — GET /api/local-file: le' um arquivo local (texto ou
// imagem) para o painel flutuante de preview, quando o usuario clica num
// caminho detectado na saida de um terminal. So' abre DENTRO do app (nunca
// no editor padrao do Windows) — ver frontend/src/lib/localFile.ts para a
// deteccao/resolucao do caminho.
//
// Validacao (nenhuma delas depende do cliente dizer a verdade):
//   - imagem por extensão; binário conhecido (exe/zip/…) recusado; o resto
//     abre como texto (sniff de byte NUL);
//   - caminho tem que ser absoluto (unidade do Windows "C:\..." ou UNC
//     "\\servidor\compartilhamento\..." — inclui "\\wsl$\<distro>\...");
//   - sem esquema (nunca "file://", "http://" etc. — isso e' link externo,
//     weblinks.go trata);
//   - ".." no meio é resolvido (filepath.Clean); o resultado tem que
//     continuar absoluto — caminhos relativos tipo "../x" são recusados;
//   - limite de tamanho por categoria (texto: mostra so' o inicio acima
//     disso; imagem: recusa).
//
// Erros de leitura (arquivo sumiu, sem permissao) viram uma mensagem
// amigavel na resposta, nunca um pane em branco ou o processo travando.

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// textFileExt: mime preferido (não é lista de permissão — o preview abre
// qualquer não-binário). Chaves em minúsculas, com ponto ou nome inteiro.
var textFileExt = map[string]string{
	".md":       "text/markdown; charset=utf-8",
	".markdown": "text/markdown; charset=utf-8",
	".txt":      "text/plain; charset=utf-8",
	".log":      "text/plain; charset=utf-8",
	".crs": "text/plain; charset=utf-8", ".mika": "text/plain; charset=utf-8", ".mui": "text/plain; charset=utf-8",
	".rs": "text/plain; charset=utf-8", ".go": "text/plain; charset=utf-8",
	".py": "text/plain; charset=utf-8", ".js": "text/plain; charset=utf-8",
	".jsx": "text/plain; charset=utf-8", ".ts": "text/plain; charset=utf-8",
	".tsx": "text/plain; charset=utf-8", ".mjs": "text/plain; charset=utf-8",
	".cjs": "text/plain; charset=utf-8", ".c": "text/plain; charset=utf-8",
	".h": "text/plain; charset=utf-8", ".cpp": "text/plain; charset=utf-8",
	".cc": "text/plain; charset=utf-8", ".hpp": "text/plain; charset=utf-8",
	".hh": "text/plain; charset=utf-8", ".java": "text/plain; charset=utf-8",
	".kt": "text/plain; charset=utf-8", ".kts": "text/plain; charset=utf-8",
	".cs": "text/plain; charset=utf-8", ".swift": "text/plain; charset=utf-8",
	".rb": "text/plain; charset=utf-8", ".php": "text/plain; charset=utf-8",
	".lua": "text/plain; charset=utf-8", ".zig": "text/plain; charset=utf-8",
	".hs": "text/plain; charset=utf-8", ".ex": "text/plain; charset=utf-8",
	".exs": "text/plain; charset=utf-8", ".scala": "text/plain; charset=utf-8",
	".pl": "text/plain; charset=utf-8", ".pm": "text/plain; charset=utf-8",
	".r": "text/plain; charset=utf-8", ".dart": "text/plain; charset=utf-8",
	".vue": "text/plain; charset=utf-8", ".svelte": "text/plain; charset=utf-8",
	".sh": "text/plain; charset=utf-8", ".bash": "text/plain; charset=utf-8",
	".zsh": "text/plain; charset=utf-8", ".ps1": "text/plain; charset=utf-8",
	".command": "text/plain; charset=utf-8", ".fish": "text/plain; charset=utf-8",
	".bat": "text/plain; charset=utf-8", ".cmd": "text/plain; charset=utf-8",
	".json": "text/plain; charset=utf-8", ".jsonl": "text/plain; charset=utf-8",
	".yaml": "text/plain; charset=utf-8", ".yml": "text/plain; charset=utf-8",
	".toml": "text/plain; charset=utf-8", ".xml": "text/plain; charset=utf-8",
	".html": "text/plain; charset=utf-8", ".htm": "text/plain; charset=utf-8",
	".css": "text/plain; charset=utf-8", ".scss": "text/plain; charset=utf-8",
	".sql": "text/plain; charset=utf-8", ".ini": "text/plain; charset=utf-8",
	".cfg": "text/plain; charset=utf-8", ".conf": "text/plain; charset=utf-8",
	".env": "text/plain; charset=utf-8", ".csv": "text/plain; charset=utf-8",
	".mod": "text/plain; charset=utf-8", ".sum": "text/plain; charset=utf-8",
	".lock": "text/plain; charset=utf-8", ".gitignore": "text/plain; charset=utf-8",
	"app.bundle": "application/json; charset=utf-8",
	"dockerfile": "text/plain; charset=utf-8",
	"makefile":   "text/plain; charset=utf-8",
}

var imageFileExt = map[string]string{
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".gif":  "image/gif",
	".webp": "image/webp",
	".bmp":  "image/bmp",
	".svg":  "image/svg+xml",
}

// binaryFileExt: só estes (e sniff de NUL) são recusados no preview.
var binaryFileExt = map[string]bool{
	".exe": true, ".dll": true, ".so": true, ".dylib": true, ".o": true, ".a": true, ".lib": true,
	".wasm": true, ".bin": true, ".dat": true,
	".zip": true, ".7z": true, ".rar": true, ".gz": true, ".bz2": true, ".xz": true,
	".tar": true, ".tgz": true, ".dmg": true, ".pkg": true, ".iso": true, ".img": true, ".apk": true,
	".pdf": true, ".doc": true, ".docx": true, ".xls": true, ".xlsx": true, ".ppt": true, ".pptx": true,
	".woff": true, ".woff2": true, ".ttf": true, ".otf": true, ".eot": true,
	".mp3": true, ".mp4": true, ".wav": true, ".flac": true, ".ogg": true,
	".avi": true, ".mov": true, ".mkv": true, ".webm": true,
	".ico": true, ".icns": true, ".psd": true, ".ai": true, ".sketch": true,
	".db": true, ".sqlite": true, ".sqlite3": true, ".class": true, ".jar": true,
	".pyc": true, ".pyo": true, ".node": true, ".pak": true,
}

const (
	localTextPreviewMax = 2 << 20  // 2 MiB mostrados inteiros; acima disso, so' o inicio
	localImageMax       = 25 << 20 // 25 MiB
)

// expandHomePath troca "~" e "~/..." pela pasta do usuário.
func expandHomePath(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw != "~" && !strings.HasPrefix(raw, "~/") && !strings.HasPrefix(raw, `~\`) {
		return raw
	}
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return raw
	}
	rest := strings.TrimPrefix(raw, "~")
	rest = strings.TrimPrefix(rest, "/")
	rest = strings.TrimPrefix(rest, `\`)
	if rest == "" {
		return home
	}
	return filepath.Join(home, rest)
}

// hasDotDotSegment: algum segmento do caminho é ".." (não basta Contains —
// nomes tipo "file..bak" são válidos).
func hasDotDotSegment(p string) bool {
	for _, seg := range strings.FieldsFunc(p, func(r rune) bool { return r == '/' || r == '\\' }) {
		if seg == ".." {
			return true
		}
	}
	return false
}

// validateLocalPath: caminho absoluto (unidade do Windows ou UNC/\\wsl$\...),
// sem esquema. ".." no meio é resolvido; só recusa se, depois do Clean, ainda
// sobrar ".." (caminho relativo escapando) ou o resultado não for absoluto.
// "~" é a pasta do usuário.
func validateLocalPath(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", errors.New("caminho vazio")
	}
	if strings.Contains(raw, "://") {
		return "", errors.New("esquema não é permitido aqui (é um link, não um arquivo local)")
	}
	raw = expandHomePath(raw)
	clean := filepath.Clean(raw)
	if hasDotDotSegment(clean) {
		return "", errors.New("caminho relativo não é permitido")
	}
	isUNC := strings.HasPrefix(clean, `\\`)
	if !isUNC && !filepath.IsAbs(clean) {
		return "", errors.New("caminho relativo não é permitido")
	}
	return clean, nil
}

// localFileCategory: "text" | "image" | "" (binário conhecido).
// Qualquer extensão desconhecida (ex. .command) vira texto; o serveLocalFile
// ainda rejeita conteúdo com byte NUL.
func localFileCategory(path string) (mime, category string) {
	ext := strings.ToLower(filepath.Ext(path))
	base := strings.ToLower(filepath.Base(path))
	if m, ok := imageFileExt[ext]; ok {
		return m, "image"
	}
	if binaryFileExt[ext] || binaryFileExt[base] {
		return "", ""
	}
	if m, ok := textFileExt[base]; ok {
		return m, "text"
	}
	if m, ok := textFileExt[ext]; ok {
		return m, "text"
	}
	return "text/plain; charset=utf-8", "text"
}

// openLocalFile: os.Open, com a alternativa do WSL — "\\wsl.localhost\X\..."
// (Windows 11 / WSL novo) e "\\wsl$\X\..." (nome antigo) apontam para o
// mesmo lugar; se um nao existir nesta maquina, tenta o outro.
func openLocalFile(path string) (*os.File, error) {
	f, err := os.Open(path)
	if err == nil {
		return f, nil
	}
	if alt := wslUNCAlternative(path); alt != "" {
		if f2, err2 := os.Open(alt); err2 == nil {
			return f2, nil
		}
	}
	return nil, err
}

func wslUNCAlternative(path string) string {
	low := strings.ToLower(path)
	switch {
	case strings.HasPrefix(low, `\\wsl.localhost\`):
		return `\\wsl$\` + path[len(`\\wsl.localhost\`):]
	case strings.HasPrefix(low, `\\wsl$\`):
		return `\\wsl.localhost\` + path[len(`\\wsl$\`):]
	}
	return ""
}

// friendlyFileError:mensagem amigavel para os erros mais comuns de os.Open/Stat.
func friendlyFileError(err error) string {
	switch {
	case os.IsNotExist(err):
		return "o arquivo não existe (ou já foi movido/apagado)"
	case os.IsPermission(err):
		return "sem permissão para ler este arquivo"
	default:
		return "não foi possível abrir o arquivo"
	}
}

// mimeAttachment: Content-Disposition com o nome em UTF-8 (RFC 6266).
func mimeAttachment(name string) string {
	ascii := strings.Map(func(r rune) rune {
		if r < 0x20 || r > 0x7e || r == '"' || r == '\\' {
			return '_'
		}
		return r
	}, name)
	return mime.FormatMediaType("attachment", map[string]string{"filename": ascii}) + "; filename*=UTF-8''" + url.PathEscape(name)
}

func serveLocalFile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "método não permitido", http.StatusMethodNotAllowed)
		return
	}
	path, err := validateLocalPath(r.URL.Query().Get("path"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	mime, category := localFileCategory(path)
	if category == "" {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "arquivo binário — não dá para abrir no preview"})
		return
	}
	f, err := openLocalFile(path)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": friendlyFileError(err)})
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": friendlyFileError(err)})
		return
	}
	if st.IsDir() {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "é uma pasta, não um arquivo"})
		return
	}
	if category == "text" {
		if err := assertNotBinary(f); err != nil {
			writeJSON(w, http.StatusUnsupportedMediaType, map[string]string{"error": err.Error()})
			return
		}
		if _, err := f.Seek(0, io.SeekStart); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "não foi possível ler o arquivo"})
			return
		}
	}
	// download=1: o arquivo inteiro como anexo (Studio remoto: "Salvar uma
	// cópia" vira download no navegador). Mesma validação de caminho e tipo.
	if r.URL.Query().Get("download") == "1" {
		h := w.Header()
		h.Set("Content-Type", mime)
		h.Set("Cache-Control", "no-store")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Content-Disposition", mimeAttachment(filepath.Base(path)))
		h.Set("Content-Length", strconv.FormatInt(st.Size(), 10))
		_, _ = io.Copy(w, f)
		return
	}
	max := int64(localTextPreviewMax)
	if category == "image" {
		max = localImageMax
		if st.Size() > max {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "imagem grande demais para o preview (mais de 25 MB)"})
			return
		}
		// ._foto.png = AppleDouble (metadados do Mac), não a imagem.
		if strings.HasPrefix(filepath.Base(path), "._") {
			writeJSON(w, http.StatusUnsupportedMediaType, map[string]string{
				"error": "isto é um arquivo de metadados do Mac (._…), não a imagem. Abra o arquivo sem o prefixo ._",
			})
			return
		}
		if err := assertImageMagic(f, mime); err != nil {
			writeJSON(w, http.StatusUnsupportedMediaType, map[string]string{"error": err.Error()})
			return
		}
		if _, err := f.Seek(0, io.SeekStart); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "não foi possível ler a imagem"})
			return
		}
	}
	h := w.Header()
	h.Set("Content-Type", mime)
	h.Set("Cache-Control", "no-store")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("X-File-Size", strconv.FormatInt(st.Size(), 10))
	h.Set("X-File-Mtime", fileMtime(st)) // o editor do painel devolve no salvar (conflito)
	if category == "text" && st.Size() > max {
		h.Set("X-Truncated", "1")
		_, _ = io.CopyN(w, f, max)
		return
	}
	_, _ = io.Copy(w, f)
}

// assertNotBinary: NUL nos primeiros bytes = binário (mesmo com extensão de texto).
func assertNotBinary(r io.Reader) error {
	buf := make([]byte, 8192)
	n, _ := io.ReadFull(r, buf)
	if n > 0 && bytes.IndexByte(buf[:n], 0) >= 0 {
		return errors.New("arquivo binário — não dá para abrir no preview")
	}
	return nil
}

// assertImageMagic: confere os primeiros bytes — extensão .png com lixo
// (AppleDouble, texto) não passa pelo <img>.
func assertImageMagic(r io.Reader, mimeType string) error {
	buf := make([]byte, 16)
	n, _ := io.ReadFull(r, buf)
	if n < 3 {
		return errors.New("arquivo vazio ou não é uma imagem válida")
	}
	head := buf[:n]
	ok := false
	switch {
	case strings.Contains(mimeType, "png"):
		ok = n >= 8 && string(head[:8]) == "\x89PNG\r\n\x1a\n"
	case strings.Contains(mimeType, "jpeg"):
		ok = n >= 3 && head[0] == 0xff && head[1] == 0xd8 && head[2] == 0xff
	case strings.Contains(mimeType, "gif"):
		ok = n >= 6 && (string(head[:6]) == "GIF87a" || string(head[:6]) == "GIF89a")
	case strings.Contains(mimeType, "webp"):
		ok = n >= 12 && string(head[:4]) == "RIFF" && string(head[8:12]) == "WEBP"
	case strings.Contains(mimeType, "bmp"):
		ok = n >= 2 && head[0] == 'B' && head[1] == 'M'
	case strings.Contains(mimeType, "svg"):
		s := strings.ToLower(string(head))
		ok = strings.Contains(s, "<svg") || strings.Contains(s, "<?xml")
	default:
		ok = true
	}
	if !ok {
		return errors.New("o conteúdo não é uma imagem válida (extensão enganosa?)")
	}
	return nil
}

// Extensões que o Windows executa (ou pode executar) ao "abrir". Um clique
// na saída do terminal nunca dispara isso: esses arquivos só aparecem na pasta.
var dangerousFileExt = map[string]struct{}{
	".exe": {}, ".bat": {}, ".cmd": {}, ".com": {}, ".scr": {}, ".pif": {},
	".msi": {}, ".msp": {}, ".msix": {}, ".appx": {}, ".appinstaller": {},
	".ps1": {}, ".psm1": {}, ".psd1": {}, ".psc1": {},
	".vbs": {}, ".vbe": {}, ".js": {}, ".jse": {}, ".wsf": {}, ".wsh": {}, ".ws": {}, ".wsc": {},
	".hta": {}, ".cpl": {}, ".msc": {}, ".lnk": {}, ".scf": {}, ".inf": {}, ".reg": {},
	".url": {}, ".website": {}, ".gadget": {}, ".appref-ms": {},
	".dll": {}, ".sys": {}, ".jar": {},
}

func isDangerousFileExt(path string) bool {
	_, ok := dangerousFileExt[strings.ToLower(filepath.Ext(path))]
	return ok
}

var errNotAFile = errors.New("é uma pasta, não um arquivo")

// openRegularFile abre um arquivo que existe e não é pasta. O caminho já
// passou por validateLocalPath. Devolve o nome que abriu de fato
// (\\wsl.localhost ou \\wsl$).
func openRegularFile(path string) (string, error) {
	if strings.HasPrefix(path, `\\.\`) {
		return "", errors.New("caminho de dispositivo não é permitido")
	}
	f, err := openLocalFile(path)
	if err != nil {
		return "", err
	}
	st, err := f.Stat()
	name := f.Name()
	f.Close()
	if err != nil {
		return "", err
	}
	if st.IsDir() {
		return "", errNotAFile
	}
	return name, nil
}

func writeLocalFileOpError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, errNotAFile):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
	case os.IsNotExist(err):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": friendlyFileError(err)})
	case os.IsPermission(err):
		writeJSON(w, http.StatusForbidden, map[string]string{"error": friendlyFileError(err)})
	default:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
}

// serveOpenLocalFileDefault: POST /api/local-file/open-default — abre o
// arquivo no programa padrão do Windows. Vale para qualquer arquivo que
// exista (o preview continua só com texto e imagem). Programa e script
// (.exe, .bat, .ps1, .lnk e similares) não são executados.
// serveLocalFileStat: mtime/size baratos para o painel acompanhar o agent
// sem baixar o arquivo inteiro a cada poll (Win + Mac).
func serveLocalFileStat(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost || !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		http.Error(w, "use POST application/json", http.StatusBadRequest)
		return
	}
	var req struct {
		Path string `json:"path"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&req) != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "JSON inválido"})
		return
	}
	path, err := validateLocalPath(req.Path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if _, category := localFileCategory(path); category == "" {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "tipo de arquivo não suportado no preview"})
		return
	}
	st, err := os.Stat(path)
	if err != nil {
		if alt := wslUNCAlternative(path); alt != "" {
			st, err = os.Stat(alt)
			if err == nil {
				path = alt
			}
		}
	}
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": friendlyFileError(err)})
		return
	}
	if st.IsDir() {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "é uma pasta, não um arquivo"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"path":  path,
		"mtime": fileMtime(st),
		"size":  st.Size(),
	})
}

func serveOpenLocalFileDefault(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost || !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		http.Error(w, "use POST application/json", http.StatusBadRequest)
		return
	}
	var req struct {
		Path string `json:"path"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&req) != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "JSON inválido"})
		return
	}
	path, err := validateLocalPath(req.Path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if isDangerousFileExt(path) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "este arquivo não é aberto por clique (pode ser um programa)"})
		return
	}
	path, err = openRegularFile(path)
	if err != nil {
		writeLocalFileOpError(w, err)
		return
	}
	if err := launchLocalFileDefault(path); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "não foi possível abrir o programa padrão"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"path": path})
}

// launchLocalFileDefault abre com a associação do sistema. No Windows é
// ShellExecute (localfile_windows.go); nos outros, `open` / `xdg-open`.
var launchLocalFileDefault = openWithSystem
