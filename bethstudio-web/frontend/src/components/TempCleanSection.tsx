import { useCallback, useEffect, useState } from "react";
import type { Connection } from "@/lib/connection";
import {
  SettingsBtn,
  SettingsGroup,
  SettingsHint,
  SettingsPanel,
  SettingsRow,
  SettingsSectionLabel,
  SettingsSwitch,
} from "./settings/SettingsUI";

// Configurações > Arquivos temporários (tempclean.go): apaga sozinho o que o
// Studio cria em C:\tmp\bethstudio (imagens/arquivos colados e textos longos
// do Falar) quando passa de N dias.

interface View {
  enabled: boolean;
  days: number;
  files: number;
  bytes: number;
  old_files: number;
  old_bytes: number;
  removed_files?: number;
  removed_bytes?: number;
  dirs: string[];
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(0)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function TempCleanSection({ conn, onMessage }: { conn: Connection; onMessage: (m: string) => void }) {
  const [v, setV] = useState<View | null>(null);
  const [days, setDays] = useState("10");
  const [busy, setBusy] = useState(false);

  const apply = useCallback((n: View) => {
    setV(n);
    setDays(String(n.days));
  }, []);
  useEffect(() => {
    conn.api<View>("/api/temp-clean").then(apply).catch((e: Error) => onMessage(e.message));
  }, [conn, apply, onMessage]);

  const save = async (enabled: boolean, d: number) => {
    setBusy(true);
    try {
      apply(await conn.api<View>("/api/temp-clean", { enabled, days: d }));
    } catch (e) {
      onMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const runNow = async () => {
    setBusy(true);
    try {
      const n = await conn.api<View>("/api/temp-clean/run", {});
      apply(n);
      onMessage(n.removed_files ? `Apagados ${n.removed_files} arquivos (${formatBytes(n.removed_bytes ?? 0)})` : "Nada para apagar");
    } catch (e) {
      onMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!v) return <SettingsHint>Carregando…</SettingsHint>;
  const d = Math.max(1, Math.min(365, Math.round(Number(days)) || v.days));
  return (
    <div className="space-y-5">
      <SettingsHint>
        O Studio guarda aqui as imagens e arquivos que você cola nos terminais e os textos longos do Falar (a instrução que vai para o agente aponta para
        eles). Esta limpeza apaga sozinha o que for mais velho que o prazo abaixo. Só mexe nos arquivos que o próprio Studio criou.
      </SettingsHint>
      <div>
        <SettingsSectionLabel>Limpeza automática</SettingsSectionLabel>
        <SettingsGroup>
          <SettingsRow label="Apagar arquivos temporários antigos automaticamente">
            <SettingsSwitch
              on={v.enabled}
              disabled={busy}
              onChange={(on) => void save(on, d)}
              label="Apagar arquivos temporários antigos automaticamente"
            />
          </SettingsRow>
          <SettingsRow label="Apagar o que tiver mais de" hint="dias">
            <input
              type="number"
              min={1}
              max={365}
              className="w-20 rounded-md border border-border bg-bg-term px-2 py-1 text-right text-[13px] text-text-1"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              onBlur={() => d !== v.days && void save(v.enabled, d)}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
            {[10, 15, 30].map((n) => (
              <SettingsBtn key={n} disabled={busy || n === v.days} onClick={() => void save(v.enabled, n)}>
                {n} dias
              </SettingsBtn>
            ))}
          </SettingsRow>
        </SettingsGroup>
      </div>
      <SettingsPanel className="text-[12px] text-text-2">
        <div>
          Agora: <b className="text-text-1">{v.files}</b> arquivos ({formatBytes(v.bytes)}). Passaram do prazo: <b className="text-text-1">{v.old_files}</b> (
          {formatBytes(v.old_bytes)}).
        </div>
        <div className="mt-1 break-all font-mono text-[11px]">{v.dirs.join("  ·  ")}</div>
      </SettingsPanel>
      <SettingsBtn disabled={busy || v.old_files === 0} onClick={() => void runNow()}>
        Apagar os antigos agora
      </SettingsBtn>
      <SettingsHint>A limpeza roda 1 minuto depois de abrir o Studio e a cada 6 horas, só enquanto estiver ligada.</SettingsHint>
    </div>
  );
}
