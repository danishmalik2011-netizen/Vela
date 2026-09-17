import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import zlib from "node:zlib";
import vm from "node:vm";

async function loadPdfEngine() {
  const source = await readFile(new URL("../src/artifacts/pdf-engine.js", import.meta.url), "utf8");
  const context = vm.createContext({
    Uint8Array,
    DataView,
    TextEncoder,
    TextDecoder,
    DecompressionStream,
    Blob,
    Response,
    Buffer,
    zlib,
    console
  });
  vm.runInContext(source, context);
  return context.VelaPdf;
}

const pdf = await loadPdfEngine();

test("pdf-engine parses JSON document specifications", () => {
  const spec = JSON.stringify({
    title: "Quarterly Performance",
    author: "Strategy Ops",
    pageSize: "a4",
    pages: [
      {
        title: "Executive Summary",
        elements: [
          { type: "heading", level: 1, text: "Q3 2026 Executive Summary" },
          { type: "paragraph", text: "Revenue increased 42% year-over-year." },
          { type: "bullet_list", items: ["Expanded enterprise tier", "Zero downtime migration"] },
          { type: "callout", text: "Key milestone: Net retention hit 138%." }
        ]
      },
      {
        title: "Financial Table",
        elements: [
          { type: "heading", level: 2, text: "Financials" },
          { type: "table", headers: ["Metric", "Target", "Actual"], rows: [["ARR", "$10M", "$14.2M"], ["Margin", "70%", "78%"]] },
          { type: "divider" }
        ]
      }
    ]
  });

  const doc = pdf.parseDocument(spec);
  assert.equal(doc.title, "Quarterly Performance");
  assert.equal(doc.author, "Strategy Ops");
  assert.equal(doc.pageSize, "a4");
  assert.equal(doc.pages.length, 2);
  assert.equal(doc.pages[0].elements[0].type, "heading");
  assert.equal(doc.pages[0].elements[0].text, "Q3 2026 Executive Summary");
  assert.equal(doc.pages[1].elements[1].type, "table");
  assert.equal(doc.pages[1].elements[1].headers.length, 3);
});

test("pdf-engine parses Markdown documents with page breaks into multi-page documents", () => {
  const markdown = [
    "# Annual Research Report",
    "Author: Science Team",
    "",
    "This report highlights breakthroughs in autonomous synthesis.",
    "",
    "> Critical finding: Deterministic bounds prevent hallucination.",
    "",
    "---page---",
    "",
    "## Experimental Results",
    "| Run | Latency | Accuracy |",
    "|---|---|---|",
    "| A1 | 12ms | 99.4% |",
    "| B2 | 8ms | 99.8% |",
    "",
    "- Validated on testbed alpha",
    "- Replicated across three environments",
    "",
    "---",
    "",
    "Final notes concluding the investigation."
  ].join("\n");

  const doc = pdf.parseDocument(markdown);
  assert.equal(doc.title, "Annual Research Report");
  assert.equal(doc.pages.length, 2);
  assert.equal(doc.pages[0].elements[0].type, "heading");
  assert.equal(doc.pages[0].elements[0].text, "Annual Research Report");
  assert.ok(doc.pages[0].elements.some((el) => el.type === "callout"));
  assert.ok(doc.pages[1].elements.some((el) => el.type === "table"));
  assert.ok(doc.pages[1].elements.some((el) => el.type === "bullet_list"));
});

test("pdf-engine wraps text and measures widths accurately", () => {
  const width = pdf.measureTextWidth("Hello World", 12);
  assert.ok(width > 40 && width < 120);

  const lines = pdf.wrapText("The quick brown fox jumps over the lazy dog and runs through the forest.", 10, 120);
  assert.ok(lines.length >= 2);
  assert.ok(lines.every((line) => line.length > 0));
});

