import { makeHttpClient } from "@/lib/httpClient";
import { isFrameless, isMacTitlebar, winCommand } from "@/lib/windowFrame";
import { TaskManager } from "./TaskManager";

const conn = makeHttpClient();

function closeWindow() {
  if (isFrameless()) {
    winCommand("close");
    return;
  }
  // macOS: a janela auxiliar tem barra de título nativa; o X da página pede o fechamento.
  const w = window as unknown as {
    webkit?: { messageHandlers?: { bethDrag?: { postMessage: (v: string) => void } } };
  };
  w.webkit?.messageHandlers?.bethDrag?.postMessage("close");
  window.close();
}

/** Processo --tasks: só o gerenciador, em janela OS própria. */
export function TaskWindowApp() {
  return (
    <div className={`flex h-screen flex-col bg-bg-body text-text-1 ${isMacTitlebar() ? "pt-0" : ""}`}>
      <TaskManager conn={conn} standalone onClose={closeWindow} />
    </div>
  );
}
