(() => {
  "use strict";

  const PREVIEWABLE_LANGUAGES = Object.freeze(["html", "svg", "markdown", "mermaid", "csv", "json", "pdf", "pptx"]);
  const SUPPORTED_LANGUAGES = Object.freeze([
    "html",
    "svg",
    "markdown",
    "python",
    "javascript",
    "js",
    "css",
    "json",
    "csv",
    "tsv",
    "mermaid",
    "pdf",
    "pptx"
  ]);

  function normalizeLanguage(language, source) {
    const value = String(language || "text").trim().toLowerCase();
    if (["htm", "html5"].includes(value)) return "html";
    if (["md"].includes(value)) return "markdown";
    if (["py", "python3"].includes(value)) return "python";
    if (["xml"].includes(value)) return "svg";
    if (["pdf"].includes(value)) return "pdf";
    if (["pptx", "presentation", "powerpoint", "slides", "deck"].includes(value)) return "pptx";
    if ((value === "json" || value === "text" || !value) && typeof source === "string" && /"slides"\s*:\s*\[/i.test(source)) return "pptx";
    return value;
  }

  function extensionFor(language) {
    const normalized = normalizeLanguage(language);
    return ({
      html: "html",
      svg: "svg",
      markdown: "md",
      python: "py",
      javascript: "js",
      js: "js",
      json: "json",
      css: "css",
      csv: "csv",
      tsv: "tsv",
      mermaid: "mmd",
      pdf: "pdf",
      pptx: "pptx"
    })[normalized] || "txt";
  }

  const TITLE_FALLBACKS = Object.freeze({
    html: ["Luminous Canvas", "Quiet Landing", "Northstar Studio", "Mosaic Interface", "Evergreen Page"],
    svg: ["Prism Artwork", "Contour Study", "Orbit Illustration", "Signal Mark", "Woven Vector"],
    markdown: ["Field Notes", "Clarity Brief", "Working Memo", "Northstar Notes", "Project Chronicle"],
    python: ["Atlas Script", "Signal Engine", "Juniper Utility", "Pathfinder Module", "Lattice Worker"],
    javascript: ["Pulse Logic", "Orbit Controller", "Lumen Interaction", "Mosaic Runtime", "Signal Module"],
    js: ["Pulse Logic", "Orbit Controller", "Lumen Interaction", "Mosaic Runtime", "Signal Module"],
    css: ["Visual Language", "Surface System", "Lumen Styles", "Mosaic Theme", "Polished Interface"],
    json: ["Structured Dataset", "Project Schema", "Signal Records", "Atlas Data", "Content Model"],
    csv: ["Insight Table", "Project Dataset", "Signal Matrix", "Atlas Records", "Field Data"],
    tsv: ["Insight Table", "Project Dataset", "Signal Matrix", "Atlas Records", "Field Data"],
    mermaid: ["System Map", "Journey Flow", "Architecture Path", "Process Blueprint", "Signal Diagram"],
    pdf: ["Executive Report", "Publication Brief", "Summary Paper", "Analysis Document", "Field Dossier"],
    pptx: ["Presentation Deck", "Executive Briefing", "Strategic Overview", "Keynote Slides", "Project Review"]
  });

  function cleanTitle(value) {
    return String(value || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/[`*_#~[\]{}]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 72);
  }

  function inferredTitle(language, source) {
    const normalized = normalizeLanguage(language);
    const value = String(source || "");
    const patterns = {
      html: [/<title[^>]*>([\s\S]*?)<\/title>/i, /<h1[^>]*>([\s\S]*?)<\/h1>/i],
      svg: [/<title[^>]*>([\s\S]*?)<\/title>/i],
      markdown: [
        /^\s*title:\s*["']?([^"'\n]+)/im,
        /^\s*#\s+(.+)$/m
      ],
      pdf: [/^\s*#\s+(.+)$/m, /\/Title\s*\(([^)]+)\)/i],
      pptx: [
        /^\s*#\s+(.+)$/m,
        /^\s*(?:title|headline|heading):\s*["']?([^"'\n]+)/im,
        /"(?:title|headline|heading)"\s*:\s*"([^"\n]+)"/i,
        /'(?:title|headline|heading)'\s*:\s*'([^'\n]+)'/i
      ],
      python: [/^\s*(?:class|def)\s+([A-Za-z_]\w*)/m],
      javascript: [/^\s*(?:export\s+)?(?:class|function)\s+([A-Za-z_$][\w$]*)/m],
      js: [/^\s*(?:export\s+)?(?:class|function)\s+([A-Za-z_$][\w$]*)/m],
      css: [/\/\*\s*(?:theme|title|project)?\s*:?\s*([^*\n]{3,72})\s*\*\//i],
      mermaid: [/^\s*(?:title|accTitle:)\s*:?\s*(.+)$/mi]
    };
    for (const pattern of patterns[normalized] || []) {
      const match = value.match(pattern);
      const title = cleanTitle(match?.[1]);
      if (title) return title;
    }
    if (["json", "pdf", "pptx"].includes(normalized)) {
      try {
        let parsed = null;
        try { parsed = JSON.parse(value); } catch {
          const cleaned = value.replace(/,\s*([}\]])/g, "$1").replace(/\\([^"\\\/bfnrtu])/g, "$1");
          parsed = JSON.parse(cleaned);
        }
        if (parsed) {
          const firstSlide = Array.isArray(parsed) ? parsed[0] : (Array.isArray(parsed.slides) ? parsed.slides[0] : null);
          const title = cleanTitle(
            parsed?.title || parsed?.headline || parsed?.name || parsed?.label || parsed?.deckTitle ||
            firstSlide?.title || firstSlide?.headline
          );
          if (title) return title;
        }
      } catch {}
    }
    return "";
  }

  function titleFor(language, source, index = 0) {
    const normalized = normalizeLanguage(language);
    if (arguments.length < 2) {
      const generic = {
        html: "Web preview", svg: "Vector artwork", markdown: "Document",
        python: "Python source", javascript: "JavaScript source", js: "JavaScript source",
        css: "Stylesheet", json: "JSON data", csv: "Data table", tsv: "Data table", mermaid: "Diagram",
        pdf: "PDF document", pptx: "Presentation"
      };
      return generic[normalized] || `${normalized.toUpperCase()} artifact`;
    }
    const inferred = inferredTitle(normalized, source);
    if (inferred) return inferred;
    const choices = TITLE_FALLBACKS[normalized] || ["Crafted Artifact", "Project Canvas", "Creative Output"];
    const seed = parseInt(signatureFor(normalized, source).slice(0, 6), 36) || Number(index) || 0;
    return choices[Math.abs(seed + Number(index || 0)) % choices.length];
  }

  function slugFor(value) {
    return cleanTitle(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48);
  }

  function fileNameFor(language, source = "", index = 0) {
    const normalized = normalizeLanguage(language);
    const extension = extensionFor(normalized);
    const base = slugFor(titleFor(normalized, source, index)) || `artifact-${Number(index) + 1}`;
    return `${base}.${extension}`;
  }

  function signatureFor(language, source) {
    let hash = 2166136261;
    const value = `${normalizeLanguage(language)}:${String(source || "")}`;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function isComplete(language, source) {
    if (!source || typeof source !== "string") return false;
    const text = source.trim();
    if (text.length < 5) return false;

    // Truncation markers from interrupted generation
    if (/(?:\[\s*\.\.\.[^\]]*\]|\/\/\s*\.\.\.[\s\S]*|#\s*\.\.\.[\s\S]*|\/\*[\s\S]*?\.\.\.[\s\S]*?\*\/)/i.test(text) && /(?:truncated|continue|cut off|rest)/i.test(text)) {
      return false;
    }

    // Unclosed SEARCH/REPLACE hunks
    if (text.includes("<<<<<<< SEARCH")) {
      const hasSep = text.includes("=======");
      const hasEnd = text.includes(">>>>>>>");
      if (!hasSep || !hasEnd) return false;
      if (typeof globalThis.VelaCodeWorkspace?.parseHunks === "function") {
        const hunks = globalThis.VelaCodeWorkspace.parseHunks(text);
        if (!hunks || hunks.length === 0) return false;
      }
    }

    const normalized = normalizeLanguage(language);

    if (normalized === "html") {
      if (/<[a-zA-Z][^>]*$/.test(text)) return false;
      if (/<html\b[^>]*>/i.test(text) && !/<\/html\s*>/i.test(text)) return false;
      if (/<body\b[^>]*>/i.test(text) && !/<\/body\s*>/i.test(text)) return false;
      if (/<head\b[^>]*>/i.test(text) && !/<\/head\s*>/i.test(text)) return false;
      const scriptOpen = (text.match(/<script\b/gi) || []).length;
      const scriptClose = (text.match(/<\/script\s*>/gi) || []).length;
      if (scriptOpen > scriptClose) return false;
      const styleOpen = (text.match(/<style\b/gi) || []).length;
      const styleClose = (text.match(/<\/style\s*>/gi) || []).length;
      if (styleOpen > styleClose) return false;
      return true;
    }

    if (normalized === "svg") {
      if (!/<svg\b[^>]*>/i.test(text)) return false;
      if (!/<\/svg\s*>/i.test(text)) return false;
      if (/<[a-zA-Z][^>]*$/.test(text)) return false;
      return true;
    }

  function isValidJson(source) {
    if (!source || typeof source !== "string") return false;
    const trimmed = source.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      try {
        let cleaned = trimmed
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/^\s*\/\/.*$/gm, "")
          .replace(/\\([^"\\\/bfnrtu])/g, "$1")
          .replace(/,\s*([}\]])/g, "$1");
        JSON.parse(cleaned);
        return true;
      } catch {
        return false;
      }
    }
  }

    if (normalized === "json") {
      return isValidJson(text);
    }

    if (normalized === "css") {
      if (text.includes("/*") && !text.includes("*/")) return false;
      const open = (text.match(/{/g) || []).length;
      const close = (text.match(/}/g) || []).length;
      if (open > close) return false;
      if (/[:=]\s*$/.test(text)) return false;
      return true;
    }

    if (["javascript", "js", "ts", "typescript", "jsx", "tsx"].includes(normalized)) {
      if (/(?:=>|[+\-*/%=&|^~?,:])\s*$/.test(text)) return false;
      if (/\b(?:function|class|const|let|var|return|import|export|if|else|while|for|switch|case|try|catch|finally|throw|new|typeof|await|async)\s*$/.test(text)) return false;
      const sanitized = text
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*/g, "")
        .replace(/'(?:[^'\\]|\\.)*'/g, "''")
        .replace(/"(?:[^"\\]|\\.)*"/g, '""')
        .replace(/`(?:[^`\\]|\\.)*`/g, "``");
      const openCurly = (sanitized.match(/{/g) || []).length;
      const closeCurly = (sanitized.match(/}/g) || []).length;
      if (openCurly > closeCurly) return false;
      const openParen = (sanitized.match(/\(/g) || []).length;
      const closeParen = (sanitized.match(/\)/g) || []).length;
      if (openParen > closeParen) return false;
      const openBracket = (sanitized.match(/\[/g) || []).length;
      const closeBracket = (sanitized.match(/\]/g) || []).length;
      if (openBracket > closeBracket) return false;
      return true;
    }

    if (normalized === "python") {
      if (/:\s*$/.test(text)) return false;
      if (/(?:[+\-*/%=&|^~\\,]|\band|\bor|\bnot|\bin|\bis)\s*$/.test(text)) return false;
      if (/\b(?:def|class|if|elif|else|while|for|try|except|finally|with|return|lambda|import|from)\s*$/.test(text)) return false;
      const openParen = (text.match(/\(/g) || []).length;
      const closeParen = (text.match(/\)/g) || []).length;
      if (openParen > closeParen) return false;
      const openBracket = (text.match(/\[/g) || []).length;
      const closeBracket = (text.match(/\]/g) || []).length;
      if (openBracket > closeBracket) return false;
      return true;
    }

    if (normalized === "mermaid") {
      return /^\s*(?:graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|gitGraph|quadrantChart|xychart-beta|mindmap|timeline|zenuml|sankey|packet-beta|title|accTitle)\b/i.test(text);
    }

    if (["pdf", "pptx"].includes(normalized)) {
      if (text.startsWith("{") || text.startsWith("[")) {
        if (isValidJson(text)) return true;
        const openCurly = (text.match(/{/g) || []).length;
        const closeCurly = (text.match(/}/g) || []).length;
        const openBracket = (text.match(/\[/g) || []).length;
        const closeBracket = (text.match(/\]/g) || []).length;
        if (openCurly === closeCurly && openBracket === closeBracket && (text.endsWith("}") || text.endsWith("]"))) {
          return true;
        }
        return false;
      }
      if (text.startsWith("data:") || text.startsWith("blob:")) {
        return text.length >= 10;
      }
      if (text.startsWith("%PDF-")) {
        return text.includes("%%EOF") || text.length > 50;
      }
      return text.length >= 10;
    }

    return true;
  }

  function extractFromMarkdown(markdown) {
    const artifacts = [];
    const expression = /```([\w+-]*)\s*\n([\s\S]*?)```/g;
    let match;

    while ((match = expression.exec(String(markdown || "")))) {
      const source = match[2].replace(/\s+$/, "");
      const language = normalizeLanguage(match[1] || "text", source);
      if (!SUPPORTED_LANGUAGES.includes(language)) continue;
      if (!isComplete(language, source)) continue;
      artifacts.push({
        language,
        source,
        previewable: PREVIEWABLE_LANGUAGES.includes(language),
        order: artifacts.length
      });
    }

    return artifacts;
  }

  globalThis.VelaArtifacts = Object.freeze({
    PREVIEWABLE_LANGUAGES,
    SUPPORTED_LANGUAGES,
    normalizeLanguage,
    extensionFor,
    titleFor,
    inferredTitle,
    fileNameFor,
    signatureFor,
    isComplete,
    extractFromMarkdown
  });
})();
