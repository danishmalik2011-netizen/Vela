(() => {
  "use strict";

  const KEYWORDS = Object.freeze({
    javascript: "async await break case catch class const continue debugger default delete do else export extends finally for from function get if import in instanceof let new of return set static super switch throw try typeof var void while with yield true false null undefined this",
    typescript: "abstract any as asserts async await boolean break case catch class const constructor continue declare default delete do else enum export extends false finally for from function get if implements import in infer instanceof interface is keyof let namespace never new null number object of private protected public readonly return set static string super switch symbol this throw true try type typeof undefined unknown var void while with yield",
    python: "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield",
    html: "",
    css: "@media @supports @keyframes !important",
    json: "true false null",
    java: "abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null",
    csharp: "abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while async await",
    bash: "case do done elif else esac fi for function if in then until while export local readonly return"
  });

  const ALIASES = Object.freeze({ js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript", py: "python", sh: "bash", shell: "bash", yml: "yaml", cs: "csharp", xml: "html", svg: "html" });

  function escape(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
  }

  function canonical(language) {
    const value = String(language || "text").toLowerCase().replace(/^language-/, "");
    return ALIASES[value] || value;
  }

  function grammar(language) {
    const lang = canonical(language);
    if (["html", "xml"].includes(lang)) return /<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>|&[A-Za-z#0-9]+;/g;
    if (lang === "css") return /\/\*[\s\S]*?\*\/|#[\da-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|rem|em|vh|vw|%|s|ms|deg)?\b|--[\w-]+|[.#]?[A-Za-z_-][\w-]*(?=\s*\{)|[\w-]+(?=\s*:)/g;
    if (["json", "yaml"].includes(lang)) return /"(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b|^\s*[\w.-]+(?=\s*:)/gim;
    return /\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*|`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b/g;
  }

  function tokenClass(token, language) {
    const lang = canonical(language);
    if (/^(?:\/\*|\/\/|#(?![\da-fA-F]{3,8}\b)|<!--)/.test(token)) return "comment";
    if (/^<\/?[A-Za-z]/.test(token)) return "tag";
    if (/^&/.test(token)) return "entity";
    if (/^["'`]/.test(token)) return /["']\s*$/.test(token) && /:\s*$/.test(token) ? "property" : "string";
    if (/^-?\d/.test(token) || /^#[\da-fA-F]{3,8}$/.test(token)) return "number";
    if (token.startsWith("--")) return "variable";
    if (/^[.#]/.test(token) && lang === "css") return "selector";
    const keywords = new Set(String(KEYWORDS[lang] || KEYWORDS.javascript || "").split(/\s+/));
    if (keywords.has(token)) return ["true", "false", "null", "undefined", "None", "True", "False"].includes(token) ? "literal" : "keyword";
    if (/^[A-Z][\w$]*$/.test(token)) return "class";
    if (/^[\w-]+$/.test(token) && lang === "css") return "property";
    return "plain";
  }

  function highlight(source, language) {
    const input = String(source || "");
    const pattern = grammar(language);
    let output = "";
    let offset = 0;
    for (const match of input.matchAll(pattern)) {
      output += escape(input.slice(offset, match.index));
      const type = tokenClass(match[0], language);
      output += type === "plain" ? escape(match[0]) : `<span class="tok-${type}">${escape(match[0])}</span>`;
      offset = match.index + match[0].length;
    }
    return output + escape(input.slice(offset));
  }

  const HLJS_LANGUAGES = Object.freeze({
    javascript: "javascript", js: "javascript", jsx: "javascript",
    typescript: "typescript", ts: "typescript", tsx: "typescript",
    python: "python", py: "python",
    html: "xml", xml: "xml", svg: "xml", vue: "xml",
    css: "css", scss: "scss", less: "less",
    json: "json", yaml: "yaml", yml: "yaml",
    bash: "bash", sh: "bash", shell: "bash",
    java: "java", csharp: "csharp", cs: "csharp",
    c: "c", cpp: "cpp", h: "c", hpp: "cpp",
    go: "go", rust: "rust", php: "php", ruby: "ruby", rb: "ruby",
    sql: "sql", kotlin: "kotlin", swift: "swift",
    markdown: "markdown", md: "markdown",
    dockerfile: "dockerfile", ini: "ini", toml: "ini",
    diff: "diff", graphql: "graphql", lua: "lua", perl: "perl",
    r: "r", scala: "scala", dart: "dart", powershell: "powershell"
  });

  function enhanceWithHighlightJs(code, language) {
    const hljs = globalThis.hljs;
    if (!hljs) return false;
    const target = HLJS_LANGUAGES[language] || (hljs.getLanguage?.(language) ? language : "");
    try {
      if (target && hljs.getLanguage(target)) {
        code.innerHTML = hljs.highlight(code.textContent, { language: target, ignoreIllegals: true }).value;
      } else {
        code.innerHTML = hljs.highlightAuto(code.textContent).value;
      }
      code.classList.add("hljs");
      return true;
    } catch {
      return false;
    }
  }

  function enhance(container) {
    container?.querySelectorAll("pre > code").forEach((code) => {
      if (code.dataset.velaHighlighted === "true") return;
      const languageClass = [...code.classList].find((name) => name.startsWith("language-"));
      const language = canonical(languageClass?.slice(9) || code.dataset.language || "text");
      code.dataset.language = language;
      code.dataset.velaHighlighted = "true";
      code.classList.add("vela-highlighted");
      if (!enhanceWithHighlightJs(code, language)) {
        code.innerHTML = highlight(code.textContent, language);
      }
    });
  }

  globalThis.VelaSyntaxHighlight = Object.freeze({ canonical, highlight, enhance });
})();
