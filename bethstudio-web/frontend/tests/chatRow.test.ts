import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("com vibrancy o chat não esconde o nome e não pinta fundo opaco", () => {
  const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
  const blocks = css.split("}").map((part) => part.trim()).filter((part) => part.includes("bt-vibrancy") && part.includes("bt-chat"));
  assert.ok(blocks.length > 0);
  for (const block of blocks) {
    const body = block.slice(block.lastIndexOf("{") + 1);
    assert.equal(/opacity:\s*0/.test(body), false);
    if (block.includes("html.bt-vibrancy .bt-sidebar .bt-chat")) {
      assert.match(body, /background:\s*transparent/);
    }
  }
  const page = blocks.find((block) => block.includes("html.bt-vibrancy .bt-sidebar .bt-chat,"));
  assert.ok(page);
  assert.match(page, /opacity:\s*1/);
  assert.match(page, /bt-chat\.bt-glass-on/);
});
