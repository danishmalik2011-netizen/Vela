(() => {
  "use strict";

  const VERSION = 1;

  function parse(value, fallback) {
    try { return JSON.parse(value) ?? fallback; } catch { return fallback; }
  }

  function normalize(projects) {
    const seen = new Set();
    return (Array.isArray(projects) ? projects : [])
      .filter((project) => project?.id && typeof project.name === "string")
      .filter((project) => {
        if (seen.has(project.id)) return false;
        seen.add(project.id);
        return true;
      })
      .map((project) => ({
        id: String(project.id),
        name: project.name.trim() || "Untitled project",
        instructions: String(project.instructions || ""),
        archived: Boolean(project.archived),
        createdAt: Number(project.createdAt) || Date.now(),
        updatedAt: Number(project.updatedAt) || Number(project.createdAt) || Date.now()
      }))
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  function read(storage, key) {
    const value = parse(storage.getItem(key) || "null", null);
    return normalize(Array.isArray(value) ? value : value?.projects);
  }

  function write(storage, key, projects) {
    const normalized = normalize(projects);
    storage.setItem(key, JSON.stringify({ version: VERSION, projects: normalized }));
    return normalized;
  }

  function create(projects, name, id, clock = Date.now) {
    const cleanName = String(name || "").trim();
    if (!cleanName) throw new Error("Project name is required.");
    const timestamp = Number(clock());
    return normalize([
      {
        id: String(id),
        name: cleanName.slice(0, 80),
        instructions: "",
        archived: false,
        createdAt: timestamp,
        updatedAt: timestamp
      },
      ...(Array.isArray(projects) ? projects : [])
    ]);
  }

  function update(projects, projectId, patch, clock = Date.now) {
    return normalize((Array.isArray(projects) ? projects : []).map((project) =>
      project.id === projectId
        ? { ...project, ...patch, id: project.id, updatedAt: Number(clock()) }
        : project
    ));
  }

  function remove(projects, projectId) {
    return normalize((Array.isArray(projects) ? projects : []).filter((project) => project.id !== projectId));
  }

  function get(projects, projectId) {
    return (Array.isArray(projects) ? projects : []).find((project) => project.id === projectId) || null;
  }

  globalThis.VelaProjectStore = Object.freeze({ VERSION, normalize, read, write, create, update, remove, get });
})();