test("pdf-engine builds compliant binary PDF-1.4 files", () => {
  const doc = {
    title: "Engineering Specification",
    author: "Architecture Guild",
    pageSize: "letter",
    pages: [
      {
        title: "Overview",
        elements: [
          { type: "heading", level: 1, text: "Vela Core Architecture" },
          { type: "paragraph", text: "Vela operates as a high-agency workspace supporting native file formats." },
          { type: "callout", text: "Native PDF and PPTX support eliminates HTML print proxies." },
          { type: "bullet_list", items: ["Deterministic parser", "Direct binary compilation", "Interactive canvas preview"] },
          { type: "table", headers: ["Module", "Language", "Renderer"], rows: [["Core", "JavaScript", "Direct"], ["PDF", "PDF-1.4", "Canvas Viewer"]] },
          { type: "divider" }
        ]
      }
    ]
  };

  const bytes = pdf.buildPdf(doc);
  assert.ok(bytes instanceof Uint8Array);
  assert.ok(bytes.length > 500);

  const text = new TextDecoder("latin1").decode(bytes);

  // PDF-1.4 Header
  assert.ok(text.startsWith("%PDF-1.4"));

  // PDF-1.4 Trailer & EOF
  assert.match(text, /%%EOF\s*$/);
  assert.match(text, /startxref\s+\d+\s+%%EOF/);

  // Cross reference table
  assert.match(text, /xref\s+0\s+\d+/);

  // Catalog & Pages
  assert.match(text, /\/Type\s*\/Catalog/);
  assert.match(text, /\/Type\s*\/Pages/);
  assert.match(text, /\/Type\s*\/Page\b/);

  // Standard Type 1 Fonts
  assert.match(text, /\/BaseFont\s*\/Helvetica\b/);
  assert.match(text, /\/BaseFont\s*\/Helvetica-Bold\b/);
  assert.match(text, /\/BaseFont\s*\/Helvetica-Oblique\b/);

  // Metadata
  assert.match(text, /\/Title\s*\(Engineering Specification\)/);
  assert.match(text, /\/Creator\s*\(Vela Intelligence Workspace\)/);

  // Content Stream with operators
  assert.match(text, /BT[\s\S]*?ET/);
});

test("pdf-engine creates interactive DOM preview with navigation and zoom", () => {
  function createElement(tag) {
    const el = {
      tagName: tag.toUpperCase(),
      className: "",
      dataset: {},
      style: {},
      attributes: {},
      children: [],
      setAttribute(k, v) { this.attributes[k] = v; },
      getAttribute(k) { return this.attributes[k]; },
      appendChild(child) { this.children.push(child); return child; },
      append(...items) { items.forEach((it) => this.appendChild(it)); },
      querySelector(selector) {
        if (selector.startsWith(".")) {
          const cls = selector.slice(1);
          return this.children.find((c) => c.className?.includes(cls)) || null;
        }
        return null;
      },
      querySelectorAll(selector) {
        if (selector.startsWith(".")) {
          const cls = selector.slice(1);
          return this.children.filter((c) => c.className?.includes(cls));
        }
        return [];
      },
      addEventListener() {},
      textContent: "",
      innerHTML: ""
    };
    return el;
  }

  const mockDoc = { createElement };
  const preview = pdf.createPreview(mockDoc, "# Test Report\n\nExecutive summary content.", { escape: String });

  assert.equal(preview.className, "artifact-preview-surface artifact-pdf-viewer");
  const toolbar = preview.children.find((c) => c.className.includes("artifact-pdf-toolbar"));
  assert.ok(toolbar, "Toolbar must be rendered");
  assert.ok(preview.children.some((c) => c.className.includes("artifact-pdf-scroller")));
  assert.match(toolbar.innerHTML, /<svg class="icon"/, "PDF toolbar must use SVG icons");
  assert.doesNotMatch(toolbar.innerHTML, /[◀▶−+]/, "PDF toolbar must not use raw unicode glyphs");
});

