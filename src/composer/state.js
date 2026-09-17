(() => {
  "use strict";

  const DEFAULT_LIMITS = Object.freeze({ maxFiles: 10, maxFileBytes: 50 * 1024 * 1024, maxTotalBytes: 100 * 1024 * 1024 });
  const MODE_COMMANDS = Object.freeze([
    Object.freeze({ command: "/chat", mode: "chat", label: "Chat", description: "Ask, discuss, and reason together" }),
    Object.freeze({ command: "/write", mode: "write", label: "Write", description: "Draft, edit, and refine writing" }),
    Object.freeze({ command: "/research", mode: "research", label: "Research", description: "Investigate with sources and evidence" }),
    Object.freeze({ command: "/code", mode: "code", label: "Code", description: "Build, debug, and explain software" }),
    Object.freeze({ command: "/build", mode: "build", label: "Build", description: "Create a polished interactive artifact" })
  ]);

  // Prompt-shaping commands: they keep the current task mode but wrap the
  // remaining text in a precise instruction so one keystroke gets a workflow.
  const PROMPT_COMMANDS = Object.freeze([
    Object.freeze({ command: "/summarize", prefix: "Summarize this clearly and keep every important detail:", description: "Summarize text or the topic", label: "Summarize" }),
    Object.freeze({ command: "/plan", prefix: "Create a concrete step-by-step plan for:", description: "Turn a goal into a plan", label: "Plan" }),
    Object.freeze({ command: "/compare", prefix: "Compare the following options or ideas, including tradeoffs and a recommendation:", description: "Compare options with tradeoffs", label: "Compare", mode: "research" }),
    Object.freeze({ command: "/explain", prefix: "Explain the following clearly, step by step, for someone new to it:", description: "Explain simply and clearly", label: "Explain" })
  ]);

  // Immediate app actions: no model call, handled by the shell.
  const ACTION_COMMANDS = Object.freeze([
    Object.freeze({ command: "/export", action: "export", label: "Export", description: "Download this conversation as Markdown" }),
    Object.freeze({ command: "/canvas", action: "canvas", label: "Canvas", description: "Open the artifact canvas or library" }),
    Object.freeze({ command: "/shortcuts", action: "shortcuts", label: "Shortcuts", description: "Show keyboard shortcuts" }),
    Object.freeze({ command: "/quiet", action: "quiet", label: "Quiet mode", description: "Toggle reduced decoration for deep work" }),
    Object.freeze({ command: "/project", action: "project", label: "Project", description: "Assign this conversation to a project by name" }),
    Object.freeze({ command: "/remember", action: "remember", label: "Remember", description: "Save a note Vela keeps in mind in this workspace" })
  ]);

  const ALL_COMMANDS = Object.freeze([...MODE_COMMANDS, ...PROMPT_COMMANDS, ...ACTION_COMMANDS]);

  function slashQuery(text) {
    const match = String(text || "").match(/^\s*\/([a-z]*)$/i);
    return match ? match[1].toLowerCase() : null;
  }

  function commandSuggestions(text) {
    const query = slashQuery(text);
    if (query === null) return [];
    return ALL_COMMANDS.filter((item) => item.command.slice(1).startsWith(query));
  }

  function applySlashCommand(text) {
    const source = String(text || "");
    const match = source.match(/^\s*\/([a-z]+)(?:\s+([\s\S]*))?$/i);
    if (!match) return { matched: false, mode: "", action: "", text: source };
    const name = match[1].toLowerCase();
    const rest = String(match[2] || "").replace(/^\s+/, "");
    const modeCommand = MODE_COMMANDS.find((item) => item.command === `/${name}`);
    if (modeCommand) return { matched: true, mode: modeCommand.mode, action: "", text: rest };
    const promptCommand = PROMPT_COMMANDS.find((item) => item.command === `/${name}`);
    if (promptCommand) {
      return {
        matched: true,
        mode: promptCommand.mode || "",
        action: "",
        text: rest ? `${promptCommand.prefix}\n\n${rest}` : promptCommand.prefix
      };
    }
    const actionCommand = ACTION_COMMANDS.find((item) => item.command === `/${name}`);
    if (actionCommand) return { matched: true, mode: "", action: actionCommand.action, text: rest };
    return { matched: false, mode: "", action: "", text: source };
  }

  function create(initial = {}) {
    return {
      text: String(initial.text || ""),
      attachments: Array.isArray(initial.attachments) ? initial.attachments.map((item) => ({ ...item })) : [],
      searchEnabled: Boolean(initial.searchEnabled),
      taskMode: String(initial.taskMode || "chat")
    };
  }

  function totalBytes(state) {
    return (state?.attachments || []).reduce((total, attachment) => total + (Number(attachment.size) || 0), 0);
  }

  function canSend(state, running = false) {
    return !running && (Boolean(String(state?.text || "").trim()) || Boolean(state?.attachments?.length));
  }

  function addAttachment(state, attachment, limits = DEFAULT_LIMITS) {
    const current = create(state);
    const item = { ...attachment, size: Number(attachment?.size) || 0 };
    if (current.attachments.length >= limits.maxFiles) return { state: current, error: `You can attach up to ${limits.maxFiles} files` };
    if (item.size > limits.maxFileBytes) return { state: current, error: `${item.name || "File"} is larger than ${Math.round(limits.maxFileBytes / 1024 / 1024)} MB` };
    if (totalBytes(current) + item.size > limits.maxTotalBytes) return { state: current, error: "Attachments exceed the total size limit" };
    const duplicate = current.attachments.some((entry) => entry.id === item.id || (entry.name === item.name && entry.size === item.size));
    if (duplicate) return { state: current, error: `${item.name || "File"} is already attached` };
    return { state: { ...current, attachments: [...current.attachments, item] }, error: "" };
  }

  function removeAttachment(state, attachmentId) {
    const current = create(state);
    return { ...current, attachments: current.attachments.filter((attachment) => attachment.id !== attachmentId) };
  }

  function snapshot(state) {
    const current = create(state);
    const effectiveText = current.text.trim() || (current.attachments.length === 1
      ? `Please review ${current.attachments[0].name}.`
      : `Please review the ${current.attachments.length} attached files.`);
    return { message: effectiveText, attachments: current.attachments.map((item) => ({ ...item })), searchEnabled: current.searchEnabled, taskMode: current.taskMode };
  }

  function clear(state, preserve = {}) {
    const current = create(state);
    return create({ taskMode: preserve.taskMode ?? current.taskMode, searchEnabled: preserve.searchEnabled ?? current.searchEnabled });
  }

  globalThis.VelaComposerState = Object.freeze({ DEFAULT_LIMITS, MODE_COMMANDS, PROMPT_COMMANDS, ACTION_COMMANDS, ALL_COMMANDS, create, totalBytes, canSend, addAttachment, removeAttachment, snapshot, clear, slashQuery, commandSuggestions, applySlashCommand });
})();
