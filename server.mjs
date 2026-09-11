import http from "node:http";
import { readFile } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, normalize, relative, resolve } from "node:path";
import net from "node:net";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(currentDirectory, "component.html");
const faviconPath = join(currentDirectory, "favicon.svg");
const publicSourceDirectory = join(currentDirectory, "src");
const port = Number.parseInt(process.env.PORT || "3000", 10);
const host = process.env.HOST || "127.0.0.1";

const MAX_REQUEST_BYTES = 30 * 1024 * 1024;
const MODEL_TIMEOUT_MS = 45_000;
const CHAT_TIMEOUT_MS = 5 * 60_000;
const SEARCH_TIMEOUT_MS = 15_000;
const MAX_SEARCH_QUERY_LENGTH = 500;
const MAX_SEARCH_RESULTS = 12;
const MAX_RESULTS_PER_QUERY = 8;
const MAX_SEARCH_QUERIES = 5;
const SEARCH_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36";

function sendJson(response, status, body) {
  const serialized = JSON.stringify(body);

  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(serialized),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });

  response.end(serialized);
}

function isPrivateIPv4(address) {
  const parts = address.split(".").map(Number);

  if (parts.length !== 4 || parts.some(Number.isNaN)) {
    return true;
  }

  const [first, second] = parts;

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
}

function isPrivateIPv6(address) {
  const normalized = address.toLowerCase();

  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.") ||
    /^::ffff:172\.(1[6-9]|2\d|3[01])\./.test(normalized)
  );
}

function isPrivateAddress(address) {
  const family = net.isIP(address);

  if (family === 4) return isPrivateIPv4(address);
  if (family === 6) return isPrivateIPv6(address);
  return true;
}

async function validateTarget(rawEndpoint) {
  let endpoint;

  try {
    endpoint = new URL(rawEndpoint);
  } catch {
    throw new Error("The provider endpoint is not a valid URL.");
  }

  if (!["https:", "http:"].includes(endpoint.protocol)) {
    throw new Error("Only HTTP and HTTPS provider endpoints are supported.");
  }

  if (endpoint.username || endpoint.password) {
    throw new Error("Provider URLs cannot contain embedded credentials.");
  }

  const hostname = endpoint.hostname.toLowerCase();

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  ) {
    throw new Error("Local network provider endpoints are not allowed.");
  }

  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new Error("Private network provider endpoints are not allowed.");
    }

    return endpoint;
  }

  let addresses;

  try {
    addresses = await lookup(hostname, {
      all: true,
      verbatim: true
    });
  } catch {
    throw new Error("The provider hostname could not be resolved.");
  }

  if (
    !addresses.length ||
    addresses.some(({ address }) => isPrivateAddress(address))
  ) {
    throw new Error("The provider resolves to a private network address.");
  }

  return endpoint;
}

async function readJsonRequest(request) {
  const chunks = [];
  let receivedBytes = 0;

  for await (const chunk of request) {
    receivedBytes += chunk.length;

    if (receivedBytes > MAX_REQUEST_BYTES) {
      const error = new Error("The request is too large.");
      error.status = 413;
      throw error;
    }

    chunks.push(chunk);
  }

  if (!chunks.length) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("The request body must be valid JSON.");
    error.status = 400;
    throw error;
  }
}

function validateProxyPayload(payload, requireRequestBody = false) {
  const provider = String(payload.provider || "custom");
  const format = String(payload.format || "openai-chat");
  const endpoint = String(payload.endpoint || "").trim();
  const apiKey = String(payload.apiKey || "").trim();

  if (!endpoint) {
    throw new Error("A provider endpoint is required.");
  }

  if (!apiKey) {
    throw new Error("A provider API key is required.");
  }

  if (apiKey.length > 16_384) {
    throw new Error("The provider API key is invalid.");
  }

  if (
    ![
      "openai-chat",
      "openai-responses",
      "anthropic-messages"
    ].includes(format)
  ) {
    throw new Error("The selected provider format is unsupported.");
  }

  if (
    requireRequestBody &&
    (!payload.requestBody ||
      typeof payload.requestBody !== "object" ||
      Array.isArray(payload.requestBody))
  ) {
    throw new Error("A provider request body is required.");
  }

  return {
    provider,
    format,
    endpoint,
    apiKey,
    requestBody: payload.requestBody
  };
}

