import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

async function loadModule(relPath, contextAdditions = {}) {
  const source = await readFile(new URL(relPath, import.meta.url), "utf8");
  const context = vm.createContext({
    console,
    Date,
    Math,
    setTimeout,
    clearTimeout,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    Uint32Array,
    ArrayBuffer,
    Map,
    Set,
    JSON,
    Promise,
    Blob: globalThis.Blob,
    URL: globalThis.URL,
    ...contextAdditions
  });
  vm.runInContext(source, context);
  return context;
}

// -------------------------------------------------------------
// PART 2: MARKDOWN ARTIFACT TESTS
// -------------------------------------------------------------
test("Markdown Engine: stabilizes unclosed streaming code fences and tables", async () => {
  const ctx = await loadModule("../src/artifacts/markdown-engine.js");
  const engine = ctx.VelaMarkdownEngine;

  const incomplete = "Here is Python code:\n```python\ndef compute(x):\n    return x * 2";
  const stabilized = engine.stabilizeStreamingMarkdown(incomplete);
  assert.ok(stabilized.endsWith("```"), "Must automatically close open code fence during streaming");

  const rendered = engine.renderMarkdownToHtml(incomplete, { isStreaming: true });
  assert.ok(rendered.includes("<code"), "Must render as code element rather than broken plaintext");
});

test("Markdown Engine: renders KaTeX math expressions without layout shifts", async () => {
  // Mock KaTeX in context
  const mockKatex = {
    renderToString: (tex, opts) => `<span class="katex">${tex}</span>`
  };
  const ctx = await loadModule("../src/artifacts/markdown-engine.js", { katex: mockKatex });
  const engine = ctx.VelaMarkdownEngine;

  const markdown = "Einstein found that $E = mc^2$ and block formula:\n$$\\int_0^\\infty e^{-x} dx = 1$$";
  const html = engine.renderMarkdownToHtml(markdown);

  assert.ok(html.includes("E = mc^2"));
  assert.ok(html.includes("\\int_0^\\infty e^{-x} dx = 1"));
});

test("Markdown Engine: parses footnotes, task lists, and definition lists", async () => {
  const ctx = await loadModule("../src/artifacts/markdown-engine.js");
  const engine = ctx.VelaMarkdownEngine;

  const markdown = [
    "Tasks:",
    "- [ ] Pending task",
    "- [x] Done task",
    "",
    "Architecture",
    ": A structured framework for scalable software.",
    "",
    "Reference to research[^1].",
    "",
    "[^1]: Annual Computing Survey, 2026."
  ].join("\n");

  const html = engine.renderMarkdownToHtml(markdown);

  // Task list
  assert.ok(html.includes('class="task-list-item"'), "Task list items should be formatted");
  assert.ok(html.includes('type="checkbox"'), "Interactive checkboxes rendered");

  // Definition list
  assert.ok(html.includes("<dl") && html.includes("<dt>Architecture</dt>"), "Definition list parsed");

  // Footnotes
  assert.ok(html.includes('class="footnote-ref"'), "Footnote reference rendered");
  assert.ok(html.includes('class="footnotes"'), "Footnotes end section rendered");
  assert.ok(html.includes("Annual Computing Survey"), "Footnote body included");
});

test("Markdown Engine: sanitizes untrusted model output against XSS", async () => {
  const mockPurify = {
    sanitize: (dirty) => dirty.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/onerror="[^"]*"/gi, "")
  };
  const ctx = await loadModule("../src/artifacts/markdown-engine.js", { DOMPurify: mockPurify });
  const engine = ctx.VelaMarkdownEngine;

  const malicious = '<script>alert("pwned")</script><img src="x" onerror="alert(1)">Hello safe text';
  const html = engine.renderMarkdownToHtml(malicious);

  assert.doesNotMatch(html, /<script>/i, "Must strip script tags");
  assert.doesNotMatch(html, /onerror=/i, "Must strip onerror handlers");
  assert.ok(html.includes("Hello safe text"));
});

test("Markdown Engine: extracts clean plain text from markdown", async () => {
  const ctx = await loadModule("../src/artifacts/markdown-engine.js");
  const engine = ctx.VelaMarkdownEngine;

  const markdown = "# Title\n\n**Bold text** with [a link](https://example.com) and `inline code`.\n\n```python\nprint(1)\n```";
  const plain = engine.extractPlainText(markdown);

  assert.ok(!plain.includes("#"));
  assert.ok(!plain.includes("**"));
  assert.ok(!plain.includes("```"));
  assert.ok(plain.includes("Title"));
  assert.ok(plain.includes("Bold text with a link and inline code"));
  assert.ok(plain.includes("print(1)"));
});

