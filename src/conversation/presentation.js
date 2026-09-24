(() => {
  "use strict";

  const PROMPT_ICONS = Object.freeze({
    research: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4M11 8v6M8 11h6"></path></svg>',
    write: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"></path></svg>',
    code: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m8 9-4 3 4 3M16 9l4 3-4 3M14 5l-4 14"></path></svg>',
    build: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.3 4.7L19 10l-4.7 2.3L12 17l-2.3-4.7L5 10l4.7-2.3Z"></path><path d="m19 16 .9 1.9L22 19l-2.1 1.1L19 22l-.9-1.9L16 19l2.1-1.1Z"></path></svg>'
  });

  const STARTER_PROMPTS = Object.freeze([
    [
      "Help me investigate a complex topic by comparing sources, identifying counter-arguments, and building a structured research brief.",
      "Explore a topic",
      "Research sources & build a brief",
      "research"
    ],
    [
      "Help me draft a concise, compelling editorial document with clear arguments, refined voice, and polished prose.",
      "Draft an editorial",
      "Refine tone, voice & narrative",
      "write"
    ],
    [
      "Review my code architecture to diagnose edge cases, optimize performance, and implement targeted fixes.",
      "Architect or debug code",
      "Design systems & apply fixes",
      "code"
    ],
    [
      "/build Create a small self-contained HTML landing page for a fictional ceramics studio — a hero section, three product cards, and a contact footer, with warm minimal styling.",
      "Build a live prototype",
      "Interactive HTML canvas app",
      "build"
    ]
  ]);

  function formatTime(value, locale = undefined) {
    const date = new Date(Number(value) || Date.now());
    return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function reasoningSummary(reasoning, limit = 150) {
    const plain = String(reasoning || "")
      .replace(/```[\s\S]*?```/g, "Code analysis")
      .replace(/[#>*_`~[\]()]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return plain.length > limit ? `${plain.slice(0, limit - 3).trimEnd()}…` : plain;
  }

  function reasoningSteps(reasoning, limit = 5) {
    const value = String(reasoning || "")
      .replace(/```[\s\S]*?```/g, "Reviewing generated code")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .trim();
    if (!value) return [];
    const candidates = value
      .split(/\n{2,}|\n(?=\s*(?:[-*•]|\d+[.)])\s+)/)
      .map((entry) => entry.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").replace(/[#>*_`~[\]()]/g, "").replace(/\s+/g, " ").trim())
      .filter((entry) => entry.length >= 8);
    const unique = [];
    for (const candidate of candidates) {
      const note = candidate.length > 116 ? `${candidate.slice(0, 113).trimEnd()}…` : candidate;
      if (!unique.some((entry) => entry.toLowerCase() === note.toLowerCase())) unique.push(note);
      if (unique.length >= limit) break;
    }
    return unique.length ? unique : [reasoningSummary(value, 116)];
  }

  function createStartup(document, onPrompt) {
    const startup = document.createElement("section");
    startup.className = "sage-startup";
    startup.setAttribute("aria-label", "Start a new conversation");
    startup.innerHTML = `<div class="sage-startup-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M11.3 3.2v13.1H4.8L11.3 3.2Z"></path><path fill="currentColor" d="M13.1 6.1 19 16.3h-5.9V6.1Z" opacity=".72"></path><path fill="currentColor" d="M4.2 18h15.6c-.9 1.8-2.7 2.8-5 2.8H9.1c-2.2 0-4-1-4.9-2.8Z"></path></svg></div><h1 class="sage-startup-title">Where would you like to begin?</h1><p class="sage-startup-copy">Research complex topics, draft polished writing, architect software, or build live artifacts.</p><div class="sage-startup-prompts"></div>`;
    const prompts = startup.querySelector(".sage-startup-prompts");
    STARTER_PROMPTS.forEach(([prompt, title, desc, mode]) => {
      const button = document.createElement("button");
      button.className = "sage-startup-prompt";
      button.type = "button";
      button.dataset.prompt = prompt;
      if (mode) button.dataset.mode = mode;
      button.innerHTML = `<div class="sage-prompt-icon" aria-hidden="true">${PROMPT_ICONS[mode] || PROMPT_ICONS.research}</div><div class="sage-prompt-content"><span class="sage-prompt-title">${title}</span><span class="sage-prompt-desc">${desc}</span></div><svg class="sage-prompt-arrow icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"></path></svg>`;
      button.addEventListener("click", () => onPrompt?.(prompt, mode));
      prompts.appendChild(button);
    });
    return startup;
  }

  function createUserArticle(document, options) {
    const { message, index, attachments = [], searchEnabled = false, timestamp = Date.now(), fileExtension = () => "FILE", formatTimestamp = formatTime } = options;
    const article = document.createElement("article");
    article.className = "message user-message";
    article.dataset.messageIndex = String(index);
    if (searchEnabled) {
      const status = document.createElement("div");
      status.className = "message-search-status";
      status.innerHTML = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"></path></svg><span>Web search enabled</span>`;
      article.appendChild(status);
    }
    if (attachments.length) {
      const list = document.createElement("div");
      list.className = "message-attachments";
      attachments.forEach((attachment, attIdx) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "message-attachment";
        item.dataset.attachmentId = String(attachment?.id || `att-${index}-${attIdx}`);
        item.dataset.attachmentIndex = String(attIdx);
        item.setAttribute("aria-label", `Preview ${attachment?.name || "attachment"}`);
        item.title = `Click to preview ${attachment?.name || "attachment"}`;
        item._velaAttachment = attachment;
        if (attachment.kind === "image" && attachment.dataUrl) {
          const image = document.createElement("img");
          image.src = attachment.dataUrl;
          image.alt = "";
          item.appendChild(image);
        } else {
          const icon = document.createElement("span");
          icon.className = "attachment-file-icon";
          icon.textContent = fileExtension(attachment.name);
          item.appendChild(icon);
        }
        const name = document.createElement("span");
        name.className = "message-attachment-name";
        name.textContent = attachment.name;
        item.appendChild(name);
        list.appendChild(item);
      });
      article.appendChild(list);
    }
    const body = document.createElement("div");
    body.className = "message-body";
    const paragraph = document.createElement("p");
    paragraph.textContent = message;
    const meta = document.createElement("footer");
    meta.className = "user-message-meta";
    const time = document.createElement("time");
    time.className = "message-time user-message-time";
    const stamp = Number(timestamp) || Date.now();
    time.dateTime = new Date(stamp).toISOString();
    time.textContent = formatTimestamp(stamp);
    const actions = document.createElement("div");
    actions.className = "user-message-actions";
    actions.innerHTML = `<button class="sage-copy-message sage-copy-user" type="button" aria-label="Copy message" title="Copy message"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button><button class="sage-edit-message" type="button" aria-label="Edit message" title="Edit message"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"></path></svg></button>`;
    meta.append(actions, time);
    body.appendChild(paragraph);
    article.append(body, meta);
    return article;
  }

  // Contextual follow-up actions per task mode. `special` actions are handled
  // locally (export, canvas, bibliography); the rest stage a prompt/next turn.
  const FOLLOWUP_ACTIONS = Object.freeze({
    chat: Object.freeze([["continue", "Continue"], ["shorten", "Shorten"], ["refine", "Refine"], ["explain", "Explain"], ["fact-check", "Fact-check"]]),
    write: Object.freeze([["continue", "Continue"], ["refine", "Refine"], ["shorten", "Shorter"], ["expand", "Expand"], ["outline", "Outline"], ["bullets", "To bullets"]]),
    research: Object.freeze([["fact-check", "Fact-check"], ["compare", "Compare"], ["brief", "Build brief"], ["more-sources", "More sources"], ["bibliography", "Bibliography", true]]),
    code: Object.freeze([["continue", "Continue"], ["explain", "Explain"], ["tests", "Add tests"], ["refactor", "Refactor"], ["optimize", "Optimize"]]),
    build: Object.freeze([["continue", "Continue"], ["refine", "Polish"], ["responsive", "Make responsive"], ["explain", "Explain"]])
  });

  function followupsFor(mode) {
    const set = FOLLOWUP_ACTIONS[mode] || FOLLOWUP_ACTIONS.chat;
    const buttons = set.map(([action, label, special]) =>
      `<button class="response-followup" role="menuitem" type="button" data-followup="${action}"${special ? ` data-special="true"` : ""}>${label}</button>`).join("");
    return `${buttons}<button class="response-followup" role="menuitem" type="button" data-followup="canvas" data-special="true">Open in canvas</button><button class="response-followup" role="menuitem" type="button" data-followup="export" data-special="true">Export response</button>`;
  }

  function createAssistantArticle(document, options) {
    const { userIndex, timestamp = 0, taskMode = "chat", validModes = [] , formatTimestamp = formatTime } = options;
    const article = document.createElement("article");
    article.className = "message assistant-message";
    article.dataset.userIndex = String(userIndex);
    article.dataset.taskMode = (validModes && validModes.length > 0)
      ? (validModes.includes(taskMode) ? taskMode : "chat")
      : (taskMode || "chat");
    if (timestamp) article.dataset.timestamp = String(timestamp);
    const followupButtons = followupsFor(article.dataset.taskMode);
    const initialVerb = article.dataset.taskMode === "research" ? "Investigating…" : (article.dataset.taskMode === "code" ? "Architecting…" : (article.dataset.taskMode === "write" ? "Drafting…" : "Thinking…"));
    const initialCursorHtml = globalThis.VelaStreamingSpinner?.createIndicatorHTML?.(initialVerb) ||
      `<span class="streaming-cursor streaming-indicator" role="status" aria-live="polite" aria-label="Generating response" data-current-verb="${initialVerb}"><span class="streaming-indicator-spinner" aria-hidden="true"><svg class="streaming-gyro-svg" viewBox="0 0 18 18" width="15" height="15" fill="none" aria-hidden="true"><circle class="gyro-outer-track" cx="9" cy="9" r="7" stroke="currentColor" stroke-width="1.2" opacity="0.16" /><circle class="gyro-outer-arc" cx="9" cy="9" r="7" stroke="var(--accent)" stroke-width="1.35" stroke-linecap="round" stroke-dasharray="14 30" /><circle class="gyro-inner-track" cx="9" cy="9" r="4.2" stroke="currentColor" stroke-width="1" opacity="0.14" /><circle class="gyro-inner-arc" cx="9" cy="9" r="4.2" stroke="var(--accent)" stroke-width="1.25" stroke-linecap="round" stroke-dasharray="9 17" /><circle class="gyro-core" cx="9" cy="9" r="1.3" fill="var(--accent)" /></svg></span><span class="streaming-indicator-label"><span class="streaming-indicator-verb">${initialVerb}</span></span></span>`;
    article.innerHTML = `<div class="message-body"><div class="thought sage-live-thought"><button class="thought-toggle" type="button" aria-expanded="false"><span class="thought-dot"></span><span class="sage-thought-label">Planning response…</span><svg class="icon thought-chevron" style="width:13px;height:13px" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"></path></svg></button><div class="thought-summary" hidden></div><div class="thought-details"><div class="thought-details-inner"><ol class="thought-step-notes" aria-label="Response planning steps"></ol><div class="thought-details-copy markdown-body" hidden></div></div></div></div><div class="sage-response markdown-body">${initialCursorHtml}</div></div><footer class="assistant-message-meta"><div class="response-actions"><button class="mini-action sage-copy-response" type="button" aria-label="Copy response" title="Copy response"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button><button class="mini-action sage-regenerate-response" type="button" aria-label="Regenerate response" title="Regenerate response"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"></path><path d="M6.1 9A7 7 0 0 1 18.7 6L20 8M4 16l1.3 2A7 7 0 0 0 18 15"></path></svg></button><div class="response-more"><button class="response-more-trigger" type="button" aria-haspopup="menu" aria-expanded="false">More</button><div class="response-followups" role="menu" hidden>${followupButtons}</div></div></div><time class="message-time assistant-message-time"></time></footer>`;
    if (timestamp) {
      const time = article.querySelector(".assistant-message-time");
      time.dateTime = new Date(timestamp).toISOString();
      time.textContent = formatTimestamp(timestamp);
    }
    return article;
  }

  globalThis.VelaConversationPresentation = Object.freeze({ STARTER_PROMPTS, formatTime, reasoningSummary, reasoningSteps, createStartup, createUserArticle, createAssistantArticle });
})();
