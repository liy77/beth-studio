import { test } from "node:test";
import assert from "node:assert/strict";
import { memText, procsBannerText, runningFor, shortFolder, type AgentProc } from "../src/lib/agentProcs.ts";

test("tempo rodando", () => {
  const now = 1_000_000 * 1000;
  const s = now / 1000;
  assert.equal(runningFor(s - 45 * 60, now), "há 45 min");
  assert.equal(runningFor(s - 3 * 3600 - 20 * 60, now), "há 3 h 20 min");
  assert.equal(runningFor(s - 2 * 3600, now), "há 2 h");
  assert.equal(runningFor(s - 357 * 3600, now), "há 14 d 21 h");
  assert.equal(runningFor(s + 10, now), "há 0 min");
});

test("memória e pasta", () => {
  assert.equal(memText(20 << 20), "20 MB");
  assert.equal(memText(3 * (1 << 30) + (1 << 29)), "3,5 GB");
  assert.equal(shortFolder("/mnt/kingston/mcu/repo/infra/mcu-simlab"), "…/infra/mcu-simlab");
  assert.equal(shortFolder("C:\\repo\\x"), "…/repo/x");
  assert.equal(shortFolder("/a"), "/a");
});

test("texto da faixa", () => {
  const p = (name: string): AgentProc => ({ id: name, side: "wsl", pid: 1, name, started: Date.now() / 1000 - 3600, cpu: 0, mem: 0 });
  assert.equal(procsBannerText([]), null);
  assert.match(procsBannerText([p("msa")])!, /^Um processo deixado por um agente está rodando há 1 h: msa\.$/);
  assert.equal(procsBannerText([p("a"), p("b")]), "2 processos deixados pelos agentes estão rodando há muito tempo.");
});
