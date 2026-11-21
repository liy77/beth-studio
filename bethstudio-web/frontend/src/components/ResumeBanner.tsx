import { useState } from "react";
import type { Connection } from "@/lib/connection";
import { dismissResume, resumeBannerText, runResume, type ResumeOffer } from "@/lib/agentResume";

const BTN = "shrink-0 rounded bg-bg-hover px-2 py-0.5 text-text-1 hover:bg-border disabled:opacity-50";
const BTN_MAIN = "shrink-0 rounded bg-accent px-2 py-0.5 font-semibold text-white hover:bg-accent-hover disabled:opacity-50";

/** Faixa "Retomar sessões do Claude" depois que o host reinicia (agent_resume.go). */
export function ResumeBanner({ conn, offers, nameOf }: { conn: Connection; offers: ResumeOffer[]; nameOf: (paneId: number) => string | undefined }) {
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const text = resumeBannerText(offers);
  if (!text) return null;

  const run = (f: () => Promise<unknown>) => {
    setWorking(true);
    setErr(null);
    f()
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setWorking(false));
  };

  return (
    <div role="status" className="shrink-0 border-b border-accent/40 bg-accent/10 px-3 py-1.5 text-[13px] text-text-1">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1">{text}</span>
        <button className={BTN_MAIN} disabled={working} title="Digita o comando de retomar em cada um desses terminais" onClick={() => run(() => runResume(conn, "all"))}>
          Retomar todas
        </button>
        <button className="shrink-0 text-accent hover:underline" onClick={() => setOpen((v) => !v)}>
          {open ? "Esconder" : "Escolher"}
        </button>
        <button className="shrink-0 text-text-2 hover:text-text-1" disabled={working} title="Não retomar; esquece estas sessões" onClick={() => run(() => dismissResume(conn, "all"))}>
          Agora não
        </button>
      </div>
      {err && <div className="mt-1 text-status-err">{err}</div>}
      {open && (
        <ul className="mt-1 space-y-1">
          {offers.map((o) => (
            <li key={o.pane_id} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate" title={`${o.cwd ?? ""}\nsessão ${o.session_id}`}>
                <b>{nameOf(o.pane_id) || o.title || `Terminal ${o.pane_id}`}</b>
                {o.cwd && <span className="text-text-2"> — {o.cwd}</span>}
                {o.ended && <span className="ml-2 text-text-3">(você tinha saído do Claude)</span>}
              </span>
              <button className={BTN_MAIN} disabled={working} onClick={() => run(() => runResume(conn, [o.pane_id]))}>
                Retomar
              </button>
              <button className={BTN} disabled={working} onClick={() => run(() => dismissResume(conn, [o.pane_id]))}>
                Esquecer
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
