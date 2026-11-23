import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { isMacTitlebar } from "@/lib/windowFrame";
import { cn } from "@/lib/utils";

/** Menu flutuante do Studio. No macOS a placa é o liquid glass nativo e o
 *  texto fica na página, por cima. Clique fora e Esc fecham. O clique que
 *  abriu o menu não conta: senão o menu nasce e morre no mesmo gesto. */
export function GlassMenu({
  x,
  y,
  onClose,
  children,
  className,
  width,
}: {
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [hover, setHover] = useState(-1);
  const mac = isMacTitlebar();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8));
    const top = Math.max(8, Math.min(y, window.innerHeight - r.height - 8));
    setBox((cur) => {
      if (cur && cur.x === left && cur.y === top && cur.w === Math.round(r.width) && cur.h === Math.round(r.height)) return cur;
      return { x: left, y: top, w: Math.round(r.width), h: Math.round(r.height) };
    });
  });

  useEffect(() => {
    closeOtherMenus();
    const onOther = () => onClose();
    window.addEventListener("beth-menu-open", onOther);
    return () => window.removeEventListener("beth-menu-open", onOther);
  }, [onClose]);

  useEffect(() => {
    let armed = false;
    const arm = window.setTimeout(() => {
      armed = true;
    }, 0);
    const close = (e: Event) => {
      if (!armed || ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(arm);
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  useEffect(() => {
    if (!mac || !box) return;
    const w = window as unknown as { webkit?: { messageHandlers?: { bethMenu?: { postMessage: (v: string) => void } } } };
    const root = ref.current?.getBoundingClientRect();
    const rows = root
      ? Array.from(ref.current?.querySelectorAll("button, .bt-menu-rule") ?? []).map((el, n) => {
          const r = el.getBoundingClientRect();
          if (el.classList.contains("bt-menu-rule")) return { t: "", y: Math.round(r.top - root.top), h: Math.round(r.height) };
          return {
            n,
            t: ((el.querySelector(":scope > span.min-w-0 span, :scope > span.min-w-0") as HTMLElement | null)?.innerText ?? el.textContent ?? "").trim().split("\n")[0],
            i: el.querySelector("[data-symbol]")?.getAttribute("data-symbol") || el.getAttribute("data-symbol") || "",
            d: el.classList.contains("text-status-err") ? 1 : 0,
            hot: el.matches(":hover") ? 1 : 0,
            y: Math.round(r.top - root.top),
            h: Math.round(r.height),
          };
        })
      : [];
    w.webkit?.messageHandlers?.bethMenu?.postMessage(JSON.stringify({ ...box, rows, ax: Math.round(x - box.x + 8) }));
  }, [mac, box, hover]);

  useEffect(() => {
    if (!mac) return;
    const w = window as unknown as {
      __bethMenuClick?: (n: number) => void;
      __bethMenuClosed?: () => void;
    };
    w.__bethMenuClick = (n) => {
      const el = ref.current?.querySelectorAll("button")[n] as HTMLButtonElement | undefined;
      el?.click();
    };
    w.__bethMenuClosed = () => onClose();
    return () => {
      w.__bethMenuClick = undefined;
      w.__bethMenuClosed = undefined;
    };
  }, [mac, onClose]);

  return createPortal(
    <div
      ref={ref}
      data-glass-menu
      className={cn("bt-menu fixed z-[80] overflow-hidden rounded-xl py-1 text-text-1", className)}
      style={{
        left: box?.x ?? x,
        top: box?.y ?? y,
        width,
        visibility: mac ? "hidden" : undefined,
        background: mac ? "transparent" : undefined,
        boxShadow: mac ? "none" : undefined,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseMove={() => setHover((n) => n + 1)}
      onMouseLeave={() => setHover(-1)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </div>,
    document.body,
  );
}

export function closeOtherMenus() {
  window.dispatchEvent(new CustomEvent("beth-menu-open"));
}

const SYMBOL: Record<string, string> = {
  pencil: "pencil",
  type: "textformat",
  x: "xmark",
  "rotate-cw": "arrow.clockwise",
  power: "power",
  "rotate-ccw": "arrow.uturn.backward",
  copy: "doc.on.doc",
  scissors: "scissors",
  paste: "doc.on.clipboard",
  "text-select": "selection.pin.in.out",
  link: "link",
  save: "square.and.arrow.down",
  "layout-grid": "square.grid.2x2",
  "panel-right": "rectangle.split.2x1",
  "panel-bottom": "rectangle.split.1x2",
  "panel-top": "rectangle.split.1x2",
  "panel-left": "rectangle.split.2x1",
  plus: "plus",
  "app-window": "macwindow",
  "log-out": "rectangle.portrait.and.arrow.right",
  "folder-input": "folder",
  columns: "rectangle.split.2x1",
  rows: "rectangle.split.1x2",
  "chevron-right": "chevron.right",
  "arrow-left": "chevron.left",
};

export function MenuItem({
  icon,
  label,
  disabled,
  danger,
  title,
  symbol,
  onClick,
}: {
  icon?: ReactNode;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  title?: string;
  /** SF Symbol desenhado dentro do vidro no macOS */
  symbol?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      data-symbol={symbol ? SYMBOL[symbol] ?? symbol : undefined}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-bg-hover disabled:cursor-default disabled:text-text-3 disabled:hover:bg-transparent",
        danger ? "text-status-err hover:bg-status-err/10" : "text-text-1",
      )}
      onClick={onClick}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

export function MenuRule() {
  return <div className="bt-menu-rule my-1 border-t border-border" />;
}
