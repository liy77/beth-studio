import { useSyncExternalStore, type DragEvent as RDragEvent } from "react";

// Arrastar e soltar (HTML5 DnD). O que esta' sendo arrastado fica aqui para
// os alvos (zonas dos terminais, titulos das abas) saberem o que mostrar.

export const PANE_MIME = "application/x-bethstudio-pane";
export const TAB_MIME = "application/x-bethstudio-tab";

export type Drag = { kind: "pane"; pane: number } | { kind: "tab"; tabId: string } | null;

let current: Drag = null;
const listeners = new Set<() => void>();

function set(d: Drag) {
  current = d;
  listeners.forEach((f) => f());
}

export function getDrag(): Drag {
  return current;
}

export function useDrag(): Drag {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => {
        listeners.delete(f);
      };
    },
    () => current,
  );
}

export function startPaneDrag(e: RDragEvent, pane: number) {
  e.dataTransfer.setData(PANE_MIME, String(pane));
  e.dataTransfer.setData("text/plain", `terminal ${pane}`);
  e.dataTransfer.effectAllowed = "move";
  set({ kind: "pane", pane });
}

export function startTabDrag(e: RDragEvent, tabId: string) {
  e.dataTransfer.setData(TAB_MIME, tabId);
  e.dataTransfer.effectAllowed = "move";
  set({ kind: "tab", tabId });
}

/** Arrasto vindo de outra janela (terminal destacado): acende as zonas de soltar. */
export function beginExternalPaneDrag(pane: number) {
  set({ kind: "pane", pane });
}

/** Dispara um evento de arrasto de pane no elemento (arrasto vindo de outra janela). */
export function dispatchPaneDrag(el: Element, type: "dragover" | "dragleave" | "drop", pane: number, pt: { x: number; y: number }) {
  const dt = new DataTransfer();
  dt.setData(PANE_MIME, String(pane));
  dt.setData("text/plain", `terminal ${pane}`);
  el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: pt.x, clientY: pt.y, dataTransfer: dt }));
}

export function endDrag() {
  if (current) set(null);
}

/** Pane sendo arrastado (do store; o dataTransfer so' e' legivel no drop). */
export function draggedPane(e?: RDragEvent): number | null {
  if (current?.kind === "pane") return current.pane;
  const v = e?.dataTransfer.getData(PANE_MIME);
  return v ? Number(v) : null;
}

/**
 * Soltou fora da janela do Studio? (guia/pane → janela destacada).
 * HTML5: fora da página o clientX/Y costuma ser 0; no Mac o screenX/Y
 * continua válido — comparamos com a moldura da janela.
 */
export function dragEndedOutside(e: { clientX: number; clientY: number; screenX: number; screenY: number; dataTransfer: DataTransfer }): boolean {
  if (e.dataTransfer.dropEffect === "move" || e.dataTransfer.dropEffect === "copy" || e.dataTransfer.dropEffect === "link") {
    return false;
  }
  const margin = 12;
  if (typeof window === "undefined") return false;
  // client fora do viewport
  if (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth - 1 || e.clientY >= window.innerHeight - 1) {
    // Confirma com a moldura da janela (evita falso positivo no canto 0,0).
    const left = window.screenX;
    const top = window.screenY;
    const right = left + window.outerWidth;
    const bottom = top + window.outerHeight;
    return e.screenX < left + margin || e.screenY < top + margin || e.screenX > right - margin || e.screenY > bottom - margin;
  }
  return false;
}
