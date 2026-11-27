import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, Folder, FolderGit2, GitBranch, GitCompareArrows, Loader2, PanelRightClose, RefreshCw, Search, X } from "lucide-react";
import { FileKindIcon } from "./FileKindIcon";
import type { Connection } from "@/lib/connection";
import {
  changeAbsPath,
  changeCounts,
  explorerStatusClass,
  indexGitTree,
  joinFolder,
  scmChanges,
  splitRel,
  statusLabel,
  statusMark,
  treeGitStatus,
  type WorktreeChange,
} from "@/lib/worktree";
import { cn } from "@/lib/utils";

// Sidebar da direita de UMA guia. A pasta é a do terminal em foco nessa
// guia; o componente é montado de novo quando a guia muda, então a árvore
// aberta de uma guia não aparece na outra.

type Entry = { name: string; is_dir: boolean };
type Listing = { path: string; parent: string; entries: Entry[] };
type GitInfo = { path: string; repo: boolean; root: string; branch: string; changes: WorktreeChange[] };

const STATUS_COLOR: Record<string, string> = {
  alterado: "text-status-warn",
  novo: "text-status-ok",
  adicionado: "text-status-ok",
  apagado: "text-status-err",
  renomeado: "text-accent-text",
  ignorado: "text-text-3 opacity-60",
};

function nameMatches(name: string, q: string) {
  return !q || name.toLowerCase().includes(q);
}

/** Ícone/letra do status git (M, U, A…); o title traz o nome em português. */
function StatusBadge({ status, className }: { status: string; className?: string }) {
  const label = statusLabel(status);
  return (
    <span
      className={cn(
        "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] font-semibold leading-none",
        STATUS_COLOR[status] ?? "text-text-3",
        className,
      )}
      title={label}
      aria-label={label}
    >
      {statusMark(status)}
    </span>
  );
}

