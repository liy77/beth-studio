// Painel da direita de uma guia: a pasta é a do terminal em foco nessa
// guia, e o estado aberto/fechado não vaza para as outras guias.
// Funções puras, testadas em tests/worktree.test.ts.

import { resolveLinkPath, stripFileScheme, type PaneLinkCtx } from "./localFile.ts";

export interface WorktreeChange {
  path: string;
  /** novo | alterado | apagado | renomeado | adicionado | ignorado */
  status: string;
}

/**
 * Pasta local do terminal para o painel. No Windows vale o caminho que o
 * resolvedor já conhece (unidade, UNC do WSL). No Mac e no Linux um cwd
 * POSIX (`/Users/brian`) é a própria pasta e segue direto para a API.
 */
export function paneFolder(cwd: string, ctx: PaneLinkCtx, posixLocal: boolean): string {
  const resolved = resolveLinkPath(cwd, ctx);
  if (resolved) return resolved;
  if (!posixLocal || !cwd) return "";
  const path = stripFileScheme(cwd).replace(/[\\/]+$/, "");
  if (path.startsWith("/") && !path.startsWith("//")) return path;
  return "";
}

/** Separador do caminho da pasta (POSIX no Mac, "\" no Windows e no UNC). */
export function folderSep(folder: string): "\\" | "/" {
  return folder.startsWith("/") && !folder.startsWith("//") ? "/" : "\\";
}

/** Junta pasta + nome com o separador da pasta. No Mac é "/", no Windows "\". */
export function joinFolder(dir: string, name: string): string {
  if (!dir) return name;
  const sep = folderSep(dir);
  return /[\\/]$/.test(dir) ? dir + name : dir + sep + name;
}

/** Chave estável: a mesma pasta no Windows não muda por causa de maiúsculas. */
export function folderKey(path: string): string {
  const p = path.trim().replace(/[\\/]+$/, "");
  return /^(?:[A-Za-z]:|\\\\)/.test(p) ? p.toLowerCase() : p;
}

/**
 * A sidebar aberta fica gravada por guia. Trocar de guia esconde a da
 * anterior; voltar mostra de novo. Guia sem registro conta como fechada.
 */
export function tabSidebarOpen(openByTab: Record<string, boolean>, tabId: string): boolean {
  return openByTab[tabId] === true;
}

export function setTabSidebarOpen(openByTab: Record<string, boolean>, tabId: string, open: boolean): Record<string, boolean> {
  if (!tabId) return openByTab;
  if (openByTab[tabId] === open) return openByTab;
  return { ...openByTab, [tabId]: open };
}

/** Tira guias que já não existem, para o mapa não crescer para sempre. */
export function pruneTabSidebar(openByTab: Record<string, boolean>, tabIds: string[]): Record<string, boolean> {
  const keep = new Set(tabIds);
  let changed = false;
  const next: Record<string, boolean> = {};
  for (const [id, open] of Object.entries(openByTab)) {
    if (!keep.has(id)) {
      changed = true;
      continue;
    }
    next[id] = open;
  }
  return changed ? next : openByTab;
}

/**
 * Caminho relativo ao git vira caminho absoluto na pasta da guia.
 * Recusa ".." para o clique não sair da pasta pedida.
 */
export function changeAbsPath(folder: string, rel: string): string | null {
  const sep = folderSep(folder);
  const name = rel.trim().replace(/[\\/]/g, sep);
  if (!name || name.split(sep).some((p) => p === ".." || p === "")) return null;
  const base = folder.replace(/[\\/]+$/, "");
  return `${base}${sep}${name}`;
}

/** Nome do arquivo e a pasta relativa, para a lista de mudanças. */
export function splitRel(rel: string): { dir: string; name: string } {
  const p = rel.replace(/\\/g, "/");
  const i = p.lastIndexOf("/");
  if (i < 0) return { dir: "", name: p };
  return { dir: p.slice(0, i), name: p.slice(i + 1) };
}

