import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

async function load(path, name, seed = {}) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const context = vm.createContext(seed);
  vm.runInContext(source, context);
  return context[name];
}

const search = await load("../src/services/search-orchestration.js", "VelaSearchOrchestration", { URL, Date });
const composer = await load("../src/composer/state.js", "VelaComposerState");

test("plans bounded fresh-information queries", () => {
  assert.equal(search.needsWebSearch("latest release news"), true);
  const query = search.planQuery("Please find the latest release news and cite reputable sources", 2026);
  assert.match(query, /release news/);
  assert.match(query, /latest 2026/);
  assert.ok(query.length <= 240);
});

test("plans queries with existing year without appending redundant year hint", () => {
  const query = search.planQuery("Who won the 2024 ICC T20 World Cup final?", 2026);
  assert.match(query, /2024/);
  assert.ok(!query.includes("2026"));
  assert.equal(search.needsWebSearch("who won the match"), true);
  assert.equal(search.needsWebSearch("who is the current prime minister"), true);
  assert.equal(search.shouldSearch("general topic", false, "research"), true);
  assert.equal(search.shouldSearch("general topic", false, "chat"), false);
});

test("normalizes safe search sources and rejects active URL schemes", () => {
  const sources = search.normalizeSources([
    { title: " Report  ", url: "https://www.example.com/report", snippet: " useful   evidence " },
    { title: "Unsafe", url: "javascript:alert(1)" }
  ], () => 1700000000000);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].host, "example.com");
  assert.equal(sources[0].excerpt, "useful evidence");
});

test("builds escaped traceable provider search context", () => {
  const context = search.buildContext({
    query: 'topic "quoted"',
    searchedAt: "2026-01-01",
    results: [{
      title: "A < B",
      url: "https://example.com",
      snippet: "Evidence & detail",
      text: "Comprehensive full article text about the topic."
    }]
  });
  assert.match(context, /query="topic &quot;quoted&quot;"/);
  assert.match(context, /A &lt; B/);
  assert.match(context, /Evidence &amp; detail/);
  assert.match(context, /Page extract: Comprehensive full article text/);
});

test("composer state enforces limits and immutable attachment operations", () => {
  const initial = composer.create({ text: "", taskMode: "code" });
  const first = composer.addAttachment(initial, { id: "1", name: "app.js", size: 20 }, { maxFiles: 2, maxFileBytes: 30, maxTotalBytes: 40 });
  assert.equal(first.error, "");
  assert.equal(initial.attachments.length, 0);
  const duplicate = composer.addAttachment(first.state, { id: "1", name: "app.js", size: 20 }, { maxFiles: 2, maxFileBytes: 30, maxTotalBytes: 40 });
  assert.match(duplicate.error, /already attached/);
  const tooLarge = composer.addAttachment(first.state, { id: "2", name: "big.js", size: 31 }, { maxFiles: 2, maxFileBytes: 30, maxTotalBytes: 40 });
  assert.match(tooLarge.error, /larger/);
});

test("composer slash commands suggest and apply every task mode", () => {
  assert.deepEqual(Array.from(composer.commandSuggestions("/c"), (item) => item.command), ["/chat", "/code", "/compare", "/canvas"]);
  assert.equal(composer.commandSuggestions("hello").length, 0);
  for (const mode of ["chat", "write", "research", "code", "build"]) {
    const parsed = composer.applySlashCommand(`/${mode} create something useful`);
    assert.equal(parsed.matched, true);
    assert.equal(parsed.mode, mode);
    assert.equal(parsed.text, "create something useful");
  }
  assert.equal(composer.applySlashCommand("/unknown task").matched, false);

  // Prompt-shaping commands wrap their argument in an instruction;
  // action commands pass through with an action token for the shell.
  const summarize = composer.applySlashCommand("/summarize the long article");
  assert.equal(summarize.matched, true);
  assert.equal(summarize.action, "");
  assert.match(summarize.text, /^Summarize/);
  assert.match(summarize.text, /the long article/);

  const compare = composer.applySlashCommand("/compare option A vs B");
  assert.equal(compare.mode, "research");
  assert.match(compare.text, /Compare/);

  const exported = composer.applySlashCommand("/export");
  assert.equal(exported.action, "export");
  assert.equal(composer.applySlashCommand("/quiet").action, "quiet");
  assert.equal(composer.applySlashCommand("/remember likes tea").action, "remember");
  assert.equal(composer.applySlashCommand("/remember likes tea").text, "likes tea");
});

