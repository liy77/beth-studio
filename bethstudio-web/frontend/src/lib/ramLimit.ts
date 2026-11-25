// "Limitar RAM dos terminais" (ram_limit.go). Testado em tests/ramLimit.test.ts.

import type { Connection } from "./connection";

export interface RamLimit {
  /** 0 = sem limite */
  percent: number;
  /** unix (s); 0 = até remover */
  until: number;
  restore?: boolean;
  last_percent?: number;
  last_minutes?: number;
  total_bytes: number;
  limit_bytes: number;
  used_bytes: number;
  applied: number;
  frozen?: boolean;
  error?: string;
}

export interface RamLimitEvent {
  ev: "ram_limit";
  limit: RamLimit;
}

export const RAM_DURATIONS: { minutes: number; label: string }[] = [
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

export function formatBytes(n: number): string {
  if (!n || n < 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  const digits = i >= 3 ? 1 : i === 0 ? 0 : 0;
  return `${v.toFixed(digits).replace(/\.0$/, "")} ${u[i]}`;
}

/** Texto curto do botão: "RAM 40% · até 23:15". */
export function ramChipText(l: RamLimit): string {
  if (!l.percent) return "";
  return l.until ? `RAM ${l.percent}% · até ${hhmm(l.until)}` : `RAM ${l.percent}%`;
}

/** "40% da RAM ≈ 6 GB de 16 GB" */
export function ramPercentHint(percent: number, totalBytes: number): string {
  const lim = Math.max(256 << 20, Math.round((percent * totalBytes) / 100));
  return `${percent}% da RAM ≈ ${formatBytes(lim)} de ${formatBytes(totalBytes)}`;
}

export function ramStatusText(l: RamLimit, host?: "mac" | "windows"): string {
  if (!l.percent) return l.restore ? "Voltando ao normal…" : "Sem limite: os terminais usam a RAM toda.";
  const when = l.until ? `até ${hhmm(l.until)}` : "até você remover";
  const parts = [`No máximo ${l.percent}% da RAM (${formatBytes(l.limit_bytes || 0)}), ${when}.`];
  const n = l.applied;
  const proc = `${n} ${n === 1 ? "processo" : "processos"}`;
  const mac =
    host === "mac" ||
    (host !== "windows" &&
      typeof navigator !== "undefined" &&
      (/Mac|iPhone|iPad/.test(navigator.platform || "") || /Mac OS X/.test(navigator.userAgent || "")));
  parts.push(`${proc} ${mac ? "no Mac" : "no Windows"}; uso agora ${formatBytes(l.used_bytes || 0)}.`);
  if (l.frozen) parts.push("Acima do teto: terminais pausados até a memória cair ou você subir o limite.");
  return parts.join(" ");
}

export async function setRamLimit(conn: Connection, percent: number, minutes: number): Promise<void> {
  const r = await conn.api<{ ok: boolean; error?: string }>("/api/ram-limit/set", { percent, minutes });
  if (!r.ok) throw new Error(r.error || "Não deu certo.");
}

export async function ramLimitOff(conn: Connection): Promise<void> {
  const r = await conn.api<{ ok: boolean; error?: string }>("/api/ram-limit/off", {});
  if (!r.ok) throw new Error(r.error || "Não deu certo.");
}
