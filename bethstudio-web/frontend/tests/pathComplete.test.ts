import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyTabComplete,
  commonPrefix,
  expandHome,
  joinDirName,
  pathSep,
  splitDirPrefix,
} from "../src/lib/pathComplete.ts";

test("pathSep", () => {
  assert.equal(pathSep("/Users/a"), "/");
  assert.equal(pathSep("C:\\Users\\a"), "\\");
  assert.equal(pathSep("\\\\wsl.localhost\\Ubuntu\\home"), "\\");
});

test("expandHome", () => {
  assert.equal(expandHome("~", "/Users/brian"), "/Users/brian");
  assert.equal(expandHome("~/src", "/Users/brian"), "/Users/brian/src");
  assert.equal(expandHome("~\\src", "C:\\Users\\b"), "C:\\Users\\b\\src");
  assert.equal(expandHome("/tmp", "/Users/brian"), "/tmp");
});

test("splitDirPrefix unix", () => {
  assert.deepEqual(splitDirPrefix("/Users/brian/src/bet"), { dir: "/Users/brian/src", prefix: "bet" });
  assert.deepEqual(splitDirPrefix("/Users/brian/src/"), { dir: "/Users/brian/src", prefix: "" });
  assert.deepEqual(splitDirPrefix("/Use"), { dir: "/", prefix: "Use" });
});

test("splitDirPrefix windows", () => {
  assert.deepEqual(splitDirPrefix("C:\\Users\\b\\Do"), { dir: "C:\\Users\\b", prefix: "Do" });
  assert.deepEqual(splitDirPrefix("C:\\Users\\"), { dir: "C:\\Users", prefix: "" });
});

test("commonPrefix", () => {
  assert.equal(commonPrefix(["beth-studio", "beth-app"]), "beth-");
  assert.equal(commonPrefix(["Foo", "fooBar"]), "Foo");
  assert.equal(commonPrefix(["a", "b"]), "");
});

test("joinDirName", () => {
  assert.equal(joinDirName("/Users/brian/src", "beth-studio", "/", true), "/Users/brian/src/beth-studio/");
  assert.equal(joinDirName("/", "Users", "/", true), "/Users/");
  assert.equal(joinDirName("C:\\Users", "brian", "\\", true), "C:\\Users\\brian\\");
});

test("applyTabComplete unique", () => {
  const r = applyTabComplete("/Users/brian/src/bet", ["beth-studio", "other"]);
  assert.ok(r);
  assert.equal(r.next, "/Users/brian/src/beth-studio/");
  assert.deepEqual(r.matches, ["beth-studio"]);
});

test("applyTabComplete common prefix", () => {
  const r = applyTabComplete("/Users/brian/src/be", ["beth-studio", "beth-app"]);
  assert.ok(r);
  assert.equal(r.next, "/Users/brian/src/beth-");
  assert.equal(r.matches.length, 2);
});

test("applyTabComplete keeps tilde", () => {
  const r = applyTabComplete("~/src/bet", ["beth-studio"], { home: "/Users/brian" });
  assert.ok(r);
  assert.equal(r.next, "~/src/beth-studio/");
});
