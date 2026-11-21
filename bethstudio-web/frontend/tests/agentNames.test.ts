import { test } from "node:test";
import assert from "node:assert/strict";
import { agentLabel, withAgentNames } from "../src/lib/agentNames.ts";
import type { PaneInfo } from "../src/lib/types.ts";

const pane = (id: number): PaneInfo => ({ pane_id: id }) as PaneInfo;

test("junta o agente de cada terminal na lista", () => {
  const panes = [pane(1), pane(2)];
  const out = withAgentNames(panes, { "2": "codex" })!;
  assert.equal(out[0], panes[0]);
  assert.equal(out[1].agent_name, "codex");
  assert.equal(withAgentNames(out, { "2": "codex" }), out); // nada mudou: mesma lista
  assert.equal(withAgentNames(out, {})![1].agent_name, undefined);
  assert.equal(withAgentNames(null, {}), null);
});

test("rótulos", () => {
  assert.equal(agentLabel("claude")?.label, "Claude");
  assert.equal(agentLabel("cursor")?.label, "Cursor");
  assert.equal(agentLabel("x"), null);
  assert.equal(agentLabel(undefined), null);
});
