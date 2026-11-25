import { useEffect, useState } from "react";
import { MonitorSmartphone } from "lucide-react";
import type { Connection } from "@/lib/connection";
import { browserLabel, sinceLabel } from "@/lib/remote";
import {
  SettingsBtn,
  SettingsGroup,
  SettingsHint,
  SettingsPanel,
  SettingsRow,
  SettingsSectionLabel,
  SettingsSwitch,
} from "./settings/SettingsUI";

// Configurações → Celular → "Studio completo pelo navegador" (remote_gate.go).
// Só existe no Studio do PC: o túnel recusa /api/remote.

type RemoteSession = { id: string; ip: string; ua: string; created: string; last: string };
type RemoteState = {
  enabled: boolean;
  has_totp: boolean;
  url: string;
  sessions: RemoteSession[];
  connected: number;
  secret?: string;
  qr?: string;
};

export function RemoteStudioSection({ conn, onMessage }: { conn: Connection; onMessage: (m: string) => void }) {
  const [st, setSt] = useState<RemoteState | null>(null);
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stop = false;
    const load = () =>
      void conn
        .api<RemoteState>("/api/remote")
        .then((s) => !stop && setSt(s))
        .catch(() => undefined);
    load();
    const t = window.setInterval(load, 3000);
    return () => {
      stop = true;
      window.clearInterval(t);
    };
  }, [conn]);

  const run = async (path: string, body: unknown, ok?: string) => {
    setBusy(true);
    try {
      const s = await conn.api<RemoteState>(path, body);
      setSt(s);
      if (ok) onMessage(ok);
      return s;
    } catch (e) {
      onMessage((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const startTOTP = async () => {
    const s = await run("/api/remote/totp", { action: "start" });
    if (s?.secret && s.qr) {
      setSetup({ secret: s.secret, qr: s.qr });
      setCode("");
    }
  };
  const confirmTOTP = async () => {
    const s = await run("/api/remote/totp", { action: "confirm", code: code.trim() }, "Segundo fator configurado");
    if (s) {
      setSetup(null);
      setCode("");
    }
  };

  if (!st) return null;
  const sessions = st.sessions ?? [];

  return (
    <div className="space-y-5">
      <div>
        <SettingsSectionLabel>
          <span className="inline-flex items-center gap-2">
            <MonitorSmartphone size={14} /> Studio completo pelo navegador
          </span>
        </SettingsSectionLabel>
        <SettingsHint className="mb-2">
          Abre este Studio inteiro em outro computador, pelo mesmo servidor do celular. Quem entrar controla este PC como se estivesse
          aqui: terminais, arquivos, bancos e SSH. Entra com a senha do celular e um código do app autenticador (Google Authenticator,
          Microsoft Authenticator, 1Password, Aegis…). O que abre algo na tela deste PC (escolher pasta, Explorer, janelas próprias) não
          aparece lá, e os terminais não mudam de tamanho.
        </SettingsHint>
        <SettingsGroup>
          <SettingsRow
            label="Ligado"
            hint={
              !st.has_totp
                ? "Configure o segundo fator para poder ligar."
                : st.enabled && st.url
                  ? <>No outro computador, abra <span className="font-mono text-text-1">{st.url}</span></>
                  : st.enabled && !st.url
                    ? "Falta ligar o celular acima (linha do servidor)."
                    : undefined
            }
          >
            <SettingsSwitch
              on={st.enabled}
              disabled={busy || (!st.enabled && !st.has_totp)}
              onChange={(on) => void run("/api/remote", { enabled: on }, on ? "Studio remoto ligado" : "Studio remoto desligado")}
              label="Studio remoto ligado"
            />
          </SettingsRow>
        </SettingsGroup>
      </div>

      <div>
        <SettingsSectionLabel>Segundo fator</SettingsSectionLabel>
        <SettingsHint className="mb-2">
          {st.has_totp ? "Configurado. Trocar encerra todas as sessões abertas." : "Ainda não configurado."}
        </SettingsHint>
        {!setup && (
          <SettingsBtn disabled={busy} onClick={() => void startTOTP()}>
            {st.has_totp ? "Trocar o segundo fator" : "Configurar o segundo fator"}
          </SettingsBtn>
        )}
        {setup && (
          <SettingsPanel className="mt-2 flex flex-wrap items-start gap-4">
            <img src={setup.qr} alt="QR do segundo fator" width={180} height={180} className="rounded bg-white p-1" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] text-text-2">Leia o QR com o app autenticador. Sem câmera, digite a chave:</p>
              <p className="mt-1 break-all font-mono text-[13px] text-text-1">{setup.secret.replace(/(.{4})/g, "$1 ").trim()}</p>
              <label className="mt-3 block text-[12px] text-text-3" htmlFor="remote-code">
                Código que o app mostra agora
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  id="remote-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={7}
                  value={code}
                  className="w-28 bt-field bg-bg-term px-2.5 py-1.5 font-mono text-[14px] text-text-1 outline-none"
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && code.trim().length >= 6 && void confirmTOTP()}
                />
                <SettingsBtn tone="accent" disabled={busy || code.trim().length < 6} onClick={() => void confirmTOTP()}>
                  Confirmar
                </SettingsBtn>
                <SettingsBtn onClick={() => setSetup(null)}>Cancelar</SettingsBtn>
              </div>
            </div>
          </SettingsPanel>
        )}
      </div>

      <div>
        <SettingsSectionLabel>
          Sessões abertas{st.connected > 0 ? ` · ${st.connected} conectada${st.connected > 1 ? "s" : ""} agora` : ""}
        </SettingsSectionLabel>
        {sessions.length === 0 ? (
          <SettingsHint>Nenhuma.</SettingsHint>
        ) : (
          <SettingsGroup>
            {sessions.map((s) => (
              <SettingsRow
                key={s.id}
                label={browserLabel(s.ua)}
                hint={`${s.ip} · último uso ${sinceLabel(s.last)} · entrou ${sinceLabel(s.created)}`}
              >
                <SettingsBtn disabled={busy} onClick={() => void run("/api/remote/revoke", { id: s.id }, "Sessão encerrada")}>
                  Encerrar
                </SettingsBtn>
              </SettingsRow>
            ))}
          </SettingsGroup>
        )}
        {sessions.length > 1 && (
          <div className="mt-2">
            <SettingsBtn disabled={busy} onClick={() => void run("/api/remote/revoke", { id: "" }, "Todas as sessões encerradas")}>
              Encerrar todas
            </SettingsBtn>
          </div>
        )}
        <SettingsHint className="mt-2">
          Entradas, erros de senha e sessões encerradas ficam em remote-access.log (Configurações → Sobre).
        </SettingsHint>
      </div>
    </div>
  );
}

/** Aviso no Studio do PC enquanto houver Studio remoto conectado. */
export function RemoteConnectedBadge({ conn, onOpen }: { conn: Connection; onOpen: () => void }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let stop = false;
    const load = () =>
      void conn
        .api<RemoteState>("/api/remote")
        .then((s) => !stop && setN(s.connected))
        .catch(() => undefined);
    load();
    const t = window.setInterval(load, 10000);
    return () => {
      stop = true;
      window.clearInterval(t);
    };
  }, [conn]);
  if (n === 0) return null;
  return (
    <button
      type="button"
      title="Alguém está usando este Studio por outro computador. Clique para ver as sessões."
      className="fixed right-3 bottom-3 z-40 flex items-center gap-1.5 rounded-full border border-status-warn/60 bg-bg-panel px-3 py-1 text-[12px] text-status-warn shadow-lg hover:bg-bg-hover"
      onClick={onOpen}
    >
      <MonitorSmartphone size={13} />
      Studio remoto conectado{n > 1 ? ` (${n})` : ""}
    </button>
  );
}
