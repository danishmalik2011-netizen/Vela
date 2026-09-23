// pyodide-worker.js - Pyodide WASM Execution Worker for Python
/* global importScripts, loadPyodide */

let pyodide = null;
let isInitializing = false;
let currentRunId = null;

const PYODIDE_CDN = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";

async function initPyodide() {
  if (pyodide) return pyodide;
  if (isInitializing) {
    while (isInitializing) {
      await new Promise((r) => setTimeout(r, 50));
    }
    return pyodide;
  }

  isInitializing = true;
  self.postMessage({ type: "status", message: "Initializing Python WASM environment…" });

  try {
    importScripts(`${PYODIDE_CDN}pyodide.js`);
    pyodide = await loadPyodide({
      indexURL: PYODIDE_CDN,
      stdout: (text) => {
        self.postMessage({ type: "stdout", text, runId: currentRunId });
      },
      stderr: (text) => {
        self.postMessage({ type: "stderr", text, runId: currentRunId });
      }
    });

    self.postMessage({ type: "status", message: "Preloading standard scientific libraries (numpy, pandas, matplotlib)…" });
    await pyodide.loadPackage(["numpy", "pandas", "matplotlib"]);

    // Python setup for rich display & matplotlib figure interception
    const setupCode = `
import sys
import io
import base64
import js

# Hook matplotlib
try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    def _vela_show():
        for fig_num in plt.get_fignums():
            fig = plt.figure(fig_num)
            buf = io.BytesIO()
            fig.savefig(buf, format="png", bbox_inches="tight", dpi=120)
            buf.seek(0)
            img_b64 = base64.b64encode(buf.read()).decode("ascii")
            js.postMessage(js.Object.fromEntries([
                ["type", "figure"],
                ["format", "png"],
                ["data", img_b64]
            ]))
        plt.close("all")

    plt.show = _vela_show
except Exception as e:
    pass
`;
    await pyodide.runPythonAsync(setupCode);

    self.postMessage({ type: "ready" });
    isInitializing = false;
    return pyodide;
  } catch (err) {
    isInitializing = false;
    self.postMessage({ type: "error", error: err.message });
    throw err;
  }
}

self.onmessage = async function (e) {
  const { action, code, runId, file, filename, content } = e.data || {};

  if (action === "init") {
    try {
      await initPyodide();
    } catch (err) {
      self.postMessage({ type: "error", error: err.message, runId });
    }
    return;
  }

  if (action === "writeFile") {
    try {
      const p = await initPyodide();
      p.FS.writeFile(filename, content);
      self.postMessage({ type: "fileWritten", filename });
    } catch (err) {
      self.postMessage({ type: "error", error: `Failed to write file ${filename}: ${err.message}` });
    }
    return;
  }

  if (action === "readFile") {
    try {
      const p = await initPyodide();
      const data = p.FS.readFile(filename, { encoding: "utf8" });
      self.postMessage({ type: "fileRead", filename, content: data });
    } catch (err) {
      self.postMessage({ type: "error", error: `Failed to read file ${filename}: ${err.message}` });
    }
    return;
  }

  if (action === "restart") {
    try {
      if (pyodide) {
        await pyodide.runPythonAsync(`
import sys
# Clean non-builtin variables in globals
for name in list(globals().keys()):
    if not name.startswith("_") and name not in ["sys", "io", "base64", "js", "plt", "matplotlib"]:
        del globals()[name]
`);
      }
      self.postMessage({ type: "restarted" });
    } catch (err) {
      self.postMessage({ type: "error", error: err.message });
    }
    return;
  }

  if (action === "run") {
    currentRunId = runId;
    try {
      const p = await initPyodide();

      // Check if imports require packages not currently loaded
      await p.loadPackagesFromImports(code, {
        messageCallback: (msg) => {
          self.postMessage({ type: "status", message: msg, runId });
        }
      });

      // Execute code
      const result = await p.runPythonAsync(code);

      // Check if an un-shown matplotlib figure exists
      await p.runPythonAsync(`
try:
    if len(plt.get_fignums()) > 0:
        plt.show()
except Exception:
    pass
`);

      let formattedResult = null;
      if (result !== undefined && result !== null) {
        try {
          formattedResult = String(result);
        } catch {}
      }

      self.postMessage({
        type: "success",
        runId,
        result: formattedResult
      });
    } catch (err) {
      self.postMessage({
        type: "exception",
        runId,
        error: err.message,
        stack: err.stack
      });
    }
  }
};
