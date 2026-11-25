import { useEffect } from "react";
import { isMacTitlebar } from "@/lib/windowFrame";

export interface GlassTipProps {
  title: string;
  desc?: string;
  /** Retângulo do alvo (viewport), em px — o NSPopover ancora nele. */
  ax: number;
  ay: number;
  aw: number;
  ah: number;
  /** Preferir o balão acima do alvo (o AppKit vira sozinho se não couber). */
  above?: boolean;
}

/** Balão de tooltip no macOS: o mesmo NSPopover do menu de contexto. */
export function GlassTip({ title, desc, ax, ay, aw, ah, above }: GlassTipProps) {
  useEffect(() => {
    if (!isMacTitlebar()) return;
    const w = window as unknown as { webkit?: { messageHandlers?: { bethTip?: { postMessage: (v: string) => void } } } };
    w.webkit?.messageHandlers?.bethTip?.postMessage(
      JSON.stringify({
        title,
        desc: desc || "",
        ax: Math.round(ax),
        ay: Math.round(ay),
        aw: Math.round(Math.max(aw, 2)),
        ah: Math.round(Math.max(ah, 2)),
        above: above ? 1 : 0,
      }),
    );
    return () => {
      w.webkit?.messageHandlers?.bethTip?.postMessage("[]");
    };
  }, [title, desc, ax, ay, aw, ah, above]);
  return null;
}
