// Idioma da interface (Configurações → Aparência). pt = padrão; en = inglês.

export type UILocale = "pt" | "en";

export function normalizeUILocale(s?: string | null): UILocale {
  const v = (s || "").trim().toLowerCase();
  if (v === "en" || v === "en-us" || v === "en_us") return "en";
  return "pt";
}

type Dict = Record<string, string>;

const pt: Dict = {
  "settings.title": "Configurações",
  "settings.close": "Fechar",
  "settings.nav": "Seções",
  "settings.group.general": "Geral",
  "settings.group.terminals": "Terminais",
  "settings.group.ai": "IA e voz",
  "settings.group.connections": "Conexões",
  "settings.group.about": "Sobre",
  "settings.nav.aparencia": "Aparência",
  "settings.nav.atalhos": "Atalhos",
  "settings.nav.barra": "Barra lateral",
  "settings.nav.terminais": "Terminais",
  "settings.nav.retomar": "Sessões e processos",
  "settings.nav.temp": "Arquivos temporários",
  "settings.nav.celular": "Celular",
  "settings.nav.ponte": "Ponte de agentes",
  "settings.nav.voz": "Voz e IA",
  "settings.nav.provedores": "Provedores de IA",
  "settings.nav.banco": "Banco de dados",
  "settings.nav.uso": "Uso e custos",
  "settings.nav.sobre": "Sobre",
  "settings.page.aparencia.title": "Aparência",
  "settings.page.aparencia.sub": "Tema da interface, idioma, material da barra e padrões dos terminais.",
  "settings.page.atalhos.title": "Atalhos",
  "settings.page.atalhos.sub": "Teclas do Studio neste computador.",
  "settings.page.terminais.title": "Terminais",
  "settings.page.terminais.sub": "Arquivos, colar imagem, tamanho, avisos e desempenho.",
  "settings.page.celular.title": "Celular",
  "settings.page.celular.sub": "Acesso remoto pelo telefone e Studio no navegador.",
  "settings.page.voz.title": "Voz e IA",
  "settings.page.voz.sub": "Microfone, transcrição e correção.",
  "settings.page.provedores.title": "Provedores de IA",
  "settings.page.provedores.sub": "Chaves e contas usadas pelo Studio.",
  "settings.page.ponte.title": "Ponte de agentes",
  "settings.page.ponte.sub": "Como o Studio fala com os agentes neste PC.",
  "settings.page.retomar.title": "Sessões e processos",
  "settings.page.retomar.sub": "Retomar o que ficou aberto depois de uma queda.",
  "settings.page.temp.title": "Arquivos temporários",
  "settings.page.temp.sub": "Limpeza automática de colagens e ditados.",
  "settings.page.banco.title": "Banco de dados",
  "settings.page.banco.sub": "Assistente e opções das conexões.",
  "settings.page.uso.title": "Uso e custos",
  "settings.page.uso.sub": "Histórico e gasto das chamadas de IA.",
  "settings.page.barra.title": "Barra lateral",
  "settings.page.barra.sub": "Visão, filtros e ordem dos tipos de terminal.",
  "settings.page.sobre.title": "Sobre",
  "settings.page.sobre.sub": "Versão, atualizações e pastas deste Studio.",
  "settings.lang": "Idioma",
  "settings.lang.hint": "Textos da interface. Reinicia só a tela de configurações; o restante aplica na hora.",
  "settings.lang.pt": "Português",
  "settings.lang.en": "English",
  "settings.motion": "Movimento",
  "settings.motion.reduce": "Reduzir movimento",
  "settings.motion.hint": "Desliga animações da barra, painéis e balões. Também segue a preferência do sistema.",
  "settings.motion.on": "Movimento reduzido ligado",
  "settings.motion.off": "Movimento reduzido desligado",
  "settings.term.images": "Imagens no terminal",
  "settings.term.images.label": "Mostrar imagens Kitty/iTerm",
  "settings.term.images.hint": "Protocolos de imagem embutida no terminal (Kitty e iTerm2). Desligado esconde o overlay; o texto continua.",
  "settings.term.images.on": "Imagens no terminal ligadas",
  "settings.term.images.off": "Imagens no terminal desligadas",
  "settings.lang.saved": "Idioma salvo",
};

