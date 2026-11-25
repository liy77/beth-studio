import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Columns2, FolderOpen, LayoutGrid, Loader2, Search, X } from "lucide-react";
import type { Connection } from "@/lib/connection";
import type { PaneInfo } from "@/lib/types";
import type { Layout } from "@/lib/layout";
import { buildCards, facetKindChips, facetStateCounts, filterCards, previewLines, toggleChip, type GridCard, type GridFilter, type GridKind } from "@/lib/termGrid";
import { AgentBadge, KindIcon } from "./KindIcon";
import { cn } from "@/lib/utils";
import { SettingsBtn, SettingsSwitch } from "./settings/SettingsUI";

interface Props {
  conn: Connection;
  panes: PaneInfo[];
  layout: Layout;
  /** ordem dos grupos da barra lateral (Configurações). A grade não grava o filtro dela. */
  kindOrder?: string[] | null;
  onOpen: (c: GridCard) => void;
  onOpenBeside: (c: GridCard) => void;
  onClose: () => void;
}

const REFRESH_MS = 3000;

const FILTERS: { id: GridFilter; label: string; hint: string }[] = [
  { id: "all", label: "Todos", hint: "Todos os terminais" },
  { id: "tab", label: "Em abas", hint: "Terminais que estão numa aba aberta" },
  { id: "hidden", label: "Sem aba", hint: "Em abas fechadas ou fora de qualquer aba (continuam rodando)" },
  { id: "gone", label: "Encerrados", hint: "Terminais que terminaram e ainda aparecem numa aba" },
];

