import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { highlightCode, type CodeTok } from "@/lib/codeHighlight";
import { cn } from "@/lib/utils";

// Editor do painel de arquivo: o texto digitado fica num textarea
// transparente, e o realce fica num <pre> atrás, na mesma fonte e rolagem.

// Cores do Dark+ do VS Code, as que a extensão do Copper aplica aos escopos
// de copper.tmLanguage.json. keyword.control e constant.language são roxos;
// keyword.declaration e storage.modifier são azuis; tipo primitivo é verde-água.
const COLOR: Record<CodeTok, string> = {
  kw: "text-[#C586C0]",
  decl: "text-[#569CD6]",
  mod: "text-[#569CD6]",
  str: "text-[#CE9178]",
  com: "text-[#6A9955]",
  doc: "text-[#6A9955]",
  num: "text-[#B5CEA8]",
  fn: "text-[#DCDCAA]",
  macro: "text-[#DCDCAA]",
  type: "text-[#4EC9B0]",
  prim: "text-[#4EC9B0]",
  plain: "text-[#D4D4D4]",
};

/** Verde das linhas que o agent acabou de editar (linha inteira). */
const REVEAL_BG = "rgba(34, 197, 94, 0.32)";
const REVEAL_GUTTER = "bg-[#22c55e]/35 text-[#86efac]";

function lineHighlighted(ln: number, revealLine?: number, revealCount?: number): boolean {
  if (revealLine == null || revealLine < 1) return false;
  const n = Math.max(1, revealCount ?? 1);
  return ln >= revealLine && ln < revealLine + n;
}

/**
 * Faixa verde por linha, mesma geometria do gutter — cobre a largura toda do código.
 * Fica atrás do <pre>/textarea; a rolagem sincroniza como o gutter.
 */
