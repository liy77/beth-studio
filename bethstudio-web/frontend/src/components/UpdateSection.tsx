import { useState } from "react";
import type { Connection } from "@/lib/connection";
import { isRemote } from "@/lib/remote";
import { safeReleaseURL, updateButtons, type UpdateCheck } from "@/lib/updateOffer";
import {
  SettingsBtn,
  SettingsGroup,
  SettingsHint,
  SettingsPanel,
  SettingsRow,
  SettingsSectionLabel,
} from "./settings/SettingsUI";

interface Prepared {
  path: string;
  version: string;
  message: string;
}

/** Verificar atualização em Configurações > Sobre. A página do celular não usa isto. */
export function UpdateSection({ conn, readOnly }: { conn: Connection; readOnly: boolean }) {
  const remote = isRemote();
  const [busy, setBusy] = useState<"check" | "ui" | "setup" | "open" | null>(null);
  const [result, setResult] = useState<UpdateCheck | null>(null);
  const [error, setError] = useState("");
  const [installed, setInstalled] = useState("");
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [confirmLaunch, setConfirmLaunch] = useState(false);

  const buttons = result ? updateButtons(result, !readOnly && !remote) : null;
  const notes = safeReleaseURL(result?.html_url);

  async function check() {
    setBusy("check");
    setError("");
    setInstalled("");
    setPrepared(null);
    setConfirmLaunch(false);
    try {
      setResult(await conn.api<UpdateCheck>("/api/update/check"));
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : "Não foi possível verificar.");
    } finally {
      setBusy(null);
    }
  }

  async function applyUI() {
    setBusy("ui");
    setError("");
    try {
      const res = await conn.api<{ message: string }>("/api/update/apply-ui", { confirm: true });
      setInstalled(res.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível instalar a interface.");
    } finally {
      setBusy(null);
    }
  }

  async function prepare() {
    setBusy("setup");
    setError("");
    setConfirmLaunch(false);
    try {
      setPrepared(await conn.api<Prepared>("/api/update/prepare-setup", { confirm: true }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível baixar o instalador.");
    } finally {
      setBusy(null);
    }
  }

  async function openSetup(action: "launch" | "reveal") {
    setBusy("open");
    setError("");
    try {
      await conn.api("/api/update/open-setup", { confirm: true, action });
      setConfirmLaunch(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível abrir o instalador.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <SettingsSectionLabel>Atualização</SettingsSectionLabel>
      <SettingsHint className="mb-2">Consulta o último release publicado. Nada é instalado sem você escolher.</SettingsHint>
      <SettingsGroup>
        <SettingsRow label="Verificar">
          <SettingsBtn disabled={busy !== null} onClick={() => void check()}>
            {busy === "check" ? "Verificando…" : "Verificar atualização"}
          </SettingsBtn>
        </SettingsRow>
      </SettingsGroup>
      {error && (
        <p className="mt-2 text-[12px] text-status-err" role="alert">
          {error}
        </p>
      )}
      {result && (
        <SettingsPanel className="mt-3 space-y-2">
          <p className="text-[12px] text-text-1" role="status">
            {result.message}
          </p>
          {notes && (
            <a className="text-[12px] text-accent-text underline" href={notes} target="_blank" rel="noreferrer">
              Ver o release
            </a>
          )}
          {result.update && result.ui_already && (
            <p className="text-[12px] text-text-2">A interface desta versão já está instalada.</p>
          )}
          {buttons?.showUI && (
            <div className="space-y-1">
              <p className="text-[12px] text-text-2">A interface é trocada sem reiniciar o Studio nem o host.</p>
              <SettingsBtn tone="accent" disabled={busy !== null} onClick={() => void applyUI()}>
                {busy === "ui" ? "Instalando a interface…" : "Instalar só a interface"}
              </SettingsBtn>
            </div>
          )}
          {installed && (
            <div className="space-y-1">
              <p className="text-[12px] text-text-1" role="status">
                {installed}
              </p>
              <SettingsBtn tone="accent" onClick={() => window.location.reload()}>
                Recarregar interface
              </SettingsBtn>
            </div>
          )}
          {buttons?.showSetup && (
            <div className="space-y-1">
              <p className="text-[12px] text-text-2">
                Atualizar o Studio e o host baixa o instalador. Abrir o instalador não encerra nada sozinho. A opção Encerrar tudo vem desmarcada. Se você marcá-la, o host encerra e os terminais abertos serão perdidos.
              </p>
              <SettingsBtn disabled={busy !== null} onClick={() => void prepare()}>
                {busy === "setup" ? "Baixando o instalador…" : "Baixar o instalador (Studio e host)"}
              </SettingsBtn>
            </div>
          )}
          {prepared && (
            <div className="space-y-1">
              <p className="text-[12px] text-text-1" role="status">
                {prepared.message}
              </p>
              <p className="break-all font-mono text-[11px] text-text-2">{prepared.path}</p>
              <div className="flex flex-wrap gap-2">
                <SettingsBtn disabled={busy !== null} onClick={() => void openSetup("reveal")}>
                  Mostrar na pasta
                </SettingsBtn>
                <SettingsBtn tone="accent" disabled={busy !== null} onClick={() => setConfirmLaunch(true)}>
                  Abrir o instalador
                </SettingsBtn>
              </div>
              {confirmLaunch && (
                <div className="space-y-2 bt-field bg-bg-card p-2">
                  <p className="text-[12px] text-text-1">
                    Abrir o instalador agora? O Beth Studio não marca Encerrar tudo. Se você marcar essa opção no instalador, o host encerra e os terminais abertos serão perdidos.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <SettingsBtn tone="accent" disabled={busy !== null} onClick={() => void openSetup("launch")}>
                      {busy === "open" ? "Abrindo…" : "Abrir o instalador"}
                    </SettingsBtn>
                    <SettingsBtn onClick={() => setConfirmLaunch(false)}>Agora não</SettingsBtn>
                  </div>
                </div>
              )}
            </div>
          )}
        </SettingsPanel>
      )}
    </div>
  );
}
