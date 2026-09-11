(() => {
  "use strict";

  function collect(storage, { indexKey, prefix, artifactStore, projects = [] }) {
    let index;
    try { index = JSON.parse(storage.getItem(indexKey) || "[]"); } catch { index = []; }
    const projectMap = new Map((Array.isArray(projects) ? projects : []).map((project) => [project.id, project.name]));
    const results = [];

    for (const entry of Array.isArray(index) ? index : []) {
      if (!entry?.id) continue;
      let record;
      try { record = JSON.parse(storage.getItem(`${prefix}${entry.id}`) || "null"); } catch { record = null; }
      if (!record) continue;
      const artifacts = artifactStore?.migrate(record.artifacts) || [];
      for (const artifact of artifacts) {
        results.push({
          ...artifact,
          conversationId: entry.id,
          conversationTitle: record.title || entry.title || "Untitled conversation",
          projectId: record.projectId || entry.projectId || "",
          projectName: projectMap.get(record.projectId || entry.projectId || "") || "No project"
        });
      }
    }

    return results.sort((left, right) => Number(right.updatedAt) - Number(left.updatedAt));
  }

  function filter(artifacts, { query = "", projectId = "", language = "" } = {}) {
    const needle = String(query).trim().toLowerCase();
    return (Array.isArray(artifacts) ? artifacts : []).filter((artifact) => {
      if (projectId && artifact.projectId !== projectId) return false;
      if (language && artifact.language !== language) return false;
      if (!needle) return true;
      return [artifact.title, artifact.language, artifact.source, artifact.conversationTitle, artifact.projectName]
        .some((value) => String(value || "").toLowerCase().includes(needle));
    });
  }

  function locate(artifacts, artifactId, conversationId = "") {
    return (Array.isArray(artifacts) ? artifacts : []).find((artifact) =>
      artifact.id === artifactId && (!conversationId || artifact.conversationId === conversationId)
    ) || null;
  }

  globalThis.VelaGlobalLibrary = Object.freeze({ collect, filter, locate });
})();
