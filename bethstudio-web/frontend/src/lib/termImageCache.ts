// Cache de overlay Kitty/iTerm: base64 → blob URL (+ versão redimensionada).
// Sem isso, cada scroll reparseia megabytes no <img> e o compositor pinta
// bitmaps enormes. Testes em termImageCache.test.ts.

export type TermImagePlacement = {
  hash: string;
  col: number;
  row: number;
  cols: number;
  rows: number;
  z: number;
  mime: string;
  /** blob: ou data: — já pronto pro <img> (não depende só do Map). */
  url: string;
};

type CacheEntry = {
  fullUrl: string;
  displayUrl: string;
  /** data: fallback se blob falhar no WebKit */
  dataUrl: string;
  scalePromise?: Promise<void>;
};

const cache = new Map<string, CacheEntry>();

/** Só testes. */
export function _termImageCacheSize(): number {
  return cache.size;
}

/** Só testes. */
export function _termImageCacheClear(): void {
  for (const e of cache.values()) {
    if (e.fullUrl.startsWith("blob:")) URL.revokeObjectURL(e.fullUrl);
    if (e.displayUrl !== e.fullUrl && e.displayUrl.startsWith("blob:")) URL.revokeObjectURL(e.displayUrl);
  }
  cache.clear();
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBlobUrl(bytes: Uint8Array, type: string): string {
  // Cópia do buffer — alguns WebViews falham com view deslocada do ArrayBuffer.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return URL.createObjectURL(new Blob([copy], { type }));
}

/** Cria a entrada se ainda não existir; devolve a URL a mostrar. */
export function ensureTermImage(hash: string, mime: string, b64: string): string {
  const hit = cache.get(hash);
  if (hit) return hit.displayUrl || hit.fullUrl || hit.dataUrl;
  const type = mime && mime.startsWith("image/") ? mime : "image/png";
  const dataUrl = `data:${type};base64,${b64}`;
  let fullUrl = dataUrl;
  try {
    fullUrl = bytesToBlobUrl(b64ToBytes(b64), type);
  } catch {
    fullUrl = dataUrl;
  }
  cache.set(hash, { fullUrl, displayUrl: fullUrl, dataUrl });
  return fullUrl;
}

export function dropTermImage(hash: string): void {
  const hit = cache.get(hash);
  if (!hit) return;
  if (hit.fullUrl.startsWith("blob:")) URL.revokeObjectURL(hit.fullUrl);
  if (hit.displayUrl !== hit.fullUrl && hit.displayUrl.startsWith("blob:")) URL.revokeObjectURL(hit.displayUrl);
  cache.delete(hash);
}

export function termImageDisplayUrl(hash: string): string | null {
  const hit = cache.get(hash);
  if (!hit) return null;
  return hit.displayUrl || hit.fullUrl || hit.dataUrl;
}

export function termImageDataUrl(hash: string): string | null {
  return cache.get(hash)?.dataUrl ?? null;
}

/**
 * Redimensiona para ~caixa CSS × dpr (máx. 2×). Troca displayUrl; o <img>
 * deve ler de novo via termImageDisplayUrl / onScaled.
 */
export function ensureTermImageScaled(
  hash: string,
  cssW: number,
  cssH: number,
  dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
): Promise<string | null> {
  const hit = cache.get(hash);
  if (!hit) return Promise.resolve(null);
  if (hit.displayUrl !== hit.fullUrl && hit.displayUrl.startsWith("blob:")) {
    return Promise.resolve(hit.displayUrl);
  }
  // Caixa ainda miúda (antes do fit): não downscale agora.
  if (!(cssW > 8 && cssH > 8)) return Promise.resolve(hit.displayUrl || hit.fullUrl);
  const maxEdge = Math.max(64, Math.ceil(Math.max(cssW, cssH) * Math.min(Math.max(dpr, 1), 2)));
  if (hit.scalePromise) return hit.scalePromise.then(() => hit.displayUrl);

  hit.scalePromise = (async () => {
    try {
      const src = hit.fullUrl.startsWith("blob:") ? hit.fullUrl : hit.dataUrl;
      const bmp = await createImageBitmap(await fetch(src).then((r) => r.blob()));
      try {
        const long = Math.max(bmp.width, bmp.height);
        if (long <= maxEdge * 1.25) return;
        const scale = maxEdge / long;
        const tw = Math.max(1, Math.round(bmp.width * scale));
        const th = Math.max(1, Math.round(bmp.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = tw;
        canvas.height = th;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "medium";
        ctx.drawImage(bmp, 0, 0, tw, th);
        const blob: Blob | null = await new Promise((resolve) =>
          canvas.toBlob((b) => resolve(b), "image/jpeg", 0.8),
        );
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        if (hit.displayUrl !== hit.fullUrl && hit.displayUrl.startsWith("blob:")) {
          URL.revokeObjectURL(hit.displayUrl);
        }
        hit.displayUrl = url;
      } finally {
        bmp.close();
      }
    } catch {
      /* fica o full / data */
    } finally {
      hit.scalePromise = undefined;
    }
  })();

  return hit.scalePromise.then(() => hit.displayUrl);
}

function synthHash(im: { col: number; row: number; cols: number; rows: number; mime?: string; data?: string }): string {
  const n = im.data?.length ?? 0;
  return `anon:${im.row},${im.col},${im.cols}x${im.rows},${im.mime ?? ""},${n}`;
}

/**
 * Atualiza o cache a partir do payload da ponte e devolve só placements
 * (URL curta, sem base64 no React state).
 */
export function syncTermImagePlacements(
  prev: TermImagePlacement[],
  raw: Array<{
    hash?: string;
    col: number;
    row: number;
    cols: number;
    rows: number;
    z?: number;
    mime?: string;
    data?: string;
  }>,
): TermImagePlacement[] {
  const next: TermImagePlacement[] = [];
  const nextHashes = new Set<string>();
  for (const im of raw) {
    if (!im.data) continue;
    const hash = ((im.hash || "").trim() || synthHash(im));
    const mime = im.mime && im.mime.startsWith("image/") ? im.mime : "image/png";
    const url = ensureTermImage(hash, mime, im.data);
    nextHashes.add(hash);
    next.push({
      hash,
      col: im.col,
      row: im.row,
      cols: im.cols,
      rows: im.rows,
      z: im.z ?? 0,
      mime,
      url,
    });
  }
  const prevHashes = new Set(prev.map((p) => p.hash));
  for (const h of prevHashes) {
    if (!nextHashes.has(h)) dropTermImage(h);
  }
  return next;
}

/** Assinatura barata: posição/tamanho, sem payload. */
export function termImageSig(placements: TermImagePlacement[]): string {
  return placements.map((p) => `${p.hash}:${p.row},${p.col},${p.cols}x${p.rows},${p.z}`).join("|");
}
