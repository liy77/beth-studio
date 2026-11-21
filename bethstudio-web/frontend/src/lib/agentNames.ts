// Nome e cor da etiqueta do agente de cada terminal (agent_ident.go).

import type { PaneInfo } from "./types";

export interface AgentLabel {
  label: string;
  /** cor de fundo da etiqueta (texto branco) */
  color: string;
}

export const AGENT_LABELS: Record<string, AgentLabel> = {
  claude: { label: "Claude", color: "#c96442" },
  codex: { label: "Codex", color: "#10a37f" },
  opencode: { label: "OpenCode", color: "#4b5563" },
  cursor: { label: "Cursor", color: "#2563eb" },
  grok: { label: "Grok", color: "#111827" },
  gemini: { label: "Gemini", color: "#7c3aed" },
};

export function agentLabel(name: string | undefined): AgentLabel | null {
  return (name && AGENT_LABELS[name]) || null;
}

/** Junta o agente de cada terminal na lista (o evento pane_agents vem à parte). */
export function withAgentNames(panes: PaneInfo[] | null, agents: Record<string, string>): PaneInfo[] | null {
  if (!panes) return panes;
  let changed = false;
  const out = panes.map((p) => {
    const a = agents[String(p.pane_id)];
    if (p.agent_name === a) return p;
    changed = true;
    return { ...p, agent_name: a };
  });
  return changed ? out : panes;
}
