// Tooltip proprio: texto (nome + descricao) e posicao dentro da janela.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { TIP_GAP, TIP_MARGIN, parseTip, placeTip } from "../src/lib/tooltip.ts";

test("texto: nome em negrito + descrição", () => {
  assert.deepEqual(parseTip("Tarefas: uso de CPU, RAM, GPU e de cada terminal"), { title: "Tarefas", desc: "uso de CPU, RAM, GPU e de cada terminal" });
  assert.deepEqual(parseTip("Conectado ao Beth Studio — clique para atualizar a lista"), { title: "Conectado ao Beth Studio", desc: "clique para atualizar a lista" });
  assert.deepEqual(parseTip("Diminuir a fonte (A−)"), { title: "Diminuir a fonte", desc: "A−" });
  assert.deepEqual(parseTip("Minimizar"), { title: "Minimizar", desc: "" });
  assert.deepEqual(parseTip("Linha 1\nLinha 2"), { title: "Linha 1", desc: "Linha 2" });
  assert.deepEqual(parseTip("Ajustar ao painel"), { title: "Ajustar ao painel", desc: "" });
  assert.deepEqual(parseTip("Tamanho real (100%)"), { title: "Tamanho real", desc: "100%" });
  // não parte no meio da frase
  assert.deepEqual(parseTip("Parar de editar"), { title: "Parar de editar", desc: "" });
  assert.deepEqual(parseTip("Copiar a seleção (selecione um trecho primeiro)"), {
    title: "Copiar a seleção",
    desc: "selecione um trecho primeiro",
  });
});

test("IconButton usa data-tip (não title) para o balão", () => {
  const src = fs.readFileSync("src/components/IconButton.tsx", "utf8");
  assert.match(src, /data-tip=\{label\}/);
  assert.ok(!/title=\{label\}/.test(src));
});

test("posição: abaixo e centralizado; empurrado para dentro nas bordas; acima se não couber", () => {
  const p = placeTip({ left: 500, top: 4, width: 32, height: 32 }, 200, 40, 1100, 680);
  assert.equal(p.left, 416);
  assert.equal(p.top, 36 + TIP_GAP);
  assert.equal(p.above, false);
  assert.equal(p.side, "below");
  assert.equal(p.arrowX, 100);
  // botao no canto direito (ex. Fechar): cabe na janela e a seta segue o botao
  const r = placeTip({ left: 1054, top: 0, width: 46, height: 32 }, 120, 30, 1100, 680);
  assert.equal(r.left, 1100 - 120 - TIP_MARGIN);
  assert.ok(r.arrowX > 60 && r.arrowX <= 110);
  // canto esquerdo
  assert.equal(placeTip({ left: 0, top: 0, width: 32, height: 32 }, 150, 30, 1100, 680).left, TIP_MARGIN);
  // perto do pe' da janela: vai para cima
  const u = placeTip({ left: 300, top: 650, width: 32, height: 24 }, 150, 40, 1100, 680);
  assert.equal(u.above, true);
  assert.equal(u.top, 650 - TIP_GAP - 40);
});

test("camada montada no App e sem bloquear o mouse", () => {
  const src = fs.readFileSync("src/components/TooltipLayer.tsx", "utf8");
  assert.match(src, /pointer-events-none/);
  assert.match(src, /TIP_DELAY_MS/);
  assert.match(fs.readFileSync("src/App.tsx", "utf8"), /<TooltipLayer \/>/);
});
