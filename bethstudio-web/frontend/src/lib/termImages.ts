// Tamanho do overlay de imagens Kitty/iTerm no terminal.
// A grade de células às vezes reporta cols/rows a menos; o overlay cresce
// para a proporção real da imagem em vez de cortar ou achatar.
// Testado em tests/termImages.test.ts.

export type InlineImageNat = { w: number; h: number };

export type InlineImageBox = {
  width: number;
  height: number;
};

/**
 * Caixa CSS do `<img>`: começa na união de células do protocolo e, se a
 * proporção real da imagem não cabe, cresce no eixo que faltou (sem crop).
 */
export function inlineImageBox(
  cols: number,
  rows: number,
  cellW: number,
  cellH: number,
  nat: InlineImageNat | null | undefined,
): InlineImageBox {
  const boxW = Math.max(1, cols) * cellW;
  const boxH = Math.max(1, rows) * cellH;
  if (!nat || !(nat.w > 0) || !(nat.h > 0)) {
    return { width: boxW, height: boxH };
  }
  const byWidthH = boxW * (nat.h / nat.w);
  const byHeightW = boxH * (nat.w / nat.h);
  // Imagem mais alta que a caixa → cresce a altura (caso comum no protocolo).
  if (byWidthH > boxH * 1.05) {
    return { width: boxW, height: byWidthH };
  }
  // Imagem mais larga que a caixa → cresce a largura (senão object-fit
  // "contain" deixa o print miúdo e parece cortado).
  if (byHeightW > boxW * 1.05) {
    return { width: byHeightW, height: boxH };
  }
  return { width: boxW, height: boxH };
}

/** Padding do xterm no Studio (`p-1.5` = 6px) — o overlay alinha com a grade. */
export const TERM_SCREEN_PAD = 6;
