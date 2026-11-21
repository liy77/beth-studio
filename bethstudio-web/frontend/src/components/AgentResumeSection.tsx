import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { Connection } from "@/lib/connection";
import { cn } from "@/lib/utils";
import type { AgentResumeView, ResumeMode } from "@/lib/agentResume";

// Configurações > Retomar sessões (agent_resume.go).

interface SetupResult {
  ok: boolean;
  output: string;
  error?: string;
}

const btn = "rounded-md border border-border bg-bg-panel px-3 py-1.5 text-[12px] text-text-1 hover:bg-bg-hover disabled:opacity-50";
const btnMain = "rounded-md border border-accent bg-accent px-3 py-1.5 text-[12px] text-white hover:bg-accent-hover disabled:opacity-50";

const MODES: { id: ResumeMode; label: string; hint: string }[] = [
  { id: "ask", label: "Perguntar", hint: "Depois da restauração, uma faixa mostra os terminais que tinham Claude, com Retomar." },
  { id: "auto", label: "Retomar sozinho", hint: "As sessões que estavam abertas voltam sozinhas; as que você tinha encerrado ficam na faixa." },
  { id: "off", label: "Não oferecer", hint: "Os terminais voltam sem o Claude, como antes." },
];

function HookCard(p: { title: string; busy: boolean; result: SetupResult | null; onRun: (a: "add" | "remove" | "check") => void; children?: React.ReactNode }) {
  return (
    <div className="space-y-2 rounded-md border border-border bg-bg-panel p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 text-[13px] font-semibold text-text-1">{p.title}</div>
        {p.children}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnMain} disabled={p.busy} onClick={() => p.onRun("add")}>
          {p.busy ? <Loader2 size={12} className="mr-1 inline animate-spin" /> : null}
          Ligar
        </button>
        <button type="button" className={btn} disabled={p.busy} onClick={() => p.onRun("check")}>
          Verificar
        </button>
        <button type="button" className={btn} disabled={p.busy} onClick={() => p.onRun("remove")}>
          Desligar
        </button>
      </div>
      {p.result && (
        <div className={cn("whitespace-pre-wrap break-words rounded bg-bg-term p-2 font-mono text-[11px]", p.result.ok ? "text-status-ok" : "text-text-2")}>
          {p.result.error ? <span className="text-status-err">{p.result.error}</span> : p.result.output}
        </div>
      )}
    </div>
  );
}

export function AgentResumeSection({ conn, onMessage }: { conn: Connection; onMessage: (m: string) => void }) {
  const [view, setView] = useState<AgentResumeView | null>(null);
  const [command, setCommand] = useState("");
  const [distro, setDistro] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, SetupResult>>({});
  const [err, setErr] = useState<string | null>(null);

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
      .then((r) => setResults((m) => ({ ...m, [key]: r })))
      .catch((e: unknown) => setResults((m) => ({ ...m, [key]: { ok: false, output: "", error: e instanceof Error ? e.message : String(e) } })))
      .finally(() => setBusy(null));
  };

  if (!view) {
    return <div className="px-5 py-4 text-[13px] text-text-2">{err ?? "Carregando…"}</div>;
  }
  const mode = view.settings.mode;
  const wslKey = `wsl:${distro}`;

  return (
    <div className="space-y-5 px-5 py-4 text-[13px] text-text-1">
      <div className="space-y-1.5 text-text-2">
        <p>
          Quando o host reinicia (queda, <b>Encerrar tudo</b>, troca de versão, reboot), o Studio recria os terminais nas mesmas pastas. Com isto ligado, ele também
          sabe qual sessão do Claude Code estava em cada terminal e digita <code className="font-mono">claude --resume &lt;id&gt;</code> no terminal certo: a conversa
          volta com o histórico.
        </p>
        <p>
          Ligue o registro abaixo em cada lado onde você usa o Claude. Vale para as sessões do Claude abertas depois de ligar; no WSL, só em terminais abertos depois
          que o host foi atualizado.
        </p>
      </div>

      <section className="space-y-2">
        <h3 className="text-[13px] font-semibold">1. Registrar as sessões</h3>
        <HookCard title="Windows" busy={busy === "windows"} result={results.windows ?? null} onRun={(a) => setup("windows", a)} />
        {view.distros.length > 0 ? (
          <HookCard title="WSL" busy={busy === wslKey} result={results[wslKey] ?? null} onRun={(a) => setup("wsl", a)}>
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
          <p className="text-text-3">Nenhuma distro do WSL encontrada.</p>
        )}
        <p className="text-[12px] text-text-3">
          Grava um hook (SessionStart e SessionEnd) no settings.json do Claude, com cópia de segurança. O hook só anota o id da sessão e o terminal; não lê a conversa.
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="text-[13px] font-semibold">2. Depois da restauração</h3>
        <div className="space-y-1.5">
          {MODES.map((m) => (
            <label key={m.id} className="flex cursor-pointer items-start gap-2">
              <input type="radio" name="resume-mode" className="mt-0.5" checked={mode === m.id} onChange={() => save(m.id, command)} />
              <span>
                <span className="font-medium">{m.label}</span>
                <span className="block text-[12px] text-text-2">{m.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-[13px] font-semibold">3. Comando de retomar</h3>
        <div className="flex gap-2">
          <input
            className="min-w-0 flex-1 rounded border border-border bg-bg-term px-2 py-1 font-mono text-[12px]"
            value={command}
            spellCheck={false}
            onChange={(e) => setCommand(e.target.value)}
          />
          <button type="button" className={btn} disabled={command === view.settings.command} onClick={() => save(mode, command)}>
            Salvar
          </button>
          <button type="button" className={btn} onClick={() => save(mode, view.default_command)}>
            Padrão
          </button>
        </div>
        <p className="text-[12px] text-text-3">
          <code className="font-mono">{"{id}"}</code> vira o id da sessão. Ex.: <code className="font-mono">claude --dangerously-skip-permissions --resume {"{id}"}</code>
        </p>
      </section>
      {err && <div className="text-status-err">{err}</div>}
    </div>
  );
}