function createUpstreamHeaders(config, isModelRequest = false) {
  const headers = {
    Accept: isModelRequest
      ? "application/json"
      : "application/json, text/event-stream",
    "Content-Type": "application/json"
  };

  if (config.format === "anthropic-messages") {
    headers["x-api-key"] = config.apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  if (config.provider === "openrouter") {
    headers["HTTP-Referer"] =
      process.env.PUBLIC_APP_URL || `http://${host}:${port}`;
    headers["X-Title"] = "Vela";
  }

  return headers;
}

async function proxyModels(request, response) {
  const payload = await readJsonRequest(request);
  const config = validateProxyPayload(payload);
  const endpoint = await validateTarget(config.endpoint);

  const upstream = await fetch(endpoint, {
    method: "GET",
    headers: createUpstreamHeaders(config, true),
    redirect: "error",
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS)
  });

  const responseText = await upstream.text();

  response.writeHead(upstream.status, {
    "Content-Type":
      upstream.headers.get("content-type") ||
      "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });

  response.end(responseText);
}

async function proxyChat(request, response) {
  const payload = await readJsonRequest(request);
  const config = validateProxyPayload(payload, true);
  const endpoint = await validateTarget(config.endpoint);

  let body = config.requestBody;
  let upstream = await fetch(endpoint, {
    method: "POST",
    headers: createUpstreamHeaders(config),
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(CHAT_TIMEOUT_MS)
  });

  // Some models reject a large max_tokens/max_output_tokens. Retry once
  // with a provider-safe value instead of failing the whole generation.
  if (
    upstream.status === 400 &&
    (Number(body?.max_tokens) > 8192 || Number(body?.max_output_tokens) > 8192)
  ) {
    const errorText = await upstream.text().catch(() => "");
    if (/max_tokens|max_output_tokens/i.test(errorText)) {
      const retryBody = { ...body };
      if (Number(retryBody.max_tokens) > 8192) retryBody.max_tokens = 8192;
      if (Number(retryBody.max_output_tokens) > 8192) retryBody.max_output_tokens = 8192;
      upstream = await fetch(endpoint, {
        method: "POST",
        headers: createUpstreamHeaders(config),
        body: JSON.stringify(retryBody),
        redirect: "error",
        signal: AbortSignal.timeout(CHAT_TIMEOUT_MS)
      });
    } else {
      upstream = new Response(errorText, {
        status: upstream.status,
        headers: { "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8" }
      });
    }
  }

  response.writeHead(upstream.status, {
    "Content-Type":
      upstream.headers.get("content-type") ||
      "application/json; charset=utf-8",
    "Cache-Control": "no-store, no-transform",
    "X-Accel-Buffering": "no",
    "X-Content-Type-Options": "nosniff"
  });

  if (!upstream.body) {
    response.end();
    return;
  }

  const reader = upstream.body.getReader();

  request.on("close", () => {
    reader.cancel().catch(() => {});
  });

  try {
    while (true) {
      const { value, done } = await reader.read();

      if (done) break;

      if (!response.write(Buffer.from(value))) {
        await new Promise((resolve) => {
          response.once("drain", resolve);
        });
      }
    }
  } finally {
    response.end();
  }
}

function decodeXml(value) {
  const entities = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    quot: '"'
  };

  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (match, code) => {
      const radix = code[0].toLowerCase() === "x" ? 16 : 10;
      const value = Number.parseInt(radix === 16 ? code.slice(1) : code, radix);
      return Number.isFinite(value) ? String.fromCodePoint(value) : match;
    })
    .replace(/&([a-z]+);/gi, (match, name) =>
      Object.hasOwn(entities, name.toLowerCase())
        ? entities[name.toLowerCase()]
        : match
    );
}

function readXmlTag(xml, tagName) {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(xml || "").match(
    new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i")
  );

  return match ? decodeXml(match[1]).trim() : "";
}

function parseSearchFeed(xml) {
  return [...String(xml || "").matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)]
    .slice(0, MAX_RESULTS_PER_QUERY)
    .map((match) => ({
      title: readXmlTag(match[1], "title"),
      url: readXmlTag(match[1], "link"),
      snippet: readXmlTag(match[1], "description"),
      publishedAt: readXmlTag(match[1], "pubDate")
    }))
    .filter((result) => result.title && /^https?:\/\//i.test(result.url));
}

