import { useEffect, useState } from "react";
import type { Connection } from "@/lib/connection";
import { ModelPicker } from "./ModelPicker";
import { loadVoice, saveVoice, type ProviderView, type VoiceSettings } from "@/lib/voice";
import {
  SettingsBtn,
  SettingsGroup,
  SettingsHint,
  SettingsRow,
  SettingsSectionLabel,
  SettingsSwitch,
} from "./settings/SettingsUI";

/** Configurações → Banco de dados: modelo do assistente de SQL. */
export function DbAssistSettings({ conn, onProviders }: { conn: Connection; onProviders: () => void }) {
  const [v, setV] = useState<VoiceSettings | null>(null);
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [err, setErr] = useState("");
  const [picker, setPicker] = useState(false);

  useEffect(() => {
    void loadVoice(conn)
      .then((s) => {
        setV(s.settings);
        setProviders(s.providers);
      })
      .catch((e: Error) => setErr(e.message));
  }, [conn]);

  const patch = (p: Partial<VoiceSettings>) => {
    if (!v) return;
    const next = { ...v, ...p };
    setV(next);
    setErr("");
    void saveVoice(conn, next).catch((e: Error) => setErr(e.message));
  };

  if (!v) return <SettingsHint>{err || "Carregando…"}</SettingsHint>;
  const llm = providers.filter((p) => p.llm);
  const cur = llm.find((p) => p.id === (v.db_assist_provider || ""));
  const models = cur?.prefs.llm_models?.length ? cur.prefs.llm_models : cur?.llm_models ?? [];

  return (
    <div className="space-y-5">
      <div>
        <SettingsSectionLabel>Assistente de banco</SettingsSectionLabel>
        <SettingsHint className="mb-2">
          No editor SQL, a varinha corrige a sintaxe e o ponto de interrogação responde dúvidas sobre o banco da conexão aberta (MySQL, PostgreSQL, SQL Server ou
          SQLite). O modelo daqui é só desse assistente. A correção de voz continua com o modelo de Voz e IA. Vai o SQL e os nomes de tabelas e colunas — não as
          linhas da tabela. A chave é a mesma cadastrada em Provedores de IA.
        </SettingsHint>
        <SettingsGroup>
          <SettingsRow
            label="Usar um modelo no Banco de dados"
            hint="Desligado, os botões do editor avisam para escolher um modelo aqui."
          >
            <SettingsSwitch
              on={!!v.db_assist_enabled}
              onChange={(on) => patch({ db_assist_enabled: on })}
              label="Usar um modelo no Banco de dados"
            />
          </SettingsRow>
          <SettingsRow label="Provedor">
            <select
              className="h-8 min-w-0 flex-1 bt-field bg-bg-term px-2 text-text-1"
              value={v.db_assist_provider || ""}
              onChange={(e) => {
                const id = e.target.value;
                const p = llm.find((x) => x.id === id);
                const first = p?.prefs.llm_models?.[0] || p?.llm_models?.[0] || "";
                patch({ db_assist_provider: id, db_assist_model: first });
              }}
            >
              <option value="">escolher…</option>
              {llm.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.configured ? "" : " (sem chave)"}
                </option>
              ))}
            </select>
          </SettingsRow>
          <SettingsRow label="Modelo">
            <input
              list="db-assist-models"
              value={v.db_assist_model || ""}
              onChange={(e) => patch({ db_assist_model: e.target.value })}
              placeholder={models[0] || "id do modelo"}
              className="h-8 min-w-0 flex-1 bt-field bg-bg-term px-2 font-mono text-[12px] text-text-1 outline-none"
            />
            <datalist id="db-assist-models">
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <SettingsBtn disabled={!cur} onClick={() => setPicker(true)}>
              Escolher com preços…
            </SettingsBtn>
          </SettingsRow>
        </SettingsGroup>
        {cur && !cur.configured && (
          <button type="button" className="mt-2 self-start text-[12px] text-accent-text hover:underline" onClick={onProviders}>
            Cadastrar a chave de {cur.name} em Provedores de IA
          </button>
        )}
        {err && <p className="mt-2 text-[12px] text-status-err">{err}</p>}
      </div>
      {picker && cur && (
        <ModelPicker
          conn={conn}
          provider={cur.id}
          providerName={cur.name}
          func="llm"
          canSTT={cur.stt}
          canLLM={cur.llm}
          recommended={models}
          current={{ llm: v.db_assist_model }}
          onPick={(_fn, id) => {
            patch({ db_assist_model: id });
            setPicker(false);
          }}
          onClose={() => setPicker(false)}
        />
      )}
    </div>
  );
}