/** Popup com todos os terminais em grade: print da tela, nome, tipo, pasta e aba, com busca. */
const chipFocus = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export function TerminalGrid({ conn, panes, layout, kindOrder, onOpen, onOpenBeside, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<GridFilter>("all");
  const [kind, setKind] = useState<GridKind>("all");
  const [withScreen, setWithScreen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [shots, setShots] = useState<Map<number, string>>(new Map());
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  useEffect(() => {
    let stop = false;
    const load = () => {
      setLoading(true);
      conn
        .api<{ panes: Record<string, string> }>("/api/content", { pane_ids: [] })
        .then((r) => {
          if (stop) return;
          const m = new Map<number, string>();
          for (const [k, v] of Object.entries(r.panes)) m.set(Number(k), v);
          setShots(m);
        })
        .catch(() => undefined)
        .finally(() => !stop && setLoading(false));
    };
    load();
    const iv = window.setInterval(load, REFRESH_MS);
    return () => {
      stop = true;
      window.clearInterval(iv);
    };
  }, [conn]);

  const cards = useMemo(() => buildCards(panes, layout), [panes, layout]);
  const screens = useMemo(() => {
    const m = new Map(shots);
    for (const c of cards) {
      const live = conn.lastScreenText(c.pane);
      if (live) m.set(c.pane, live);
    }
    return m;
  }, [shots, cards, conn]);
  const counts = useMemo(() => facetStateCounts(cards, kind, query, screens, withScreen), [cards, kind, query, screens, withScreen]);
  const kindChips = useMemo(() => facetKindChips(cards, filter, query, screens, withScreen, kindOrder, kind), [cards, filter, query, screens, withScreen, kindOrder, kind]);
  const shown = useMemo(() => filterCards(cards, filter, query, screens, withScreen, kind), [cards, filter, query, screens, withScreen, kind]);
  const clearFilters = () => {
    setQuery("");
    setFilter("all");
    setKind("all");
  };

  return (
    <div className="bt-modal fixed inset-0 z-[80] flex items-start justify-center bg-black/50 pt-[4vh] backdrop-blur-xl" onMouseDown={onClose}>
      <div
        className="bt-sheet bt-dialog flex h-[min(88vh,920px)] w-[min(1100px,96vw)] flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Todos os terminais"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Enter" && shown[0] && (e.target as Element).tagName === "INPUT") onOpen(shown[0]);
        }}
      >
        <div className="bt-sheet__chrome">
          <LayoutGrid size={16} className="text-accent-text" />
          <div className="bt-sheet__title">Todos os terminais</div>
          <button type="button" className="bt-sheet__close" title="Fechar (Esc)" aria-label="Fechar" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="flex shrink-0 flex-col gap-3 border-b border-border/70 bg-bg-card px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex min-w-[220px] flex-1 items-center gap-1.5 bt-field bg-bg-term px-2.5 focus-within:border-accent">
              <Search size={14} className="shrink-0 text-text-3" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar por nome, pasta, tipo, aba ou #número…"
                className="h-9 min-w-0 flex-1 bg-transparent text-[13px] text-text-1 outline-none placeholder:text-text-3"
              />
              {loading && <Loader2 size={13} className="shrink-0 animate-spin text-text-3" />}
              {query && (
                <button type="button" className={cn("shrink-0 rounded p-0.5 text-text-3 hover:text-text-1", chipFocus)} title="Limpar busca" onClick={() => setQuery("")}>
                  <X size={14} />
                </button>
              )}
            </div>
            <label className="flex cursor-pointer select-none items-center gap-2 text-[12px] text-text-2" title="A busca também olha o texto que está na tela de cada terminal">
              <SettingsSwitch on={withScreen} onChange={setWithScreen} label="Buscar também na tela" />
              Buscar também na tela
            </label>
          </div>

          <div className="bt-term-grid-seg" role="group" aria-label="Estado do terminal">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                title={f.hint}
                aria-pressed={filter === f.id}
                onClick={() => setFilter(toggleChip(filter, f.id, "all"))}
                className={cn("bt-term-grid-seg__btn", chipFocus, filter === f.id && "bt-term-grid-seg__btn--on")}
              >
                {f.label}
                <span className="bt-term-grid-seg__n">{counts[f.id]}</span>
              </button>
            ))}
          </div>

          {cards.length > 0 && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tipo de terminal">
              {kindChips.map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  aria-pressed={kind === chip.id}
                  title={chip.id === "all" ? "Todos os tipos" : `Mostrar ${chip.label} (clique de novo para tirar)`}
                  onClick={() => setKind(toggleChip(kind, chip.id, "all"))}
                  className={cn(
                    "inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-[12px]",
                    chipFocus,
                    kind === chip.id ? "bg-accent-soft font-medium text-text-1 ring-1 ring-accent/40" : "text-text-2 hover:bg-bg-hover hover:text-text-1",
                  )}
                >
                  {chip.id === "agent" && <Bot size={12} aria-hidden="true" />}
                  {chip.label}
                  <span className={cn("tabular-nums text-[11px]", kind === chip.id ? "text-text-2" : "text-text-3")}>{chip.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="bt-sheet__body !pt-3">
          {shown.length === 0 ? (
            <div className="px-3 py-14 text-center text-[13px] text-text-2">
              {cards.length === 0 ? (
                "Nenhum terminal aberto."
              ) : (
                <>
                  <p>Nenhum terminal encontrado.</p>
                  <div className="mt-3 flex justify-center">
                    <SettingsBtn onClick={clearFilters}>Limpar filtros</SettingsBtn>
                  </div>
                </>
              )}
            </div>
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(248px,1fr))] gap-3">
              {shown.map((c, i) => (
                <Card key={`${c.state}-${c.pane}-${i}`} c={c} lines={previewLines(screens.get(c.pane))} first={!!query.trim() && i === 0} onOpen={onOpen} onBeside={onOpenBeside} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Card({ c, lines, first, onOpen, onBeside }: { c: GridCard; lines: string[]; first: boolean; onOpen: (c: GridCard) => void; onBeside: (c: GridCard) => void }) {
  const gone = c.state === "gone";
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen(c)}
        onKeyDown={(e) => e.key === "Enter" && onOpen(c)}
        title={
          gone
            ? "Terminal encerrado: leva até a aba dele"
            : c.state === "closed"
              ? "Reabre a aba fechada com este terminal"
              : c.state === "loose"
                ? "Abre numa aba nova"
                : "Vai até este terminal"
        }
        className={cn(
          "group flex cursor-pointer flex-col overflow-hidden bt-term-grid-card",
          first && "bt-term-grid-card--focus",
          gone && "opacity-60",
        )}
      >
        <div className="h-[104px] overflow-hidden bg-bg-term px-2.5 py-2 font-mono text-[10px] leading-[13px] text-text-2">
          {lines.length ? (
            lines.map((l, i) => (
              <div key={i} className="truncate whitespace-pre">
                {l}
              </div>
            ))
          ) : (
            <div className="flex h-full items-center justify-center font-sans text-[11px] text-text-3">{gone ? "encerrado" : "sem texto na tela"}</div>
          )}
        </div>
        <div className="flex items-start gap-2 border-t border-border/70 px-2.5 py-2">
          {c.info && <KindIcon pane={c.info} size={14} className="mt-0.5" />}
          <div className="min-w-0 flex-1">
            <div className={cn("flex items-center gap-1 text-[13px] text-text-1", gone && "line-through decoration-text-3")}>
              <span className="truncate font-medium">{c.title}</span>
              {(c.info?.agent_name || c.info?.agent) && <AgentBadge name={c.info?.agent_name} />}
              <span className="ml-auto shrink-0 text-[10px] tabular-nums text-text-3">#{c.pane}</span>
            </div>
            {c.path && (
              <div className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-text-2" title={c.path}>
                <FolderOpen size={11} className="shrink-0 text-text-3" />
                <span className="truncate">{c.path}</span>
              </div>
            )}
            <div className="mt-0.5 truncate text-[11px] text-text-3">
              {c.kindLabel && <>{c.kindLabel} · </>}
              {c.where}
            </div>
          </div>
          {!gone && (
            <button
              type="button"
              className="shrink-0 rounded-lg p-1.5 text-text-3 opacity-0 hover:bg-bg-hover hover:text-text-1 group-hover:opacity-100 group-focus-within:opacity-100"
              title="Abrir ao lado do terminal em foco"
              onClick={(e) => {
                e.stopPropagation();
                onBeside(c);
              }}
            >
              <Columns2 size={14} />
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
