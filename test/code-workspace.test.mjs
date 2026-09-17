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

test("parses targeted edit blocks and SEARCH/REPLACE hunks", () => {
  const markdown = "Here is the fix:\n\n```edit index.html\n<<<<<<< SEARCH\n<title>Old</title>\n=======\n<title>New</title>\n>>>>>>>\n<<<<<<< SEARCH\n<p>One</p>\n=======\n<p>Two</p>\n>>>>>>>\n```";
  const edits = code.parseEdits(markdown);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].path, "index.html");
  assert.equal(edits[0].hunks.length, 2);
  assert.equal(edits[0].hunks[0].search, "<title>Old</title>");
  assert.equal(edits[0].hunks[0].replace, "<title>New</title>");
  assert.equal(edits[0].hunks[1].search, "<p>One</p>");
  assert.equal(edits[0].hunks[1].replace, "<p>Two</p>");
});

test("applies targeted hunks with exact and whitespace-tolerant matching", () => {
  const original = "<!doctype html>\n<html>\n  <head>\n    <title>Old</title>\n  </head>\n  <body>\n    <p>One</p>\n  </body>\n</html>";
  const hunks = [
    { search: "    <title>Old</title>", replace: "    <title>Updated Title</title>" },
    { search: "    <p>One</p>", replace: "    <p>Updated Paragraph</p>" }
  ];
  const result = code.applyHunks(original, hunks);
  assert.equal(result.success, true);
  assert.equal(result.appliedCount, 2);
  assert.ok(result.content.includes("<title>Updated Title</title>"));
  assert.ok(result.content.includes("<p>Updated Paragraph</p>"));
});

test("applies targeted edits to workspace and records updated revision", () => {
  let ws = code.mergeFiles(code.empty(), [{ path: "app.js", language: "javascript", content: "const a = 1;\nconst b = 2;\n" }], "Init", clock);
  const patchMarkdown = "```edit app.js\n<<<<<<< SEARCH\nconst b = 2;\n=======\nconst b = 42;\n>>>>>>>\n```";
  ws = code.applyTargetedEdits(ws, patchMarkdown, "", () => clock() + 100);
  assert.equal(ws.files[0].content, "const a = 1;\nconst b = 42;\n");
  assert.equal(ws.revisions.length, 2);
  assert.match(ws.revisions[1].note, /Updated app\.js/);
});
