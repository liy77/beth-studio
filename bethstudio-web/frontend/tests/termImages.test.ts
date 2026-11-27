import { test } from "node:test";
import assert from "node:assert/strict";
import { inlineImageBox } from "../src/lib/termImages.ts";

test("sem tamanho natural: usa a caixa do protocolo", () => {
  assert.deepEqual(inlineImageBox(10, 5, 8, 16, null), { width: 80, height: 80 });
});

test("protocolo baixa demais: cresce a altura pela proporção", () => {
  // caixa 80×16 (10 cols × 1 row), imagem 800×600 → altura 60
  const b = inlineImageBox(10, 1, 8, 16, { w: 800, h: 600 });
  assert.equal(b.width, 80);
  assert.ok(Math.abs(b.height - 60) < 0.01);
});

test("protocolo estreita demais: cresce a largura pela proporção", () => {
  // caixa 40×80, imagem 1600×900 (16:9) → largura 80*16/9
  const b = inlineImageBox(5, 5, 8, 16, { w: 1600, h: 900 });
  assert.equal(b.height, 80);
  assert.ok(Math.abs(b.width - (80 * 1600) / 900) < 0.01);
});

test("proporção já cabe: mantém a caixa", () => {
  const b = inlineImageBox(10, 5, 8, 16, { w: 80, h: 80 });
  assert.deepEqual(b, { width: 80, height: 80 });
});
