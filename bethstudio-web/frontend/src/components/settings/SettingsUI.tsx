import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Folha modal Apple-like (Nova aba, confirmações, etc.). */
export function AppSheet({
  title,
  icon,
  onClose,
  children,
  footer,
  width = "md",
  className,
  bodyClassName,
}: {
  title: string;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: "sm" | "md" | "lg" | "xl";
  className?: string;
  bodyClassName?: string;
}) {
  const w =
    width === "sm" ? "w-[min(420px,94vw)]" : width === "lg" ? "w-[min(720px,96vw)]" : width === "xl" ? "w-[min(960px,96vw)]" : "w-[min(560px,94vw)]";
  return (
    <div className="bt-modal fixed inset-0 z-[80] flex items-start justify-center bg-black/50 pt-[5vh] backdrop-blur-xl" onMouseDown={onClose}>
      <div
        className={cn("bt-sheet bt-dialog flex max-h-[88vh] flex-col overflow-hidden", w, className)}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <div className="bt-sheet__chrome">
          {icon}
          <div className="bt-sheet__title">{title}</div>
          <button type="button" className="bt-sheet__close" title="Fechar" aria-label="Fechar" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <div className={cn("bt-sheet__body", bodyClassName)}>{children}</div>
        {footer != null && <div className="bt-sheet__footer">{footer}</div>}
      </div>
    </div>
  );
}

/** Título grande no topo do painel de conteúdo (estilo System Settings). */
export function SettingsPage({
  title,
  subtitle,
  children,
  className,
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("bt-settings-page min-h-0 flex-1 overflow-y-auto", className)}>
      {(title || subtitle) && (
        <header className="bt-settings-page__head">
          {title && <h2 className="bt-settings-page__title">{title}</h2>}
          {subtitle && <p className="bt-settings-page__sub">{subtitle}</p>}
        </header>
      )}
      <div className="bt-settings-page__body">{children}</div>
    </div>
  );
}

/** Rótulo de seção acima de um grupo inset. */
export function SettingsSectionLabel({ children }: { children: ReactNode }) {
  return <h3 className="bt-settings-label">{children}</h3>;
}

export function SettingsHint({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("bt-settings-hint", className)}>{children}</p>;
}

/** Cartão agrupado (lista inset): linhas com divisores. */
export function SettingsGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("bt-settings-group", className)}>{children}</div>;
}

/** Bloco solto (cards, grelhas) com o mesmo raio do grupo. */
export function SettingsPanel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("bt-settings-panel", className)}>{children}</div>;
}

/** Linha: título à esquerda, controlo à direita. */
export function SettingsRow({
  label,
  hint,
  children,
  onClick,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  // Sempre div: o trail pode ter botões/switch (button dentro de button é inválido).
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={cn("bt-settings-row", onClick && "bt-settings-row--click", className)}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      <div className="bt-settings-row__text">
        <div className="bt-settings-row__label">{label}</div>
        {hint != null && hint !== false && <div className="bt-settings-row__hint">{hint}</div>}
      </div>
      {children != null && <div className="bt-settings-row__trail">{children}</div>}
    </div>
  );
}

/** Interruptor estilo Apple. */
export function SettingsSwitch({
  on,
  onChange,
  label,
  disabled,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={cn("bt-settings-switch", on && "bt-settings-switch--on")}
      onClick={() => onChange(!on)}
    >
      <span className="bt-settings-switch__knob" />
    </button>
  );
}

/** Botão secundário compacto. */
export function SettingsBtn({
  children,
  onClick,
  disabled,
  title,
  tone = "neutral",
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  tone?: "neutral" | "accent" | "danger";
}) {
  return (
    <button
      type="button"
      className={cn(
        "bt-settings-btn",
        tone === "accent" && "bt-settings-btn--accent",
        tone === "danger" && "bt-settings-btn--danger",
      )}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

/** Opção em grelha (tema, tamanho, visão…). */
export function SettingsChoice({
  on,
  onClick,
  title,
  sub,
  icon,
}: {
  on: boolean;
  onClick: () => void;
  title: string;
  sub?: string;
  icon?: ReactNode;
}) {
  return (
    <button type="button" className={cn("bt-settings-choice", on && "bt-settings-choice--on")} onClick={onClick} aria-pressed={on}>
      {icon && <span className="bt-settings-choice__icon">{icon}</span>}
      <span className="bt-settings-choice__title">{title}</span>
      {sub && <span className="bt-settings-choice__sub">{sub}</span>}
    </button>
  );
}

/** Grupo de navegação na sidebar. */
export function SettingsNavGroup({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="bt-settings-nav__group">
      {label && <div className="bt-settings-nav__group-label">{label}</div>}
      <div className="bt-settings-nav__group-items">{children}</div>
    </div>
  );
}

export function SettingsNavItem({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={cn("bt-settings-nav__item", active && "bt-settings-nav__item--on")} onClick={onClick}>
      <span className="bt-settings-nav__icon">{icon}</span>
      <span className="bt-settings-nav__label">{label}</span>
    </button>
  );
}