export function WorktreePanel({
  conn,
  folder,
  folderLabel,
  onClose,
  onOpenFile,
  onOpenDiff,
}: {
  conn: Connection;
  /** pasta do terminal em foco, caminho que o Go abre; "" = a guia não tem pasta */
  folder: string;
  folderLabel: string;
  onClose: () => void;
  onOpenFile: (path: string) => void;
  /** clique em Mudanças: abre o diff vs HEAD */
  onOpenDiff?: (path: string, status: string) => void;
}) {
  const [list, setList] = useState<Listing | null>(null);
  const [open, setOpen] = useState<Record<string, Entry[] | "loading" | "err">>({});
  const [git, setGit] = useState<GitInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"arquivos" | "git">("arquivos");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    if (!folder) {
      setList(null);
      setGit(null);
      setError(null);
      return;
    }
    setError(null);
    try {
      const [files, changes] = await Promise.all([
        conn.api<Listing>("/api/local-fs/list", { path: folder }),
        conn.api<GitInfo>("/api/worktree", { path: folder }).catch((e: unknown) => {
          setError(e instanceof Error ? e.message : "não foi possível ler o git");
          return null;
        }),
      ]);
      setList(files);
      if (changes) setGit(changes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "não foi possível ler a pasta");
    }
  }, [conn, folder]);

  useEffect(() => {
    setOpen({});
    setList(null);
    setGit(null);
    setQuery("");
    void load();
  }, [load]);

  // A pasta muda enquanto o agente trabalha; relê sem mexer nas pastas abertas.
  useEffect(() => {
    if (!folder) return;
    const id = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(id);
  }, [folder, load]);

  const toggle = async (path: string) => {
    if (open[path] && open[path] !== "err") {
      setOpen((o) => {
        const next = { ...o };
        delete next[path];
        return next;
      });
      return;
    }
    setOpen((o) => ({ ...o, [path]: "loading" }));
    try {
      const r = await conn.api<Listing>("/api/local-fs/list", { path });
      setOpen((o) => ({ ...o, [path]: r.entries }));
    } catch {
      setOpen((o) => ({ ...o, [path]: "err" }));
    }
  };

  const q = query.trim().toLowerCase();
  const trackedChanges = useMemo(() => scmChanges(git?.changes ?? []), [git]);
  const counts = changeCounts(trackedChanges);
  const gitIndex = useMemo(() => (folder && git?.repo ? indexGitTree(git.changes, folder) : new Map<string, string>()), [folder, git]);
  const name = folderLabel || folder;
  const shortName = name.split(/[\\/]/).filter(Boolean).pop() || name;

  const fileEntries = useMemo(() => {
    if (!list) return [];
    if (!q) return list.entries;
    return list.entries.filter((e) => nameMatches(e.name, q));
  }, [list, q]);

  const gitChanges = useMemo(() => {
    if (!q) return trackedChanges;
    return trackedChanges.filter((c) => {
      const { name: base } = splitRel(c.path);
      return nameMatches(base, q) || nameMatches(c.path, q);
    });
  }, [trackedChanges, q]);

  return (
    <aside className="bt-worktree flex h-full w-full flex-col rounded-xl border border-border bg-bg-panel text-[12.5px] text-text-1">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-bg-hover text-text-2">
          <FolderGit2 size={14} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium leading-4 text-text-1" title={folder || "Esta guia não tem pasta"}>
            {shortName || "Sem pasta"}
          </span>
          {folder && name !== shortName && <span className="block truncate text-[10px] leading-3 text-text-3">{name}</span>}
        </span>
        <button
          type="button"
          className="bt-worktree-btn flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg text-text-2 hover:bg-bg-hover hover:text-text-1"
          title="Atualizar"
          onClick={() => void load()}
        >
          <RefreshCw size={13} />
        </button>
        <button
          type="button"
          className="bt-worktree-btn flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg text-text-2 hover:bg-bg-hover hover:text-text-1"
          title="Fechar a pasta desta guia"
          onClick={onClose}
        >
          <PanelRightClose size={14} />
        </button>
      </div>
      {/* Busca: mesmas proporções da esquerda, cores do tema (claro/escuro). */}
      {folder && (
        <div className="border-b border-border px-2 py-2">
          <div className="bt-search flex items-center gap-1.5 rounded-2xl border border-border bg-bg-hover px-3 focus-within:border-accent/50 focus-within:ring-1 focus-within:ring-accent/35">
            <Search size={14} className="shrink-0 text-text-2" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setQuery("")}
              placeholder={tab === "arquivos" ? "Buscar arquivo ou pasta" : "Buscar mudança"}
              className="h-8 min-w-0 flex-1 bg-transparent text-[13px] text-text-1 outline-none placeholder:text-text-3"
              aria-label={tab === "arquivos" ? "Buscar arquivo ou pasta" : "Buscar mudança"}
            />
            {query && (
              <button
                type="button"
                className="shrink-0 rounded-full p-0.5 text-text-3 hover:bg-bg-card hover:text-text-1"
                title="Limpar busca"
                onClick={() => setQuery("")}
              >
                <X size={13} />
              </button>
            )}
          </div>
        </div>
      )}
      <div className="mx-2 mt-2 mb-1 flex shrink-0 gap-0.5 rounded-lg bg-bg-hover p-0.5">
        {(["arquivos", "git"] as const).map((id) => (
          <button
            key={id}
            type="button"
            className={cn(
              "flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors",
              tab === id
                ? "bg-bg-card font-semibold text-text-1 shadow-sm ring-1 ring-border"
                : "text-text-2 hover:text-text-1",
            )}
            onClick={() => setTab(id)}
          >
            {id === "arquivos" ? <Folder size={12} className="shrink-0" aria-hidden /> : <GitCompareArrows size={12} className="shrink-0" aria-hidden />}
            {id === "arquivos" ? "Arquivos" : `Mudanças${trackedChanges.length ? ` · ${trackedChanges.length}` : ""}`}
          </button>
        ))}
      </div>
      {!folder ? (
        <p className="px-3 py-4 text-text-3">Esta guia não tem um terminal com pasta.</p>
      ) : error && !list ? (
        <p className="px-3 py-4 text-status-err">{error}</p>
      ) : tab === "arquivos" ? (
        <div className="min-h-0 flex-1 overflow-auto py-1">
          {!list ? (
            <Loader2 size={14} className="m-3 animate-spin text-text-3" />
          ) : fileEntries.length === 0 ? (
            <p className="px-3 py-4 text-text-3">{q ? "Nenhum arquivo com esse nome." : "Pasta vazia."}</p>
          ) : (
            fileEntries.map((e) => (
              <TreeRow
                key={e.name}
                entry={e}
                path={joinFolder(list.path, e.name)}
                rel={e.name}
                depth={0}
                open={open}
                query={q}
                folder={folder}
                gitIndex={gitIndex}
                onToggle={toggle}
                onOpenFile={onOpenFile}
              />
            ))
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto py-1">
          {!git ? (
            <Loader2 size={14} className="m-3 animate-spin text-text-3" />
          ) : !git.repo ? (
            <p className="px-3 py-4 text-text-3">Esta pasta não está num repositório git.</p>
          ) : (
            <>
              <div className="mx-2 mb-1 flex items-center gap-1.5 rounded-md bg-bg-card px-2 py-1.5 text-[11px] text-text-2">
                <GitBranch size={12} className="shrink-0" />
                <span className="min-w-0 truncate font-medium text-text-1" title={git.root}>{git.branch || "git"}</span>
                {counts.map((c) => (
                  <span
                    key={c.status}
                    className={cn("inline-flex shrink-0 items-center gap-0.5 tabular-nums", STATUS_COLOR[c.status] ?? "text-text-2")}
                    title={`${c.n} ${statusLabel(c.status).toLowerCase()}${c.n > 1 ? "s" : ""}`}
                  >
                    <StatusBadge status={c.status} className="h-4 w-4 text-[10px]" />
                    {c.n}
                  </span>
                ))}
              </div>
              {trackedChanges.length === 0 ? (
                <p className="px-3 py-2 text-text-3">Nenhuma mudança nesta pasta.</p>
              ) : gitChanges.length === 0 ? (
                <p className="px-3 py-2 text-text-3">Nenhuma mudança com esse nome.</p>
              ) : (
                gitChanges.map((c) => {
                  const { dir, name: base } = splitRel(c.path);
                  const abs = changeAbsPath(folder, c.path);
                  const label = statusLabel(c.status);
                  return (
                    <div
                      key={c.path}
                      className="mx-1.5 flex w-[calc(100%-12px)] items-center gap-0.5 rounded-md hover:bg-bg-hover"
                    >
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left disabled:opacity-50"
                        title={`${label}: ${c.path} — abrir ao lado`}
                        disabled={!abs}
                        onClick={() => abs && onOpenFile(abs)}
                      >
                        <StatusBadge status={c.status} />
                        <FileKindIcon name={base} size={18} />
                        <span className="min-w-0 flex-1 truncate text-text-1">
                          {base}
                          {dir && <span className="text-text-3"> {dir}</span>}
                        </span>
                      </button>
                      {onOpenDiff && abs && c.status !== "apagado" && (
                        <button
                          type="button"
                          className="bt-worktree-btn mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-3 hover:bg-bg-card hover:text-text-1"
                          title={`Diff vs HEAD: ${c.path}`}
                          onClick={() => onOpenDiff(abs, c.status)}
                        >
                          <GitCompareArrows size={13} />
                        </button>
                      )}
                    </div>
                  );
                })
              )}
              {error && <p className="px-3 py-2 text-status-err">{error}</p>}
            </>
          )}
        </div>
      )}
    </aside>
  );
}

