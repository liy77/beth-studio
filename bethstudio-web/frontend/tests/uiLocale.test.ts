import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";
import { applyUILocale, normalizeUILocale, t } from "../src/lib/uiLocale.ts";

test("normalizeUILocale: pt padrão, en e variantes", () => {
  assert.equal(normalizeUILocale(undefined), "pt");
  assert.equal(normalizeUILocale(""), "pt");
  assert.equal(normalizeUILocale("pt"), "pt");
  assert.equal(normalizeUILocale("PT-BR"), "pt");
  assert.equal(normalizeUILocale("en"), "en");
  assert.equal(normalizeUILocale("en-US"), "en");
  assert.equal(normalizeUILocale("en_us"), "en");
});

test("t: inglês e fallback para pt", () => {
  assert.equal(t("pt", "settings.title"), "Configurações");
  assert.equal(t("en", "settings.title"), "Settings");
  assert.equal(t("en", "settings.term.images.label"), "Show Kitty/iTerm images");
  assert.ok(t("en", "settings.nav.aparencia"));
});

test("applyUILocale define lang no documento", () => {
  const win = new Window();
  const prev = globalThis.document;
  // @ts-expect-error happy-dom Document
  globalThis.document = win.document;
  try {
    applyUILocale("en");
    assert.equal(document.documentElement.lang, "en");
    assert.ok(document.documentElement.classList.contains("bt-locale-en"));
    applyUILocale("pt");
    assert.equal(document.documentElement.lang, "pt-BR");
    assert.ok(!document.documentElement.classList.contains("bt-locale-en"));
  } finally {
    // @ts-expect-error restore
    globalThis.document = prev;
  }
});
