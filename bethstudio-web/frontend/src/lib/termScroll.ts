/**
 * Pedido de rolagem igual ao último envio, mas a tela ainda não chegou lá
 * (ex.: "Voltar ao fim" depois de um `scroll 0` perdido ou ignorado).
 * Sem isto o flush descarta o clique porque desired === lastSent.
 */
export function shouldForceScrollResend(desired: number, lastSent: number, currentOffset: number): boolean {
  return desired === lastSent && desired !== currentOffset;
}

/**
 * O histórico vertical é do host (ScrollBar), não do DOM. O xterm (Cursor etc.)
 * chama scrollIntoView no textarea a cada redesenho e, com overflow-y no
 * wrapper, a caixa sobe/desce sozinha sem parar. Sempre zera scrollTop;
 * scrollLeft só recentra quando o grid cabe na área.
 */
export function pinTermBoxScroll(
  el: { scrollTop: number; scrollLeft: number },
  fits: boolean,
): { scrollTop: number; scrollLeft: number } {
  return {
    scrollTop: 0,
    scrollLeft: fits ? 0 : el.scrollLeft,
  };
}
