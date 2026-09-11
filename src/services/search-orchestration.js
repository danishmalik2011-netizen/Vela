(() => {
  "use strict";

  const FRESH_TERMS = /\b(today|tonight|right now|currently|current|latest|recently|news|breaking|this week|this month|this year|yesterday|tomorrow|weather|price|prices|stock|stocks|score|won|champion|release|released|update|updated|announce|announced|election|rate|rates|deadline|schedule|202[0-9]|who won|what happened)\b/i;
  const NOISE_TERMS = /\b(as of|please|identify|tell me|show me|find|search for|look up|verify|exact|using|both|official|primary|source|reputable|independent|compare|conflicting|claims|cite|every|factual|statement|numbered|citations?|finish|concise|table|do not rely|prior knowledge|use current|web sources?|most significant|three)\b/gi;

  function needsWebSearch(message) {
    return FRESH_TERMS.test(String(message || ""));
  }

  function planQuery(message, year = new Date().getFullYear()) {
    const raw = String(message || "").replace(/\s+/g, " ").trim();
    const normalized = raw
      .replace(NOISE_TERMS, " ")
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
    const terms = normalized.split(" ").filter(Boolean).slice(0, 20).join(" ");
    const timeHint = needsWebSearch(raw) ? ` latest ${year}` : "";
    return `${terms || raw.slice(0, 180)}${timeHint}`.trim().slice(0, 240);
  }

  function safeHttpUrl(value) {
    try {
      const url = new URL(String(value || ""));
      return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
    } catch {
      return "";
    }
  }

  function normalizeSources(results, clock = Date.now) {
    return (Array.isArray(results) ? results : []).map((result, index) => {
      const url = safeHttpUrl(result?.url);
      let host = String(result?.host || "").replace(/^www\./, "");
      if (!host && url) {
        try { host = new URL(url).hostname.replace(/^www\./, ""); } catch {}
      }
      return {
        index: index + 1,
        title: String(result?.title || `Source ${index + 1}`).replace(/\s+/g, " ").trim().slice(0, 300),
        url,
        host,
        favicon: safeHttpUrl(result?.favicon),
        excerpt: String(result?.excerpt || result?.snippet || "").replace(/\s+/g, " ").trim().slice(0, 220),
        publishedAt: String(result?.publishedAt || "").trim(),
        accessedAt: new Date(Number(clock())).toISOString()
      };
    }).filter((source) => source.url);
  }

  function xmlText(value) {
    return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }

  function buildContext(searchData) {
    const results = Array.isArray(searchData?.results) ? searchData.results : [];
    if (!results.length) return "";
    const sources = results.map((result, index) => {
      const title = String(result?.title || `Source ${index + 1}`).replace(/\s+/g, " ").trim();
      const url = safeHttpUrl(result?.url);
      const snippet = String(result?.snippet || "").replace(/\s+/g, " ").trim();
      const publishedAt = String(result?.publishedAt || "").trim();
      const page = result?.text ? `Page extract: ${String(result.text).replace(/\s+/g, " ").slice(0, 1200)}` : "";
      return [
        `[${index + 1}] ${xmlText(title)}`,
        `URL: ${xmlText(url)}`,
        publishedAt ? `Published: ${xmlText(publishedAt)}` : "",
        snippet ? `Snippet: ${xmlText(snippet)}` : "",
        page ? xmlText(page) : ""
      ].filter(Boolean).join("\n");
    }).join("\n\n");
    const query = xmlText(searchData?.query || "");
    const searchedAt = xmlText(searchData?.searchedAt || new Date().toISOString());
    return `\n\n<live_web_search query="${query}" searched_at="${searchedAt}">\n${sources}\n</live_web_search>`;
  }

  function shouldSearch(message, explicit = false) {
    return Boolean(explicit || needsWebSearch(message));
  }

  globalThis.VelaSearchOrchestration = Object.freeze({ needsWebSearch, planQuery, safeHttpUrl, normalizeSources, buildContext, shouldSearch });
})();
