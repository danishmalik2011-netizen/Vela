import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

async function loadArtifactCore() {
  const source = await readFile(new URL("../src/artifacts/core.js", import.meta.url), "utf8");
  const context = vm.createContext({});
  vm.runInContext(source, context);
  return context.VelaArtifacts;
}

const artifacts = await loadArtifactCore();

test("normalizes common artifact language aliases", () => {
  assert.equal(artifacts.normalizeLanguage("HTML5"), "html");
  assert.equal(artifacts.normalizeLanguage("md"), "markdown");
  assert.equal(artifacts.normalizeLanguage("py"), "python");
  assert.equal(artifacts.normalizeLanguage("xml"), "svg");
});

test("maps artifact languages to safe extensions", () => {
  assert.equal(artifacts.extensionFor("markdown"), "md");
  assert.equal(artifacts.extensionFor("javascript"), "js");
  assert.equal(artifacts.extensionFor("unknown"), "txt");
});

test("creates stable signatures and changes them with source", () => {
  const first = artifacts.signatureFor("html", "<h1>Hello</h1>");
  assert.equal(first, artifacts.signatureFor("HTML5", "<h1>Hello</h1>"));
  assert.notEqual(first, artifacts.signatureFor("html", "<h1>Changed</h1>"));
});

test("extracts supported fenced artifacts and ignores unsupported fences", () => {
  const output = artifacts.extractFromMarkdown([
    "```html",
    "<main>Hello</main>",
    "```",
    "```python",
    "print('hello')",
    "```",
    "```bash",
    "echo ignored",
    "```"
  ].join("\n"));

  assert.equal(output.length, 2);
  assert.equal(output[0].language, "html");
  assert.equal(output[0].previewable, true);
  assert.equal(output[1].language, "python");
  assert.equal(output[1].previewable, false);
});

test("csv, mermaid, and json fences become previewable artifacts", () => {
  const output = artifacts.extractFromMarkdown("```csv\na,b\n1,2\n```\n\n```mermaid\ngraph TD; A-->B\n```");
  assert.equal(output.length, 2);
  assert.equal(output[0].language, "csv");
  assert.equal(output[0].previewable, true);
  assert.equal(output[1].language, "mermaid");
  assert.equal(output[1].previewable, true);
  assert.equal(artifacts.extensionFor("csv"), "csv");
  assert.equal(artifacts.titleFor("mermaid"), "Diagram");
});

test("renderer helpers parse delimited data, json tables, and console bridge", async () => {
  const source = await readFile(new URL("../src/artifacts/renderers.js", import.meta.url), "utf8");
  const context = vm.createContext({});
  vm.runInContext(source, context);
  const renderers = context.VelaArtifactRenderers;

  const table = renderers.csvTable('name,note\nAda,"hello, world"\n"quoted ""x""",ok');
  const plain = JSON.parse(JSON.stringify(table));
  assert.deepEqual(plain.headers, ["name", "note"]);
  assert.deepEqual(plain.rows[0], ["Ada", "hello, world"]);
  assert.deepEqual(plain.rows[1], ['quoted "x"', "ok"]);
  assert.equal(renderers.csvTable("").columnCount, 0);

  const asTable = JSON.parse(JSON.stringify(renderers.jsonAsTable([{ a: 1, b: "x" }, { a: 2 }])));
  assert.deepEqual(asTable.columns, ["a", "b"]);
  assert.equal(renderers.jsonAsTable({ not: "an array" }), null);
  assert.equal(renderers.jsonAsTable([{ a: 1 }]), null); // needs at least two entries

  const injected = renderers.injectConsoleBridge("<html><head></head><body>hi</body></html>");
  assert.match(injected, /velaConsole/);
  assert.match(injected, /postMessage/);
  assert.equal(renderers.injectConsoleBridge(injected), injected); // idempotent

  assert.equal(renderers.get("mermaid").preview, "diagram");
  assert.equal(renderers.canPreview("csv"), true);
  assert.equal(renderers.canPreview("json"), true);
});
