(() => {
  "use strict";

  // Cache for Katex rendered expressions to avoid recomputation
  const mathCache = new Map();

  function escapeHTML(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function hashString(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return (hash >>> 0).toString(36);
  }

  // 1. Math Rendering via KaTeX (or clean fallback)
  function renderMath(tex, displayMode) {
    const key = `${displayMode ? "D" : "I"}:${tex}`;
    if (mathCache.has(key)) return mathCache.get(key);

    if (typeof globalThis.katex !== "undefined" && typeof globalThis.katex.renderToString === "function") {
      try {
        const rendered = globalThis.katex.renderToString(tex, {
          displayMode: Boolean(displayMode),
          throwOnError: false,
          output: "htmlAndMathml"
        });
        mathCache.set(key, rendered);
        return rendered;
      } catch (err) {
        console.warn("KaTeX render error:", err);
      }
    }

    // Typographic fallback if KaTeX is not loaded yet
    const cls = displayMode ? "math-block katex-fallback-block" : "math-inline katex-fallback-inline";
    const tag = displayMode ? "div" : "span";
    const cleanTex = escapeHTML(tex);
    const html = `<${tag} class="${cls}" data-tex="${cleanTex}">${cleanTex}</${tag}>`;
    mathCache.set(key, html);
    return html;
  }

  function protectMath(source) {
    const tokens = [];
    const store = (tex, display) => {
      const token = `%%VELAMATH_${tokens.length}_${hashString(tex)}%%`;
      tokens.push({ tex, display, token });
      return display ? `\n\n${token}\n\n` : token;
    };

    let text = String(source || "");

    // Block math: $$ ... $$
    text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_, tex) => store(tex.trim(), true));
    // Block math: \[ ... \]
    text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_, tex) => store(tex.trim(), true));
    // Inline math: \( ... \)
    text = text.replace(/\\\((.+?)\\\)/g, (_, tex) => store(tex.trim(), false));
    // Inline math: $ ... $ (avoiding currency like $5 or $$)
    text = text.replace(/(^|[^\w\\$])\$([^\n$]+?)\$(?!\$)/g, (_, prefix, tex) => {
      if (/^\s+|\s+$/.test(tex)) return `${prefix}$${tex}$`; // reject space padding
      return `${prefix}${store(tex.trim(), false)}`;
    });

    return { text, tokens };
  }

  function restoreMath(html, tokens) {
    let result = html;
    for (const { tex, display, token } of tokens) {
      const rendered = renderMath(tex, display);
      // If marked wrapped the block token in a <p>, replace the whole <p>
      const pPattern = new RegExp(`<p>\\s*${token}\\s*<\\/p>`, "g");
      if (pPattern.test(result)) {
        result = result.replace(pPattern, rendered);
      }
      result = result.replaceAll(token, rendered);
    }
    return result;
  }

  // 2. Footnotes Extension
  function extractFootnoteDefinitions(markdown) {
    const notes = new Map();
    const cleanMarkdown = String(markdown || "").replace(/^\[\^([^\]]+)\]:\s*([^\n]+(?:\n+(?: {4}|\t)[^\n]+)*)/gm, (_, id, content) => {
      notes.set(id.trim(), content.trim().replace(/\n+(?: {4}|\t)/g, " "));
      return "";
    });
    return { cleanMarkdown, notes };
  }

  function injectFootnotes(html, notes) {
    if (!notes || notes.size === 0) return { text: html, footnotesHtml: "" };
    let refIndex = 1;
    const refMap = new Map();
    const replaced = html.replace(/\[\^([^\]]+)\]/g, (match, id) => {
      const cleanId = id.trim();
      if (!notes.has(cleanId)) return match;
      if (!refMap.has(cleanId)) {
        refMap.set(cleanId, refIndex++);
      }
      const num = refMap.get(cleanId);
      return `<sup class="footnote-ref"><a href="#fn-${cleanId}" id="fnref-${cleanId}">[${num}]</a></sup>`;
    });

    if (refMap.size === 0) return { text: replaced, footnotesHtml: "" };

    const listItems = [];
    for (const [id, num] of refMap.entries()) {
      const noteContent = notes.get(id) || "";
      listItems.push(
        `<li id="fn-${escapeHTML(id)}">` +
        `<span>${escapeHTML(noteContent)}</span> ` +
        `<a href="#fnref-${escapeHTML(id)}" class="footnote-backref" aria-label="Back to reference">↩</a>` +
        `</li>`
      );
    }

    const footnotesHtml = `<section class="footnotes" role="doc-endnotes"><hr><ol>${listItems.join("")}</ol></section>`;
    return { text: replaced, footnotesHtml };
  }

  // 3. Definition Lists
  function processDefinitionLists(text) {
    // Term\n: Definition
    return text.replace(/^([^\n]+)\n:\s+([^\n]+(?:\n:\s+[^\n]+)*)/gm, (_, term, defs) => {
      const ddItems = defs.split(/\n:\s+/).map((d) => `<dd>${d.trim()}</dd>`).join("");
      return `<dl class="markdown-deflist"><dt>${term.trim()}</dt>${ddItems}</dl>`;
    });
  }

  // 4. Stabilize Incomplete Streaming Markdown
  function stabilizeStreamingMarkdown(text) {
    if (!text || typeof text !== "string") return "";
    let stabilized = text;

    // Check for unclosed code fence
    const lines = stabilized.split("\n");
    let inFence = false;
    let fenceChar = "";
    let fenceLen = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(/^(\s*)(`{3,}|~{3,})/);
      if (match) {
        const char = match[2][0];
        const len = match[2].length;
        if (!inFence) {
          inFence = true;
          fenceChar = char;
          fenceLen = len;
        } else if (char === fenceChar && len >= fenceLen) {
          inFence = false;
        }
      }
    }

    // If stream ended inside a code fence, close it for rendering
    if (inFence) {
      stabilized += `\n${fenceChar.repeat(fenceLen)}`;
    }

    return stabilized;
  }

  // 5. Interactive Task Lists Sanitizer & Enhancer
  function enhanceTaskLists(html) {
    // Transform disabled checkbox list items into interactive ones
    return html.replace(
      /<li([^>]*)><input([^>]*?)type="checkbox"([^>]*?)>/gi,
      (match, liAttr, before, after) => {
        const isChecked = /checked/i.test(before + after);
        return `<li${liAttr} class="task-list-item"><input type="checkbox" class="task-list-item-checkbox"${isChecked ? " checked" : ""}>`;
      }
    );
  }

  // 6. Mermaid Syntax Validator and Handler
  function enhanceMermaidFences(html) {
    // Transform ```mermaid into responsive, fault-tolerant mermaid containers
    return html.replace(
      /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/gi,
      (_, rawCode) => {
        const decoded = rawCode
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#039;/g, "'")
          .trim();
        const id = `mermaid-${hashString(decoded)}-${Math.random().toString(36).slice(2, 7)}`;
        return `
          <div class="artifact-mermaid-container" data-mermaid-id="${id}">
            <div class="artifact-mermaid-surface mermaid" id="${id}">${escapeHTML(decoded)}</div>
            <div class="artifact-mermaid-fallback" style="display:none;"></div>
          </div>
        `;
      }
    );
  }

  function inlineFormat(text) {
    return String(text || "")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/__([^_]+)__/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/(^|\s)_([^_]+)_($|\s)/g, "$1<em>$2</em>$3")
      .replace(/~~([^~]+)~~/g, "<del>$1</del>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/(^|[^"'])(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
  }

  function parseMarkdownNatively(source) {
    const lines = String(source || "").replace(/\r\n/g, "\n").split("\n");
    const htmlBlocks = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (!line.trim()) {
        i++;
        continue;
      }

      // Raw HTML block (e.g. <dl>, <section>, <div>, <img>, etc. passed down from extensions)
      if (/^\s*<\/?[a-zA-Z][\s\S]*>/.test(line)) {
        const rawLines = [line];
        i++;
        while (
          i < lines.length &&
          lines[i].trim() &&
          !/^#{1,6}\s+/.test(lines[i]) &&
          !/^(\s*)(`{3,}|~{3,})/.test(lines[i])
        ) {
          rawLines.push(lines[i]);
          i++;
        }
        htmlBlocks.push(rawLines.join("\n"));
        continue;
      }

      // Code fence
      const fenceMatch = line.match(/^(\s*)(`{3,}|~{3,})([\w+-]*)/);
      if (fenceMatch) {
        const lang = fenceMatch[3] || "text";
        const char = fenceMatch[2][0];
        const fenceLen = fenceMatch[2].length;
        const codeLines = [];
        i++;

        while (i < lines.length) {
          const endMatch = lines[i].match(new RegExp(`^\\s*${char}{${fenceLen},}`));
          if (endMatch) {
            i++;
            break;
          }
          codeLines.push(lines[i]);
          i++;
        }

        htmlBlocks.push(
          `<pre><code class="language-${escapeHTML(lang)}">${escapeHTML(codeLines.join("\n"))}</code></pre>`
        );
        continue;
      }

      // Headings
      const hMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (hMatch) {
        const level = hMatch[1].length;
        htmlBlocks.push(`<h${level}>${inlineFormat(escapeHTML(hMatch[2].trim()))}</h${level}>`);
        i++;
        continue;
      }

      // Blockquote
      if (/^>\s?/.test(line)) {
        const qLines = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) {
          qLines.push(lines[i].replace(/^>\s?/, ""));
          i++;
        }
        htmlBlocks.push(`<blockquote><p>${inlineFormat(escapeHTML(qLines.join(" ")))}</p></blockquote>`);
        continue;
      }

      // Task list or Bullet list
      if (/^\s*[-*+]\s+/.test(line)) {
        const items = [];
        let isTaskList = false;

        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          const rawItem = lines[i].replace(/^\s*[-*+]\s+/, "");
          const taskMatch = rawItem.match(/^\[([ xX])\]\s+(.*)$/);
          if (taskMatch) {
            isTaskList = true;
            const checked = taskMatch[1].toLowerCase() === "x";
            items.push(`<li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox"${checked ? " checked" : ""}> ${inlineFormat(escapeHTML(taskMatch[2]))}</li>`);
          } else {
            items.push(`<li>${inlineFormat(escapeHTML(rawItem))}</li>`);
          }
          i++;
        }

        const ulClass = isTaskList ? ' class="task-list"' : "";
        htmlBlocks.push(`<ul${ulClass}>${items.join("")}</ul>`);
        continue;
      }

      // Numbered list
      if (/^\s*\d+\.\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          const rawItem = lines[i].replace(/^\s*\d+\.\s+/, "");
          items.push(`<li>${inlineFormat(escapeHTML(rawItem))}</li>`);
          i++;
        }
        htmlBlocks.push(`<ol>${items.join("")}</ol>`);
        continue;
      }

      // Table
      if (line.includes("|") && i + 1 < lines.length && lines[i + 1].includes("|-")) {
        const tableLines = [];
        while (i < lines.length && lines[i].includes("|")) {
          tableLines.push(lines[i]);
          i++;
        }
        if (tableLines.length >= 2) {
          const headers = tableLines[0].split("|").slice(1, -1).map((s) => s.trim());
          const rows = tableLines.slice(2).map((r) => r.split("|").slice(1, -1).map((s) => s.trim()));
          const ths = headers.map((h) => `<th>${inlineFormat(escapeHTML(h))}</th>`).join("");
          const trs = rows.map((r) => `<tr>${r.map((c) => `<td>${inlineFormat(escapeHTML(c))}</td>`).join("")}</tr>`).join("");
          htmlBlocks.push(`<table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`);
          continue;
        }
      }

      // Paragraph
      const pLines = [line];
      i++;
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^#{1,6}\s+/.test(lines[i]) &&
        !/^(\s*)(`{3,}|~{3,})/.test(lines[i]) &&
        !/^>\s?/.test(lines[i]) &&
        !/^\s*[-*+]\s+/.test(lines[i]) &&
        !/^\s*\d+\.\s+/.test(lines[i])
      ) {
        pLines.push(lines[i]);
        i++;
      }
      htmlBlocks.push(`<p>${inlineFormat(escapeHTML(pLines.join(" ")))}</p>`);
    }

    return htmlBlocks.join("\n");
  }

  // 7. Full Markdown Parser to HTML
  function renderMarkdownToHtml(markdown, options = {}) {
    if (!markdown) return "";
    const rawInput = String(markdown);
    const stabilized = options.isStreaming ? stabilizeStreamingMarkdown(rawInput) : rawInput;

    // A. Frontmatter check
    let frontmatterHeader = "";
    let body = stabilized;
    if (typeof globalThis.VelaMarkdown?.extractFrontmatter === "function") {
      const fm = globalThis.VelaMarkdown.extractFrontmatter(stabilized);
      if (fm.frontmatter && typeof globalThis.VelaMarkdown?.renderFrontmatterHeader === "function") {
        frontmatterHeader = globalThis.VelaMarkdown.renderFrontmatterHeader(fm.frontmatter);
        body = fm.body;
      }
    }

    // B. Definition lists & Footnote definitions extraction
    const defProcessed = processDefinitionLists(body);
    const { cleanMarkdown, notes: footnoteNotes } = extractFootnoteDefinitions(defProcessed);

    // C. Protect Math
    const { text: mathProtected, tokens } = protectMath(cleanMarkdown);

    // D. Parse markdown blocks (using marked if available, or native CommonMark/GFM engine)
    let parsedHtml = "";
    if (typeof globalThis.marked?.parse === "function") {
      globalThis.marked.setOptions({
        gfm: true,
        breaks: true,
        tables: true,
        pedantic: false
      });
      parsedHtml = globalThis.marked.parse(mathProtected);
    } else {
      parsedHtml = parseMarkdownNatively(mathProtected);
    }

    // E. Inject Footnotes on parsed blocks
    const { text: footnoteProcessed, footnotesHtml } = injectFootnotes(parsedHtml, footnoteNotes);

    // F. Sanitize via DOMPurify with strict policy
    let sanitizedHtml = footnoteProcessed;
    if (typeof globalThis.DOMPurify?.sanitize === "function") {
      sanitizedHtml = globalThis.DOMPurify.sanitize(footnoteProcessed, {
        ADD_ATTR: ["target", "rel", "checked", "disabled", "data-tex", "data-mermaid-id"],
        FORBID_TAGS: ["script", "iframe", "object", "embed", "base", "form"],
        FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur", "style"]
      });
    } else {
      // Basic sanitizer fallback if DOMPurify is not present
      sanitizedHtml = sanitizedHtml
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/\son\w+="[^"]*"/gi, "")
        .replace(/\son\w+='[^']*'/gi, "")
        .replace(/javascript:[^"']*/gi, "");
    }

    // G. Restore Math
    let restored = restoreMath(sanitizedHtml, tokens);

    // H. Task lists & Mermaid
    restored = enhanceTaskLists(restored);
    restored = enhanceMermaidFences(restored);

    if (footnotesHtml) {
      restored += footnotesHtml;
    }

    return frontmatterHeader + restored;
  }

  // 8. Streaming-Safe Incremental DOM Reconciler
  // Replaces whole innerHTML replacement with block-level diffing to prevent layout shifts & loss of state.
  function diffAndRender(container, markdown, options = {}) {
    if (!container) return;
    const newHtml = renderMarkdownToHtml(markdown, options);

    // Create a virtual container to parse elements
    const template = document.createElement("template");
    template.innerHTML = newHtml;
    const newChildren = Array.from(template.content.children);
    const oldChildren = Array.from(container.children);

    let oldIndex = 0;
    let newIndex = 0;

    while (newIndex < newChildren.length) {
      const newNode = newChildren[newIndex];
      const oldNode = oldChildren[oldIndex];

      if (!oldNode) {
        // Appending new block node
        const imported = document.importNode(newNode, true);
        container.appendChild(imported);
        newIndex++;
        continue;
      }

      // Check if nodes match in tagName and basic class
      const sameTag = oldNode.tagName === newNode.tagName;
      const sameClass = oldNode.className === newNode.className;

      if (sameTag && sameClass) {
        // Compare HTML representations
        if (oldNode.innerHTML !== newNode.innerHTML) {
          // If it's a task list item checkbox that user interacted with, preserve checked state if unchanged in source
          const wasChecked = oldNode.querySelector?.(".task-list-item-checkbox")?.checked;
          oldNode.innerHTML = newNode.innerHTML;
          if (wasChecked !== undefined && !newNode.querySelector?.(".task-list-item-checkbox")?.hasAttribute("checked")) {
            const cb = oldNode.querySelector?.(".task-list-item-checkbox");
            if (cb) cb.checked = wasChecked;
          }
        }
        oldIndex++;
        newIndex++;
      } else {
        // Different node: replace oldNode with newNode
        const imported = document.importNode(newNode, true);
        container.insertBefore(imported, oldNode);
        container.removeChild(oldNode);
        oldIndex++;
        newIndex++;
      }
    }

    // Remove any leftover old children
    while (container.children.length > newChildren.length) {
      container.removeChild(container.lastChild);
    }

    // Attach task list interactive change handlers
    container.querySelectorAll(".task-list-item-checkbox").forEach((checkbox) => {
      if (checkbox.dataset.boundChange === "true") return;
      checkbox.dataset.boundChange = "true";
      checkbox.disabled = false;
      checkbox.addEventListener("change", (e) => {
        container.dispatchEvent(new CustomEvent("vela-task-toggled", {
          bubbles: true,
          detail: { checked: e.target.checked }
        }));
      });
    });

    // Render Mermaid diagrams safely
    renderMermaidBlocks(container);
  }

  // 9. Mermaid Safe Renderer with Error Boundary
  async function renderMermaidBlocks(container) {
    if (!container || typeof globalThis.mermaid === "undefined") return;
    const blocks = container.querySelectorAll(".artifact-mermaid-surface:not([data-processed='true'])");
    if (!blocks.length) return;

    for (const block of blocks) {
      block.dataset.processed = "true";
      const rawDiagram = block.textContent.trim();
      const parentContainer = block.closest(".artifact-mermaid-container");
      const fallback = parentContainer?.querySelector(".artifact-mermaid-fallback");

      if (!rawDiagram) continue;

      try {
        // Configure strict error handling
        globalThis.mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: document.documentElement.classList.contains("dark") ? "dark" : "default",
          suppressErrorRendering: true
        });

        const id = block.id || `mermaid-render-${Math.random().toString(36).slice(2, 7)}`;
        const { svg } = await globalThis.mermaid.render(id, rawDiagram);
        block.innerHTML = svg;
      } catch (err) {
        console.warn("Mermaid diagram rendering error:", err);
        block.style.display = "none";
        if (fallback) {
          fallback.style.display = "block";
          fallback.className = "artifact-mermaid-error-boundary";
          fallback.innerHTML = `
            <div class="artifact-mermaid-error-header">
              <svg class="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
              <span>Diagram syntax error</span>
            </div>
            <p class="artifact-mermaid-error-msg">${escapeHTML(err?.message || "Could not parse diagram")}</p>
            <details class="artifact-mermaid-error-details">
              <summary>View Diagram Source</summary>
              <pre><code>${escapeHTML(rawDiagram)}</code></pre>
            </details>
          `;
        }
      }
    }
  }

  // 10. Extract Plain Text (Clean Strip)
  function extractPlainText(markdown) {
    if (!markdown) return "";
    return String(markdown)
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/```[\s\S]*?```/g, (code) => {
        return code.replace(/^```[^\n]*\n/, "").replace(/```$/, "").trim();
      })
      .replace(/`([^`]+)`/g, "$1")
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/^#{1,6}\s+(.+)$/gm, "$1")
      .replace(/(\*\*|__)(.*?)\1/g, "$2")
      .replace(/(\*|_)(.*?)\1/g, "$2")
      .replace(/~~(.*?)~~/g, "$1")
      .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, "")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*\d+\.\s+/gm, "")
      .replace(/^\s*>\s+/gm, "")
      .replace(/\|/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  // 11. Artifact Actions
  async function copyRawMarkdown(markdown) {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(String(markdown || ""));
      return true;
    }
    return false;
  }

  async function copyPlainText(markdown) {
    const plain = extractPlainText(markdown);
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(plain);
      return true;
    }
    return false;
  }

  function downloadMarkdown(markdown, filename = "document.md") {
    const blob = new Blob([String(markdown || "")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename.endsWith(".md") ? filename : `${filename}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  globalThis.VelaMarkdownEngine = Object.freeze({
    renderMarkdownToHtml,
    diffAndRender,
    renderMermaidBlocks,
    extractPlainText,
    copyRawMarkdown,
    copyPlainText,
    downloadMarkdown,
    renderMath,
    protectMath,
    restoreMath,
    stabilizeStreamingMarkdown
  });
})();