function stripHtml(value) {
  return decodeXml(
    String(value || "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function parseBraveResults(html) {
  const source = String(html || "");
  const starts = [...source.matchAll(
    /<div class="snippet[^>]*data-pos="\d+"[^>]*data-type="web"[^>]*>/gi
  )];
  const results = [];

  starts.forEach((match, index) => {
    const start = match.index + match[0].length;
    const end = starts[index + 1]?.index || source.length;
    const fragment = source.slice(start, end);
    const link = fragment.match(
      /<a\s+href="(https?:\/\/[^"#]+)"[^>]*class="[^"]*\bl1\b[^"]*"[^>]*>/i
    );
    const title = fragment.match(
      /<div class="title search-snippet-title[^>]*>([\s\S]*?)<\/div>/i
    );
    const snippet = fragment.match(
      /<div class="content desktop-default-regular[^>]*>([\s\S]*?)<\/div>/i
    );

    if (!link || !title) return;

    results.push({
      title: stripHtml(title[1]),
      url: decodeXml(link[1]),
      snippet: snippet ? stripHtml(snippet[1]) : "",
      publishedAt: ""
    });
  });

  return results
    .filter((result) => result.title && result.url)
    .slice(0, MAX_RESULTS_PER_QUERY);
}

function normalizeSearchText(value) {
  return stripHtml(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function planSearchQueries(query) {
  const clean = String(query || "").replace(/\s+/g, " ").trim();
  const year = clean.match(/\b20\d{2}\b/)?.[0] || String(new Date().getFullYear());
  const aiRelease = /\b(ai|artificial intelligence|model|llm|product)\b/i.test(clean) &&
    /\b(announce|announcement|release|released|launch|latest|news)\b/i.test(clean);

  if (aiRelease) {
    return [
      `AI model product announcements releases ${year}`,
      `site:openai.com OR site:anthropic.com OR site:blog.google AI model release ${year}`,
      `site:ai.meta.com OR site:mistral.ai OR site:deepmind.google model announcement ${year}`,
      `Reuters AI model product launch ${year}`,
      `TechCrunch OR The Verge AI model release announcement ${year}`
    ];
  }

  const base = clean.slice(0, MAX_SEARCH_QUERY_LENGTH);
  const queries = [base];
  if (looksLikeFreshQuery(clean)) {
    queries.push(`${base} news`, `${base} official`);
  }
  return [...new Set(queries)].slice(0, MAX_SEARCH_QUERIES);
}

function canonicalSearchUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|gclid|fbclid|ref|source)/i.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.pathname = url.pathname.replace(/\/$/, "") || "/";
    return url.toString();
  } catch {
    return String(value || "");
  }
}

function sourceQualityScore(result) {
  let host = "";
  try {
    host = new URL(result.url).hostname.replace(/^www\./, "");
  } catch {}

  const officialHosts = [
    "openai.com", "anthropic.com", "deepmind.google", "blog.google",
    "ai.google", "ai.meta.com", "mistral.ai", "cohere.com",
    "microsoft.com", "nvidia.com", "huggingface.co"
  ];
  const trustedNews = [
    "reuters.com", "apnews.com", "bloomberg.com", "theverge.com",
    "techcrunch.com", "arstechnica.com", "wired.com", "technologyreview.com"
  ];
  if (officialHosts.some((domain) => host === domain || host.endsWith(`.${domain}`))) return 35;
  if (trustedNews.some((domain) => host === domain || host.endsWith(`.${domain}`))) return 24;
  return 0;
}

function rankSearchResults(query, results) {
  const normalizedQuery = normalizeSearchText(query);
  const terms = normalizedQuery
    .split(" ")
    .filter((term) => term.length > 1);

  return results
    .map((result, index) => {
      const title = normalizeSearchText(result.title);
      const searchable = normalizeSearchText(
        `${result.title} ${result.snippet} ${result.url}`
      );
      let score = Math.max(0, MAX_RESULTS_PER_QUERY - (result.resultIndex ?? index));
      score += sourceQualityScore(result);
      if (result.queryIndex === 0) score += 3;

      if (normalizedQuery && title.includes(normalizedQuery)) score += 100;
      if (normalizedQuery && searchable.includes(normalizedQuery)) score += 45;

      for (const term of terms) {
        if (title.split(" ").includes(term)) score += 12;
        else if (searchable.includes(term)) score += 4;
      }

      return { ...result, score };
    })
    .sort((left, right) => right.score - left.score)
    .map(({ score, ...result }) => result);
}

async function fetchBraveResults(query) {
  const searchUrl = new URL("https://search.brave.com/search");
  searchUrl.searchParams.set("q", query);
  searchUrl.searchParams.set("source", "web");

  const upstream = await fetch(searchUrl, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": SEARCH_USER_AGENT
    },
    redirect: "error",
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS)
  });

  if (!upstream.ok) {
    throw new Error(`Brave search returned HTTP ${upstream.status}.`);
  }

  return parseBraveResults(await upstream.text());
}

