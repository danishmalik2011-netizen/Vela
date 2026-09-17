(() => {
  "use strict";

  // PDF page dimensions in points (72 points = 1 inch)
  const PAGE_SIZES = Object.freeze({
    letter: { width: 612, height: 792 },
    a4: { width: 595.28, height: 841.89 },
    legal: { width: 612, height: 1008 }
  });

  /**
   * Translates LaTeX mathematical expressions into clean, elegant typographic Unicode symbols.
   */
  function normalizeLatexMath(input) {
    if (!input) return "";
    let str = String(input);

    // 1. Fractions with standard unicode fractions
    str = str
      .replace(/\\frac\{1\}\{2\}/g, "½")
      .replace(/\\frac\{1\}\{4\}/g, "¼")
      .replace(/\\frac\{3\}\{4\}/g, "¾")
      .replace(/\\frac\{1\}\{3\}/g, "⅓")
      .replace(/\\frac\{2\}\{3\}/g, "⅔")
      .replace(/\\frac\{1\}\{8\}/g, "⅛")
      .replace(/\\frac\{3\}\{8\}/g, "⅜")
      .replace(/\\frac\{5\}\{8\}/g, "⅝")
      .replace(/\\frac\{7\}\{8\}/g, "⅞")
      .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, (_m, num, den) => {
        const n = num.trim();
        const d = den.trim();
        if (/^[\w\d]+$/.test(n) && /^[\w\d]+$/.test(d)) return `${n}/${d}`;
        return `(${n})/(${d})`;
      });

    // 2. Vectors and unit vectors (hats)
    str = str
      .replace(/\\vec\{([a-zA-Z0-9]+)\}/g, "$1⃗")
      .replace(/\\hat\{i\}/g, "î")
      .replace(/\\hat\{j\}/g, "ĵ")
      .replace(/\\hat\{k\}/g, "k̂")
      .replace(/\\hat\{([a-zA-Z0-9]+)\}/g, "$1̂");

    // 3. Degrees, powers, superscripts
    str = str
      .replace(/\^\{\\circ\}|\^\\circ/g, "°")
      .replace(/\^0/g, "⁰").replace(/\^1/g, "¹").replace(/\^2/g, "²").replace(/\^3/g, "³")
      .replace(/\^4/g, "⁴").replace(/\^5/g, "⁵").replace(/\^6/g, "⁶").replace(/\^7/g, "⁷")
      .replace(/\^8/g, "⁸").replace(/\^9/g, "⁹")
      .replace(/\^\{([0-9]+)\}/g, (_m, p) => p.split("").map((c) => "⁰¹²³⁴⁵⁶⁷⁸⁹"[c] || c).join(""))
      .replace(/\^\{?-1\}?/g, "⁻¹").replace(/\^\{?-2\}?/g, "⁻²")
      .replace(/\^\{?\+([0-9]*)\}?/g, "⁺$1").replace(/\^\{?-([0-9]*)\}?/g, "⁻$1");

    // 4. Subscripts
    str = str
      .replace(/_([0-9])/g, (_m, d) => "₀₁₂₃₄₅₆₇₈₉"[d] || d)
      .replace(/_\{([0-9]+)\}/g, (_m, digits) => digits.split("").map((d) => "₀₁₂₃₄₅₆₇₈₉"[d] || d).join(""))
      .replace(/_\{?([ijkxy])\}?/g, (_m, l) => ({ i: "ᵢ", j: "ⱼ", k: "ₖ", x: "ₓ", y: "ᵧ" }[l] || `_${l}`));

    // 5. Relational and mathematical operators
    str = str
      .replace(/\\gg\b/g, "≫")
      .replace(/\\ll\b/g, "≪")
      .replace(/\\geq?\b/g, "≥")
      .replace(/\\leq?\b/g, "≤")
      .replace(/\\neq?\b/g, "≠")
      .replace(/\\approx\b/g, "≈")
      .replace(/\\pm\b/g, "±")
      .replace(/\\mp\b/g, "∓")
      .replace(/\\times\b/g, "×")
      .replace(/\\div\b/g, "÷")
      .replace(/\\cdot\b/g, "·")
      .replace(/\\to\b|\\rightarrow\b/g, "→")
      .replace(/\\leftarrow\b/g, "←")
      .replace(/\\leftrightarrow\b/g, "↔")
      .replace(/\\infty\b/g, "∞")
      .replace(/\\sqrt\{([^}]+)\}/g, "√($1)")
      .replace(/\\sqrt\b/g, "√");

    // 6. Greek letters
    str = str
      .replace(/\\alpha\b/g, "α")
      .replace(/\\beta\b/g, "β")
      .replace(/\\gamma\b/g, "γ")
      .replace(/\\theta\b/g, "θ")
      .replace(/\\lambda\b/g, "λ")
      .replace(/\\mu\b/g, "μ")
      .replace(/\\pi\b/g, "π")
      .replace(/\\rho\b/g, "ρ")
      .replace(/\\sigma\b/g, "σ")
      .replace(/\\tau\b/g, "τ")
      .replace(/\\phi\b/g, "φ")
      .replace(/\\omega\b/g, "ω")
      .replace(/\\Delta\b/g, "Δ")
      .replace(/\\Sigma\b/g, "Σ")
      .replace(/\\Omega\b/g, "Ω");

    // 7. Math font / text wrappers
    str = str
      .replace(/\\(?:text|mathrm|mathbf|mathit|textbf|textit)\{([^}]+)\}/g, "$1")
      // 8. Delimiters
      .replace(/\\\((.*?)\\\)/gs, "$1")
      .replace(/\\\[(.*?)\\\]/gs, "$1")
      .replace(/\$([^\$\n]+)\$/g, "$1")
      .replace(/\\([()[\]{}])/g, "$1");

    return str;
  }

  /**
   * Strip markdown syntax markers and leaked HTML code from text so that the binary PDF
   * and canvas render clean, professional typography without raw tags or symbols.
   */
  function cleanMarkdownFormatting(input) {
    if (!input) return "";
    let text = String(input)
      // Strip HTML style and script blocks
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      // Strip HTML comments
      .replace(/<!--[\s\S]*?-->/g, "")
      // Convert break tags
      .replace(/<br\s*\/?>/gi, " ")
      // Strip structural & inline HTML tags (<div...>, </span>, etc.)
      .replace(/<\/?[a-zA-Z][a-zA-Z0-9:-]*(?:\s+[^>]*)?>/g, "");

    // Normalize LaTeX math expressions before stripping markdown
    text = normalizeLatexMath(text);

    return text
      // Strip bold + italic: ***text*** or ___text___
      .replace(/\*{3}([^*]+?)\*{3}/g, "$1")
      .replace(/_{3}([^_]+?)_{3}/g, "$1")
      // Strip bold: **text** or __text__
      .replace(/\*{2}([^*]+?)\*{2}/g, "$1")
      .replace(/_{2}([^_]+?)_{2}/g, "$1")
      // Strip italic: *text* or _text_
      .replace(/\*([^*]+?)\*/g, "$1")
      .replace(/(^|\s)_([^_]+?)_($|\s)/g, "$1$2$3")
      // Strip strikethrough: ~~text~~
      .replace(/~~([^~]+?)~~/g, "$1")
      // Strip inline code: `code`
      .replace(/`([^`]+?)`/g, "$1")
      // Strip markdown links: [label](url) -> label
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      // Strip image tags: ![alt](url) -> alt
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      // Remove leading markdown heading hashes (# Title -> Title)
      .replace(/^#{1,6}\s+/, "")
      // Remove trailing hashes
      .replace(/\s+#{1,6}$/, "")
      // Remove horizontal rule markers on isolated lines
      .replace(/^(?:[-*_]\s*){3,}$/, "")
      // Clean up multiple spaces
      .replace(/[ \t]+/g, " ")
      .trim();
  }

  /**
   * Transform inline markdown tokens into rich HTML elements for the interactive DOM preview.
   */
  function renderInlineMarkdown(input, escapeFn) {
    if (!input) return "";
    let str = String(input)
      // Strip structural/inline HTML tags so raw HTML is never escaped and printed as plain text
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/?[a-zA-Z][a-zA-Z0-9:-]*(?:\s+[^>]*)?>/g, "");

    // Normalize LaTeX math expressions
    str = normalizeLatexMath(str);

    const escape = escapeFn || ((val) => String(val ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"));
    const safe = escape(str);

    return safe
      // Bold + Italic: ***text*** or ___text___
      .replace(/\*\*\*([^*]+?)\*\*\*/g, "<strong><em>$1</em></strong>")
      .replace(/___([^_]+?)___/g, "<strong><em>$1</em></strong>")
      // Bold: **text** or __text__
      .replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>")
      .replace(/__([^_]+?)__/g, "<strong>$1</strong>")
      // Italic: *text* or _text_
      .replace(/\*([^*]+?)\*/g, "<em>$1</em>")
      .replace(/(^|\s)_([^_]+?)_($|\s)/g, "$1<em>$2</em>$3")
      // Strikethrough: ~~text~~
      .replace(/~~([^~]+?)~~/g, "<del>$1</del>")
      // Inline code: `code`
      .replace(/`([^`]+?)`/g, '<code class="artifact-pdf-inline-code">$1</code>')
      // Markdown link: [text](url)
      .replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/)[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="artifact-pdf-link">$1</a>');
  }

  const UNICODE_TRANSLITERATION = Object.freeze({
    "θ": "theta", "α": "alpha", "β": "beta", "γ": "gamma", "λ": "lambda",
    "μ": "u", "π": "pi", "ρ": "rho", "σ": "sigma", "τ": "tau", "φ": "phi", "ω": "omega",
    "Δ": "Delta", "Σ": "Sigma", "Ω": "Omega",
    "≫": ">>", "≪": "<<", "≥": ">=", "≤": "<=", "≠": "!=", "≈": "~",
    "→": "->", "←": "<-", "↔": "<->", "∞": "inf", "√": "sqrt",
    "î": "i^", "ĵ": "j^", "k̂": "k^", "î": "i^", "ĵ": "j^",
    "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9",
    "ᵢ": "i", "ⱼ": "j", "ₖ": "k", "ₓ": "x", "ᵧ": "y",
    "⁰": "^0", "⁴": "^4", "⁵": "^5", "⁶": "^6", "⁷": "^7", "⁸": "^8", "⁹": "^9",
    "⁺": "^+", "⁻": "^-", "′": "'", "″": '"', "·": "*", "—": "--", "–": "-"
  });

  function sanitizePdfText(input) {
    return String(input ?? "")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/\u2014/g, "--")
      .replace(/\u2013/g, "-")
      .replace(/\u2026/g, "...")
      .replace(/[\u2022\u2023\u25E6]/g, "*")
      .replace(/\u00A0/g, " ")
      .replace(/([a-zA-Z])\u20D7/g, "$1") // Strip combining vector arrow
      .replace(/[^\x00-\x7F]/g, (char) => {
        if (UNICODE_TRANSLITERATION[char]) {
          return UNICODE_TRANSLITERATION[char];
        }
        const code = char.charCodeAt(0);
        return code <= 255 ? char : "?";
      });
  }

  function escapePdfString(str) {
    const cleaned = cleanMarkdownFormatting(str);
    const sanitized = sanitizePdfText(cleaned);
    return sanitized
      .replace(/\\/g, "\\\\")
      .replace(/\(/g, "\\(")
      .replace(/\)/g, "\\)");
  }

  function measureTextWidth(text, size) {
    let width = 0;
    const str = cleanMarkdownFormatting(String(text ?? ""));
    for (let index = 0; index < str.length; index += 1) {
      const char = str[index];
      const code = char.charCodeAt(0);
      if (code === 32) width += 0.28;
      else if (code >= 65 && code <= 90) width += 0.65;
      else if ("ijlrtf1".includes(char)) width += 0.30;
      else if ("mwMW@%#".includes(char)) width += 0.78;
      else width += 0.52;
    }
    return width * size;
  }

  function wrapText(text, size, maxWidth) {
    const cleaned = cleanMarkdownFormatting(String(text ?? ""));
    const words = cleaned.split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const lines = [];
    let currentLine = words[0];

    for (let index = 1; index < words.length; index += 1) {
      const candidate = `${currentLine} ${words[index]}`;
      if (measureTextWidth(candidate, size) <= maxWidth) {
        currentLine = candidate;
      } else {
        lines.push(currentLine);
        currentLine = words[index];
      }
    }
    if (currentLine) lines.push(currentLine);
    return lines;
  }

  function extractMcqOptions(text) {
    if (!text || typeof text !== "string") return null;

    // Check for inline 4 options: (1) ... (2) ... (3) ... (4) ... or (A)...(D) or (a)...(d)
    const inlinePattern = /^(.*?)(?:\s+|^)(?:\(|\[)?(1|[Aa])(?:\)|\]|\.|\:)\s+(.*?)(?:\s+)(?:\(|\[)?(2|[Bb])(?:\)|\]|\.|\:)\s+(.*?)(?:\s+)(?:\(|\[)?(3|[Cc])(?:\)|\]|\.|\:)\s+(.*?)(?:\s+)(?:\(|\[)?(4|[Dd])(?:\)|\]|\.|\:)\s+(.*)$/s;
    const match = text.trim().match(inlinePattern);
    if (match) {
      let stem = match[1].trim();
      let qNum = null;
      const numMatch = stem.match(/^(\d+)[\.\)]\s*(.*)$/);
      if (numMatch) {
        qNum = Number(numMatch[1]);
        stem = numMatch[2].trim();
      }

      const opt1 = match[3].trim();
      const opt2 = match[5].trim();
      const opt3 = match[7].trim();
      const opt4 = match[9].trim();

      const maxLen = Math.max(opt1.length, opt2.length, opt3.length, opt4.length);
      const layout = maxLen <= 38 ? "grid" : "stacked";

      return {
        number: qNum,
        stem: cleanMarkdownFormatting(stem),
        rawStem: stem,
        options: [
          { label: `(${match[2]})`, text: cleanMarkdownFormatting(opt1), rawText: opt1 },
          { label: `(${match[4]})`, text: cleanMarkdownFormatting(opt2), rawText: opt2 },
          { label: `(${match[6]})`, text: cleanMarkdownFormatting(opt3), rawText: opt3 },
          { label: `(${match[8]})`, text: cleanMarkdownFormatting(opt4), rawText: opt4 }
        ],
        layout
      };
    }

    return null;
  }

  function splitMultipleQuestions(text) {
    if (!text || typeof text !== "string") return [];
    const trimmed = text.trim();
    if (!trimmed) return [];

    const qRegex = /(?:^|[\s\n])(?:Q)?(\d+)[\.\)]\s+/g;
    const matches = [...trimmed.matchAll(qRegex)];

    if (matches.length <= 1) {
      const single = extractMcqOptions(trimmed);
      if (single) return [single];
      const m = trimmed.match(/^(?:Q)?(\d+)[\.\)]\s+([\s\S]+)$/);
      if (m) {
        return [{
          type: "question",
          number: Number(m[1]),
          stem: cleanMarkdownFormatting(m[2].trim()),
          rawStem: m[2].trim(),
          options: [],
          layout: "stacked"
        }];
      }
      return null;
    }

    const questions = [];
    for (let i = 0; i < matches.length; i++) {
      const qNum = Number(matches[i][1]);
      const start = matches[i].index + matches[i][0].length;
      const end = i + 1 < matches.length ? matches[i + 1].index : trimmed.length;
      const chunk = trimmed.slice(start, end).trim();

      const mcq = extractMcqOptions(chunk);
      if (mcq) {
        questions.push({
          type: "question",
          number: qNum,
          stem: mcq.stem,
          rawStem: mcq.rawStem,
          options: mcq.options,
          layout: mcq.layout
        });
      } else {
        const optRegex = /(?:^|\s+)(?:\(|\[)?(1|2|3|4|[A-Da-d])(?:\)|\]|\.|\:)\s+([\s\S]*?)(?=(?:\s+(?:\(|\[)?(1|2|3|4|[A-Da-d])(?:\)|\]|\.|\:)\s+)|$)/g;
        const optMatches = [...chunk.matchAll(optRegex)];
        if (optMatches.length >= 2) {
          const stem = chunk.slice(0, optMatches[0].index).trim();
          const options = optMatches.map((om) => ({
            label: `(${om[1]})`,
            text: cleanMarkdownFormatting(om[2].trim()),
            rawText: om[2].trim()
          }));
          const maxLen = Math.max(...options.map((o) => (o.text || "").length));
          questions.push({
            type: "question",
            number: qNum,
            stem: cleanMarkdownFormatting(stem),
            rawStem: stem,
            options,
            layout: maxLen <= 38 ? "grid" : "stacked"
          });
        } else {
          questions.push({
            type: "question",
            number: qNum,
            stem: cleanMarkdownFormatting(chunk),
            rawStem: chunk,
            options: [],
            layout: "stacked"
          });
        }
      }
    }
    return questions;
  }

  function normalizeOption(opt, idx = 0) {
    if (!opt) return { label: `(${idx + 1})`, text: "", rawText: "" };
    if (typeof opt === "string") {
      const m = opt.match(/^(?:\(|\[)?(1|2|3|4|[A-Da-d])(?:\)|\]|\.|\:)\s*(.*)$/);
      if (m) {
        return { label: `(${m[1]})`, text: cleanMarkdownFormatting(m[2].trim()), rawText: m[2].trim() };
      }
      return { label: `(${idx + 1})`, text: cleanMarkdownFormatting(opt.trim()), rawText: opt.trim() };
    }
    const label = opt.label || `(${idx + 1})`;
    const text = cleanMarkdownFormatting(opt.text || opt.rawText || "");
    const rawText = opt.rawText || opt.text || "";
    return { label, text, rawText };
  }

  function estimateElementHeight(element, availWidth = 520) {
    if (!element || typeof element !== "object") return 0;

    if (element.type === "exam_header") {
      const metaRows = Math.ceil((element.metadata?.length || 1) / 3);
      return 45 + (element.subtitle ? 16 : 0) + (metaRows * 14) + 16;
    }

    if (element.type === "question") {
      const fontSize = 9.5;
      const numStr = element.number != null ? String(element.number).trim() : "";
      const qPrefix = numStr ? (numStr.endsWith(".") ? `${numStr} ` : `${numStr}. `) : "";
      const stemText = `${qPrefix}${element.stem || ""}`;
      const lines = wrapText(cleanMarkdownFormatting(stemText), fontSize, availWidth);
      const stemH = (Math.max(1, lines.length) * 13) + 4;
      const opts = (Array.isArray(element.options) ? element.options : []).map(normalizeOption);
      let optH = 0;
      if (element.layout === "grid") {
        optH = 28; // 2 rows of 14pt
      } else {
        opts.forEach((opt) => {
          const optLines = wrapText(cleanMarkdownFormatting(`${opt.label} ${opt.text}`), 9, availWidth - 12);
          optH += (Math.max(1, optLines.length) * 12) + 2;
        });
      }
      return stemH + optH + 8;
    }

    if (element.type === "heading") {
      const level = Number(element.level || 1);
      const fontSize = level === 1 ? 18 : level === 2 ? 14 : 11;
      const spacing = level === 1 ? 26 : level === 2 ? 20 : 16;
      const lines = wrapText(cleanMarkdownFormatting(element.text || element.rawText || ""), fontSize, availWidth);
      const lineCount = Math.max(1, lines.length);
      return spacing + (lineCount * (fontSize + 4)) + 4;
    }

    if (element.type === "paragraph") {
      const fontSize = 10;
      const lines = wrapText(cleanMarkdownFormatting(element.text || element.rawText || ""), fontSize, availWidth);
      const lineCount = Math.max(1, lines.length);
      return (lineCount * 14) + 8;
    }

    if (element.type === "bullet_list") {
      const fontSize = 9.5;
      const bulletIndent = 14;
      let height = 6;
      const items = Array.isArray(element.items) ? element.items : [];
      items.forEach((item) => {
        const lines = wrapText(cleanMarkdownFormatting(item), fontSize, availWidth - bulletIndent);
        const lineCount = Math.max(1, lines.length);
        height += 13 + ((lineCount - 1) * 12) + 2;
      });
      return height;
    }

    if (element.type === "numbered_list") {
      const fontSize = 9.5;
      const numIndent = 18;
      let height = 6;
      const items = Array.isArray(element.items) ? element.items : [];
      items.forEach((item) => {
        const lines = wrapText(cleanMarkdownFormatting(item), fontSize, availWidth - numIndent);
        const lineCount = Math.max(1, lines.length);
        height += 13 + ((lineCount - 1) * 12) + 2;
      });
      return height;
    }

    if (element.type === "code_block") {
      const codeLines = String(element.code || "").split("\n");
      const boxHeight = Math.min(220, (codeLines.length * 11) + 16);
      return boxHeight + 12;
    }

    if (element.type === "callout") {
      const fontSize = 9.5;
      const padding = 10;
      const lines = wrapText(cleanMarkdownFormatting(element.text || element.rawText || ""), fontSize, availWidth - (padding * 2) - 4);
      const lineCount = Math.max(1, lines.length);
      const boxHeight = (lineCount * 13) + (padding * 2);
      return boxHeight + 14;
    }

    if (element.type === "table") {
      const headers = Array.isArray(element.headers) ? element.headers : [];
      const rows = Array.isArray(element.rows) ? element.rows : [];
      const headerHeight = headers.length ? 22 : 0;
      const rowsHeight = rows.length * 19;
      return headerHeight + rowsHeight + 12;
    }

    if (element.type === "divider") {
      return 20;
    }

    return 20;
  }

  function autoPaginateElements(elements, maxPageHeight = 620, availWidth = 520) {
    if (!Array.isArray(elements) || !elements.length) return [];

    const queue = elements.slice();
    const pages = [];
    let currentElements = [];
    let currentHeight = 0;

    function finishPage() {
      if (currentElements.length) {
        pages.push(currentElements);
        currentElements = [];
        currentHeight = 0;
      }
    }

    while (queue.length > 0) {
      const el = queue.shift();
      if (!el) continue;

      const elHeight = estimateElementHeight(el, availWidth);

      // Prevent orphan headings at the very bottom of a page
      if (el.type === "heading") {
        if (currentElements.length > 0 && (currentHeight + elHeight + 40 > maxPageHeight)) {
          finishPage();
        }
        currentElements.push(el);
        currentHeight += elHeight;
        continue;
      }

      // Fits on current page
      if (currentHeight + elHeight <= maxPageHeight) {
        currentElements.push(el);
        currentHeight += elHeight;
        continue;
      }

      // Overflows current page: try splitting
      if (el.type === "paragraph") {
        const lines = wrapText(cleanMarkdownFormatting(el.text || el.rawText || ""), 10, availWidth);
        const rawLines = wrapText(String(el.rawText || el.text || ""), 10, availWidth);

        const space = maxPageHeight - currentHeight;
        const linesFit = Math.floor((space - 8) / 14);

        if (currentElements.length > 0 && linesFit >= 2 && lines.length - linesFit >= 1) {
          const firstText = lines.slice(0, linesFit).join(" ");
          const firstRaw = rawLines.slice(0, linesFit).join(" ");
          currentElements.push({ type: "paragraph", text: firstText, rawText: firstRaw });
          finishPage();

          const restText = lines.slice(linesFit).join(" ");
          const restRaw = rawLines.slice(linesFit).join(" ");
          queue.unshift({ type: "paragraph", text: restText, rawText: restRaw });
          continue;
        } else if (currentElements.length > 0) {
          finishPage();
          queue.unshift(el);
          continue;
        } else {
          const maxLines = Math.max(2, Math.floor((maxPageHeight - 8) / 14));
          const firstText = lines.slice(0, maxLines).join(" ");
          const firstRaw = rawLines.slice(0, maxLines).join(" ");
          currentElements.push({ type: "paragraph", text: firstText, rawText: firstRaw });
          finishPage();

          if (lines.length > maxLines) {
            const restText = lines.slice(maxLines).join(" ");
            const restRaw = rawLines.slice(maxLines).join(" ");
            queue.unshift({ type: "paragraph", text: restText, rawText: restRaw });
          }
          continue;
        }
      }

      if (el.type === "bullet_list" || el.type === "numbered_list") {
        const items = Array.isArray(el.items) ? el.items : [];
        const rawItems = Array.isArray(el.rawItems) ? el.rawItems : items;
        const indent = el.type === "numbered_list" ? 18 : 14;

        if (currentElements.length > 0) {
          let fitCount = 0;
          let fitHeight = 6;
          for (let i = 0; i < items.length; i++) {
            const itemLines = wrapText(cleanMarkdownFormatting(items[i]), 9.5, availWidth - indent);
            const itemH = 13 + (Math.max(0, itemLines.length - 1) * 12) + 2;
            if (currentHeight + fitHeight + itemH <= maxPageHeight) {
              fitHeight += itemH;
              fitCount++;
            } else {
              break;
            }
          }

          if (fitCount >= 1 && items.length - fitCount >= 1) {
            currentElements.push({
              type: el.type,
              items: items.slice(0, fitCount),
              rawItems: rawItems.slice(0, fitCount)
            });
            finishPage();
            queue.unshift({
              type: el.type,
              items: items.slice(fitCount),
              rawItems: rawItems.slice(fitCount)
            });
            continue;
          } else {
            finishPage();
            queue.unshift(el);
            continue;
          }
        } else {
          let fitCount = 0;
          let fitHeight = 6;
          for (let i = 0; i < items.length; i++) {
            const itemLines = wrapText(cleanMarkdownFormatting(items[i]), 9.5, availWidth - indent);
            const itemH = 13 + (Math.max(0, itemLines.length - 1) * 12) + 2;
            if (fitHeight + itemH <= maxPageHeight || fitCount === 0) {
              fitHeight += itemH;
              fitCount++;
            } else {
              break;
            }
          }

          currentElements.push({
            type: el.type,
            items: items.slice(0, fitCount),
            rawItems: rawItems.slice(0, fitCount)
          });
          finishPage();
          if (items.length > fitCount) {
            queue.unshift({
              type: el.type,
              items: items.slice(fitCount),
              rawItems: rawItems.slice(fitCount)
            });
          }
          continue;
        }
      }

      if (el.type === "table") {
        const rows = Array.isArray(el.rows) ? el.rows : [];
        const rawRows = Array.isArray(el.rawRows) ? el.rawRows : rows;
        const headerH = el.headers?.length ? 22 : 0;

        if (currentElements.length > 0) {
          const space = maxPageHeight - currentHeight;
          const rowsFit = Math.floor((space - headerH - 12) / 19);

          if (rowsFit >= 2 && rows.length - rowsFit >= 1) {
            currentElements.push({
              type: "table",
              headers: el.headers,
              rawHeaders: el.rawHeaders,
              rows: rows.slice(0, rowsFit),
              rawRows: rawRows.slice(0, rowsFit)
            });
            finishPage();
            queue.unshift({
              type: "table",
              headers: el.headers,
              rawHeaders: el.rawHeaders,
              rows: rows.slice(rowsFit),
              rawRows: rawRows.slice(rowsFit)
            });
            continue;
          } else {
            finishPage();
            queue.unshift(el);
            continue;
          }
        } else {
          const rowsFit = Math.max(1, Math.floor((maxPageHeight - headerH - 12) / 19));
          currentElements.push({
            type: "table",
            headers: el.headers,
            rawHeaders: el.rawHeaders,
            rows: rows.slice(0, rowsFit),
            rawRows: rawRows.slice(0, rowsFit)
          });
          finishPage();
          if (rows.length > rowsFit) {
            queue.unshift({
              type: "table",
              headers: el.headers,
              rawHeaders: el.rawHeaders,
              rows: rows.slice(rowsFit),
              rawRows: rawRows.slice(rowsFit)
            });
          }
          continue;
        }
      }

      // Atomic elements (code_block, callout, divider)
      if (currentElements.length > 0) {
        finishPage();
        queue.unshift(el);
        continue;
      } else {
        currentElements.push(el);
        currentHeight += elHeight;
      }
    }

    finishPage();
    return pages.length ? pages : [[]];
  }

  // Parse structured JSON or markdown-like document into normalized pages model
  function parseDocument(source) {
    const text = String(source ?? "").trim();
    if (!text) {
      return {
        title: "Untitled Document",
        author: "Vela",
        pageSize: "letter",
        pages: [{ title: "Page 1", elements: [{ type: "paragraph", text: "Empty document." }] }]
      };
    }

    if (text.startsWith("%PDF-")) {
      return {
        isRaw: true,
        raw: text,
        title: "PDF Document",
        author: "Vela",
        pageSize: "letter",
        pages: [{ title: "Page 1", elements: [{ type: "paragraph", text: "Raw PDF Document" }] }]
      };
    }

    // Try parsing as JSON document specification
    if (text.startsWith("{")) {
      try {
        const parsed = JSON.parse(text);
        const title = parsed.title || parsed.name || "Untitled Document";
        const author = parsed.author || "Vela";
        const pageSize = String(parsed.pageSize || "letter").toLowerCase();
        const theme = parsed.theme || {};

        let pages = [];
        if (Array.isArray(parsed.pages) && parsed.pages.length) {
          pages = parsed.pages.flatMap((page) => {
            const rawElems = Array.isArray(page.elements) ? page.elements : (Array.isArray(page.content) ? page.content : []);
            const paginated = autoPaginateElements(rawElems, 620, 520);
            return (paginated.length ? paginated : [rawElems]).map((elems, pIdx) => ({
              title: paginated.length > 1 ? `${page.title || "Page"} (${pIdx + 1})` : (page.title || "Page"),
              header: page.header || title,
              footer: page.footer || "",
              elements: elems
            }));
          });
        } else if (Array.isArray(parsed.elements) || Array.isArray(parsed.content)) {
          const rawElems = Array.isArray(parsed.elements) ? parsed.elements : parsed.content;
          const paginated = autoPaginateElements(rawElems, 620, 520);
          pages = paginated.map((elems, pIdx) => ({
            title: `Page ${pIdx + 1}`,
            header: title,
            footer: "",
            elements: elems
          }));
        } else {
          pages = [{ title, header: title, footer: "", elements: [{ type: "paragraph", text: parsed.text || JSON.stringify(parsed, null, 2) }] }];
        }

        return { title, author, pageSize, theme, pages };
      } catch {}
    }

    // Parse as Markdown document with page breaks: ---page--- or <!-- pagebreak -->
    let cleanSource = text;
    let docTitle = "Document";
    let docAuthor = "Vela";
    let docPageSize = "letter";
    let docSubject = "";
    let docLayout = "";

    // 1. Standard YAML frontmatter: ^---\r?\n([\s\S]*?)\r?\n---
    const frontmatterMatch = cleanSource.match(/^---\r?\n([\s\S]*?)\r?\n---\s*/);
    if (frontmatterMatch) {
      const frontContent = frontmatterMatch[1];
      cleanSource = cleanSource.slice(frontmatterMatch[0].length);
      const titleMatch = frontContent.match(/^title:\s*["']?(.*?)["']?$/m);
      if (titleMatch) docTitle = titleMatch[1].trim();
      const authorMatch = frontContent.match(/^author:\s*["']?(.*?)["']?$/m);
      if (authorMatch) docAuthor = authorMatch[1].trim();
      const subjectMatch = frontContent.match(/^subject:\s*["']?(.*?)["']?$/m);
      if (subjectMatch) docSubject = subjectMatch[1].trim();
      const pageSizeMatch = frontContent.match(/^pageSize:\s*["']?(.*?)["']?$/m);
      if (pageSizeMatch) docPageSize = pageSizeMatch[1].trim().toLowerCase();
      const layoutMatch = frontContent.match(/^layout:\s*["']?(.*?)["']?$/m);
      if (layoutMatch) docLayout = layoutMatch[1].trim().toLowerCase();
    } else {
      // 2. Inline frontmatter on line 1 or leading metadata lines:
      const leadingLines = cleanSource.split(/\r?\n/);
      let consumed = 0;
      for (let i = 0; i < Math.min(6, leadingLines.length); i++) {
        const l = leadingLines[i].trim();
        if (/^(?:title|subject|author|date|layout|pagesize):/i.test(l)) {
          consumed = i + 1;
          const t = l.match(/title:\s*["']([^"']+)["']/i) || l.match(/title:\s*([^"'\s,]+)/i);
          if (t && docTitle === "Document") docTitle = t[1].trim();
          const s = l.match(/subject:\s*["']([^"']+)["']/i);
          if (s) docSubject = s[1].trim();
          const lay = l.match(/layout:\s*["']?([\w-]+)["']?/i);
          if (lay) docLayout = lay[1].trim().toLowerCase();
        } else if (consumed > 0 && /^(?:---|\*\*\*|___)$/.test(l)) {
          consumed = i + 1;
          break;
        } else {
          break;
        }
      }
      if (consumed > 0) {
        cleanSource = leadingLines.slice(consumed).join("\n").trim();
      }
    }

    const hasExplicitPageBreak = /---page---|<!--\s*page-?break\s*-->/i.test(cleanSource);
    const pageBreakRegex = hasExplicitPageBreak
      ? /\n\s*(?:---page---|<!--\s*page-?break\s*-->)\s*\n/i
      : /\n\s*(?:---page---|<!--\s*page-?break\s*-->|\={3,})\s*\n/i;

    let docIsTwoColumn = docLayout === "two-column" || /column-count:\s*2|columns:\s*2|\bclass=["'][^"']*\btwo-column\b|<!--\s*layout:\s*two-column\s*-->|^layout:\s*["']?two-column["']?|#\s+.*?\b(?:NEET|JEE|DPP|EXAM|TEST|PRACTICE|QUESTION\s+PAPER)\b|\b(?:Q\d+[-–to]Q?\d+)\b/im.test(cleanSource);
    const rawPages = cleanSource.split(pageBreakRegex);
    const pages = [];

    rawPages.forEach((pageChunk, pageIndex) => {
      const lines = pageChunk.split(/\r?\n/);
      const elements = [];
      let pendingParagraph = [];
      let pageIsTwoColumn = docIsTwoColumn;
      if (/column-count:\s*2|columns:\s*2|\bclass=["'][^"']*\btwo-column\b|<!--\s*layout:\s*two-column\s*-->/i.test(pageChunk)) {
        pageIsTwoColumn = true;
      }

      function flushParagraph() {
        if (pendingParagraph.length) {
          const rawJoined = pendingParagraph.join(" ").trim();
          if (rawJoined) {
            const multiple = splitMultipleQuestions(rawJoined);
            if (multiple && multiple.length > 1) {
              elements.push(...multiple);
            } else if (multiple && multiple.length === 1 && multiple[0].options?.length) {
              elements.push(multiple[0]);
            } else {
              const mcq = extractMcqOptions(rawJoined);
              if (mcq) {
                elements.push({
                  type: "question",
                  ...mcq
                });
              } else {
                elements.push({
                  type: "paragraph",
                  text: cleanMarkdownFormatting(rawJoined),
                  rawText: rawJoined
                });
              }
            }
          }
          pendingParagraph = [];
        }
      }

      let lineIndex = 0;
      while (lineIndex < lines.length) {
        const line = lines[lineIndex].trim();

        if (!line) {
          flushParagraph();
          lineIndex += 1;
          continue;
        }

        // Structural HTML tags (<div>, </div>, <style>, etc.) and comments: do not leak into text!
        if (/^<\/?(?:div|section|article|span|style|center)\b[^>]*>$/i.test(line) || /^<!--[\s\S]*?-->$/.test(line)) {
          flushParagraph();
          if (/column-count:\s*2|columns:\s*2|\bclass=["'][^"']*\btwo-column\b/i.test(line)) {
            pageIsTwoColumn = true;
          }
          lineIndex += 1;
          continue;
        }

        // Fenced Code Block: ```lang ... ```
        if (line.startsWith("```")) {
          flushParagraph();
          const lang = line.slice(3).trim();
          lineIndex += 1;
          const codeLines = [];
          while (lineIndex < lines.length && !lines[lineIndex].trim().startsWith("```")) {
            codeLines.push(lines[lineIndex]);
            lineIndex += 1;
          }
          if (lineIndex < lines.length && lines[lineIndex].trim().startsWith("```")) {
            lineIndex += 1;
          }
          elements.push({
            type: "code_block",
            code: codeLines.join("\n"),
            language: lang
          });
          continue;
        }

        // Thematic Break / Divider: <hr>, *** or --- or ___ or * * * or - - -
        if (/^<hr\s*\/?>$/i.test(line) || /^(?:[-*_]\s*){3,}$/.test(line)) {
          flushParagraph();
          elements.push({ type: "divider" });
          lineIndex += 1;
          continue;
        }

        // Exam / DPP Header Banner
        const isExamHeader = (!elements.some((e) => e.type === "exam_header")) && (
          /#\s+.*?\b(?:NEET|JEE|DPP|EXAM|TEST|PRACTICE|QUESTION\s+PAPER|ASSESSMENT)\b/i.test(line) ||
          (/^#\s+(.*)$/.test(line) && lineIndex + 1 < lines.length && /(?:Subject|Topic|Time|Max Marks|Marks|Class|Total Questions):/i.test(lines[lineIndex + 1]))
        );
        if (isExamHeader) {
          flushParagraph();
          const title = line.replace(/^#\s+/, "").trim();
          lineIndex += 1;
          let subtitle = "";
          const metaItems = [];
          if (docSubject) {
            metaItems.push(`Subject: ${docSubject}`);
          }

          while (lineIndex < lines.length) {
            const nextL = lines[lineIndex].trim();
            if (!nextL) { lineIndex += 1; continue; }
            if (nextL.startsWith("# ") || nextL.startsWith("---") || /^\d+[\.\)]/.test(nextL) || nextL.startsWith("```") || nextL.startsWith("|")) break;
            if (nextL.startsWith("##") || nextL.startsWith("###")) {
              if (!subtitle) {
                subtitle = cleanMarkdownFormatting(nextL.replace(/^#{2,3}\s+/, ""));
                lineIndex += 1;
                continue;
              }
            }
            if (/(?:Subject|Topic|Time(?:\s+Limit)?|Max(?:\s+Marks)?|Marks|Class|Date|Year|Total\s+Questions)\s*:/i.test(nextL)) {
              const parts = nextL.split(/\s*[|•]\s*/).map((p) => cleanMarkdownFormatting(p)).filter(Boolean);
              metaItems.push(...parts);
              lineIndex += 1;
            } else if (!subtitle) {
              subtitle = cleanMarkdownFormatting(nextL);
              lineIndex += 1;
            } else {
              break;
            }
          }

          const cleanT = cleanMarkdownFormatting(title);
          if (pageIndex === 0 && docTitle === "Document") docTitle = cleanT;
          const metaDict = {};
          metaItems.forEach((item) => {
            const colon = item.indexOf(":");
            if (colon !== -1) {
              const k = item.slice(0, colon).trim();
              const v = item.slice(colon + 1).trim();
              metaDict[k] = v;
            }
          });
          Object.assign(metaItems, metaDict);
          elements.push({
            type: "exam_header",
            title: cleanT,
            subtitle,
            metadata: metaItems
          });
          pageIsTwoColumn = true;
          docIsTwoColumn = true;
          continue;
        }

        // Headings: # through ######
        const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
        if (headingMatch) {
          flushParagraph();
          const rawHeading = headingMatch[2].trim();
          const level = Math.min(3, headingMatch[1].length);
          const cleanHeading = cleanMarkdownFormatting(rawHeading);
          if (pageIndex === 0 && docTitle === "Document") docTitle = cleanHeading;
          elements.push({
            type: "heading",
            level,
            text: cleanHeading,
            rawText: rawHeading
          });
          lineIndex += 1;
          continue;
        }

        // Callout / Blockquote: > ...
        if (line.startsWith(">")) {
          flushParagraph();
          const calloutLines = [];
          while (lineIndex < lines.length && lines[lineIndex].trim().startsWith(">")) {
            calloutLines.push(lines[lineIndex].trim().replace(/^>\s*/, ""));
            lineIndex += 1;
          }
          const rawText = calloutLines.join(" ");
          elements.push({
            type: "callout",
            text: cleanMarkdownFormatting(rawText),
            rawText
          });
          continue;
        }

        // Markdown Table: | col1 | col2 |
        if (line.startsWith("|") && line.endsWith("|")) {
          flushParagraph();
          const tableRows = [];
          const rawRows = [];
          while (lineIndex < lines.length && lines[lineIndex].trim().startsWith("|")) {
            const rawCells = lines[lineIndex].trim().split("|").slice(1, -1).map((cell) => cell.trim());
            rawRows.push(rawCells);
            tableRows.push(rawCells.map((c) => cleanMarkdownFormatting(c)));
            lineIndex += 1;
          }
          if (tableRows.length >= 2) {
            const headers = tableRows[0];
            const rawHeaders = rawRows[0];
            const isDelimiter = (row) => row.every((cell) => /^[-:]+$/.test(cell));
            const rows = tableRows.slice(1).filter((r) => !isDelimiter(r));
            const filteredRawRows = rawRows.slice(1).filter((r) => !isDelimiter(r));

            // Check if this table is attempting to do multi-column layout for questions
            const isColumnQuestionTable = (() => {
              const allCells = filteredRawRows.flat();
              const hasQHeader = headers.some((h) => /^Q?\d+\s*[-–to]\s*Q?\d+$/i.test(h) || /^Column\s*\d+/i.test(h) || /questions?/i.test(h));
              const multiQCount = allCells.filter((c) => (c.match(/(?:^|\s+)(?:Q)?\d+[\.\)]\s+/g) || []).length >= 2).length;
              const totalQCount = allCells.reduce((sum, c) => sum + (c.match(/(?:^|\s+)(?:Q)?\d+[\.\)]\s+/g) || []).length, 0);
              return hasQHeader || multiQCount >= 1 || totalQCount >= 2;
            })();

            if (isColumnQuestionTable) {
              pageIsTwoColumn = true;
              docIsTwoColumn = true;
              const numCols = headers.length || (filteredRawRows[0]?.length || 1);
              for (let col = 0; col < numCols; col++) {
                for (let r = 0; r < filteredRawRows.length; r++) {
                  const cellText = filteredRawRows[r][col] || "";
                  const extracted = splitMultipleQuestions(cellText);
                  if (extracted && extracted.length) {
                    elements.push(...extracted);
                  } else if (cellText.trim()) {
                    elements.push({
                      type: "paragraph",
                      text: cleanMarkdownFormatting(cellText),
                      rawText: cellText
                    });
                  }
                }
              }
              continue;
            }

            elements.push({
              type: "table",
              headers,
              rows,
              rawHeaders,
              rawRows: filteredRawRows
            });
          }
          continue;
        }

        // Question: starts with e.g. "1. " or "1) " and has options (1)... (2)...
        const qStartMatch = line.match(/^(\d+)[\.\)]\s+(.*)$/);
        if (qStartMatch) {
          // 1. Check if options are inline in this line
          const inlineMcq = extractMcqOptions(line);
          if (inlineMcq) {
            flushParagraph();
            elements.push({
              type: "question",
              ...inlineMcq
            });
            lineIndex += 1;
            continue;
          }

          // 2. Check if subsequent lines have options (1), (2), (3), (4)
          let peekIdx = lineIndex + 1;
          const multiOpts = [];
          const optRegex = /(?:^|\s+)(?:\(|\[)?(1|2|3|4|[A-Da-d])(?:\)|\]|\.|\:)\s+([\s\S]*?)(?=(?:\s+(?:\(|\[)?(1|2|3|4|[A-Da-d])(?:\)|\]|\.|\:)\s+)|$)/g;
          while (peekIdx < lines.length && multiOpts.length < 4) {
            const peekLine = lines[peekIdx].trim();
            if (!peekLine) { peekIdx += 1; continue; }
            const lineOpts = [];
            let m;
            while ((m = optRegex.exec(peekLine)) !== null) {
              lineOpts.push({
                label: `(${m[1]})`,
                text: cleanMarkdownFormatting(m[2].trim()),
                rawText: m[2].trim()
              });
            }
            if (lineOpts.length) {
              multiOpts.push(...lineOpts);
              peekIdx += 1;
            } else {
              break;
            }
          }

          if (multiOpts.length >= 2) {
            flushParagraph();
            const qNum = Number(qStartMatch[1]);
            const stem = qStartMatch[2].trim();
            const maxLen = Math.max(...multiOpts.map((o) => (o.text || "").length));
            elements.push({
              type: "question",
              number: qNum,
              stem: cleanMarkdownFormatting(stem),
              rawStem: stem,
              options: multiOpts,
              layout: maxLen <= 38 ? "grid" : "stacked"
            });
            lineIndex = peekIdx;
            continue;
          }
        }

        // Numbered / Ordered List: 1. Item or 1) Item
        const numberedMatch = line.match(/^(\d+)[.)]\s+(.*)$/);
        if (numberedMatch) {
          flushParagraph();
          const items = [];
          const rawItems = [];
          while (lineIndex < lines.length) {
            const match = lines[lineIndex].trim().match(/^(\d+)[.)]\s+(.*)$/);
            if (!match) break;
            rawItems.push(match[2].trim());
            items.push(cleanMarkdownFormatting(match[2].trim()));
            lineIndex += 1;
          }
          elements.push({
            type: "numbered_list",
            items,
            rawItems
          });
          continue;
        }

        // Bullet List: - Item, * Item, + Item
        if (/^[-*+]\s+/.test(line)) {
          flushParagraph();
          const items = [];
          const rawItems = [];
          while (lineIndex < lines.length && /^[-*+]\s+/.test(lines[lineIndex].trim())) {
            const raw = lines[lineIndex].trim().replace(/^[-*+]\s+/, "");
            rawItems.push(raw);
            items.push(cleanMarkdownFormatting(raw));
            lineIndex += 1;
          }
          elements.push({ type: "bullet_list", items, rawItems });
          continue;
        }

        // Regular text line
        pendingParagraph.push(line);
        lineIndex += 1;
      }

      flushParagraph();

      if (!elements.length) {
        elements.push({ type: "paragraph", text: cleanMarkdownFormatting(pageChunk.trim()), rawText: pageChunk.trim() });
      }

      const effectiveAvailWidth = pageIsTwoColumn ? 250 : 520;
      const effectiveMaxHeight = pageIsTwoColumn ? 1180 : 620;
      if (pageIsTwoColumn) {
        docIsTwoColumn = true;
      }
      const paginatedPages = autoPaginateElements(elements, effectiveMaxHeight, effectiveAvailWidth);
      paginatedPages.forEach((pageElements) => {
        pages.push({
          title: `Page ${pages.length + 1}`,
          header: docTitle,
          footer: "",
          isTwoColumn: pageIsTwoColumn,
          layout: pageIsTwoColumn ? "two-column" : "single",
          elements: pageElements
        });
      });
    });

    return {
      title: docTitle,
      author: docAuthor || "Vela",
      pageSize: docPageSize || "letter",
      subject: docSubject,
      meta: { subject: docSubject },
      layout: docIsTwoColumn ? "two-column" : "single",
      isTwoColumn: docIsTwoColumn,
      pages: pages.length ? pages : [{ title: docTitle, header: docTitle, footer: "", layout: docIsTwoColumn ? "two-column" : "single", isTwoColumn: docIsTwoColumn, elements: [{ type: "paragraph", text: cleanMarkdownFormatting(text), rawText: text }] }]
    };
  }

  // Compile normalized document into standard PDF-1.4 binary (Uint8Array)
  function buildPdf(docInput) {
    const doc = typeof docInput === "object" && docInput !== null ? docInput : parseDocument(String(docInput || ""));
    if (doc.isRaw && doc.raw) {
      return new TextEncoder().encode(doc.raw);
    }

    const pageSize = PAGE_SIZES[doc.pageSize] || PAGE_SIZES.letter;
    const pageWidth = pageSize.width;
    const pageHeight = pageSize.height;
    const margin = 46;
    const availWidth = pageWidth - (margin * 2);

    const encoder = new TextEncoder();
    const pdfChunks = [];
    let totalLength = 0;

    function append(chunk) {
      const bytes = typeof chunk === "string" ? encoder.encode(chunk) : chunk;
      pdfChunks.push(bytes);
      totalLength += bytes.length;
    }

    // Objects storage
    const objects = [];
    function addObject(content) {
      const id = objects.length + 1;
      objects.push({ id, content });
      return id;
    }

    // Catalog & Pages root (IDs 1 & 2)
    const catalogId = addObject("<< /Type /Catalog /Pages 2 0 R >>");
    const pagesId = addObject(""); // Updated after page objects are known

    // Fonts: Helvetica, Helvetica-Bold, Helvetica-Oblique, Courier
    const fontNormalId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const fontBoldId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const fontItalicId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>");
    const fontCourierId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>");

    // Info metadata dictionary
    const titleEscaped = escapePdfString(doc.title || "Document");
    const authorEscaped = escapePdfString(doc.author || "Vela");
    const infoId = addObject(`<< /Title (${titleEscaped}) /Author (${authorEscaped}) /Creator (Vela Intelligence Workspace) >>`);

    const pageObjectIds = [];
    const totalPages = Math.max(1, doc.pages.length);

    // Process each document page
    doc.pages.forEach((page, pageIndex) => {
      const streamCommands = [];
      let cursorY = pageHeight - margin;

      // Running Header
      streamCommands.push("0.45 0.45 0.45 rg");
      streamCommands.push(`BT /F3 8.5 Tf ${margin} ${pageHeight - 28} Td (${escapePdfString(doc.title || "Document")}) Tj ET`);
      streamCommands.push(`0.85 0.85 0.88 RG 0.5 w ${margin} ${pageHeight - 34} m ${margin + availWidth} ${pageHeight - 34} l S`);

      // Running Footer
      streamCommands.push(`0.85 0.85 0.88 RG 0.5 w ${margin} ${margin + 18} m ${margin + availWidth} ${margin + 18} l S`);
      streamCommands.push("0.50 0.50 0.50 rg");
      streamCommands.push(`BT /F1 8 Tf ${margin} ${margin + 6} Td (${escapePdfString(doc.title || "Vela Document")}) Tj ET`);
      const pageNumberText = `Page ${pageIndex + 1} of ${totalPages}`;
      const pageNumWidth = measureTextWidth(pageNumberText, 8);
      streamCommands.push(`BT /F1 8 Tf ${margin + availWidth - pageNumWidth} ${margin + 6} Td (${escapePdfString(pageNumberText)}) Tj ET`);

      // Render Elements
      cursorY -= 16;

      const isTwoCol = Boolean(page.isTwoColumn || page.layout === "two-column" || doc.isTwoColumn || doc.layout === "two-column");
      const colGap = 20;
      const colWidth = isTwoCol ? (availWidth - colGap) / 2 : availWidth;
      let currentCol = 0; // 0 = left, 1 = right
      let colTopY = cursorY;
      let colLeft = margin;

      function advanceColumnIfNeeded(neededHeight) {
        if (cursorY - neededHeight < margin + 30) {
          if (isTwoCol && currentCol === 0) {
            currentCol = 1;
            colLeft = margin + colWidth + colGap;
            cursorY = colTopY;
            return true;
          }
          return false;
        }
        return true;
      }

      if (isTwoCol) {
        const dividerX = margin + colWidth + (colGap / 2);
        streamCommands.push(`0.88 0.89 0.92 RG 0.5 w ${dividerX} ${margin + 24} m ${dividerX} ${colTopY + 4} l S`);
      }

      (Array.isArray(page.elements) ? page.elements : []).forEach((element) => {
        if (!element || cursorY < margin + 30) return;

        if (element.type === "exam_header") {
          const headerH = estimateElementHeight(element, availWidth);
          cursorY -= headerH;
          if (cursorY < margin + 30) return;

          // Background box
          streamCommands.push("0.97 0.98 0.99 rg");
          streamCommands.push(`${margin} ${cursorY} ${availWidth} ${headerH} re f`);
          streamCommands.push("0.80 0.83 0.88 RG 0.75 w");
          streamCommands.push(`${margin} ${cursorY} ${availWidth} ${headerH} re S`);

          // Title
          streamCommands.push("0.08 0.10 0.15 rg");
          const titleText = cleanMarkdownFormatting(element.title || "EXAMINATION PAPER");
          const titleW = measureTextWidth(titleText, 12);
          const titleX = margin + Math.max(8, (availWidth - titleW) / 2);
          let itemY = cursorY + headerH - 16;
          streamCommands.push(`BT /F2 12 Tf ${titleX} ${itemY} Td (${escapePdfString(titleText)}) Tj ET`);

          // Subtitle
          if (element.subtitle) {
            itemY -= 13;
            streamCommands.push("0.25 0.28 0.35 rg");
            const subText = cleanMarkdownFormatting(element.subtitle);
            const subW = measureTextWidth(subText, 9.5);
            const subX = margin + Math.max(8, (availWidth - subW) / 2);
            streamCommands.push(`BT /F2 9.5 Tf ${subX} ${itemY} Td (${escapePdfString(subText)}) Tj ET`);
          }

          // Metadata
          if (Array.isArray(element.metadata) && element.metadata.length) {
            itemY -= 13;
            streamCommands.push("0.40 0.44 0.50 rg");
            const metaJoined = element.metadata.join("   |   ");
            const metaW = measureTextWidth(metaJoined, 8.5);
            const metaX = margin + Math.max(8, (availWidth - metaW) / 2);
            streamCommands.push(`BT /F1 8.5 Tf ${metaX} ${itemY} Td (${escapePdfString(metaJoined)}) Tj ET`);
          }

          cursorY -= 8;
          colTopY = cursorY;
          return;
        }

        if (element.type === "question") {
          const fontSize = 9.5;
          const currentWidth = isTwoCol ? colWidth : availWidth;
          const numStr = element.number != null ? String(element.number).trim() : "";
          const qPrefix = numStr ? (numStr.endsWith(".") ? `${numStr} ` : `${numStr}. `) : "";
          const qStem = `${qPrefix}${element.stem || ""}`;
          const stemLines = wrapText(cleanMarkdownFormatting(qStem), fontSize, currentWidth);
          const opts = (Array.isArray(element.options) ? element.options : []).map(normalizeOption);
          const optCount = opts.length;
          const optHeight = element.layout === "grid" ? 28 : (optCount * 13);
          const totalH = (stemLines.length * 13) + optHeight + 8;

          if (!advanceColumnIfNeeded(totalH)) return;

          // Question stem
          streamCommands.push("0.10 0.12 0.16 rg");
          stemLines.forEach((line) => {
            cursorY -= 13;
            if (cursorY < margin + 25) return;
            streamCommands.push(`BT /F1 ${fontSize} Tf ${colLeft} ${cursorY} Td (${escapePdfString(line)}) Tj ET`);
          });

          // Options
          if (element.layout === "grid" && optCount === 4) {
            const halfCol = (currentWidth - 6) / 2;
            const o1 = opts[0];
            const o2 = opts[1];
            const o3 = opts[2];
            const o4 = opts[3];

            // Row 1
            cursorY -= 14;
            if (cursorY >= margin + 25) {
              streamCommands.push("0.20 0.22 0.28 rg");
              streamCommands.push(`BT /F2 9 Tf ${colLeft + 6} ${cursorY} Td (${escapePdfString(o1.label)}) Tj ET`);
              streamCommands.push(`BT /F1 9 Tf ${colLeft + 22} ${cursorY} Td (${escapePdfString(o1.text)}) Tj ET`);

              streamCommands.push(`BT /F2 9 Tf ${colLeft + halfCol + 6} ${cursorY} Td (${escapePdfString(o2.label)}) Tj ET`);
              streamCommands.push(`BT /F1 9 Tf ${colLeft + halfCol + 22} ${cursorY} Td (${escapePdfString(o2.text)}) Tj ET`);
            }

            // Row 2
            cursorY -= 14;
            if (cursorY >= margin + 25) {
              streamCommands.push("0.20 0.22 0.28 rg");
              streamCommands.push(`BT /F2 9 Tf ${colLeft + 6} ${cursorY} Td (${escapePdfString(o3.label)}) Tj ET`);
              streamCommands.push(`BT /F1 9 Tf ${colLeft + 22} ${cursorY} Td (${escapePdfString(o3.text)}) Tj ET`);

              streamCommands.push(`BT /F2 9 Tf ${colLeft + halfCol + 6} ${cursorY} Td (${escapePdfString(o4.label)}) Tj ET`);
              streamCommands.push(`BT /F1 9 Tf ${colLeft + halfCol + 22} ${cursorY} Td (${escapePdfString(o4.text)}) Tj ET`);
            }
          } else {
            // Stacked options
            opts.forEach((opt) => {
              cursorY -= 13;
              if (cursorY < margin + 25) return;
              streamCommands.push("0.20 0.22 0.28 rg");
              streamCommands.push(`BT /F2 9 Tf ${colLeft + 6} ${cursorY} Td (${escapePdfString(opt.label)}) Tj ET`);
              streamCommands.push(`BT /F1 9 Tf ${colLeft + 22} ${cursorY} Td (${escapePdfString(opt.text)}) Tj ET`);
            });
          }

          cursorY -= 6;
          return;
        }

        if (element.type === "heading") {
          const level = Number(element.level || 1);
          const fontSize = level === 1 ? 18 : level === 2 ? 14 : 11;
          const fontId = "/F2"; // Bold
          const spacing = level === 1 ? 26 : level === 2 ? 20 : 16;
          const isTopH1 = level === 1 && cursorY === colTopY && currentCol === 0;
          const currentWidth = isTopH1 ? availWidth : (isTwoCol ? colWidth : availWidth);
          const currentX = isTopH1 ? margin : colLeft;

          cursorY -= spacing;
          const lines = wrapText(cleanMarkdownFormatting(element.text), fontSize, currentWidth);
          const totalH = spacing + (lines.length * (fontSize + 4));

          if (!isTopH1 && !advanceColumnIfNeeded(totalH)) return;

          streamCommands.push("0.08 0.10 0.14 rg");
          lines.forEach((line) => {
            streamCommands.push(`BT ${fontId} ${fontSize} Tf ${currentX} ${cursorY} Td (${escapePdfString(line)}) Tj ET`);
            cursorY -= fontSize + 4;
          });
          cursorY -= 4;
          if (isTopH1) colTopY = cursorY;
          return;
        }

        if (element.type === "paragraph") {
          const fontSize = 10;
          const currentWidth = isTwoCol ? colWidth : availWidth;
          const lines = wrapText(cleanMarkdownFormatting(element.text), fontSize, currentWidth);
          const neededH = (lines.length * 14) + 8;
          if (!advanceColumnIfNeeded(neededH)) return;

          streamCommands.push("0.16 0.18 0.22 rg");
          lines.forEach((line) => {
            cursorY -= 14;
            if (cursorY < margin + 25) return;
            streamCommands.push(`BT /F1 ${fontSize} Tf ${colLeft} ${cursorY} Td (${escapePdfString(line)}) Tj ET`);
          });
          cursorY -= 8;
          return;
        }

        if (element.type === "bullet_list") {
          const fontSize = 9.5;
          const bulletIndent = 14;
          const currentWidth = isTwoCol ? colWidth : availWidth;
          const textWidthAvailable = currentWidth - bulletIndent;
          streamCommands.push("0.16 0.18 0.22 rg");

          (Array.isArray(element.items) ? element.items : []).forEach((item) => {
            const lines = wrapText(cleanMarkdownFormatting(item), fontSize, textWidthAvailable);
            if (!lines.length) return;

            const neededH = (lines.length * 12) + 6;
            if (!advanceColumnIfNeeded(neededH)) return;

            cursorY -= 13;
            if (cursorY < margin + 25) return;

            // Draw bullet character
            streamCommands.push("0.37 0.65 0.50 rg");
            streamCommands.push(`BT /F2 10 Tf ${colLeft + 2} ${cursorY} Td (*) Tj ET`);

            // Draw item text
            streamCommands.push("0.16 0.18 0.22 rg");
            streamCommands.push(`BT /F1 ${fontSize} Tf ${colLeft + bulletIndent} ${cursorY} Td (${escapePdfString(lines[0])}) Tj ET`);

            for (let lineIdx = 1; lineIdx < lines.length; lineIdx += 1) {
              cursorY -= 12;
              if (cursorY < margin + 25) break;
              streamCommands.push(`BT /F1 ${fontSize} Tf ${colLeft + bulletIndent} ${cursorY} Td (${escapePdfString(lines[lineIdx])}) Tj ET`);
            }
            cursorY -= 2;
          });
          cursorY -= 6;
          return;
        }

        if (element.type === "numbered_list") {
          const fontSize = 9.5;
          const numIndent = 18;
          const currentWidth = isTwoCol ? colWidth : availWidth;
          const textWidthAvailable = currentWidth - numIndent;

          (Array.isArray(element.items) ? element.items : []).forEach((item, itemIdx) => {
            const lines = wrapText(cleanMarkdownFormatting(item), fontSize, textWidthAvailable);
            if (!lines.length) return;

            const neededH = (lines.length * 12) + 6;
            if (!advanceColumnIfNeeded(neededH)) return;

            cursorY -= 13;
            if (cursorY < margin + 25) return;

            const prefix = `${itemIdx + 1}.`;
            streamCommands.push("0.37 0.65 0.50 rg");
            streamCommands.push(`BT /F2 ${fontSize} Tf ${colLeft} ${cursorY} Td (${escapePdfString(prefix)}) Tj ET`);

            streamCommands.push("0.16 0.18 0.22 rg");
            streamCommands.push(`BT /F1 ${fontSize} Tf ${colLeft + numIndent} ${cursorY} Td (${escapePdfString(lines[0])}) Tj ET`);

            for (let lineIdx = 1; lineIdx < lines.length; lineIdx += 1) {
              cursorY -= 12;
              if (cursorY < margin + 25) break;
              streamCommands.push(`BT /F1 ${fontSize} Tf ${colLeft + numIndent} ${cursorY} Td (${escapePdfString(lines[lineIdx])}) Tj ET`);
            }
            cursorY -= 2;
          });
          cursorY -= 6;
          return;
        }

        if (element.type === "code_block") {
          const fontSize = 8.5;
          const padding = 8;
          const currentWidth = isTwoCol ? colWidth : availWidth;
          const codeLines = String(element.code || "").split("\n");
          const boxHeight = Math.min(220, (codeLines.length * 11) + (padding * 2));

          if (!advanceColumnIfNeeded(boxHeight + 12)) return;

          cursorY -= boxHeight + 4;
          if (cursorY < margin + 25) return;

          streamCommands.push("0.96 0.97 0.98 rg");
          streamCommands.push(`${colLeft} ${cursorY} ${currentWidth} ${boxHeight} re f`);

          streamCommands.push("0.88 0.90 0.93 RG 0.5 w");
          streamCommands.push(`${colLeft} ${cursorY} ${currentWidth} ${boxHeight} re S`);

          streamCommands.push("0.15 0.18 0.22 rg");
          let lineY = cursorY + boxHeight - padding - 8;
          codeLines.forEach((line) => {
            if (lineY > cursorY + 4) {
              const displayLine = line.slice(0, 80);
              streamCommands.push(`BT /F4 ${fontSize} Tf ${colLeft + padding} ${lineY} Td (${escapePdfString(displayLine)}) Tj ET`);
              lineY -= 11;
            }
          });

          cursorY -= 8;
          return;
        }

        if (element.type === "callout") {
          const fontSize = 9.5;
          const padding = 10;
          const currentWidth = isTwoCol ? colWidth : availWidth;
          const textWidthAvailable = currentWidth - (padding * 2) - 4;
          const lines = wrapText(cleanMarkdownFormatting(element.text), fontSize, textWidthAvailable);
          const boxHeight = (lines.length * 13) + (padding * 2);

          if (!advanceColumnIfNeeded(boxHeight + 14)) return;

          cursorY -= boxHeight + 4;
          if (cursorY < margin + 25) return;

          streamCommands.push("0.96 0.97 0.98 rg");
          streamCommands.push(`${colLeft} ${cursorY} ${currentWidth} ${boxHeight} re f`);

          streamCommands.push("0.37 0.65 0.50 RG 3.5 w");
          streamCommands.push(`${colLeft + 1.5} ${cursorY} m ${colLeft + 1.5} ${cursorY + boxHeight} l S`);

          streamCommands.push("0.18 0.22 0.28 rg");
          let textY = cursorY + boxHeight - padding - 9;
          lines.forEach((line) => {
            streamCommands.push(`BT /F3 ${fontSize} Tf ${colLeft + padding + 6} ${textY} Td (${escapePdfString(line)}) Tj ET`);
            textY -= 13;
          });

          cursorY -= 10;
          return;
        }

        if (element.type === "table") {
          const headers = Array.isArray(element.headers) ? element.headers : [];
          const rows = Array.isArray(element.rows) ? element.rows : [];
          if (!headers.length && !rows.length) return;

          const currentWidth = isTwoCol ? colWidth : availWidth;
          const colCount = Math.max(1, headers.length || (rows[0]?.length || 1));
          const singleColW = currentWidth / colCount;
          const cellPad = 6;
          const usableCellW = Math.max(20, singleColW - (cellPad * 2));

          // Calculate header height dynamically
          const headerLinesPerCol = headers.map((h) => wrapText(cleanMarkdownFormatting(String(h ?? "")), 9, usableCellW));
          const maxHdrLines = Math.max(1, ...headerLinesPerCol.map((l) => l.length));
          const headerHeight = (maxHdrLines * 12) + 10;

          // Pre-calculate row heights
          const rowInfo = rows.map((row) => {
            const cells = (Array.isArray(row) ? row : []).slice(0, colCount);
            const wrappedCells = cells.map((cell) => wrapText(cleanMarkdownFormatting(String(cell ?? "")), 8.5, usableCellW));
            const maxLines = Math.max(1, ...wrappedCells.map((l) => l.length));
            const rowHeight = (maxLines * 11.5) + 8;
            return { cells: wrappedCells, rowHeight };
          });

          const totalTableH = (headers.length ? headerHeight : 0) + rowInfo.reduce((sum, r) => sum + r.rowHeight, 0) + 12;
          if (!advanceColumnIfNeeded(Math.min(totalTableH, 120))) return;

          if (headers.length) {
            cursorY -= headerHeight;
            if (cursorY < margin + 25) return;

            streamCommands.push("0.93 0.94 0.96 rg");
            streamCommands.push(`${colLeft} ${cursorY} ${currentWidth} ${headerHeight} re f`);

            streamCommands.push("0.82 0.84 0.88 RG 0.5 w");
            streamCommands.push(`${colLeft} ${cursorY} ${currentWidth} ${headerHeight} re S`);

            streamCommands.push("0.08 0.10 0.14 rg");
            headers.forEach((_hdr, colIdx) => {
              const cellX = colLeft + (colIdx * singleColW) + cellPad;
              const lines = headerLinesPerCol[colIdx] || [];
              let lineY = cursorY + headerHeight - 11;
              lines.forEach((l) => {
                streamCommands.push(`BT /F2 9 Tf ${cellX} ${lineY} Td (${escapePdfString(l)}) Tj ET`);
                lineY -= 12;
              });
            });
          }

          rowInfo.forEach((info, rowIdx) => {
            if (cursorY - info.rowHeight < margin + 25) {
              if (!advanceColumnIfNeeded(info.rowHeight)) return;
            }
            cursorY -= info.rowHeight;
            if (cursorY < margin + 25) return;

            if (rowIdx % 2 === 1) {
              streamCommands.push("0.98 0.98 0.99 rg");
              streamCommands.push(`${colLeft} ${cursorY} ${currentWidth} ${info.rowHeight} re f`);
            }

            streamCommands.push("0.88 0.89 0.92 RG 0.5 w");
            streamCommands.push(`${colLeft} ${cursorY} ${currentWidth} ${info.rowHeight} re S`);

            streamCommands.push("0.18 0.20 0.24 rg");
            info.cells.forEach((lines, colIdx) => {
              const cellX = colLeft + (colIdx * singleColW) + cellPad;
              let lineY = cursorY + info.rowHeight - 9.5;
              lines.forEach((l) => {
                streamCommands.push(`BT /F1 8.5 Tf ${cellX} ${lineY} Td (${escapePdfString(l)}) Tj ET`);
                lineY -= 11.5;
              });
            });
          });

          cursorY -= 10;
          return;
        }

        if (element.type === "divider") {
          cursorY -= 8;
          const currentWidth = isTwoCol ? colWidth : availWidth;
          streamCommands.push(`0.88 0.88 0.90 RG 0.75 w ${colLeft} ${cursorY} m ${colLeft + currentWidth} ${cursorY} l S`);
          cursorY -= 12;
          return;
        }
      });

      const contentStream = streamCommands.join("\n");
      const streamBytes = encoder.encode(contentStream);

      // Create stream object
      const streamObjId = addObject(`<< /Length ${streamBytes.length} >>\nstream\n${contentStream}\nendstream`);

      // Create page object
      const pageObjId = addObject(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] ` +
        `/Resources << /Font << /F1 ${fontNormalId} 0 R /F2 ${fontBoldId} 0 R /F3 ${fontItalicId} 0 R /F4 ${fontCourierId} 0 R >> >> ` +
        `/Contents ${streamObjId} 0 R >>`
      );

      pageObjectIds.push(pageObjId);
    });

    // Update Pages dictionary (Obj ID 2)
    const kids = pageObjectIds.map((id) => `${id} 0 R`).join(" ");
    objects[pagesId - 1].content = `<< /Type /Pages /Kids [${kids}] /Count ${pageObjectIds.length} >>`;

    // Assembly
    append("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");

    const xrefOffsets = [];
    objects.forEach((obj) => {
      xrefOffsets[obj.id] = totalLength;
      append(`${obj.id} 0 obj\n${obj.content}\nendobj\n`);
    });

    const startXref = totalLength;
    const totalObjs = objects.length + 1;
    append(`xref\n0 ${totalObjs}\n`);
    append("0000000000 65535 f \n");
    for (let index = 1; index <= objects.length; index += 1) {
      const offset = xrefOffsets[index] || 0;
      append(`${String(offset).padStart(10, "0")} 00000 n \n`);
    }

    append(`trailer\n<< /Size ${totalObjs} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${startXref}\n%%EOF\n`);

    const result = new Uint8Array(totalLength);
    let position = 0;
    for (const chunk of pdfChunks) {
      result.set(chunk, position);
      position += chunk.length;
    }

    return result;
  }

  // Create interactive PDF canvas preview DOM element
  function createPreview(document, source, options = {}) {
    const escape = options.escape || ((val) => String(val ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"));
    const srcText = String(source ?? "").trim();
    const isBinaryPdf = srcText.startsWith("data:application/pdf") || srcText.startsWith("blob:") || (srcText.startsWith("%PDF-") && !srcText.includes("# "));

    if (isBinaryPdf) {
      const wrap = document.createElement("div");
      wrap.className = "artifact-preview-surface artifact-pdf-viewer artifact-pdf-embedded-viewer";
      const docTitle = options.title || "PDF Document";

      let frameSrc = srcText;
      if (srcText.startsWith("data:application/pdf")) {
        try {
          const parts = srcText.split(",");
          const bstr = atob(parts[1]);
          const u8arr = new Uint8Array(bstr.length);
          for (let i = 0; i < bstr.length; i++) u8arr[i] = bstr.charCodeAt(i);
          const blob = new Blob([u8arr], { type: "application/pdf" });
          frameSrc = URL.createObjectURL(blob);
        } catch {}
      } else if (srcText.startsWith("%PDF-")) {
        try {
          const blob = new Blob([srcText], { type: "application/pdf" });
          frameSrc = URL.createObjectURL(blob);
        } catch {}
      }

      const toolbar = document.createElement("div");
      toolbar.className = "artifact-pdf-toolbar";
      toolbar.innerHTML = `
        <div class="artifact-pdf-nav">
          <span class="artifact-pdf-page-indicator">${escape(docTitle)}</span>
        </div>
        <div class="artifact-pdf-actions">
          <a class="artifact-tool artifact-pdf-download" href="${escape(frameSrc)}" download="${escape(docTitle.endsWith(".pdf") ? docTitle : docTitle + ".pdf")}" title="Download PDF document">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"></path></svg>
            <span>Download .pdf</span>
          </a>
          <button class="artifact-tool artifact-pdf-print" type="button" title="Print document">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><path d="M6 14h12v8H6z"></path></svg>
            <span>Print</span>
          </button>
        </div>
      `;

      const scroller = document.createElement("div");
      scroller.className = "artifact-pdf-scroller artifact-pdf-embedded-scroller";
      scroller.style.cssText = "display:flex;flex:1;height:100%;min-height:500px;padding:0;background:#525659;";

      const objectEl = document.createElement("object");
      objectEl.className = "artifact-pdf-embedded-frame";
      objectEl.data = frameSrc;
      objectEl.type = "application/pdf";
      objectEl.style.cssText = "width:100%;height:100%;min-height:520px;border:none;flex:1;";
      
      const iframeFallback = document.createElement("iframe");
      iframeFallback.src = frameSrc;
      iframeFallback.style.cssText = "width:100%;height:100%;min-height:520px;border:none;flex:1;";
      iframeFallback.title = docTitle;
      objectEl.appendChild(iframeFallback);
      scroller.appendChild(objectEl);

      toolbar.querySelector(".artifact-pdf-print")?.addEventListener("click", () => {
        try {
          iframeFallback.contentWindow?.print() || window.print();
        } catch {
          window.print();
        }
      });

      wrap.append(toolbar, scroller);
      return wrap;
    }

    const doc = parseDocument(source);

    const wrap = document.createElement("div");
    wrap.className = "artifact-preview-surface artifact-pdf-viewer";

    // Toolbar
    const toolbar = document.createElement("div");
    toolbar.className = "artifact-pdf-toolbar";
    toolbar.innerHTML = `
      <div class="artifact-pdf-nav">
        <button class="artifact-tool artifact-pdf-prev" type="button" aria-label="Previous page" title="Previous page"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"></path></svg></button>
        <span class="artifact-pdf-page-indicator">Page <span class="artifact-pdf-current">1</span> of <span class="artifact-pdf-total">${doc.pages.length}</span></span>
        <button class="artifact-tool artifact-pdf-next" type="button" aria-label="Next page" title="Next page"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg></button>
      </div>
      <div class="artifact-pdf-zoom-group">
        <button class="artifact-tool artifact-pdf-zoom-out" type="button" aria-label="Zoom out" title="Zoom out"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"></path></svg></button>
        <button class="artifact-tool artifact-pdf-zoom-reset" type="button" title="Reset zoom">100%</button>
        <button class="artifact-tool artifact-pdf-zoom-in" type="button" aria-label="Zoom in" title="Zoom in"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg></button>
      </div>
      <div class="artifact-pdf-actions">
        <button class="artifact-tool artifact-pdf-download" type="button" title="Download PDF document"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"></path></svg><span>Download .pdf</span></button>
        <button class="artifact-tool artifact-pdf-print" type="button" title="Print document"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><path d="M6 14h12v8H6z"></path></svg><span>Print</span></button>
      </div>
    `;

    // Scroller container
    const scroller = document.createElement("div");
    scroller.className = "artifact-pdf-scroller";

    let currentZoom = 1;
    let activePageIndex = 0;

    // Render pages
    doc.pages.forEach((page, pageIndex) => {
      const pageEl = document.createElement("article");
      pageEl.className = "artifact-pdf-page";
      pageEl.dataset.pageIndex = String(pageIndex);

      // Running page header
      const headerEl = document.createElement("header");
      headerEl.className = "artifact-pdf-header";
      headerEl.innerHTML = `<span class="artifact-pdf-header-title">${escape(doc.title || "Document")}</span><span class="artifact-pdf-header-meta">${escape(page.title || "")}</span>`;
      pageEl.appendChild(headerEl);

      // Page body
      const isTwoCol = Boolean(page.isTwoColumn || page.layout === "two-column" || doc.isTwoColumn || doc.layout === "two-column");
      const bodyEl = document.createElement("div");
      bodyEl.className = isTwoCol ? "artifact-pdf-body artifact-pdf-two-column" : "artifact-pdf-body";

      (Array.isArray(page.elements) ? page.elements : []).forEach((el) => {
        if (!el) return;

        if (el.type === "exam_header") {
          const header = document.createElement("div");
          header.className = "artifact-pdf-exam-header";
          header.innerHTML = `
            <div class="artifact-pdf-exam-title">${escape(el.title || "EXAMINATION PAPER")}</div>
            ${el.subtitle ? `<div class="artifact-pdf-exam-sub">${escape(el.subtitle)}</div>` : ""}
            ${Array.isArray(el.metadata) && el.metadata.length ? `<div class="artifact-pdf-exam-meta">${el.metadata.map((m) => `<span>${escape(m)}</span>`).join("<span class=\"artifact-pdf-meta-sep\">•</span>")}</div>` : ""}
          `;
          bodyEl.appendChild(header);
          return;
        }

        if (el.type === "question") {
          const qEl = document.createElement("div");
          qEl.className = "artifact-pdf-question";

          const stemEl = document.createElement("div");
          stemEl.className = "artifact-pdf-q-stem";
          const numStr = el.number != null ? String(el.number).trim() : "";
          const numPrefix = numStr ? `<strong class="artifact-pdf-q-num">${escape(numStr.endsWith(".") ? numStr : numStr + ".")}</strong> ` : "";
          stemEl.innerHTML = `${numPrefix}<span>${renderInlineMarkdown(el.rawStem || el.stem || "", escape)}</span>`;
          qEl.appendChild(stemEl);

          const opts = (Array.isArray(el.options) ? el.options : []).map(normalizeOption);
          if (opts.length) {
            const optContainer = document.createElement("div");
            optContainer.className = `artifact-pdf-options artifact-pdf-options-${el.layout === "grid" ? "grid" : "stacked"}`;
            opts.forEach((opt) => {
              const optItem = document.createElement("div");
              optItem.className = "artifact-pdf-opt";
              optItem.innerHTML = `<span class="artifact-pdf-opt-lbl">${escape(opt.label || "")}</span><span class="artifact-pdf-opt-val">${renderInlineMarkdown(opt.rawText || opt.text || "", escape)}</span>`;
              optContainer.appendChild(optItem);
            });
            qEl.appendChild(optContainer);
          }

          bodyEl.appendChild(qEl);
          return;
        }

        if (el.type === "heading") {
          const tag = el.level === 1 ? "h1" : el.level === 2 ? "h2" : "h3";
          const heading = document.createElement(tag);
          heading.className = `artifact-pdf-heading artifact-pdf-${tag}`;
          heading.innerHTML = renderInlineMarkdown(el.rawText || el.text, escape);
          bodyEl.appendChild(heading);
          return;
        }

        if (el.type === "paragraph") {
          const p = document.createElement("p");
          p.className = "artifact-pdf-paragraph";
          p.innerHTML = renderInlineMarkdown(el.rawText || el.text, escape);
          bodyEl.appendChild(p);
          return;
        }

        if (el.type === "bullet_list") {
          const ul = document.createElement("ul");
          ul.className = "artifact-pdf-list artifact-pdf-unordered-list";
          (Array.isArray(el.items) ? el.items : []).forEach((item, itemIdx) => {
            const li = document.createElement("li");
            const rawItem = Array.isArray(el.rawItems) ? el.rawItems[itemIdx] : item;
            li.innerHTML = renderInlineMarkdown(rawItem || item, escape);
            ul.appendChild(li);
          });
          bodyEl.appendChild(ul);
          return;
        }

        if (el.type === "numbered_list") {
          const ol = document.createElement("ol");
          ol.className = "artifact-pdf-list artifact-pdf-ordered-list";
          (Array.isArray(el.items) ? el.items : []).forEach((item, itemIdx) => {
            const li = document.createElement("li");
            const rawItem = Array.isArray(el.rawItems) ? el.rawItems[itemIdx] : item;
            li.innerHTML = renderInlineMarkdown(rawItem || item, escape);
            ol.appendChild(li);
          });
          bodyEl.appendChild(ol);
          return;
        }

        if (el.type === "code_block") {
          const pre = document.createElement("pre");
          pre.className = "artifact-pdf-code-block";
          const code = document.createElement("code");
          if (el.language) code.className = `language-${escape(el.language)}`;
          code.textContent = el.code || "";
          pre.appendChild(code);
          bodyEl.appendChild(pre);
          return;
        }

        if (el.type === "callout") {
          const block = document.createElement("blockquote");
          block.className = "artifact-pdf-callout";
          block.innerHTML = renderInlineMarkdown(el.rawText || el.text, escape);
          bodyEl.appendChild(block);
          return;
        }

        if (el.type === "table") {
          const tableWrap = document.createElement("div");
          tableWrap.className = "artifact-pdf-table-wrap";
          const table = document.createElement("table");
          table.className = "artifact-pdf-table";

          const rawHeaders = Array.isArray(el.rawHeaders) ? el.rawHeaders : el.headers;
          if (Array.isArray(el.headers) && el.headers.length) {
            const thead = document.createElement("thead");
            thead.innerHTML = `<tr>${el.headers.map((h, i) => `<th>${renderInlineMarkdown(rawHeaders?.[i] || h, escape)}</th>`).join("")}</tr>`;
            table.appendChild(thead);
          }

          const rawRows = Array.isArray(el.rawRows) ? el.rawRows : el.rows;
          if (Array.isArray(el.rows) && el.rows.length) {
            const tbody = document.createElement("tbody");
            tbody.innerHTML = el.rows.map((row, rIdx) => `<tr>${(Array.isArray(row) ? row : []).map((cell, cIdx) => `<td>${renderInlineMarkdown(rawRows?.[rIdx]?.[cIdx] || cell, escape)}</td>`).join("")}</tr>`).join("");
            table.appendChild(tbody);
          }

          tableWrap.appendChild(table);
          bodyEl.appendChild(tableWrap);
          return;
        }

        if (el.type === "divider") {
          const hr = document.createElement("hr");
          hr.className = "artifact-pdf-divider";
          bodyEl.appendChild(hr);
        }
      });

      pageEl.appendChild(bodyEl);

      // Running page footer
      const footerEl = document.createElement("footer");
      footerEl.className = "artifact-pdf-footer";
      footerEl.innerHTML = `<span>${escape(doc.title || "Vela")}</span><span>Page ${pageIndex + 1} of ${doc.pages.length}</span>`;
      pageEl.appendChild(footerEl);

      scroller.appendChild(pageEl);
    });

    wrap.append(toolbar, scroller);

    // Wire up events
    const pageIndicator = toolbar.querySelector(".artifact-pdf-current");
    const pages = scroller.querySelectorAll(".artifact-pdf-page");

    function updatePage(index) {
      if (!pages.length) return;
      activePageIndex = Math.max(0, Math.min(index, pages.length - 1));
      if (pageIndicator) pageIndicator.textContent = String(activePageIndex + 1);
      pages[activePageIndex]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    toolbar.querySelector(".artifact-pdf-prev")?.addEventListener("click", () => updatePage(activePageIndex - 1));
    toolbar.querySelector(".artifact-pdf-next")?.addEventListener("click", () => updatePage(activePageIndex + 1));

    function applyZoom(zoom) {
      currentZoom = Math.max(0.5, Math.min(zoom, 2.0));
      const resetBtn = toolbar.querySelector(".artifact-pdf-zoom-reset");
      if (resetBtn) resetBtn.textContent = `${Math.round(currentZoom * 100)}%`;
      pages.forEach((page) => {
        page.style.transform = `scale(${currentZoom})`;
        page.style.transformOrigin = "top center";
      });
    }

    toolbar.querySelector(".artifact-pdf-zoom-out")?.addEventListener("click", () => applyZoom(currentZoom - 0.15));
    toolbar.querySelector(".artifact-pdf-zoom-in")?.addEventListener("click", () => applyZoom(currentZoom + 0.15));
    toolbar.querySelector(".artifact-pdf-zoom-reset")?.addEventListener("click", () => applyZoom(1));

    toolbar.querySelector(".artifact-pdf-download")?.addEventListener("click", () => {
      const bytes = buildPdf(doc);
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(doc.title || "document").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    });

    toolbar.querySelector(".artifact-pdf-print")?.addEventListener("click", () => {
      printPdf(doc, wrap);
    });

    return wrap;
  }

  function printPdf(doc, wrapElement) {
    if (typeof window === "undefined" || typeof document === "undefined" || !document?.body?.appendChild) {
      return;
    }

    try {
      const iframe = document.createElement("iframe");
      iframe.className = "artifact-pdf-print-iframe";
      iframe.style.position = "fixed";
      iframe.style.left = "-9999px";
      iframe.style.top = "-9999px";
      iframe.style.width = "8.5in";
      iframe.style.height = "11in";
      iframe.style.border = "none";
      iframe.style.opacity = "0";
      iframe.style.pointerEvents = "none";
      document.body.appendChild(iframe);

      const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
      iframeDoc.open();

      const pages = wrapElement ? wrapElement.querySelectorAll(".artifact-pdf-page") : [];
      const pagesHtml = Array.from(pages).map((p) => p.outerHTML).join("\n");

      const printHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapePdfString(doc.title || "Document")}</title>
  <style>
    @page {
      size: letter;
      margin: 0;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      color: #111827;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    .artifact-pdf-page {
      width: 8.5in;
      min-height: 11in;
      height: 11in;
      max-height: 11in;
      margin: 0 auto;
      padding: 40pt 46pt;
      position: relative;
      page-break-after: always;
      break-after: page;
      page-break-inside: avoid;
      break-inside: avoid;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      background: #ffffff !important;
      border: none !important;
      border-radius: 0 !important;
      box-shadow: none !important;
      box-sizing: border-box;
      overflow: hidden;
    }
    .artifact-pdf-page:last-child {
      page-break-after: auto;
      break-after: auto;
    }
    .artifact-pdf-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 0.5pt solid #d1d5db;
      padding-bottom: 6pt;
      font-size: 8.5pt;
      color: #6b7280;
      margin-bottom: 14pt;
    }
    .artifact-pdf-header-title {
      font-style: italic;
      font-weight: 500;
    }
    .artifact-pdf-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-top: 0.5pt solid #d1d5db;
      padding-top: 6pt;
      font-size: 8pt;
      color: #6b7280;
      margin-top: 14pt;
    }
    .artifact-pdf-body {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 10pt;
    }
    .artifact-pdf-heading {
      color: #111827;
      margin: 0;
      line-height: 1.25;
    }
    .artifact-pdf-h1 { font-size: 20pt; font-weight: 700; margin-bottom: 4pt; }
    .artifact-pdf-h2 { font-size: 14pt; font-weight: 650; margin-top: 8pt; }
    .artifact-pdf-h3 { font-size: 11pt; font-weight: 600; margin-top: 6pt; }
    .artifact-pdf-paragraph {
      font-size: 10pt;
      line-height: 1.55;
      color: #1f2937;
      margin: 0;
    }
    .artifact-pdf-list {
      margin: 0;
      padding-left: 18pt;
      font-size: 9.5pt;
      line-height: 1.5;
      color: #1f2937;
    }
    .artifact-pdf-list li { margin-bottom: 3pt; }
    .artifact-pdf-callout {
      margin: 6pt 0;
      padding: 8pt 12pt;
      background: #f8fafc;
      border-left: 3.5pt solid #5fa77f;
      border-radius: 3pt;
      font-size: 9.5pt;
      font-style: italic;
      line-height: 1.5;
      color: #334155;
    }
    .artifact-pdf-code-block {
      margin: 6pt 0;
      padding: 8pt 10pt;
      background: #f1f5f9;
      border: 0.5pt solid #cbd5e1;
      border-radius: 4pt;
      font-family: "Courier New", Courier, monospace;
      font-size: 8.5pt;
      line-height: 1.4;
      white-space: pre-wrap;
      word-break: break-word;
      color: #0f172a;
    }
    .artifact-pdf-table-wrap {
      margin: 6pt 0;
      width: 100%;
    }
    .artifact-pdf-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 8.5pt;
    }
    .artifact-pdf-table th {
      background: #f1f5f9;
      font-weight: 600;
      text-align: left;
      padding: 5pt 6pt;
      border: 0.5pt solid #cbd5e1;
      color: #0f172a;
    }
    .artifact-pdf-table td {
      padding: 4pt 6pt;
      border: 0.5pt solid #e2e8f0;
      color: #334155;
    }
    .artifact-pdf-table tr:nth-child(even) td { background: #f8fafc; }
    .artifact-pdf-divider {
      border: 0;
      border-top: 0.75pt solid #e2e8f0;
      margin: 10pt 0;
    }
    .artifact-pdf-inline-code {
      font-family: "Courier New", Courier, monospace;
      background: #f1f5f9;
      padding: 1pt 3pt;
      border-radius: 2pt;
      font-size: 0.9em;
    }
    .artifact-pdf-body.artifact-pdf-two-column {
      column-count: 2;
      column-gap: 20pt;
      column-rule: 0.5pt solid #cbd5e1;
      text-align: justify;
    }
    .artifact-pdf-heading,
    .artifact-pdf-exam-header,
    .artifact-pdf-divider {
      column-span: all;
    }
    .artifact-pdf-exam-header {
      border: 0.75pt solid #cbd5e1;
      border-radius: 4pt;
      background: #f8fafc;
      padding: 8pt 12pt;
      margin-bottom: 12pt;
      text-align: center;
    }
    .artifact-pdf-exam-title {
      font-size: 13pt;
      font-weight: 700;
      letter-spacing: 0.02em;
      color: #0f172a;
      text-transform: uppercase;
    }
    .artifact-pdf-exam-sub {
      font-size: 10pt;
      font-weight: 600;
      color: #334155;
      margin-top: 2pt;
    }
    .artifact-pdf-exam-meta {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 4pt 10pt;
      margin-top: 5pt;
      padding-top: 5pt;
      border-top: 0.5pt dashed #cbd5e1;
      font-size: 8.5pt;
      color: #475569;
    }
    .artifact-pdf-meta-sep {
      color: #94a3b8;
    }
    .artifact-pdf-question {
      break-inside: avoid;
      page-break-inside: avoid;
      margin-bottom: 11pt;
      font-size: 9.5pt;
      line-height: 1.45;
      color: #1e293b;
    }
    .artifact-pdf-q-stem {
      margin-bottom: 4pt;
    }
    .artifact-pdf-q-num {
      font-weight: 700;
      color: #0f172a;
      margin-right: 2pt;
    }
    .artifact-pdf-options-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 3pt 10pt;
      margin-top: 3pt;
      padding-left: 10pt;
    }
    .artifact-pdf-options-stacked {
      display: flex;
      flex-direction: column;
      gap: 2.5pt;
      margin-top: 3pt;
      padding-left: 10pt;
    }
    .artifact-pdf-opt {
      display: flex;
      align-items: baseline;
      gap: 5pt;
      font-size: 9pt;
      color: #334155;
    }
    .artifact-pdf-opt-lbl {
      font-weight: 600;
      color: #0f172a;
      flex-shrink: 0;
    }
    .artifact-pdf-opt-val {
      flex: 1;
    }
  </style>
</head>
<body>
  ${pagesHtml}
</body>
</html>`;

      iframeDoc.write(printHtml);
      iframeDoc.close();

      setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch {
          window.print();
        } finally {
          setTimeout(() => {
            iframe.remove();
          }, 3000);
        }
      }, 250);
    } catch {
      window.print();
    }
  }

  function parseCMap(cmapStr) {
    const map = new Map();
    if (!cmapStr) return map;

    // 1. beginbfchar blocks: <srcHex> <dstHex>
    // 1. beginbfchar blocks: <srcHex> <dstHex>
    const bfcharBlocks = cmapStr.match(/beginbfchar[\s\S]*?endbfchar/g) || [];
    for (const block of bfcharBlocks) {
      const pairRegex = /<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>/g;
      let m;
      while ((m = pairRegex.exec(block)) !== null) {
        const rawHex = m[1].toLowerCase();
        const paddedHex = rawHex.padStart(4, "0");
        const dstCode = parseInt(m[2], 16);
        let ch;
        try {
          ch = String.fromCodePoint(dstCode);
        } catch {
          ch = String.fromCharCode(dstCode);
        }
        map.set(rawHex, ch);
        map.set(paddedHex, ch);
      }
    }

    // 2. beginbfrange blocks: <startHex> <endHex> <dstStartHex> or <startHex> <endHex> [ <dst1> <dst2> ... ]
    const bfrangeBlocks = cmapStr.match(/beginbfrange[\s\S]*?endbfrange/g) || [];
    for (const block of bfrangeBlocks) {
      const rangeRegex = /<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>\s+(?:<([0-9a-fA-F]+)>|\[([\s\S]*?)\])/g;
      let m;
      while ((m = rangeRegex.exec(block)) !== null) {
        const start = parseInt(m[1], 16);
        const end = parseInt(m[2], 16);
        if (m[3]) {
          let dest = parseInt(m[3], 16);
          for (let code = start; code <= end; code++) {
            const rawHex = code.toString(16).toLowerCase();
            const paddedHex = rawHex.padStart(4, "0");
            let ch;
            try {
              ch = String.fromCodePoint(dest++);
            } catch {
              ch = String.fromCharCode(dest++);
            }
            map.set(rawHex, ch);
            map.set(paddedHex, ch);
          }
        } else if (m[4]) {
          const destArray = (m[4].match(/<([0-9a-fA-F]+)>/g) || []).map((h) => parseInt(h.replace(/[<>]/g, ""), 16));
          for (let i = 0; i < destArray.length && start + i <= end; i++) {
            const rawHex = (start + i).toString(16).toLowerCase();
            const paddedHex = rawHex.padStart(4, "0");
            let ch;
            try {
              ch = String.fromCodePoint(destArray[i]);
            } catch {
              ch = String.fromCharCode(destArray[i]);
            }
            map.set(rawHex, ch);
            map.set(paddedHex, ch);
          }
        }
      }
    }

    return map;
  }

  function uint8ToBase64(bytes) {
    if (typeof Buffer !== "undefined") {
      return Buffer.from(bytes).toString("base64");
    }
    let binary = "";
    const len = bytes.byteLength;
    const chunkSize = 8192;
    for (let i = 0; i < len; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunkSize, len)));
    }
    return btoa(binary);
  }

  function decodePdfHex(hex, cMap) {
    const clean = String(hex || "").replace(/[^0-9a-fA-F]/g, "");
    if (!clean.length) return "";

    // 1. Try mapping with CMap if available
    if (cMap && cMap.size > 0) {
      // Try 4-digit hex codes (2-byte glyph IDs)
      if (clean.length % 4 === 0) {
        let mapped = "";
        let hits = 0;
        const total = clean.length / 4;
        for (let i = 0; i < clean.length; i += 4) {
          const key = clean.slice(i, i + 4).toLowerCase();
          if (cMap.has(key)) {
            mapped += cMap.get(key);
            hits++;
          } else {
            const code = parseInt(key, 16);
            if (code >= 32 && code <= 126) {
              mapped += String.fromCharCode(code);
              hits++;
            } else {
              mapped += " ";
            }
          }
        }
        if (hits > 0 && hits >= total * 0.3) return mapped;
      }

      // Try 2-digit hex codes (1-byte glyph IDs)
      if (clean.length % 2 === 0) {
        let mapped = "";
        let hits = 0;
        const total = clean.length / 2;
        for (let i = 0; i < clean.length; i += 2) {
          const key = clean.slice(i, i + 2).toLowerCase();
          const keyPadded = key.padStart(4, "0");
          if (cMap.has(key)) {
            mapped += cMap.get(key);
            hits++;
          } else if (cMap.has(keyPadded)) {
            mapped += cMap.get(keyPadded);
            hits++;
          } else {
            const code = parseInt(key, 16);
            if (code >= 32 && code <= 126) {
              mapped += String.fromCharCode(code);
              hits++;
            } else {
              mapped += " ";
            }
          }
        }
        if (hits > 0 && hits >= total * 0.3) return mapped;
      }
    }

    const padded = clean.length % 2 !== 0 ? clean + "0" : clean;
    const bytes = new Uint8Array(padded.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
    }

    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      try {
        const str = new TextDecoder("utf-16be").decode(bytes.slice(2));
        return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, " ");
      } catch {}
    }

    let isUtf16 = false;
    if (bytes.length >= 2 && bytes.length % 2 === 0) {
      let zeros = 0;
      for (let i = 0; i < bytes.length; i += 2) {
        if (bytes[i] === 0x00 && bytes[i + 1] >= 0x20 && bytes[i + 1] <= 0x7e) zeros++;
      }
      if (zeros > bytes.length / 4) isUtf16 = true;
    }

    if (isUtf16) {
      try {
        const str = new TextDecoder("utf-16be").decode(bytes);
        return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, " ");
      } catch {}
    }

    try {
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return decoded.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, " ");
    } catch {
      const decoded = new TextDecoder("latin1").decode(bytes);
      return decoded.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, " ");
    }
  }

  function unescapePdfStr(str) {
    return String(str || "")
      .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\b/g, "\b")
      .replace(/\\f/g, "\f")
      .replace(/\\\(/g, "(")
      .replace(/\\\)/g, ")")
      .replace(/\\\\/g, "\\");
  }

  function parseTextOperators(streamContent, cMap) {
    if (!streamContent) return [];
    const texts = [];
    const btBlocks = streamContent.match(/BT[\s\S]*?ET/g) || [];

    for (const block of btBlocks) {
      const blockLines = [];
      let currentLine = "";

      function flushLine() {
        const t = currentLine.trim();
        if (t) blockLines.push(t);
        currentLine = "";
      }

      // Tokenize operators inside BT ... ET:
      // - [ ... ] TJ (supports multi-line blocks with [\s\S]*?)
      // - ( ... ) Tj, ', "
      // - < ... > Tj, ', "
      // - Line breaks: T*, Td, TD
      const opRegex = /\[([\s\S]*?)\]\s*TJ|\(([^)]*(?:\\.[^)]*)*)\)\s*(?:Tj|'|")|<([0-9a-fA-F\s]+)>\s*(?:Tj|'|")|(?:T\*|(?:\S+\s+\S+\s+T[dD]))/g;
      let m;
      while ((m = opRegex.exec(block)) !== null) {
        if (m[1] !== undefined) {
          // Array TJ
          const inner = m[1];
          const itemRegex = /\(([^)]*(?:\\.[^)]*)*)\)|<([0-9a-fA-F\s]+)>|(-?\d+(?:\.\d+)?)/g;
          let im;
          let tjStr = "";
          while ((im = itemRegex.exec(inner)) !== null) {
            if (im[1] !== undefined) {
              tjStr += unescapePdfStr(im[1]);
            } else if (im[2] !== undefined) {
              tjStr += decodePdfHex(im[2], cMap);
            } else if (im[3] !== undefined) {
              const num = parseFloat(im[3]);
              if (num < -120) {
                tjStr += " ";
              }
            }
          }
          currentLine += tjStr;
        } else if (m[2] !== undefined) {
          // Literal string Tj
          currentLine += unescapePdfStr(m[2]);
        } else if (m[3] !== undefined) {
          // Hex string Tj
          currentLine += decodePdfHex(m[3], cMap);
        } else {
          // Line break operator (T*, Td, TD)
          flushLine();
        }
      }
      flushLine();

      if (blockLines.length) {
        texts.push(blockLines.join("\n"));
      }
    }

    return texts;
  }

  async function decompressFlate(rawBytes) {
    if (!rawBytes || !rawBytes.length) return null;
    if (typeof zlib !== "undefined") {
      try {
        return new Uint8Array(zlib.inflateSync(rawBytes));
      } catch {}
      try {
        return new Uint8Array(zlib.inflateRawSync(rawBytes));
      } catch {}
    }
    if (typeof DecompressionStream !== "undefined" && typeof Response !== "undefined" && typeof Blob !== "undefined") {
      // In browsers, DecompressionStream throws if there are trailing delimiter bytes (e.g. \r\n before endstream).
      // Progressively trim up to 32 trailing bytes to find the clean zlib boundary.
      for (const format of ["deflate", "deflate-raw"]) {
        for (let trim = 0; trim <= Math.min(32, rawBytes.length - 2); trim++) {
          try {
            const sub = trim === 0 ? rawBytes : rawBytes.subarray(0, rawBytes.length - trim);
            const stream = new Blob([sub]).stream().pipeThrough(new DecompressionStream(format));
            const buffer = await new Response(stream).arrayBuffer();
            if (buffer && buffer.byteLength > 0) {
              return new Uint8Array(buffer);
            }
          } catch {}
        }
      }
    }
    return null;
  }

  /**
   * Extract plain readable text and page images from a PDF binary payload
   * (ArrayBuffer, Uint8Array, data URL, or base64).
   * Supports FlateDecode streams, indirect /Length, ToUnicode CMaps, hex strings,
   * TJ operators, and embedded JPEG page images for scanned documents.
   */
  async function extractPdfData(source, maxImages = 10, options = {}) {
    if (!source) return { text: "", images: [] };
    let buffer;
    if (source instanceof ArrayBuffer) {
      buffer = new Uint8Array(source);
    } else if (source instanceof Uint8Array) {
      buffer = source;
    } else if (typeof source === "string") {
      const match = source.match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.+)$/s);
      const b64 = match ? match[2] : source;
      try {
        if (typeof Buffer !== "undefined") {
          buffer = new Uint8Array(Buffer.from(b64, "base64"));
        } else if (typeof atob === "function") {
          const cleanB64 = b64.replace(/\s+/g, "");
          const bin = atob(cleanB64);
          buffer = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) buffer[i] = bin.charCodeAt(i);
        }
      } catch {
        const encoder = new TextEncoder();
        buffer = encoder.encode(source);
      }
    }

    if (!buffer || !buffer.length) return { text: "", images: [] };

    const latin1 = new TextDecoder("latin1").decode(buffer);
    const combinedCMap = new Map();
    const decompressedStreams = [];
    const images = [];

    // Pre-scan all indirect integer objects: e.g. "15 0 obj\n12345\nendobj"
    const indirectInts = new Map();
    const intObjRegex = /(\d+)\s+(\d+)\s+obj\s*(\d+)\s*endobj/g;
    let intM;
    while ((intM = intObjRegex.exec(latin1)) !== null) {
      indirectInts.set(intM[1], parseInt(intM[3], 10));
    }

    // Scan for all stream objects
    const streamPattern = /(?<!end)stream[\r\n]+/g;
    let match;
    while ((match = streamPattern.exec(latin1)) !== null) {
      const streamStart = match.index + match[0].length;
      const dictWindow = latin1.slice(Math.max(0, match.index - 2000), match.index);
      const dicts = [...dictWindow.matchAll(/<<([\s\S]*?)>>/g)];
      const dictText = dicts.length ? dicts[dicts.length - 1][1] : dictWindow;

      const isFlate = /\/Flate/i.test(dictText);
      const isImage = /\/Subtype\s*\/Image/i.test(dictText) || /\/Image\b/i.test(dictText);
      const isJpeg = /\/DCTDecode/i.test(dictText);
      const isCmyk = /\/DeviceCMYK/i.test(dictText);

      // Locate end of stream
      const endPos = latin1.indexOf("endstream", streamStart);
      let actualEnd = endPos !== -1 ? endPos : buffer.length;
      while (actualEnd > streamStart && (latin1[actualEnd - 1] === "\n" || latin1[actualEnd - 1] === "\r")) {
        actualEnd--;
      }

      // Check for direct /Length or indirect /Length N 0 R
      let streamEnd = actualEnd;
      const directLenMatch = dictText.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)\b/);
      if (directLenMatch) {
        const len = parseInt(directLenMatch[1], 10);
        if (len > 0 && streamStart + len <= buffer.length) {
          streamEnd = streamStart + len;
        }
      } else {
        const indirectLenMatch = dictText.match(/\/Length\s+(\d+)\s+(\d+)\s+R\b/);
        if (indirectLenMatch && indirectInts.has(indirectLenMatch[1])) {
          const len = indirectInts.get(indirectLenMatch[1]);
          if (len > 0 && streamStart + len <= buffer.length) {
            streamEnd = streamStart + len;
          }
        }
      }

      if (streamEnd > streamStart) {
        const streamBytes = buffer.subarray(streamStart, streamEnd);

        // Extract embedded JPEG page images (scanned PDFs)
        // Skip CMYK, tiny fragments, and ensure clean EOI marker
        if (isImage && isJpeg && !isCmyk && images.length < maxImages) {
          if (streamBytes.length > 32 && streamBytes[0] === 0xFF && streamBytes[1] === 0xD8) {
            let eoi = -1;
            for (let i = streamBytes.length - 2; i >= 2; i--) {
              if (streamBytes[i] === 0xFF && streamBytes[i + 1] === 0xD9) {
                eoi = i + 2;
                break;
              }
            }
            const cleanBytes = eoi > 32 ? streamBytes.subarray(0, eoi) : streamBytes;
            try {
              images.push(`data:image/jpeg;base64,${uint8ToBase64(cleanBytes)}`);
            } catch {}
          }
        }

        if (isFlate) {
          const decompressed = await decompressFlate(streamBytes);
          if (decompressed) {
            const decompStr = new TextDecoder("latin1").decode(decompressed);
            // Check for ToUnicode CMap
            if (/beginbfchar|beginbfrange|begincmap/i.test(decompStr)) {
              const parsedMap = parseCMap(decompStr);
              parsedMap.forEach((val, key) => combinedCMap.set(key, val));
            }
            decompressedStreams.push(decompStr);
          }
        } else {
          const uncompStr = new TextDecoder("latin1").decode(streamBytes);
          if (/beginbfchar|beginbfrange|begincmap/i.test(uncompStr)) {
            const parsedMap = parseCMap(uncompStr);
            parsedMap.forEach((val, key) => combinedCMap.set(key, val));
          }
          decompressedStreams.push(uncompStr);
        }
      }
    }

    const extractedBlocks = [];

    // Text extracted from content streams with CMap resolution
    for (const streamStr of decompressedStreams) {
      const subTexts = parseTextOperators(streamStr, combinedCMap);
      if (subTexts.length) extractedBlocks.push(...subTexts);
    }

    const uniqueBlocks = [];
    let last = "";
    for (const b of extractedBlocks) {
      if (b !== last) {
        uniqueBlocks.push(b);
        last = b;
      }
    }

    const cleanedBlocks = uniqueBlocks
      .map((b) => b.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, "").trim())
      .filter((b) => b.length > 0);

    const text = cleanedBlocks.join("\n\n").trim();
    // If text was extracted (> 40 chars), this is a digital text document, not a scan.
    // Suppress embedded image streams (logos, formulas, decorations) to prevent vision decoder failures.
    const imagesToReturn = (!options.includeImagesWithText && text.length > 40) ? [] : images;
    return { text, images: imagesToReturn };
  }

  async function extractText(source) {
    const data = await extractPdfData(source);
    return data.text || "";
  }

  async function extractImages(source, maxImages = 10) {
    const data = await extractPdfData(source, maxImages, { includeImagesWithText: true });
    return data.images || [];
  }

  function parseZipEntries(buffer) {

    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const entries = [];
    let pos = 0;

    while (pos + 30 <= bytes.length) {
      if (bytes[pos] !== 0x50 || bytes[pos + 1] !== 0x4b || bytes[pos + 2] !== 0x03 || bytes[pos + 3] !== 0x04) {
        break;
      }

      const flags = view.getUint16(pos + 6, true);
      const method = view.getUint16(pos + 8, true);
      let compSize = view.getUint32(pos + 18, true);
      const nameLen = view.getUint16(pos + 26, true);
      const extraLen = view.getUint16(pos + 28, true);

      const nameBytes = bytes.subarray(pos + 30, pos + 30 + nameLen);
      const filename = new TextDecoder("utf-8").decode(nameBytes);
      const dataOffset = pos + 30 + nameLen + extraLen;

      if ((flags & 8) !== 0 && compSize === 0) {
        let nextPk = dataOffset;
        while (nextPk + 4 <= bytes.length) {
          if (bytes[nextPk] === 0x50 && bytes[nextPk + 1] === 0x4b && (bytes[nextPk + 2] === 0x03 || bytes[nextPk + 2] === 0x01)) {
            break;
          }
          nextPk++;
        }
        compSize = nextPk - dataOffset;
      }

      const compressedBytes = bytes.subarray(dataOffset, dataOffset + compSize);
      entries.push({ filename, method, data: compressedBytes });
      pos = dataOffset + compSize;
      if ((flags & 8) !== 0 && pos + 4 <= bytes.length && bytes[pos] === 0x50 && bytes[pos + 1] === 0x4b && bytes[pos + 2] === 0x07 && bytes[pos + 3] === 0x08) {
        pos += 16;
      }
    }

    return entries;
  }

  async function decompressZipEntry(entry) {
    if (!entry) return "";
    if (entry.method === 0) {
      return new TextDecoder("utf-8").decode(entry.data);
    }
    if (entry.method === 8) {
      if (typeof zlib !== "undefined") {
        try {
          return new TextDecoder("utf-8").decode(zlib.inflateRawSync(entry.data));
        } catch {}
      }
      if (typeof DecompressionStream !== "undefined" && typeof Response !== "undefined" && typeof Blob !== "undefined") {
        try {
          const stream = new Blob([entry.data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
          const buffer = await new Response(stream).arrayBuffer();
          return new TextDecoder("utf-8").decode(buffer);
        } catch {}
      }
    }
    return "";
  }

  /**
   * Extract readable text from an Office document (.docx, .pptx, .xlsx).
   */
  async function extractOfficeText(source, filename = "") {
    if (!source) return "";
    let buffer;
    if (source instanceof ArrayBuffer) {
      buffer = new Uint8Array(source);
    } else if (source instanceof Uint8Array) {
      buffer = source;
    } else if (typeof source === "string") {
      const match = source.match(/^data:[^;]+;base64,(.+)$/s);
      const b64 = match ? match[1] : source;
      try {
        if (typeof Buffer !== "undefined") {
          buffer = new Uint8Array(Buffer.from(b64, "base64"));
        } else if (typeof atob === "function") {
          const bin = atob(b64);
          buffer = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) buffer[i] = bin.charCodeAt(i);
        }
      } catch {
        return "";
      }
    }

    if (!buffer || !buffer.length) return "";

    const lower = String(filename || "").toLowerCase();
    const isDocx = lower.endsWith(".docx");
    const isPptx = lower.endsWith(".pptx");
    const isXlsx = lower.endsWith(".xlsx");

    try {
      const entries = parseZipEntries(buffer);
      if (!entries.length) return "";

      if (isDocx || (!isPptx && !isXlsx && entries.some((e) => e.filename === "word/document.xml"))) {
        const docEntry = entries.find((e) => e.filename === "word/document.xml");
        if (docEntry) {
          const xml = await decompressZipEntry(docEntry);
          return xml.replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        }
      } else if (isPptx || entries.some((e) => e.filename.startsWith("ppt/"))) {
        const slideEntries = entries.filter((e) => /^ppt\/slides\/slide\d+\.xml$/i.test(e.filename));
        slideEntries.sort((a, b) => a.filename.localeCompare(b.filename, undefined, { numeric: true }));
        const slides = [];
        for (let i = 0; i < slideEntries.length; i++) {
          const xml = await decompressZipEntry(slideEntries[i]);
          const text = xml.replace(/<\/a:p>/g, "\n").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
          if (text) slides.push(`[Slide ${i + 1}]\n${text}`);
        }
        return slides.join("\n\n");
      } else if (isXlsx || entries.some((e) => e.filename.startsWith("xl/"))) {
        const stringsEntry = entries.find((e) => e.filename === "xl/sharedStrings.xml");
        if (stringsEntry) {
          const xml = await decompressZipEntry(stringsEntry);
          return xml.replace(/<\/t>/g, " ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
        }
      }
    } catch (err) {
      console.warn("extractOfficeText error:", err);
    }
    return "";
  }

  globalThis.VelaPdf = Object.freeze({
    PAGE_SIZES,
    cleanMarkdownFormatting,
    normalizeLatexMath,
    extractMcqOptions,
    renderInlineMarkdown,
    parseDocument,
    measureTextWidth,
    wrapText,
    estimateElementHeight,
    autoPaginateElements,
    buildPdf,
    createPreview,
    printPdf,
    extractText,
    extractImages,
    extractPdfData,
    extractOfficeText
  });
})();