function TreeRow({
  entry,
  path,
  rel,
  depth,
  open,
  query,
  folder,
  gitIndex,
  onToggle,
  onOpenFile,
}: {
  entry: Entry;
  path: string;
  /** Caminho relativo à pasta da guia (como no git status). */
  rel: string;
  depth: number;
  open: Record<string, Entry[] | "loading" | "err">;
  query: string;
  folder: string;
  gitIndex: Map<string, string>;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
}) {
  const state = open[path];
  const expanded = Array.isArray(state);
  const children = expanded
    ? query
      ? state.filter((e) => nameMatches(e.name, query))
      : state
    : [];
  const gitStatus = treeGitStatus(gitIndex, rel, folder);
  const nameClass = explorerStatusClass(gitStatus);
  const tip = gitStatus ? `${statusLabel(gitStatus)}: ${path}` : path;
  return (
    <>
      <button
        type="button"
        className="mx-1.5 flex w-[calc(100%-12px)] items-center gap-1 rounded-md py-1 pr-2 text-left hover:bg-bg-hover"
        style={{ paddingLeft: 8 + depth * 12 }}
        title={tip}
        onClick={() => (entry.is_dir ? onToggle(path) : onOpenFile(path))}
      >
        {entry.is_dir ? (
          <ChevronRight size={12} className={cn("shrink-0 text-text-3", expanded && "rotate-90")} />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <FileKindIcon name={entry.name} isDir={entry.is_dir} open={expanded} size={18} />
        <span className={cn("min-w-0 flex-1 truncate", nameClass)}>{entry.name}</span>
        {gitStatus && gitStatus !== "ignorado" && <StatusBadge status={gitStatus} className="h-4 w-4 text-[10px]" />}
        {state === "loading" && <Loader2 size={11} className="animate-spin text-text-3" />}
      </button>
      {expanded &&
        children.map((e) => (
          <TreeRow
            key={e.name}
            entry={e}
            path={joinFolder(path, e.name)}
            rel={`${rel.replace(/\\/g, "/")}/${e.name}`}
            depth={depth + 1}
            open={open}
            query={query}
            folder={folder}
            gitIndex={gitIndex}
            onToggle={onToggle}
            onOpenFile={onOpenFile}
          />
        ))}
      {state === "err" && (
        <p className="py-0.5 text-status-err" style={{ paddingLeft: 28 + depth * 12 }}>
          não foi possível ler
        </p>
      )}
    </>
  );
}
