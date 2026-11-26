import { isRemote } from "@/lib/remote";
import { FolderBrowser } from "./FolderBrowser";
import { useEffect, useState } from "react";
import { AppWindow, Bot, Box, Cable, FileText, FolderOpen, Globe, Loader2, PanelTop, Server, SquareArrowOutUpRight, SquareTerminal, Terminal, TerminalSquare } from "lucide-react";
import type { Connection } from "@/lib/connection";
import type { PaneInfo, ShellInfo } from "@/lib/types";
import { cwdFromPickedFolder, explorerStart, shellKind, spawnCwd, type ShellKind } from "@/lib/agents";
import { paneLabel } from "@/lib/panes";
import { isMacOS } from "@/lib/windowFrame";
import { displayName, isAgentTool, type AgentTool } from "@/lib/paneIdentity";
import { ToolIcon } from "./ToolIcon";
import type { ToolKind } from "./SshScreen";
import {
  AppSheet,
  SettingsBtn,
  SettingsChoice,
  SettingsGroup,
  SettingsHint,
  SettingsRow,
  SettingsSectionLabel,
} from "./settings/SettingsUI";

export const SHELL_ICON: Record<ShellKind, typeof Terminal> = {
  powershell: TerminalSquare,
  cmd: SquareTerminal,
  wsl: Terminal,
  container: Box,
  gitbash: Terminal,
  ssh: Globe,
  log: FileText,
  other: Terminal,
};

export const KIND_LABEL: Record<ShellKind, string> = {
  powershell: "PowerShell",
  cmd: "Prompt de comando",
  wsl: "WSL / Linux",
  container: "Apple Container",
  gitbash: "Git Bash",
  ssh: "Remoto",
  log: "Log",
  other: "Terminal",
};

export interface InstalledAgent {
  id: string;
  name: string;
  command: string;
  path: string;
}

export type SpawnCreatedOpts = {
  detach?: boolean;
  agentCmd?: string;
  agentName?: string;
};

interface Props {
  conn: Connection;
  shells: ShellInfo[] | null;
  focused: PaneInfo | undefined;
  readOnly: boolean;
  onEmptyTab: () => void;
  onCreated: (pane: number, tabName: string, opts?: SpawnCreatedOpts) => void;
  onOpenTools: (kind: ToolKind) => void;
  onClose: () => void;
}

