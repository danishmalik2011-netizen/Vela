(() => {
  "use strict";

  // Standard Page dimensions (points: 72 points = 1 inch)
  const LETTER_WIDTH = 612;
  const LETTER_HEIGHT = 792;
  const MARGIN = 54;
  const CONTENT_WIDTH = LETTER_WIDTH - (MARGIN * 2);
  const CONTENT_HEIGHT = LETTER_HEIGHT - (MARGIN * 2);

  function toRoman(num) {
    const lookup = { m: 1000, cm: 900, d: 500, cd: 400, c: 100, xc: 90, l: 50, xl: 40, x: 10, ix: 9, v: 5, iv: 4, i: 1 };
    let roman = "";
    let n = num;
    for (const i in lookup) {
      while (n >= lookup[i]) {
        roman += i;
        n -= lookup[i];
      }
    }
    return roman || "i";
  }

  function escapePdf(str) {
    return String(str || "")
      .replace(/\\/g, "\\\\")
      .replace(/\(/g, "\\(")
      .replace(/\)/g, "\\)")
      .replace(/[^\x20-\x7E]/g, (c) => {
        // Fallback for non-ASCII
        const map = { "—": "--", "–": "-", "“": '"', "”": '"', "‘": "'", "’": "'", "…": "...", "•": "*" };
        return map[c] || "?";
      });
  }

  function wrapText(text, maxCharsPerLine = 80) {
    const words = String(text || "").split(/\s+/);
    const lines = [];
    let current = "";

    for (const w of words) {
      if ((current + " " + w).trim().length <= maxCharsPerLine) {
        current = (current + " " + w).trim();
      } else {
        if (current) lines.push(current);
        current = w;
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  // Typesets a structured document into book pages
  async function typesetBook(structuredDoc, onProgress = () => {}) {
    const meta = structuredDoc.metadata || {};
    const title = meta.title || "Untitled Book";
    const subtitle = meta.subtitle || "";
    const author = meta.author || "Vela Intelligence";
    const date = meta.date || new Date().getFullYear();

    const pages = [];

    // --- Page 1: Cover / Title Page ---
    pages.push({
      kind: "cover",
      pageNumberStr: "",
      commands: [
        // Dark accent bar at top
        "0.08 0.12 0.20 rg",
        `0 ${LETTER_HEIGHT - 180} ${LETTER_WIDTH} 180 re f`,

        // Cover Title
        "1.0 1.0 1.0 rg",
        `BT /F2 28 Tf ${MARGIN} ${LETTER_HEIGHT - 100} Td (${escapePdf(title)}) Tj ET`,

        // Cover Subtitle
        "0.80 0.85 0.95 rg",
        subtitle ? `BT /F3 14 Tf ${MARGIN} ${LETTER_HEIGHT - 135} Td (${escapePdf(subtitle)}) Tj ET` : "",

        // Body area metadata
        "0.15 0.20 0.28 rg",
        `BT /F2 14 Tf ${MARGIN} 240 Td (AUTHOR:) Tj ET`,
        "0.30 0.35 0.45 rg",
        `BT /F1 14 Tf ${MARGIN + 80} 240 Td (${escapePdf(author)}) Tj ET`,

        `BT /F2 12 Tf ${MARGIN} 200 Td (DATE:) Tj ET`,
        "0.40 0.45 0.55 rg",
        `BT /F1 12 Tf ${MARGIN + 80} 200 Td (${escapePdf(String(date))}) Tj ET`,

        // Publisher mark
        "0.50 0.55 0.65 rg",
        `BT /F3 10 Tf ${MARGIN} 70 Td (Published by Vela Intelligence Publishing System) Tj ET`
      ].filter(Boolean)
    });

    // --- Page 2: Table of Contents (Front Matter, Roman pagination) ---
    const tocCommands = [
      "0.10 0.14 0.22 rg",
      `BT /F2 20 Tf ${MARGIN} ${LETTER_HEIGHT - 90} Td (Table of Contents) Tj ET`,
      `0.80 0.82 0.88 RG 0.75 w ${MARGIN} ${LETTER_HEIGHT - 102} m ${LETTER_WIDTH - MARGIN} ${LETTER_HEIGHT - 102} l S`
    ];

    let tocY = LETTER_HEIGHT - 130;
    (structuredDoc.toc || []).forEach((ch) => {
      if (tocY < 100) return;
      const chText = `Chapter ${ch.number}: ${ch.title}`;
      const pageStr = String(ch.page || 1);

      tocCommands.push("0.10 0.15 0.25 rg");
      tocCommands.push(`BT /F2 11 Tf ${MARGIN} ${tocY} Td (${escapePdf(chText)}) Tj ET`);

      // Leader dots & page
      tocCommands.push("0.45 0.50 0.60 rg");
      tocCommands.push(`BT /F2 11 Tf ${LETTER_WIDTH - MARGIN - 30} ${tocY} Td (${escapePdf(pageStr)}) Tj ET`);
      tocY -= 20;

      // Section items
      (ch.sections || []).slice(0, 4).forEach((sec) => {
        if (tocY < 100) return;
        tocCommands.push("0.35 0.40 0.50 rg");
        tocCommands.push(`BT /F1 9.5 Tf ${MARGIN + 16} ${tocY} Td (${escapePdf(`${sec.id} ${sec.title}`)}) Tj ET`);
        tocCommands.push(`BT /F1 9.5 Tf ${LETTER_WIDTH - MARGIN - 26} ${tocY} Td (${escapePdf(String(sec.page || ch.page))}) Tj ET`);
        tocY -= 16;
      });
      tocY -= 8;
    });

    pages.push({
      kind: "toc",
      pageNumberStr: "ii",
      commands: tocCommands
    });

    // --- Pages 3+: Body Chapters (Arabic Pagination) ---
    let bodyPageNum = 1;

    for (let cIdx = 0; cIdx < (structuredDoc.chapters || []).length; cIdx++) {
      const ch = structuredDoc.chapters[cIdx];
      onProgress({ current: cIdx + 1, total: structuredDoc.chapters.length, phase: "typesetting" });

      // Yield event loop for responsiveness
      await new Promise((r) => setTimeout(r, 0));

      let currentCommands = [];
      let cursorY = LETTER_HEIGHT - MARGIN - 40;

      function startNewPage(headerTitle) {
        if (currentCommands.length) {
          pages.push({
            kind: "body",
            chapterTitle: headerTitle,
            pageNumberStr: String(bodyPageNum++),
            commands: currentCommands
          });
        }
        currentCommands = [];
        cursorY = LETTER_HEIGHT - MARGIN - 40;
      }

      // Chapter Header Banner
      currentCommands.push("0.08 0.12 0.20 rg");
      currentCommands.push(`BT /F2 20 Tf ${MARGIN} ${cursorY} Td (Chapter ${ch.number}: ${escapePdf(ch.title)}) Tj ET`);
      cursorY -= 12;
      currentCommands.push(`0.80 0.82 0.88 RG 0.5 w ${MARGIN} ${cursorY} m ${LETTER_WIDTH - MARGIN} ${cursorY} l S`);
      cursorY -= 24;

      for (const el of ch.elements || []) {
        if (cursorY < MARGIN + 60) {
          startNewPage(ch.title);
        }

        if (el.type === "heading") {
          cursorY -= 14;
          const sz = el.level === 2 ? 14 : 12;
          const font = "/F2";
          currentCommands.push("0.12 0.16 0.24 rg");
          currentCommands.push(`BT ${font} ${sz} Tf ${MARGIN} ${cursorY} Td (${escapePdf(el.text)}) Tj ET`);
          cursorY -= sz + 8;
        } else if (el.type === "paragraph") {
          const lines = wrapText(el.text, 78);
          currentCommands.push("0.18 0.22 0.28 rg");
          for (const line of lines) {
            if (cursorY < MARGIN + 40) {
              startNewPage(ch.title);
              currentCommands.push("0.18 0.22 0.28 rg");
            }
            currentCommands.push(`BT /F1 10 Tf ${MARGIN} ${cursorY} Td (${escapePdf(line)}) Tj ET`);
            cursorY -= 14;
          }
          cursorY -= 6;
        } else if (el.type === "code") {
          const codeLines = (el.code || "").split("\n");
          const blockH = Math.min(codeLines.length * 12 + 14, 250);

          if (cursorY - blockH < MARGIN + 40) {
            startNewPage(ch.title);
          }

          // Shaded background box
          currentCommands.push("0.95 0.96 0.98 rg");
          currentCommands.push(`${MARGIN} ${cursorY - blockH + 10} ${CONTENT_WIDTH} ${blockH} re f`);
          currentCommands.push("0.85 0.87 0.92 RG 0.5 w");
          currentCommands.push(`${MARGIN} ${cursorY - blockH + 10} ${CONTENT_WIDTH} ${blockH} re S`);

          cursorY -= 10;
          currentCommands.push("0.10 0.15 0.25 rg");
          for (const cLine of codeLines.slice(0, 18)) {
            currentCommands.push(`BT /F4 8.5 Tf ${MARGIN + 10} ${cursorY} Td (${escapePdf(cLine)}) Tj ET`);
            cursorY -= 12;
          }
          cursorY -= 14;
        } else if (el.type === "callout") {
          const calloutLines = wrapText(el.text, 72);
          const boxH = calloutLines.length * 13 + 14;

          if (cursorY - boxH < MARGIN + 40) {
            startNewPage(ch.title);
          }

          currentCommands.push("0.96 0.98 1.0 rg");
          currentCommands.push(`${MARGIN} ${cursorY - boxH + 8} ${CONTENT_WIDTH} ${boxH} re f`);
          currentCommands.push("0.23 0.51 0.96 RG 2.0 w");
          currentCommands.push(`${MARGIN} ${cursorY - boxH + 8} m ${MARGIN} ${cursorY + 8} l S`);

          cursorY -= 6;
          currentCommands.push("0.20 0.28 0.40 rg");
          for (const qLine of calloutLines) {
            currentCommands.push(`BT /F3 9.5 Tf ${MARGIN + 14} ${cursorY} Td (${escapePdf(qLine)}) Tj ET`);
            cursorY -= 13;
          }
          cursorY -= 14;
        } else if (el.type === "table") {
          const headers = el.headers || [];
          const rows = el.rows || [];
          const colW = Math.floor(CONTENT_WIDTH / Math.max(headers.length, 1));
          const tblH = (rows.length + 1) * 16 + 10;

          if (cursorY - tblH < MARGIN + 40) {
            startNewPage(ch.title);
          }

          // Header row
          currentCommands.push("0.90 0.92 0.96 rg");
          currentCommands.push(`${MARGIN} ${cursorY - 14} ${CONTENT_WIDTH} 16 re f`);
          currentCommands.push("0.10 0.15 0.25 rg");
          headers.forEach((h, idx) => {
            currentCommands.push(`BT /F2 9 Tf ${MARGIN + (idx * colW) + 6} ${cursorY - 10} Td (${escapePdf(h)}) Tj ET`);
          });
          cursorY -= 18;

          // Rows
          rows.slice(0, 10).forEach((r, rIdx) => {
            if (rIdx % 2 === 1) {
              currentCommands.push("0.97 0.98 0.99 rg");
              currentCommands.push(`${MARGIN} ${cursorY - 12} ${CONTENT_WIDTH} 14 re f`);
            }
            currentCommands.push("0.20 0.25 0.35 rg");
            r.forEach((c, idx) => {
              currentCommands.push(`BT /F1 8.5 Tf ${MARGIN + (idx * colW) + 6} ${cursorY - 8} Td (${escapePdf(c)}) Tj ET`);
            });
            cursorY -= 14;
          });
          cursorY -= 12;
        }
      }

      if (currentCommands.length) {
        pages.push({
          kind: "body",
          chapterTitle: ch.title,
          pageNumberStr: String(bodyPageNum++),
          commands: currentCommands
        });
      }
    }

    // Add running headers & footers to non-cover pages
    pages.forEach((p) => {
      if (p.kind === "cover") return;

      // Running Header (Chapter title on right, book title on left)
      p.commands.push(
        "0.50 0.55 0.65 rg",
        `BT /F3 8 Tf ${MARGIN} ${LETTER_HEIGHT - 32} Td (${escapePdf(title)}) Tj ET`,
        p.chapterTitle ? `BT /F3 8 Tf ${LETTER_WIDTH - MARGIN - 180} ${LETTER_HEIGHT - 32} Td (${escapePdf(p.chapterTitle.slice(0, 32))}) Tj ET` : "",
        `0.85 0.87 0.92 RG 0.5 w ${MARGIN} ${LETTER_HEIGHT - 38} m ${LETTER_WIDTH - MARGIN} ${LETTER_HEIGHT - 38} l S`
      );

      // Running Footer (Page number centered)
      p.commands.push(
        `0.85 0.87 0.92 RG 0.5 w ${MARGIN} 38 m ${LETTER_WIDTH - MARGIN} 38 l S`,
        "0.40 0.45 0.55 rg",
        `BT /F1 9 Tf ${LETTER_WIDTH / 2 - 10} 24 Td (${escapePdf(p.pageNumberStr)}) Tj ET`
      );
    });

    return pages;
  }

  // Assembles standard PDF 1.4 binary
  async function buildBookPdf(structuredDoc, onProgress = () => {}) {
    const pages = await typesetBook(structuredDoc, onProgress);

    const encoder = new TextEncoder();
    const chunks = [];

    function append(str) {
      chunks.push(encoder.encode(str));
    }

    const objects = [];
    function addObject(content) {
      const id = objects.length + 1;
      objects.push({ id, content });
      return id;
    }

    // Header
    append("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");

    const catalogId = addObject("<< /Type /Catalog /Pages 2 0 R >>");
    const pagesId = addObject(""); // Updated after

    // Fonts: Helvetica, Helvetica-Bold, Helvetica-Oblique, Courier
    const f1 = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const f2 = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const f3 = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>");
    const f4 = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>");

    const meta = structuredDoc.metadata || {};
    const infoId = addObject(`<< /Title (${escapePdf(meta.title || "Book")}) /Author (${escapePdf(meta.author || "Vela")}) /Creator (Vela Publishing System) >>`);

    const pageObjectIds = [];

    for (const page of pages) {
      const streamContent = page.commands.join("\n");
      const streamId = addObject(`<< /Length ${streamContent.length} >>\nstream\n${streamContent}\nendstream`);

      const pageId = addObject(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${LETTER_WIDTH} ${LETTER_HEIGHT}] /Contents ${streamId} 0 R /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R /F3 ${f3} 0 R /F4 ${f4} 0 R >> >> >>`);
      pageObjectIds.push(pageId);
    }

    // Update Pages dictionary
    objects[1].content = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageObjectIds.length} >>`;

    // Write Objects & compute XRef
    const offsets = [0];
    let currentOffset = chunks[0].length;

    for (const obj of objects) {
      offsets.push(currentOffset);
      const str = `${obj.id} 0 obj\n${obj.content}\nendobj\n`;
      append(str);
      currentOffset += encoder.encode(str).length;
    }

    // Write XRef Table
    const startXref = currentOffset;
    append(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
    for (let i = 1; i <= objects.length; i++) {
      const offStr = String(offsets[i]).padStart(10, "0");
      append(`${offStr} 00000 n \n`);
    }

    // Trailer
    append(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${startXref}\n%%EOF\n`);

    const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
    const pdfBytes = new Uint8Array(totalLen);
    let pos = 0;
    for (const c of chunks) {
      pdfBytes.set(c, pos);
      pos += c.length;
    }

    return pdfBytes;
  }

  function downloadBookPdf(structuredDoc, filename = "book.pdf") {
    buildBookPdf(structuredDoc).then((bytes) => {
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  globalThis.VelaBookPdfEngine = Object.freeze({
    typesetBook,
    buildBookPdf,
    downloadBookPdf
  });
})();
