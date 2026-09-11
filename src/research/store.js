(() => {
  "use strict";

  const VERSION = 1;
  const STATUSES = Object.freeze(["idle", "searching", "synthesizing", "complete", "error"]);

  function sourceId(source) {
    const value = String(source.url || source.title || "source").trim().toLowerCase();
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `source-${(hash >>> 0).toString(36)}`;
  }

  function normalizeSource(source, index = 0, clock = Date.now) {
    const url = String(source?.url || "").trim();
    let host = String(source?.host || "").replace(/^www\./, "");
    if (!host && url) {
      try { host = new URL(url).hostname.replace(/^www\./, ""); } catch {}
    }
    return {
      id: String(source?.id || sourceId(source || {})),
      index: Number(source?.index) || index + 1,
      title: String(source?.title || `Source ${index + 1}`).trim(),
      url,
      host,
      favicon: String(source?.favicon || ""),
      excerpt: String(source?.excerpt || source?.snippet || "").replace(/\s+/g, " ").trim().slice(0, 600),
      author: String(source?.author || ""),
      publishedAt: String(source?.publishedAt || ""),
      accessedAt: String(source?.accessedAt || new Date(Number(clock())).toISOString()),
      saved: source?.saved !== false
    };
  }

  function empty() {
    return { version: VERSION, status: "idle", query: "", queries: [], sources: [], notes: "", draft: "", error: "", updatedAt: 0 };
  }

  function normalize(value, clock = Date.now) {
    const input = value && typeof value === "object" ? value : {};
    const seen = new Set();
    const sources = (Array.isArray(input.sources) ? input.sources : [])
      .map((source, index) => normalizeSource(source, index, clock))
      .filter((source) => source.url || source.title)
      .filter((source) => {
        if (seen.has(source.id)) return false;
        seen.add(source.id);
        return true;
      });
    return {
      version: VERSION,
      status: STATUSES.includes(input.status) ? input.status : "idle",
      query: String(input.query || ""),
      queries: [...new Set((Array.isArray(input.queries) ? input.queries : []).map(String).filter(Boolean))].slice(-25),
      sources,
      notes: String(input.notes || ""),
      draft: String(input.draft || ""),
      error: String(input.error || ""),
      updatedAt: Number(input.updatedAt) || 0
    };
  }

  function mergeSources(research, sources, query = "", clock = Date.now) {
    const current = normalize(research, clock);
    const map = new Map(current.sources.map((source) => [source.id, source]));
    (Array.isArray(sources) ? sources : []).forEach((source, index) => {
      const normalized = normalizeSource(source, index, clock);
      map.set(normalized.id, { ...map.get(normalized.id), ...normalized, saved: map.get(normalized.id)?.saved ?? true });
    });
    return normalize({
      ...current,
      query: query || current.query,
      queries: query ? [...current.queries, query] : current.queries,
      sources: [...map.values()],
      status: "synthesizing",
      error: "",
      updatedAt: Number(clock())
    }, clock);
  }

  function update(research, patch, clock = Date.now) {
    return normalize({ ...normalize(research, clock), ...patch, updatedAt: Number(clock()) }, clock);
  }

  function bibliography(research) {
    return normalize(research).sources.filter((source) => source.saved).map((source, index) => {
      const author = source.author ? `${source.author}. ` : "";
      const published = source.publishedAt ? ` (${source.publishedAt}).` : "";
      return `${index + 1}. ${author}${source.title}.${published} ${source.url} (accessed ${source.accessedAt.slice(0, 10)}).`;
    }).join("\n");
  }

  globalThis.VelaResearchStore = Object.freeze({ VERSION, STATUSES, sourceId, normalizeSource, empty, normalize, mergeSources, update, bibliography });
})();
