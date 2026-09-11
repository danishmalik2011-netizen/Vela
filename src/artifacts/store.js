(() => {
  "use strict";

  function nowValue(clock) {
    return typeof clock === "function" ? Number(clock()) : Date.now();
  }

  function migrate(artifacts, clock = Date.now) {
    return (Array.isArray(artifacts) ? artifacts : [])
      .filter((artifact) => artifact && artifact.id && typeof artifact.source === "string")
      .map((artifact) => {
        const version = Number(artifact.version) || 1;
        const createdAt = Number(artifact.createdAt) || nowValue(clock);
        const updatedAt = Number(artifact.updatedAt) || createdAt;
        const revisions = Array.isArray(artifact.revisions) && artifact.revisions.length
          ? artifact.revisions.map((revision, index) => ({
              version: Number(revision.version) || index + 1,
              source: typeof revision.source === "string" ? revision.source : artifact.source,
              createdAt: Number(revision.createdAt) || updatedAt,
              note: String(revision.note || "Saved revision")
            }))
          : [{ version, source: artifact.source, createdAt: updatedAt, note: "Imported" }];

        return { ...artifact, version, createdAt, updatedAt, revisions };
      });
  }

  function create({ id, signature, language, title, source }, clock = Date.now) {
    const timestamp = nowValue(clock);
    const content = String(source || "");
    return {
      id: String(id),
      signature: String(signature),
      language: String(language),
      title: String(title),
      source: content,
      version: 1,
      revisions: [{ version: 1, source: content, createdAt: timestamp, note: "Generated" }],
      createdAt: timestamp,
      updatedAt: timestamp
    };
  }

  function saveRevision(artifact, source, note = "Edited in canvas", clock = Date.now) {
    const content = String(source ?? artifact.source);
    if (content === artifact.source) return artifact;
    const timestamp = nowValue(clock);
    const version = Number(artifact.version || 1) + 1;
    return {
      ...artifact,
      source: content,
      version,
      updatedAt: timestamp,
      revisions: [
        ...(Array.isArray(artifact.revisions) ? artifact.revisions : []),
        { version, source: content, createdAt: timestamp, note: String(note) }
      ]
    };
  }

  function restoreRevision(artifact, targetVersion, clock = Date.now) {
    const revision = (artifact.revisions || []).find(
      (entry) => Number(entry.version) === Number(targetVersion)
    );
    if (!revision || revision.source === artifact.source) return artifact;
    return saveRevision(artifact, revision.source, `Restored from version ${targetVersion}`, clock);
  }

  function upsert(collection, artifact) {
    const list = Array.isArray(collection) ? collection : [];
    const index = list.findIndex((item) => item.id === artifact.id);
    if (index < 0) return [...list, artifact];
    return list.map((item, itemIndex) => itemIndex === index ? artifact : item);
  }

  function remove(collection, artifactId) {
    return (Array.isArray(collection) ? collection : []).filter((artifact) => artifact.id !== artifactId);
  }

  globalThis.VelaArtifactStore = Object.freeze({
    migrate,
    create,
    saveRevision,
    restoreRevision,
    upsert,
    remove
  });
})();
