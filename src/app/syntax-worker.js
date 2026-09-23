// syntax-worker.js - Off-thread syntax highlighting worker
self.onmessage = function (event) {
  const { id, code, language } = event.data || {};
  if (!id) return;

  try {
    let highlighted = "";
    if (typeof self.hljs !== "undefined" && self.hljs.highlight) {
      try {
        const lang = language && self.hljs.getLanguage(language) ? language : "plaintext";
        highlighted = self.hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
      } catch {
        highlighted = escapeHTML(code);
      }
    } else {
      highlighted = fallbackHighlight(code, language);
    }
    self.postMessage({ id, highlighted, success: true });
  } catch (err) {
    self.postMessage({ id, highlighted: escapeHTML(code), success: false, error: err.message });
  }
};

function escapeHTML(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function fallbackHighlight(source, language) {
  const input = String(source || "");
  const keywords = new Set([
    "const", "let", "var", "function", "class", "return", "import", "export",
    "if", "else", "for", "while", "def", "async", "await", "from", "as",
    "try", "catch", "finally", "throw", "new", "this", "super", "select",
    "from", "where", "insert", "update", "delete", "table", "public", "private"
  ]);

  const pattern = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*|`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b/g;
  let output = "";
  let offset = 0;

  for (const match of input.matchAll(pattern)) {
    output += escapeHTML(input.slice(offset, match.index));
    const token = match[0];
    let cls = "plain";
    if (/^(?:\/\*|\/\/|#)/.test(token)) cls = "comment";
    else if (/^["'`]/.test(token)) cls = "string";
    else if (/^-?\d/.test(token)) cls = "number";
    else if (keywords.has(token.toLowerCase())) cls = "keyword";

    output += cls === "plain" ? escapeHTML(token) : `<span class="tok-${cls}">${escapeHTML(token)}</span>`;
    offset = match.index + token.length;
  }
  return output + escapeHTML(input.slice(offset));
}
