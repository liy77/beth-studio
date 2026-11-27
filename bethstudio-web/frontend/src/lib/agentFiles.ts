// Último arquivo que o agente parece estar editando — para o painel lateral
// seguir em tempo real (estilo Cursor). Funções puras; testes em agentFiles.test.ts.

import { extractFileCandidates, parseOsc8Spans, stripEscapes } from "./termLinks.ts";
import { localFileKind, resolveLinkPath, type PaneLinkCtx } from "./localFile.ts";

/**
 * Só gravação/edição — NÃO Read/Grep/Open (senão abre types.ts do Grep
 * enquanto o agent editou termImageCache.ts).
 */
const EDIT_HINT =
  /\b(Wrote|Writing|Edited|Editing|Updated|Updating|Modified|Modifying|Created|Creating|Saved|Saving)\b|Wrote contents to|Wrote to|Successfully wrote|Updated file|Edited file|The file .+ (?:has been |was )?(?:updated|written|saved)|Applying patch|Apply(?:ing)?\s+patch|Patch applied|edit_file|search_replace|ApplyPatch|file_path["']?\s*[:=]|(?:^|[\s│┃▌•●])(?:Write|StrReplace|Update|Edit|Create)(?:\s|\(|$)/i;

/** Linha de ferramenta que NÃO é edição — não roubar o caminho dela. */
const NON_EDIT_TOOL =
  /^\s*(?:Grep(?:ped)?|Read(?:ing)?|Search(?:ed|ing)?|Found|Listed|Glob(?:bed)?|Looked|Scanned|Explored|Listed directory|Cashed|Thinking)\b/i;

/** Cursor: `Edited termImageCache.ts +204` ou `Edited `path` +12 -3`. */
const CURSOR_EDIT_FILE =
  /\b(?:Edited|Editing|Wrote|Writing|Updated|Updating|Created|Creating)\s+`?([^\s`]+?\.[A-Za-z0-9]{1,12})`?(?:\s+\+(\d+))?(?:\s+-(\d+))?/i;

/** Caminho em hunk unificado / diff --git. */
const DIFF_PATH =
  /(?:^|\n)(?:\+\+\+\s+[ab]\/|diff --git a\/\S+\s+b\/)([^\s\n]+)/;

/** Destaque verde: no máx. N linhas (arquivo novo de 200 linhas não pinta tudo). */
const REVEAL_COUNT_CAP = 48;

export type AgentEditTarget = {
  path: string;
  /** 1-based; do hunk @@ +N ou início do arquivo */
  line?: number;
  /** quantas linhas do hunk novo (destaque verde) */
  lineCount?: number;
};

/**
 * Caminho absoluto do arquivo de texto mais recentemente editado na tela
 * do agente, com linha sugerida quando der para ler no hunk/diff.
 */
export function latestAgentEdit(screen: string | undefined, ctx: PaneLinkCtx): AgentEditTarget | null {
  if (!screen) return null;
  const rawTail = screen.length > 12_000 ? screen.slice(-12_000) : screen;
  const rawLines = rawTail.split(/\r?\n/);
  const lines = rawLines.map((l) => stripEscapes(l));
  const oscByLine = rawLines.map((l) => parseOsc8Spans(l).map((s) => s.uri).filter(Boolean));

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || !EDIT_HINT.test(line)) continue;
    if (NON_EDIT_TOOL.test(line)) continue;

    // 1) Preferir o caminho NA PRÓPRIA linha do Edited/Write (basename ok).
    const onLine = pickPathOnEditLine(line, oscByLine[i] ?? [], ctx, lines);
    if (onLine) {
      const where = lineNearEdit(lines, i, onLine.path, onLine.addedHint);
      return { path: onLine.path, ...where };
    }

    // 2) Vizinhos: só se a linha do hint não trouxe arquivo; ignora Grep/Read.
    const near = pickTextPathNear(lines, oscByLine, i, ctx);
    if (!near) continue;
    const where = lineNearEdit(lines, i, near, undefined);
    return { path: near, ...where };
  }
  return null;
}

/** @deprecated use latestAgentEdit */
export function latestAgentEditPath(screen: string | undefined, ctx: PaneLinkCtx): string | null {
  return latestAgentEdit(screen, ctx)?.path ?? null;
}

type OnLineHit = { path: string; addedHint?: number };

/** Caminho na linha do Edited — inclui `termImageCache.ts` sem pasta. */
function pickPathOnEditLine(
  line: string,
  oscUris: string[],
  ctx: PaneLinkCtx,
  allLines: string[],
): OnLineHit | null {
  for (const uri of oscUris) {
    const hit = resolveTextPath(uri, ctx);
    if (hit) return { path: hit };
  }
  const cur = CURSOR_EDIT_FILE.exec(line);
  if (cur?.[1]) {
    const raw = cur[1];
    // Basename: NÃO juntar no cwd antes de procurar path com pasta na tela
    // (senão "Edited App.tsx" vira cwd/App.tsx e ignora +++ b/frontend/...).
    const hit = pathIsGrounded(raw)
      ? resolveTextPath(raw, ctx)
      : locateBareInScreen(allLines, leafName(raw), ctx) ?? resolveBareName(raw, ctx);
    if (hit) {
      const added = cur[2] ? Number(cur[2]) : undefined;
      return { path: hit, addedHint: added && added > 0 ? added : undefined };
    }
  }
  const found = extractFileCandidates(line);
  for (const f of found) {
    const hit = pathIsGrounded(f.uri)
      ? resolveTextPath(f.uri, ctx)
      : locateBareInScreen(allLines, leafName(f.uri), ctx) ?? resolveBareName(f.uri, ctx);
    if (hit) return { path: hit };
  }
  return null;
}

function leafName(path: string): string {
  return path.replace(/^.*[/\\]/, "").trim();
}

/**
 * Basename sozinho (Cursor: `Edited termImageCache.ts`) — procura na tela
 * um caminho com pasta que termine nesse nome (Write anterior, diff, etc.).
 */
export function locateBareInScreen(lines: string[], base: string, ctx: PaneLinkCtx): string | null {
  if (!base || base === "." || base === "..") return null;
  const want = base.toLowerCase();
  for (let i = lines.length - 1; i >= 0; i--) {
    const text = lines[i];
    if (!text) continue;
    // +++ b/path/file.ts
    const plus = /^\+\+\+\s+[ab]\/(\S+)/.exec(text.trim());
    if (plus && leafName(plus[1]).toLowerCase() === want) {
      const hit = resolveTextPath(plus[1], ctx);
      if (hit) return hit;
    }
    for (const f of extractFileCandidates(text)) {
      if (leafName(f.uri).toLowerCase() !== want) continue;
      // só paths com pasta (relativo ou absoluto) — não o próprio basename
      if (!/[/\\]/.test(f.uri)) continue;
      const hit = resolveTextPath(f.uri, ctx);
      if (hit) return hit;
    }
  }
  return null;
}

function pickTextPathNear(
  lines: string[],
  oscByLine: string[][],
  editIdx: number,
  ctx: PaneLinkCtx,
): string | null {
  // Só abaixo/perto — e nunca em linha de Grep/Read.
  const order = [1, 2, 3, 4, -1, -2];
  for (const d of order) {
    const j = editIdx + d;
    if (j < 0 || j >= lines.length) continue;
    if (NON_EDIT_TOOL.test(lines[j])) continue;
    for (const uri of oscByLine[j] ?? []) {
      const hit = resolveTextPath(uri, ctx);
      if (hit) return hit;
    }
    const plus = /^\+\+\+\s+[ab]\/(\S+)/.exec(lines[j].trim());
    if (plus) {
      const hit = resolveTextPath(plus[1], ctx);
      if (hit) return hit;
    }
    const hit = pickTextPathGrounded(lines[j], ctx);
    if (hit) return hit;
  }
  const window = lines.slice(editIdx, Math.min(lines.length, editIdx + 24)).join("\n");
  const dm = DIFF_PATH.exec(window);
  if (dm?.[1]) {
    const hit = resolveTextPath(dm[1], ctx);
    if (hit) return hit;
  }
  return null;
}

function pickTextPathGrounded(text: string, ctx: PaneLinkCtx): string | null {
  const found = extractFileCandidates(text);
  for (const f of found) {
    if (!pathIsGrounded(f.uri)) continue;
    const path = resolveTextPath(f.uri, ctx);
    if (path) return path;
  }
  return null;
}

function resolveTextPath(raw: string, ctx: PaneLinkCtx): string | null {
  const path = resolveLinkPath(raw, ctx);
  if (!path) return null;
  if (localFileKind(path) !== "text") return null;
  return path;
}

/** Basename `foo.ts` → cwd/foo.ts (só com cwd conhecido). */
function resolveBareName(name: string, ctx: PaneLinkCtx): string | null {
  const base = name.replace(/^.*[/\\]/, "").trim();
  if (!base || !/\.[A-Za-z0-9]{1,12}$/.test(base)) return null;
  if (/[/\\]/.test(name) && pathIsGrounded(name)) return resolveTextPath(name, ctx);
  return resolveTextPath(base, ctx);
}

/** Absoluto ou com pasta. */
export function pathIsGrounded(path: string): boolean {
  if (/^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\") || path.startsWith("/") || path.startsWith("~")) return true;
  if (/^file:/i.test(path)) return true;
  return /[/\\]/.test(path);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Linha do arquivo: hunk @@ +N, path:N, ou (Cursor) `+204` = arquivo novo /
 * bloco grande a partir da linha 1.
 */
export function lineNearEdit(
  lines: string[],
  editIdx: number,
  path: string,
  addedHint?: number,
): { line?: number; lineCount?: number } {
  const base = path.replace(/^.*[/\\]/, "");
  const slice = lines.slice(editIdx, Math.min(lines.length, editIdx + 48));
  const joined = slice.join("\n");
  const fileLine = new RegExp(`${escapeRe(base)}\\s*[:(\\[]\\s*(\\d{1,7})\\b`);
  const mFile = fileLine.exec(joined);
  if (mFile) return { line: Number(mFile[1]), lineCount: 1 };
  const hunk = /@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s+@@/.exec(joined);
  if (hunk) {
    const line = Number(hunk[1]);
    const lineCount = Math.min(REVEAL_COUNT_CAP, hunk[2] ? Math.max(1, Number(hunk[2])) : 1);
    return { line, lineCount };
  }
  // Conta linhas "+" do diff Cursor logo abaixo do Edited.
  const plusLines = countDiffPlusLines(slice);
  if (plusLines > 0) {
    return { line: 1, lineCount: Math.min(REVEAL_COUNT_CAP, plusLines) };
  }
  if (addedHint && addedHint > 0) {
    return { line: 1, lineCount: Math.min(REVEAL_COUNT_CAP, addedHint) };
  }
  return {};
}

/** Quantas linhas de adição (`+` no começo, não `+++`) no pedaço. */
export function countDiffPlusLines(lines: string[]): number {
  let n = 0;
  for (const l of lines) {
    if (/^\+\+\+/.test(l)) continue;
    if (/^\+/.test(l)) n += 1;
  }
  return n;
}
