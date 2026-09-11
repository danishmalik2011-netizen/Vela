import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../src/app/syntax-highlight.js", import.meta.url), "utf8");
const context = vm.createContext({});
vm.runInContext(source, context);
const highlight = context.VelaSyntaxHighlight;

test("syntax highlighter identifies common language aliases", () => {
  assert.equal(highlight.canonical("js"), "javascript");
  assert.equal(highlight.canonical("py"), "python");
  assert.equal(highlight.canonical("language-ts"), "typescript");
});

test("syntax highlighter safely styles model code without executing markup", () => {
  const javascript = highlight.highlight('const answer = "<script>"; // note', "javascript");
  assert.match(javascript, /tok-keyword/);
  assert.match(javascript, /tok-string/);
  assert.match(javascript, /&lt;script&gt;/);
  assert.doesNotMatch(javascript, /<script>/);
  assert.match(javascript, /tok-comment/);

  const html = highlight.highlight('<main class="hero">Hello</main>', "html");
  assert.match(html, /tok-tag/);
  assert.match(html, /&lt;main/);
});
