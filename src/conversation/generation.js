(() => {
  "use strict";

  function createSnapshot(messages, options = {}) {
    return (Array.isArray(messages) ? messages : []).map((entry) => ({
      role: entry.role,
      content: entry.content,
      reasoning: typeof entry.reasoning === "string" ? entry.reasoning : "",
      attachments: Array.isArray(entry.attachments) ? entry.attachments : [],
      searchEnabled: Boolean(entry.searchEnabled),
      sources: Array.isArray(entry.sources) ? entry.sources : [],
      timestamp: Number(entry.timestamp) || 0,
      ...("taskMode" in options ? {} : { taskMode: String(entry.taskMode || "") }),
      ...(options.preserialize ? options.preserialize(entry) : {})
    }));
  }

  function snapshotMessages(messages) {
    return createSnapshot(messages).map((entry) => ({
      ...entry,
      taskMode: String(entry.taskMode || "")
    }));
  }

  function createRun(conversationId, userIndex, options = {}) {
    return {
      conversationId,
      userIndex,
      controller: new AbortController(),
      latest: { text: options.initialText || "", reasoning: options.initialReasoning || "" },
      startedAt: options.startedAt || Date.now(),
      running: true
    };
  }

  function persistPending(stored, run, message) {
    if (!stored) return;
    stored.pending = {
      message: String(message || ""),
      userIndex: Number(run.userIndex),
      text: run.latest.text,
      reasoning: run.latest.reasoning,
      startedAt: run.startedAt
    };
    stored.updatedAt = Date.now();
  }

  function persistAssistant(stored, completedAt, text, reasoning, sources) {
    if (!stored) return;
    if (!Array.isArray(stored.messages)) stored.messages = [];
    stored.messages.push({
      role: "assistant",
      content: text,
      reasoning: typeof reasoning === "string" ? reasoning : "",
      timestamp: completedAt,
      sources: Array.isArray(sources) ? sources : []
    });
    stored.pending = null;
    stored.updatedAt = completedAt;
  }

  function persistError(stored, errorTime, errorText) {
    if (!stored) return;
    if (!Array.isArray(stored.messages)) stored.messages = [];
    const message = /failed to fetch|networkerror|load failed/i.test(errorText || "")
      ? `${errorText}\n\nThe provider may be blocking browser requests. Its API may require a same-origin server proxy.`
      : errorText;
    stored.messages.push({ role: "assistant", content: message, reasoning: "", timestamp: errorTime });
    stored.pending = null;
    stored.updatedAt = Date.now();
  }

  function networkHint(error) {
    return /failed to fetch|networkerror|load failed/i.test(error?.message || "")
      ? "The provider may be blocking browser requests. Its API may require a same-origin server proxy."
      : "";
  }

  function formatError(message, hint) {
    return `I couldn’t complete the request.\n\n**Error:** ${String(message || "Unknown request error.")}${hint ? `\n\n${hint}` : ""}`;
  }

  globalThis.VelaGenerationLifecycle = Object.freeze({ createSnapshot, snapshotMessages, createRun, persistPending, persistAssistant, persistError, networkHint, formatError });
})();
