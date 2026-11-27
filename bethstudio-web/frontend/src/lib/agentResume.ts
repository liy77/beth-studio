// Retomar sessões de agentes depois que o host reinicia (agent_resume.go).
// Testado em tests/agentResume.test.ts.

import type { Connection } from "./connection";

/** Terminal recriado que tinha uma sessão de agente. */
export interface ResumeOffer {
  /** id novo do terminal */
  pane_id: number;
  old_pane: number;
  title?: string;
  cwd?: string;
  agent: string;
  session_id: string;
  /** a pessoa tinha saído do agente antes do reinício (só Claude/hook) */
  ended?: boolean;
}

export interface AgentResumeEvent {
  ev: "agent_resume";
  offers: ResumeOffer[];
}

export type ResumeMode = "ask" | "auto" | "off";

export interface AgentResumeSettings {
  mode: ResumeMode;
  /** Override por agente do comando com {id}. */
  commands?: Record<string, string>;
  /** Override por agente do continue/`--last`. */
  continue?: Record<string, string>;
  /** Legado: só Claude; o servidor migra para commands.claude. */
  command?: string;
}

export interface AgentResumeDefault {
  id: string;
  label: string;
  resume: string;
  continue: string;
}

export interface AgentResumeView {
  settings: AgentResumeSettings;
  offers: ResumeOffer[];
  tool: string;
  default_command: string;
  defaults: AgentResumeDefault[];
  distros: string[];
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const AGENT_LABEL: Record<string, string> = {
  claude: "Claude",
  cursor: "Cursor",
  codex: "Codex",
  grok: "Grok",
  gemini: "Gemini",
  opencode: "OpenCode",
};

export function agentResumeLabel(agent: string): string {
  return AGENT_LABEL[agent] || agent || "agente";
}

/** Texto da faixa (null = nada a oferecer). */
export function resumeBannerText(offers: ResumeOffer[]): string | null {
  if (offers.length === 0) return null;
  const open = offers.filter((o) => !o.ended).length;
  const n = offers.length;
  const agents = [...new Set(offers.map((o) => o.agent).filter(Boolean))];
  const who =
    agents.length === 1
      ? `uma sessão do ${agentResumeLabel(agents[0])}`
      : "sessões de agentes";
  const head = `${n} ${plural(n, "terminal tinha", "terminais tinham")} ${who} antes do reinício`;
  if (open === n) return `${head}. Retomar?`;
  if (open === 0) return `${head} (já ${plural(n, "encerrada", "encerradas")}). Retomar?`;
  return `${head} (${open} ${plural(open, "aberta", "abertas")}). Retomar?`;
}

/** O comando que vai ser digitado, para mostrar na faixa. */
export function resumeCommandPreview(tmpl: string, sessionId: string): string {
  return (tmpl.trim() || "claude --resume {id}").split("{id}").join(sessionId);
}

/** Valor efetivo: override do usuário ou padrão da CLI. */
export function effectiveAgentCmd(
  overrides: Record<string, string> | undefined,
  agentId: string,
  fallback: string,
): string {
  const o = overrides?.[agentId]?.trim();
  return o || fallback;
}

export async function runResume(conn: Connection, paneIds: number[] | "all"): Promise<void> {
  const r = await conn.api<{ ok: boolean; error?: string }>(
    "/api/agent-resume/run",
    paneIds === "all" ? { all: true } : { pane_ids: paneIds },
  );
  if (!r.ok) throw new Error(r.error || "Não consegui retomar.");
}

export async function dismissResume(conn: Connection, paneIds: number[] | "all"): Promise<void> {
  await conn.api("/api/agent-resume/dismiss", paneIds === "all" ? { all: true } : { pane_ids: paneIds });
}
