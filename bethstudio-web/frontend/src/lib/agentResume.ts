// "Retomar sessões do Claude" depois que o host reinicia (agent_resume.go).
// Testado em tests/agentResume.test.ts.

import type { Connection } from "./connection";

/** Terminal recriado que tinha uma sessão do Claude. */
export interface ResumeOffer {
  /** id novo do terminal */
  pane_id: number;
  old_pane: number;
  title?: string;
  cwd?: string;
  agent: string;
  session_id: string;
  /** a pessoa tinha saído do Claude antes do reinício */
  ended?: boolean;
}

export interface AgentResumeEvent {
  ev: "agent_resume";
  offers: ResumeOffer[];
}

export type ResumeMode = "ask" | "auto" | "off";

export interface AgentResumeSettings {
  mode: ResumeMode;
  command: string;
}

export interface AgentResumeView {
  settings: AgentResumeSettings;
  offers: ResumeOffer[];
  tool: string;
  default_command: string;
  distros: string[];
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Texto da faixa (null = nada a oferecer). */
export function resumeBannerText(offers: ResumeOffer[]): string | null {
  if (offers.length === 0) return null;
  const open = offers.filter((o) => !o.ended).length;
  const n = offers.length;
  const head = `${n} ${plural(n, "terminal tinha", "terminais tinham")} uma sessão do Claude antes do reinício`;
  if (open === n) return `${head}. Retomar?`;
  if (open === 0) return `${head} (já ${plural(n, "encerrada", "encerradas")}). Retomar?`;
  return `${head} (${open} ${plural(open, "aberta", "abertas")}). Retomar?`;
}

/** O comando que vai ser digitado, para mostrar na faixa. */
export function resumeCommandPreview(tmpl: string, sessionId: string): string {
  return (tmpl.trim() || "claude --resume {id}").split("{id}").join(sessionId);
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
