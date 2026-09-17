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
    const files = (Array.isArray(input.files) ? input.files : []).filter(Boolean).map(normalizeFile).filter((file) => {
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
      logs: (Array.isArray(input.logs) ? input.logs : []).slice(-100).filter(Boolean).map((entry) => ({ level: String(entry?.level || "info"), message: String(entry?.message || ""), timestamp: Number(entry?.timestamp) || Date.now() })),
      patch: input.patch && Array.isArray(input.patch.files) ? { id: String(input.patch.id || "patch"), note: String(input.patch.note || "Proposed changes"), files: (Array.isArray(input.patch.files) ? input.patch.files : []).map(normalizeFile), createdAt: Number(input.patch.createdAt) || Date.now() } : null,
      revisions: (Array.isArray(input.revisions) ? input.revisions : []).filter(Boolean).map((revision, index) => ({ version: Number(revision?.version) || index + 1, files: (Array.isArray(revision?.files) ? revision.files : []).map(normalizeFile), note: String(revision?.note || "Saved files"), createdAt: Number(revision?.createdAt) || Date.now() })),
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

  const SEARCH_REPLACE_REGEX = /<{5,9}\s*SEARCH\s*\r?\n([\s\S]*?)\r?\n={5,9}\s*\r?\n([\s\S]*?)\r?\n>{5,9}/g;

  function parseHunks(text) {
    const hunks = [];
    const source = String(text || "");
    let match;
    const regex = new RegExp(SEARCH_REPLACE_REGEX.source, "g");
    while ((match = regex.exec(source))) {
      hunks.push({
        search: match[1],
        replace: match[2]
      });
    }
    return hunks;
  }

  function parseEdits(markdown, defaultPath = "") {
    const edits = [];
    const text = String(markdown || "");

    const fenceRegex = /```(?:edit|update|patch|diff)\b([^\n]*)\n([\s\S]*?)```/gi;
    let match;
    while ((match = fenceRegex.exec(text))) {
      const header = match[1].trim();
      const content = match[2];
      const hunks = parseHunks(content);

      let path = "";
      const pathMatch = header.match(/(?:path|file|name)=["']?([^"'\s]+)["']?/i) || header.match(/^([^\s]+)/);
      if (pathMatch && !["diff", "patch", "edit", "update"].includes(pathMatch[1].toLowerCase())) {
        path = pathMatch[1];
      }
      if (!path) {
        const fileLineMatch = content.match(/^(?:---|\+\+\+|File:|#\s*file:)\s*(?:[ab]\/)?([^\s\n]+)/m);
        if (fileLineMatch) path = fileLineMatch[1];
      }
      if (!path) path = defaultPath;

      if (hunks.length > 0) {
        edits.push({ path: path ? cleanPath(path) : "", hunks, raw: match[0], language: "diff" });
      }
    }

    if (edits.length === 0) {
      const bareHunks = parseHunks(text);
      if (bareHunks.length > 0) {
        let path = defaultPath;
        const beforeFirst = text.slice(0, text.indexOf("<<<<<<< SEARCH"));
        const mention = beforeFirst.match(/(?:in|update|patch|edit|file)\s+[`"']?([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)[`"']?/i);
        if (mention) path = mention[1];
        edits.push({ path: path ? cleanPath(path) : "", hunks: bareHunks, raw: "", language: "diff" });
      }
    }

    return edits;
  }

  function applyHunks(originalContent, hunks) {
    let content = String(originalContent ?? "");
    let appliedCount = 0;
    const failures = [];

    for (let i = 0; i < (hunks || []).length; i++) {
      const hunk = hunks[i];
      const search = hunk.search;
      const replace = hunk.replace;

      if (!search && !replace) continue;

      // Pass 1: Exact substring match
      const exactIndex = content.indexOf(search);
      if (exactIndex !== -1) {
        content = content.slice(0, exactIndex) + replace + content.slice(exactIndex + search.length);
        appliedCount++;
        continue;
      }

      // Pass 2: Line ending normalization (\r\n -> \n)
      const normContent = content.replace(/\r\n/g, "\n");
      const normSearch = search.replace(/\r\n/g, "\n");
      const normReplace = replace.replace(/\r\n/g, "\n");
      const normIndex = normContent.indexOf(normSearch);
      if (normIndex !== -1) {
        content = normContent.slice(0, normIndex) + normReplace + normContent.slice(normIndex + normSearch.length);
        appliedCount++;
        continue;
      }

      // Pass 3: Whitespace-tolerant line-by-line matching
      const contentLines = content.split(/\r?\n/);
      const searchLines = normSearch.split("\n");
      let matchedLineIndex = -1;

      for (let line = 0; line <= contentLines.length - searchLines.length; line++) {
        let match = true;
        for (let s = 0; s < searchLines.length; s++) {
          if (contentLines[line + s].trimEnd() !== searchLines[s].trimEnd()) {
            match = false;
            break;
          }
        }
        if (match) {
          matchedLineIndex = line;
          break;
        }
      }

      if (matchedLineIndex !== -1) {
        const replaceLines = normReplace.split("\n");
        contentLines.splice(matchedLineIndex, searchLines.length, ...replaceLines);
        content = contentLines.join("\n");
        appliedCount++;
        continue;
      }

      failures.push({ hunkIndex: i, search });
    }

    return {
      success: appliedCount > 0,
      content,
      appliedCount,
      failures
    };
  }

  function applyTargetedEdits(workspace, editBlocks, defaultPath = "", clock = Date.now) {
    let resolvedClock = clock;
    let resolvedDefaultPath = typeof defaultPath === "string" ? defaultPath : "";
    if (typeof defaultPath === "function") {
      resolvedClock = defaultPath;
      resolvedDefaultPath = "";
    }
    const current = normalize(workspace);
    const incomingFiles = [];
    const notes = [];

    const blocks = Array.isArray(editBlocks) ? editBlocks : parseEdits(String(editBlocks || ""), resolvedDefaultPath);

    for (const edit of blocks) {
      const targetPath = edit.path ? cleanPath(edit.path) : "";
      let targetFile = current.files.find((f) => f.path === targetPath);
      if (!targetFile && targetPath) {
        targetFile = current.files.find((f) => f.path.endsWith(`/${targetPath}`) || targetPath.endsWith(`/${f.path}`));
      }
      if (!targetFile && current.activeFileId) {
        targetFile = current.files.find((f) => f.id === current.activeFileId);
      }
      if (!targetFile && current.files.length > 0) {
        targetFile = current.files[0];
      }

      if (targetFile) {
        const result = applyHunks(targetFile.content, edit.hunks);
        if (result.success) {
          incomingFiles.push({
            path: targetFile.path,
            language: targetFile.language,
            content: result.content
          });
          notes.push(`Updated ${targetFile.path} (${result.appliedCount} edit${result.appliedCount === 1 ? "" : "s"})`);
        }
      } else if (edit.path) {
        const initialContent = edit.hunks.map((h) => h.replace).join("\n");
        const language = String(edit.path.split(".").pop() || "text");
        incomingFiles.push({
          path: edit.path,
          language,
          content: initialContent
        });
        notes.push(`Created ${edit.path}`);
      }
    }

    if (incomingFiles.length === 0) return current;
    return mergeFiles(current, incomingFiles, notes.join(", "), resolvedClock);
  }

  globalThis.VelaCodeWorkspace = Object.freeze({
    VERSION,
    EXECUTION_POLICIES,
    cleanPath,
    fileId,
    normalizeFile,
    diagnoseFile,
    empty,
    normalize,
    update,
    saveFile,
    mergeFiles,
    propose,
    acceptPatch,
    rejectPatch,
    policy,
    parseHunks,
    parseEdits,
    applyHunks,
    applyTargetedEdits
  });
})();
