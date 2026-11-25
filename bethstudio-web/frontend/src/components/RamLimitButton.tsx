import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MemoryStick } from "lucide-react";
import type { Connection } from "@/lib/connection";
import {
  RAM_DURATIONS,
  ramChipText,
  ramLimitOff,
  ramPercentHint,
  ramStatusText,
  setRamLimit,
  type RamLimit,
} from "@/lib/ramLimit";

const BTN =
  "rounded bg-bg-hover px-2 py-1 text-[12px] text-text-1 hover:bg-border disabled:opacity-50";
const BTN_ON = "rounded bg-accent px-2 py-1 text-[12px] font-semibold text-white disabled:opacity-50";

/**
 * "Limitar RAM dos terminais" (ram_limit.go): ícone na barra de abas, ao lado
 * do teto de CPU. Com limite vira etiqueta "RAM 40% · até 23:15".
 */
export function RamLimitButton({ conn, limit }: { conn: Connection; limit: RamLimit | null }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  const [percent, setPercent] = useState(40);
  const [minutes, setMinutes] = useState(120);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  const place = () => {
    const r = box.current?.getBoundingClientRect();
    if (r) setAt({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
  };

  const show = () => {
    if (limit) {
      setPercent(limit.percent || limit.last_percent || 40);
      setMinutes(limit.percent || limit.last_percent ? (limit.last_minutes ?? 120) : 120);
    }
    setErr(null);
    place();
    setOpen(true);
  };

  useEffect(() => conn.onUiOpen((what) => what === "ramlimit" && show()), [conn, limit]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (box.current?.contains(t) || pop.current?.contains(t)) return;
      setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (!limit) return null;
  const on = limit.percent > 0;
  const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

  const run = (f: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    f()
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  return (
    <div ref={box} className="relative shrink-0 self-center" data-no-drag>
      <button
        className={
          on
            ? "bt-tab-tool !w-auto gap-1 px-2 font-semibold text-status-warn"
            : "bt-tab-tool"
        }
        title={on ? "RAM dos terminais limitada. Clique para mudar ou voltar ao normal." : "Limitar a RAM dos terminais"}
        aria-label="Limitar a RAM dos terminais"
        aria-expanded={open}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => (open ? setOpen(false) : show())}
      >
        <MemoryStick size={15} strokeWidth={2} />
        {on && <span className="text-[11px]">{ramChipText(limit)}</span>}
      </button>
      {open &&
        at &&
        createPortal(
          <div
            ref={pop}
            className="fixed z-[1000] w-[min(420px,92vw)] rounded-md border border-border-strong bg-bg-card p-3 text-[13px] text-text-1 shadow-xl"
            style={{ top: at.top, right: at.right }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="mb-1 font-semibold">Limitar RAM dos terminais</div>
            <p className="mb-2 text-[12px] text-text-2">
              Os terminais e tudo o que eles abrirem (agentes, builds) não passam deste teto juntos.
              {isMac
                ? " No Mac, se passarem, ficam pausados até a memória cair ou você subir o limite."
                : " No Windows o sistema recusa novas alocações acima do teto."}{" "}
              A janela do Studio não entra na conta.
            </p>
            <div className={`mb-3 rounded border px-2 py-1.5 text-[12px] ${on ? "border-status-warn/60 text-status-warn" : "border-border text-text-2"}`}>
              {ramStatusText(limit)}
            </div>

            <label className="mb-1 flex items-baseline justify-between">
              <span>No máximo</span>
              <b className="text-[15px]">{percent}%</b>
            </label>
            <input
              type="range"
              min={10}
              max={90}
              step={5}
              value={percent}
              onChange={(e) => setPercent(Number(e.target.value))}
              className="w-full"
            />
            <div className="mb-3 text-[11px] text-text-3">{ramPercentHint(percent, limit.total_bytes)}</div>

            <div className="mb-1">Por quanto tempo</div>
            <div className="mb-3 flex flex-wrap gap-1">
              {RAM_DURATIONS.map((d) => (
                <button key={d.minutes} className={minutes === d.minutes ? BTN_ON : BTN} onClick={() => setMinutes(d.minutes)}>
                  {d.label}
                </button>
              ))}
            </div>

            {(err || limit.error) && <div className="mb-2 text-[12px] text-status-err">{err || limit.error}</div>}

            <div className="flex justify-end gap-2">
              {on && (
                <button className={BTN} disabled={busy} onClick={() => run(() => ramLimitOff(conn))}>
                  Voltar ao normal
                </button>
              )}
              <button className={BTN_ON} disabled={busy} onClick={() => run(() => setRamLimit(conn, percent, minutes))}>
                {on ? "Mudar limite" : "Limitar"}
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