const en: Dict = {
  "settings.title": "Settings",
  "settings.close": "Close",
  "settings.nav": "Sections",
  "settings.group.general": "General",
  "settings.group.terminals": "Terminals",
  "settings.group.ai": "AI & voice",
  "settings.group.connections": "Connections",
  "settings.group.about": "About",
  "settings.nav.aparencia": "Appearance",
  "settings.nav.atalhos": "Shortcuts",
  "settings.nav.barra": "Sidebar",
  "settings.nav.terminais": "Terminals",
  "settings.nav.retomar": "Sessions & processes",
  "settings.nav.temp": "Temporary files",
  "settings.nav.celular": "Phone",
  "settings.nav.ponte": "Agent bridge",
  "settings.nav.voz": "Voice & AI",
  "settings.nav.provedores": "AI providers",
  "settings.nav.banco": "Database",
  "settings.nav.uso": "Usage & costs",
  "settings.nav.sobre": "About",
  "settings.page.aparencia.title": "Appearance",
  "settings.page.aparencia.sub": "UI theme, language, sidebar material, and default terminals.",
  "settings.page.atalhos.title": "Shortcuts",
  "settings.page.atalhos.sub": "Keyboard shortcuts for this Studio.",
  "settings.page.terminais.title": "Terminals",
  "settings.page.terminais.sub": "Files, paste image, size, alerts, and performance.",
  "settings.page.celular.title": "Phone",
  "settings.page.celular.sub": "Remote access from your phone and Studio in the browser.",
  "settings.page.voz.title": "Voice & AI",
  "settings.page.voz.sub": "Microphone, transcription, and correction.",
  "settings.page.provedores.title": "AI providers",
  "settings.page.provedores.sub": "Keys and accounts used by the Studio.",
  "settings.page.ponte.title": "Agent bridge",
  "settings.page.ponte.sub": "How the Studio talks to agents on this PC.",
  "settings.page.retomar.title": "Sessions & processes",
  "settings.page.retomar.sub": "Resume what was open after a crash.",
  "settings.page.temp.title": "Temporary files",
  "settings.page.temp.sub": "Auto-cleanup for pastes and dictation.",
  "settings.page.banco.title": "Database",
  "settings.page.banco.sub": "Assistant and connection options.",
  "settings.page.uso.title": "Usage & costs",
  "settings.page.uso.sub": "History and spend for AI calls.",
  "settings.page.barra.title": "Sidebar",
  "settings.page.barra.sub": "View, filters, and terminal kind order.",
  "settings.page.sobre.title": "About",
  "settings.page.sobre.sub": "Version, updates, and folders for this Studio.",
  "settings.lang": "Language",
  "settings.lang.hint": "Interface text. Settings labels update immediately; the rest follows.",
  "settings.lang.pt": "Português",
  "settings.lang.en": "English",
  "settings.motion": "Motion",
  "settings.motion.reduce": "Reduce motion",
  "settings.motion.hint": "Turns off sidebar, panel, and balloon animations. Also follows the system preference.",
  "settings.motion.on": "Reduce motion on",
  "settings.motion.off": "Reduce motion off",
  "settings.term.images": "Terminal images",
  "settings.term.images.label": "Show Kitty/iTerm images",
  "settings.term.images.hint": "Inline image protocols in the terminal (Kitty and iTerm2). Off hides the overlay; text still shows.",
  "settings.term.images.on": "Terminal images on",
  "settings.term.images.off": "Terminal images off",
  "settings.lang.saved": "Language saved",
};

const catalogs: Record<UILocale, Dict> = { pt, en };

/** Traduz uma chave; se faltar no idioma, usa pt; se faltar em ambos, devolve a chave. */
export function t(locale: UILocale, key: string): string {
  return catalogs[locale][key] || catalogs.pt[key] || key;
}

export function applyUILocale(locale: UILocale) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale === "en" ? "en" : "pt-BR";
  document.documentElement.classList.toggle("bt-locale-en", locale === "en");
}
