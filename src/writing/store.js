(() => {
  "use strict";

  const VERSION = 1;
  const STAGES = Object.freeze(["brief", "outline", "draft", "revision"]);

  function empty() {
    return {
      version: VERSION,
      stage: "brief",
      brief: "",
      outline: "",
      draft: "",
      proposal: null,
      revisions: [],
      updatedAt: 0
    };
  }

  function normalize(value) {
    const input = value && typeof value === "object" ? value : {};
    return {
      version: VERSION,
      stage: STAGES.includes(input.stage) ? input.stage : "brief",
      brief: String(input.brief || ""),
      outline: String(input.outline || ""),
      draft: String(input.draft || ""),
      proposal: input.proposal && typeof input.proposal.after === "string"
        ? {
            id: String(input.proposal.id || "proposal"),
            action: String(input.proposal.action || "rewrite"),
            before: String(input.proposal.before || ""),
            after: String(input.proposal.after),
            selectionStart: Number(input.proposal.selectionStart) || 0,
            selectionEnd: Number(input.proposal.selectionEnd) || 0,
            createdAt: Number(input.proposal.createdAt) || Date.now()
          }
        : null,
      revisions: (Array.isArray(input.revisions) ? input.revisions : []).map((revision, index) => ({
        version: Number(revision.version) || index + 1,
        content: String(revision.content || ""),
        note: String(revision.note || "Saved draft"),
        createdAt: Number(revision.createdAt) || Date.now()
      })),
      updatedAt: Number(input.updatedAt) || 0
    };
  }

  function update(document, patch, clock = Date.now) {
    return normalize({ ...normalize(document), ...patch, updatedAt: Number(clock()) });
  }

  function saveDraft(document, content, note = "Edited draft", clock = Date.now) {
    const current = normalize(document);
    const draft = String(content || "");
    if (draft === current.draft) return current;
    const version = current.revisions.length + 1;
    return update(current, {
      draft,
      stage: "draft",
      revisions: [...current.revisions, { version, content: draft, note, createdAt: Number(clock()) }],
      proposal: null
    }, clock);
  }

  function propose(document, { action, replacement, selectionStart = 0, selectionEnd = 0 }, clock = Date.now) {
    const current = normalize(document);
    const start = Math.max(0, Math.min(Number(selectionStart) || 0, current.draft.length));
    const end = Math.max(start, Math.min(Number(selectionEnd) || current.draft.length, current.draft.length));
    const before = current.draft.slice(start, end) || current.draft;
    const after = String(replacement || "");
    return update(current, {
      stage: "revision",
      proposal: {
        id: `proposal-${Number(clock()).toString(36)}`,
        action: String(action || "rewrite"),
        before,
        after,
        selectionStart: before === current.draft ? 0 : start,
        selectionEnd: before === current.draft ? current.draft.length : end,
        createdAt: Number(clock())
      }
    }, clock);
  }

  function accept(document, clock = Date.now) {
    const current = normalize(document);
    if (!current.proposal) return current;
    const { selectionStart, selectionEnd, after, action } = current.proposal;
    const next = current.draft.slice(0, selectionStart) + after + current.draft.slice(selectionEnd);
    return saveDraft(current, next, `Accepted ${action} proposal`, clock);
  }

  function reject(document, clock = Date.now) {
    return update(document, { proposal: null, stage: "draft" }, clock);
  }

  function restore(document, version, clock = Date.now) {
    const current = normalize(document);
    const revision = current.revisions.find((entry) => entry.version === Number(version));
    return revision ? saveDraft(current, revision.content, `Restored version ${version}`, clock) : current;
  }

  function diff(document) {
    const proposal = normalize(document).proposal;
    if (!proposal) return [];
    return [
      { type: "removed", text: proposal.before },
      { type: "added", text: proposal.after }
    ];
  }

  globalThis.VelaWritingStore = Object.freeze({ VERSION, STAGES, empty, normalize, update, saveDraft, propose, accept, reject, restore, diff });
})();
