import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  Cable,
  CircleDollarSign,
  Eraser,
  Database,
  FolderOpen,
  History,
  Info,
  Keyboard,
  KeyRound,
  LayoutGrid,
  Mic,
  Monitor,
  PanelLeft,
  Settings,
  Smartphone,
  TerminalSquare,
  X,
} from "lucide-react";
import type { Connection } from "@/lib/connection";
import type { PaneInfo, SettingsEvent } from "@/lib/types";
import { setDefault, type Catalog } from "@/lib/appearance";
import type { UIColors } from "@/lib/uiTheme";
import type { NotifyPrefs } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { KIND_LABEL, moveItem, visibleKindOrder } from "@/lib/kinds";
import { GeneralAppearance } from "./GeneralAppearance";
import { ShortcutsSection } from "./ShortcutsSection";
import { WslInitSettings } from "./WslInitSettings";
import { VoiceSettingsDialog } from "./VoiceSettingsDialog";
import { AIUsageSection } from "./AIUsage";
import { DbAssistSettings } from "./DbAssistSettings";
import { PhoneRemoteSection } from "./PhoneRemoteSection";
import { PhoneDevicesSection } from "./PhoneDevicesSection";
import { VpsInstallWizard } from "./VpsInstallWizard";
import { RemoteStudioSection } from "./RemoteStudioSection";
import { UpdateSection } from "./UpdateSection";
import { PerformanceSection } from "./PerformanceSection";
import { TempCleanSection } from "./TempCleanSection";
import { PonteSection } from "./PonteSection";
import { LaunchersSection } from "./LaunchersSection";
import { AgentResumeSection } from "./AgentResumeSection";
import { isRemote } from "@/lib/remote";
import { isMacOS } from "@/lib/windowFrame";
import { normalizeUILocale, t, type UILocale } from "@/lib/uiLocale";
import {
  SettingsBtn,
  SettingsChoice,
  SettingsGroup,
  SettingsHint,
  SettingsNavGroup,
  SettingsNavItem,
  SettingsPage,
  SettingsRow,
  SettingsSectionLabel,
  SettingsSwitch,
} from "./settings/SettingsUI";

export type SettingsSection =
  | "aparencia"
  | "atalhos"
  | "terminais"
  | "celular"
  | "voz"
  | "provedores"
  | "ponte"
  | "retomar"
  | "temp"
  | "banco"
  | "uso"
  | "barra"
  | "sobre";

interface SidebarPrefs {
  collapsed: boolean;
  width: number;
  view?: string;
  kinds?: string[];
  kind_order?: string[];
  split_by_kind?: boolean;
}

interface Props {
  conn: Connection;
  catalog: Catalog;
  settings: SettingsEvent | null;
  panes: PaneInfo[] | null;
  defaultThemeId: string;
  onPreviewUI: (c: UIColors | null) => void;
  onMessage: (m: string) => void;
  notify: NotifyPrefs;
  onNotify: (p: NotifyPrefs) => void;
  sidebar: SidebarPrefs;
  saveSidebar: (p: Partial<SidebarPrefs>) => void;
  initialSection?: SettingsSection;
  onClose: () => void;
}

type NavItem = { id: SettingsSection; labelKey: string; icon: ReactNode; macHide?: boolean };

