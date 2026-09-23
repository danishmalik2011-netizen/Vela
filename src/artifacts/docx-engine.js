(() => {
  "use strict";

  function escapeXml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  // XML Templates
  const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
  <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
</Types>`;

  const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const DOCUMENT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
</Relationships>`;

  const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>
        <w:sz w:val="22"/>
        <w:szCs w:val="22"/>
        <w:color w:val="1E293B"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:spacing w:after="160" w:line="276" w:lineRule="auto"/>
      </w:pPr>
    </w:pPrDefault>
  </w:docDefaults>

  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:pPr>
      <w:keepNext/>
      <w:spacing w:before="400" w:after="200"/>
      <w:outlineLvl w:val="0"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>
      <w:b/>
      <w:sz w:val="40"/>
      <w:color w:val="0F172A"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:pPr>
      <w:keepNext/>
      <w:spacing w:before="280" w:after="140"/>
      <w:outlineLvl w:val="1"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="30"/>
      <w:color w:val="1E293B"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:pPr>
      <w:keepNext/>
      <w:spacing w:before="200" w:after="100"/>
      <w:outlineLvl w:val="2"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="26"/>
      <w:color w:val="334155"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="CodeBlock">
    <w:name w:val="Code Block"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:spacing w:before="120" w:after="120" w:line="240" w:lineRule="auto"/>
      <w:shd w:val="clear" w:color="auto" w:fill="F1F5F9"/>
      <w:pBdr>
        <w:left w:val="single" w:sz="12" w:space="8" w:color="CBD5E1"/>
      </w:pBdr>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>
      <w:sz w:val="19"/>
      <w:color w:val="0F172A"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="BlockQuote">
    <w:name w:val="Quote"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:ind w:left="720"/>
      <w:spacing w:before="160" w:after="160"/>
      <w:pBdr>
        <w:left w:val="single" w:sz="18" w:space="12" w:color="3B82F6"/>
      </w:pBdr>
    </w:pPr>
    <w:rPr>
      <w:i/>
      <w:color w:val="475569"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Caption">
    <w:name w:val="Caption"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:jc w:val="center"/>
      <w:spacing w:before="80" w:after="160"/>
    </w:pPr>
    <w:rPr>
      <w:i/>
      <w:sz w:val="18"/>
      <w:color w:val="64748B"/>
    </w:rPr>
  </w:style>
</w:styles>`;

  function buildHeaderXml(title) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p>
    <w:pPr>
      <w:jc w:val="right"/>
    </w:pPr>
    <w:r>
      <w:rPr>
        <w:color w:val="64748B"/>
        <w:sz w:val="18"/>
      </w:rPr>
      <w:t>${escapeXml(title)}</w:t>
    </w:r>
  </w:p>
</w:hdr>`;
  }

  const FOOTER_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p>
    <w:pPr>
      <w:jc w:val="center"/>
    </w:pPr>
    <w:r>
      <w:rPr>
        <w:color w:val="94A3B8"/>
        <w:sz w:val="18"/>
      </w:rPr>
      <w:fldSimple w:instr="PAGE"/>
    </w:r>
    <w:r>
      <w:rPr>
        <w:color w:val="94A3B8"/>
        <w:sz w:val="18"/>
      </w:rPr>
      <w:t> of </w:t>
    </w:r>
    <w:r>
      <w:rPr>
        <w:color w:val="94A3B8"/>
        <w:sz w:val="18"/>
      </w:rPr>
      <w:fldSimple w:instr="NUMPAGES"/>
    </w:r>
  </w:p>
</w:ftr>`;

  // Build document.xml body from structured document
  function buildDocumentXml(doc) {
    const meta = doc.metadata || {};
    const title = meta.title || "Untitled Document";
    const subtitle = meta.subtitle || "";
    const author = meta.author || "Vela Intelligence";
    const date = meta.date || new Date().toLocaleDateString();

    const paragraphs = [];

    // 1. Title Page
    paragraphs.push(`
      <w:p>
        <w:pPr>
          <w:spacing w:before="2400" w:after="400"/>
          <w:jc w:val="center"/>
        </w:pPr>
        <w:r>
          <w:rPr>
            <w:b/>
            <w:sz w:val="56"/>
            <w:color w:val="0F172A"/>
          </w:rPr>
          <w:t>${escapeXml(title)}</w:t>
        </w:r>
      </w:p>
    `);

    if (subtitle) {
      paragraphs.push(`
        <w:p>
          <w:pPr>
            <w:spacing w:before="0" w:after="800"/>
            <w:jc w:val="center"/>
          </w:pPr>
          <w:r>
            <w:rPr>
              <w:sz w:val="28"/>
              <w:color w:val="475569"/>
            </w:rPr>
            <w:t>${escapeXml(subtitle)}</w:t>
          </w:r>
        </w:p>
      `);
    }

    paragraphs.push(`
      <w:p>
        <w:pPr>
          <w:spacing w:before="1200" w:after="200"/>
          <w:jc w:val="center"/>
        </w:pPr>
        <w:r>
          <w:rPr>
            <w:b/>
            <w:sz w:val="24"/>
            <w:color w:val="1E293B"/>
          </w:rPr>
          <w:t>${escapeXml(author)}</w:t>
        </w:r>
      </w:p>
      <w:p>
        <w:pPr>
          <w:spacing w:before="0" w:after="1600"/>
          <w:jc w:val="center"/>
        </w:pPr>
        <w:r>
          <w:rPr>
            <w:sz w:val="20"/>
            <w:color w:val="64748B"/>
          </w:rPr>
          <w:t>${escapeXml(date)}</w:t>
        </w:r>
      </w:p>
      <w:p>
        <w:r><w:br w:type="page"/></w:r>
      </w:p>
    `);

    // 2. Native Word Table of Contents field
    paragraphs.push(`
      <w:p>
        <w:pPr>
          <w:pStyle w:val="Heading1"/>
        </w:pPr>
        <w:r>
          <w:t>Table of Contents</w:t>
        </w:r>
      </w:p>
      <w:p>
        <w:fldSimple w:instr="TOC \\o &quot;1-3&quot; \\h \\z \\u"/>
      </w:p>
      <w:p>
        <w:r><w:br w:type="page"/></w:r>
      </w:p>
    `);

    // 3. Chapters & Content
    let figureCounter = 0;
    (doc.chapters || []).forEach((ch, chIdx) => {
      // Chapter page break (except if immediately after TOC)
      paragraphs.push(`
        <w:p>
          <w:pPr>
            <w:pStyle w:val="Heading1"/>
          </w:pPr>
          <w:r>
            <w:t>Chapter ${ch.number || chIdx + 1}: ${escapeXml(ch.title || "")}</w:t>
          </w:r>
        </w:p>
      `);

      (ch.elements || []).forEach((el) => {
        if (!el) return;

        if (el.type === "heading") {
          const style = el.level === 2 ? "Heading2" : el.level === 3 ? "Heading3" : "Normal";
          paragraphs.push(`
            <w:p>
              <w:pPr><w:pStyle w:val="${style}"/></w:pPr>
              <w:r><w:t>${escapeXml(el.text)}</w:t></w:r>
            </w:p>
          `);
        } else if (el.type === "paragraph") {
          paragraphs.push(`
            <w:p>
              <w:r><w:t>${escapeXml(el.text)}</w:t></w:r>
            </w:p>
          `);
        } else if (el.type === "code") {
          const lines = String(el.code || "").split("\n");
          lines.forEach((line) => {
            paragraphs.push(`
              <w:p>
                <w:pPr><w:pStyle w:val="CodeBlock"/></w:pPr>
                <w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r>
              </w:p>
            `);
          });
        } else if (el.type === "callout") {
          paragraphs.push(`
            <w:p>
              <w:pPr><w:pStyle w:val="BlockQuote"/></w:pPr>
              <w:r><w:t>${escapeXml(el.text)}</w:t></w:r>
            </w:p>
          `);
        } else if (el.type === "table") {
          figureCounter++;
          paragraphs.push(buildTableXml(el.headers || [], el.rows || []));
          paragraphs.push(`
            <w:p>
              <w:pPr><w:pStyle w:val="Caption"/></w:pPr>
              <w:r><w:t>Table ${ch.number || chIdx + 1}.${figureCounter}: Data Summary</w:t></w:r>
            </w:p>
          `);
        }
      });

      // Page break after chapter
      paragraphs.push(`
        <w:p>
          <w:r><w:br w:type="page"/></w:r>
        </w:p>
      `);
    });

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${paragraphs.join("\n")}
    <w:sectPr>
      <w:headerReference w:type="default" r:id="rId2"/>
      <w:footerReference w:type="default" r:id="rId3"/>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>
    </w:sectPr>
  </w:body>
</w:document>`;
  }

  function buildTableXml(headers, rows) {
    const colCount = Math.max(headers.length, ...rows.map((r) => r.length), 1);
    const colWidth = Math.floor(9360 / colCount);

    const headerRowXml = headers.length ? `
      <w:tr>
        <w:trPr><w:tblHeader/></w:trPr>
        ${headers.map((h) => `
          <w:tc>
            <w:tcPr>
              <w:tcW w:w="${colWidth}" w:type="dxa"/>
              <w:shd w:val="clear" w:color="auto" w:fill="E2E8F0"/>
            </w:tcPr>
            <w:p>
              <w:r><w:rPr><w:b/></w:rPr><w:t>${escapeXml(h)}</w:t></w:r>
            </w:p>
          </w:tc>
        `).join("")}
      </w:tr>
    ` : "";

    const bodyRowsXml = rows.map((r, rIdx) => `
      <w:tr>
        ${r.map((cell) => `
          <w:tc>
            <w:tcPr>
              <w:tcW w:w="${colWidth}" w:type="dxa"/>
              ${rIdx % 2 === 1 ? `<w:shd w:val="clear" w:color="auto" w:fill="F8FAFC"/>` : ""}
            </w:tcPr>
            <w:p>
              <w:r><w:t>${escapeXml(cell)}</w:t></w:r>
            </w:p>
          </w:tc>
        `).join("")}
      </w:tr>
    `).join("");

    return `
      <w:tbl>
        <w:tblPr>
          <w:tblW w:w="9360" w:type="dxa"/>
          <w:tblBorders>
            <w:top w:val="single" w:sz="6" w:space="0" w:color="CBD5E1"/>
            <w:left w:val="none"/>
            <w:bottom w:val="single" w:sz="6" w:space="0" w:color="CBD5E1"/>
            <w:right w:val="none"/>
            <w:insideH w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>
            <w:insideV w:val="none"/>
          </w:tblBorders>
        </w:tblPr>
        <w:tblGrid>
          ${Array(colCount).fill(`<w:gridCol w:w="${colWidth}"/>`).join("")}
        </w:tblGrid>
        ${headerRowXml}
        ${bodyRowsXml}
      </w:tbl>
    `;
  }

  // Generates genuine .docx binary package
  function generateDocx(structuredDoc) {
    const title = structuredDoc?.metadata?.title || "Document";
    const documentXml = buildDocumentXml(structuredDoc);
    const headerXml = buildHeaderXml(title);

    const files = [
      { path: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { path: "_rels/.rels", content: ROOT_RELS_XML },
      { path: "word/_rels/document.xml.rels", content: DOCUMENT_RELS_XML },
      { path: "word/document.xml", content: documentXml },
      { path: "word/styles.xml", content: STYLES_XML },
      { path: "word/header1.xml", content: headerXml },
      { path: "word/footer1.xml", content: FOOTER_XML }
    ];

    if (typeof globalThis.VelaExport?.createZip === "function") {
      return globalThis.VelaExport.createZip(files);
    }

    throw new Error("VelaExport.createZip is required to pack DOCX files.");
  }

  function downloadDocx(structuredDoc, filename = "document.docx") {
    const bytes = generateDocx(structuredDoc);
    const blob = new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename.endsWith(".docx") ? filename : `${filename}.docx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  globalThis.VelaDocxEngine = Object.freeze({
    generateDocx,
    downloadDocx,
    buildDocumentXml
  });
})();