async function fetchBingResults(query) {
  const searchUrl = new URL("https://www.bing.com/search");
  searchUrl.searchParams.set("format", "rss");
  searchUrl.searchParams.set("q", query);

  const upstream = await fetch(searchUrl, {
    headers: {
      Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8",
      "User-Agent": SEARCH_USER_AGENT
    },
    redirect: "error",
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS)
  });

  if (!upstream.ok) {
    throw new Error(`Bing search returned HTTP ${upstream.status}.`);
  }

  return parseSearchFeed(await upstream.text());
}

const MAX_EXTRACT_CHARS = 1600;
const MAX_EXTRACT_PAGES = 10;

function looksLikeFreshQuery(query) {
  return /\b(today|tonight|right now|currently|latest|current|news|breaking|recently|this week|this month|this year|weather|price|prices|stock|score|won|release|update|updates|announced|announce|election|rates?|deadline|schedule)\b/i.test(
    query
  );
}

function extractPageText(html) {
  return decodeXml(
    String(html || "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<(nav|header|footer|aside|form|iframe|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_EXTRACT_CHARS);
}

async function extractResultPages(results, query) {
  const top = results.slice(0, MAX_EXTRACT_PAGES);
  const extractions = await Promise.allSettled(
    top.map(async (result) => {
      try {
        const url = await validateTarget(result.url);
        const response = await fetch(url, {
          headers: {
            "User-Agent": SEARCH_USER_AGENT,
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "en-US,en;q=0.9"
          },
          redirect: "error",
          signal: AbortSignal.timeout(10_000)
        });
        if (!response.ok) return { text: "", excerpt: "" };
        const html = await response.text();
        const text = extractPageText(html);
        return { text, excerpt: text.slice(0, 420) };
      } catch {
        return { text: "", excerpt: "" };
      }
    })
  );

  return top.map((result, index) => {
    const extraction =
      extractions[index]?.status === "fulfilled"
        ? extractions[index].value
        : { text: "", excerpt: "" };

    return {
      ...result,
      ...extraction,
      host: (() => {
        try {
          return new URL(result.url).hostname.replace(/^www\./, "");
        } catch {
          return "";
        }
      })(),
      favicon: (() => {
        try {
          const { hostname } = new URL(result.url);
          return `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(hostname)}`;
        } catch {
          return "";
        }
      })()
    };
  });
}

async function searchWeb(request, response) {
  const payload = await readJsonRequest(request);
  const rawQuery = String(payload.query || "").replace(/\s+/g, " ").trim();
  const query = rawQuery.length > MAX_SEARCH_QUERY_LENGTH
    ? rawQuery
        .replace(/\b(please|identify|tell me|show me|find|search|verify|compare|cite|citations?|sources?|official|reputable|independent|finish|table|every|statement|claim|claims|using|current)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_SEARCH_QUERY_LENGTH)
    : rawQuery;

  if (!query) {
    const error = new Error("A search query is required.");
    error.status = 400;
    throw error;
  }

  if (query.length > MAX_SEARCH_QUERY_LENGTH) {
    const error = new Error("The search query could not be reduced to a searchable length.");
    error.status = 400;
    throw error;
  }

  const queries = planSearchQueries(query);
  const tasks = queries.flatMap((plannedQuery, queryIndex) => [
    fetchBraveResults(plannedQuery).then((results) =>
      results.map((result, resultIndex) => ({
        ...result,
        engine: "brave",
        queryIndex,
        resultIndex
      }))
    ),
    fetchBingResults(plannedQuery).then((results) =>
      results.map((result, resultIndex) => ({
        ...result,
        engine: "bing",
        queryIndex,
        resultIndex
      }))
    )
  ]);
  const settled = await Promise.allSettled(tasks);
  const batches = settled
    .filter((item) => item.status === "fulfilled")
    .map((item) => item.value);

  if (!batches.some((batch) => batch.length)) {
    const reason = settled.find((item) => item.status === "rejected")?.reason;
    throw new Error(reason?.message || "Web search returned no usable results.");
  }

  const seenUrls = new Set();
  const seenTitles = new Set();
  const merged = batches.flat().filter((result) => {
    if (!result.url) return false;
    const urlKey = canonicalSearchUrl(result.url);
    const titleKey = normalizeSearchText(result.title).slice(0, 100);
    if (seenUrls.has(urlKey) || (titleKey && seenTitles.has(titleKey))) return false;
    seenUrls.add(urlKey);
    if (titleKey) seenTitles.add(titleKey);
    result.url = urlKey;
    return true;
  });

  const rankedAll = rankSearchResults(query, merged);
  const selected = [];
  const hostCounts = new Map();
  for (const result of rankedAll) {
    let resultHost = "";
    try {
      resultHost = new URL(result.url).hostname.replace(/^www\./, "");
    } catch {}
    const count = hostCounts.get(resultHost) || 0;
    if (count >= 2) continue;
    selected.push(result);
    hostCounts.set(resultHost, count + 1);
    if (selected.length >= MAX_SEARCH_RESULTS) break;
  }
  const enriched = await extractResultPages(selected, query);

  sendJson(response, 200, {
    query,
    queries,
    provider: "brave+bing",
    routed: looksLikeFreshQuery(query),
    searchedAt: new Date().toISOString(),
    results: enriched.slice(0, MAX_SEARCH_RESULTS)
  });
}

async function serveApplication(response) {
  const html = await readFile(htmlPath);

  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": html.length,
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin"
  });

  response.end(html);
}

