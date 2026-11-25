import { useEffect, useState } from "react";
import type { Connection } from "@/lib/connection";
import type { SettingsEvent } from "@/lib/types";
import { captureShortcut, shortcutCatalog, shortcutOf, shortcutParts } from "@/lib/shortcut";
import { cn } from "@/lib/utils";
import { SettingsBtn, SettingsGroup, SettingsHint, SettingsRow } from "./settings/SettingsUI";

interface Props {
  conn: Connection;
  saved: Record<string, string> | undefined;
  onMessage: (text: string, err?: boolean) => void;
}

/** Aba de atalhos. Clicar na combinação e apertar teclas grava; Esc volta ao padrão. */
export function ShortcutsSection({ conn, saved, onMessage }: Props) {
  const [recording, setRecording] = useState<string | null>(null);

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const s = captureShortcut(e);
      if (s === null) return;
      const id = recording;
      setRecording(null);
      conn
        .api<SettingsEvent>("/api/settings/search-shortcut", { shortcut_id: id, shortcut: s })
        .then((st) => {
          conn.setSettings(st);
          onMessage(s ? "Atalho salvo" : "Atalho voltou ao padrão");
        })
        .catch((err: Error) => onMessage(err.message, true));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, conn, onMessage]);

  return (
    <div>
      <SettingsHint className="mb-2">Clique na combinação e aperte as teclas. Esc volta ao padrão do sistema.</SettingsHint>
      <SettingsGroup>
        {shortcutCatalog().map((item) => {
          const current = shortcutOf(saved, item.id);
          const custom = !!saved?.[item.id];
          return (
            <SettingsRow key={item.id} label={item.label}>
              <button
                type="button"
                className={cn("flex items-center gap-1", recording === item.id && "rounded-lg ring-1 ring-accent")}
                onClick={() => setRecording(item.id)}
              >
                {recording === item.id ? (
                  <span className="rounded-md bg-bg-hover px-2 py-1 text-[12px] text-text-2">Aperte a combinação…</span>
                ) : (
                  shortcutParts(current).map((k, i) => (
                    <span key={i} className="flex h-7 min-w-7 items-center justify-center rounded-md bg-bg-hover px-1.5 font-mono text-[13px] text-text-1">
                      {k}
                    </span>
                  ))
                )}
              </button>
              {custom && (
                <SettingsBtn
                  onClick={() => {
                    conn
                      .api<SettingsEvent>("/api/settings/search-shortcut", { shortcut_id: item.id, shortcut: "" })
                      .then((st) => conn.setSettings(st))
                      .catch((err: Error) => onMessage(err.message, true));
                  }}
                >
                  Padrão
                </SettingsBtn>
              )}
            </SettingsRow>
          );
        })}
      </SettingsGroup>
    </div>
  );
}
