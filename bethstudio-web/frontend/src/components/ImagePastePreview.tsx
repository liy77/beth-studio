import { useEffect, useRef } from "react";
import { ImageIcon, X } from "lucide-react";
import { filesFromTransfer, isImageFile } from "@/lib/pasteMedia";

export interface PendingPasteImage {
  id: string;
  file: File;
  url: string;
}

interface Props {
  images: PendingPasteImage[];
  busy?: boolean;
  onRemove: (id: string) => void;
  onCancel: () => void;
  onSend: () => void;
  /** Ctrl+V / soltar mais imagens enquanto o diálogo está aberto. */
  onAddFiles?: (files: File[]) => void;
}

/** Miniaturas das imagens a colar no terminal (estilo Ghostty), antes de enviar. */
export function ImagePastePreview({ images, busy, onRemove, onCancel, onSend, onAddFiles }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const sendRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef(onCancel);
  const sendCbRef = useRef(onSend);
  const addRef = useRef(onAddFiles);
  const busyRef = useRef(busy);
  cancelRef.current = onCancel;
  sendCbRef.current = onSend;
  addRef.current = onAddFiles;
  busyRef.current = busy;

  useEffect(() => {
    // Tira o foco do terminal (senão Enter vai pro agente) e põe no diálogo.
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    sendRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cancelRef.current();
        return;
      }
      if (e.key === "Enter" && !e.isComposing) {
        if (busyRef.current) return;
        e.preventDefault();
        e.stopPropagation();
        sendCbRef.current();
      }
    };
    // Com o diálogo focado, o paste do terminal não dispara — captura aqui
    // para juntar mais imagens na fila (Ctrl+V de novo).
    const onPaste = (e: ClipboardEvent) => {
      if (busyRef.current || !addRef.current) return;
      const data = e.clipboardData;
      if (!data) return;
      const files = filesFromTransfer(data).filter(isImageFile);
      if (!files.length) return;
      e.preventDefault();
      e.stopPropagation();
      addRef.current(files);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("paste", onPaste, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("paste", onPaste, true);
    };
  }, []);

  if (!images.length) return null;

  return (
    <div
      ref={rootRef}
      className="bt-img-paste"
      role="dialog"
      aria-modal="true"
      aria-label="Pré-visualizar imagens antes de colar"
      tabIndex={-1}
      onMouseDown={(e) => e.stopPropagation()}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files") || busy) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes("Files") || busy || !onAddFiles) return;
        e.preventDefault();
        e.stopPropagation();
        const files = Array.from(e.dataTransfer.files);
        if (files.length) onAddFiles(files);
      }}
    >
      <div className="bt-img-paste__head">
        <ImageIcon size={14} className="text-accent-text" />
        <span className="bt-img-paste__title">
          {images.length === 1 ? "Imagem a colar" : `${images.length} imagens a colar`}
        </span>
        <span className="bt-img-paste__hint">Ctrl+V / solte mais · Enter cola · Esc cancela</span>
      </div>
      <div className="bt-img-paste__row">
        <div className="bt-img-paste__thumbs" aria-label="Imagens anexadas">
          {images.map((img, i) => (
            <div key={img.id} className="bt-img-paste__thumb" title={img.file.name || `imagem ${i + 1}`}>
              <img src={img.url} alt="" draggable={false} />
              <span className="bt-img-paste__num">#{i + 1}</span>
              <button
                type="button"
                className="bt-img-paste__x"
                aria-label={`Tirar imagem ${i + 1}`}
                disabled={busy}
                onClick={() => onRemove(img.id)}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
        <div className="bt-img-paste__actions">
          <button type="button" className="bt-img-paste__btn" disabled={busy} onClick={onCancel}>
            Cancelar
          </button>
          <button
            ref={sendRef}
            type="button"
            className="bt-img-paste__btn bt-img-paste__btn--go"
            disabled={busy || !images.length}
            onClick={onSend}
          >
            {busy ? "Colando…" : "Colar"}
          </button>
        </div>
      </div>
    </div>
  );
}