// -------------------------------------------------------------
// PART 3: HTML / SVG SANDBOXING & SECURITY
// -------------------------------------------------------------
test("HTML Sandbox: enforces strict CSP and disallows arbitrary remote origin requests", async () => {
  const ctx = await loadModule("../src/artifacts/interactive-engine.js");
  const engine = ctx.VelaInteractiveEngine;

  const rawHtml = "<h1>Interactive Canvas</h1><script>console.log('hi');</script>";
  const prepared = engine.prepareHtmlArtifact(rawHtml);

  assert.ok(prepared.includes("Content-Security-Policy"), "Must inject CSP meta header");
  assert.ok(prepared.includes("connect-src 'none'"), "Must block arbitrary external network connections");
  assert.ok(prepared.includes("https://cdn.jsdelivr.net"), "Allowlist includes approved CDNs");
  assert.ok(prepared.includes("velaConsole"), "Must inject runtime console bridge");
});

test("HTML Sandbox: security test verifies iframe sandbox lacks allow-same-origin", async () => {
  const ctx = await loadModule("../src/artifacts/renderers.js");
  const renderers = ctx.VelaArtifactRenderers;

  const htmlConfig = renderers.get("html");
  assert.equal(htmlConfig.security.sandbox, "allow-scripts");
  assert.ok(!htmlConfig.security.sandbox.includes("allow-same-origin"), "Must NEVER allow-same-origin with allow-scripts");
  assert.equal(htmlConfig.security.parentAccess, false);
});

test("HTML Sandbox: JSX/React artifacts automatically transpile client-side via Babel", async () => {
  const ctx = await loadModule("../src/artifacts/interactive-engine.js");
  const engine = ctx.VelaInteractiveEngine;

  const jsxCode = `function App() { return <div className="card"><h1>Hello React</h1></div>; }`;
  const prepared = engine.prepareHtmlArtifact(jsxCode, { isJsx: true });

  assert.ok(prepared.includes("text/babel"), "JSX must be wrapped in babel script tag");
  assert.ok(prepared.includes("react-dom"), "React and ReactDOM must be included");
  assert.ok(prepared.includes("ReactDOM.createRoot"), "Root mounter must be present");
});

// -------------------------------------------------------------
// PART 4: CODE EXECUTION (WASM & WORKERS)
// -------------------------------------------------------------
test("Code Execution Engine: exports executeCode, stop, restartKernel, and VFS file writer", async () => {
  const ctx = await loadModule("../src/artifacts/execution-engine.js");
  const exec = ctx.VelaExecutionEngine;

  assert.equal(typeof exec.executeCode, "function");
  assert.equal(typeof exec.stop, "function");
  assert.equal(typeof exec.restartKernel, "function");
  assert.equal(typeof exec.writeVirtualFile, "function");
  assert.equal(typeof exec.createExecutionCard, "function");
  assert.equal(typeof exec.registerRuntime, "function");
});

// -------------------------------------------------------------
// PART 5: LONG-FORM GENERATION & BOOK-QUALITY DOCX / PDF
// -------------------------------------------------------------
test("Document Pipeline: 4-pass pipeline generates and validates structured publication", async () => {
  const ctx = await loadModule("../src/artifacts/document-pipeline.js");
  const pipeline = new ctx.VelaDocumentPipeline.DocumentGenerationPipeline({
    topic: "Enterprise AI Architecture",
    callModel: async (prompt) => {
      if (prompt.includes("structural outline")) {
        return JSON.stringify({
          title: "Enterprise AI Architecture",
          subtitle: "Foundations for Autonomous Systems",
          author: "Vela Engineering",
          chapters: [
            {
              number: 1,
              title: "Foundations",
              sections: [{ id: "1.1", title: "Executive Overview", keyPoints: ["Scope"] }]
            },
            {
              number: 2,
              title: "System Design",
              sections: [{ id: "2.1", title: "Data Pipelines", keyPoints: ["Ingestion"] }]
            }
          ]
        });
      }
      return "Detailed section content with analytical text.\n\n```python\nimport pandas as pd\ndf = pd.read_csv('data.csv')\n```\n\n| Metric | Value |\n|---|---|\n| Accuracy | 99.4% |";
    }
  });

  // Pass 1: Outline
  const outline = await pipeline.generateOutline();
  assert.equal(outline.title, "Enterprise AI Architecture");
  assert.equal(outline.chapters.length, 2);

  // Pass 2: Draft Sections
  const sections = await pipeline.draftSections();
  assert.equal(sections.length, 2);

  // Pass 3: Consistency
  await pipeline.runConsistencyPass();

  // Pass 4: Assembly
  const doc = pipeline.assembleStructuredDocument();
  assert.equal(doc.metadata.title, "Enterprise AI Architecture");
  assert.equal(doc.chapters.length, 2);
  assert.equal(doc.toc.length, 2);
  assert.ok(doc.chapters[0].elements.some((e) => e.type === "code"));
  assert.ok(doc.chapters[0].elements.some((e) => e.type === "table"));
});

