import { useEffect, useRef } from "react";
import { AlertTriangle, Power, RotateCw } from "lucide-react";
import type { Connection } from "@/lib/connection";
import type { PaneInfo } from "@/lib/types";
import type { AgentInfo } from "@/lib/agents";
import { killConfirmed } from "@/lib/killFlow";
import { paneLabel, shortCwd } from "@/lib/panes";
import { KindIcon } from "./KindIcon";
import { AppSheet, SettingsBtn, SettingsGroup, SettingsHint, SettingsPanel } from "./settings/SettingsUI";

/**
 * "Encerrar / Matar / Reiniciar este terminal?" — Cancelar tem o foco; so' o
 * botao vermelho encerra. O host encerra o shell e tudo o que ele abriu (patch 0203).
 */
export type KillMode = "encerrar" | "matar" | "reiniciar";

const TEXT: Record<KillMode, { title: string; button: string; body: string }> = {
  encerrar: {
    title: "Encerrar este terminal?",
    button: "Encerrar",
    body:
      typeof navigator !== "undefined" && /Mac/.test(navigator.platform)
        ? "O terminal e tudo o que ele abriu (agentes, servidores MCP) são encerrados no Beth Studio. Fechar a aba ou a visualização não faz isso — os terminais continuam rodando."
        : "O terminal e tudo o que ele abriu (agentes, servidores MCP, WSL) são encerrados no Beth Studio. Fechar a aba ou a visualização não faz isso — os terminais continuam rodando.",
  },
  matar: {
    title: "Matar este terminal?",
    button: "Matar",
    body:
      typeof navigator !== "undefined" && /Mac/.test(navigator.platform)
        ? "O terminal e tudo o que ele abriu (agentes, servidores MCP) são encerrados no Beth Studio, e ele sai da aba. Se for o único da aba, a aba fecha."
        : "O terminal e tudo o que ele abriu (agentes, servidores MCP, WSL) são encerrados no Beth Studio, e ele sai da aba. Se for o único da aba, a aba fecha.",
  },
  reiniciar: {
    title: "Reiniciar este terminal?",
    button: "Reiniciar",
    body: "Abre um shell novo do mesmo tipo, na mesma pasta e no mesmo lugar da aba. Depois encerra este e tudo o que ele abriu. Se o novo não abrir, este continua como está.",
  },
};

export function KillDialog({
  conn,
  pane,
  info,
  agent,
  mode = "encerrar",
  onKilled,
  onRestart,
  onClose,
}: {
  conn: Connection;
  pane: number;
  info: PaneInfo | undefined;
  agent: AgentInfo | undefined;
  mode?: KillMode;
  onKilled?: () => void;
  onRestart?: (end: (pane: number) => boolean) => void;
  onClose: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => cancelRef.current?.focus(), []);
  const isAgent = !!info?.agent || !!agent;
  const t = TEXT[mode];
  return (
    <AppSheet
      title={t.title}
      icon={mode === "reiniciar" ? <RotateCw size={15} className="text-status-err" /> : <Power size={15} className="text-status-err" />}
      onClose={onClose}
      width="sm"
      className="border-status-err/40"
      footer={
        <>
          <div className="flex-1" />
          <button
            ref={cancelRef}
            type="button"
            className="bt-settings-btn"
            onClick={onClose}
          >
            Cancelar
          </button>
          <SettingsBtn
            tone="danger"
            onClick={() => {
              if (mode === "reiniciar") onRestart?.((p) => killConfirmed(conn, p));
              else {
                killConfirmed(conn, pane);
                onKilled?.();
              }
              onClose();
            }}
          >
            {t.button}
          </SettingsBtn>
        </>
      }
    >
      <div className="space-y-3">
        <SettingsGroup>
          <div className="flex items-center gap-2 px-3.5 py-3">
            {info && <KindIcon pane={info} />}
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] text-text-1">{info ? paneLabel(info) : `Terminal ${pane}`}</div>
              {info?.cwd && <div className="truncate font-mono text-[11px] text-text-2">{shortCwd(info.cwd, 6)}</div>}
              {info?.kind_label && <div className="text-[11px] text-text-3">{info.kind_label}</div>}
            </div>
          </div>
        </SettingsGroup>
        <SettingsHint>{t.body}</SettingsHint>
        {(isAgent || agent) && (
          <SettingsPanel className="flex items-start gap-2 border-status-warn/40 bg-status-warn/10">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-status-warn" />
            <span className="text-[12px] text-text-1">
              {agent ? "Um agente neste terminal está aguardando sua resposta." : "Este terminal parece ter um agente de IA rodando."} O
              trabalho em andamento será interrompido.
            </span>
          </SettingsPanel>
        )}
      </div>
    </AppSheet>
  );
}
