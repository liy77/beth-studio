import { useEffect, useRef, useState } from "react";
import { SplitSquareHorizontal } from "lucide-react";
import type { Connection } from "@/lib/connection";
import type { PaneInfo } from "@/lib/types";
import { paneLabel } from "@/lib/panes";
import { setPane } from "@/lib/appearance";
import { AppSheet, SettingsBtn, SettingsGroup, SettingsHint, SettingsRow } from "./settings/SettingsUI";

/** "Separar no Beth Studio": o pane sai do split do host (nada e' encerrado). */
export function SeparateDialog({
  conn,
  pane,
  info,
  onClose,
  onDone,
}: {
  conn: Connection;
  pane: number;
  info: PaneInfo | undefined;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => cancelRef.current?.focus(), []);
  return (
    <AppSheet
      title="Separar no Beth Studio?"
      icon={<SplitSquareHorizontal size={15} className="text-accent-text" />}
      onClose={onClose}
      width="sm"
      footer={
        <>
          <div className="flex-1" />
          <button ref={cancelRef} type="button" className="bt-settings-btn" onClick={onClose}>
            Cancelar
          </button>
          <SettingsBtn
            tone="accent"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              conn
                .separate(pane)
                .then(() => setPane(conn, pane, { size_mode: "fit" }))
                .then(() => {
                  onDone("Terminal separado no Beth Studio — ajustando à janela");
                  onClose();
                })
                .catch((e: Error) => {
                  setBusy(false);
                  setError(e.message);
                });
            }}
          >
            Separar
          </SettingsBtn>
        </>
      }
    >
      <div className="space-y-3">
        <SettingsGroup>
          <SettingsRow label={info ? paneLabel(info) : `Terminal ${pane}`} hint="Nada é encerrado — só sai do split na GUI." />
        </SettingsGroup>
        <SettingsHint>
          Na GUI, este terminal sai do split e vira uma aba separada na mesma janela. Depois o web pode ajustar o tamanho dele à janela.
        </SettingsHint>
        {error && <div className="rounded-lg bg-status-err/10 px-3 py-2 text-[12px] text-status-err">{error}</div>}
      </div>
    </AppSheet>
  );
}
