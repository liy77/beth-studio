import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import type { Connection } from "@/lib/connection";
import { actOnProc, memText, runningFor, shortFolder, type AgentProc, type ProcAction } from "@/lib/agentProcs";

const BTN = "shrink-0 rounded bg-bg-hover px-2 py-0.5 text-[12px] text-text-1 hover:bg-border disabled:opacity-50";
const BTN_KILL = "shrink-0 rounded bg-status-err/80 px-2 py-0.5 text-[12px] font-semibold text-white hover:bg-status-err disabled:opacity-50";

/**
 * "Processos deixados pelos agentes" (agent_procs.go): um sino com o número na
 * barra de abas; o clique abre a lista. Não empurra o terminal para baixo (a
 * faixa antiga atrapalhava a leitura). Nada é encerrado sem clique.
 */
export function AgentProcsBell({ conn, items }: { conn: Connection; items: AgentProc[] }) {
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  useEffect(() => {
    if (items.length === 0) setOpen(false);
  }, [items.length]);

  if (items.length === 0) return null;

  const act = (p: AgentProc, a: ProcAction) => {
    setWorking(p.id);
    setErr(null);
    actOnProc(conn, p.id, a)
      .catch((e: unknown) => setErr(`${p.name}: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => setWorking(null));
  };

  return (
    <div ref={box} className="relative shrink-0 self-center" data-no-drag>
      <button
        className="relative flex h-6 w-8 items-center justify-center rounded text-status-warn hover:bg-bg-hover"
        title={`${items.length} ${items.length === 1 ? "processo deixado" : "processos deixados"} pelos agentes rodando há muito tempo`}
        aria-label="Processos deixados pelos agentes"
        aria-expanded={open}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => setOpen((v) => !v)}
      >
        <Bell size={15} />
        <span className="absolute -right-0.5 -top-0.5 min-w-[15px] rounded-full bg-status-warn px-1 text-center text-[10px] font-bold leading-[15px] text-black">
          {items.length}
        </span>
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-50 w-[min(640px,90vw)] rounded-md border border-border bg-bg-card p-3 text-[13px] text-text-1 shadow-xl">
          <div className="mb-2 font-semibold">Processos deixados pelos agentes</div>
          <p className="mb-2 text-[12px] text-text-2">Rodando há muito tempo. Nada é encerrado sem você pedir.</p>
          {err && <div className="mb-2 text-status-err">{err}</div>}
          <ul className="max-h-[60vh] space-y-2 overflow-y-auto">
            {items.map((p) => (
              <li key={p.id} className="rounded border border-border bg-bg-panel p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1">
                    <b>{p.name}</b>
                    <span className="text-text-2">
                      {" "}
                      · {p.side === "wsl" ? `WSL ${p.distro ?? ""}` : "Windows"} · PID {p.pid} · {runningFor(p.started)} · {memText(p.mem)}
                      {p.cpu >= 0.05 ? ` · ${p.cpu.toFixed(1).replace(".", ",")} núcleo` : " · parado"}
                      {p.orphan ? " · o agente já saiu" : ""}
                    </span>
                  </span>
                  <button className={BTN_KILL} disabled={working === p.id} title="Encerra o processo e os que ele abriu" onClick={() => act(p, "kill")}>
                    Encerrar
                  </button>
                  <button className={BTN} disabled={working === p.id} title="Não avisa mais sobre este processo" onClick={() => act(p, "ignore")}>
                    Ignorar
                  </button>
                  <button className={BTN} disabled={working === p.id} onClick={() => act(p, "snooze")}>
                    Lembrar em 1 h
                  </button>
                </div>
                {p.agent_cwd && <div className="mt-1 truncate text-[11px] text-text-3" title={p.agent_cwd}>agente em {shortFolder(p.agent_cwd)}</div>}
                {p.cmd && (
                  <div className="mt-0.5 truncate font-mono text-[11px] text-text-3" title={p.cmd}>
                    {p.cmd}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