function RevealLines({
  lines,
  revealLine,
  revealCount,
  fontPx,
  padY,
  scrollTop,
}: {
  lines: number;
  revealLine?: number;
  revealCount?: number;
  fontPx: number;
  padY: number;
  scrollTop: number;
}) {
  if (revealLine == null || revealLine < 1) return null;
  const text = { fontSize: fontPx, lineHeight: "1.55" } as const;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
      style={{ paddingTop: padY, paddingBottom: padY }}
    >
      <div style={{ transform: `translateY(${-scrollTop}px)`, ...text }}>
        {Array.from({ length: lines }, (_, n) => {
          const ln = n + 1;
          const hi = lineHighlighted(ln, revealLine, revealCount);
          return (
            <div
              key={n}
              className="w-full"
              style={hi ? { background: REVEAL_BG } : undefined}
            >
              &nbsp;
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CodeEditor({
  value,
  onChange,
  lang,
  wrap,
  fontPx,
  label,
  textareaRef,
  revealLine,
  revealCount,
  revealKey,
}: {
  value: string;
  onChange: (v: string) => void;
  lang: string;
  wrap: boolean;
  fontPx: number;
  label: string;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  /** 1-based: pula e destaca a linha editada pelo agent */
  revealLine?: number;
  revealCount?: number;
  /** muda para re-saltar mesmo no mesmo arquivo/linha */
  revealKey?: number | string;
}) {
  const preRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const segs = useMemo(() => highlightCode(value, lang), [value, lang]);
  const lines = Math.max(1, value.split("\n").length);
  const sync = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    setScrollTop(ta.scrollTop);
    if (preRef.current) {
      preRef.current.scrollTop = ta.scrollTop;
      preRef.current.scrollLeft = ta.scrollLeft;
    }
    if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop;
  }, [textareaRef]);
  const text = { fontSize: fontPx, lineHeight: "1.55", tabSize: 2 } as const;
  const padY = 12; // p-3

  useEffect(() => {
    if (revealLine == null || revealLine < 1) return;
    const ta = textareaRef.current;
    if (!ta) return;
    const lineH = fontPx * 1.55;
    const target = Math.max(0, (revealLine - 1) * lineH - ta.clientHeight / 3);
    const go = () => {
      ta.scrollTop = target;
      sync();
    };
    go();
    const id = window.requestAnimationFrame(go);
    return () => window.cancelAnimationFrame(id);
  }, [revealLine, revealCount, revealKey, value, fontPx, textareaRef, sync]);

  return (
    <div className="absolute inset-0 flex bt-preview-code bg-[#1e1e1e]">
      <div ref={gutterRef} className="w-fit shrink-0 overflow-hidden border-r border-white/10 py-3 pl-2 pr-2 text-right font-mono text-[#858585] select-none" style={text}>
        {Array.from({ length: lines }, (_, n) => {
          const ln = n + 1;
          const hi = lineHighlighted(ln, revealLine, revealCount);
          return (
            <div key={n} className={cn("relative pl-1.5", hi && REVEAL_GUTTER)} style={hi ? { background: REVEAL_BG } : undefined}>
              {hi && <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#22c55e]" aria-hidden />}
              {hi ? <span className="mr-0.5 text-[#22c55e]">+</span> : null}
              {ln}
            </div>
          );
        })}
      </div>
      <div className="relative min-w-0 flex-1">
        <RevealLines lines={lines} revealLine={revealLine} revealCount={revealCount} fontPx={fontPx} padY={padY} scrollTop={scrollTop} />
        <pre
          ref={preRef}
          aria-hidden
          className={`pointer-events-none absolute inset-0 z-[1] overflow-auto bg-transparent p-3 font-mono ${wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"}`}
          style={text}
        >
          {segs.map((s, i) => (
            <span key={i} className={COLOR[s.tok]}>
              {s.text}
            </span>
          ))}
          {value.endsWith("\n") || value === "" ? " " : ""}
        </pre>
        <textarea
          ref={textareaRef as React.RefObject<HTMLTextAreaElement>}
          value={value}
          spellCheck={false}
          wrap={wrap ? "soft" : "off"}
          aria-label={label}
          onChange={(e) => onChange(e.target.value)}
          onScroll={sync}
          onKeyDown={(e) => {
            if (e.key !== "Tab") return;
            e.preventDefault();
            const ta = e.currentTarget;
            const a = ta.selectionStart;
            const b = ta.selectionEnd;
            const next = value.slice(0, a) + "  " + value.slice(b);
            onChange(next);
            requestAnimationFrame(() => {
              ta.selectionStart = ta.selectionEnd = a + 2;
            });
          }}
          className={`absolute inset-0 z-[2] h-full w-full resize-none bg-transparent p-3 font-mono text-transparent caret-white outline-none ${wrap ? "" : "whitespace-pre"}`}
          style={text}
        />
      </div>
    </div>
  );
}

export function CodeView({
  value,
  lang,
  wrap,
  fontPx,
  revealLine,
  revealCount,
  revealKey,
}: {
  value: string;
  lang: string;
  wrap: boolean;
  fontPx: number;
  revealLine?: number;
  revealCount?: number;
  revealKey?: number | string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const segs = useMemo(() => highlightCode(value, lang), [value, lang]);
  const lines = Math.max(1, value.split("\n").length);
  const text = { fontSize: fontPx, lineHeight: "1.55", tabSize: 2 } as const;

  useEffect(() => {
    if (revealLine == null || revealLine < 1) return;
    const el = scrollRef.current;
    if (!el) return;
    const lineH = fontPx * 1.55;
    const target = Math.max(0, (revealLine - 1) * lineH - el.clientHeight / 3);
    el.scrollTop = target;
  }, [revealLine, revealCount, revealKey, value, fontPx]);

  return (
    <div ref={scrollRef} className="absolute inset-0 overflow-auto flex min-h-full bt-preview-code bg-[#1e1e1e]">
      <div className="relative w-fit shrink-0 border-r border-white/10 py-0 pr-2 pl-2 text-right font-mono text-[#858585] select-none" style={text}>
        {Array.from({ length: lines }, (_, n) => {
          const ln = n + 1;
          const hi = lineHighlighted(ln, revealLine, revealCount);
          return (
            <div key={n} className={cn("relative pl-1.5", hi && REVEAL_GUTTER)} style={hi ? { background: REVEAL_BG } : undefined}>
              {hi && <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#22c55e]" aria-hidden />}
              {hi ? <span className="mr-0.5 text-[#22c55e]">+</span> : null}
              {ln}
            </div>
          );
        })}
      </div>
      {/*
        No CodeView o scroll é do container pai: as faixas verdes vão no fluxo
        (não absolute com -scrollTop), uma por linha, largura total.
      */}
      <div className="relative min-w-0 flex-1">
        <div className="pointer-events-none absolute inset-0 z-0" aria-hidden style={text}>
          {Array.from({ length: lines }, (_, n) => {
            const ln = n + 1;
            const hi = lineHighlighted(ln, revealLine, revealCount);
            return (
              <div key={n} className="w-full" style={hi ? { background: REVEAL_BG } : undefined}>
                &nbsp;
              </div>
            );
          })}
        </div>
        <pre className={`relative z-[1] min-w-0 flex-1 bg-transparent p-0 pl-3 font-mono ${wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"}`} style={text}>
          {segs.map((s, i) => (
            <span key={i} className={COLOR[s.tok]}>
              {s.text}
            </span>
          ))}
        </pre>
      </div>
    </div>
  );
}
