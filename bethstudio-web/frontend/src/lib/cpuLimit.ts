// "Limitar CPU dos terminais" (cpu_limit.go). Testado em tests/cpuLimit.test.ts.

import type { Connection } from "./connection";

export interface CpuLimit {
  /** 0 = sem limite */
  percent: number;
  /** unix (s); 0 = até remover */
  until: number;
  wsl: boolean;
  restore?: boolean;
  last_percent?: number;
  last_minutes?: number;
  /** núcleos lógicos do PC */
  total: number;
  /** núcleos que o WSL usa com o limite */
  wsl_cores: number;
  applied_win: number;
  applied_wsl: number;
  error?: string;
}

export interface CpuLimitEvent {
  ev: "cpu_limit";
  limit: CpuLimit;
}

export const DURATIONS: { minutes: number; label: string }[] = [
  { minutes: 30, label: "30 min" },
  { minutes: 60, label: "1 h" },
  { minutes: 120, label: "2 h" },
  { minutes: 240, label: "4 h" },
  { minutes: 0, label: "Até eu remover" },
];

function hhmm(unix: number): string {
  const d = new Date(unix * 1000);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Texto curto do botão: "CPU 70% · até 23:15" / "CPU 70%". */
export function chipText(l: CpuLimit): string {
  if (!l.percent) return "";
  return l.until ? `CPU ${l.percent}% · até ${hhmm(l.until)}` : `CPU ${l.percent}%`;
}

/** "70% da CPU ≈ 17 de 24 núcleos" */
export function percentHint(percent: number, total: number): string {
  const n = Math.max(1, Math.round((percent * total) / 100));
  return `${percent}% da CPU ≈ ${n} de ${total} núcleos`;
}

/** Descrição do estado atual para o popover. `host` força o rótulo (testes). */
export function statusText(l: CpuLimit, host?: "mac" | "windows"): string {
  if (!l.percent) return l.restore ? "Voltando ao normal…" : "Sem limite: os terminais usam a CPU toda.";
  const when = l.until ? `até ${hhmm(l.until)}` : "até você remover";
  const parts = [`No máximo ${l.percent}% da CPU, ${when}.`];
  const n = l.applied_win;
  const proc = `${n} ${n === 1 ? "processo" : "processos"}`;
  const mac =
    host === "mac" ||
    (host !== "windows" &&
      typeof navigator !== "undefined" &&
      (/Mac|iPhone|iPad/.test(navigator.platform || "") || /Mac OS X/.test(navigator.userAgent || "")));
  if (mac) {
    parts.push(`${proc} no Mac.`);
  } else {
    const where = [`${proc} no Windows`];
    if (l.wsl) where.push(`${l.applied_wsl} no WSL (${l.wsl_cores} núcleos)`);
    parts.push(where.join(", ") + ".");
  }
  return parts.join(" ");
}

export async function setCpuLimit(conn: Connection, percent: number, minutes: number, wsl: boolean): Promise<void> {
  const r = await conn.api<{ ok: boolean; error?: string }>("/api/cpu-limit/set", { percent, minutes, wsl });
  if (!r.ok) throw new Error(r.error || "Não deu certo.");
}

export async function cpuLimitOff(conn: Connection): Promise<void> {
  const r = await conn.api<{ ok: boolean; error?: string }>("/api/cpu-limit/off", {});
  if (!r.ok) throw new Error(r.error || "Não deu certo.");
}
