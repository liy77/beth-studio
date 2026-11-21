import { agentLabel } from "@/lib/agentNames";

/** Etiqueta do agente que roda no terminal (Claude, Codex…), pelo processo. */
export function AgentChip({ name }: { name?: string }) {
  const a = agentLabel(name);
  if (!a) return null;
  return (
    <span className="p-agent-chip" style={{ background: a.color }}>
      {a.label}
    </span>
  );
}