test("composer produces attachment-only prompts and running state", () => {
  const state = composer.create({ attachments: [{ id: "1", name: "brief.pdf", size: 10 }], searchEnabled: true, taskMode: "research" });
  assert.equal(composer.canSend(state), true);
  assert.equal(composer.canSend(state, true), false);
  const outgoing = composer.snapshot(state);
  assert.equal(outgoing.message, "Please review brief.pdf.");
  assert.equal(outgoing.searchEnabled, true);
  assert.equal(outgoing.taskMode, "research");
});

test("search intent classifier extracts entities, time constraints, and domain hints", () => {
  const news = search.classifyIntent("What are the latest DeepSeek V4.1 releases announced in the last 7 days?");
  assert.equal(news.intent, "news");
  assert.equal(news.time_constraint, "7d");
  assert.equal(news.freshness_required, true);
  assert.ok(news.entities.some((e) => e.includes("DeepSeek")));
  assert.ok(news.domain_hints.includes("ai"));
  assert.equal(news.is_ambiguous, false);

  const def = search.classifyIntent("What is quantum entanglement and how does it work?");
  assert.equal(def.intent, "definition");
  assert.equal(def.time_constraint, "none");
  assert.ok(def.domain_hints.includes("science"));

  const comp = search.classifyIntent("Compare Claude 3.5 Sonnet vs GPT-4o architecture");
  assert.equal(comp.intent, "comparison");
  assert.ok(comp.entities.length >= 1);

  const howTo = search.classifyIntent("How to deploy a Node.js server with Docker?");
  assert.equal(howTo.intent, "how_to");
});

test("search intent classifier detects ambiguous queries and provides structured recovery", () => {
  const vague = search.classifyIntent("tell me about it");
  assert.equal(vague.is_ambiguous, true);
  assert.ok(vague.ambiguity_reason);
  assert.ok(vague.suggested_clarification);

  const empty = search.classifyIntent("   ");
  assert.equal(empty.is_ambiguous, true);
});

test("search query rewriter generates multiple optimized query variants", () => {
  const variants = search.generateQueryVariants("What are the latest AI models released last 7 days?", null, 2026);
  assert.ok(variants.length >= 2);
  assert.ok(variants.length <= 4);
  assert.ok(variants.some((v) => v.includes("2026") || v.includes("news")));
});

test("source categorizer accurately identifies official, news, wiki, and forum domains", () => {
  assert.equal(search.categorizeSource("https://openai.com/index/announcing-o3"), "official_blog");
  assert.equal(search.categorizeSource("https://deepseek.com/blog/v4"), "official_blog");
  assert.equal(search.categorizeSource("https://techcrunch.com/2026/09/10/ai-launch"), "news_outlet");
  assert.equal(search.categorizeSource("https://reuters.com/technology/article"), "news_outlet");
  assert.equal(search.categorizeSource("https://en.wikipedia.org/wiki/Artificial_intelligence"), "wiki");
  assert.equal(search.categorizeSource("https://reddit.com/r/MachineLearning"), "forum");
  assert.equal(search.categorizeSource("https://random-tech-blog.example/page"), "unknown");
});

