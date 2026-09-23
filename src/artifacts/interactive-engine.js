(() => {
  "use strict";

  // Allowed CDN hosts for Content Security Policy
  const TRUSTED_CDNS = [
    "https://cdn.jsdelivr.net",
    "https://cdnjs.cloudflare.com",
    "https://unpkg.com",
    "https://fonts.googleapis.com",
    "https://fonts.gstatic.com"
  ];

  const CSP_POLICY = [
    "default-src 'none'",
    "script-src 'unsafe-inline' 'unsafe-eval' blob: https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com",
    "style-src 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
    "font-src https://fonts.gstatic.com data:",
    "img-src data: blob: https:",
    "connect-src 'none'",
    "media-src data: blob:",
    "base-uri 'none'",
    "form-action 'none'"
  ].join("; ");

  // Heartbeat & Console bridge code injected into sandboxed iframe
  const RUNTIME_BRIDGE = `<script>(function(){
    var errorCount = 0;
    function send(level, args) {
      try {
        var serialized = Array.prototype.slice.call(args).map(function(v) {
          try {
            if (v instanceof Error) return v.stack || v.message;
            return typeof v === "object" ? JSON.stringify(v) : String(v);
          } catch(e) { return String(v); }
        });
        parent.postMessage({ velaConsole: { level: level, args: serialized, time: Date.now() } }, "*");
      } catch(e) {}
    }

    ["log", "info", "warn", "error"].forEach(function(level) {
      var original = console[level] && console[level].bind(console);
      console[level] = function() {
        send(level, arguments);
        if (original) original.apply(null, arguments);
      };
    });

    window.addEventListener("error", function(event) {
      errorCount++;
      send("error", [event.message + (event.filename ? " (" + event.filename + ":" + event.lineno + ")" : "")]);
    });

    window.addEventListener("unhandledrejection", function(event) {
      errorCount++;
      send("error", ["Unhandled Promise Rejection: " + (event.reason ? (event.reason.message || event.reason) : "Unknown")]);
    });

    // Watchdog heartbeat: sends heartbeat every 300ms
    setInterval(function() {
      try { parent.postMessage({ velaHeartbeat: Date.now() }, "*"); } catch(e) {}
    }, 300);

    // Verify origin isolation (for security audits)
    try {
      var probe = window.parent.localStorage;
      // If parent.localStorage did not throw SecurityError, alert parent
      if (probe) {
        parent.postMessage({ velaSecurityViolation: "Same-origin sandbox leak detected" }, "*");
      }
    } catch(expectedSecurityError) {
      // Expected: Access is denied
    }
  })();<\/script>`;

  function escapeHTML(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Prepares complete sandboxed HTML document with CSP & Console bridge
  function prepareHtmlArtifact(source, options = {}) {
    const raw = String(source || "");
    const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${CSP_POLICY}">`;
    const viewportMeta = `<meta name="viewport" content="width=device-width, initial-scale=1.0">`;

    // Only treat as raw JSX snippet if it is NOT already a complete HTML document
    const isFullHtml = /<!DOCTYPE\b|<\s*html\b|<\s*head\b|<\s*body\b/i.test(raw);
    const isJsx = !isFullHtml && (options.isJsx || /\b(?:React|ReactDOM|import\s+React|export\s+default\s+function|<[A-Z][A-Za-z0-9.]*[\s\/>])/.test(raw));

    let content = raw;

    if (isJsx) {
      // Escape any closing script tags inside the raw JSX to prevent premature tag termination
      const safeJsx = raw.replace(/<\/script>/gi, "<\\/script>");
      content = `<!DOCTYPE html>
<html>
<head>
  ${cspMeta}
  ${viewportMeta}
  <script src="https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js"><\/script>
  <script src="https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js"><\/script>
  <script src="https://cdn.jsdelivr.net/npm/@babel/standalone@7.24.7/babel.min.js"><\/script>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    #root { min-height: 100vh; }
  </style>
</head>
<body>
  <div id="root"></div>
  ${RUNTIME_BRIDGE}
  <script type="text/babel">
    try {
      ${safeJsx}
      if (typeof App !== "undefined" && !document.getElementById("root").hasChildNodes()) {
        const root = ReactDOM.createRoot(document.getElementById("root"));
        root.render(React.createElement(App));
      }
    } catch(err) {
      console.error(err);
    }
  <\/script>
</body>
</html>`;
      return content;
    }

    // Standard HTML page: auto-inject Babel if user HTML includes text/babel scripts
    let headExtras = `${cspMeta}\n  ${viewportMeta}\n  ${RUNTIME_BRIDGE}`;
    if (/type=["']text\/babel["']/i.test(content) && !/babel(?:\.min)?\.js/i.test(content)) {
      headExtras += `\n  <script src="https://cdn.jsdelivr.net/npm/@babel/standalone@7.24.7/babel.min.js"><\/script>`;
    }

    if (/<head[^>]*>/i.test(content)) {
      content = content.replace(/<head[^>]*>/i, (m) => `${m}\n  ${headExtras}`);
    } else if (/<html[^>]*>/i.test(content)) {
      content = content.replace(/<html[^>]*>/i, (m) => `${m}\n<head>${headExtras}</head>`);
    } else {
      content = `<!DOCTYPE html><html><head>${headExtras}</head><body>${content}</body></html>`;
    }

    return content;
  }

  // Interactive HTML/JS Sandbox Frame with Watchdog & Console Drawer
  function createInteractiveFrame(document, source, options = {}) {
    const container = document.createElement("div");
    container.className = "artifact-interactive-wrapper";
    container.style.cssText = "display:flex;flex-direction:column;width:100%;height:100%;position:relative;overflow:hidden;";

    // Toolbar / Action bar
    const toolbar = document.createElement("div");
    toolbar.className = "artifact-interactive-toolbar";
    toolbar.innerHTML = `
      <div class="interactive-toolbar-left">
        <button class="artifact-tool artifact-reload-btn" type="button" title="Reload artifact">
          <svg class="icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"></path><path d="M16 21h5v-5"></path></svg>
          <span>Reload</span>
        </button>
        <button class="artifact-tool artifact-console-toggle" type="button" title="Toggle console">
          <svg class="icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>
          <span>Console</span>
          <span class="artifact-console-badge" style="display:none;margin-left:4px;padding:1px 6px;border-radius:10px;font-size:11px;background:#ef4444;color:#fff;">0</span>
        </button>
      </div>
      <div class="interactive-toolbar-right">
        <button class="artifact-tool artifact-open-tab" type="button" title="Open in new window">
          <svg class="icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
          <span>Open in new window</span>
        </button>
      </div>
    `;

    // Watchdog Overlay (hidden by default)
    const watchdogOverlay = document.createElement("div");
    watchdogOverlay.className = "artifact-watchdog-overlay";
    watchdogOverlay.style.cssText = "display:none;position:absolute;top:38px;left:0;right:0;bottom:0;background:rgba(15,23,42,0.85);backdrop-filter:blur(4px);z-index:50;flex-direction:column;align-items:center;justify-content:center;color:#fff;padding:24px;text-align:center;";
    watchdogOverlay.innerHTML = `
      <div style="max-width:380px;background:#1e293b;padding:24px;border-radius:12px;box-shadow:0 10px 25px rgba(0,0,0,0.5);border:1px solid #334155;">
        <svg class="icon" viewBox="0 0 24 24" width="36" height="36" stroke="#f59e0b" fill="none" stroke-width="2" style="margin-bottom:12px;"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
        <h4 style="margin:0 0 8px 0;font-size:16px;">Artifact Unresponsive</h4>
        <p style="margin:0 0 16px 0;font-size:13px;color:#94a3b8;line-height:1.5;">The script stopped responding or encountered an infinite loop. The sandbox prevented the chat app from freezing.</p>
        <button class="artifact-watchdog-restart" type="button" style="background:#3b82f6;color:#fff;border:none;padding:8px 18px;border-radius:6px;font-size:13px;cursor:pointer;font-weight:500;">Reload Artifact</button>
      </div>
    `;

    // Frame wrapper
    const frameWrap = document.createElement("div");
    frameWrap.className = "artifact-frame-container";
    frameWrap.style.cssText = "flex:1;position:relative;width:100%;height:100%;";

    let frame = document.createElement("iframe");
    frame.className = "artifact-preview-frame";
    frame.title = options.title || "Interactive preview";
    // Restrictive sandbox without allow-same-origin
    frame.setAttribute("sandbox", options.sandbox || "allow-scripts");
    frame.referrerPolicy = "no-referrer";
    frame.style.cssText = "width:100%;height:100%;border:none;background:#ffffff;";

    const preparedHtml = prepareHtmlArtifact(source, options);
    frame.srcdoc = preparedHtml;
    frameWrap.appendChild(frame);

    // Collapsible Console Drawer
    const consoleDrawer = document.createElement("div");
    consoleDrawer.className = "artifact-console-drawer";
    consoleDrawer.style.cssText = "display:none;height:180px;background:#0f172a;color:#f8fafc;border-top:1px solid #334155;overflow-y:auto;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;padding:8px;";
    consoleDrawer.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:6px;margin-bottom:6px;border-bottom:1px solid #1e293b;color:#94a3b8;font-size:11px;">
        <span>CONSOLE OUTPUT</span>
        <button class="artifact-console-clear" type="button" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:11px;">Clear</button>
      </div>
      <div class="artifact-console-logs"></div>
    `;

    const logsContainer = consoleDrawer.querySelector(".artifact-console-logs");
    const consoleBadge = toolbar.querySelector(".artifact-console-badge");
    let errorCount = 0;

    function addConsoleEntry(level, args) {
      if (level === "error") {
        errorCount++;
        consoleBadge.style.display = "inline-block";
        consoleBadge.textContent = String(errorCount);
      }
      const entry = document.createElement("div");
      entry.className = `artifact-log-entry artifact-log-${level}`;
      entry.style.cssText = `padding:2px 0;line-height:1.4;white-space:pre-wrap;color:${
        level === "error" ? "#f87171" : level === "warn" ? "#fbbf24" : level === "info" ? "#60a5fa" : "#e2e8f0"
      };`;
      entry.textContent = `[${level.toUpperCase()}] ${args.join(" ")}`;
      logsContainer.appendChild(entry);
      consoleDrawer.scrollTop = consoleDrawer.scrollHeight;
    }

    // Watchdog monitoring
    let lastHeartbeat = Date.now();
    let watchdogTimer = null;

    function startWatchdog() {
      lastHeartbeat = Date.now();
      if (watchdogTimer) clearInterval(watchdogTimer);
      watchdogTimer = setInterval(() => {
        // If no heartbeat for > 4000ms after load, show watchdog overlay
        if (Date.now() - lastHeartbeat > 4000) {
          watchdogOverlay.style.display = "flex";
        }
      }, 1000);
    }

    function resetFrame() {
      watchdogOverlay.style.display = "none";
      if (frame) frame.remove();
      frame = document.createElement("iframe");
      frame.className = "artifact-preview-frame";
      frame.title = options.title || "Interactive preview";
      frame.setAttribute("sandbox", "allow-scripts allow-forms allow-modals");
      frame.referrerPolicy = "no-referrer";
      frame.style.cssText = "width:100%;height:100%;border:none;background:#ffffff;";
      frame.srcdoc = preparedHtml;
      frameWrap.appendChild(frame);
      startWatchdog();
    }

    // Message listener for console and heartbeat from this frame
    function handleMessage(event) {
      if (!event.data) return;
      if (event.data.velaHeartbeat) {
        lastHeartbeat = Date.now();
        watchdogOverlay.style.display = "none";
      }
      if (event.data.velaConsole) {
        const { level, args } = event.data.velaConsole;
        addConsoleEntry(level, args);
      }
      if (event.data.velaSecurityViolation) {
        console.error("CRITICAL SECURITY VIOLATION IN ARTIFACT:", event.data.velaSecurityViolation);
      }
    }

    window.addEventListener("message", handleMessage);

    // Button actions
    toolbar.querySelector(".artifact-reload-btn")?.addEventListener("click", resetFrame);
    watchdogOverlay.querySelector(".artifact-watchdog-restart")?.addEventListener("click", resetFrame);

    toolbar.querySelector(".artifact-console-toggle")?.addEventListener("click", () => {
      consoleDrawer.style.display = consoleDrawer.style.display === "none" ? "block" : "none";
    });

    consoleDrawer.querySelector(".artifact-console-clear")?.addEventListener("click", () => {
      logsContainer.replaceChildren();
      errorCount = 0;
      consoleBadge.style.display = "none";
    });

    toolbar.querySelector(".artifact-open-tab")?.addEventListener("click", () => {
      const blob = new Blob([preparedHtml], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    });

    container.append(toolbar, frameWrap, watchdogOverlay, consoleDrawer);
    startWatchdog();

    return container;
  }

  // 12. SVG Pan/Zoom & Rasterization Engine
  function createSvgInteractiveViewer(document, svgSource, options = {}) {
    const wrap = document.createElement("div");
    wrap.className = "artifact-svg-viewer";
    wrap.style.cssText = "display:flex;flex-direction:column;width:100%;height:100%;position:relative;background:#f8fafc;user-select:none;overflow:hidden;";

    const toolbar = document.createElement("div");
    toolbar.className = "artifact-svg-toolbar";
    toolbar.innerHTML = `
      <div class="interactive-toolbar-left">
        <button class="artifact-tool svg-zoom-out" type="button" title="Zoom out">
          <svg class="icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>
        </button>
        <button class="artifact-tool svg-zoom-reset" type="button" title="Reset zoom">100%</button>
        <button class="artifact-tool svg-zoom-in" type="button" title="Zoom in">
          <svg class="icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>
        </button>
      </div>
      <div class="interactive-toolbar-right">
        <button class="artifact-tool svg-download-svg" type="button" title="Download .svg">
          <svg class="icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          <span>.svg</span>
        </button>
        <button class="artifact-tool svg-download-png" type="button" title="Download .png">
          <svg class="icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          <span>.png</span>
        </button>
      </div>
    `;

    const viewport = document.createElement("div");
    viewport.className = "artifact-svg-viewport";
    viewport.style.cssText = "flex:1;position:relative;overflow:hidden;cursor:grab;display:flex;align-items:center;justify-content:center;";

    const stage = document.createElement("div");
    stage.className = "artifact-svg-stage";
    stage.style.cssText = "transform-origin: center center; transition: transform 0.05s ease-out;";

    // Sanitize SVG
    let cleanSvg = svgSource;
    if (typeof globalThis.DOMPurify !== "undefined" && globalThis.DOMPurify.sanitize) {
      cleanSvg = globalThis.DOMPurify.sanitize(svgSource, {
        USE_PROFILES: { svg: true, svgFilters: true }
      });
    }
    stage.innerHTML = cleanSvg;
    viewport.appendChild(stage);

    // Pan & Zoom state
    let zoom = 1;
    let panX = 0;
    let panY = 0;
    let isDragging = false;
    let startX = 0;
    let startY = 0;

    function applyTransform() {
      stage.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
      const resetBtn = toolbar.querySelector(".svg-zoom-reset");
      if (resetBtn) resetBtn.textContent = `${Math.round(zoom * 100)}%`;
    }

    viewport.addEventListener("mousedown", (e) => {
      isDragging = true;
      startX = e.clientX - panX;
      startY = e.clientY - panY;
      viewport.style.cursor = "grabbing";
    });

    window.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      panX = e.clientX - startX;
      panY = e.clientY - startY;
      applyTransform();
    });

    window.addEventListener("mouseup", () => {
      if (isDragging) {
        isDragging = false;
        viewport.style.cursor = "grab";
      }
    });

    viewport.addEventListener("wheel", (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 1.15 : 0.87;
      zoom = Math.min(Math.max(0.15, zoom * delta), 10);
      applyTransform();
    }, { passive: false });

    toolbar.querySelector(".svg-zoom-in")?.addEventListener("click", () => {
      zoom = Math.min(10, zoom * 1.25);
      applyTransform();
    });

    toolbar.querySelector(".svg-zoom-out")?.addEventListener("click", () => {
      zoom = Math.max(0.15, zoom / 1.25);
      applyTransform();
    });

    toolbar.querySelector(".svg-zoom-reset")?.addEventListener("click", () => {
      zoom = 1;
      panX = 0;
      panY = 0;
      applyTransform();
    });

    // SVG Download
    toolbar.querySelector(".svg-download-svg")?.addEventListener("click", () => {
      const blob = new Blob([cleanSvg], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${options.title || "artwork"}.svg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });

    // PNG Rasterize & Download via Canvas
    toolbar.querySelector(".svg-download-png")?.addEventListener("click", () => {
      rasterizeSvgToPng(cleanSvg, `${options.title || "artwork"}.png`);
    });

    wrap.append(toolbar, viewport);
    return wrap;
  }

  function rasterizeSvgToPng(svgString, filename = "image.png") {
    const img = new Image();
    const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    img.onload = () => {
      const canvas = document.createElement("canvas");
      // Double resolution for crisp rendering
      const scale = 2;
      canvas.width = (img.width || 800) * scale;
      canvas.height = (img.height || 600) * scale;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);

      canvas.toBlob((blob) => {
        if (!blob) return;
        const pngUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = pngUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(pngUrl), 1000);
      }, "image/png");
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      console.error("Failed to rasterize SVG to PNG");
    };

    img.src = url;
  }

  globalThis.VelaInteractiveEngine = Object.freeze({
    prepareHtmlArtifact,
    createInteractiveFrame,
    createSvgInteractiveViewer,
    rasterizeSvgToPng,
    CSP_POLICY
  });
})();
