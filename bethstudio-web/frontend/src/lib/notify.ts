import { useEffect, useRef, useState } from "react";
import type { AgentState } from "./agents";
import { agentLooksWorking, reasonLabel } from "./agents";
import type { PaneInfo } from "./types";
import { paneLabel } from "./panes";

// Avisos opcionais quando um agente passa a aguardar ou fica pronto
// (desligados por padrao; ligados em Aparencia geral / barra lateral).
// Preferencia por navegador (localStorage).

export interface NotifyPrefs {
  os: boolean; // notificacao do sistema (Notification API)
  sound: boolean;
  /** Também avisar quando o chat sai de “rodando” e fica pronto (sem esperar você). */
  ready: boolean;
}

const KEY = "bethstudio-web.notify";

export function useNotifyPrefs(): [NotifyPrefs, (p: NotifyPrefs) => void] {
  const [p, setP] = useState<NotifyPrefs>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) ?? "{}");
      return { os: !!v.os, sound: !!v.sound, ready: !!v.ready };
    } catch {
      return { os: false, sound: false, ready: false };
    }
  });
  const set = (n: NotifyPrefs) => {
    setP(n);
    try {
      localStorage.setItem(KEY, JSON.stringify(n));
    } catch {
      /* ignora */
    }
    if ((n.os || n.ready) && typeof Notification !== "undefined" && Notification.permission === "default") {
      void Notification.requestPermission().catch(() => undefined);
    }
  };
  return [p, set];
}

let audio: AudioContext | null = null;
export function beep() {
  try {
    audio ??= new AudioContext();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.15, audio.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.35);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.4);
  } catch {
    /* sem audio */
  }
}

function osNotify(title: string, body: string, tag: string) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, tag });
  } catch {
    /* sem notificacao */
  }
}

/** Dispara notificacao/som quando um pane PASSA a aguardar. */
export function useAgentAlerts(agents: AgentState, panes: PaneInfo[] | null, prefs: NotifyPrefs) {
  const prev = useRef<Set<number> | null>(null);
  const running = useRef<Set<number> | null>(null);
  useEffect(() => {
    const now = new Set(Object.keys(agents).map(Number));
    const before = prev.current;
    prev.current = now;
    if (!before) return; // primeira carga: nao avisa o que ja' estava
    const fresh = [...now].filter((p) => !before.has(p));
    if (fresh.length === 0 || (!prefs.os && !prefs.sound)) return;
    if (prefs.sound) beep();
    if (prefs.os) {
      for (const id of fresh.slice(0, 3)) {
        const info = panes?.find((p) => p.pane_id === id);
        osNotify(
          "Agente aguardando resposta",
          `${info ? paneLabel(info) : `Terminal ${id}`} — ${reasonLabel(agents[id])}`,
          `bethstudio-agent-${id}`,
        );
      }
    }
  }, [agents, panes, prefs]);

  // Rodando → pronto: título/tela deixam de indicar trabalho e não está aguardando.
  useEffect(() => {
    const next = new Set<number>();
    const becameReady: number[] = [];
    for (const p of panes ?? []) {
      const isAgent = !!(p.agent_name || p.agent);
      if (!isAgent) continue;
      const waiting = !!agents[p.pane_id];
      // Sem texto de tela aqui (só o título no snap); o título do Cursor com
      // status-indicators e o spinner do Claude bastam para o aviso.
      const working = agentLooksWorking(p.title);
      if (working && !waiting) next.add(p.pane_id);
      else if (running.current?.has(p.pane_id) && !waiting && !working) becameReady.push(p.pane_id);
    }
    const primed = running.current !== null;
    running.current = next;
    if (!primed || becameReady.length === 0 || !prefs.ready) return;
    if (prefs.sound) beep();
    for (const id of becameReady.slice(0, 3)) {
      const info = panes?.find((p) => p.pane_id === id);
      osNotify("Chat pronto", `${info ? paneLabel(info) : `Terminal ${id}`} — o agente terminou o turno`, `bethstudio-ready-${id}`);
    }
  }, [agents, panes, prefs]);
}