async function serveSourceModule(pathname, response) {
  const requested = pathname.slice("/src/".length);
  const filePath = resolve(publicSourceDirectory, normalize(requested));
  const relativePath = relative(publicSourceDirectory, filePath);

  if (
    !requested ||
    relativePath.startsWith("..") ||
    relativePath.includes(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    ![".js", ".css"].includes(extname(filePath).toLowerCase())
  ) {
    return false;
  }

  let body;
  try {
    body = await readFile(filePath);
  } catch {
    return false;
  }

  response.writeHead(200, {
    "Content-Type": extname(filePath).toLowerCase() === ".css"
      ? "text/css; charset=utf-8"
      : "text/javascript; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(body);
  return true;
}

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(
      request.url || "/",
      `http://${request.headers.host || `${host}:${port}`}`
    );

    if (request.method === "GET" && requestUrl.pathname === "/api/health") {
      sendJson(response, 200, {
        ok: true,
        service: "vela-provider-proxy"
      });
      return;
    }

    if (
      request.method === "POST" &&
      requestUrl.pathname === "/api/provider/models"
    ) {
      await proxyModels(request, response);
      return;
    }

    if (
      request.method === "POST" &&
      requestUrl.pathname === "/api/provider/chat"
    ) {
      await proxyChat(request, response);
      return;
    }

    if (
      request.method === "POST" &&
      requestUrl.pathname === "/api/search"
    ) {
      await searchWeb(request, response);
      return;
    }

    if (
      request.method === "GET" &&
      requestUrl.pathname.startsWith("/src/") &&
      await serveSourceModule(requestUrl.pathname, response)
    ) {
      return;
    }

    if (
      request.method === "GET" &&
      ["/", "/component.html"].includes(requestUrl.pathname)
    ) {
      await serveApplication(response);
      return;
    }

    if (
      request.method === "GET" &&
      ["/favicon.svg", "/favicon.ico"].includes(requestUrl.pathname)
    ) {
      const favicon = await readFile(faviconPath);
      response.writeHead(200, {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Content-Length": favicon.length,
        "Cache-Control": "public, max-age=3600",
        "X-Content-Type-Options": "nosniff"
      });
      response.end(favicon);
      return;
    }

    sendJson(response, 404, {
      error: {
        message: "Route not found."
      }
    });
  } catch (error) {
    if (response.headersSent || response.writableEnded) {
      if (!response.writableEnded) response.end();
      console.error("Request failed after the response started:", error?.message || error);
      return;
    }

    const timeout =
      error?.name === "TimeoutError" ||
      error?.name === "AbortError";

    const status = Number(error?.status) || (timeout ? 504 : 502);

    sendJson(response, status, {
      error: {
        message: timeout
          ? "The provider request timed out."
          : error?.message || "The provider proxy request failed."
      }
    });
  }
});

server.listen(port, host, () => {
  console.log(`Vela is running at http://${host}:${port}`);
  console.log("Provider API keys are forwarded per request and are not logged.");
});