/** "Novo terminal": escolhe o shell e cria o terminal no host (patch 0176). */
export function NewTerminalDialog({ conn, shells, focused, readOnly, onEmptyTab, onCreated, onOpenTools, onClose }: Props) {
  const [shell, setShell] = useState<ShellInfo | null>(null);
  const [cwd, setCwd] = useState("");
  const [cwdTouched, setCwdTouched] = useState(false);
  // Sempre dá para abrir como guia nesta janela — não depende de ter terminal em foco.
  const [where, setWhere] = useState<"focused" | "new">("focused");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [inPage, setInPage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agents, setAgents] = useState<InstalledAgent[] | null>(null);
  const [agent, setAgent] = useState<InstalledAgent | null>(null);

  useEffect(() => {
    if (!readOnly) conn.requestShells();
  }, [conn, readOnly]);

  useEffect(() => {
    if (readOnly) return;
    conn
      .api<{ agents: InstalledAgent[] }>("/api/agents/installed")
      .then((r) => setAgents(r.agents ?? []))
      .catch(() => setAgents([]));
  }, [conn, readOnly]);

  const pick = (s: ShellInfo) => {
    setShell(s);
    if (!nameTouched && !agent) setName(s.label);
    if (!cwdTouched) setCwd(focused ? spawnCwd(focused.cwd, s.id) : "");
  };

  const pickAgent = (a: InstalledAgent | null) => {
    setAgent(a);
    if (a && !nameTouched) setName(a.name);
    if (!a && shell && !nameTouched) setName(shell.label);
  };

  const browse = () => {
    if (!shell || picking) return;
    if (isRemote()) {
      setInPage(true);
      return;
    }
    setPicking(true);
    setError(null);
    const initial = explorerStart(cwd);
    const shellId = shell.id;
    conn
      .api<{ picked: boolean; path?: string }>("/api/pick-folder", initial ? { initial } : {})
      .then((r) => {
        if (r.picked && r.path) {
          setCwd(cwdFromPickedFolder(r.path, shellId));
          setCwdTouched(true);
        }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setPicking(false));
  };

  const create = () => {
    if (!shell) return;
    setBusy(true);
    setError(null);
    // Janela nova: nasce na mux do foco (se houver) e o Studio abre a janela destacada.
    const windowId = focused?.window_id;
    conn
      .spawn({
        shell_id: shell.id,
        window_id: where === "focused" || where === "new" ? windowId : undefined,
        cwd: cwd.trim() || undefined,
      })
      .then((ev) => {
        const tab =
          nameTouched && name.trim() && name.trim() !== shell.label
            ? name.trim()
            : agent
              ? agent.name
              : "";
        onCreated(ev.pane_id, tab, {
          detach: where === "new",
          agentCmd: agent?.command,
          agentName: agent?.name,
        });
        onClose();
      })
      .catch((e: Error) => {
        setBusy(false);
        setError(e.message);
      });
  };

  return (
    <>
      <AppSheet
        title="Nova aba"
        icon={<TerminalSquare size={15} className="text-accent-text" />}
        onClose={onClose}
        width="md"
        footer={
          <>
            <SettingsBtn
              onClick={() => {
                onEmptyTab();
                onClose();
              }}
              title="Cria uma aba do web sem terminal"
            >
              Aba vazia
            </SettingsBtn>
            <div className="flex-1" />
            <SettingsBtn onClick={onClose}>Cancelar</SettingsBtn>
            {!readOnly && (
              <SettingsBtn tone="accent" disabled={!shell || busy} onClick={create}>
                {busy && <Loader2 size={13} className="animate-spin" />}
                {agent ? `Abrir ${agent.name}` : "Criar terminal"}
              </SettingsBtn>
            )}
          </>
        }
      >
        {readOnly ? (
          <SettingsHint>Modo somente leitura: criar terminais está desligado.</SettingsHint>
        ) : (
          <div className="space-y-5">
            <div>
              <SettingsSectionLabel>Novo terminal no Beth Studio</SettingsSectionLabel>
              {!shells && (
                <div className="flex items-center gap-2 py-2 text-[13px] text-text-2">
                  <Loader2 size={14} className="animate-spin" /> Buscando tipos de terminal…
                </div>
              )}
              <div className="bt-settings-choice-grid">
                {(shells ?? []).map((s) => {
                  const k = shellKind(s.id);
                  const Icon = SHELL_ICON[k];
                  return (
                    <SettingsChoice
                      key={s.id}
                      on={shell?.id === s.id}
                      onClick={() => pick(s)}
                      icon={<Icon size={16} />}
                      title={s.label}
                      sub={KIND_LABEL[k]}
                    />
                  );
                })}
                <SettingsChoice
                  on={false}
                  onClick={() => {
                    onClose();
                    onOpenTools("ssh");
                  }}
                  icon={<Server size={16} />}
                  title="SSH…"
                  sub="Host remoto / SFTP"
                />
                <SettingsChoice
                  on={false}
                  onClick={() => {
                    onClose();
                    onOpenTools("serial");
                  }}
                  icon={<Cable size={16} />}
                  title="Serial…"
                  sub="Porta COM"
                />
              </div>
            </div>

            {shell && agents && agents.length > 0 && (
              <div>
                <SettingsSectionLabel>
                  <span className="inline-flex items-center gap-1.5">
                    <Bot size={13} /> Agente (opcional)
                  </span>
                </SettingsSectionLabel>
                <div className="bt-settings-choice-grid">
                  <SettingsChoice
                    on={agent === null}
                    onClick={() => pickAgent(null)}
                    icon={<Terminal size={16} />}
                    title="Só o terminal"
                    sub="sem iniciar agente"
                  />
                  {agents.map((a) => {
                    const tool = isAgentTool(a.id) ? (a.id as AgentTool) : null;
                    return (
                      <SettingsChoice
                        key={a.id}
                        on={agent?.id === a.id}
                        onClick={() => pickAgent(a)}
                        icon={tool ? <ToolIcon tool={tool} size={16} /> : <Bot size={16} />}
                        title={tool ? displayName(tool) : a.name}
                        sub={a.command}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {shell && agents === null && (
              <div className="flex items-center gap-2 py-1 text-[12px] text-text-2">
                <Loader2 size={13} className="animate-spin" /> Procurando agentes instalados…
              </div>
            )}

            {shell && (
              <>
                <div>
                  <SettingsSectionLabel>
                    <span className="inline-flex items-center gap-1.5">
                      <FolderOpen size={13} /> Pasta inicial
                    </span>
                  </SettingsSectionLabel>
                  <SettingsGroup>
                    <div className="flex gap-2 px-3 py-2.5">
                      <input
                        value={cwd}
                        maxLength={1024}
                        onChange={(e) => {
                          setCwd(e.target.value);
                          setCwdTouched(true);
                        }}
                        placeholder={
                          shellKind(shell.id) === "wsl" || shellKind(shell.id) === "container"
                            ? "/home/…"
                            : isMacOS()
                              ? "/Users/…"
                              : "C:\\…"
                        }
                        className="h-8 min-w-0 flex-1 bt-field bg-bg-term px-2 font-mono text-[12px] text-text-1 outline-none"
                      />
                      <SettingsBtn title="Escolher a pasta" disabled={picking} onClick={browse}>
                        {picking ? <Loader2 size={13} className="animate-spin" /> : <FolderOpen size={13} />}
                        Procurar…
                      </SettingsBtn>
                    </div>
                  </SettingsGroup>
                </div>

                <div>
                  <SettingsSectionLabel>
                    <span className="inline-flex items-center gap-1.5">
                      <AppWindow size={13} /> Onde abrir
                    </span>
                  </SettingsSectionLabel>
                  <SettingsHint>
                    Escolha se o terminal entra como guia nesta janela ou numa janela só dele.
                  </SettingsHint>
                  <div className="bt-settings-choice-grid bt-settings-choice-grid--where">
                    <SettingsChoice
                      on={where === "focused"}
                      onClick={() => setWhere("focused")}
                      icon={<PanelTop size={18} strokeWidth={1.75} />}
                      title="Nova guia"
                      sub={
                        focused
                          ? `nesta janela · junto de “${paneLabel(focused)}”`
                          : "nesta janela do Studio"
                      }
                    />
                    <SettingsChoice
                      on={where === "new"}
                      onClick={() => setWhere("new")}
                      icon={<SquareArrowOutUpRight size={18} strokeWidth={1.75} />}
                      title="Janela separada"
                      sub="abre fora, destacada do Studio"
                    />
                  </div>
                </div>

                <div>
                  <SettingsSectionLabel>Nome da aba</SettingsSectionLabel>
                  <SettingsGroup>
                    <SettingsRow label="Título no web">
                      <input
                        value={name}
                        maxLength={60}
                        onChange={(e) => {
                          setName(e.target.value);
                          setNameTouched(true);
                        }}
                        className="h-8 w-44 bt-field bg-bg-term px-2 text-[13px] text-text-1 outline-none"
                      />
                    </SettingsRow>
                  </SettingsGroup>
                </div>
              </>
            )}

            {error && <div className="rounded-lg bg-status-err/10 px-3 py-2 text-[12px] text-status-err">Não foi possível criar: {error}</div>}
          </div>
        )}
      </AppSheet>
      {inPage && shell && (
        <FolderBrowser
          conn={conn}
          mode="folder"
          initial={explorerStart(cwd)}
          onClose={() => setInPage(false)}
          onPick={(p) => {
            setCwd(cwdFromPickedFolder(p, shell.id));
            setCwdTouched(true);
            setInPage(false);
          }}
        />
      )}
    </>
  );
}
