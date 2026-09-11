(() => {
  "use strict";

  const CURRENT_VERSION = 8;
  const TASK_MODES = Object.freeze(["chat", "write", "research", "code", "build"]);

  function safeParse(value, fallback) {
    try {
      const parsed = JSON.parse(value);
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
  }

  function storageKey(prefix, id) {
    return `${prefix}${id}`;
  }

  function readIndex(storage, key) {
    const index = safeParse(storage.getItem(key) || "[]", []);
    return Array.isArray(index) ? index.filter((item) => item?.id) : [];
  }

  function writeIndex(storage, key, index) {
    const normalized = (Array.isArray(index) ? index : [])
      .filter((item) => item?.id)
      .sort((left, right) => Number(right.updatedAt) - Number(left.updatedAt))
      .slice(0, 100);
    storage.setItem(key, JSON.stringify(normalized));
    return normalized;
  }

  const researchStore = globalThis.VelaResearchStore;
  const writingStore = globalThis.VelaWritingStore;
  const codeStore = globalThis.VelaCodeWorkspace;

  function serialize(state, clock = Date.now) {
    return {
      version: CURRENT_VERSION,
      id: state.id,
      title: state.title,
      projectId: state.projectId || "",
      research: researchStore?.normalize(state.research) || state.research || null,
      writing: writingStore?.normalize(state.writing) || state.writing || null,
      codeWorkspace: codeStore?.normalize(state.codeWorkspace) || state.codeWorkspace || null,
      artifacts: Array.isArray(state.artifacts) ? state.artifacts : [],
      taskMode: TASK_MODES.includes(state.taskMode) ? state.taskMode : "chat",
      messages: (Array.isArray(state.messages) ? state.messages : []).map((message) => ({
        role: message.role,
        content: String(message.content || ""),
        reasoning: String(message.reasoning || ""),
        timestamp: Number(message.timestamp) || 0,
        sources: Array.isArray(message.sources) ? message.sources : [],
        searchEnabled: Boolean(message.searchEnabled),
        taskMode: TASK_MODES.includes(message.taskMode) ? message.taskMode : "chat",
        attachments: (Array.isArray(message.attachments) ? message.attachments : []).map((attachment) => ({
          id: attachment.id,
          name: attachment.name,
          type: attachment.type,
          size: attachment.size,
          kind: attachment.kind,
          dataUrl: attachment.kind === "image" ? attachment.dataUrl || "" : "",
          text: attachment.text || ""
        }))
      })),
      pending: state.pending || null,
      pinned: Boolean(state.pinned),
      archived: Boolean(state.archived),
      createdAt: Number(state.createdAt) || Number(clock()),
      updatedAt: Number(state.updatedAt) || Number(clock()),
      savedAt: Number(clock())
    };
  }

  function migrate(saved, artifactStore, clock = Date.now) {
    if (!saved || !Array.isArray(saved.messages)) return null;
    return {
      id: String(saved.id || ""),
      title: typeof saved.title === "string" ? saved.title : "New conversation",
      projectId: typeof saved.projectId === "string" ? saved.projectId : "",
      research: researchStore?.normalize(saved.research) || saved.research || null,
      writing: writingStore?.normalize(saved.writing) || saved.writing || null,
      codeWorkspace: codeStore?.normalize(saved.codeWorkspace) || saved.codeWorkspace || null,
      artifacts: artifactStore?.migrate(saved.artifacts, clock) || [],
      taskMode: TASK_MODES.includes(saved.taskMode) ? saved.taskMode : "chat",
      messages: saved.messages
        .filter((message) => message && ["user", "assistant"].includes(message.role) && typeof message.content === "string")
        .map((message) => ({
          role: message.role,
          content: message.content,
          reasoning: typeof message.reasoning === "string" ? message.reasoning : "",
          timestamp: Number(message.timestamp) || 0,
          sources: Array.isArray(message.sources) ? message.sources : [],
          searchEnabled: Boolean(message.searchEnabled),
          taskMode: TASK_MODES.includes(message.taskMode) ? message.taskMode : "chat",
          attachments: Array.isArray(message.attachments) ? message.attachments : []
        })),
      pending: saved.pending && typeof saved.pending.message === "string" ? saved.pending : null,
      pinned: Boolean(saved.pinned),
      archived: Boolean(saved.archived),
      createdAt: Number(saved.createdAt) || Number(clock()),
      updatedAt: Number(saved.updatedAt || saved.savedAt) || Number(clock())
    };
  }

  function save(storage, keys, state, clock = Date.now) {
    const record = serialize(state, clock);
    storage.setItem(storageKey(keys.prefix, record.id), JSON.stringify(record));
    if (keys.compatibility) storage.setItem(keys.compatibility, JSON.stringify(record));
    if (keys.active) storage.setItem(keys.active, record.id);
    return record;
  }

  function load(storage, keys, conversationId, artifactStore, clock = Date.now) {
    const activeId = conversationId || (keys.active ? storage.getItem(keys.active) : "") || "";
    const candidates = [
      activeId ? storage.getItem(storageKey(keys.prefix, activeId)) : null,
      keys.compatibility ? storage.getItem(keys.compatibility) : null,
      keys.legacy ? storage.getItem(keys.legacy) : null
    ];
    const raw = candidates.find(Boolean);
    return migrate(safeParse(raw || "null", null), artifactStore, clock);
  }

  function indexEntry(state) {
    return {
      id: state.id,
      title: state.title,
      projectId: state.projectId || "",
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      messageCount: Array.isArray(state.messages) ? state.messages.length : 0,
      artifactCount: Array.isArray(state.artifacts) ? state.artifacts.length : 0,
      pinned: Boolean(state.pinned),
      archived: Boolean(state.archived)
    };
  }

  function empty(clock = Date.now) {
    const now = Number(clock());
    return {
      id: "",
      title: "New conversation",
      projectId: "",
      research: researchStore?.empty() || null,
      writing: writingStore?.empty() || null,
      codeWorkspace: codeStore?.empty() || null,
      messages: [],
      artifacts: [],
      taskMode: "chat",
      pending: null,
      pinned: false,
      archived: false,
      createdAt: now,
      updatedAt: now
    };
  }

  function hydrate(target, saved, options = {}) {
    if (!target || !saved) return false;
    const artifactStore = options.artifactStore;
    const normalized = migrate(saved, artifactStore, options.clock || Date.now);
    if (!normalized) return false;
    Object.assign(target, normalized, {
      id: normalized.id || options.fallbackId || target.id || "",
      research: researchStore?.normalize(normalized.research) || normalized.research,
      writing: writingStore?.normalize(normalized.writing) || normalized.writing,
      codeWorkspace: codeStore?.normalize(normalized.codeWorkspace) || normalized.codeWorkspace
    });
    return Boolean(target.messages.length || target.pending);
  }

  globalThis.VelaConversationStore = Object.freeze({
    CURRENT_VERSION,
    TASK_MODES,
    safeParse,
    storageKey,
    readIndex,
    writeIndex,
    serialize,
    migrate,
    save,
    load,
    indexEntry,
    empty,
    hydrate
  });
})();
