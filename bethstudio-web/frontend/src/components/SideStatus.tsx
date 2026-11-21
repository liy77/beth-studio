import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Estado de um registro no Claude de um lado (Windows / WSL), sempre visível no
// cartão: o cartão confere sozinho ao abrir, em vez de só depois de "Verificar".

export type SideState = "checking" | "on" | "off" | "error" | "stopped" | null;

/** Estado depois de uma ação: add ok = ligado, remove ok = desligado, check = o que respondeu. */
export function stateAfter(action: string, ok: boolean, error?: string): SideState {
  if (error) return "error";
  const a = action.replace(/^hook-/, "");
  if (a === "add") return ok ? "on" : "error";
  if (a === "remove") return "off"; // a ponte responde ok=false ao remover; o erro, se houve, já voltou acima
  return ok ? "on" : "off";
}

export function SideBadge({ state }: { state: SideState }) {
  if (!state) return null;
  const map: Record<Exclude<SideState, null>, { text: string; cls: string }> = {
    checking: { text: "Verificando…", cls: "bg-bg-hover text-text-2" },
    on: { text: "● Ligado", cls: "bg-status-ok/15 text-status-ok" },
    off: { text: "○ Desligado", cls: "bg-bg-hover text-text-2" },
    error: { text: "Erro ao verificar", cls: "bg-status-err/15 text-status-err" },
    stopped: { text: "WSL parado: clique em Verificar", cls: "bg-bg-hover text-text-3" },
  };
  const m = map[state];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold", m.cls)}>
      {state === "checking" && <Loader2 size={11} className="animate-spin" />}
      {m.text}
    </span>
  );
}
