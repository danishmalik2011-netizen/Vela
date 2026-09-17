(() => {
  "use strict";

  const CURRENT_VERSION = 8;
  const TASK_MODES = Object.freeze(["chat", "write", "research", "code", "build"]);
  const MAX_PERSISTED_ATTACHMENT_TEXT = 200_000;

  function compactAttachment(attachment = {}) {
    const text = String(attachment.text || "");
    return {
      id: attachment.id,
      name: attachment.name,
      type: attachment.type,
      size: attachment.size,
      kind: attachment.kind,
      // Data URLs can exhaust localStorage after only a few images. The image
      // is available for the active turn but is not duplicated into history.
      dataUrl: "",
      text: text.length > MAX_PERSISTED_ATTACHMENT_TEXT
        ? `${text.slice(0, MAX_PERSISTED_ATTACHMENT_TEXT)}\n\n[Attachment truncated for local storage]`
        : text
    };
  }

  function withoutAttachmentPayloads(record) {
    return {
      ...record,
      messages: (Array.isArray(record?.messages) ? record.messages : []).map((message) => ({
        ...message,
        attachments: (Array.isArray(message?.attachments) ? message.attachments : []).map((attachment) => ({
          ...(attachment || {}),
          dataUrl: "",
          text: ""
        }))
      }))
    };
  }

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
      messages: (Array.isArray(state?.messages) ? state.messages : []).filter(Boolean).map((message) => ({
        role: message.role,
        content: String(message.content || ""),
        reasoning: String(message.reasoning || ""),
        timestamp: Number(message.timestamp) || 0,
        sources: Array.isArray(message.sources) ? message.sources : [],
        searchEnabled: Boolean(message.searchEnabled),
        taskMode: TASK_MODES.includes(message.taskMode) ? message.taskMode : "chat",
        attachments: (Array.isArray(message?.attachments) ? message.attachments : []).map(compactAttachment)
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
      messages: (Array.isArray(saved.messages) ? saved.messages : [])
        .filter((message) => message && ["user", "assistant"].includes(message.role) && typeof message.content === "string")
        .map((message) => ({
          role: message.role,
          content: message.content,
          reasoning: typeof message.reasoning === "string" ? message.reasoning : "",
          timestamp: Number(message.timestamp) || 0,
          sources: Array.isArray(message.sources) ? message.sources : [],
          searchEnabled: Boolean(message.searchEnabled),
          taskMode: TASK_MODES.includes(message.taskMode) ? message.taskMode : "chat",
          attachments: (Array.isArray(message.attachments) ? message.attachments : []).map(compactAttachment)
        })),
      pending: saved.pending && typeof saved.pending.message === "string" ? saved.pending : null,
      pinned: Boolean(saved.pinned),
      archived: Boolean(saved.archived),
      createdAt: Number(saved.createdAt) || Number(clock()),
      updatedAt: Number(saved.updatedAt || saved.savedAt) || Number(clock())
    };
  }

  function isQuotaError(error) {
    return error?.name === "QuotaExceededError" || error?.code === 22 || error?.code === 1014;
  }

  function writeRecord(storage, key, record) {
    try {
      storage.setItem(key, JSON.stringify(record));
      return { record, persisted: true, compacted: false };
    } catch (error) {
      if (!isQuotaError(error)) throw error;
      const compacted = withoutAttachmentPayloads(record);
      try {
        storage.setItem(key, JSON.stringify(compacted));
        return { record: compacted, persisted: true, compacted: true };
      } catch (retryError) {
        if (!isQuotaError(retryError)) throw retryError;
        return { record: compacted, persisted: false, compacted: true };
      }
    }
  }

  function save(storage, keys, state, clock = Date.now) {
    let record = serialize(state, clock);
    const primaryKey = storageKey(keys.prefix, record.id);
    // Remove obsolete full-size mirrors before writing, so an existing mirror
    // cannot prevent its authoritative conversation from being updated.
    if (keys.compatibility) storage.removeItem(keys.compatibility);
    if (keys.legacy) storage.removeItem(keys.legacy);
    const result = writeRecord(storage, primaryKey, record);
    record = result.record;
    try {
      if (keys.active) storage.setItem(keys.active, record.id);
    } catch (error) {
      if (!isQuotaError(error)) throw error;
    }
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
      id: state?.id || "",
      title: state?.title || "New conversation",
      projectId: state?.projectId || "",
      createdAt: state?.createdAt || 0,
      updatedAt: state?.updatedAt || 0,
      messageCount: Array.isArray(state?.messages) ? state.messages.length : 0,
      artifactCount: Array.isArray(state?.artifacts) ? state.artifacts.length : 0,
      pinned: Boolean(state?.pinned),
      archived: Boolean(state?.archived)
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
    compactAttachment,
    withoutAttachmentPayloads,
    isQuotaError,
    writeRecord,
    migrate,
    save,
    load,
    indexEntry,
    empty,
    hydrate
  });
})();