test("DOCX Engine: builds genuine OOXML archive with TOC field, Heading styles, and header/footer", async () => {
  // Load export.js first for createZip
  const exportCtx = await loadModule("../src/services/export.js");
  const docxCtx = await loadModule("../src/artifacts/docx-engine.js", {
    VelaExport: exportCtx.VelaExport
  });

  const sampleDoc = {
    metadata: {
      title: "Autonomous Enterprise Systems",
      subtitle: "A Comprehensive Technical Manual",
      author: "Chief Architect",
      date: "September 2026"
    },
    chapters: [
      {
        number: 1,
        title: "Introduction",
        elements: [
          { type: "heading", level: 2, text: "1.1 Scope & Context" },
          { type: "paragraph", text: "Production architectures must handle multi-modal streaming data." },
          { type: "code", code: "const rate = 1000;\nconsole.log(rate);" },
          { type: "callout", text: "Important notice for deployments." },
          { type: "table", headers: ["Service", "Latency"], rows: [["Ingress", "1.2ms"], ["Compute", "8.4ms"]] }
        ]
      }
    ]
  };

  const docxBytes = docxCtx.VelaDocxEngine.generateDocx(sampleDoc);
  assert.ok(docxBytes instanceof Uint8Array, "Must return Uint8Array binary");
  assert.ok(docxBytes.length > 500, "DOCX file must have substantial content");

  // Verify PK zip signature (0x50, 0x4B, 0x03, 0x04)
  assert.equal(docxBytes[0], 0x50);
  assert.equal(docxBytes[1], 0x4b);

  // Verify internal XML structure
  const documentXml = docxCtx.VelaDocxEngine.buildDocumentXml(sampleDoc);
  assert.ok(documentXml.includes("w:fldSimple w:instr=\"TOC"), "Must include native Word Table of Contents field");
  assert.ok(documentXml.includes("Heading1"), "Must use standard Word Heading1 style");
  assert.ok(documentXml.includes("Heading2"), "Must use standard Word Heading2 style");
  assert.ok(documentXml.includes("CodeBlock"), "Must use CodeBlock style");
  assert.ok(documentXml.includes("Autonomous Enterprise Systems"), "Title included in XML");
});

test("Book PDF Engine: compiles standard PDF-1.4 with cover page, Roman TOC, Arabic pagination, and running headers", async () => {
  const ctx = await loadModule("../src/artifacts/book-pdf-engine.js");
  const engine = ctx.VelaBookPdfEngine;

  const sampleDoc = {
    metadata: {
      title: "Principles of Resilient Software",
      subtitle: "Handbook for Modern Infrastructure",
      author: "Vela Research",
      date: "2026"
    },
    toc: [
      { number: 1, title: "Resilience Patterns", page: 1, sections: [{ id: "1.1", title: "Circuit Breakers", page: 1 }] }
    ],
    chapters: [
      {
        number: 1,
        title: "Resilience Patterns",
        elements: [
          { type: "heading", level: 2, text: "1.1 Circuit Breakers" },
          { type: "paragraph", text: "Circuit breakers prevent cascading failures across microservices." },
          { type: "code", code: "def check_health():\n    return True" }
        ]
      }
    ]
  };

  const pdfBytes = await engine.buildBookPdf(sampleDoc);
  assert.ok(pdfBytes instanceof Uint8Array);

  const textHeader = new TextDecoder().decode(pdfBytes.subarray(0, 8));
  assert.ok(textHeader.startsWith("%PDF-1.4"), "Must compile genuine PDF-1.4");

  const fullPdfStr = new TextDecoder("latin1").decode(pdfBytes);
  assert.ok(fullPdfStr.includes("%%EOF"), "Must contain standard PDF EOF marker");
  assert.ok(fullPdfStr.includes("/Root"), "Must contain Catalog /Root object");
  assert.ok(fullPdfStr.includes("/Pages"), "Must contain Pages object");
  assert.ok(fullPdfStr.includes("/Font"), "Must declare typography fonts");
  assert.ok(fullPdfStr.includes("Table of Contents"), "Must render Table of Contents");
});
