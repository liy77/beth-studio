import { cn } from "@/lib/utils";
import claudeMark from "@/assets/claude.png";
import codexMark from "@/assets/codex.png";
import { type AgentTool, isAgentTool, TOOL_LABEL, toolInText } from "@/lib/paneIdentity";

export type { AgentTool };
export { isAgentTool, TOOL_LABEL, toolInText };

/**
 * Marcas dos agentes. Cursor/Gemini/Grok em SVG; Claude e Codex usam PNG
 * com fundo transparente (como o Cursor: só o desenho, sem placa atrás).
 * Codex segue currentColor — no tema escuro fica branco.
 */
export function ToolIcon({ tool, size = 14, className }: { tool: AgentTool; size?: number; className?: string }) {
  if (tool === "claude") {
    return (
      <img
        src={claudeMark}
        alt=""
        width={size}
        height={size}
        draggable={false}
        className={cn("bt-tool-icon shrink-0", className)}
      />
    );
  }
  if (tool === "codex") {
    // Máscara: o PNG é preto no transparente; pinta com currentColor.
    return (
      <span
        aria-hidden
        className={cn("bt-tool-icon inline-block shrink-0 bg-current", className)}
        style={{
          width: size,
          height: size,
          WebkitMaskImage: `url(${codexMark})`,
          maskImage: `url(${codexMark})`,
          WebkitMaskSize: "contain",
          maskSize: "contain",
          WebkitMaskRepeat: "no-repeat",
          maskRepeat: "no-repeat",
          WebkitMaskPosition: "center",
          maskPosition: "center",
        }}
      />
    );
  }
  const s = { width: size, height: size };
  return (
    <svg viewBox="0 0 24 24" aria-hidden style={s} className={cn("bt-tool-icon shrink-0", className)}>
      {tool === "grok" && (
        <>
          <rect width="24" height="24" rx="5" fill="#0a0a0a" />
          <polygon points="5.68,18.96 8.61,18.96 18.34,5.06 15.41,5.06" fill="#fff" />
        </>
      )}
      {tool === "cursor" && (
        <path fill="currentColor" d="M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23" />
      )}
      {tool === "gemini" && (
        <path fill="#8E75B2" d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.93 4.68-.96 2.19-2.58 3.81a12.3 12.3 0 0 1-3.81 2.55Q2.49 12 0 12q2.49 0 4.68.93 2.19.96 3.81 2.58t2.55 3.81" />
      )}
    </svg>
  );
}
