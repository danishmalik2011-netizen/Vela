(() => {
  "use strict";

  const GYRO_SVG = `<svg class="streaming-gyro-svg" viewBox="0 0 18 18" width="15" height="15" fill="none" aria-hidden="true"><circle class="gyro-outer-track" cx="9" cy="9" r="7" stroke="currentColor" stroke-width="1.2" opacity="0.16" /><circle class="gyro-outer-arc" cx="9" cy="9" r="7" stroke="var(--accent)" stroke-width="1.35" stroke-linecap="round" stroke-dasharray="14 30" /><circle class="gyro-inner-track" cx="9" cy="9" r="4.2" stroke="currentColor" stroke-width="1" opacity="0.14" /><circle class="gyro-inner-arc" cx="9" cy="9" r="4.2" stroke="var(--accent)" stroke-width="1.25" stroke-linecap="round" stroke-dasharray="9 17" /><circle class="gyro-core" cx="9" cy="9" r="1.3" fill="var(--accent)" /></svg>`;

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderFlowingLetters(verb) {
    const chars = Array.from(String(verb || "Thinking…"));
    return chars.map((char, index) => {
      if (char === " ") {
        return `<span class="flowing-space">&nbsp;</span>`;
      }
      return `<span class="flowing-letter" style="--letter-idx:${index}">${escapeHtml(char)}</span>`;
    }).join("");
  }

  function detectCategory(streamContext) {
    const { text = "", reasoning = "", taskMode = "chat" } = streamContext || {};
    const trimmedText = String(text || "").trim();
    const trimmedReasoning = String(reasoning || "").trim();

    // Inception phase (waiting for first text tokens)
    if (!trimmedText) {
      if (trimmedReasoning) return "INCEPTION_REASONING";
      if (taskMode === "research") return "INCEPTION_RESEARCH";
      if (taskMode === "code") return "INCEPTION_CODE";
      if (taskMode === "write") return "INCEPTION_WRITE";
      return "INCEPTION_DEFAULT";
    }

    // Active unclosed code block detection
    const fenceMatches = text.match(/```/g);
    const isOpenCodeBlock = fenceMatches && fenceMatches.length % 2 === 1;
    if (isOpenCodeBlock) {
      return "CODE";
    }

    // Table detection in recent tail
    const tail = text.slice(-240);
    if (/\n\|[^\n]+\|\n\|?[\s:-|]+\|?/.test(tail) || (tail.match(/\n\|/g) || []).length >= 2) {
      return "TABLES";
    }

    return "GENERATING";
  }

  const STATIC_CATEGORY_VERBS = Object.freeze({
    INCEPTION_DEFAULT: "Thinking…",
    INCEPTION_REASONING: "Reasoning…",
    INCEPTION_RESEARCH: "Investigating…",
    INCEPTION_CODE: "Architecting…",
    INCEPTION_WRITE: "Drafting…",
    CODE: "Writing code…",
    TABLES: "Structuring data…",
    GENERATING: "Synthesizing…"
  });

  function getSmartVerb(streamContext, state) {
    const category = detectCategory(streamContext);
    const verb = STATIC_CATEGORY_VERBS[category] || "Thinking…";

    if (state) {
      state.category = category;
      state.verb = verb;
    }

    return verb;
  }

  function createIndicatorHTML(verb = "Thinking…") {
    const safeVerb = String(verb || "Thinking…");
    return `<span class="streaming-cursor streaming-indicator" role="status" aria-live="polite" aria-label="Generating response" data-current-verb="${escapeHtml(safeVerb)}"><span class="streaming-indicator-spinner" aria-hidden="true">${GYRO_SVG}</span><span class="streaming-indicator-label"><span class="streaming-indicator-verb">${renderFlowingLetters(safeVerb)}</span></span></span>`;
  }

  const activeSessions = new WeakMap();

  function attach(container, streamContext) {
    if (!container || typeof document === "undefined") return null;

    let session = activeSessions.get(container);
    if (!session) {
      session = {
        element: null,
        category: null,
        verb: ""
      };
      activeSessions.set(container, session);
    }

    const verb = getSmartVerb(streamContext, session);

    let indicator = session.element;
    if (!indicator || !indicator.isConnected || indicator.parentNode !== container) {
      indicator = container.querySelector(".streaming-indicator");
      if (!indicator) {
        const template = document.createElement("template");
        template.innerHTML = createIndicatorHTML(verb);
        indicator = (template.content && template.content.firstElementChild) || template.firstElementChild;
        if (indicator) {
          indicator.dataset.currentVerb = verb;
          container.appendChild(indicator);
        }
      }
      session.element = indicator;
    }

    if (indicator) {
      if (container.lastElementChild !== indicator) {
        container.appendChild(indicator);
      }
      updateVerb(indicator, verb);
    }

    return indicator;
  }

  function detach(container) {
    if (!container) return;
    const session = activeSessions.get(container);
    if (session?.element) {
      session.element.remove();
      session.element = null;
    }
    const indicator = container.querySelector(".streaming-indicator");
    if (indicator) indicator.remove();
    activeSessions.delete(container);
  }

  function updateVerb(indicator, newVerb) {
    if (!indicator || !newVerb) return;
    if (indicator.dataset.currentVerb === newVerb) return;
    indicator.dataset.currentVerb = newVerb;

    const label = indicator.querySelector(".streaming-indicator-label");
    if (!label) return;

    label.innerHTML = `<span class="streaming-indicator-verb">${renderFlowingLetters(newVerb)}</span>`;
  }

  globalThis.VelaStreamingSpinner = Object.freeze({
    STATIC_CATEGORY_VERBS,
    detectCategory,
    getSmartVerb,
    createIndicatorHTML,
    renderFlowingLetters,
    attach,
    detach,
    updateVerb
  });
})();
