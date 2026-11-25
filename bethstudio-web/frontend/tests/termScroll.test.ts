import assert from "node:assert/strict";
import { test } from "node:test";
import { pinTermBoxScroll, shouldForceScrollResend } from "../src/lib/termScroll.ts";

test("reenvia quando o fim já foi pedido mas a tela ainda está no histórico", () => {
  assert.equal(shouldForceScrollResend(0, 0, 27), true);
});

test("não reenvia se a tela já está no pedido", () => {
  assert.equal(shouldForceScrollResend(0, 0, 0), false);
  assert.equal(shouldForceScrollResend(40, 40, 40), false);
});

test("não força quando o pedido é novo", () => {
  assert.equal(shouldForceScrollResend(0, 27, 27), false);
  assert.equal(shouldForceScrollResend(10, 27, 27), false);
});

test("pinTermBoxScroll zera o vertical e só mexe no horizontal se o grid cabe", () => {
  assert.deepEqual(pinTermBoxScroll({ scrollTop: 240, scrollLeft: 30 }, true), { scrollTop: 0, scrollLeft: 0 });
  assert.deepEqual(pinTermBoxScroll({ scrollTop: 80, scrollLeft: 30 }, false), { scrollTop: 0, scrollLeft: 30 });
});
