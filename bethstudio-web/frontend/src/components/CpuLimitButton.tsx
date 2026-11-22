import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Gauge } from "lucide-react";
import type { Connection } from "@/lib/connection";
import {
  DURATIONS,
  chipText,
  cpuLimitOff,
  percentHint,
  setCpuLimit,
  statusText,
  type CpuLimit,
} from "@/lib/cpuLimit";

const BTN =
  "rounded bg-bg-hover px-2 py-1 text-[12px] text-text-1 hover:bg-border disabled:opacity-50";
const BTN_ON = "rounded bg-accent px-2 py-1 text-[12px] font-semibold text-white disabled:opacity-50";

/**
 * "Limitar CPU dos terminais" (cpu_limit.go): ícone na barra de abas. Sem
 * limite fica discreto; com limite vira uma etiqueta "CPU 70% · até 23:15".
 * O clique abre o ajuste (porcentagem, prazo, WSL) e o "Voltar ao normal".
 */
export function CpuLimitButton({ conn, limit }: { conn: Connection; limit: CpuLimit | null }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  const [percent, setPercent] = useState(70);
  const [minutes, setMinutes] = useState(120);
  const [wsl, setWsl] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  const place = () => {
    const r = box.current?.getBoundingClientRect();
    if (r) setAt({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
  };

  // ao abrir, começa do limite atual ou do último usado
  const show = () => {
    if (limit) {
      setPercent(limit.percent || limit.last_percent || 70);
      setMinutes(limit.percent || limit.last_percent ? (limit.last_minutes ?? 120) : 120);
      setWsl(limit.last_percent ? limit.wsl : true);
    }
    setErr(null);
    place();
    setOpen(true);
  };

  useEffect(() => conn.onUiOpen((what) => what === "cpulimit" && show()), [conn, limit]);

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
            ? "flex h-6 items-center gap-1 rounded bg-status-warn/20 px-2 text-[12px] font-semibold text-status-warn hover:bg-status-warn/30"
            : "flex h-6 w-8 items-center justify-center rounded text-text-3 hover:bg-bg-hover hover:text-text-1"
        }
        title={on ? "CPU dos terminais limitada. Clique para mudar ou voltar ao normal." : "Limitar a CPU dos terminais"}
        aria-label="Limitar a CPU dos terminais"
        aria-expanded={open}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => (open ? setOpen(false) : show())}
      >
        <Gauge size={15} />
        {on && <span>{chipText(limit)}</span>}
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
            <div className="mb-1 font-semibold">Limitar CPU dos terminais</div>
            <p className="mb-2 text-[12px] text-text-2">
              Os terminais e tudo o que eles abrirem (agentes, builds) não passam deste teto. Nada é encerrado; só fica
              mais lento. A janela do Studio continua rápida.
            </p>
            <div className={`mb-3 rounded border px-2 py-1.5 text-[12px] ${on ? "border-status-warn/60 text-status-warn" : "border-border text-text-2"}`}>
              {statusText(limit)}
            </div>

            <label className="mb-1 flex items-baseline justify-between">
              <span>No máximo</span>
              <b className="text-[15px]">{percent}%</b>
            </label>
            <input
              type="range"
              min={5}
              max={95}
              step={5}
              value={percent}
              onChange={(e) => setPercent(Number(e.target.value))}
              className="w-full"
            />
            <div className="mb-3 text-[11px] text-text-3">{percentHint(percent, limit.total)}</div>

            <div className="mb-1">Por quanto tempo</div>
            <div className="mb-3 flex flex-wrap gap-1">
              {DURATIONS.map((d) => (
                <button key={d.minutes} className={minutes === d.minutes ? BTN_ON : BTN} onClick={() => setMinutes(d.minutes)}>
                  {d.label}
                </button>
              ))}
            </div>

            <label className="mb-3 flex items-start gap-2 text-[12px]">
              <input type="checkbox" checked={wsl} onChange={(e) => setWsl(e.target.checked)} className="mt-0.5" />
              <span>
                Também nos terminais WSL
                <span className="block text-text-3">
                  No WSL o teto vira núcleos ({Math.max(1, Math.round((percent * limit.total) / 100))} de {limit.total}).
                </span>
              </span>
            </label>

            {(err || limit.error) && <div className="mb-2 text-[12px] text-status-err">{err || limit.error}</div>}

            <div className="flex justify-end gap-2">
              {on && (
                <button className={BTN} disabled={busy} onClick={() => run(() => cpuLimitOff(conn))}>
                  Voltar ao normal
                </button>
              )}
              <button className={BTN_ON} disabled={busy} onClick={() => run(() => setCpuLimit(conn, percent, minutes, wsl))}>
                {on ? "Mudar limite" : "Limitar"}
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
