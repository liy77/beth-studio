import { agentLabel } from "@/lib/agentNames";
import { Bot, Box, Cable, GitBranch, Globe, HelpCircle, SquareTerminal, Terminal, TerminalSquare } from "lucide-react";
import type { PaneInfo } from "@/lib/types";
import { kindGroup } from "@/lib/kinds";
import { cn } from "@/lib/utils";

/** Icone do tipo do terminal (WSL, PowerShell, cmd...). */
export function KindIcon({
  pane,
  size = 13,
  className,
}: {
  pane: Pick<PaneInfo, "kind" | "kind_label" | "kind_source">;
  size?: number;
  className?: string;
}) {
  const g = kindGroup(pane);
  const Icon =
    g === "wsl" || g === "container"
      ? Terminal
      : g === "powershell"
        ? TerminalSquare
        : g === "cmd"
          ? SquareTerminal
          : g === "gitbash"
            ? GitBranch
            : g === "ssh" || pane.kind === "mobaxterm"
              ? Globe
              : g === "serial"
                ? Cable
                : g === "other"
                  ? Box
                  : HelpCircle;
  const color =
    g === "wsl" || g === "container"
      ? "text-status-ok"
      : g === "powershell"
        ? "text-accent-text"
        : g === "cmd"
          ? "text-text-2"
          : g === "gitbash"
            ? "text-status-warn"
            : g === "ssh"
              ? "text-accent-text"
              : g === "serial"
                ? "text-status-warn"
                : "text-text-3";
  const src = pane.kind_source === "heuristic" ? " (estimado)" : "";
  return (
    <span className={cn("inline-flex shrink-0", color, className)} title={`${pane.kind_label || "Desconhecido"}${src}`}>
      <Icon size={size} />
    </span>
  );
}

/** Etiqueta do agente: o nome (Claude, Codex…) quando se sabe pelo processo; senão o robô. */
export function AgentBadge({ size = 12, name }: { size?: number; name?: string }) {
  const a = agentLabel(name);
  if (a) {
    return (
      <span
        className="inline-flex shrink-0 items-center rounded px-1.5 py-px text-[10px] font-semibold leading-4 text-white"
        style={{ background: a.color }}
        title={`${a.label} rodando neste terminal`}
      >
        {a.label}
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 text-accent-text" title="Agente (Claude Code etc.)">
      <Bot size={size} />
    </span>
  );
}
