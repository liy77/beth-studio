import { test } from "node:test";
import assert from "node:assert/strict";
import { resumeBannerText, resumeCommandPreview, type ResumeOffer } from "../src/lib/agentResume.ts";

const o = (pane: number, ended = false): ResumeOffer => ({ pane_id: pane, old_pane: pane + 10, agent: "claude", session_id: "s" + pane, ended });

test("texto da faixa de retomar", () => {
  assert.equal(resumeBannerText([]), null);
  assert.equal(resumeBannerText([o(1)]), "1 terminal tinha uma sessão do Claude antes do reinício. Retomar?");
  assert.equal(resumeBannerText([o(1), o(2)]), "2 terminais tinham uma sessão do Claude antes do reinício. Retomar?");
  assert.equal(resumeBannerText([o(1, true)]), "1 terminal tinha uma sessão do Claude antes do reinício (já encerrada). Retomar?");
  assert.equal(resumeBannerText([o(1), o(2, true), o(3)]), "3 terminais tinham uma sessão do Claude antes do reinício (2 abertas). Retomar?");
});

test("comando de retomar mostrado", () => {
  assert.equal(resumeCommandPreview("", "abc"), "claude --resume abc");
  assert.equal(resumeCommandPreview("claude -r {id} --x", "abc"), "claude -r abc --x");
});
