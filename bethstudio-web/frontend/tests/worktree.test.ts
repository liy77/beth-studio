import { test } from "node:test";
import assert from "node:assert/strict";
import {
  changeAbsPath,
  changeCounts,
  changeRelKey,
  diffStats,
  explorerStatusClass,
  folderKey,
  folderSep,
  indexGitTree,
  joinFolder,
  paneFolder,
  parseUnifiedDiff,
  pruneTabSidebar,
  scmChanges,
  setTabSidebarOpen,
  splitRel,
  statusLabel,
  statusMark,
  tabSidebarOpen,
  treeGitStatus,
} from "../src/lib/worktree.ts";

test("a sidebar de uma guia não abre a da outra", () => {
  let open = {};
  assert.equal(tabSidebarOpen(open, "a"), false);
  open = setTabSidebarOpen(open, "a", true);
  assert.equal(tabSidebarOpen(open, "a"), true);
  assert.equal(tabSidebarOpen(open, "b"), false);
  open = setTabSidebarOpen(open, "b", true);
  open = setTabSidebarOpen(open, "a", false);
  assert.equal(tabSidebarOpen(open, "a"), false);
  assert.equal(tabSidebarOpen(open, "b"), true);
});

test("pruneTabSidebar esquece guia fechada e mantém a aberta", () => {
  const open = pruneTabSidebar({ a: true, b: false, c: true }, ["a", "b"]);
  assert.deepEqual(open, { a: true, b: false });
  assert.equal(pruneTabSidebar(open, ["a", "b"]), open);
});

test("folderKey não diferencia maiúsculas no Windows", () => {
  assert.equal(folderKey("C:\\Repo\\Beth"), folderKey("c:\\repo\\beth\\"));
  assert.notEqual(folderKey("/home/eu/Repo"), folderKey("/home/eu/repo"));
});

test("changeAbsPath fica dentro da pasta da guia", () => {
  assert.equal(changeAbsPath("C:\\repo", "src/a.go"), "C:\\repo\\src\\a.go");
  assert.equal(changeAbsPath("C:\\repo\\", "../segredo"), null);
  assert.equal(changeAbsPath("C:\\repo", ""), null);
  assert.equal(changeAbsPath("/Users/brian/repo", "src/a.ts"), "/Users/brian/repo/src/a.ts");
  assert.equal(folderSep("/Users/brian"), "/");
  assert.equal(joinFolder("/Users/brian", "msa-dev"), "/Users/brian/msa-dev");
  assert.equal(joinFolder("C:\\repo", "src"), "C:\\repo\\src");
});

test("paneFolder no Mac usa o caminho POSIX do terminal", () => {
  assert.equal(paneFolder("file://localhost/Users/brian", {}, true), "/Users/brian");
  assert.equal(paneFolder("/Users/brian/repo", {}, true), "/Users/brian/repo");
  assert.equal(paneFolder("file://localhost/Users/brian", {}, false), "");
  assert.equal(paneFolder("file:///C:/src", { paneKind: "powershell" }, false), "C:\\src");
});

test("splitRel e changeCounts", () => {
  assert.deepEqual(splitRel("src/lib/a.ts"), { dir: "src/lib", name: "a.ts" });
  assert.deepEqual(splitRel("README.md"), { dir: "", name: "README.md" });
  assert.deepEqual(
    changeCounts([
      { path: "a", status: "novo" },
      { path: "b", status: "alterado" },
      { path: "c", status: "alterado" },
    ]),
    [
      { status: "alterado", n: 2 },
      { status: "novo", n: 1 },
    ],
  );
});

test("statusMark e statusLabel", () => {
  assert.equal(statusMark("alterado"), "M");
  assert.equal(statusMark("novo"), "U");
  assert.equal(statusMark("adicionado"), "A");
  assert.equal(statusMark("apagado"), "D");
  assert.equal(statusMark("renomeado"), "R");
  assert.equal(statusMark("ignorado"), "I");
  assert.equal(statusLabel("alterado"), "Alterado");
  assert.equal(statusLabel("novo"), "Novo (não rastreado)");
  assert.equal(statusLabel("ignorado"), "Ignorado pelo git");
});

test("árvore git: cores e pasta herda status dos filhos", () => {
  const folder = "/Users/brian/repo";
  const changes = [
    { path: "src/a.ts", status: "alterado" },
    { path: "src/b.ts", status: "novo" },
    { path: "node_modules", status: "ignorado" },
    { path: "dist/out.js", status: "ignorado" },
  ];
  assert.deepEqual(
    scmChanges(changes).map((c) => c.path),
    ["src/a.ts", "src/b.ts"],
  );
  assert.deepEqual(changeCounts(changes), [
    { status: "alterado", n: 1 },
    { status: "novo", n: 1 },
  ]);
  const idx = indexGitTree(changes, folder);
  assert.equal(treeGitStatus(idx, "src/a.ts", folder), "alterado");
  assert.equal(treeGitStatus(idx, "src", folder), "alterado"); // alterado > novo
  assert.equal(treeGitStatus(idx, "node_modules", folder), "ignorado");
  assert.equal(treeGitStatus(idx, "dist", folder), "ignorado");
  assert.equal(explorerStatusClass("alterado"), "text-status-warn");
  assert.equal(explorerStatusClass("ignorado"), "text-text-3 opacity-60");
  assert.equal(changeRelKey("Src\\A.ts", "C:\\repo"), "src/a.ts");
});

test("parseUnifiedDiff e diffStats", () => {
  const rows = parseUnifiedDiff(
    [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,3 +1,4 @@ function",
      " keep",
      "-old",
      "+new",
      "+extra",
      " keep2",
    ].join("\n"),
  );
  // Cabeçalhos diff/---/+++ omitidos; só hunk + linhas.
  assert.equal(rows.length, 6);
  assert.equal(rows[0].kind, "hunk");
  assert.match(rows[0].text, /function|@@/);
  assert.equal(rows[1].kind, "ctx");
  assert.equal(rows[1].oldNo, 1);
  assert.equal(rows[1].newNo, 1);
  assert.equal(rows[2].kind, "del");
  assert.equal(rows[2].text, "old");
  assert.equal(rows[2].oldNo, 2);
  assert.equal(rows[3].kind, "add");
  assert.equal(rows[3].text, "new");
  assert.equal(rows[3].newNo, 2);
  assert.equal(rows[4].newNo, 3);
  assert.deepEqual(diffStats(rows), { adds: 2, dels: 1 });
});
