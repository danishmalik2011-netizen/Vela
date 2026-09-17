(() => {
  "use strict";

  const FRESH_TERMS = /\b(today|tonight|right now|currently|current|latest|recently|recent|news|breaking|this week|this month|this year|yesterday|tomorrow|weather|price|prices|stock|stocks|score|scores|won|winner|winners|champion|champions|release|released|update|updated|announce|announced|announcement|election|elections|rate|rates|deadline|deadlines|schedule|202[0-9]|who won|what happened|who is the current|prime minister|president of|ceo of)\b/i;
  const NOISE_TERMS = /\b(as of|please|identify|tell me|show me|find|search for|look up|verify|exact|using|both|official|primary|source|reputable|independent|compare|conflicting|claims|cite|every|factual|statement|numbered|citations?|finish|concise|table|do not rely|prior knowledge|use current|web sources?|most significant|three)\b/gi;

  const INTENT_PATTERNS = {
    definition: /\b(?:what (?:is|are|does .+ mean)|define|definition of|meaning of|what does .+ stand for)\b/i,
    how_to: /\b(?:how to|how do (?:i|you|we)|steps (?:to|for)|tutorial on|guide to|instructions for)\b/i,
    comparison: /\b(?:vs\.?|versus|compare|comparison|difference between|pros and cons|which is better)\b/i,
    news: /\b(?:latest|breaking|news|recent|recently|today|tonight|yesterday|this week|this month|just announced|released?|updates?|election|launch|score|winner)\b/i
  };

  const TIME_CONSTRAINTS = [
    { type: "24h", pattern: /\b(?:today|tonight|past 24 hours|last 24 hours|past day)\b/i, maxDays: 2 },
    { type: "7d", pattern: /\b(?:last 7 days|past 7 days|past week|this week|last week|recently|recent|few days)\b/i, maxDays: 9 },
    { type: "30d", pattern: /\b(?:this month|past 30 days|last 30 days|last month|past month)\b/i, maxDays: 35 },
    { type: "1y", pattern: /\b(?:this year|past year|last year|20\d{2})\b/i, maxDays: 375 }
  ];

  const DOMAIN_KEYWORDS = {
    ai: /\b(?:ai|llm|gpt|claude|deepseek|openai|anthropic|mistral|gemini|transformer|neural|gpu|nvidia|model|parameters|reasoning|weights)\b/i,
    technology: /\b(?:software|hardware|apple|google|microsoft|meta|linux|python|javascript|api|cloud|database|cybersecurity|kernel|chip|processor)\b/i,
    science: /\b(?:nasa|space|telescope|physics|quantum|biology|crispr|genome|climate|energy|fusion|vaccine|disease|astronomy)\b/i,
    finance: /\b(?:stock|market|crypto|bitcoin|inflation|interest rate|fed|earnings|revenue|shares|nasdaq|dow|sp500|economy|recession)\b/i,
    politics: /\b(?:president|prime minister|congress|senate|election|parliament|vote|treaty|sanctions|geopolitics|supreme court)\b/i
  };

  const OFFICIAL_DOMAINS = new Set([
    "openai.com", "anthropic.com", "deepmind.google", "blog.google", "ai.google",
    "meta.com", "ai.meta.com", "microsoft.com", "nvidia.com", "github.com",
    "huggingface.co", "deepseek.com", "apple.com", "amazon.science", "aws.amazon.com",
    "nature.com", "science.org", "whitehouse.gov", "nasa.gov", "nih.gov", "who.int", "cdc.gov"
  ]);

  const NEWS_DOMAINS = new Set([
    "reuters.com", "apnews.com", "bloomberg.com", "bbc.com", "bbc.co.uk",
    "theverge.com", "techcrunch.com", "arstechnica.com", "wired.com",
    "wsj.com", "nytimes.com", "ft.com", "cnbc.com", "economist.com",
    "theguardian.com", "forbes.com", "washingtonpost.com", "scientificamerican.com"
  ]);

  const WIKI_DOMAINS = new Set([
    "wikipedia.org", "en.wikipedia.org", "britannica.com", "plato.stanford.edu",
    "ncbi.nlm.nih.gov", "arxiv.org", "biorxiv.org", "semanticscholar.org"
  ]);

  const FORUM_DOMAINS = new Set([
    "reddit.com", "stackoverflow.com", "stackexchange.com", "quora.com",
    "news.ycombinator.com", "x.com", "twitter.com"
  ]);

  const ANTI_HALLUCINATION_RULES = [
    "RULE 1 (ZERO RESULTS): If total_found is 0 or no sources answer the query, you MUST tell the user: 'I searched the live web but could not find verified information on this.' Do NOT fabricate plausible-sounding data to fill the gap.",
    "RULE 2 (INLINE CITATIONS): Every factual claim derived from search must include an inline citation [1], [2] linked to the source URL.",
    "RULE 3 (TEMPORAL INTEGRITY): If a search result is older than the user's requested time constraint, flag it explicitly: 'This source is from [date], which is outside your requested window.'",
    "RULE 4 (UNINVOKED/FAILED SEARCH): If the search tool was not invoked, timed out, or failed, you MUST disclose that to the user before answering.",
    "RULE 5 (NO FABRICATION): Never present fabricated benchmark scores, statistics, release dates, or quotes as if they came from search."
  ];

  const ANAPHORA_PATTERNS = [
    /\b(?:the\s+same(?:\s+thing)?|same\s+thing|same\s+query|same\s+topic|same\s+search)\b/i,
    /\b(?:for\s+the\s+same|about\s+the\s+same)\b/i,
    /\b(?:search\s+again|try\s+again|run\s+again|check\s+again|retry(?:\s+search)?|re-?run|repeat(?:\s+search)?)\b/i,
    /\b(?:what\s+about|how\s+about|and\s+for|what\s+of)\b/i,
    /\b(?:as\s+(?:mentioned|asked|discussed|said)(?:\s+earlier|\s+above|\s+before)?)\b/i,
    /\b(?:that\s+thing\s+I\s+asked(?:\s+about)?|the\s+previous\s+(?:question|topic|search))\b/i,
    // Trailing bare pronouns ("the open source ones?", "not those") are anaphoric,
    // but an interior "one"/"those" is usually a real quantifier, not a reference.
    /\b(?:ones?|those|these)\s*[?.!]*$/i
  ];

  // Words that only exist to point back at the previous turn; removed when we
  // merge a follow-up with its antecedent so the merged query stays clean.
  const ANAPHORA_RESIDUAL = /\b(?:the\s+same(?:\s+thing)?|for\s+the\s+same|about\s+the\s+same|same\s+here|same\s+query|same\s+topic|same\s+search|it|this|that|those|them|these|ones?|search\s+(?:for\s+)?(?:the\s+)?same|try\s+searching|searching\s+again|search\s+again|try\s+again|trying\s+again|run\s+again|check\s+again|re-?run|repeat|retry|again|look\s+up|the\s+previous\s+(?:question|topic|search)|previous\s+(?:question|topic|search)|as\s+(?:mentioned|asked|discussed|said)(?:\s+earlier|\s+above|\s+before)?)\b/gi;

  const CONVERSATIONAL_PREAMBLE_PATTERNS = [
    /\b(?:now\s+that\s+(?:it\s+is|it's|we've|you've)\s+(?:fixed|working|resolved|ready|back)[^a-zA-Z0-9]*)/gi,
    /\b(?:since\s+(?:it\s+is|it's)\s+(?:fixed|working|resolved)[^a-zA-Z0-9]*)/gi,
    /\b(?:ok|okay|great|awesome|cool|thanks|thank you|perfect|now)\s*[,.;!:\s-]*/gi,
    /\b(?:can\s+you\s+(?:please\s+)?search(?:\s+for)?|could\s+you\s+(?:please\s+)?search(?:\s+for)?|please\s+search(?:\s+for)?|search\s+for|look\s+up|find(?:\s+me)?)\s*/gi
  ];

  function stripConversationalPreamble(message) {
    let text = String(message || "").trim();
    for (const pattern of CONVERSATIONAL_PREAMBLE_PATTERNS) {
      text = text.replace(pattern, " ").trim();
    }
    return text.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9?.]+$/g, "").replace(/\s+/g, " ").trim();
  }

  function resolveConversationalQuery(message, history = []) {
    const raw = String(message || "").trim();
    if (!raw) return "";

    const stripped = stripConversationalPreamble(raw);
    const isAnaphoric = ANAPHORA_PATTERNS.some((p) => p.test(raw)) ||
      /^(?:it|this|that|those|them|for the same|search for the same)[?.!]*$/i.test(stripped);

    if (!isAnaphoric) {
      if (stripped.length >= 3 && stripped !== raw) {
        return stripped;
      }
      return raw;
    }

    if (Array.isArray(history) && history.length > 0) {
      for (let i = history.length - 1; i >= 0; i--) {
        const turn = history[i];
        if (turn?.role === "user" && turn?.content) {
          const pastContent = stripConversationalPreamble(turn.content);
          if (pastContent.length >= 6 && !ANAPHORA_PATTERNS.some((p) => p.test(pastContent))) {
            const residual = stripped
              .replace(ANAPHORA_RESIDUAL, " ")
              .replace(/^(?:what\s+about|how\s+about|what\s+of|and\s+for|and)\s+/i, "")
              .replace(/\s+/g, " ")
              .replace(/[?.!]+$/, "")
              .trim();

            if (residual.length >= 3) {
              return `${pastContent} ${residual}`.trim();
            }
            return pastContent;
          }
        }
      }
    }

    return stripped || raw;
  }

  function needsWebSearch(message) {
    return FRESH_TERMS.test(String(message || ""));
  }

  function extractEntities(rawText) {
    const text = String(rawText || "");
    const entities = new Set();

    // 1. Quoted phrases
    const quotes = text.match(/"([^"]+)"|'([^']+)'/g);
    if (quotes) {
      quotes.forEach((q) => {
        const cleaned = q.replace(/^["']|["']$/g, "").trim();
        if (cleaned.length >= 2) entities.add(cleaned);
      });
    }

    // 2. Multi-word capitalized phrases and brand/model patterns (e.g. DeepSeek V4.1, James Webb Space Telescope)
    const capMatches = text.match(/\b[A-Z][a-zA-Z0-9]+(?:\s+[A-Z0-9][a-zA-Z0-9.]*)+(?:\s+(?:V\d+|v\d+|Opus|Sonnet|Pro|Max|Mini|Flash|R1|o1|o3))?\b/g);
    if (capMatches) {
      capMatches.forEach((m) => {
        const cleaned = m.trim();
        if (!/^(?:Please|Tell|Show|Find|Search|Look|What|Where|When|Who|How|Can|The|This|That)\b/i.test(cleaned)) {
          entities.add(cleaned);
        }
      });
    }

    // 3. Technical alphanumeric names (e.g. GPT-4o, Claude-3.5, Llama-3, DeepSeek, o3-mini)
    const techMatches = text.match(/\b(?:GPT-?[0-9a-z.]+|Claude-?[0-9a-z.]+|Llama-?[0-9a-z.]+|DeepSeek-?[0-9a-z.]+|o[13]-mini|Qwen-?[0-9a-z.]+|Gemini-?[0-9a-z.]+|Mistral-?[0-9a-z.]+)\b/gi);
    if (techMatches) {
      techMatches.forEach((m) => entities.add(m.trim()));
    }

    // 4. AI & Tech models / concepts (e.g. AI models, LLMs, foundation models)
    const aiMatches = text.match(/\b(?:AI\s+models?|LLMs?|large\s+language\s+models?|AI\s+agents?|vision\s+models?|foundation\s+models?|reasoning\s+models?)\b/gi);
    if (aiMatches) {
      aiMatches.forEach((m) => entities.add(m.trim()));
    }

    return [...entities].slice(0, 6);
  }

  function classifyIntent(message) {
    const raw = String(message || "").replace(/\s+/g, " ").trim();

    // Check ambiguity
    const strippedFluff = raw
      .replace(NOISE_TERMS, " ")
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!raw || raw.length < 2 || strippedFluff.length < 2) {
      return {
        intent: "factual_lookup",
        entities: [],
        time_constraint: "none",
        freshness_required: false,
        domain_hints: [],
        is_ambiguous: true,
        ambiguity_reason: "Query is empty or contains no search terms.",
        suggested_clarification: "Please specify what you would like to search for."
      };
    }

    const cleanCore = raw.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, "").trim();
    const isPurePronoun = /^(\s*(?:it|this|that|those|them|something|the\s+same(?:\s+thing)?|what\s+is\s+it|search\s+it|look\s+it\s+up|tell\s+me\s+about\s+it|tell\s+me\s+more|what\s+about\s+it|what\s+happened|is\s+it\s+true|find\s+it|for\s+the\s+same)\s*[?.!]*)$/i.test(raw) ||
      /^((?:it|this|that|those|them|something|the\s+same(?:\s+thing)?|what\s+is\s+it|search\s+it|look\s+it\s+up|tell\s+me\s+about\s+it|tell\s+me\s+more|what\s+about\s+it|what\s+happened|is\s+it\s+true|find\s+it|for\s+the\s+same))$/i.test(cleanCore);
    if (isPurePronoun) {
      return {
        intent: "factual_lookup",
        entities: [],
        time_constraint: "none",
        freshness_required: false,
        domain_hints: [],
        is_ambiguous: true,
        ambiguity_reason: "Query uses vague pronouns or anaphoric references without an identifiable antecedent topic.",
        suggested_clarification: "Please name the specific topic, person, product, or event you want to find."
      };
    }

    // Time constraint detection
    let time_constraint = "none";
    for (const constraint of TIME_CONSTRAINTS) {
      if (constraint.pattern.test(raw)) {
        time_constraint = constraint.type;
        break;
      }
    }

    const freshness_required = time_constraint !== "none" || INTENT_PATTERNS.news.test(raw) || needsWebSearch(raw);

    // Intent detection: news and fresh constraints take precedence over generic 'what is'
    let intent = "factual_lookup";
    if (INTENT_PATTERNS.news.test(raw) || (time_constraint !== "none" && time_constraint !== "1y")) {
      intent = "news";
    } else if (INTENT_PATTERNS.comparison.test(raw)) {
      intent = "comparison";
    } else if (INTENT_PATTERNS.how_to.test(raw)) {
      intent = "how_to";
    } else if (INTENT_PATTERNS.definition.test(raw)) {
      intent = "definition";
    }

    // Entity extraction
    const entities = extractEntities(raw);

    // Domain hints
    const domain_hints = [];
    for (const [domain, regex] of Object.entries(DOMAIN_KEYWORDS)) {
      if (regex.test(raw)) {
        domain_hints.push(domain);
      }
    }

    return {
      intent,
      entities,
      time_constraint,
      freshness_required,
      domain_hints,
      is_ambiguous: false
    };
  }

  function generateQueryVariants(message, classification = null, year = new Date().getFullYear()) {
    const raw = String(message || "").replace(/\s+/g, " ").trim();
    const info = classification || classifyIntent(raw);

    const stripped = raw
      .replace(NOISE_TERMS, " ")
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();

    const terms = stripped.split(" ").filter(Boolean).slice(0, 15).join(" ");
    const hasYear = /\b20\d{2}\b/.test(raw);
    const variants = new Set();

    // 1. Broad query with recency hint
    if (info.freshness_required && !hasYear) {
      variants.add(`${terms || raw.slice(0, 80)} latest ${year}`.trim());
    } else {
      variants.add(terms || raw.slice(0, 100));
    }

    // 2. Specific query with primary entities
    if (info.entities && info.entities.length > 0) {
      const entityStr = info.entities.join(" ");
      const nonEntityTerms = terms
        .split(" ")
        .filter((t) => !info.entities.some((e) => e.toLowerCase().includes(t.toLowerCase())))
        .slice(0, 6)
        .join(" ");
      const specific = `${entityStr} ${nonEntityTerms}`.trim();
      if (specific) variants.add(specific);
    }

    // 3. News/Recency query if freshness required
    if (info.freshness_required) {
      const core = info.entities.length ? info.entities.join(" ") : terms;
      const newsVariant = hasYear ? `${core} news` : `${core} news ${year}`;
      variants.add(newsVariant.trim());

      const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
      const currentMonth = monthNames[new Date().getMonth()];
      if (info.time_constraint === "7d" || info.time_constraint === "24h") {
        variants.add(`${core} ${currentMonth} ${year}`.trim());
      }
      if (/\b(?:model|models|llm|ai|release|released|launch|announced)\b/i.test(terms) || info.entities.some((e) => /model|llm|ai/i.test(e))) {
        variants.add(`"AI models" OR "LLM" released ${year}`);
      }
    }

    // 4. Definition / Overview query
    if (info.intent === "definition") {
      const target = info.entities[0] || terms;
      variants.add(`${target} overview explanation`);
    }

    return [...variants].filter(Boolean).slice(0, 4);
  }

  function planQuery(message, year = new Date().getFullYear(), history = []) {
    const resolved = resolveConversationalQuery(message, history);
    const variants = generateQueryVariants(resolved, null, year);
    return variants[0] || String(resolved || "").slice(0, 240);
  }

  function safeHttpUrl(value) {
    try {
      const url = new URL(String(value || ""));
      return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
    } catch {
      return "";
    }
  }

  function categorizeSource(url, host = "") {
    let hostname = host.toLowerCase().replace(/^www\./, "");
    if (!hostname && url) {
      try { hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch {}
    }

    if (OFFICIAL_DOMAINS.has(hostname) || hostname.endsWith(".gov") || hostname.endsWith(".edu")) {
      return "official_blog";
    }
    for (const d of OFFICIAL_DOMAINS) {
      if (hostname.endsWith(`.${d}`)) return "official_blog";
    }

    if (NEWS_DOMAINS.has(hostname)) return "news_outlet";
    for (const d of NEWS_DOMAINS) {
      if (hostname.endsWith(`.${d}`)) return "news_outlet";
    }

    if (WIKI_DOMAINS.has(hostname)) return "wiki";
    for (const d of WIKI_DOMAINS) {
      if (hostname.endsWith(`.${d}`)) return "wiki";
    }

    if (FORUM_DOMAINS.has(hostname)) return "forum";
    for (const d of FORUM_DOMAINS) {
      if (hostname.endsWith(`.${d}`)) return "forum";
    }

    return "unknown";
  }

  const CORE_STOP_WORDS = new Set([
    "the", "a", "an", "in", "on", "at", "for", "of", "to", "is", "are", "was", "were",
    "it", "and", "or", "with", "by", "from", "that", "this", "last", "past", "few",
    "days", "about", "what", "how", "who", "when", "where", "can", "please", "tell",
    "show", "find", "search", "week", "month", "year"
  ]);

  function calculateRelevanceScore(result, intentObj = {}, queryTerms = []) {
    const title = String(result?.title || "").toLowerCase();
    const snippet = String(result?.snippet || result?.excerpt || "").toLowerCase();
    const url = String(result?.url || "").toLowerCase();
    const text = `${title} ${snippet} ${url}`;

    // Extract core meaningful terms
    const coreTerms = (Array.isArray(queryTerms) ? queryTerms : [])
      .map((t) => String(t || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""))
      .filter((t) => t.length > 1 && !CORE_STOP_WORDS.has(t));

    const entities = (intentObj.entities || []).map((e) => String(e || "").toLowerCase());

    // 1. Check entity matches
    let entityMatched = false;
    let titleEntityMatch = false;
    for (const entity of entities) {
      if (entity.length >= 2) {
        if (title.includes(entity)) {
          entityMatched = true;
          titleEntityMatch = true;
        } else if (snippet.includes(entity)) {
          entityMatched = true;
        }
      }
    }

    // 2. Check core terms coverage
    let matchedCoreCount = 0;
    for (const term of coreTerms) {
      if (text.includes(term)) {
        matchedCoreCount += 1;
      }
    }
    const termCoverage = coreTerms.length > 0 ? (matchedCoreCount / coreTerms.length) : (entityMatched ? 1.0 : 0);

    // HARD RELEVANCE GATE:
    // If there are core query terms and ZERO of them match and no entity matched,
    // this result is completely off-topic (e.g. math theorems for AI releases).
    if (coreTerms.length >= 2 && matchedCoreCount === 0 && !entityMatched) {
      return 0.05;
    }

    // If coverage is poor (< 0.34) and no entity matched, cap score to prevent false positives
    if (coreTerms.length >= 2 && termCoverage < 0.34 && !entityMatched) {
      return 0.15;
    }

    // Calculate score based on relevance evidence
    let score = 0.25; // base score for on-topic candidate

    // Term coverage contribution (up to +0.35)
    score += termCoverage * 0.35;

    // Entity matches (up to +0.25)
    if (titleEntityMatch) score += 0.25;
    else if (entityMatched) score += 0.15;

    // Source quality boost (only if on-topic)
    const sourceType = result?.source_type || categorizeSource(result?.url, result?.host);
    if (termCoverage >= 0.4 || entityMatched) {
      if (sourceType === "official_blog") score += 0.15;
      else if (sourceType === "news_outlet") score += 0.12;
      else if (sourceType === "wiki") score += 0.08;
      else if (sourceType === "forum") score -= 0.05;
    }

    // Freshness matching
    if (intentObj.freshness_required) {
      const pub = result?.publishedAt || result?.published_date || "";
      if (pub && /\b202[4-9]\b/.test(pub)) {
        score += 0.10;
      }
    }

    return Math.max(0.05, Math.min(0.99, Number(score.toFixed(2))));
  }

  function normalizeSources(results, clock = Date.now) {
    return (Array.isArray(results) ? results : []).map((result, index) => {
      const url = safeHttpUrl(result?.url);
      let host = String(result?.host || "").replace(/^www\./, "");
      if (!host && url) {
        try { host = new URL(url).hostname.replace(/^www\./, ""); } catch {}
      }
      const sourceType = result?.source_type || categorizeSource(url, host);
      const publishedDate = String(result?.published_date || result?.publishedAt || "").trim();

      return {
        index: index + 1,
        title: String(result?.title || `Source ${index + 1}`).replace(/\s+/g, " ").trim().slice(0, 300),
        url,
        host,
        favicon: safeHttpUrl(result?.favicon),
        excerpt: String(result?.excerpt || result?.snippet || "").replace(/\s+/g, " ").trim().slice(0, 220),
        snippet: String(result?.snippet || "").replace(/\s+/g, " ").trim().slice(0, 600),
        publishedAt: publishedDate,
        publishedDate,
        sourceType,
        source_type: sourceType,
        relevanceScore: typeof result?.relevance_score === "number" ? result.relevance_score : 0.85,
        engine: String(result?.engine || "web"),
        accessedAt: new Date(Number(clock())).toISOString()
      };
    }).filter((source) => source.url);
  }

  function xmlText(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function buildContext(searchData) {
    if (!searchData || typeof searchData !== "object") return "";

    const query = xmlText(searchData.query || "");
    const searchedAt = xmlText(searchData.searchedAt || new Date().toISOString());
    const backendsTried = (searchData.backends_tried || searchData.backends_used || []).join(", ");
    const intent = searchData.intent?.intent || "factual_lookup";
    const timeConstraint = searchData.intent?.time_constraint || searchData.time_constraint || "none";

    // 1. Error / Timeout state
    if (searchData.status === "error" || searchData.error) {
      const errorMsg = xmlText(searchData.error || "Search backend timed out or failed.");
      return [
        `\n\n<live_web_search query="${query}" searched_at="${searchedAt}" status="error" error="${errorMsg}">`,
        "STATUS: SEARCH_FAILED",
        `Details: ${errorMsg}`,
        `Backends attempted: ${backendsTried || "web"}`,
        "",
        "MANDATORY ANTI-HALLUCINATION INSTRUCTION:",
        "The live web search attempt failed or timed out. You MUST disclose to the user before answering:",
        "\"I attempted to search the live web for this, but the search was unavailable. My response is based on training data and may not reflect real-time information.\"",
        "Do NOT invent current facts, dates, or specifications.",
        "</live_web_search>"
      ].join("\n");
    }

    // 2. Ambiguous query state
    if (searchData.status === "ambiguous" || searchData.is_ambiguous) {
      const suggestion = xmlText(searchData.suggested_clarification || "Please provide the specific name or subject to search for.");
      return [
        `\n\n<live_web_search query="${query}" searched_at="${searchedAt}" status="ambiguous">`,
        "STATUS: QUERY_TOO_AMBIGUOUS",
        `Reason: ${xmlText(searchData.ambiguity_reason || "Query lacks identifiable search entities.")}`,
        `Suggestion: ${suggestion}`,
        "",
        "MANDATORY ANTI-HALLUCINATION INSTRUCTION:",
        "The search query was too ambiguous to retrieve verified live data. You MUST ask the user to clarify:",
        `\"${suggestion}\"`,
        "</live_web_search>"
      ].join("\n");
    }

    const results = Array.isArray(searchData.results) ? searchData.results : [];
    const totalFound = Number.isInteger(searchData.total_found) ? searchData.total_found : results.length;
    const filteredOut = Number.isInteger(searchData.filtered_out) ? searchData.filtered_out : 0;

    // 3. Zero verified results state
    if (!results.length) {
      return [
        `\n\n<live_web_search query="${query}" searched_at="${searchedAt}" total_found="0" search_performed="true" backends_tried="${xmlText(backendsTried)}">`,
        "STATUS: ZERO_RESULTS_FOUND",
        `The web search tool ran across backends [${backendsTried || "web"}] but found zero verified sources for this query.`,
        "",
        "MANDATORY ANTI-HALLUCINATION INSTRUCTION:",
        "You MUST explicitly tell the user: \"I searched the live web for this, but could not find verified information on this topic.\"",
        "You are strictly FORBIDDEN from inventing or hallucinating plausible-sounding facts, benchmark scores, release dates, or numbers to fill the void.",
        "</live_web_search>"
      ].join("\n");
    }

    // 4. Valid verified results state
    const sourcesXml = results.map((result, index) => {
      const title = String(result?.title || `Source ${index + 1}`).replace(/\s+/g, " ").trim();
      const url = safeHttpUrl(result?.url);
      const snippet = String(result?.snippet || "").replace(/\s+/g, " ").trim();
      const publishedAt = String(result?.published_date || result?.publishedAt || "").trim();
      const sourceType = String(result?.source_type || categorizeSource(url, result?.host) || "unknown");
      const relevance = typeof result?.relevance_score === "number" ? result.relevance_score.toFixed(2) : "0.90";
      const page = result?.text ? `Page extract: ${String(result.text).replace(/\s+/g, " ").slice(0, 1200)}` : "";

      return [
        `[${index + 1}] ${xmlText(title)}`,
        `URL: ${xmlText(url)}`,
        publishedAt ? `Published: ${xmlText(publishedAt)}` : "",
        `Source Type: ${xmlText(sourceType)}`,
        `Relevance Score: ${relevance}`,
        snippet ? `Snippet: ${xmlText(snippet)}` : "",
        page ? xmlText(page) : ""
      ].filter(Boolean).join("\n");
    }).join("\n\n");

    const rulesXml = ANTI_HALLUCINATION_RULES.map((r, i) => `${i + 1}. ${r}`).join("\n");

    return [
      `\n\n<live_web_search query="${query}" intent="${xmlText(intent)}" time_constraint="${xmlText(timeConstraint)}" searched_at="${searchedAt}" total_found="${totalFound}" filtered_out="${filteredOut}" backends_used="${xmlText(backendsTried)}">`,
      "ANTI-HALLUCINATION CONTRACT (MANDATORY):",
      rulesXml,
      "",
      "SEARCH SOURCES (Ranked by relevance & quality):",
      sourcesXml,
      "</live_web_search>"
    ].join("\n");
  }

  function shouldSearch(message, explicit = false, taskMode = "") {
    return Boolean(explicit || taskMode === "research" || needsWebSearch(message));
  }

  globalThis.VelaSearchOrchestration = Object.freeze({
    FRESH_TERMS,
    TIME_CONSTRAINTS,
    ANTI_HALLUCINATION_RULES,
    needsWebSearch,
    stripConversationalPreamble,
    resolveConversationalQuery,
    classifyIntent,
    generateQueryVariants,
    planQuery,
    categorizeSource,
    calculateRelevanceScore,
    safeHttpUrl,
    normalizeSources,
    buildContext,
    shouldSearch
  });
})();
