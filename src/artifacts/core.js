(() => {
  "use strict";

  const PREVIEWABLE_LANGUAGES = Object.freeze(["html", "svg", "markdown", "mermaid", "csv", "json"]);
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
    "mermaid"
  ]);

  function normalizeLanguage(language) {
    const value = String(language || "text").trim().toLowerCase();
    if (["htm", "html5"].includes(value)) return "html";
    if (["md"].includes(value)) return "markdown";
    if (["py", "python3"].includes(value)) return "python";
    if (["xml"].includes(value)) return "svg";
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
      mermaid: "mmd"
    })[normalized] || "txt";
  }

  function titleFor(language) {
    const normalized = normalizeLanguage(language);
    const titles = {
      html: "Web preview",
      svg: "Vector artwork",
      markdown: "Document",
      python: "Python source",
      javascript: "JavaScript source",
      js: "JavaScript source",
      css: "Stylesheet",
      json: "JSON data",
      csv: "Data table",
      tsv: "Data table",
      mermaid: "Diagram"
    };
    return titles[normalized] || `${normalized.toUpperCase()} artifact`;
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

  function extractFromMarkdown(markdown) {
    const artifacts = [];
    const expression = /```([\w+-]*)\s*\n([\s\S]*?)```/g;
    let match;

    while ((match = expression.exec(String(markdown || "")))) {
      const language = normalizeLanguage(match[1] || "text");
      if (!SUPPORTED_LANGUAGES.includes(language)) continue;
      artifacts.push({
        language,
        source: match[2].replace(/\s+$/, ""),
        previewable: PREVIEWABLE_LANGUAGES.includes(language)
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
    signatureFor,
    extractFromMarkdown
  });
})();
