(() => {
  "use strict";

  // Active worker instances
  let pyWorker = null;
  let jsWorker = null;

  let activeRunId = 0;
  const activeCallbacks = new Map();

  function getPythonWorker() {
    if (pyWorker) return pyWorker;
    if (typeof Worker === "undefined") return null;

    try {
      pyWorker = new Worker("/src/artifacts/pyodide-worker.js");
      pyWorker.onmessage = (event) => {
        handleWorkerMessage("python", event.data);
      };
      pyWorker.onerror = (err) => {
        console.error("Pyodide Worker Error:", err);
      };
      // Trigger lazy init
      pyWorker.postMessage({ action: "init" });
      return pyWorker;
    } catch (err) {
      console.warn("Could not instantiate Pyodide worker:", err);
      return null;
    }
  }

  function getJsWorker() {
    if (jsWorker) return jsWorker;
    if (typeof Worker === "undefined") return null;

    try {
      jsWorker = new Worker("/src/artifacts/js-worker.js");
      jsWorker.onmessage = (event) => {
        handleWorkerMessage("javascript", event.data);
      };
      jsWorker.onerror = (err) => {
        console.error("JS Worker Error:", err);
      };
      return jsWorker;
    } catch (err) {
      console.warn("Could not instantiate JS worker:", err);
      return null;
    }
  }

  function handleWorkerMessage(lang, data) {
    if (!data) return;
    const { type, runId, text, message, error, stack, result, format } = data;

    const cb = runId ? activeCallbacks.get(runId) : null;

    if (type === "status") {
      cb?.onStatus?.(message);
    } else if (type === "stdout") {
      cb?.onStdout?.(text);
    } else if (type === "stderr") {
      cb?.onStderr?.(text);
    } else if (type === "figure") {
      cb?.onFigure?.(data.data, format || "png");
    } else if (type === "success") {
      cb?.onSuccess?.(result);
      if (runId) activeCallbacks.delete(runId);
    } else if (type === "exception") {
      cb?.onError?.(error, stack);
      if (runId) activeCallbacks.delete(runId);
    } else if (type === "error") {
      cb?.onError?.(error, stack);
      if (runId) activeCallbacks.delete(runId);
    }
  }

  function stop(language) {
    const lang = String(language).toLowerCase();
    if (lang === "python" && pyWorker) {
      pyWorker.terminate();
      pyWorker = null;
      // Re-trigger callbacks as cancelled
      for (const [id, cb] of activeCallbacks.entries()) {
        cb.onError?.("Execution terminated by user.", "");
        activeCallbacks.delete(id);
      }
      return true;
    }
    if ((lang === "javascript" || lang === "js") && jsWorker) {
      jsWorker.terminate();
      jsWorker = null;
      for (const [id, cb] of activeCallbacks.entries()) {
        cb.onError?.("Execution terminated by user.", "");
        activeCallbacks.delete(id);
      }
      return true;
    }
    return false;
  }

  function restartKernel(language) {
    const lang = String(language).toLowerCase();
    if (lang === "python") {
      if (pyWorker) {
        pyWorker.postMessage({ action: "restart" });
      }
      return true;
    }
    if (lang === "javascript" || lang === "js") {
      if (jsWorker) {
        jsWorker.postMessage({ action: "restart" });
      }
      return true;
    }
    return false;
  }

  function writeVirtualFile(filename, content) {
    const worker = getPythonWorker();
    if (worker) {
      worker.postMessage({ action: "writeFile", filename, content });
      return true;
    }
    return false;
  }

  function executeCode(language, code, handlers = {}) {
    const lang = String(language).toLowerCase();
    const runId = `run-${++activeRunId}-${Date.now()}`;
    activeCallbacks.set(runId, handlers);

    if (lang === "python") {
      const worker = getPythonWorker();
      if (!worker) {
        handlers.onError?.("Web Workers or WASM are not supported in this environment.", "");
        activeCallbacks.delete(runId);
        return null;
      }
      handlers.onStatus?.("Starting Python WASM kernel…");
      worker.postMessage({ action: "run", code, runId });
      return runId;
    }

    if (lang === "javascript" || lang === "js") {
      const worker = getJsWorker();
      if (!worker) {
        handlers.onError?.("Web Workers are not supported in this environment.", "");
        activeCallbacks.delete(runId);
        return null;
      }
      handlers.onStatus?.("Executing JavaScript…");
      worker.postMessage({ action: "run", code, runId });
      return runId;
    }

    // Extensibility hook: custom runtime registry
    if (customRuntimes.has(lang)) {
      const runtime = customRuntimes.get(lang);
      return runtime.execute(code, handlers);
    }

    handlers.onError?.(`Execution for language '${language}' is not configured.`, "");
    activeCallbacks.delete(runId);
    return null;
  }

  // Registry for extending runtimes (e.g. WASI-based languages: SQLite, Rust, QuickJS)
  const customRuntimes = new Map();
  function registerRuntime(language, runtimeHandler) {
    customRuntimes.set(String(language).toLowerCase(), runtimeHandler);
  }

  function escapeHTML(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Interactive Execution Card UI Builder
  function createExecutionCard(document, language, initialCode, options = {}) {
    const wrap = document.createElement("div");
    wrap.className = "artifact-execution-card";
    wrap.style.cssText = "display:flex;flex-direction:column;width:100%;height:100%;background:#090d16;color:#f8fafc;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:13px;overflow:hidden;";

    const isPython = String(language).toLowerCase() === "python";

    // Top action bar
    const bar = document.createElement("div");
    bar.className = "artifact-execution-bar";
    bar.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#131b2e;border-bottom:1px solid #1e293b;flex-shrink:0;";
    bar.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <button class="exec-btn exec-run-btn" type="button" style="display:inline-flex;align-items:center;gap:6px;background:#10b981;color:#fff;border:none;padding:5px 12px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
          <span>Run</span>
        </button>
        <button class="exec-btn exec-stop-btn" type="button" disabled style="display:none;align-items:center;gap:6px;background:#ef4444;color:#fff;border:none;padding:5px 12px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><rect x="4" y="4" width="16" height="16"></rect></svg>
          <span>Stop</span>
        </button>
        <button class="exec-btn exec-restart-btn" type="button" title="Restart Kernel" style="background:#1e293b;color:#cbd5e1;border:1px solid #334155;padding:5px 10px;border-radius:6px;font-size:12px;cursor:pointer;">
          <span>⟲ Restart Kernel</span>
        </button>
        ${isPython ? `
        <label class="exec-btn exec-upload-label" title="Upload CSV or dataset to virtual filesystem" style="background:#1e293b;color:#cbd5e1;border:1px solid #334155;padding:5px 10px;border-radius:6px;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;gap:4px;">
          <span>📁 Upload Data</span>
          <input type="file" class="exec-file-input" style="display:none;" accept=".csv,.txt,.json">
        </label>
        ` : ""}
      </div>
      <div class="exec-status" style="font-size:11px;color:#94a3b8;display:flex;align-items:center;gap:6px;">
        <span class="exec-status-dot" style="width:7px;height:7px;border-radius:50%;background:#10b981;display:inline-block;"></span>
        <span class="exec-status-text">Ready</span>
      </div>
    `;

    // Code area (editable)
    const codeArea = document.createElement("div");
    codeArea.className = "artifact-execution-code";
    codeArea.style.cssText = "flex:1;min-height:160px;position:relative;background:#090d16;border-bottom:1px solid #1e293b;display:flex;";

    const textarea = document.createElement("textarea");
    textarea.className = "exec-code-textarea";
    textarea.value = String(initialCode || "");
    textarea.spellcheck = false;
    textarea.style.cssText = "width:100%;height:100%;background:transparent;color:#e2e8f0;font-family:inherit;font-size:13px;line-height:1.5;padding:12px;border:none;outline:none;resize:none;tab-size:4;";
    codeArea.appendChild(textarea);

    // Terminal Output area
    const outputArea = document.createElement("div");
    outputArea.className = "artifact-execution-output";
    outputArea.style.cssText = "flex:1;min-height:160px;background:#030712;color:#f8fafc;padding:12px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;";
    outputArea.innerHTML = `<div class="exec-term-empty" style="color:#64748b;font-size:12px;font-style:italic;">Terminal output will appear here after running…</div>`;

    const runBtn = bar.querySelector(".exec-run-btn");
    const stopBtn = bar.querySelector(".exec-stop-btn");
    const restartBtn = bar.querySelector(".exec-restart-btn");
    const statusDot = bar.querySelector(".exec-status-dot");
    const statusText = bar.querySelector(".exec-status-text");

    let currentRunId = null;

    function setRunningState(running, statusMsg = "Running…") {
      if (running) {
        runBtn.style.display = "none";
        stopBtn.style.display = "inline-flex";
        stopBtn.disabled = false;
        statusDot.style.background = "#f59e0b";
        statusText.textContent = statusMsg;
      } else {
        runBtn.style.display = "inline-flex";
        stopBtn.style.display = "none";
        stopBtn.disabled = true;
        statusDot.style.background = "#10b981";
        statusText.textContent = "Ready";
      }
    }

    function appendOutputLine(text, type = "stdout") {
      const emptyNote = outputArea.querySelector(".exec-term-empty");
      if (emptyNote) emptyNote.remove();

      const line = document.createElement("div");
      line.className = `exec-line exec-${type}`;
      line.style.cssText = `line-height:1.4;white-space:pre-wrap;word-break:break-all;color:${
        type === "stderr" ? "#f87171" : type === "status" ? "#38bdf8" : type === "result" ? "#a78bfa" : "#34d399"
      };`;
      line.textContent = text;
      outputArea.appendChild(line);
      outputArea.scrollTop = outputArea.scrollHeight;
    }

    function appendFigure(b64Data, format = "png") {
      const emptyNote = outputArea.querySelector(".exec-term-empty");
      if (emptyNote) emptyNote.remove();

      const figContainer = document.createElement("div");
      figContainer.className = "exec-figure-card";
      figContainer.style.cssText = "margin:8px 0;padding:8px;background:#1e293b;border-radius:8px;display:inline-block;";

      const img = document.createElement("img");
      img.src = `data:image/${format};base64,${b64Data}`;
      img.alt = "Generated Plot";
      img.style.cssText = "max-width:100%;height:auto;border-radius:4px;display:block;";

      const dl = document.createElement("a");
      dl.href = img.src;
      dl.download = `plot-${Date.now()}.${format}`;
      dl.textContent = "Download chart";
      dl.style.cssText = "display:inline-block;font-size:11px;color:#38bdf8;text-decoration:none;margin-top:4px;";

      figContainer.append(img, dl);
      outputArea.appendChild(figContainer);
      outputArea.scrollTop = outputArea.scrollHeight;
    }

    function runCode() {
      const code = textarea.value;
      outputArea.replaceChildren();
      setRunningState(true, "Executing…");

      currentRunId = executeCode(language, code, {
        onStatus: (msg) => {
          statusText.textContent = msg;
          appendOutputLine(`[status] ${msg}`, "status");
        },
        onStdout: (text) => {
          appendOutputLine(text, "stdout");
        },
        onStderr: (text) => {
          appendOutputLine(text, "stderr");
        },
        onFigure: (data, fmt) => {
          appendFigure(data, fmt);
        },
        onSuccess: (res) => {
          setRunningState(false);
          if (res !== null && res !== undefined) {
            appendOutputLine(`Out: ${res}`, "result");
          }
        },
        onError: (err, stack) => {
          setRunningState(false);
          appendOutputLine(`Error: ${err}`, "stderr");
          if (stack) {
            const details = document.createElement("details");
            details.style.cssText = "margin-top:4px;color:#94a3b8;font-size:11px;";
            details.innerHTML = `<summary style="cursor:pointer;">View Traceback</summary><pre style="white-space:pre-wrap;margin-top:4px;">${escapeHTML(stack)}</pre>`;
            outputArea.appendChild(details);
          }
        }
      });
    }

    runBtn.addEventListener("click", runCode);

    stopBtn.addEventListener("click", () => {
      stop(language);
      setRunningState(false);
      appendOutputLine("Stopped by user.", "stderr");
    });

    restartBtn.addEventListener("click", () => {
      restartKernel(language);
      outputArea.replaceChildren();
      appendOutputLine("Kernel restarted. Variables cleared.", "status");
    });

    // File input handling for VFS
    const fileInput = bar.querySelector(".exec-file-input");
    fileInput?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        writeVirtualFile(file.name, reader.result);
        appendOutputLine(`Uploaded '${file.name}' to virtual filesystem. Available via open('${file.name}').`, "status");
      };
      reader.readAsText(file);
    });

    wrap.append(bar, codeArea, outputArea);
    return wrap;
  }

  globalThis.VelaExecutionEngine = Object.freeze({
    executeCode,
    stop,
    restartKernel,
    writeVirtualFile,
    createExecutionCard,
    registerRuntime
  });
})();
