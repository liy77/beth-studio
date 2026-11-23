// Faixa das sidebars. Função pura: o material nativo e o CSS têm de
// concordar com estes números, senão o vibrancy pinta a coluna inteira.

export const SIDE_INSET = 8;
export const TAB_STRIP = 40;
export const CARD_BOTTOM_PAD = 8;

export interface SideFrame {
  /** topo do cartão, abaixo da faixa das abas */
  top: number;
  /** base do cartão, SIDE_INSET acima do fundo da janela */
  bottom: number;
  height: number;
  /** cor do vão em volta: a mesma da topbar */
  gutter: string;
}

export function sideFrame(windowHeight: number, topbarColor: string, tabStrip = TAB_STRIP, inset = SIDE_INSET, banner = 0, bottomPad = CARD_BOTTOM_PAD): SideFrame {
  const top = tabStrip + inset;
  const bottom = Math.max(0, windowHeight - bottomPad);
  return {
    top,
    bottom,
    height: Math.max(0, bottom - top - banner),
    gutter: topbarColor,
  };
}

/** O botão da pasta alterna a guia e diz se o painel da direita monta. */
export function toggleFolderPanel(openByTab: Record<string, boolean>, tabId: string, savedOpen: boolean): { open: boolean; next: Record<string, boolean>; mount: boolean } {
  const open = !(openByTab[tabId] ?? savedOpen);
  return { open, next: { ...openByTab, [tabId]: open }, mount: open && tabId.length > 0 };
}

export interface GlassRect {
  x: number;
  y: number;
  w: number;
  h: number;
  windowH: number;
}

/** Lê a linha que a janela grava do retângulo real do vidro. */
export function parseGlassLine(line: string): GlassRect | null {
  const m = /glass x (-?\d+) y (-?\d+) w (-?\d+) h (-?\d+) windowH (-?\d+)/.exec(line);
  if (!m) return null;
  return { x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]), windowH: Number(m[5]) };
}

/**
 * O material BehindWindow aparece por cima da página. Qualquer largura
 * maior que zero pinta o vão da coluna com o wallpaper, então cobre o fundo.
 */
export function glassCoversGutter(rect: GlassRect, sidebarWidth: number, inset = SIDE_INSET): boolean {
  if (rect.w > 0) return true;
  if (rect.x < 0) return true;
  if (rect.y < 0) return true;
  if (rect.y + rect.h > rect.windowH) return true;
  return sidebarWidth < 0 || inset < 0;
}

/** As duas barras usam a mesma faixa. */
export function framesMatch(a: SideFrame, b: SideFrame): boolean {
  return a.top === b.top && a.bottom === b.bottom && a.height === b.height && a.gutter === b.gutter;
}
