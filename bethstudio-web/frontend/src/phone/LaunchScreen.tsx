import { useEffect, useState } from "react";
import { ChevronLeft, Pencil, Plus, Trash2 } from "lucide-react";
import type { Connection } from "@/lib/connection";
import { folderLabel, launchFolders, type LaunchFolder, type Launcher, type ShellOption } from "@/lib/launchers";

// "Abrir agente": os atalhos do PC (launchers.go). O celular escolhe o atalho
// e a pasta; o comando é o do atalho.

interface View {
  launchers: Launcher[];
  can_edit: boolean;
  shells: ShellOption[];
  folders: LaunchFolder[];
}

interface Props {
  conn: Connection;
  onBack: () => void;
  /** terminal aberto: o app vai para ele assim que aparecer na lista */
  onLaunched: (paneId: number) => void;
}

export function LaunchScreen({ conn, onBack, onLaunched }: Props) {
  const [view, setView] = useState<View | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pick, setPick] = useState<Launcher | null>(null);
  const [cwd, setCwd] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Launcher[] | null>(null);

  const load = () => {
    conn
      .api<View>("/api/phone/launchers")
      .then((v) => {
        setView(v);
        setErr(null);
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  };
  useEffect(load, [conn]);

  const choose = (l: Launcher) => {
    setPick(l);
    setCwd(launchFolders(l, view?.folders ?? [])[0] ?? "");
    setErr(null);
  };

  const launch = () => {
    if (!pick) return;
    setBusy(true);
    setErr(null);
    conn
      .api<{ ok: boolean; pane_id?: number; error?: string }>("/api/phone/launch", { id: pick.id, cwd })
      .then((r) => {
        if (!r.ok || r.pane_id == null) throw new Error(r.error || "Não consegui abrir.");
        navigator.vibrate?.(10);
        onLaunched(r.pane_id);
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const saveEdits = () => {
    if (!editing) return;
    setBusy(true);
    setErr(null);
    conn
      .api<{ launchers: Launcher[] }>("/api/phone/launchers", { launchers: editing })
      .then(() => {
        setEditing(null);
        load();
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const header = (title: string, back: () => void, extra?: React.ReactNode) => (
    <header className="p-top">
      <button type="button" className="p-icon-btn" aria-label="Voltar" onClick={back}>
        <ChevronLeft size={26} />
      </button>
      <div className="p-top__main">
        <div className="p-title">{title}</div>
        <div className="p-sub">Abre um terminal novo no PC</div>
      </div>
      {extra}
    </header>
  );

  // --- editar (só com a chave ligada no PC) ---
  if (editing) {
    const shells = view?.shells ?? [];
    const set = (i: number, patch: Partial<Launcher>) => setEditing((xs) => xs!.map((x, j) => (j === i ? { ...x, ...patch } : x)));
    return (
      <>
        {header("Editar atalhos", () => setEditing(null))}
        <div className="p-scroll p-launch">
          {editing.map((l, i) => (
            <div key={l.id || `n${i}`} className="p-launch-edit">
              <input className="p-field" placeholder="Nome" value={l.name} onChange={(e) => set(i, { name: e.target.value })} />
              <select className="p-field" value={l.shell_id} onChange={(e) => set(i, { shell_id: e.target.value })}>
                {!shells.some((s) => s.id === l.shell_id) && <option value={l.shell_id}>{l.shell_id}</option>}
                {shells.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              <input
                className="p-field p-field--mono"
                placeholder="Pasta"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                value={l.cwd ?? ""}
                onChange={(e) => set(i, { cwd: e.target.value })}
              />
              <input
                className="p-field p-field--mono"
                placeholder="Comando (ex.: claude)"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                value={l.command ?? ""}
                onChange={(e) => set(i, { command: e.target.value })}
              />
              <button type="button" className="p-link" onClick={() => setEditing((xs) => xs!.filter((_, j) => j !== i))}>
                <Trash2 size={16} /> Apagar
              </button>
            </div>
          ))}
          <button
            type="button"
            className="p-launch-btn p-launch-btn--ghost"
            onClick={() => setEditing((xs) => [...xs!, { id: "", name: "", shell_id: shells.find((s) => s.id.startsWith("wsl."))?.id ?? shells[0]?.id ?? "pwsh", cwd: "", command: "claude" }])}
          >
            <Plus size={18} /> Novo atalho
          </button>
          {err && <p className="p-note p-note--err">{err}</p>}
          <button type="button" className="p-launch-btn" disabled={busy} onClick={saveEdits}>
            Salvar
          </button>
        </div>
      </>
    );
  }

  // --- escolher a pasta e abrir ---
  if (pick) {
    const folders = launchFolders(pick, view?.folders ?? []);
    return (
      <>
        {header(pick.name, () => setPick(null))}
        <div className="p-scroll p-launch">
          {pick.command && (
            <p className="p-launch-cmd">
              Vai rodar <code>{pick.command}</code>
            </p>
          )}
          <div className="p-group">Pasta</div>
          {folders.length === 0 ? (
            <p className="p-note">Abre na pasta inicial do shell.</p>
          ) : (
            folders.map((f) => (
              <button key={f} type="button" className={f === cwd ? "p-item p-item--on" : "p-item"} onClick={() => setCwd(f)}>
                <span className="p-item__body">
                  <span className="p-item__name" style={{ display: "block" }}>
                    {folderLabel(f)}
                  </span>
                  <span className="p-item__meta" style={{ display: "block" }}>
                    {f === pick.cwd ? `${f} · pasta do atalho` : f}
                  </span>
                </span>
              </button>
            ))
          )}
          {err && <p className="p-note p-note--err">{err}</p>}
          <button type="button" className="p-launch-btn" disabled={busy} onClick={launch}>
            {busy ? "Abrindo…" : "Abrir"}
          </button>
        </div>
      </>
    );
  }

  // --- lista de atalhos ---
  return (
    <>
      {header(
        "Abrir agente",
        onBack,
        view?.can_edit ? (
          <button type="button" className="p-icon-btn" aria-label="Editar atalhos" onClick={() => setEditing(view.launchers.map((l) => ({ ...l })))}>
            <Pencil size={20} />
          </button>
        ) : undefined,
      )}
      <div className="p-scroll">
        {!view && <p className="p-note">{err ?? "Carregando…"}</p>}
        {view && view.launchers.length === 0 && (
          <div className="p-empty">
            <strong>Nenhum atalho ainda</strong>
            {view.can_edit ? "Toque no lápis para criar um." : "Crie os atalhos no Beth Studio do PC, em Configurações → Celular."}
          </div>
        )}
        {view?.launchers.map((l) => (
          <button key={l.id} type="button" className="p-item" onClick={() => choose(l)}>
            <span className="p-item__body">
              <span className="p-item__name" style={{ display: "block" }}>
                {l.name}
              </span>
              <span className="p-item__meta" style={{ display: "block" }}>
                {[l.command || "só o terminal", l.cwd ? folderLabel(l.cwd) : "", view.shells.find((s) => s.id === l.shell_id)?.label ?? l.shell_id]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
          </button>
        ))}
        {err && view && <p className="p-note p-note--err">{err}</p>}
      </div>
    </>
  );
}