/** Conta por status, na ordem em que a sidebar mostra. */
export function changeCounts(changes: WorktreeChange[]): { status: string; n: number }[] {
  const order = ["alterado", "novo", "adicionado", "apagado", "renomeado"];
  const n = new Map<string, number>();
  for (const c of changes) n.set(c.status, (n.get(c.status) ?? 0) + 1);
  return order.filter((s) => n.has(s)).map((status) => ({ status, n: n.get(status)! }));
}

/** Rótulo completo do status (tooltip / acessibilidade). */
export function statusLabel(status: string): string {
  switch (status) {
    case "alterado":
      return "Alterado";
    case "novo":
      return "Novo (não rastreado)";
    case "adicionado":
      return "Adicionado";
    case "apagado":
      return "Apagado";
    case "renomeado":
      return "Renomeado";
    case "ignorado":
      return "Ignorado";
    default:
      return status;
  }
}

/**
 * Marca curta do status (estilo VS Code): M / U / A / D / R.
 * A sidebar mostra só isto; o nome completo fica no title.
 */
export function statusMark(status: string): string {
  switch (status) {
    case "alterado":
      return "M";
    case "novo":
      return "U";
    case "adicionado":
      return "A";
    case "apagado":
      return "D";
    case "renomeado":
      return "R";
    default:
      return "?";
  }
}

export type DiffLineKind = "add" | "del" | "ctx" | "hunk" | "meta";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  /** Número no arquivo antigo (del/ctx). */
  oldNo?: number;
  /** Número no arquivo novo (add/ctx). */
  newNo?: number;
}

/** Quebra um patch unificado em linhas coloríveis, com números de linha. */
export function parseUnifiedDiff(patch: string): DiffLine[] {
  const out: DiffLine[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const raw of patch.replace(/\r\n/g, "\n").split("\n")) {
    if (raw === "" && out.length === 0) continue;
    if (
      raw.startsWith("diff --git") ||
      raw.startsWith("index ") ||
      raw.startsWith("similarity ") ||
      raw.startsWith("new file") ||
      raw.startsWith("deleted file") ||
      raw.startsWith("old mode") ||
      raw.startsWith("new mode")
    ) {
      // Cabeçalho git — não ocupa a grade (polui a leitura).
      continue;
    }
    if (raw.startsWith("--- ") || raw.startsWith("+++ ")) {
      continue;
    }
    if (raw.startsWith("@@")) {
      const m = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s*@@(.*)$/.exec(raw);
      if (m) {
        oldNo = Number(m[1]);
        newNo = Number(m[2]);
      }
      const rest = (m?.[3] || "").trim();
      out.push({ kind: "hunk", text: rest ? `@@ … ${rest}` : raw.replace(/\s+@@.*/, " @@") });
      continue;
    }
    if (raw.startsWith("+")) {
      out.push({ kind: "add", text: raw.slice(1), newNo });
      newNo++;
      continue;
    }
    if (raw.startsWith("-")) {
      out.push({ kind: "del", text: raw.slice(1), oldNo });
      oldNo++;
      continue;
    }
    if (raw.startsWith("\\")) {
      out.push({ kind: "meta", text: raw });
      continue;
    }
    if (raw.startsWith(" ") || raw === "") {
      out.push({ kind: "ctx", text: raw.startsWith(" ") ? raw.slice(1) : "", oldNo, newNo });
      oldNo++;
      newNo++;
      continue;
    }
    out.push({ kind: "ctx", text: raw, oldNo, newNo });
    oldNo++;
    newNo++;
  }
  return out;
}

export function diffStats(lines: DiffLine[]): { adds: number; dels: number } {
  let adds = 0;
  let dels = 0;
  for (const l of lines) {
    if (l.kind === "add") adds++;
    if (l.kind === "del") dels++;
  }
  return { adds, dels };
}
