import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import type { Connection } from "@/lib/connection";
import { cn } from "@/lib/utils";
import { SideBadge, stateAfter, type SideState } from "./SideStatus";
import {
  effectiveAgentCmd,
  type AgentResumeDefault,
  type AgentResumeSettings,
  type AgentResumeView,
  type ResumeMode,
} from "@/lib/agentResume";
import type { AgentProcSettings } from "@/lib/agentProcs";
import { isMacOS } from "@/lib/windowFrame";
import {
  SettingsBtn,
  SettingsChoice,
  SettingsGroup,
  SettingsHint,
  SettingsPanel,
  SettingsRow,
  SettingsSectionLabel,
  SettingsSwitch,
} from "./settings/SettingsUI";

// Configurações > Retomar sessões (agent_resume.go).

interface SetupResult {
  ok: boolean;
  output: string;
  error?: string;
}

const MODES: { id: ResumeMode; label: string; hint: string }[] = [
  { id: "auto", label: "Retomar sozinho", hint: "Claude, Cursor, Codex, Grok, Gemini… que estavam abertos voltam sozinhos; os que você tinha encerrado ficam na faixa." },
  { id: "ask", label: "Perguntar", hint: "Depois da restauração, uma faixa mostra os terminais que tinham agente, com Retomar." },
  { id: "off", label: "Não oferecer", hint: "Os terminais voltam sem retomar o agente." },
];

function HookCard(p: { title: string; state: SideState; busy: boolean; result: SetupResult | null; onRun: (a: "add" | "remove" | "check") => void; children?: React.ReactNode }) {
  return (
    <SettingsPanel className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 text-[13px] font-semibold text-text-1">{p.title}</div>
        <SideBadge state={p.state} />
        {p.children}
      </div>
      <div className="flex flex-wrap gap-2">
        <SettingsBtn tone="accent" disabled={p.busy} onClick={() => p.onRun("add")}>
          {p.busy ? <Loader2 size={12} className="mr-1 inline animate-spin" /> : null}
          Ligar
        </SettingsBtn>
        <SettingsBtn disabled={p.busy} onClick={() => p.onRun("check")}>
          Verificar
        </SettingsBtn>
        <SettingsBtn disabled={p.busy} onClick={() => p.onRun("remove")}>
          Desligar
        </SettingsBtn>
      </div>
      {p.result && (
        <div className={cn("whitespace-pre-wrap break-words rounded bg-bg-term p-2 font-mono text-[11px]", p.result.ok ? "text-status-ok" : "text-text-2")}>
          {p.result.error ? <span className="text-status-err">{p.result.error}</span> : p.result.output}
        </div>
      )}
    </SettingsPanel>
  );
}

function AgentCmdRow(p: {
  def: AgentResumeDefault;
  resume: string;
  cont: string;
  onResume: (v: string) => void;
  onContinue: (v: string) => void;
  onReset: () => void;
  dirty: boolean;
}) {
  return (
    <SettingsPanel className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[13px] font-semibold text-text-1">{p.def.label}</div>
        <SettingsBtn disabled={!p.dirty} onClick={p.onReset}>
          Padrão
        </SettingsBtn>
      </div>
      <label className="block space-y-1">
        <span className="text-[11px] text-text-3">Com id da sessão (<code className="font-mono">{"{id}"}</code>)</span>
        <input
          className="w-full rounded border border-border bg-bg-term px-2 py-1 font-mono text-[12px]"
          value={p.resume}
          spellCheck={false}
          placeholder={p.def.resume}
          onChange={(e) => p.onResume(e.target.value)}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-[11px] text-text-3">Continuar a mais recente (sem id)</span>
        <input
          className="w-full rounded border border-border bg-bg-term px-2 py-1 font-mono text-[12px]"
          value={p.cont}
          spellCheck={false}
          placeholder={p.def.continue}
          onChange={(e) => p.onContinue(e.target.value)}
        />
      </label>
    </SettingsPanel>
  );
}

