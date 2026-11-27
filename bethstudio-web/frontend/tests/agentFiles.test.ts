import { test } from "node:test";
import assert from "node:assert/strict";
import { latestAgentEdit, latestAgentEditPath, lineNearEdit, pathIsGrounded } from "../src/lib/agentFiles.ts";

test("latestAgentEditPath: Wrote contents to (Claude / Cursor)", () => {
  const screen = ["Read foo.ts", "Wrote contents to /Users/x/repo/run.command", "done"].join("\n");
  assert.equal(latestAgentEditPath(screen, { posixLocal: true }), "/Users/x/repo/run.command");
});

test("latestAgentEditPath: prefere linha com Wrote/Edited no final", () => {
  const screen = [
    "Reading /tmp/old.ts",
    "something else",
    'Wrote "/Users/brian/proj/src/app.ts"',
  ].join("\n");
  assert.equal(
    latestAgentEditPath(screen, { posixLocal: true }),
    "/Users/brian/proj/src/app.ts",
  );
});

test("latestAgentEditPath: Windows absoluto", () => {
  const screen = "Applying patch to C:\\repo\\lib\\main.go\nDone.";
  assert.equal(latestAgentEditPath(screen, {}), "C:\\repo\\lib\\main.go");
});

test("latestAgentEditPath: WSL POSIX vira UNC", () => {
  const screen = "Edited /home/user/a.md";
  assert.equal(
    latestAgentEditPath(screen, { paneKind: "wsl", paneDistro: "Ubuntu" }),
    "\\\\wsl.localhost\\Ubuntu\\home\\user\\a.md",
  );
});

test("latestAgentEditPath: sem arquivo de texto → null", () => {
  assert.equal(latestAgentEditPath("hello world", { posixLocal: true }), null);
  assert.equal(latestAgentEditPath(undefined, {}), null);
});

test("latestAgentEdit: Read/Open sozinho não segue (evita arquivo aleatório)", () => {
  const screen = [
    'Reading "/Users/brian/proj/voice_test.go"',
    "Opened weblinks.go",
  ].join("\n");
  assert.equal(latestAgentEdit(screen, { posixLocal: true }), null);
});

test("latestAgentEdit: nome solto com cwd resolve (stat decide depois)", () => {
  assert.equal(
    latestAgentEditPath("Wrote voice_test.go", { posixLocal: true, paneCwd: "/tmp" }),
    "/tmp/voice_test.go",
  );
});

test("latestAgentEdit: extrai linha do hunk @@ +N", () => {
  const screen = [
    'Edited "/Users/brian/proj/localfile.go"',
    "@@ -8,6 +11,4 @@",
    "-// antigo",
    "+// deteccao/resolucao do caminho.",
  ].join("\n");
  const hit = latestAgentEdit(screen, { posixLocal: true });
  assert.equal(hit?.path, "/Users/brian/proj/localfile.go");
  assert.equal(hit?.line, 11);
  assert.equal(hit?.lineCount, 4);
});

test("lineNearEdit: path:N", () => {
  const lines = ['Wrote "/a/b.go"', "b.go:42: note"];
  assert.deepEqual(lineNearEdit(lines, 0, "/a/b.go"), { line: 42, lineCount: 1 });
});

test("pathIsGrounded", () => {
  assert.equal(pathIsGrounded("/Users/a/b.go"), true);
  assert.equal(pathIsGrounded("C:\\repo\\a.go"), true);
  assert.equal(pathIsGrounded("src/a.go"), true);
  assert.equal(pathIsGrounded("a.go"), false);
});

test("latestAgentEdit: Cursor Editing + caminho na linha de baixo", () => {
  const screen = ["Editing", "/Users/brian/proj/src/App.tsx", "@@ -1,2 +1,4 @@"].join("\n");
  const hit = latestAgentEdit(screen, { posixLocal: true });
  assert.equal(hit?.path, "/Users/brian/proj/src/App.tsx");
  assert.equal(hit?.line, 1);
  assert.equal(hit?.lineCount, 4);
});

test("latestAgentEdit: Write relativo com cwd", () => {
  const screen = ["Write", "frontend/src/lib/agentFiles.ts"].join("\n");
  assert.equal(
    latestAgentEditPath(screen, { posixLocal: true, paneCwd: "file://localhost/Users/brian/proj" }),
    "/Users/brian/proj/frontend/src/lib/agentFiles.ts",
  );
});

test("latestAgentEdit: caminho só no OSC 8 (texto curto)", () => {
  const uri = "file:///Users/brian/proj/localfile.go";
  const screen = `Edited \x1b]8;;${uri}\x07localfile.go\x1b]8;;\x07`;
  assert.equal(latestAgentEditPath(screen, { posixLocal: true }), "/Users/brian/proj/localfile.go");
});

test("latestAgentEdit: +++ b/ depois de Edited", () => {
  const screen = ["Edited App.tsx", "+++ b/frontend/src/App.tsx", "@@ -8,1 +8,3 @@"].join("\n");
  assert.equal(
    latestAgentEditPath(screen, { posixLocal: true, paneCwd: "/Users/brian/proj" }),
    "/Users/brian/proj/frontend/src/App.tsx",
  );
});

test("latestAgentEdit: SGR no meio não impede Wrote", () => {
  const screen = "Wrote contents to \x1b[36m/Users/x/repo/run.command\x1b[0m\n";
  assert.equal(latestAgentEditPath(screen, { posixLocal: true }), "/Users/x/repo/run.command");
});

test("latestAgentEdit: Claude Update(path)", () => {
  assert.equal(
    latestAgentEditPath("● Update(/Users/brian/proj/a.md)", { posixLocal: true }),
    "/Users/brian/proj/a.md",
  );
});

test("latestAgentEdit: Cursor Edited basename — não pega o Grep de types.ts", () => {
  const screen = [
    'Grepped "ScreenImage" in bethstudio-web/frontend/src/lib/types.ts',
    "2 matches",
    "Edited termImageCache.ts +204",
    "+// Cache de overlay Kitty/iTerm",
    "+export type TermImagePlacement = {",
  ].join("\n");
  const hit = latestAgentEdit(screen, {
    posixLocal: true,
    paneCwd: "file://localhost/Volumes/MCUDevDisk/repo/beth-studio",
  });
  // Basename resolve no cwd OU (melhor) path relativo se aparecer na tela.
  assert.ok(hit?.path.endsWith("termImageCache.ts"), hit?.path);
  assert.ok(!hit?.path.endsWith("types.ts"), hit?.path);
  assert.equal(hit?.line, 1);
  assert.ok((hit?.lineCount ?? 0) >= 2);
});

test("latestAgentEdit: basename acha path relativo anterior na tela", () => {
  const screen = [
    "Write",
    "bethstudio-web/frontend/src/lib/termImageCache.ts",
    "Edited termImageCache.ts +10",
    "+const x = 1",
  ].join("\n");
  assert.equal(
    latestAgentEditPath(screen, {
      posixLocal: true,
      paneCwd: "/Volumes/MCUDevDisk/repo/beth-studio",
    }),
    "/Volumes/MCUDevDisk/repo/beth-studio/bethstudio-web/frontend/src/lib/termImageCache.ts",
  );
});
