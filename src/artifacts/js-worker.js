// js-worker.js - Off-thread JavaScript execution worker

let currentRunId = null;

// Persistent session scope
const sessionScope = {};

self.onmessage = async function (e) {
  const { action, code, runId } = e.data || {};

  if (action === "restart") {
    for (const key of Object.keys(sessionScope)) {
      delete sessionScope[key];
    }
    self.postMessage({ type: "restarted" });
    return;
  }

  if (action === "run") {
    currentRunId = runId;

    // Custom console override that pipes to parent
    const workerConsole = {
      log: (...args) => {
        self.postMessage({
          type: "stdout",
          runId: currentRunId,
          text: args.map((v) => (typeof v === "object" ? JSON.stringify(v, null, 2) : String(v))).join(" ")
        });
      },
      info: (...args) => {
        self.postMessage({
          type: "stdout",
          runId: currentRunId,
          text: args.map((v) => (typeof v === "object" ? JSON.stringify(v, null, 2) : String(v))).join(" ")
        });
      },
      warn: (...args) => {
        self.postMessage({
          type: "stderr",
          runId: currentRunId,
          text: `[warn] ${args.map((v) => (typeof v === "object" ? JSON.stringify(v, null, 2) : String(v))).join(" ")}`
        });
      },
      error: (...args) => {
        self.postMessage({
          type: "stderr",
          runId: currentRunId,
          text: `[error] ${args.map((v) => (typeof v === "object" ? JSON.stringify(v, null, 2) : String(v))).join(" ")}`
        });
      }
    };

    try {
      // Async function evaluation bound with sessionScope and custom console
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      const fn = new AsyncFunction("console", "scope", `with(scope) {\n${code}\n}`);
      const result = await fn(workerConsole, sessionScope);

      let formattedResult = null;
      if (result !== undefined && result !== null) {
        try {
          formattedResult = typeof result === "object" ? JSON.stringify(result, null, 2) : String(result);
        } catch {
          formattedResult = String(result);
        }
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
