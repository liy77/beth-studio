import { test } from "node:test";
import assert from "node:assert/strict";
import {
  _termImageCacheClear,
  _termImageCacheSize,
  ensureTermImage,
  dropTermImage,
  syncTermImagePlacements,
  termImageDisplayUrl,
  termImageSig,
} from "../src/lib/termImageCache.ts";

// jsdom/node: stub mínimo de URL + atob para o cache.
const urls = new Map<string, Blob>();
let urlSeq = 0;
const g = globalThis as typeof globalThis & {
  atob: (s: string) => string;
  URL: { createObjectURL: (b: Blob) => string; revokeObjectURL: (u: string) => void };
};
g.atob = (s: string) => Buffer.from(s, "base64").toString("binary");
g.URL = {
  createObjectURL(b: Blob) {
    const u = `blob:test-${++urlSeq}`;
    urls.set(u, b);
    return u;
  },
  revokeObjectURL(u: string) {
    urls.delete(u);
  },
};

const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("ensureTermImage: uma vez por hash", () => {
  _termImageCacheClear();
  const a = ensureTermImage("h1", "image/png", TINY_PNG_B64);
  const b = ensureTermImage("h1", "image/png", TINY_PNG_B64);
  assert.equal(a, b);
  assert.equal(_termImageCacheSize(), 1);
  assert.equal(termImageDisplayUrl("h1"), a);
  dropTermImage("h1");
  assert.equal(_termImageCacheSize(), 0);
  assert.equal(termImageDisplayUrl("h1"), null);
});

test("syncTermImagePlacements: troca hash e libera o antigo", () => {
  _termImageCacheClear();
  const p0 = syncTermImagePlacements([], [
    { hash: "a", col: 0, row: 1, cols: 10, rows: 5, mime: "image/png", data: TINY_PNG_B64 },
  ]);
  assert.equal(p0.length, 1);
  assert.equal(p0[0].hash, "a");
  assert.equal(_termImageCacheSize(), 1);

  const p1 = syncTermImagePlacements(p0, [
    { hash: "b", col: 2, row: 3, cols: 8, rows: 4, mime: "image/png", data: TINY_PNG_B64 },
  ]);
  assert.equal(p1[0].hash, "b");
  assert.equal(termImageDisplayUrl("a"), null);
  assert.ok(termImageDisplayUrl("b"));
  assert.equal(_termImageCacheSize(), 1);
  dropTermImage("b");
});

test("syncTermImagePlacements: sem hash ainda mostra (hash sintético)", () => {
  _termImageCacheClear();
  const p = syncTermImagePlacements([], [
    { col: 0, row: 0, cols: 1, rows: 1, mime: "image/png", data: TINY_PNG_B64 },
    { hash: "x", col: 0, row: 0, cols: 1, rows: 1, mime: "image/png" },
  ]);
  assert.equal(p.length, 1);
  assert.ok(p[0].url);
  assert.ok(p[0].hash.startsWith("anon:"));
  dropTermImage(p[0].hash);
});

test("termImageSig: posição sem payload", () => {
  assert.equal(
    termImageSig([{ hash: "a", col: 1, row: 2, cols: 3, rows: 4, z: 0, mime: "image/png", url: "blob:x" }]),
    "a:2,1,3x4,0",
  );
});
