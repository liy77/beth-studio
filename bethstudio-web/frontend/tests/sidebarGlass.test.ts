import { test } from "node:test";
import assert from "node:assert/strict";
import { glassPlateFields, nativeGlassPlates, wantsNativeGlassPlate } from "../src/lib/sidebarFrame.ts";

function plate(className: string): boolean {
  return wantsNativeGlassPlate(className);
}

test("chip/chat selecionados e busca pedem placa; idle/pasta não", () => {
  const selected = "bt-chat bt-glass-on group flex min-h-9";
  const chipOn = "bt-chip bt-glass-on rounded-lg px-2";
  const chip = "bt-chip rounded-lg px-2";
  const chatOn = glassPlateFields(selected, "Cursor");
  assert.ok(chatOn);
  assert.equal(chatOn.row, 1);
  assert.equal(chatOn.label, "");
  const chipFields = glassPlateFields(chipOn, "Todos 2");
  assert.ok(chipFields);
  assert.equal(chipFields.row, 0);
  assert.equal(chipFields.selected, true);
  assert.equal(glassPlateFields(chip, "Outros"), null);
  assert.equal(glassPlateFields("bt-folder flex w-full", "brian"), null);
  assert.ok(glassPlateFields("bt-search flex items-center", "Buscar"));
});

test("com vibrancy: selecionados viram placa; idle não", () => {
  assert.equal(plate("bt-folder flex"), false);
  assert.equal(plate("bt-chat group"), false);
  assert.equal(plate("bt-chat bt-glass-on group"), true);
  assert.equal(plate("bt-chip rounded-lg"), false);
  assert.equal(plate("bt-chip bt-glass-on rounded-lg"), true);
  assert.equal(plate("bt-search flex"), true);
  assert.equal(plate("bt-mode bt-glass flex"), true);
  assert.equal(plate("bt-glass inline-flex h-7 w-7"), true);
});

test("sem vibrancy a página não pede placa nenhuma", () => {
  const markup = [
    { className: "bt-chip bt-glass-on rounded-lg" },
    { className: "bt-chat bt-glass-on group" },
    { className: "bt-search flex" },
    { className: "bt-mode bt-glass flex" },
  ];
  assert.deepEqual(nativeGlassPlates(false, markup), []);
  assert.deepEqual(
    nativeGlassPlates(true, markup).map((el) => el.className),
    ["bt-chip bt-glass-on rounded-lg", "bt-chat bt-glass-on group", "bt-search flex", "bt-mode bt-glass flex"],
  );
});