test("pdf-engine cleans markdown syntax markers (***, ###, **, *, `) from generated PDF", () => {
  const markdown = [
    "# Document Title",
    "***",
    "### **Subsection with bold**",
    "This is a paragraph with **strong text**, *italic text*, ***bold italic***, and `inline code`.",
    "",
    "- Item with **bold highlight** and `code`",
    "- Normal item",
    "",
    "1. First numbered step with **bold**",
    "2. Second numbered step",
    "",
    "> Critical callout with **important** text.",
    "",
    "| Header with **Bold** | Normal Column |",
    "|---|---|",
    "| Cell with `code` | Cell with ***bold-italic*** |"
  ].join("\n");

  const doc = pdf.parseDocument(markdown);
  assert.equal(doc.title, "Document Title");

  const heading = doc.pages[0].elements.find((el) => el.type === "heading" && el.level === 3);
  assert.ok(heading);
  assert.equal(heading.text, "Subsection with bold");
  assert.doesNotMatch(heading.text, /###|\*\*/);

  const para = doc.pages[0].elements.find((el) => el.type === "paragraph");
  assert.ok(para);
  assert.doesNotMatch(para.text, /\*{2,3}|`|_/);
  assert.match(para.text, /This is a paragraph with strong text, italic text, bold italic, and inline code\./);

  const numList = doc.pages[0].elements.find((el) => el.type === "numbered_list");
  assert.ok(numList, "Numbered list should be parsed as numbered_list element");
  assert.equal(numList.items.length, 2);
  assert.equal(numList.items[0], "First numbered step with bold");

  // Compile to binary PDF and ensure no raw markdown symbols leaked into stream
  const bytes = pdf.buildPdf(doc);
  const pdfString = new TextDecoder("latin1").decode(bytes);

  assert.doesNotMatch(pdfString, /\(###\s/);
  assert.doesNotMatch(pdfString, /\(\*\*\*[^*]+\*\*\*\)/);
  assert.match(pdfString, /Subsection with bold/);
  assert.match(pdfString, /strong text/);
});

test("pdf-engine extracts text from compiled PDF files accurately", async () => {
  const doc = {
    title: "Financial Audit Report",
    author: "Compliance",
    pageSize: "letter",
    pages: [
      {
        title: "Audit Findings",
        elements: [
          { type: "heading", level: 1, text: "Audit Findings 2026" },
          { type: "paragraph", text: "All compliance parameters passed verification." },
          { type: "bullet_list", items: ["ISO 27001 verified", "SOC2 Type II compliant"] }
        ]
      }
    ]
  };

  const bytes = pdf.buildPdf(doc);
  const text = await pdf.extractText(bytes);
  assert.ok(text.length > 50);
  assert.match(text, /Audit Findings 2026/);
  assert.match(text, /All compliance parameters passed verification/);
  assert.match(text, /ISO 27001 verified/);
});

test("pdf-engine extracts text from FlateDecode compressed PDF with nested dictionaries and hex strings accurately", async () => {
  const contentStream = "BT /F1 14 Tf [<004300680065006d006900630061006c00200043006f006f007200640069006e006100740069006f006e>] TJ ET\n" +
    "BT /F1 12 Tf (Question 1: Which hormone regulates calcium balance?) Tj ET";

  const compressed = zlib.deflateSync(Buffer.from(contentStream));

  const fakePdf = Buffer.concat([
    Buffer.from("%PDF-1.5\n1 0 obj\n<< /Type /Page /Resources << /Font << /F1 2 0 R >> >> /Contents 3 0 R >>\nendobj\n" +
      `3 0 obj\n<< /Filter /FlateDecode /Length ${compressed.length} >>\nstream\r\n`),
    compressed,
    Buffer.from("\r\nendstream\nendobj\nxref\n0 4\ntrailer << /Size 4 /Root 1 0 R >>\n%%EOF")
  ]);

  const text = await pdf.extractText(fakePdf);
  assert.match(text, /Chemical Coordination/);
  assert.match(text, /Which hormone regulates calcium balance/);
});

test("pdf-engine extracts text from Word .docx files accurately", async () => {
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:body>
      <w:p><w:r><w:t>NEET Zoology DPP Solutions</w:t></w:r></w:p>
      <w:p><w:r><w:t>Parathyroid hormone increases blood Ca2+ levels.</w:t></w:r></w:p>
    </w:body>
  </w:document>`;

  const deflatedXml = zlib.deflateRawSync(Buffer.from(docXml, "utf-8"));
  const fileName = "word/document.xml";
  const header = Buffer.alloc(30 + fileName.length);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(8, 8);
  header.writeUInt32LE(0, 10);
  header.writeUInt32LE(0, 14);
  header.writeUInt32LE(deflatedXml.length, 18);
  header.writeUInt32LE(Buffer.byteLength(docXml), 22);
  header.writeUInt16LE(fileName.length, 26);
  header.writeUInt16LE(0, 28);
  header.write(fileName, 30, "utf-8");

  const fakeDocx = Buffer.concat([header, deflatedXml]);
  const text = await pdf.extractOfficeText(fakeDocx, "notes.docx");
  assert.match(text, /NEET Zoology DPP Solutions/);
  assert.match(text, /Parathyroid hormone increases blood Ca2\+ levels/);
});

test("pdf-engine extracts text from PowerPoint .pptx files accurately", async () => {
  const slideXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
    <p:cSld><p:spTree><p:sp><p:txBody>
      <a:p><a:r><a:t>Thyroid and Adrenal Glands</a:t></a:r></a:p>
      <a:p><a:r><a:t>Epinephrine is secreted by adrenal medulla.</a:t></a:r></a:p>
    </p:txBody></p:sp></p:spTree></p:cSld>
  </p:sld>`;

  const deflatedXml = zlib.deflateRawSync(Buffer.from(slideXml, "utf-8"));
  const fileName = "ppt/slides/slide1.xml";
  const header = Buffer.alloc(30 + fileName.length);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(8, 8);
  header.writeUInt32LE(0, 10);
  header.writeUInt32LE(0, 14);
  header.writeUInt32LE(deflatedXml.length, 18);
  header.writeUInt32LE(Buffer.byteLength(slideXml), 22);
  header.writeUInt16LE(fileName.length, 26);
  header.writeUInt16LE(0, 28);
  header.write(fileName, 30, "utf-8");

  const fakePptx = Buffer.concat([header, deflatedXml]);
  const text = await pdf.extractOfficeText(fakePptx, "presentation.pptx");
  assert.match(text, /Thyroid and Adrenal Glands/);
  assert.match(text, /Epinephrine is secreted by adrenal medulla/);
});

test("pdf-engine autoPaginateElements splits oversized content cleanly across pages", () => {
  const elements = [
    { type: "heading", level: 1, text: "Long Document Title" },
    {
      type: "paragraph",
      text: "This is a very long paragraph. ".repeat(60)
    },
    {
      type: "bullet_list",
      items: Array.from({ length: 25 }, (_, i) => `List item ${i + 1} with descriptive text that demonstrates list pagination.`)
    }
  ];

  const pages = pdf.autoPaginateElements(elements, 620, 520);
  assert.ok(pages.length >= 2, `Expected at least 2 pages, got ${pages.length}`);

  // Total bullet items across all pages must equal 25
  const totalBullets = pages.reduce((sum, p) => {
    const list = p.find((el) => el.type === "bullet_list");
    return sum + (list ? list.items.length : 0);
  }, 0);
  assert.equal(totalBullets, 25, "All bullet items must be preserved across pages");
});

test("pdf-engine parseDocument automatically paginates long markdown without explicit pagebreaks", () => {
  const sections = [];
  sections.push("# Comprehensive System Architecture Specification");
  sections.push("Author: Principal Systems Architect");
  sections.push("");
  sections.push("## Section 1: Ingestion Pipeline Overview");
  sections.push("The ingestion pipeline processes incoming telemetry data across thousands of connected microservices. Each event is validated, normalized, and written to durable storage before indexing.");
  sections.push("");

  for (let i = 1; i <= 6; i++) {
    sections.push(`## Section ${i + 1}: Subsystem Component ${i}`);
    sections.push(`Detailed description for component ${i}. Standard operational parameters indicate high availability and resilience across multi-region clusters.`);
    sections.push("");
    sections.push("- Primary worker pool configured for auto-scaling");
    sections.push("- Secondary failover standby activated within 500ms");
    sections.push("- Distributed tracing injected at every gRPC boundary");
    sections.push("");
    sections.push("| Service | Target SLA | Measured P99 | Throughput |");
    sections.push("|---|---|---|---|");
    sections.push(`| Worker-${i}A | 99.9% | 14ms | 4,200 req/s |`);
    sections.push(`| Worker-${i}B | 99.95% | 9ms | 6,800 req/s |`);
    sections.push("");
  }

  const markdown = sections.join("\n");
  const doc = pdf.parseDocument(markdown);

  assert.equal(doc.title, "Comprehensive System Architecture Specification");
  assert.ok(doc.pages.length >= 3, `Expected at least 3 pages for long markdown, got ${doc.pages.length}`);

  // Verify binary compilation of the multi-page document
  const bytes = pdf.buildPdf(doc);
  assert.ok(bytes instanceof Uint8Array);
  const pdfString = new TextDecoder("latin1").decode(bytes);

  // Check that multiple /Type /Page objects exist
  const pageMatches = pdfString.match(/\/Type\s*\/Page\b/g);
  assert.ok(pageMatches && pageMatches.length >= 3, `Expected at least 3 Page objects in PDF, got ${pageMatches?.length}`);

  // Check that running footers reflect the total page count
  assert.match(pdfString, new RegExp(`Page 1 of ${doc.pages.length}`));
  assert.match(pdfString, new RegExp(`Page 2 of ${doc.pages.length}`));
});

test("pdf-engine autoPaginateElements prevents orphan headings at page bottoms", () => {
  // Create an element that fills almost the entire page (~596pt)
  const fillingParagraph = {
    type: "paragraph",
    text: "This is a detailed paragraph line that fills vertical space in the document. ".repeat(65)
  };
  const heading = {
    type: "heading",
    level: 2,
    text: "Next Major Section"
  };
  const followingPara = {
    type: "paragraph",
    text: "Content belonging to the next major section."
  };

  const pages = pdf.autoPaginateElements([fillingParagraph, heading, followingPara], 620, 520);
  assert.ok(pages.length >= 2, `Should split across at least 2 pages, got ${pages.length}`);

  // The heading should be on page 2 or subsequent, NOT trapped alone at the bottom of page 1
  const page1Heading = pages[0].find((el) => el.type === "heading" && el.text === "Next Major Section");
  assert.equal(page1Heading, undefined, "Heading should not be stranded at bottom of first page");

  const page2Heading = pages[1].find((el) => el.type === "heading" && el.text === "Next Major Section");
  assert.ok(page2Heading, "Heading should appear at the top of the next page");
});

test("pdf-engine autoPaginateElements splits long tables across pages", () => {
  const table = {
    type: "table",
    headers: ["ID", "Metric", "Value", "Status"],
    rows: Array.from({ length: 45 }, (_, i) => [`#${i + 1}`, `Metric ${i + 1}`, `${(i * 1.5).toFixed(1)}ms`, "PASS"])
  };

  const pages = pdf.autoPaginateElements([table], 620, 520);
  assert.ok(pages.length >= 2, `Table with 45 rows should paginate, got ${pages.length} pages`);

  // Both pages should have tables with headers preserved
  pages.forEach((p) => {
    const tableEl = p.find((el) => el.type === "table");
    assert.ok(tableEl, "Each paginated page should contain a table element");
    assert.deepEqual(tableEl.headers, ["ID", "Metric", "Value", "Status"]);
  });

  const totalRows = pages.reduce((sum, p) => {
    const tableEl = p.find((el) => el.type === "table");
    return sum + (tableEl ? tableEl.rows.length : 0);
  }, 0);
  assert.equal(totalRows, 45, "All 45 table rows must be preserved across pages");
});

test("pdf-engine printPdf isolates PDF pages into dedicated hidden print iframe", async () => {
  let printed = false;
  let writtenHtml = "";

  const mockIframe = {
    className: "",
    style: {},
    contentWindow: {
      focus() {},
      print() { printed = true; },
      document: {
        open() {},
        write(html) { writtenHtml = html; },
        close() {}
      }
    },
    remove() {}
  };

  const mockBody = {
    appendChild(child) {
      assert.equal(child.className, "artifact-pdf-print-iframe");
    }
  };

  const mockWrap = {
    querySelectorAll(selector) {
      if (selector === ".artifact-pdf-page") {
        return [
          { outerHTML: `<div class="artifact-pdf-page"><div class="artifact-pdf-body"><p>Page 1 Content</p></div></div>` },
          { outerHTML: `<div class="artifact-pdf-page"><div class="artifact-pdf-body"><p>Page 2 Content</p></div></div>` }
        ];
      }
      return [];
    }
  };

  // Run in a context with mocked DOM
  const source = await readFile(new URL("../src/artifacts/pdf-engine.js", import.meta.url), "utf8");
  const context = vm.createContext({
    Uint8Array,
    TextEncoder,
    TextDecoder,
    DecompressionStream,
    Buffer,
    console,
    setTimeout: (fn) => fn(),
    window: { print() {} },
    document: {
      body: mockBody,
      createElement: (tag) => {
        if (tag === "iframe") return mockIframe;
        return {};
      }
    }
  });
  vm.runInContext(source, context);

  context.VelaPdf.printPdf({ title: "Print Test Document" }, mockWrap);

  assert.ok(writtenHtml.includes("Page 1 Content"), "Iframe must include Page 1 content");
  assert.ok(writtenHtml.includes("Page 2 Content"), "Iframe must include Page 2 content");
  assert.ok(writtenHtml.includes("@page"), "Iframe must include print page CSS");
  assert.doesNotMatch(writtenHtml, /sidebar|topbar|chat-messages/, "Iframe must not include app UI");
  assert.equal(printed, true, "Iframe contentWindow.print() must have been called");
});

test("pdf-engine decodes subset fonts using ToUnicode CMap streams", async () => {
  const cmap = `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
1 begincodespacerange <0000> <FFFF> endcodespacerange
4 beginbfchar
<0001> <004E>
<0002> <0045>
<0003> <0045>
<0004> <0054>
endbfchar
endcmap`;

  const textStream = "BT /F1 12 Tf [<0001000200030004>] TJ ET";

  const fakePdf = Buffer.from(
    "%PDF-1.4\n" +
    "1 0 obj << /Type /CMap >> stream\r\n" + cmap + "\r\nendstream\nendobj\n" +
    "2 0 obj << /Type /Page >> stream\r\n" + textStream + "\r\nendstream\nendobj\n" +
    "%%EOF"
  );

  const text = await pdf.extractText(fakePdf);
  assert.equal(text, "NEET", "Must map <0001000200030004> to 'NEET' via ToUnicode CMap");
});

test("pdf-engine extracts embedded JPEG page images from scanned PDFs", async () => {
  const dummyJpeg = Buffer.from([
    0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x60,
    0x00, 0x60, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
    0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12,
    0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xFF, 0xDA, 0x00,
    0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00, 0x7F, 0xFF, 0xD9
  ]);

  const pdfWithImage = Buffer.concat([
    Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /XObject /Subtype /Image /Filter /DCTDecode /Length " + dummyJpeg.length + " >>\nstream\r\n"),
    dummyJpeg,
    Buffer.from("\r\nendstream\nendobj\n%%EOF")
  ]);

  const images = await pdf.extractImages(pdfWithImage);
  assert.equal(images.length, 1, "Must extract 1 JPEG image from PDF");
  assert.ok(images[0].startsWith("data:image/jpeg;base64,"), "Extracted image must be a JPEG data URL");
});

test("pdf-engine suppresses images when text is present in digital PDFs", async () => {
  const dummyJpeg = Buffer.from([
    0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x60,
    0x00, 0x60, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
    0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12,
    0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xFF, 0xDA, 0x00,
    0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00, 0x7F, 0xFF, 0xD9
  ]);

  const pdfWithTextAndImage = Buffer.concat([
    Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /XObject /Subtype /Image /Filter /DCTDecode /Length " + dummyJpeg.length + " >>\nstream\r\n"),
    dummyJpeg,
    Buffer.from("\r\nendstream\nendobj\n2 0 obj\n<< /Type /Page >>\nstream\r\nBT /F1 12 Tf (Chemical Coordination and Integration Zoology DPP Questions and Answers) Tj ET\r\nendstream\nendobj\n%%EOF")
  ]);

  const data = await pdf.extractPdfData(pdfWithTextAndImage);
  assert.ok(data.text.includes("Chemical Coordination"), "Must extract text from digital PDF");
  assert.equal(data.images.length, 0, "Must suppress embedded image streams when text is present to prevent vision decode errors");
});

test("pdf-engine strips raw HTML tags, wrapper divs, and styles without leaking into text or elements", () => {
  const markdownWithHtml = [
    '<div style="column-count: 2; column-gap: 25px; text-align: justify;">',
    '<style>body { font-size: 14px; }</style>',
    "# Physics DPP: Center of Mass",
    '<span class="badge">Important</span>',
    "",
    "A particle of mass \\(m\\) moving with velocity \\(\\vec{v}_1\\) collides with mass \\(2m\\).",
    "</div>"
  ].join("\n");

  const doc = pdf.parseDocument(markdownWithHtml);
  assert.equal(doc.title, "Physics DPP: Center of Mass");
  assert.ok(doc.pages.length >= 1);

  for (const page of doc.pages) {
    for (const el of page.elements) {
      const text = el.text || (el.items && el.items.join(" ")) || "";
      assert.ok(!text.includes("<div"), `Element text should not contain <div: ${text}`);
      assert.ok(!text.includes("</div>"), `Element text should not contain </div>: ${text}`);
      assert.ok(!text.includes("<style"), `Element text should not contain <style: ${text}`);
      assert.ok(!text.includes("<span"), `Element text should not contain <span: ${text}`);
    }
  }
});

test("pdf-engine normalizes LaTeX math expressions into crisp typographic symbols", () => {
  const input = "Mass \\(m\\) has velocity \\(\\vec{v}_1 = 10\\hat{i}\\) and ratio \\(\\frac{3}{4}\\) at \\(30^\\circ\\) with \\(m \\gg M\\).";
  const normalized = pdf.normalizeLatexMath(input);
  assert.ok(normalized.includes("3/4") || normalized.includes("¾"), "Must normalize fraction");
  assert.ok(normalized.includes("30°"), "Must normalize degree");
  assert.ok(normalized.includes("≫") || normalized.includes(">>"), "Must normalize \\gg");
  assert.ok(!normalized.includes("\\("), "Must strip LaTeX inline delimiters");
  assert.ok(!normalized.includes("\\vec"), "Must strip \\vec command");
  assert.ok(!normalized.includes("\\hat"), "Must strip \\hat command");
});

test("pdf-engine detects exam header and parses MCQ questions with structured options", () => {
  const examMarkdown = [
    "# DPP-05: Chemical Coordination and Integration",
    "**Subject:** Zoology | **Topic:** Endocrine System | **Max Marks:** 100 | **Time:** 60 Mins",
    "",
    "1. Which hormone lowers blood calcium level?",
    "(1) Parathyroid hormone (PTH)",
    "(2) Thyrocalcitonin (TCT)",
    "(3) Aldosterone",
    "(4) Cortisol",
    "",
    "2. Identify the statement regarding posterior pituitary:",
    "(1) Synthesizes oxytocin  (2) Stores oxytocin and vasopressin",
    "(3) Secretes prolactin   (4) Controls thyroid directly"
  ].join("\n");

  const doc = pdf.parseDocument(examMarkdown);
  assert.equal(doc.layout, "two-column", "Exam DPP should auto-enable two-column layout");
  const firstPage = doc.pages[0];
  const examHeader = firstPage.elements.find(el => el.type === "exam_header");
  assert.ok(examHeader, "Must create exam_header element");
  assert.equal(examHeader.title, "DPP-05: Chemical Coordination and Integration");
  assert.equal(examHeader.metadata.Subject, "Zoology");
  assert.equal(examHeader.metadata.Topic, "Endocrine System");

  const questions = firstPage.elements.filter(el => el.type === "question");
  assert.equal(questions.length, 2, "Must parse both questions");
  assert.equal(questions[0].number, 1);
  assert.ok(questions[0].stem.includes("lowers blood calcium level"));
  assert.equal(questions[0].options.length, 4);
  assert.ok(questions[0].options.some(o => (o.text || "").includes("Thyrocalcitonin")));

  assert.equal(questions[1].number, 2);
  assert.equal(questions[1].options.length, 4);
});

test("pdf-engine builds two-column binary PDF without errors", () => {
  const doc = {
    title: "NEET Zoology DPP",
    author: "Vela",
    pageSize: "a4",
    layout: "two-column",
    pages: [
      {
        title: "Page 1",
        elements: [
          {
            type: "exam_header",
            title: "NEET Zoology DPP-05",
            subtitle: "Chemical Coordination",
            metadata: { Subject: "Zoology", "Max Marks": "100", Time: "60 Mins" }
          },
          {
            type: "question",
            number: "1.",
            stem: "Which hormone lowers blood calcium level?",
            options: [
              "(1) Parathyroid hormone (PTH)",
              "(2) Thyrocalcitonin (TCT)",
              "(3) Aldosterone",
              "(4) Cortisol"
            ],
            layout: "grid"
          }
        ]
      }
    ]
  };

  const bytes = pdf.buildPdf(doc);
  assert.ok(bytes instanceof Uint8Array);
  assert.ok(bytes.length > 500);

  const text = new TextDecoder("latin1").decode(bytes);
  assert.ok(text.startsWith("%PDF-1.4"));
  assert.match(text, /%%EOF\s*$/);
  assert.ok(text.includes("Thyrocalcitonin") || text.includes("TCT"));
});

test("pdf-engine strips leading metadata frontmatter without leaking into body paragraphs", () => {
  const markdown = [
    'title: "Physics DPP: Electrostatics"',
    'subject: "Physics"',
    'date: "2026-09-14"',
    '',
    '# Electrostatics Practice Test',
    'Time: 45 Mins',
    '',
    '1. What is the unit of electric flux?'
  ].join("\n");

  const doc = pdf.parseDocument(markdown);
  assert.equal(doc.title, "Physics DPP: Electrostatics");
  assert.equal(doc.meta.subject, "Physics");

  const allText = doc.pages.flatMap(p => p.elements.map(e => e.text || e.stem || "")).join(" ");
  assert.ok(!allText.includes('title: "Physics'));
  assert.ok(!allText.includes('subject: "Physics'));
  assert.ok(!allText.includes('date: "2026'));
});

test("pdf-engine unpacks markdown tables used as two-column question containers into individual questions", () => {
  const tableMd = [
    '# DPP: Botany Quiz',
    '',
    '| Q1 - Q2 | Q3 - Q4 |',
    '|---|---|',
    '| 1. Plant cell walls contain cellulose.<br>(1) True (2) False | 3. Photosynthesis occurs in chloroplasts.<br>(1) True (2) False |',
    '| 2. Mitochondria produce ATP.<br>(1) Yes (2) No | 4. Ribosomes synthesize protein.<br>(1) Yes (2) No |'
  ].join("\n");

  const doc = pdf.parseDocument(tableMd);
  assert.equal(doc.layout, "two-column");

  const tables = doc.pages[0].elements.filter(el => el.type === "table");
  assert.equal(tables.length, 0, "Table should be unpacked into question elements");

  const questions = doc.pages[0].elements.filter(el => el.type === "question");
  assert.equal(questions.length, 4, "Should extract all 4 questions");
  assert.equal(questions[0].number, 1);
  assert.ok(questions[0].stem.includes("cellulose"));
  assert.equal(questions[1].number, 2);
  assert.equal(questions[2].number, 3);
  assert.equal(questions[3].number, 4);
});

test("pdf-engine dynamically wraps long text in table cells without 36-char truncation", () => {
  const longDescription = "This is a very long text inside a table cell that exceeds thirty-six characters by a large margin and must wrap cleanly without truncation.";
  const doc = {
    title: "Table Wrapping Test",
    pageSize: "a4",
    pages: [
      {
        title: "Page 1",
        elements: [
          {
            type: "table",
            headers: ["Feature", "Detailed Description"],
            rows: [
              ["Wrapping", longDescription]
            ]
          }
        ]
      }
    ]
  };

  const bytes = pdf.buildPdf(doc);
  const text = new TextDecoder("latin1").decode(bytes);

  assert.ok(text.includes("characters") || text.includes("truncation"), "Table cell must include text past 36 chars");
});
