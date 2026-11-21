import { useState } from "react";
import type { Connection } from "@/lib/connection";
import { actOnProc, memText, procsBannerText, runningFor, shortFolder, type AgentProc, type ProcAction } from "@/lib/agentProcs";

const BTN = "shrink-0 rounded bg-bg-hover px-2 py-0.5 text-text-1 hover:bg-border disabled:opacity-50";
const BTN_KILL = "shrink-0 rounded bg-status-err/80 px-2 py-0.5 font-semibold text-white hover:bg-status-err disabled:opacity-50";

/** Faixa "Processos deixados pelos agentes" (agent_procs.go). Nada é encerrado sem clique. */
export function AgentProcsBanner({ conn, items }: { conn: Connection; items: AgentProc[] }) {
  const [open, setOpen] = useState(items.length <= 3);
  const [working, setWorking] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const text = procsBannerText(items);
  if (!text) return null;

  const act = (p: AgentProc, a: ProcAction) => {
    setWorking(p.id);
    setErr(null);
    actOnProc(conn, p.id, a)
      .catch((e: unknown) => setErr(`${p.name}: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => setWorking(null));
  };

  return (
    <div role="status" className="shrink-0 border-b border-status-warn/40 bg-status-warn/10 px-3 py-1.5 text-[13px] text-text-1">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1">{text}</span>
        <button className="shrink-0 text-accent hover:underline" onClick={() => setOpen((v) => !v)}>
          {open ? "Esconder" : "Ver"}
        </button>
      </div>
      {err && <div className="mt-1 text-status-err">{err}</div>}
      {open && (
        <ul className="mt-1 space-y-1">
          {items.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate" title={`${p.cmd ?? p.name}\nPID ${p.pid}${p.agent_cwd ? `\nagente em ${p.agent_cwd}` : ""}`}>
                <b>{p.name}</b>
                <span className="text-text-2">
                  {" "}
                  · {p.side === "wsl" ? `WSL ${p.distro ?? ""}` : "Windows"} · PID {p.pid} · {runningFor(p.started)} · {memText(p.mem)}
                  {p.cpu >= 0.05 ? ` · ${p.cpu.toFixed(1).replace(".", ",")} núcleo` : " · parado"}
                  {p.agent_cwd ? ` · ${shortFolder(p.agent_cwd)}` : ""}
                  {p.orphan ? " · o agente já saiu" : ""}
                </span>
                {p.cmd && <span className="ml-2 font-mono text-[11px] text-text-3">{p.cmd}</span>}
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
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
