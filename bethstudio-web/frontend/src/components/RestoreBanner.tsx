import { useState } from "react";
import type { Connection } from "@/lib/connection";
import {
  actOnPending,
  answerRestoreInit,
  answerSessionRestore,
  type InitAnswer,
  type PendingAction,
  type RestoreBannerInfo,
} from "@/lib/restoreBanner";

const BTN = "shrink-0 rounded bg-black/20 px-2.5 py-1 text-text-1 hover:bg-black/35 disabled:opacity-50";
const BTN_MAIN = "shrink-0 rounded bg-accent px-2.5 py-1 font-semibold text-white hover:bg-accent-hover disabled:opacity-50";

/** Faixa no alto do Studio durante e depois da restauração dos terminais. */
export function RestoreBanner({ conn, info, onDismiss }: { conn: Connection; info: RestoreBannerInfo; onDismiss: () => void }) {
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const failed = info.details.length > 0;
  const pending = info.pending ?? [];
  const attention = failed || pending.length > 0 || !!info.ask || !!info.askRestore;

  /** Uma ação por vez: o botão fica parado até a resposta, e o erro aparece na faixa. */
  const run = (f: () => Promise<unknown>) => {
    setWorking(true);
    setErr(null);
    f()
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setWorking(false));
  };
  const answer = (distro: string, a: InitAnswer) => run(() => answerRestoreInit(conn, distro, a));
  const act = (paneId: number, a: PendingAction) => run(() => actOnPending(conn, paneId, a));

  return (
    <div
      role="status"
      className={
        "relative z-50 shrink-0 border-b px-3 py-2 text-[13px] font-medium text-text-1 " +
        (attention
          ? "border-[rgb(var(--bt-warn)/0.45)] bg-[rgb(48,36,12)] text-[rgb(252,211,140)]"
          : "border-border bg-[rgb(var(--bt-bg-card))]")
      }
    >
      <div className="flex items-center gap-3">
        {info.busy && <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-text-3/30 border-t-accent" />}
        <span className="min-w-0 flex-1 leading-snug">{info.text}</span>
        {info.askRestore && (
          <>
            <button className={BTN_MAIN} disabled={working} onClick={() => run(() => answerSessionRestore(conn, true))}>
              Reabrir todos
            </button>
            <button className={BTN} disabled={working} onClick={() => run(() => answerSessionRestore(conn, false))}>
              Agora não
            </button>
          </>
        )}
        {info.ask && (
          <>
            <button className={BTN_MAIN} disabled={working} onClick={() => answer(info.ask!.distro, "run")}>
              Executar
            </button>
            <button className={BTN} disabled={working} onClick={() => answer(info.ask!.distro, "skip")}>
              Agora não
            </button>
          </>
        )}
        {info.init && (
          <button
            className={BTN}
            disabled={working}
            title="Segue com a restauração sem esperar o init terminar"
            onClick={() => answer(info.init!.distro, "continue")}
          >
            Continuar assim mesmo
          </button>
        )}
        {failed && (
          <button className="shrink-0 text-accent hover:underline" onClick={() => setOpen((v) => !v)}>
            {open ? "Esconder detalhes" : "Ver detalhes"}
          </button>
        )}
        {!info.busy && !info.ask && !info.askRestore && (
          <button className="shrink-0 text-text-2 hover:text-text-1" onClick={onDismiss}>
            Fechar
          </button>
        )}
      </div>
      {err && <div className="mt-1 text-status-err">{err}</div>}
      {failed && open && (
        <ul className="mt-1 list-disc pl-6 text-text-2">
          {info.details.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      )}
      {pending.length > 0 && (
        <ul className="mt-1 space-y-1">
          {pending.map((p) => (
            <li key={p.pane_id} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate" title={p.cwd}>
                <b>{p.title || `Terminal ${p.pane_id}`}</b> <span className="text-text-2">— {p.cwd}</span>
                {p.keep && <span className="ml-2 text-text-3">(guardado)</span>}
              </span>
              <button className={BTN_MAIN} disabled={working} title="Confere a pasta de novo e abre o terminal se ela já existir" onClick={() => act(p.pane_id, "retry")}>
                Continuar tentando
              </button>
              <button className={BTN} disabled={working || !!p.keep} title="Para de tentar sozinho; o terminal continua guardado" onClick={() => act(p.pane_id, "keep")}>
                Guardar
              </button>
              <button className={BTN} disabled={working} title="Abre o terminal na pasta padrão do WSL em vez da pasta que falta" onClick={() => act(p.pane_id, "default")}>
                Abrir na pasta padrão
              </button>
              <button className={BTN} disabled={working} title="Esquece este terminal (apaga a receita dele)" onClick={() => act(p.pane_id, "discard")}>
                Descartar
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
