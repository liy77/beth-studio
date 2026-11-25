import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Cargo.toml, Cargo.lock e .toml usam o símbolo do vscode-symbols", () => {
  const src = readFileSync(new URL("../src/lib/fileSymbols.ts", import.meta.url), "utf8");
  assert.match(src, /"cargo\.toml": rust/);
  assert.match(src, /"cargo\.lock": lock/);
  assert.match(src, /toml: gear/);
  assert.match(src, /from "@\/assets\/symbols\/gear\.svg"/);
  assert.match(src, /from "@\/assets\/symbols\/lock\.svg"/);
  assert.match(src, /from "@\/assets\/symbols\/rust\.svg"/);
});

test("html, css, less e json usam o símbolo do vscode-symbols", () => {
  const src = readFileSync(new URL("../src/lib/fileSymbols.ts", import.meta.url), "utf8");
  assert.match(src, /from "@\/assets\/symbols\/html\.svg"/);
  assert.match(src, /from "@\/assets\/symbols\/css\.svg"/);
  assert.match(src, /from "@\/assets\/symbols\/less\.svg"/);
  assert.match(src, /from "@\/assets\/symbols\/json\.svg"/);
  assert.match(src, /\bhtml,/);
  assert.match(src, /htm: html/);
  assert.match(src, /\bcss,/);
  assert.match(src, /\bless,/);
  assert.match(src, /\bjson,/);
});

test("Claude e Codex sem placa: PNG transparente; Codex segue currentColor", () => {
  const src = readFileSync(new URL("../src/components/ToolIcon.tsx", import.meta.url), "utf8");
  assert.match(src, /claude\.png/);
  assert.match(src, /codex\.png/);
  assert.equal(src.includes('fill="#D97757"'), false);
  assert.match(src, /maskImage/);
  assert.match(src, /bg-current/);
});
