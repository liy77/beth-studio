import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { Connection } from "@/lib/connection";
import { cn } from "@/lib/utils";
import { SideBadge, stateAfter, type SideState } from "./SideStatus";
import type { AgentResumeView, ResumeMode } from "@/lib/agentResume";
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
  { id: "ask", label: "Perguntar", hint: "Depois da restauração, uma faixa mostra os terminais que tinham Claude, com Retomar." },
  { id: "auto", label: "Retomar sozinho", hint: "As sessões que estavam abertas voltam sozinhas; as que você tinha encerrado ficam na faixa." },
  { id: "off", label: "Não oferecer", hint: "Os terminais voltam sem o Claude, como antes." },
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

export function AgentResumeSection({ conn, onMessage }: { conn: Connection; onMessage: (m: string) => void }) {
  const [view, setView] = useState<AgentResumeView | null>(null);
  const [command, setCommand] = useState("");
  const [distro, setDistro] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, SetupResult>>({});
  const [st, setSt] = useState<Record<string, SideState>>({});
  const [err, setErr] = useState<string | null>(null);
  const [procs, setProcs] = useState<AgentProcSettings | null>(null);
  const [minutes, setMinutes] = useState("30");

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

  const load = useCallback(() => {
    conn
      .api<AgentResumeView>("/api/agent-resume")
      .then((v) => {
        setView(v);
        setCommand(v.settings.command);
        setDistro((d) => d || v.distros[0] || "");
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, [conn]);
  useEffect(load, [load]);

  const save = (mode: ResumeMode, cmd: string) => {
    setErr(null);
    conn
      .api<{ settings: AgentResumeView["settings"] }>("/api/agent-resume/settings", { mode, command: cmd })
      .then((r) => {
        setView((v) => (v ? { ...v, settings: r.settings } : v));
        setCommand(r.settings.command);
        onMessage("Salvo");
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  };

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

  // Ao abrir (e ao trocar a distro): confere sozinho. WSL só se já estiver rodando.
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

  return (
    <div className="space-y-5 text-[13px] text-text-1">
      <div className="space-y-1.5">
        <SettingsHint>
          Quando o host reinicia (queda, <b>Encerrar tudo</b>, troca de versão, reboot), o Studio recria os terminais nas mesmas pastas. Com isto ligado, ele também
          sabe qual sessão do Claude Code estava em cada terminal e digita <code className="font-mono">claude --resume &lt;id&gt;</code> no terminal certo: a conversa
          volta com o histórico.
        </SettingsHint>
        <SettingsHint>
          Ligue o registro abaixo onde você usa o Claude. Vale para as sessões do Claude abertas depois de ligar
          {isMacOS() ? "." : "; no WSL, só em terminais abertos depois que o host foi atualizado."}
        </SettingsHint>
      </div>

      <div className="space-y-2">
        <SettingsSectionLabel>1. Registrar as sessões</SettingsSectionLabel>
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
            <SettingsChoice key={m.id} on={mode === m.id} onClick={() => save(m.id, command)} title={m.label} sub={m.hint} />
          ))}
        </div>
      </div>

      <div>
        <SettingsSectionLabel>3. Comando de retomar</SettingsSectionLabel>
        <SettingsGroup>
          <SettingsRow label="Comando">
            <input
              className="min-w-0 flex-1 rounded border border-border bg-bg-term px-2 py-1 font-mono text-[12px]"
              value={command}
              spellCheck={false}
              onChange={(e) => setCommand(e.target.value)}
            />
            <SettingsBtn disabled={command === view.settings.command} onClick={() => save(mode, command)}>
              Salvar
            </SettingsBtn>
            <SettingsBtn onClick={() => save(mode, view.default_command)}>Padrão</SettingsBtn>
          </SettingsRow>
        </SettingsGroup>
        <SettingsHint className="mt-2">
          <code className="font-mono">{"{id}"}</code> vira o id da sessão. Ex.: <code className="font-mono">claude --dangerously-skip-permissions --resume {"{id}"}</code>
        </SettingsHint>
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
