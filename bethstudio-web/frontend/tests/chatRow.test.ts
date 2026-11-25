import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("com vibrancy o chat não pinta fundo opaco e mantém o texto na página", () => {
  const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
  const page = css.split("}").map((part) => part.trim()).find((part) => part.includes(".bt-sidebar .bt-chat,") && part.includes("bt-vibrancy"));
  assert.ok(page);
  const body = page.slice(page.lastIndexOf("{") + 1);
  assert.match(body, /background:\s*transparent/);
  assert.match(body, /opacity:\s*1/);
  assert.match(page, /bt-chat\.bt-glass-on/);
  assert.equal(/opacity:\s*0/.test(body), false);
  assert.equal(/rgb\(var\(--bt-bg-hover\)\)/.test(body), false);
  assert.equal(/rgb\(var\(--bt-accent\)\)/.test(body), false);
  // Não esconde filhos (ponto de status, nome, cwd).
  assert.equal(/\.bt-chat \*/.test(page), false);
});
