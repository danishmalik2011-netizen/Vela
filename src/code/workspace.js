(() => {
  "use strict";

  const VERSION = 1;
  const EXECUTION_POLICIES = Object.freeze({
    html: "sandboxed-preview",
    svg: "sanitized-preview",
    markdown: "sanitized-preview",
    javascript: "disabled",
    js: "disabled",
    python: "disabled",
    css: "disabled",
    json: "disabled"
  });

  function cleanPath(path, language = "text", index = 0) {
    const fallback = `file-${index + 1}.${({ javascript: "js", js: "js", python: "py", markdown: "md" })[language] || language || "txt"}`;
    const value = String(path || fallback).replace(/\\/g, "/").replace(/^\/+/, "");
    if (!value || value.includes("..") || value.includes("\0")) return fallback;
    return value.slice(0, 180);
  }

  function fileId(path) {
    let hash = 2166136261;
    for (const character of String(path)) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return `file-${(hash >>> 0).toString(36)}`;
  }

  function normalizeFile(file, index = 0) {
    const language = String(file?.language || "text").toLowerCase();
    const path = cleanPath(file?.path, language, index);
    return {
      id: String(file?.id || fileId(path)),
      path,
      language,
      content: String(file?.content ?? file?.source ?? ""),
      version: Number(file?.version) || 1,
      updatedAt: Number(file?.updatedAt) || Date.now()
    };
  }

  function diagnoseFile(file) {
    const diagnostics = [];
    const content = file.content;
    if (["json"].includes(file.language)) {
      try { JSON.parse(content); } catch (error) {
        diagnostics.push({ severity: "error", fileId: file.id, path: file.path, message: `Invalid JSON: ${error.message}` });
      }
    }
    if (["javascript", "js"].includes(file.language)) {
      const openings = (content.match(/[({[]/g) || []).length;
      const closings = (content.match(/[)}\]]/g) || []).length;
      if (openings !== closings) diagnostics.push({ severity: "warning", fileId: file.id, path: file.path, message: "Unbalanced delimiters detected; execution remains disabled." });
      if (/\beval\s*\(|new\s+Function\s*\(/.test(content)) diagnostics.push({ severity: "warning", fileId: file.id, path: file.path, message: "Dynamic code execution detected and will not run in Vela." });
    }
    if (file.language === "html" && !/<!doctype|<html|<body|<[a-z][^>]*>/i.test(content)) {
      diagnostics.push({ severity: "info", fileId: file.id, path: file.path, message: "HTML file has no recognizable markup." });
    }
    return diagnostics;
  }

  function empty() {
    return { version: VERSION, files: [], activeFileId: "", diagnostics: [], logs: [], patch: null, revisions: [], updatedAt: 0 };
  }

  function normalize(value) {
    const input = value && typeof value === "object" ? value : {};
    const seen = new Set();
    const files = (Array.isArray(input.files) ? input.files : []).map(normalizeFile).filter((file) => {
      if (seen.has(file.path)) return false;
      seen.add(file.path);
      return true;
    });
    const activeFileId = files.some((file) => file.id === input.activeFileId) ? input.activeFileId : files[0]?.id || "";
    return {
      version: VERSION,
      files,
      activeFileId,
      diagnostics: files.flatMap(diagnoseFile),
      logs: (Array.isArray(input.logs) ? input.logs : []).slice(-100).map((entry) => ({ level: String(entry.level || "info"), message: String(entry.message || ""), timestamp: Number(entry.timestamp) || Date.now() })),
      patch: input.patch && Array.isArray(input.patch.files) ? { id: String(input.patch.id || "patch"), note: String(input.patch.note || "Proposed changes"), files: input.patch.files.map(normalizeFile), createdAt: Number(input.patch.createdAt) || Date.now() } : null,
      revisions: (Array.isArray(input.revisions) ? input.revisions : []).map((revision, index) => ({ version: Number(revision.version) || index + 1, files: (revision.files || []).map(normalizeFile), note: String(revision.note || "Saved files"), createdAt: Number(revision.createdAt) || Date.now() })),
      updatedAt: Number(input.updatedAt) || 0
    };
  }

  function update(workspace, patch, clock = Date.now) {
    return normalize({ ...normalize(workspace), ...patch, updatedAt: Number(clock()) });
  }

  function saveFile(workspace, fileIdValue, content, clock = Date.now) {
    const current = normalize(workspace);
    const files = current.files.map((file) => file.id === fileIdValue ? { ...file, content: String(content), version: file.version + 1, updatedAt: Number(clock()) } : file);
    if (files.every((file, index) => file.content === current.files[index]?.content)) return current;
    return update(current, { files, revisions: [...current.revisions, { version: current.revisions.length + 1, files, note: `Saved ${files.find((file) => file.id === fileIdValue)?.path || "file"}`, createdAt: Number(clock()) }] }, clock);
  }

  function mergeFiles(workspace, incoming, note = "Generated from conversation", clock = Date.now) {
    const current = normalize(workspace);
    const map = new Map(current.files.map((file) => [file.path, file]));
    (Array.isArray(incoming) ? incoming : []).map(normalizeFile).forEach((file) => map.set(file.path, { ...map.get(file.path), ...file, version: (map.get(file.path)?.version || 0) + 1, updatedAt: Number(clock()) }));
    const files = [...map.values()];
    return update(current, { files, activeFileId: files[0]?.id || "", revisions: [...current.revisions, { version: current.revisions.length + 1, files, note, createdAt: Number(clock()) }], logs: [...current.logs, { level: "info", message: `${incoming.length} file(s) added; executable languages were not run.`, timestamp: Number(clock()) }] }, clock);
  }

  function propose(workspace, files, note = "Proposed patch", clock = Date.now) {
    return update(workspace, { patch: { id: `patch-${Number(clock()).toString(36)}`, note, files: (files || []).map(normalizeFile), createdAt: Number(clock()) } }, clock);
  }

  function acceptPatch(workspace, clock = Date.now) {
    const current = normalize(workspace);
    if (!current.patch) return current;
    return update(mergeFiles(current, current.patch.files, `Accepted: ${current.patch.note}`, clock), { patch: null }, clock);
  }

  function rejectPatch(workspace, clock = Date.now) {
    return update(workspace, { patch: null, logs: [...normalize(workspace).logs, { level: "info", message: "Patch rejected; files unchanged.", timestamp: Number(clock()) }] }, clock);
  }

  function policy(language) {
    return EXECUTION_POLICIES[String(language || "").toLowerCase()] || "disabled";
  }

  globalThis.VelaCodeWorkspace = Object.freeze({ VERSION, EXECUTION_POLICIES, cleanPath, fileId, normalizeFile, diagnoseFile, empty, normalize, update, saveFile, mergeFiles, propose, acceptPatch, rejectPatch, policy });
})();
