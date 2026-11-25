import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { Connection } from "@/lib/connection";
import { suggestedLaunchers, type Launcher, type ShellOption } from "@/lib/launchers";

// Configurações > Celular > Atalhos de agentes (launchers.go).

const btn = "rounded-md border border-border bg-bg-panel px-3 py-1.5 text-[12px] text-text-1 hover:bg-bg-hover disabled:opacity-50";
const btnMain = "rounded-md border border-accent bg-accent px-3 py-1.5 text-[12px] text-white hover:bg-accent-hover disabled:opacity-50";
const input = "min-w-0 rounded border border-border bg-bg-term px-2 py-1 text-[12px]";

interface View {
  launchers: Launcher[];
  phone_edit: boolean;
  shells: ShellOption[];
}

export function LaunchersSection({ conn, onMessage }: { conn: Connection; onMessage: (m: string) => void }) {
  const [view, setView] = useState<View | null>(null);
  const [items, setItems] = useState<Launcher[]>([]);
  const [phoneEdit, setPhoneEdit] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    conn
      .api<View>("/api/launchers")
      .then((v) => {
        setView(v);
        setItems(v.launchers);
        setPhoneEdit(v.phone_edit);
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, [conn]);

  const change = (i: number, patch: Partial<Launcher>) => {
    setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
    setDirty(true);
  };

  const save = (next: Launcher[], edit: boolean) => {
    setErr(null);
    conn
      .api<{ launchers: Launcher[]; phone_edit: boolean }>("/api/launchers", { launchers: next, phone_edit: edit })
      .then((r) => {
        setItems(r.launchers);
        setPhoneEdit(r.phone_edit);
        setDirty(false);
        onMessage("Atalhos salvos");
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  };

  if (!view) return <div className="px-5 py-4 text-[13px] text-text-2">{err ?? "Carregando os atalhos…"}</div>;
  const shells = view.shells;
  const firstShell =
    shells.find((s) => s.id.startsWith("container."))?.id ??
    shells.find((s) => s.id.startsWith("wsl."))?.id ??
    shells[0]?.id ??
    "login";

  return (
    <section className="space-y-3 px-5 py-4 text-[13px] text-text-1">
      <div className="text-[12px] font-semibold uppercase tracking-wide text-text-2">Atalhos de agentes no celular</div>
      <p className="text-[12px] text-text-2">
        No celular, o botão <b>+</b> da lista de terminais abre um destes atalhos: um terminal novo no PC, na pasta escolhida, já rodando o comando (por exemplo{" "}
        <code className="font-mono">claude</code>). No celular dá para trocar a pasta por uma das pastas dos terminais abertos; o comando é sempre o daqui.
      </p>

      {items.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {suggestedLaunchers(shells).map((s) => (
            <button key={s.name} type="button" className={btn} onClick={() => (setItems((xs) => [...xs, { ...s, id: "" }]), setDirty(true))}>
              <Plus size={12} className="mr-1 inline" />
              {s.name}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {items.map((l, i) => (
          <div key={l.id || `new${i}`} className="grid grid-cols-[1fr_auto] gap-2 rounded-md border border-border bg-bg-panel p-2.5">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input className={input} placeholder="Nome (ex.: Claude no projeto X)" value={l.name} onChange={(e) => change(i, { name: e.target.value })} />
              <select className={input} value={l.shell_id} onChange={(e) => change(i, { shell_id: e.target.value })}>
                {!shells.some((s) => s.id === l.shell_id) && <option value={l.shell_id}>{l.shell_id}</option>}
                {shells.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              <input
                className={input + " font-mono"}
                placeholder={
                  l.shell_id.startsWith("wsl.") || l.shell_id.startsWith("container.")
                    ? "Pasta (ex.: /home/…)"
                    : "Pasta (ex.: C:\\repo\\projeto)"
                }
                value={l.cwd ?? ""}
                spellCheck={false}
                onChange={(e) => change(i, { cwd: e.target.value })}
              />
              <input
                className={input + " font-mono"}
                placeholder="Comando (ex.: claude --resume)"
                value={l.command ?? ""}
                spellCheck={false}
                onChange={(e) => change(i, { command: e.target.value })}
              />
            </div>
            <button
              type="button"
              className="self-start rounded p-1.5 text-text-2 hover:bg-bg-hover hover:text-status-err"
              title="Apagar este atalho"
              onClick={() => (setItems((xs) => xs.filter((_, j) => j !== i)), setDirty(true))}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={btn}
          onClick={() => (setItems((xs) => [...xs, { id: "", name: "", shell_id: firstShell, cwd: "", command: "claude" }]), setDirty(true))}
        >
          <Plus size={12} className="mr-1 inline" />
          Novo atalho
        </button>
        <button type="button" className={btnMain} disabled={!dirty} onClick={() => save(items, phoneEdit)}>
          Salvar atalhos
        </button>
      </div>

      <label className="flex cursor-pointer items-start gap-2">
        <input type="checkbox" className="mt-0.5" checked={phoneEdit} onChange={(e) => save(items, e.target.checked)} />
        <span>
          O celular pode criar e editar atalhos
          <span className="block text-[12px] text-text-2">
            Desligado, o celular só usa os atalhos daqui. Ligado, quem estiver com o celular conectado pode criar um atalho com qualquer comando.
          </span>
        </span>
      </label>
      {err && <div className="text-status-err">{err}</div>}
    </section>
  );
}
