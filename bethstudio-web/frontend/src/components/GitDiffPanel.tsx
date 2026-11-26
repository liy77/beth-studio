import { useEffect, useMemo, useState } from "react";
import { GitCompareArrows, Loader2, X } from "lucide-react";
import type { Connection } from "@/lib/connection";
import { diffStats, parseUnifiedDiff, statusLabel, statusMark, type DiffLine } from "@/lib/worktree";
import { fileBaseName } from "@/lib/filePreview";
import { cn } from "@/lib/utils";
import { IconButton } from "./IconButton";
import { FileKindIcon } from "./FileKindIcon";

type DiffDoc =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ok"; status: string; binary: boolean; patch: string; truncated: boolean; rel: string };

/**
 * Diff git no slot da pasta da guia (mesma altura do terminal): substitui a
 * sidebar da direita; ao fechar a pasta volta. Empurra o terminal.
 */
export function GitDiffPanel({
  conn,
  path,
  folder,
  onClose,
}: {
  conn: Connection;
  path: string;
  folder: string;
  onClose: () => void;
}) {
  const [doc, setDoc] = useState<DiffDoc>({ phase: "loading" });
  const name = fileBaseName(path);

  useEffect(() => {
    let live = true;
    setDoc({ phase: "loading" });
    conn
      .api<{ status: string; binary: boolean; patch: string; truncated?: boolean; rel?: string }>("/api/worktree/diff", {
        path,
        folder: folder || undefined,
      })
      .then((r) => {
        if (!live) return;
        setDoc({
          phase: "ok",
          status: r.status || "alterado",
          binary: !!r.binary,
          patch: r.patch || "",
          truncated: !!r.truncated,
          rel: r.rel || name,
        });
      })
      .catch((e: Error) => {
        if (!live) return;
        setDoc({ phase: "error", message: e.message || "não foi possível ler o diff" });
      });
    return () => {
      live = false;
    };
  }, [conn, path, folder, name]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const lines = useMemo(() => (doc.phase === "ok" && !doc.binary ? parseUnifiedDiff(doc.patch) : []), [doc]);
  const stats = useMemo(() => diffStats(lines), [lines]);

  return (
    <section
      className="bt-worktree bt-diff-panel bt-side-panel-slide flex h-full min-h-0 w-full flex-col overflow-hidden"
      role="dialog"
      aria-label={`Diff de ${name}`}
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <GitCompareArrows size={15} className="shrink-0 text-accent-text" aria-hidden />
        <FileKindIcon name={name} size={18} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-text-1" title={path}>
            {name}
          </div>
          {doc.phase === "ok" && (
            <div className="truncate text-[10px] text-text-3" title={doc.rel}>
              {statusLabel(doc.status)} · {statusMark(doc.status)}
              {doc.rel && doc.rel !== name && <span className="ml-1.5 opacity-80">{doc.rel}</span>}
              {stats.adds + stats.dels > 0 && (
                <span className="ml-1.5 tabular-nums">
                  <span className="text-status-ok">+{stats.adds}</span>
                  <span className="mx-0.5 text-text-3">/</span>
                  <span className="text-status-err">−{stats.dels}</span>
                </span>
              )}
            </div>
          )}
        </div>
        <IconButton label="Fechar (Esc)" onClick={onClose}>
          <X size={15} />
        </IconButton>
      </header>
      <div className="bt-diff min-h-0 flex-1 overflow-auto bg-bg-term">
        {doc.phase === "loading" && (
          <div className="flex items-center gap-2 p-4 font-sans text-[12px] text-text-2">
            <Loader2 size={14} className="animate-spin" /> Lendo o diff…
          </div>
        )}
        {doc.phase === "error" && <p className="p-4 font-sans text-[12px] text-status-err">{doc.message}</p>}
        {doc.phase === "ok" && doc.binary && (
          <p className="p-4 font-sans text-[12px] text-text-2">Arquivo binário (imagem ou similar) — sem diff de texto.</p>
        )}
        {doc.phase === "ok" && !doc.binary && lines.length === 0 && (
          <p className="p-4 font-sans text-[12px] text-text-2">Sem diferenças de texto vs HEAD.</p>
        )}
        {doc.phase === "ok" && !doc.binary && lines.length > 0 && (
          <div className="bt-diff__grid select-text" style={{ userSelect: "text" }}>
            {lines.map((l, i) => (
              <DiffRow key={i} line={l} />
            ))}
          </div>
        )}
        {doc.phase === "ok" && doc.truncated && (
          <p className="sticky bottom-0 border-t border-border bg-bg-card px-3 py-2 font-sans text-[11px] text-text-3">
            Diff grande — mostrando só o início.
          </p>
        )}
      </div>
    </section>
  );
}

function DiffRow({ line }: { line: DiffLine }) {
  if (line.kind === "hunk") {
    return (
      <div className="bt-diff__hunk">
        <span className="bt-diff__gutter" aria-hidden />
        <span className="bt-diff__code">{line.text}</span>
      </div>
    );
  }
  if (line.kind === "meta") {
    return (
      <div className="bt-diff__meta">
        <span className="bt-diff__gutter" aria-hidden />
        <span className="bt-diff__code">{line.text}</span>
      </div>
    );
  }
  const mark = line.kind === "add" ? "+" : line.kind === "del" ? "−" : " ";
  return (
    <div
      className={cn(
        "bt-diff__row",
        line.kind === "add" && "bt-diff__row--add",
        line.kind === "del" && "bt-diff__row--del",
        line.kind === "ctx" && "bt-diff__row--ctx",
      )}
    >
      <span className="bt-diff__gutter" aria-hidden>
        <span className="bt-diff__no">{line.oldNo ?? ""}</span>
        <span className="bt-diff__no">{line.newNo ?? ""}</span>
        <span className="bt-diff__mark">{mark}</span>
      </span>
      <span className="bt-diff__code">{line.text.length ? line.text : " "}</span>
    </div>
  );
}
