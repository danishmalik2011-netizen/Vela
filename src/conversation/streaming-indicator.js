(() => {
  "use strict";

  const DWELL_TIME_MS = 2800;

  const VERB_CATEGORIES = Object.freeze({
    INCEPTION_DEFAULT: [
      "Thinking…",
      "Reflecting…",
      "Formulating approach…",
      "Synthesizing…"
    ],
    INCEPTION_REASONING: [
      "Reasoning…",
      "Evaluating possibilities…",
      "Structuring logic…",
      "Deliberating…"
    ],
    INCEPTION_RESEARCH: [
      "Investigating…",
      "Synthesizing sources…",
      "Exploring references…",
      "Cross-referencing…"
    ],
    INCEPTION_CODE: [
      "Architecting…",
      "Analyzing constraints…",
      "Designing solution…",
      "Preparing implementation…"
    ],
    INCEPTION_WRITE: [
      "Gathering ideas…",
      "Outlining narrative…",
      "Composing draft…",
      "Structuring prose…"
    ],

    CODE_WEB: [
      "Constructing components…",
      "Structuring interfaces…",
      "Styling elements…",
      "Implementing logic…"
    ],
    CODE_DATA: [
      "Crafting queries…",
      "Structuring schema…",
      "Compiling relations…",
      "Processing datasets…"
    ],
    CODE_SYSTEMS: [
      "Constructing types…",
      "Optimizing routines…",
      "Implementing algorithms…",
      "Managing memory…"
    ],
    CODE_DEFAULT: [
      "Writing code…",
      "Implementing solution…",
      "Structuring syntax…",
      "Refactoring logic…"
    ],

    TABLES: [
      "Structuring table…",
      "Compiling data…",
      "Aligning columns…",
      "Formatting rows…"
    ],
    LISTS: [
      "Outlining steps…",
      "Detailing sequence…",
      "Organizing points…",
      "Enumerating…"
    ],
    MATH: [
      "Calculating…",
      "Deriving formulas…",
      "Formulating equations…",
      "Verifying values…"
    ],
    CITATIONS: [
      "Cross-referencing…",
      "Validating citations…",
      "Distilling evidence…",
      "Indexing references…"
    ],

    PROSE_EARLY: [
      "Drafting response…",
      "Unfolding thoughts…",
      "Composing ideas…",
      "Articulating premise…"
    ],
    PROSE_MID: [
      "Elaborating…",
      "Articulating insights…",
      "Developing nuances…",
      "Deepening context…"
    ],
    PROSE_LATE: [
      "Synthesizing perspectives…",
      "Connecting themes…",
      "Refining analysis…",
      "Crystallizing points…"
    ],
    PROSE_CLOSING: [
      "Synthesizing takeaways…",
      "Polishing response…",
      "Refining conclusions…",
      "Harmonizing summary…"
    ]
  });

  function detectCategory(streamContext) {
    const { text = "", reasoning = "", taskMode = "chat" } = streamContext || {};
    const trimmedText = String(text || "").trim();
    const trimmedReasoning = String(reasoning || "").trim();

    // Inception phase (prior to any output tokens)
    if (!trimmedText) {
      if (trimmedReasoning) return "INCEPTION_REASONING";
      if (taskMode === "research") return "INCEPTION_RESEARCH";
      if (taskMode === "code") return "INCEPTION_CODE";
      if (taskMode === "write") return "INCEPTION_WRITE";
      return "INCEPTION_DEFAULT";
    }

    // Active code block detection (unclosed markdown fence)
    const fenceMatches = text.match(/```/g);
    const isOpenCodeBlock = fenceMatches && fenceMatches.length % 2 === 1;
    if (isOpenCodeBlock) {
      const lastFenceIndex = text.lastIndexOf("```");
      const fenceHeader = text.slice(lastFenceIndex, lastFenceIndex + 30).toLowerCase();
      if (/```(?:html|css|svg|jsx|tsx|vue|svelte|javascript|js|typescript|ts)/.test(fenceHeader)) {
        return "CODE_WEB";
      }
      if (/```(?:sql|prisma|graphql|postgres|mysql)/.test(fenceHeader)) {
        return "CODE_DATA";
      }
      if (/```(?:rust|rs|go|golang|c|cpp|c\+\+|zig)/.test(fenceHeader)) {
        return "CODE_SYSTEMS";
      }
      return "CODE_DEFAULT";
    }

    // Recent content tail analysis (last 320 characters)
    const tail = text.slice(-320);

    // Markdown table structure
    if (/\n\|[^\n]+\|\n\|?[\s:-|]+\|?/.test(tail) || (tail.match(/\n\|/g) || []).length >= 2) {
      return "TABLES";
    }

    // Step-by-step or enumerated list breakdown
    if (/\n(?:\d+\.|\*|-|#+)\s+[^\n]+/.test(tail)) {
      return "LISTS";
    }

    // Mathematical formula or computation
    if (/\$\$[^\$]+\$\$|\$[^\$\n]+\$|\\\[[\s\S]+?\\\]|\\\(.+?\\\)/.test(tail) || /\b(?:equation|formula|theorem|matrix|integral)\b/i.test(tail)) {
      return "MATH";
    }

    // Citations / URLs
    if (/https?:\/\/[^\s)]+|\[(?:source|\d+)\]/i.test(tail)) {
      return "CITATIONS";
    }

    // Concluding cues
    if (/\b(?:in summary|in conclusion|to conclude|to wrap up|takeaways?|key points?|finally)\b/i.test(tail) || text.length > 3200) {
      return "PROSE_CLOSING";
    }

    // Generative narrative progression
    if (text.length < 350) return "PROSE_EARLY";
    if (text.length < 1400) return "PROSE_MID";
    return "PROSE_LATE";
  }

  function getSmartVerb(streamContext, state) {
    const category = detectCategory(streamContext);
    const verbs = VERB_CATEGORIES[category] || VERB_CATEGORIES.INCEPTION_DEFAULT;

    const now = Date.now();
    const lastSwitch = state?.lastSwitch || 0;
    const currentCategory = state?.category;
    const currentVerb = state?.verb;

    // Urgent transitions: Inception -> Text, or entering/exiting a code fence
    const isUrgentCategoryChange =
      (category.startsWith("CODE") && !currentCategory?.startsWith("CODE")) ||
      (!category.startsWith("CODE") && currentCategory?.startsWith("CODE")) ||
      (currentCategory?.startsWith("INCEPTION") && !category.startsWith("INCEPTION")) ||
      (!currentCategory?.startsWith("INCEPTION") && category.startsWith("INCEPTION"));

    if (currentVerb && !isUrgentCategoryChange && (now - lastSwitch < DWELL_TIME_MS)) {
      return currentVerb;
    }

    // Cycle through verbs in the current category avoiding immediate repeats
    let candidate = verbs[0];
    if (verbs.length > 1) {
      const remaining = verbs.filter((v) => v !== currentVerb);
      const textEntropy = (streamContext?.text || "").length;
      const seed = Math.floor(now / 1000) ^ textEntropy;
      candidate = remaining[Math.abs(seed) % remaining.length];
    }

    if (state) {
      state.category = category;
      state.verb = candidate;
      state.lastSwitch = now;
    }

    return candidate;
  }

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  const SPINNER_SVG = `<svg class="streaming-spinner-svg" viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true"><circle class="spinner-track" cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.75" /><circle class="spinner-head" cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-dasharray="11 27" /></svg><span class="streaming-spinner-core" aria-hidden="true"></span>`;

  function createIndicatorHTML(verb = "Thinking…") {
    return `<span class="streaming-cursor streaming-indicator" role="status" aria-live="polite" aria-label="Generating response"><span class="streaming-indicator-spinner" aria-hidden="true">${SPINNER_SVG}</span><span class="streaming-indicator-label"><span class="streaming-indicator-verb">${escapeHtml(verb)}</span></span></span>`;
  }

  const activeSessions = new WeakMap();

  function attach(container, streamContext) {
    if (!container || typeof document === "undefined") return null;

    let session = activeSessions.get(container);
    if (!session) {
      session = {
        element: null,
        category: null,
        verb: "",
        lastSwitch: 0,
        timer: null,
        context: streamContext || {}
      };
      activeSessions.set(container, session);
    }
    session.context = streamContext || {};

    const verb = getSmartVerb(session.context, session);

    let indicator = container.querySelector(".streaming-indicator");
    if (!indicator) {
      const template = document.createElement("template");
      template.innerHTML = createIndicatorHTML(verb);
      indicator = (template.content && template.content.firstElementChild) || template.firstElementChild;
      session.element = indicator;
      if (indicator) container.appendChild(indicator);
    } else {
      session.element = indicator;
      if (container.lastElementChild !== indicator) {
        container.appendChild(indicator);
      }
      updateVerb(indicator, verb);
    }

    if (!session.timer) {
      session.timer = setInterval(() => {
        if (!indicator || !indicator.isConnected) {
          if (session.timer) {
            clearInterval(session.timer);
            session.timer = null;
          }
          return;
        }
        const updatedVerb = getSmartVerb(session.context, session);
        updateVerb(indicator, updatedVerb);
      }, 1000);
    }

    return indicator;
  }

  function detach(container) {
    if (!container) return;
    const session = activeSessions.get(container);
    if (session?.timer) {
      clearInterval(session.timer);
      session.timer = null;
    }
    const indicator = container.querySelector(".streaming-indicator");
    if (indicator) indicator.remove();
    activeSessions.delete(container);
  }

  function updateVerb(indicator, newVerb) {
    if (!indicator || !newVerb) return;
    const label = indicator.querySelector(".streaming-indicator-label");
    if (!label) return;

    const currentVerbEl = label.querySelector(".streaming-indicator-verb:not(.is-exiting)");
    if (!currentVerbEl) {
      label.innerHTML = `<span class="streaming-indicator-verb">${escapeHtml(newVerb)}</span>`;
      return;
    }
    if (currentVerbEl.textContent === newVerb) return;

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

    if (prefersReducedMotion) {
      currentVerbEl.textContent = newVerb;
      return;
    }

    const enteringEl = document.createElement("span");
    enteringEl.className = "streaming-indicator-verb is-entering";
    enteringEl.textContent = newVerb;
    label.appendChild(enteringEl);

    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        currentVerbEl.classList.add("is-exiting");
        enteringEl.classList.remove("is-entering");
        setTimeout(() => {
          if (currentVerbEl.parentNode) currentVerbEl.remove();
        }, 290);
      });
    } else {
      currentVerbEl.remove();
      enteringEl.className = "streaming-indicator-verb";
    }
  }

  globalThis.VelaStreamingSpinner = Object.freeze({
    DWELL_TIME_MS,
    VERB_CATEGORIES,
    detectCategory,
    getSmartVerb,
    createIndicatorHTML,
    attach,
    detach,
    updateVerb
  });
})();