function settingsNavGroups(locale: UILocale) {
  const mac = isMacOS();
  const groups: { labelKey: string; items: NavItem[] }[] = [
    {
      labelKey: "settings.group.general",
      items: [
        { id: "aparencia", labelKey: "settings.nav.aparencia", icon: <Monitor size={14} /> },
        { id: "atalhos", labelKey: "settings.nav.atalhos", icon: <Keyboard size={14} /> },
        { id: "barra", labelKey: "settings.nav.barra", icon: <PanelLeft size={14} /> },
      ],
    },
    {
      labelKey: "settings.group.terminals",
      items: [
        { id: "terminais", labelKey: "settings.nav.terminais", icon: <TerminalSquare size={14} /> },
        { id: "retomar", labelKey: "settings.nav.retomar", icon: <History size={14} /> },
        { id: "temp", labelKey: "settings.nav.temp", icon: <Eraser size={14} /> },
      ],
    },
    {
      labelKey: "settings.group.ai",
      items: [
        { id: "voz", labelKey: "settings.nav.voz", icon: <Mic size={14} /> },
        { id: "provedores", labelKey: "settings.nav.provedores", icon: <KeyRound size={14} /> },
        { id: "ponte", labelKey: "settings.nav.ponte", icon: <Cable size={14} />, macHide: true },
        { id: "uso", labelKey: "settings.nav.uso", icon: <CircleDollarSign size={14} /> },
      ],
    },
    {
      labelKey: "settings.group.connections",
      items: [
        { id: "celular", labelKey: "settings.nav.celular", icon: <Smartphone size={14} /> },
        { id: "banco", labelKey: "settings.nav.banco", icon: <Database size={14} /> },
      ],
    },
    {
      labelKey: "settings.group.about",
      items: [{ id: "sobre", labelKey: "settings.nav.sobre", icon: <Info size={14} /> }],
    },
  ];
  return groups
    .map((g) => ({
      label: t(locale, g.labelKey),
      items: g.items
        .filter((n) => !(mac && n.macHide))
        .map((n) => ({ ...n, label: t(locale, n.labelKey) })),
    }))
    .filter((g) => g.items.length > 0);
}

function pageTitle(locale: UILocale, sec: SettingsSection): { title: string; subtitle?: string } {
  return {
    title: t(locale, `settings.page.${sec}.title`),
    subtitle: t(locale, `settings.page.${sec}.sub`),
  };
}

