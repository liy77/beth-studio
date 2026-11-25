import { useCallback, useEffect, useState } from "react";
import type { Connection } from "@/lib/connection";
import {
  agoLabel,
  countdownLabel,
  deviceTitle,
  pairingState,
  type DevicesView,
  type Pairing,
  type PhoneDevice,
} from "@/lib/phoneDevices";
import {
  SettingsBtn,
  SettingsGroup,
  SettingsHint,
  SettingsPanel,
  SettingsRow,
  SettingsSectionLabel,
} from "./settings/SettingsUI";

/**
 * Configurações → Celular → Aparelhos conectados: QR code de uso único e a lista
 * de aparelhos (renomear, revogar, revogar todos). O Studio remoto não vê isto.
 */
export function PhoneDevicesSection({ conn, onMessage }: { conn: Connection; onMessage: (m: string) => void }) {
  const [view, setView] = useState<DevicesView | null>(null);
  const [missing, setMissing] = useState(false); // Studio antigo, sem esta API
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);

  const load = useCallback(() => {
    void conn
      .api<DevicesView>("/api/phone/devices")
      .then((v) => {
        // Studio antigo: a rota não existe (404, ou a página no lugar do JSON)
        if (!Array.isArray(v?.devices)) {
          setMissing(true);
          return;
        }
        setView(v);
        setMissing(false);
      })
      .catch((e: Error & { status?: number }) => {
        if (e.status === 404) setMissing(true);
      });
  }, [conn]);

  useEffect(() => {
    load();
    const t = window.setInterval(() => {
      setNow(Date.now());
      load();
    }, 2000);
    return () => window.clearInterval(t);
  }, [load]);

  async function post(path: string, body: unknown = {}) {
    setBusy(true);
    try {
      const v = await conn.api<DevicesView>(path, body);
      setView(v);
      return true;
    } catch (e) {
      onMessage((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    setBusy(true);
    try {
      const p = await conn.api<Pairing>("/api/phone/devices/pairing", {});
      setPairing(p);
      setNow(Date.now());
      load();
    } catch (e) {
      onMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!pairing) return;
    try {
      await navigator.clipboard.writeText(pairing.link);
      onMessage("Link copiado. Vale uma vez, por poucos minutos.");
    } catch {
      onMessage("Não deu para copiar. Selecione o link e copie.");
    }
  }

  if (missing) return null;
  const pending = view?.pending ?? 0;
  const state = pairingState(pairing, pending, now);
  const left = pairing ? countdownLabel(pairing.expires_at, now) : null;
  const devices: PhoneDevice[] = view?.devices ?? [];
  const configured = view?.configured ?? false;

  return (
    <div className="space-y-5" aria-label="Aparelhos conectados">
      <div>
        <SettingsSectionLabel>Aparelhos conectados</SettingsSectionLabel>
        <SettingsHint className="mb-2">
          Abra o QR code com a câmera do celular: ele entra já logado, sem digitar domínio nem senha. O link vale uma vez e por 5 minutos. A senha continua
          existindo como alternativa.
        </SettingsHint>
        <div className="flex flex-wrap items-center gap-2">
          <SettingsBtn tone="accent" disabled={busy || !configured} onClick={() => void generate()}>
            {state === "idle" ? "Conectar um celular" : "Gerar outro QR code"}
          </SettingsBtn>
          {!configured && <span className="text-[12px] text-text-3">Salve a linha do servidor e a senha primeiro.</span>}
        </div>
      </div>

      {pairing && state === "waiting" && (
        <SettingsPanel className="flex max-w-xl flex-wrap items-start gap-4">
          <img src={pairing.qr} alt="QR code para conectar o celular" width={200} height={200} className="rounded bg-white p-2" />
          <div className="min-w-0 flex-1 text-[13px] text-text-2">
            <p>Vence em {left}. Só vale uma vez.</p>
            <input
              readOnly
              value={pairing.link}
              aria-label="Link para conectar o celular"
              className="mt-2 w-full bt-field bg-bg-term px-2 py-1.5 font-mono text-[12px] text-text-1"
              onFocus={(e) => e.currentTarget.select()}
            />
            <div className="mt-2 flex gap-2">
              <SettingsBtn onClick={() => void copyLink()}>Copiar link</SettingsBtn>
              <SettingsBtn onClick={() => void post("/api/phone/devices/pairing/cancel").then((ok) => ok && setPairing(null))}>Cancelar</SettingsBtn>
            </div>
          </div>
        </SettingsPanel>
      )}
      {state === "used" && <p className="text-[13px] text-status-ok">Celular conectado.</p>}
      {state === "expired" && <SettingsHint>O QR code venceu. Gere outro.</SettingsHint>}

      <div>
        {devices.length === 0 ? (
          <SettingsHint>Nenhum celular conectado ainda.</SettingsHint>
        ) : (
          <SettingsGroup>
            {devices.map((d) => (
              <SettingsRow
                key={d.id}
                label={
                  editing?.id === d.id ? (
                    <span className="flex gap-2">
                      <input
                        autoFocus
                        value={editing.name}
                        maxLength={40}
                        aria-label="Nome do aparelho"
                        className="w-48 bt-field bg-bg-term px-2 py-1 text-[13px] text-text-1"
                        onChange={(e) => setEditing({ id: d.id, name: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void post("/api/phone/devices/rename", { id: d.id, name: editing.name }).then((ok) => ok && setEditing(null));
                          }
                        }}
                      />
                      <SettingsBtn
                        tone="accent"
                        onClick={() => void post("/api/phone/devices/rename", { id: d.id, name: editing.name }).then((ok) => ok && setEditing(null))}
                      >
                        Salvar
                      </SettingsBtn>
                      <SettingsBtn onClick={() => setEditing(null)}>Cancelar</SettingsBtn>
                    </span>
                  ) : (
                    deviceTitle(d)
                  )
                }
                hint={
                  <>
                    Conectado em {new Date(d.created).toLocaleDateString("pt-BR")} · último uso {agoLabel(d.last_used, now)}
                    {d.last_ip ? ` · IP ${d.last_ip}` : ""}
                  </>
                }
              >
                {editing?.id !== d.id && (
                  <>
                    <SettingsBtn onClick={() => setEditing({ id: d.id, name: deviceTitle(d) })}>Renomear</SettingsBtn>
                    <SettingsBtn
                      tone="danger"
                      onClick={() => void post("/api/phone/devices/revoke", { id: d.id }).then((ok) => ok && onMessage(`${deviceTitle(d)} desconectado`))}
                    >
                      Revogar
                    </SettingsBtn>
                  </>
                )}
              </SettingsRow>
            ))}
          </SettingsGroup>
        )}
        {devices.length > 0 &&
          (confirmAll ? (
            <p className="mt-2 text-[13px] text-text-1">
              Desconectar todos os celulares agora?{" "}
              <SettingsBtn
                tone="danger"
                onClick={() => void post("/api/phone/devices/revoke-all").then((ok) => ok && setConfirmAll(false))}
              >
                Sim, revogar todos
              </SettingsBtn>{" "}
              <SettingsBtn onClick={() => setConfirmAll(false)}>Não</SettingsBtn>
            </p>
          ) : (
            <div className="mt-2">
              <SettingsBtn tone="danger" onClick={() => setConfirmAll(true)}>
                Revogar todos
              </SettingsBtn>
            </div>
          ))}
        <SettingsHint className="mt-2">Trocar a senha do celular não desconecta os aparelhos já conectados. Use Revogar.</SettingsHint>
      </div>
    </div>
  );
}
