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
  assert.equal(artifacts.normalizeLanguage("PDF"), "pdf");
  assert.equal(artifacts.normalizeLanguage("presentation"), "pptx");
  assert.equal(artifacts.normalizeLanguage("powerpoint"), "pptx");
});

test("maps artifact languages to safe extensions", () => {
  assert.equal(artifacts.extensionFor("markdown"), "md");
  assert.equal(artifacts.extensionFor("javascript"), "js");
  assert.equal(artifacts.extensionFor("pdf"), "pdf");
  assert.equal(artifacts.extensionFor("pptx"), "pptx");
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

test("pdf and pptx fences become previewable artifacts", () => {
  const output = artifacts.extractFromMarkdown("```pdf\n# Formal Report\nContent of the executive summary.\n```\n\n```pptx\n# Slide 1\n- Item 1\n- Item 2\n```");
  assert.equal(output.length, 2);
  assert.equal(output[0].language, "pdf");
  assert.equal(output[0].previewable, true);
  assert.equal(output[1].language, "pptx");
  assert.equal(output[1].previewable, true);
  assert.equal(artifacts.extensionFor("pdf"), "pdf");
  assert.equal(artifacts.extensionFor("pptx"), "pptx");
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
  assert.equal(renderers.get("pdf").preview, "pdf");
  assert.equal(renderers.get("pptx").preview, "pptx");
  assert.equal(renderers.canPreview("csv"), true);
  assert.equal(renderers.canPreview("json"), true);
  assert.equal(renderers.canPreview("pdf"), true);
  assert.equal(renderers.canPreview("pptx"), true);
});

test("isComplete identifies finished vs half-finished code across languages", () => {
  // HTML
  assert.equal(artifacts.isComplete("html", "<!doctype html><html><head><title>T</title></head><body><h1>Hi</h1></body></html>"), true);
  assert.equal(artifacts.isComplete("html", "<!doctype html><html><head><title>T</title></head><body><h1>Cut off"), false);
  assert.equal(artifacts.isComplete("html", "<div><p>Complete component</p></div>"), true);
  assert.equal(artifacts.isComplete("html", "<div><p class=\"incomplete"), false);
  assert.equal(artifacts.isComplete("html", "<script>const a = 1;"), false); // unclosed script

  // SVG
  assert.equal(artifacts.isComplete("svg", "<svg viewBox=\"0 0 10 10\"><circle cx=\"5\" cy=\"5\" r=\"4\"/></svg>"), true);
  assert.equal(artifacts.isComplete("svg", "<svg viewBox=\"0 0 10 10\"><circle cx=\"5\" cy=\"5\" r=\"4\""), false);

  // JSON
  assert.equal(artifacts.isComplete("json", '{"name": "test", "valid": true}'), true);
  assert.equal(artifacts.isComplete("json", '{"name": "test", "valid":'), false);

  // CSS
  assert.equal(artifacts.isComplete("css", "body { color: red; }"), true);
  assert.equal(artifacts.isComplete("css", "body { color: red;"), false); // unclosed brace
  assert.equal(artifacts.isComplete("css", "body { color: /* unclosed"), false);

  // JavaScript
  assert.equal(artifacts.isComplete("javascript", "function test() { return 42; }"), true);
  assert.equal(artifacts.isComplete("javascript", "function test() { return 42 + "), false); // dangling operator
  assert.equal(artifacts.isComplete("javascript", "function test() { return 42;"), false); // unclosed brace
  assert.equal(artifacts.isComplete("javascript", "const x = 1;\nfunction"), false); // dangling keyword

  // Python
  assert.equal(artifacts.isComplete("python", "def add(a, b):\n    return a + b\n"), true);
  assert.equal(artifacts.isComplete("python", "def add(a, b):"), false); // header with no body
  assert.equal(artifacts.isComplete("python", "x = (1 + 2"), false); // unclosed paren

  // Truncation markers
  assert.equal(artifacts.isComplete("javascript", "function test() {}\n// ... [truncated]"), false);
});

test("extractFromMarkdown ignores half-finished code blocks", () => {
  const markdown = [
    "```html",
    "<!doctype html><html><head><title>Incomplete</title><body>",
    "```",
    "",
    "```html",
    "<!doctype html><html><head><title>Complete</title></head><body><h1>Done</h1></body></html>",
    "```"
  ].join("\n");

  const extracted = artifacts.extractFromMarkdown(markdown);
  assert.equal(extracted.length, 1);
  assert.ok(extracted[0].source.includes("Complete"));
});

test("infers title accurately for pptx across markdown, json, and yaml formats", () => {
  // Markdown heading
  assert.equal(artifacts.titleFor("pptx", "# Autonomous Systems Architecture\nSubtitle: Next-Gen"), "Autonomous Systems Architecture");

  // YAML title
  assert.equal(artifacts.titleFor("pptx", "theme: midnight\ntitle: Strategic Overview\nslides:\n  - layout: title"), "Strategic Overview");

  // JSON title
  assert.equal(artifacts.titleFor("pptx", '{"title": "Series A Pitch", "slides": []}'), "Series A Pitch");

  // JSON with first slide headline and unescaped newline in notes
  const complexJson = '{\n  "theme": "midnight",\n  "slides": [\n    {\n      "layout": "title",\n      "headline": "Aether Intelligence",\n      "notes": "Line 1\nLine 2"\n    }\n  ]\n}';
  assert.equal(artifacts.titleFor("pptx", complexJson), "Aether Intelligence");
});

test("infers title accurately for markdown with YAML frontmatter", () => {
  const frontmatterDoc = `---
title: "Next 7 Days: Global AI & Technology Release Radar"
author: "Vela Research & Intelligence"
date: "2026-09-17"
---

# Next 7 Days: Global AI & Technology Release Radar

Executive summary content.`;

  assert.equal(
    artifacts.titleFor("markdown", frontmatterDoc),
    "Next 7 Days: Global AI & Technology Release Radar"
  );
});