export function AgentResumeSection({ conn, onMessage }: { conn: Connection; onMessage: (m: string) => void }) {
  const [view, setView] = useState<AgentResumeView | null>(null);
  const [distro, setDistro] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, SetupResult>>({});
  const [st, setSt] = useState<Record<string, SideState>>({});
  const [err, setErr] = useState<string | null>(null);
  const [procs, setProcs] = useState<AgentProcSettings | null>(null);
  const [minutes, setMinutes] = useState("30");
  const [cmdsOpen, setCmdsOpen] = useState(false);
  const [draftResume, setDraftResume] = useState<Record<string, string>>({});
  const [draftContinue, setDraftContinue] = useState<Record<string, string>>({});

  useEffect(() => {
    conn
      .api<{ settings: AgentProcSettings }>("/api/agent-procs")
      .then((r) => {
        setProcs(r.settings);
        setMinutes(String(r.settings.minutes));
      })
      .catch(() => undefined);
  }, [conn]);

  const saveProcs = (next: AgentProcSettings) => {
    setErr(null);
    conn
      .api<{ settings: AgentProcSettings }>("/api/agent-procs/settings", next)
      .then((r) => {
        setProcs(r.settings);
        setMinutes(String(r.settings.minutes));
        onMessage("Salvo");
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  };

  const applyDrafts = (v: AgentResumeView) => {
    const resume: Record<string, string> = {};
    const cont: Record<string, string> = {};
    for (const d of v.defaults ?? []) {
      resume[d.id] = effectiveAgentCmd(v.settings.commands, d.id, d.resume);
      cont[d.id] = effectiveAgentCmd(v.settings.continue, d.id, d.continue);
    }
    setDraftResume(resume);
    setDraftContinue(cont);
  };

  const load = useCallback(() => {
    conn
      .api<AgentResumeView>("/api/agent-resume")
      .then((v) => {
        setView({ ...v, defaults: v.defaults ?? [] });
        applyDrafts(v);
        setDistro((d) => d || v.distros[0] || "");
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, [conn]);
  useEffect(load, [load]);

  const saveSettings = (next: AgentResumeSettings) => {
    setErr(null);
    conn
      .api<{ settings: AgentResumeSettings }>("/api/agent-resume/settings", next)
      .then((r) => {
        setView((v) => {
          if (!v) return v;
          const nv = { ...v, settings: r.settings };
          applyDrafts(nv);
          return nv;
        });
        onMessage("Salvo");
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  };

  const saveMode = (mode: ResumeMode) => {
    if (!view) return;
    saveSettings({ ...view.settings, mode });
  };

  const saveCommands = () => {
    if (!view) return;
    const commands: Record<string, string> = {};
    const cont: Record<string, string> = {};
    for (const d of view.defaults) {
      const r = (draftResume[d.id] ?? "").trim();
      const c = (draftContinue[d.id] ?? "").trim();
      if (r && r !== d.resume) commands[d.id] = r;
      if (c && c !== d.continue) cont[d.id] = c;
    }
    saveSettings({ ...view.settings, commands, continue: cont, command: commands.claude || "" });
  };

  const cmdsDirty = !!view?.defaults.some((d) => {
    const r = (draftResume[d.id] ?? "").trim() || d.resume;
    const c = (draftContinue[d.id] ?? "").trim() || d.continue;
    const er = effectiveAgentCmd(view.settings.commands, d.id, d.resume);
    const ec = effectiveAgentCmd(view.settings.continue, d.id, d.continue);
    return r !== er || c !== ec;
  });

  const setup = (target: "windows" | "wsl", action: "add" | "remove" | "check") => {
    const key = target === "wsl" ? `wsl:${distro}` : "windows";
    setBusy(key);
    conn
      .api<SetupResult>("/api/agent-resume/setup", { target, distro, action })
      .then((r) => {
        setResults((m) => ({ ...m, [key]: r }));
        setSt((m) => ({ ...m, [key]: stateAfter(action, r.ok, r.error) }));
      })
      .catch((e: unknown) => {
        setResults((m) => ({ ...m, [key]: { ok: false, output: "", error: e instanceof Error ? e.message : String(e) } }));
        setSt((m) => ({ ...m, [key]: "error" }));
      })
      .finally(() => setBusy(null));
  };

  const loaded = !!view;
  useEffect(() => {
    if (!loaded) return;
    let gone = false;
    const check = (key: string, target: "windows" | "wsl") => {
      setSt((m) => ({ ...m, [key]: "checking" }));
      conn
        .api<SetupResult>("/api/agent-resume/setup", { target, distro, action: "check" })
        .then((r) => {
          if (!gone) setSt((m) => ({ ...m, [key]: stateAfter("check", r.ok, r.error) }));
        })
        .catch(() => {
          if (!gone) setSt((m) => ({ ...m, [key]: "error" }));
        });
    };
    check("windows", "windows");
    if (distro) {
      const key = "wsl:" + distro;
      conn
        .api<{ running: string[] }>("/api/wsl/running")
        .then((r) => {
          if (gone) return;
          if (r.running.includes(distro)) check(key, "wsl");
          else setSt((m) => ({ ...m, [key]: "stopped" }));
        })
        .catch(() => undefined);
    }
    return () => {
      gone = true;
    };
  }, [conn, loaded, distro]);

  if (!view) {
    return <SettingsHint>{err ?? "Carregando…"}</SettingsHint>;
  }
  const mode = view.settings.mode;
  const wslKey = `wsl:${distro}`;
  const defaults = view.defaults ?? [];

  return (
    <div className="space-y-5 text-[13px] text-text-1">
      <div className="space-y-1.5">
        <SettingsHint>
          Quando o host reinicia (queda, <b>Encerrar tudo</b>, troca de versão, reboot), o Studio recria os terminais nas mesmas pastas e retoma o agente que estava em
          cada um (Claude, Cursor, Codex, Grok, Gemini, OpenCode), digitando o <code className="font-mono">resume</code>/<code className="font-mono">continue</code> da CLI.
        </SettingsHint>
        <SettingsHint>
          Cursor, Codex e os outros são anotados sozinhos pelo processo no terminal. Para o Claude, ligue o hook abaixo se quiser o id preciso da conversa (senão ele usa{" "}
          <code className="font-mono">claude --continue</code>)
          {isMacOS() ? "." : "; no WSL, só em terminais abertos depois que o host foi atualizado."}
        </SettingsHint>
      </div>

      <div className="space-y-2">
        <SettingsSectionLabel>1. Claude: registrar o id da sessão</SettingsSectionLabel>
        {isMacOS() ? (
          <HookCard title="macOS" state={st.windows ?? null} busy={busy === "windows"} result={results.windows ?? null} onRun={(a) => setup("windows", a)} />
        ) : (
          <>
            <HookCard title="Windows" state={st.windows ?? null} busy={busy === "windows"} result={results.windows ?? null} onRun={(a) => setup("windows", a)} />
            {view.distros.length > 0 ? (
              <HookCard title="WSL" state={st[wslKey] ?? null} busy={busy === wslKey} result={results[wslKey] ?? null} onRun={(a) => setup("wsl", a)}>
                {view.distros.length > 1 && (
                  <select className="rounded border border-border bg-bg-panel px-2 py-1 text-[12px]" value={distro} onChange={(e) => setDistro(e.target.value)}>
                    {view.distros.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                )}
              </HookCard>
            ) : (
              <SettingsHint>Nenhuma distro do WSL encontrada.</SettingsHint>
            )}
          </>
        )}
        <SettingsHint>
          Grava um hook (SessionStart e SessionEnd) no settings.json do Claude, com cópia de segurança. O hook só anota o id da sessão e o terminal; não lê a conversa.
        </SettingsHint>
      </div>

      <div>
        <SettingsSectionLabel>2. Depois da restauração</SettingsSectionLabel>
        <div className="bt-settings-choice-grid">
          {MODES.map((m) => (
            <SettingsChoice key={m.id} on={mode === m.id} onClick={() => saveMode(m.id)} title={m.label} sub={m.hint} />
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <SettingsSectionLabel>3. Comandos de retomar</SettingsSectionLabel>
        <SettingsHint>
          Por padrão cada agente usa o comando da própria CLI (<code className="font-mono">claude --continue</code>,{" "}
          <code className="font-mono">cursor-agent --continue</code>, <code className="font-mono">codex resume --last</code>…). Personalize só se precisar.
        </SettingsHint>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-lg border border-border bg-bg-panel px-3 py-2 text-left text-[13px] hover:bg-bg-hover"
          onClick={() => setCmdsOpen((o) => !o)}
        >
          {cmdsOpen ? <ChevronDown size={16} className="shrink-0 text-text-2" /> : <ChevronRight size={16} className="shrink-0 text-text-2" />}
          <span className="flex-1 font-medium">{cmdsOpen ? "Esconder configuração por agente" : "Configurar por agente"}</span>
          <span className="text-[11px] text-text-3">{defaults.length} agentes</span>
        </button>
        {cmdsOpen && (
          <div className="space-y-3">
            {defaults.map((d) => {
              const resume = draftResume[d.id] ?? d.resume;
              const cont = draftContinue[d.id] ?? d.continue;
              const dirty = resume.trim() !== d.resume || cont.trim() !== d.continue;
              return (
                <AgentCmdRow
                  key={d.id}
                  def={d}
                  resume={resume}
                  cont={cont}
                  dirty={dirty}
                  onResume={(v) => setDraftResume((m) => ({ ...m, [d.id]: v }))}
                  onContinue={(v) => setDraftContinue((m) => ({ ...m, [d.id]: v }))}
                  onReset={() => {
                    setDraftResume((m) => ({ ...m, [d.id]: d.resume }));
                    setDraftContinue((m) => ({ ...m, [d.id]: d.continue }));
                  }}
                />
              );
            })}
            <div className="flex flex-wrap gap-2">
              <SettingsBtn tone="accent" disabled={!cmdsDirty} onClick={saveCommands}>
                Salvar comandos
              </SettingsBtn>
              <SettingsBtn
                disabled={!cmdsDirty && !Object.keys(view.settings.commands ?? {}).length && !Object.keys(view.settings.continue ?? {}).length}
                onClick={() => {
                  const resume: Record<string, string> = {};
                  const cont: Record<string, string> = {};
                  for (const d of defaults) {
                    resume[d.id] = d.resume;
                    cont[d.id] = d.continue;
                  }
                  setDraftResume(resume);
                  setDraftContinue(cont);
                  saveSettings({ ...view.settings, commands: {}, continue: {}, command: "" });
                }}
              >
                Restaurar todos os padrões
              </SettingsBtn>
            </div>
          </div>
        )}
      </div>
      {procs && (
        <div>
          <SettingsSectionLabel>Processos deixados pelos agentes</SettingsSectionLabel>
          <SettingsHint className="mb-2">
            {isMacOS()
              ? "No Windows o Studio avisa sobre processos deixados pelos agentes (servidor de desenvolvimento, build, script). Neste Mac a lista ainda não roda."
              : "A cada minuto o Studio procura, no Windows e nas distros do WSL que já estão rodando, os processos que um agente abriu por comando (servidor de desenvolvimento, build, script) e que continuam rodando. Passado o tempo abaixo, avisa na bandeja e mostra uma faixa com Encerrar, Ignorar e Lembrar em 1 h. Nunca encerra sozinho. Os servidores MCP do Claude ficam de fora."}
          </SettingsHint>
          <SettingsGroup>
            <SettingsRow
              label="Avisar sobre processos rodando"
              hint={
                <span className="inline-flex items-center gap-1">
                  há mais de
                  <input
                    className="w-16 rounded border border-border bg-bg-term px-2 py-0.5 text-right"
                    inputMode="numeric"
                    value={minutes}
                    disabled={procs.off}
                    onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ""))}
                    onBlur={() => {
                      const n = Number(minutes);
                      if (n && n !== procs.minutes) saveProcs({ ...procs, minutes: n });
                      else setMinutes(String(procs.minutes));
                    }}
                  />
                  min
                </span>
              }
            >
              <SettingsSwitch on={!procs.off} onChange={(on) => saveProcs({ ...procs, off: !on })} label="Avisar sobre processos" />
            </SettingsRow>
          </SettingsGroup>
        </div>
      )}
      {err && <div className="text-status-err">{err}</div>}
    </div>
  );
}
