import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../src/code/workspace.js", import.meta.url), "utf8");
const context = vm.createContext({ JSON });
vm.runInContext(source, context);
const code = context.VelaCodeWorkspace;
const clock = () => 1700000000000;

test("normalizes safe unique workspace paths", () => {
  const state = code.normalize({ files: [
    { path: "src/app.js", language: "javascript", content: "const x = 1;" },
    { path: "src/app.js", language: "javascript", content: "duplicate" },
    { path: "../escape.py", language: "python", content: "print(1)" }
  ]});
  assert.equal(state.files.length, 2);
  assert.equal(state.files[1].path, "file-3.py");
});

test("diagnoses data and unsafe dynamic code without executing it", () => {
  const state = code.normalize({ files: [
    { path: "data.json", language: "json", content: "{" },
    { path: "app.js", language: "javascript", content: "eval('work')" }
  ]});
  assert.ok(state.diagnostics.some((item) => /Invalid JSON/.test(item.message)));
  assert.ok(state.diagnostics.some((item) => /Dynamic code execution/.test(item.message)));
  assert.equal(code.policy("javascript"), "disabled");
  assert.equal(code.policy("python"), "disabled");
  assert.equal(code.policy("html"), "sandboxed-preview");
});

test("saves files and recoverable multi-file revisions", () => {
  let state = code.mergeFiles(code.empty(), [{ path: "index.html", language: "html", content: "<h1>One</h1>" }], "Generated", clock);
  state = code.saveFile(state, state.files[0].id, "<h1>Two</h1>", () => clock() + 1);
  assert.equal(state.files[0].content, "<h1>Two</h1>");
  assert.equal(state.revisions.length, 2);
  assert.match(state.logs[0].message, /not run/);
});

test("accepts or rejects patches without hidden mutation", () => {
  const initial = code.mergeFiles(code.empty(), [{ path: "app.js", language: "javascript", content: "one" }], "Generated", clock);
  const patch = code.propose(initial, [{ path: "app.js", language: "javascript", content: "two" }], "Fix", clock);
  assert.equal(initial.files[0].content, "one");
  assert.equal(code.acceptPatch(patch, clock).files[0].content, "two");
  const rejected = code.rejectPatch(patch, clock);
  assert.equal(rejected.files[0].content, "one");
  assert.equal(rejected.patch, null);
});
