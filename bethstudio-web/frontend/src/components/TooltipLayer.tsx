import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { TIP_DELAY_MS, parseTip, placeTip, type TipPlace, type TipText } from "@/lib/tooltip";
import { isMacTitlebar } from "@/lib/windowFrame";
import { GlassTip } from "@/components/GlassTip";

/**
 * Tooltip de todo o app: botoes com `title` (ou qualquer elemento com
 * `data-tip`). O `title` nativo e' guardado em `data-tip-title` na primeira
 * passada do mouse, para nao aparecer duas vezes. Aparece apos ~350 ms de
 * hover e na hora ao focar pelo teclado; some ao sair, clicar, rolar ou Esc.
 * So' ouve eventos (nao cobre nada): nao atrapalha arraste nem cliques.
 * No macOS o balão é o mesmo NSPopover do menu de contexto.
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<{ text: TipText; anchor: Element } | null>(null);
  const [place, setPlace] = useState<TipPlace | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const mac = isMacTitlebar();

  useEffect(() => {
    let timer: number | undefined;
    let current: Element | null = null;
    const textOf = (el: Element) => {
      const t = el.getAttribute("title");
      if (t) {
        el.setAttribute("data-tip-title", t);
        el.removeAttribute("title"); // sem o nativo junto
      }
      return el.getAttribute("data-tip") || el.getAttribute("data-tip-title") || "";
    };
    const target = (n: EventTarget | null) => {
      const el = (n as Element | null)?.closest?.("button[title],button[data-tip-title],[data-tip],[role=button][title],[role=button][data-tip-title],.bt-tab[title],.bt-tab[data-tip-title]");
      return el ?? null; // desabilitado tambem mostra (explica por que)
    };
    const hide = () => {
      window.clearTimeout(timer);
      current = null;
      setTip(null);
      setPlace(null);
    };
    const show = (el: Element) => {
      const raw = textOf(el);
      if (!raw || !el.isConnected) return;
      setPlace(null);
      setTip({ text: parseTip(raw), anchor: el });
    };
    const over = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const el = target(e.target);
      if (el === current) return;
      hide();
      if (!el) return;
      current = el;
      textOf(el);
      timer = window.setTimeout(() => current === el && show(el), TIP_DELAY_MS);
    };
    const out = (e: PointerEvent) => {
      if (!current) return;
      const to = e.relatedTarget as Node | null;
      if (to && current.contains(to)) return;
      hide();
    };
    const focus = (e: FocusEvent) => {
      const el = target(e.target);
      if (!el) return;
      let visible = false;
      try {
        visible = (e.target as Element).matches(":focus-visible");
      } catch {
        visible = false;
      }
      if (!visible) return;
      hide();
      current = el;
      show(el);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && hide();
    document.addEventListener("pointerover", over, true);
    document.addEventListener("pointerout", out, true);
    document.addEventListener("focusin", focus, true);
    document.addEventListener("focusout", hide, true);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("scroll", hide, true);
    document.addEventListener("wheel", hide, { capture: true, passive: true });
    document.addEventListener("keydown", key, true);
    window.addEventListener("blur", hide);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerover", over, true);
      document.removeEventListener("pointerout", out, true);
      document.removeEventListener("focusin", focus, true);
      document.removeEventListener("focusout", hide, true);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("scroll", hide, true);
      document.removeEventListener("wheel", hide, true);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", hide);
    };
  }, []);

  // Windows / fallback: mede o tooltip e posiciona na página.
  useLayoutEffect(() => {
    if (mac || !tip || !boxRef.current) return;
    const a = tip.anchor.getBoundingClientRect();
    const b = boxRef.current.getBoundingClientRect();
    setPlace(placeTip({ left: a.left, top: a.top, width: a.width, height: a.height }, b.width, b.height, window.innerWidth, window.innerHeight));
  }, [tip, mac]);

  if (!tip) return null;
  if (mac) {
    const a = tip.anchor.getBoundingClientRect();
    // Preferir abaixo do botão (como o menu); o AppKit vira se não couber.
    return <GlassTip title={tip.text.title} desc={tip.text.desc} ax={a.left} ay={a.top} aw={a.width} ah={a.height} above={false} />;
  }
  return (
    <div
      ref={boxRef}
      role="tooltip"
      className="pointer-events-none fixed z-[10000] max-w-[280px] rounded-lg px-3 py-2 text-[12px] leading-snug bt-menu text-text-1"
      data-tip-side={place?.side ?? "below"}
      data-tip-arrow={place?.arrowX ?? 0}
      style={{ left: place?.left ?? -9999, top: place?.top ?? -9999, visibility: place ? "visible" : "hidden" }}
    >
      <span
        className="absolute h-2 w-2 rotate-45 border border-border-strong bg-bg-card"
        style={
          place?.above
            ? { left: (place?.arrowX ?? 0) - 4, bottom: -4 }
            : { left: (place?.arrowX ?? 0) - 4, top: -4 }
        }
      />
      <div className="font-medium">{tip.text.title}</div>
      {tip.text.desc && <div className="mt-0.5 text-text-2">{tip.text.desc}</div>}
    </div>
  );
}
