(() => {
  "use strict";

  const registry = Object.freeze({
    html: Object.freeze({
      preview: "iframe",
      editable: true,
      export: ["html"],
      security: Object.freeze({ sandbox: "allow-scripts", network: "browser-controlled", parentAccess: false })
    }),
    svg: Object.freeze({
      preview: "sanitized-svg",
      editable: true,
      export: ["svg"],
      security: Object.freeze({ sanitizer: "dompurify-svg", scripts: false })
    }),
    markdown: Object.freeze({
      preview: "markdown",
      editable: true,
      export: ["md", "html"],
      security: Object.freeze({ sanitizer: "dompurify-html", rawHtml: false })
    }),
    python: Object.freeze({
      preview: "source",
      editable: true,
      export: ["py"],
      execution: "disabled",
      security: Object.freeze({ execution: false })
    }),
    javascript: Object.freeze({
      preview: "source",
      editable: true,
      export: ["js"],
      execution: "disabled",
      security: Object.freeze({ execution: false })
    }),
    js: Object.freeze({
      preview: "source",
      editable: true,
      export: ["js"],
      execution: "disabled",
      security: Object.freeze({ execution: false })
    }),
    css: Object.freeze({ preview: "source", editable: true, export: ["css"] }),
    json: Object.freeze({ preview: "json", editable: true, export: ["json"] }),
    csv: Object.freeze({ preview: "table", editable: true, export: ["csv"], delimiter: "," }),
    tsv: Object.freeze({ preview: "table", editable: true, export: ["tsv"], delimiter: "\t" }),
    mermaid: Object.freeze({
      preview: "diagram",
      editable: true,
      export: ["mmd", "svg", "png"],
      security: Object.freeze({ sanitizer: "mermaid-strict" })
    }),
    pdf: Object.freeze({
      preview: "pdf",
      editable: true,
      export: ["pdf"],
      security: Object.freeze({ execution: false })
    }),
    pptx: Object.freeze({
      preview: "pptx",
      editable: true,
      export: ["pptx"],
      security: Object.freeze({ execution: false })
    })
  });

  function get(language) {
    return registry[String(language || "").toLowerCase()] || Object.freeze({
      preview: "source",
      editable: true,
      export: ["txt"],
      security: Object.freeze({ execution: false })
    });
  }

  function canPreview(language) {
    return ["iframe", "sanitized-svg", "markdown", "table", "json", "diagram", "pdf", "pptx"].includes(get(language).preview);
  }

  // RFC-4180-style delimiter-separated parsing with quoted-field support.
  function parseDelimited(source, delimiter = ",") {
    const rows = [];
    let field = "";
    let row = [];
    let inQuotes = false;
    const input = String(source || "");
    for (let index = 0; index < input.length; index += 1) {
      const char = input[index];
      if (inQuotes) {
        if (char === '"') {
          if (input[index + 1] === '"') { field += '"'; index += 1; }
          else inQuotes = false;
        } else field += char;
        continue;
      }
      if (char === '"') { inQuotes = true; continue; }
      if (char === delimiter) { row.push(field); field = ""; continue; }
      if (char === "\n" || char === "\r") {
        if (char === "\r" && input[index + 1] === "\n") index += 1;
        row.push(field);
        field = "";
        if (row.some((cell) => cell !== "")) rows.push(row);
        row = [];
        continue;
      }
      field += char;
    }
    row.push(field);
    if (row.some((cell) => cell !== "")) rows.push(row);
    return rows;
  }

  function csvTable(source, delimiter) {
    const rows = parseDelimited(source, delimiter);
    if (!rows.length) return { headers: [], rows: [], columnCount: 0 };
    const headers = rows[0];
    return { headers, rows: rows.slice(1), columnCount: headers.length };
  }

  // Detect a uniform array-of-objects so JSON can render as a data table.
  function jsonAsTable(value) {
    if (!Array.isArray(value) || value.length < 2) return null;
    if (!value.every((entry) => entry && typeof entry === "object" && !Array.isArray(entry))) return null;
    const columns = [];
    for (const entry of value) {
      for (const key of Object.keys(entry)) {
        if (!columns.includes(key)) columns.push(key);
      }
    }
    if (!columns.length || columns.length > 24) return null;
    return { columns, rows: value.map((entry) => columns.map((column) => entry[column])) };
  }

  // Console bridge injected into sandboxed HTML previews so runtime output is
  // visible and honest. Posts { velaConsole: { level, args } } to the parent.
  const CONSOLE_BRIDGE = `<script>(function(){` +
    `["log","info","warn","error"].forEach(function(level){` +
    `var original=console[level]&&console[level].bind(console);` +
    `console[level]=function(){` +
    `try{parent.postMessage({velaConsole:{level:level,args:Array.prototype.slice.call(arguments).map(function(v){` +
    `try{return typeof v==="string"?v:JSON.stringify(v)}catch(e){return String(v)}})}},\"*\")}catch(e){}` +
    `if(original)original.apply(null,arguments)` +
    `}});` +
    `window.addEventListener("error",function(event){` +
    `try{parent.postMessage({velaConsole:{level:"error",args:[String(event.message||"Script error")]}},\"*\")}catch(e){}});` +
    `})();<\/script>`;

  function injectConsoleBridge(html) {
    const source = String(html || "");
    if (source.includes("velaConsole")) return source;
    if (/<head[^>]*>/i.test(source)) return source.replace(/<head[^>]*>/i, (match) => `${match}${CONSOLE_BRIDGE}`);
    if (/<html[^>]*>/i.test(source)) return source.replace(/<html[^>]*>/i, (match) => `${match}${CONSOLE_BRIDGE}`);
    return `${CONSOLE_BRIDGE}${source}`;
  }

  function createPreview(document, language, source, options = {}) {
    const renderer = get(language);
    const title = String(options.title || "Artifact");
    if (renderer.preview === "iframe") {
      const frame = document.createElement("iframe");
      frame.className = "artifact-preview-frame";
      frame.title = `${title} preview`;
      frame.setAttribute("sandbox", renderer.security.sandbox);
      frame.referrerPolicy = "no-referrer";
      frame.srcdoc = options.consoleBridge === false
        ? String(source || "")
        : injectConsoleBridge(String(source || ""));
      return frame;
    }

    if (renderer.preview === "table") {
      const tableData = csvTable(source, renderer.delimiter || ",");
      const wrap = document.createElement("div");
      wrap.className = "artifact-preview-surface artifact-data";
      const meta = document.createElement("div");
      meta.className = "artifact-data-meta";
      meta.textContent = `${tableData.rows.length} rows · ${tableData.columnCount} columns`;
      const scroller = document.createElement("div");
      scroller.className = "artifact-data-scroll";
      const table = document.createElement("table");
      table.className = "artifact-data-table";
      const escape = options.escape || ((value) => String(value));
      if (tableData.columnCount) {
        table.innerHTML = `<thead><tr>${tableData.headers.map((cell) => `<th>${escape(cell)}</th>`).join("")}</tr></thead><tbody>${tableData.rows.slice(0, 500).map((row) => `<tr>${tableData.headers.map((_, cellIndex) => `<td>${escape(row[cellIndex] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody>`;
      } else {
        const pre = document.createElement("pre");
        pre.textContent = String(source || "");
        scroller.appendChild(pre);
      }
      if (tableData.rows.length > 500) {
        const note = document.createElement("div");
        note.className = "artifact-data-meta";
        note.textContent = `Showing the first 500 of ${tableData.rows.length} rows.`;
        wrap.appendChild(note);
      }
      if (tableData.columnCount) scroller.appendChild(table);
      wrap.append(meta, scroller);
      return wrap;
    }

    if (renderer.preview === "json") {
      const wrap = document.createElement("div");
      wrap.className = "artifact-preview-surface artifact-json";
      let parsed = null;
      try { parsed = JSON.parse(String(source || "")); } catch {}
      const tableData = parsed !== null ? jsonAsTable(parsed) : null;
      if (tableData) {
        const meta = document.createElement("div");
        meta.className = "artifact-data-meta";
        meta.textContent = `${tableData.rows.length} entries · ${tableData.columns.length} fields`;
        const scroller = document.createElement("div");
        scroller.className = "artifact-data-scroll";
        const table = document.createElement("table");
        table.className = "artifact-data-table";
        const escape = options.escape || ((value) => String(value));
        const cell = (value) => escape(value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value));
        table.innerHTML = `<thead><tr>${tableData.columns.map((column) => `<th>${escape(column)}</th>`).join("")}</tr></thead><tbody>${tableData.rows.slice(0, 500).map((row) => `<tr>${row.map((value) => `<td>${cell(value)}</td>`).join("")}</tr>`).join("")}</tbody>`;
        scroller.appendChild(table);
        wrap.append(meta, scroller);
      } else {
        const pre = document.createElement("pre");
        pre.className = "artifact-json-raw";
        pre.textContent = parsed !== null ? JSON.stringify(parsed, null, 2) : String(source || "");
        wrap.appendChild(pre);
      }
      return wrap;
    }

    if (renderer.preview === "diagram") {
      const wrap = document.createElement("div");
      wrap.className = "artifact-preview-surface artifact-diagram";
      const figure = document.createElement("div");
      figure.className = "mermaid artifact-mermaid";
      figure.textContent = String(source || "");
      wrap.appendChild(figure);
      return wrap;
    }

    if (renderer.preview === "pdf") {
      if (globalThis.VelaPdf?.createPreview) {
        return globalThis.VelaPdf.createPreview(document, source, options);
      }
      const wrap = document.createElement("div");
      wrap.className = "artifact-preview-surface artifact-pdf-viewer";
      const pre = document.createElement("pre");
      pre.textContent = String(source || "");
      wrap.appendChild(pre);
      return wrap;
    }

    if (renderer.preview === "pptx") {
      if (globalThis.VelaPptx?.createPreview) {
        return globalThis.VelaPptx.createPreview(document, source, options);
      }
      const wrap = document.createElement("div");
      wrap.className = "artifact-preview-surface artifact-pptx-player";
      const pre = document.createElement("pre");
      pre.textContent = String(source || "");
      wrap.appendChild(pre);
      return wrap;
    }

    const surface = document.createElement("div");
    surface.className = "artifact-preview-surface markdown-body";
    if (renderer.preview === "sanitized-svg") {
      surface.innerHTML = options.sanitizeSvg
        ? options.sanitizeSvg(String(source || ""))
        : options.escape(String(source || ""));
    } else if (renderer.preview === "markdown") {
      options.renderMarkdown?.(surface, String(source || ""));
    } else {
      const pre = document.createElement("pre");
      pre.textContent = String(source || "");
      surface.appendChild(pre);
    }
    return surface;
  }

  globalThis.VelaArtifactRenderers = Object.freeze({
    registry, get, canPreview, createPreview,
    parseDelimited, csvTable, jsonAsTable, injectConsoleBridge
  });
})();