test("relevance scoring weighs entities, keywords, source quality, and recency", () => {
  const intentObj = {
    intent: "news",
    entities: ["DeepSeek V4.1"],
    freshness_required: true,
    time_constraint: "7d"
  };
  const highQuality = {
    title: "DeepSeek V4.1 Official Release and Benchmarks",
    snippet: "DeepSeek announced V4.1 on September 10 with new architecture.",
    url: "https://deepseek.com/blog/v4.1",
    published_date: "2026-09-10",
    source_type: "official_blog"
  };
  const score = search.calculateRelevanceScore(highQuality, intentObj, ["deepseek", "v4.1", "release"]);
  assert.ok(score >= 0.80, `Expected score >= 0.80, got ${score}`);

  const lowQuality = {
    title: "Funny Memes about Programming",
    snippet: "Some funny jokes about code",
    url: "https://reddit.com/r/programmerhumor",
    source_type: "forum"
  };
  const lowScore = search.calculateRelevanceScore(lowQuality, intentObj, ["deepseek", "v4.1", "release"]);
  assert.ok(lowScore < score);
});

test("anti-hallucination context builder handles zero results, errors, and verified sources", () => {
  // 1. Zero results contract
  const zeroContext = search.buildContext({
    query: "Alien landing in Times Square",
    results: [],
    total_found: 0,
    backends_tried: ["brave", "bing", "duckduckgo"]
  });
  assert.match(zeroContext, /STATUS: ZERO_RESULTS_FOUND/);
  assert.match(zeroContext, /You MUST explicitly tell the user: "I searched the live web for this, but could not find verified information/);
  assert.match(zeroContext, /FORBIDDEN from inventing or hallucinating/);

  // 2. Error / Timeout contract
  const errorContext = search.buildContext({
    query: "Live traffic updates",
    status: "error",
    error: "Search backend timed out after 15s",
    backends_tried: ["brave", "bing"]
  });
  assert.match(errorContext, /STATUS: SEARCH_FAILED/);
  assert.match(errorContext, /timed out after 15s/);
  assert.match(errorContext, /You MUST disclose to the user before answering/);

  // 3. Ambiguous query contract
  const ambiguousContext = search.buildContext({
    query: "it",
    status: "ambiguous",
    is_ambiguous: true,
    suggested_clarification: "Please specify the topic or product."
  });
  assert.match(ambiguousContext, /STATUS: QUERY_TOO_AMBIGUOUS/);
  assert.match(ambiguousContext, /Please specify the topic or product/);

  // 4. Verified results contract with full mandatory rules and source metadata
  const validContext = search.buildContext({
    query: "DeepSeek V4.1 Release",
    intent: { intent: "news", time_constraint: "7d" },
    total_found: 5,
    filtered_out: 2,
    backends_tried: ["tavily", "bing"],
    results: [{
      title: "DeepSeek V4.1 Released",
      url: "https://deepseek.com/blog/v4.1",
      published_date: "2026-09-10",
      source_type: "official_blog",
      relevance_score: 0.94,
      snippet: "DeepSeek V4.1 is now live."
    }]
  });
  assert.match(validContext, /ANTI-HALLUCINATION CONTRACT \(MANDATORY\):/);
  assert.match(validContext, /RULE 1 \(ZERO RESULTS\)/);
  assert.match(validContext, /RULE 2 \(INLINE CITATIONS\)/);
  assert.match(validContext, /RULE 3 \(TEMPORAL INTEGRITY\)/);
  assert.match(validContext, /RULE 4 \(UNINVOKED\/FAILED SEARCH\)/);
  assert.match(validContext, /RULE 5 \(NO FABRICATION\)/);
  assert.match(validContext, /\[1\] DeepSeek V4.1 Released/);
  assert.match(validContext, /Source Type: official_blog/);
  assert.match(validContext, /Relevance Score: 0.94/);
});

test("conversational query resolver handles anaphora, preamble, and context history", () => {
  const history = [
    { role: "user", content: "What are the latest AI models released in the last 7 days?" },
    { role: "assistant", content: "I searched the live web for AI models..." }
  ];

  // 1. Resolve anaphora with conversational preamble: "now that it is fixed...search for the same"
  const resolvedSame = search.resolveConversationalQuery("now that it is fixed...search for the same", history);
  assert.match(resolvedSame, /latest AI models released in the last 7 days/);

  // 2. Resolve anaphora: "try searching again for the same"
  const resolvedAgain = search.resolveConversationalQuery("try searching again for the same", history);
  assert.match(resolvedAgain, /latest AI models released in the last 7 days/);

  // 3. Resolve follow-up with delta modifier: "what about open source ones?"
  const resolvedDelta = search.resolveConversationalQuery("what about open source ones?", history);
  assert.match(resolvedDelta, /latest AI models released in the last 7 days/);
  assert.match(resolvedDelta, /open source/);

  // 4. Conversational preamble with concrete topic (not anaphoric): strips preamble cleanly
  const resolvedConcrete = search.resolveConversationalQuery("now that it is fixed, please search for DeepSeek V3", history);
  assert.equal(resolvedConcrete, "DeepSeek V3");

  // 5. Unresolved anaphora without history triggers ambiguity check
  const unresolved = search.resolveConversationalQuery("now that it is fixed... search for the same", []);
  const intent = search.classifyIntent(unresolved);
  assert.equal(intent.is_ambiguous, true);
  assert.match(intent.ambiguity_reason, /vague pronouns|anaphoric/i);
});

test("resolved anaphoric query flows through planQuery without literal-word residue", () => {
  const history = [
    { role: "user", content: "What are the latest AI models released in the last 7 days?" },
    { role: "assistant", content: "Search failed." }
  ];

  const resolved = search.resolveConversationalQuery("now that it is fixed...search for the same", history);
  assert.match(resolved, /latest AI models released in the last 7 days/i);

  const planned = search.planQuery(resolved, 2026, history);
  assert.match(planned, /AI models/i);
  assert.ok(!/\bfixed\b/i.test(planned), `planned query retains anaphora residue: ${planned}`);
  assert.ok(planned.length <= 240);

  // Residual-merge keeps only meaningful modifiers, not pointer words.
  const merged = search.resolveConversationalQuery("what about open source ones?", history);
  assert.match(merged, /open source/);
  assert.ok(!/\bones?\b/i.test(merged), `merged query retains pointer word "ones": ${merged}`);
});

test("relevance scoring gates off-topic math theorems and grammar pages", () => {
  const aiIntent = {
    intent: "news",
    entities: ["AI models"],
    freshness_required: true,
    time_constraint: "7d"
  };

  // Math theorem page: 0 core term matches -> MUST score 0.05
  const mathTheorem = {
    title: "Brouwer fixed-point theorem - Wikipedia",
    snippet: "In mathematics, the Brouwer fixed-point theorem is a fixed-point theorem in topology...",
    url: "https://en.wikipedia.org/wiki/Brouwer_fixed-point_theorem",
    source_type: "wiki"
  };
  const mathScore = search.calculateRelevanceScore(mathTheorem, aiIntent, ["ai", "models", "released"]);
  assert.equal(mathScore, 0.05, `Expected 0.05 for off-topic math theorem, got ${mathScore}`);

  // Grammar usage page: 0 core term matches -> MUST score 0.05
  const grammarPage = {
    title: "\"it's now fixed\" grammar usage - TextRanch",
    snippet: "Learn the proper usage of 'has been fixed' vs 'it is now fixed'...",
    url: "https://textranch.com/grammar/fixed",
    source_type: "unknown"
  };
  const grammarScore = search.calculateRelevanceScore(grammarPage, aiIntent, ["ai", "models", "released"]);
  assert.equal(grammarScore, 0.05, `Expected 0.05 for off-topic grammar page, got ${grammarScore}`);

  // Genuine on-topic AI release page: high core term coverage & entity match
  const genuineArticle = {
    title: "Latest AI Models Released This Week: New Reasoning LLMs Launch",
    snippet: "Several major AI models were released in the past few days featuring frontier reasoning...",
    url: "https://techcrunch.com/2026/09/14/latest-ai-models-released",
    source_type: "news_outlet",
    published_date: "2026-09-14"
  };
  const genuineScore = search.calculateRelevanceScore(genuineArticle, aiIntent, ["ai", "models", "released"]);
  assert.ok(genuineScore >= 0.80, `Expected genuine article score >= 0.80, got ${genuineScore}`);
});

