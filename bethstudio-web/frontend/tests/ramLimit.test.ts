import { test } from "node:test";
import assert from "node:assert/strict";
import { formatBytes, ramChipText, ramPercentHint, ramStatusText, type RamLimit } from "../src/lib/ramLimit.ts";

const base: RamLimit = {
  percent: 0,
  until: 0,
  total_bytes: 16 * 1024 * 1024 * 1024,
  limit_bytes: 0,
  used_bytes: 0,
  applied: 0,
};

test("texto do botão", () => {
  assert.equal(ramChipText(base), "");
  assert.equal(ramChipText({ ...base, percent: 40 }), "RAM 40%");
  const until = new Date(2026, 10, 25, 23, 5).getTime() / 1000;
  assert.equal(ramChipText({ ...base, percent: 40, until }), "RAM 40% · até 23:05");
});

test("bytes e dica", () => {
  assert.equal(formatBytes(1024), "1 KB");
  assert.match(ramPercentHint(40, 16 * 1024 * 1024 * 1024), /40% da RAM/);
  assert.match(ramPercentHint(40, 16 * 1024 * 1024 * 1024), /GB/);
});

test("estado", () => {
  assert.match(ramStatusText(base), /Sem limite/);
  assert.match(ramStatusText({ ...base, restore: true }), /Voltando/);
  const s = ramStatusText({ ...base, percent: 40, limit_bytes: 6 * 1024 * 1024 * 1024, used_bytes: 2 * 1024 * 1024 * 1024, applied: 3 }, "windows");
  assert.match(s, /No máximo 40% da RAM/);
  assert.match(s, /3 processos no Windows/);
  assert.match(s, /uso agora/);
  assert.match(ramStatusText({ ...base, percent: 40, applied: 2, frozen: true }, "mac"), /pausados/);
});