/** Tela unica de Configuracoes, com navegacao lateral por secoes. */
export function SettingsDialog(p: Props) {
  const [sec, setSec] = useState<SettingsSection>(p.initialSection ?? "aparencia");
  const locale = normalizeUILocale(p.settings?.ui_locale);
  const page = pageTitle(locale, sec);
  const common = {
    conn: p.conn,
    catalog: p.catalog,
    settings: p.settings,
    panes: p.panes,
    defaultThemeId: p.defaultThemeId,
    onPreviewUI: p.onPreviewUI,
    onClose: p.onClose,
    onMessage: p.onMessage,
    notify: p.notify,
    onNotify: p.onNotify,
    embedded: true as const,
  };
  const remoteOnly = (msg: string) => (
    <SettingsPage title={page.title} subtitle={page.subtitle}>
      <SettingsGroup>
        <SettingsRow label={msg} />
      </SettingsGroup>
    </SettingsPage>
  );

  return (
    <div className="bt-modal fixed inset-0 z-[80] flex items-start justify-center bg-black/50 pt-[5vh] backdrop-blur-xl" onMouseDown={p.onClose}>
      <div
        className="bt-settings bt-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t(locale, "settings.title")}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && p.onClose()}
      >
        <div className="bt-settings__chrome">
          <Settings size={15} className="text-accent-text" />
          <div className="bt-settings__chrome-title">{t(locale, "settings.title")}</div>
          <button type="button" className="bt-settings__chrome-close" title={t(locale, "settings.close")} aria-label={t(locale, "settings.close")} onClick={p.onClose}>
            <X size={15} />
          </button>
        </div>
        <div className="bt-settings__body">
          <nav className="bt-settings-nav" aria-label={t(locale, "settings.nav")}>
            {settingsNavGroups(locale).map((g) => (
              <SettingsNavGroup key={g.label} label={g.label}>
                {g.items.map((n) => (
                  <SettingsNavItem key={n.id} active={sec === n.id} icon={n.icon} label={n.label} onClick={() => setSec(n.id)} />
                ))}
              </SettingsNavGroup>
            ))}
          </nav>
          <div className="bt-settings__content">
            {sec === "aparencia" && <GeneralAppearance {...common} sections={["ui", "terminals"]} pageTitle={page.title} pageSubtitle={page.subtitle} />}
            {sec === "atalhos" && (
              <SettingsPage title={page.title} subtitle={page.subtitle}>
                <ShortcutsSection conn={p.conn} saved={p.settings?.shortcuts} onMessage={p.onMessage} />
              </SettingsPage>
            )}
            {sec === "terminais" && (
              <SettingsPage title={page.title} subtitle={page.subtitle}>
                <TerminalsSection conn={p.conn} settings={p.settings} onMessage={p.onMessage} locale={locale} />
                <PerformanceSection conn={p.conn} onMessage={p.onMessage} />
                {!isRemote() && !isMacOS() && <WslInitSettings conn={p.conn} onMessage={p.onMessage} />}                {!isRemote() && isMacOS() && (
                  <div>
                    <SettingsSectionLabel>Apple Container</SettingsSectionLabel>
                    <SettingsGroup>
                      <SettingsRow
                        label="Containers no Mac"
                        hint={
                          <>
                            No Mac o Studio usa{" "}
                            <a className="underline" href="https://github.com/apple/container" target="_blank" rel="noreferrer">
                              Apple Container
                            </a>{" "}
                            no lugar do WSL. Em Novo terminal aparecem os containers em execução ou as imagens. Se o serviço estiver parado:{" "}
                            <code>container system start</code>.
                          </>
                        }
                      />
                    </SettingsGroup>
                  </div>
                )}
                <GeneralAppearance {...common} sections={["notify"]} />
              </SettingsPage>
            )}
            {sec === "celular" &&
              (isRemote() ? (
                remoteOnly("O celular e o acesso remoto se configuram só no Studio do PC.")
              ) : (
                <SettingsPage title={page.title} subtitle={page.subtitle}>
                  <PhoneRemoteSection conn={p.conn} onMessage={p.onMessage} />
                  <LaunchersSection conn={p.conn} onMessage={p.onMessage} />
                  <VpsInstallWizard conn={p.conn} onMessage={p.onMessage} />
                  <PhoneDevicesSection conn={p.conn} onMessage={p.onMessage} />
                  <RemoteStudioSection conn={p.conn} onMessage={p.onMessage} />
                </SettingsPage>
              ))}
            {sec === "voz" && (
              <SettingsPage title={page.title} subtitle={page.subtitle}>
                <VoiceSettingsDialog key="voz" conn={p.conn} onClose={p.onClose} initialTab="voz" embedded />
              </SettingsPage>
            )}
            {sec === "provedores" && (
              <SettingsPage title={page.title} subtitle={page.subtitle}>
                <VoiceSettingsDialog key="prov" conn={p.conn} onClose={p.onClose} initialTab="provedores" embedded />
              </SettingsPage>
            )}
            {sec === "ponte" &&
              (isRemote() ? (
                remoteOnly("A ponte de agentes se configura só no Studio do PC.")
              ) : (
                <SettingsPage title={page.title} subtitle={page.subtitle}>
                  <PonteSection conn={p.conn} onMessage={p.onMessage} />
                </SettingsPage>
              ))}
            {sec === "retomar" &&
              (isRemote() ? (
                remoteOnly("Retomar sessões se configura só no Studio do PC.")
              ) : (
                <SettingsPage title={page.title} subtitle={page.subtitle}>
                  <AgentResumeSection conn={p.conn} onMessage={p.onMessage} />
                </SettingsPage>
              ))}
            {sec === "temp" &&
              (isRemote() ? (
                remoteOnly("A limpeza de temporários se configura só no Studio do PC.")
              ) : (
                <SettingsPage title={page.title} subtitle={page.subtitle}>
                  <TempCleanSection conn={p.conn} onMessage={p.onMessage} />
                </SettingsPage>
              ))}
            {sec === "banco" && (
              <SettingsPage title={page.title} subtitle={page.subtitle}>
                <DbAssistSettings conn={p.conn} onProviders={() => setSec("provedores")} />
              </SettingsPage>
            )}
            {sec === "uso" && (
              <SettingsPage title={page.title} subtitle={page.subtitle}>
                <AIUsageSection conn={p.conn} onMessage={p.onMessage} />
              </SettingsPage>
            )}
            {sec === "barra" && <SidebarSection sidebar={p.sidebar} save={p.saveSidebar} title={page.title} subtitle={page.subtitle} />}
            {sec === "sobre" && <AboutSection conn={p.conn} onMessage={p.onMessage} title={page.title} subtitle={page.subtitle} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function TerminalsSection({
  conn,
  settings,
  onMessage,
  locale,
}: {
  conn: Connection;
  settings: SettingsEvent | null;
  onMessage: (m: string) => void;
  locale: UILocale;
}) {
  const mode = settings?.default?.size_mode || "fit";
  const pastePreview = settings?.paste_image_preview !== false;
  const sideEditor = !!settings?.files_side_editor;
  const followAgent = !!settings?.follow_agent_file;
  const termImages = settings?.term_inline_images !== false;
  const set = (m: "fit" | "host") =>
    void setDefault(conn, { size_mode: m })
      .then(() => onMessage("Padrão de tamanho salvo"))
      .catch((e: Error) => onMessage(`Erro: ${e.message}`));
  const setPastePreview = (on: boolean) =>
    void conn
      .api<SettingsEvent>("/api/settings/paste-image-preview", { enabled: on })
      .then((s) => {
        conn.setSettings(s);
        onMessage(on ? "Pré-visualização de imagem ligada" : "Pré-visualização de imagem desligada");
      })
      .catch((e: Error) => onMessage(`Erro: ${e.message}`));
  const setSideEditor = (on: boolean) =>
    void conn
      .api<SettingsEvent>("/api/settings/files-side-editor", { enabled: on })
      .then((s) => {
        conn.setSettings(s);
        onMessage(on ? "Editor na lateral ligado" : "Editor na lateral desligado");
      })
      .catch((e: Error) => onMessage(`Erro: ${e.message}`));
  const setFollowAgent = (on: boolean) =>
    void conn
      .api<SettingsEvent>("/api/settings/follow-agent-file", { enabled: on })
      .then((s) => {
        conn.setSettings(s);
        onMessage(on ? "Seguir arquivo do agente ligado" : "Seguir arquivo do agente desligado");
      })
      .catch((e: Error) => onMessage(`Erro: ${e.message}`));
  const setTermImages = (on: boolean) =>
    void conn
      .api<SettingsEvent>("/api/settings/term-inline-images", { enabled: on })
      .then((s) => {
        conn.setSettings(s);
        onMessage(on ? t(locale, "settings.term.images.on") : t(locale, "settings.term.images.off"));
      })
      .catch((e: Error) => onMessage(`Erro: ${e.message}`));
  return (
    <>
      <div>
        <SettingsSectionLabel>Arquivos na lateral</SettingsSectionLabel>
        <SettingsGroup>
          <SettingsRow
            label="Abrir na lateral (com a pasta)"
            hint="Em vez de trocar a árvore pelo arquivo, mantém a pasta em cima e o editor embaixo — como no Cursor. Win e Mac."
          >
            <SettingsSwitch on={sideEditor} onChange={setSideEditor} label="Abrir arquivo na lateral com a pasta" />
          </SettingsRow>
          <SettingsRow
            label="Seguir o que o agente edita"
            hint="Quando o agente grava ou abre um arquivo, o painel lateral acompanha e atualiza sozinho enquanto o disco muda."
          >
            <SettingsSwitch on={followAgent} onChange={setFollowAgent} label="Seguir arquivo editado pelo agente" />
          </SettingsRow>
        </SettingsGroup>
      </div>
      <div>
        <SettingsSectionLabel>{t(locale, "settings.term.images")}</SettingsSectionLabel>
        <SettingsGroup>
          <SettingsRow label={t(locale, "settings.term.images.label")} hint={t(locale, "settings.term.images.hint")}>
            <SettingsSwitch on={termImages} onChange={setTermImages} label={t(locale, "settings.term.images.label")} />
          </SettingsRow>
        </SettingsGroup>
      </div>
      <div>
        <SettingsSectionLabel>Colar imagem</SettingsSectionLabel>
        <SettingsGroup>
          <SettingsRow
            label="Pré-visualizar antes de colar"
            hint="Ao colar ou soltar uma imagem no terminal, mostra a miniatura — como no Ghostty. Desligado cola na hora."
          >
            <SettingsSwitch on={pastePreview} onChange={setPastePreview} label="Pré-visualizar imagem antes de colar" />
          </SettingsRow>
        </SettingsGroup>
      </div>
      <div>
        <SettingsSectionLabel>Tamanho dos terminais</SettingsSectionLabel>
        <SettingsHint className="mb-2">
          Padrão para terminais sozinhos na aba. Cada um pode mudar no cabeçalho. Em split usam “Igual ao Beth Studio”.
        </SettingsHint>
        <div className="bt-settings-choice-grid">
          <SettingsChoice
            on={mode === "fit"}
            onClick={() => set("fit")}
            title="Ajustar à janela"
            sub="muda colunas×linhas para caber aqui"
          />
          <SettingsChoice
            on={mode === "host"}
            onClick={() => set("host")}
            title="Igual ao Beth Studio"
            sub="mantém o tamanho da GUI; a fonte se ajusta"
          />
        </div>
      </div>
      <div>
        <SettingsSectionLabel>Fonte e clique</SettingsSectionLabel>
        <SettingsGroup>
          <SettingsRow
            label="Fonte"
            hint="Em “Igual ao Beth Studio” a fonte é automática, a não ser que você fixe o tamanho com A−/A+. Família e tamanho padrão ficam em Aparência."
          />
          <SettingsRow
            label="Clique num terminal"
            hint="Se já está numa aba, abre essa aba; senão abre numa aba nova. Fechar uma aba nunca encerra o terminal."
          />
        </SettingsGroup>
      </div>
    </>
  );
}

function SidebarSection({
  sidebar,
  save,
  title,
  subtitle,
}: {
  sidebar: SidebarPrefs;
  save: (p: Partial<SidebarPrefs>) => void;
  title: string;
  subtitle?: string;
}) {
  const view = sidebar.view || "web";
  return (
    <SettingsPage title={title} subtitle={subtitle}>
      <div>
        <SettingsSectionLabel>Visão</SettingsSectionLabel>
        <div className="bt-settings-choice-grid">
          <SettingsChoice on={view === "web"} onClick={() => save({ view: "web" })} title="Minha organização" sub="abas do web e não organizados" />
          <SettingsChoice on={view === "host"} onClick={() => save({ view: "host" })} title="Como no Beth Studio" sub="janela → aba → terminal" />
          <SettingsChoice
            on={view === "kind"}
            onClick={() => save({ view: "kind" })}
            title="Por tipo"
            sub={isMacOS() ? "Container, SSH…" : "WSL, PowerShell, cmd…"}
          />
          <SettingsChoice on={view === "folder"} onClick={() => save({ view: "folder" })} title="Por pasta" sub="agrupa pela pasta atual" />
        </div>
      </div>
      <div>
        <SettingsSectionLabel>Filtro por tipo</SettingsSectionLabel>
        <SettingsGroup>
          <SettingsRow
            label={sidebar.kinds?.length ? `Filtrando: ${sidebar.kinds.join(", ")}` : "Sem filtro"}
            hint="Os filtros ficam nos botões abaixo da busca, na barra lateral."
          >
            {!!sidebar.kinds?.length && <SettingsBtn onClick={() => save({ kinds: [] })}>Limpar</SettingsBtn>}
          </SettingsRow>
        </SettingsGroup>
      </div>
      <div>
        <SettingsSectionLabel>Tipos de terminal</SettingsSectionLabel>
        <SettingsGroup>
          <SettingsRow label="Separar por tipo" hint="Em “Não organizados” e “Como no Beth Studio”.">
            <SettingsSwitch
              on={sidebar.split_by_kind !== false}
              onChange={(on) => save({ split_by_kind: on })}
              label="Separar por tipo"
            />
          </SettingsRow>
        </SettingsGroup>
        <SettingsHint className="mb-2 mt-3">Ordem dos grupos (listas, “Por tipo” e filtros):</SettingsHint>
        <SettingsGroup>
          {visibleKindOrder(sidebar.kind_order).map((k, i, all) => (
            <SettingsRow key={k} label={`${i + 1}. ${KIND_LABEL[k]}`}>
              <SettingsBtn disabled={i === 0} title="Subir" onClick={() => save({ kind_order: moveItem(all, i, i - 1) })}>
                <ArrowUp size={13} />
              </SettingsBtn>
              <SettingsBtn
                disabled={i === all.length - 1}
                title="Descer"
                onClick={() => save({ kind_order: moveItem(all, i, i + 1) })}
              >
                <ArrowDown size={13} />
              </SettingsBtn>
            </SettingsRow>
          ))}
        </SettingsGroup>
        {!!sidebar.kind_order?.length && (
          <div className="mt-2">
            <SettingsBtn onClick={() => save({ kind_order: [] })}>Ordem padrão</SettingsBtn>
          </div>
        )}
      </div>
      <div>
        <SettingsSectionLabel>Largura e visibilidade</SettingsSectionLabel>
        <SettingsGroup>
          <SettingsRow label="Barra lateral">
            <SettingsBtn onClick={() => save({ collapsed: !sidebar.collapsed })}>
              {sidebar.collapsed ? "Mostrar" : "Recolher"}
            </SettingsBtn>
            <SettingsBtn onClick={() => save({ width: 288 })}>Padrão ({sidebar.width}px)</SettingsBtn>
          </SettingsRow>
        </SettingsGroup>
        <SettingsHint>Arraste a borda direita da barra para mudar a largura.</SettingsHint>
      </div>
    </SettingsPage>
  );
}

interface About {
  version: string;
  api_level?: number;
  ui_version?: string;
  ui_override?: boolean;
  ui_note?: string;
  build_time: string;
  exe: string;
  exe_time: string;
  go: string;
  bridge_exe: string;
  bridge_time: string;
  data_dir: string;
  read_only: boolean;
  files: { id: string; label: string; path: string; exists: boolean }[];
}

function AboutSection({
  conn,
  onMessage,
  title,
  subtitle,
}: {
  conn: Connection;
  onMessage: (m: string) => void;
  title: string;
  subtitle?: string;
}) {
  const [a, setA] = useState<About | null>(null);
  useEffect(() => {
    void conn
      .api<About>("/api/about")
      .then(setA)
      .catch((e: Error) => onMessage(`Erro: ${e.message}`));
  }, [conn, onMessage]);
  const fmt = (t: string) => (t ? new Date(t).toLocaleString("pt-BR") : "—");
  if (!a) {
    return (
      <SettingsPage title={title} subtitle={subtitle}>
        <SettingsHint>Carregando…</SettingsHint>
      </SettingsPage>
    );
  }
  return (
    <SettingsPage title={title} subtitle={subtitle}>
      <div>
        <SettingsSectionLabel>Beth Studio</SettingsSectionLabel>
        <SettingsGroup>
          <SettingsRow
            label="Versão"
            hint={`${a.version} · build ${fmt(a.build_time || a.exe_time)} · ${a.go}${a.read_only ? " · somente leitura" : ""}`}
          />
          <SettingsRow
            label="Interface"
            hint={
              <>
                {a.ui_override ? `pacote ${a.ui_version}` : "embutida no executável"}
                {a.api_level != null && ` · API ${a.api_level}`}
                {a.ui_note && ` · pacote ignorado: ${a.ui_note}`}
              </>
            }
          >
            <SettingsBtn title="Recarrega a interface sem reiniciar o Studio" onClick={() => window.location.reload()}>
              Recarregar
            </SettingsBtn>
          </SettingsRow>
          <SettingsRow label="Executável" hint={<span className="break-all font-mono text-[11px]">{a.exe}</span>} />
          <SettingsRow
            label="Ponte"
            hint={
              <span className="break-all font-mono text-[11px]">
                {a.bridge_exe} · {fmt(a.bridge_time)}
              </span>
            }
          />
          <SettingsRow label="Pasta de dados" hint={<span className="break-all font-mono text-[11px]">{a.data_dir}</span>} />
        </SettingsGroup>
      </div>
      <UpdateSection conn={conn} readOnly={a.read_only} />
      <div>
        <SettingsSectionLabel>Arquivos</SettingsSectionLabel>
        <SettingsGroup>
          {a.files.map((f) => (
            <SettingsRow
              key={f.id}
              label={f.label}
              hint={
                <span className={cn("break-all font-mono text-[11px]", f.exists ? "" : "opacity-70")} title={f.path}>
                  {f.path}
                  {!f.exists && " (ainda não existe)"}
                </span>
              }
            >
              <SettingsBtn onClick={() => void conn.api("/api/about", { id: f.id }).catch((e: Error) => onMessage(`Erro: ${e.message}`))}>
                <FolderOpen size={12} /> Abrir
              </SettingsBtn>
            </SettingsRow>
          ))}
        </SettingsGroup>
      </div>
      <p className="flex items-center gap-1.5 text-[11px] text-text-3">
        <LayoutGrid size={11} />{" "}
        {isMacOS()
          ? "Chaves de API ficam guardadas só neste Mac e nunca aparecem aqui."
          : "Chaves de API ficam cifradas pelo Windows (DPAPI) e nunca aparecem aqui."}
      </p>
    </SettingsPage>
  );
}
