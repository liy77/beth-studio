// "Processos deixados pelos agentes" (agent_procs.go). Testado em tests/agentProcs.test.ts.

import type { Connection } from "./connection";

export interface AgentProc {
  id: string;
  side: "windows" | "wsl";
  distro?: string;
  pid: number;
  name: string;
  cmd?: string;
  /** unix (s) */
  started: number;
  /** núcleos, média do último minuto */
  cpu: number;
  /** bytes */
  mem: number;
  agent_cwd?: string;
  /** o agente que abriu já saiu */
  orphan?: boolean;
}

export interface AgentProcsEvent {
  ev: "agent_procs";
  items: AgentProc[];
}

export interface AgentProcSettings {
  off?: boolean;
  minutes: number;
}

/** "há 3 h 20 min", "há 45 min", "há 2 d 4 h" */
export function runningFor(started: number, nowMs = Date.now()): string {
  const min = Math.max(0, Math.floor((nowMs / 1000 - started) / 60));
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return min % 60 ? `há ${h} h ${min % 60} min` : `há ${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `há ${d} d ${h % 24} h` : `há ${d} d`;
}

export function memText(bytes: number): string {
  if (bytes >= 1 << 30) return `${(bytes / (1 << 30)).toFixed(1).replace(".", ",")} GB`;
  return `${Math.max(1, Math.round(bytes / (1 << 20)))} MB`;
}

/** Pasta do agente, curta: os dois últimos níveis. */
export function shortFolder(p?: string): string {
  if (!p) return "";
  const parts = p.split(/[\\/]+/).filter(Boolean);
  return parts.length <= 2 ? p : "…/" + parts.slice(-2).join("/");
}

export function procsBannerText(items: AgentProc[]): string | null {
  if (items.length === 0) return null;
  if (items.length === 1) {
    const p = items[0];
    return `Um processo deixado por um agente está rodando ${runningFor(p.started)}: ${p.name}.`;
  }
  return `${items.length} processos deixados pelos agentes estão rodando há muito tempo.`;
}

export type ProcAction = "kill" | "ignore" | "snooze";

export async function actOnProc(conn: Connection, id: string, action: ProcAction): Promise<void> {
  const r = await conn.api<{ ok: boolean; error?: string }>(`/api/agent-procs/${action}`, { id });
  if (!r.ok) throw new Error(r.error || "Não deu certo.");
}
