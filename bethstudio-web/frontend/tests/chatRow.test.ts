import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("com vibrancy o chat idle tem véu; selecionado fica transparente (vidro atrás, texto por cima)", () => {
  const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
  const blocks = css.split("}").map((part) => part.trim()).filter((part) => part.includes("bt-vibrancy") && part.includes(".bt-sidebar .bt-chat"));
  assert.ok(blocks.length >= 1);
  const joined = blocks.join("\n");
  assert.match(joined, /bt-bg-hover/); // tema escuro idle
  assert.match(joined, /255 255 255/); // tema claro: véu branco over vibrancy
  assert.match(joined, /bt-chat\.bt-glass-on/);
  assert.match(joined, /transparent/); // selecionado: liquid glass atrás do WebView
  assert.match(joined, /text-accent-text/); // "na aba" branco no selecionado
  assert.match(joined, /bt-chat:hover/);
  assert.equal(/\.bt-chat \*/.test(joined), false);
  assert.equal(/opacity:\s*0/.test(joined), false);
});
