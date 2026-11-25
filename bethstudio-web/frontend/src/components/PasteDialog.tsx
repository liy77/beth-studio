import { useEffect, useRef, useState } from "react";
import { ClipboardPaste } from "lucide-react";
import { AppSheet, SettingsBtn, SettingsHint } from "./settings/SettingsUI";

interface Props {
  onSend: (text: string) => void;
  onCancel: () => void;
}

/** Usado quando o navegador nao deixa ler a area de transferencia. */
export function PasteDialog({ onSend, onCancel }: Props) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <AppSheet
      title="Colar no terminal"
      icon={<ClipboardPaste size={15} className="text-accent-text" />}
      onClose={onCancel}
      width="md"
      footer={
        <>
          <div className="flex-1" />
          <SettingsBtn onClick={onCancel}>Cancelar</SettingsBtn>
          <SettingsBtn tone="accent" disabled={!text} onClick={() => onSend(text)}>
            Enviar
          </SettingsBtn>
        </>
      }
    >
      <SettingsHint className="mb-3">
        O navegador não liberou a leitura da área de transferência. Cole o texto abaixo e clique em Enviar.
      </SettingsHint>
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="h-40 w-full resize-none rounded-xl border border-border bg-bg-term p-3 font-mono text-[12px] text-text-1 outline-none"
      />
    </AppSheet>
  );
}
