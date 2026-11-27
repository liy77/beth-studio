import type { MouseEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  label: string;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  active?: boolean;
  children: ReactNode;
  className?: string;
}

/** Botão só com ícone; o texto vai no tooltip (`data-tip`) e no aria-label. */
export function IconButton({ label, onClick, disabled, active, children, className }: Props) {
  return (
    <button
      type="button"
      data-tip={label}
      aria-label={label}
      aria-pressed={active || undefined}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      className={cn(
        "bt-glass bt-icon-btn inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-text-2",
        // Desabilitado também mostra hover leve (o tooltip explica o porquê).
        "disabled:cursor-default disabled:text-text-3",
        active ? "bt-icon-btn--on bg-accent-soft text-accent-text" : "hover:bg-bg-hover hover:text-text-1",
        className,
      )}
    >
      {children}
    </button>
  );
}
