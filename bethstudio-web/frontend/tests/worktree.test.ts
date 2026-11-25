import { test } from "node:test";
import assert from "node:assert/strict";
import { changeAbsPath, changeCounts, diffStats, folderKey, folderSep, joinFolder, paneFolder, parseUnifiedDiff, pruneTabSidebar, setTabSidebarOpen, splitRel, statusLabel, statusMark, tabSidebarOpen } from "../src/lib/worktree.ts";

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
  assert.equal(statusLabel("alterado"), "Alterado");
  assert.equal(statusLabel("novo"), "Novo (não rastreado)");
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
