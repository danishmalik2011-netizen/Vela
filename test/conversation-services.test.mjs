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

const artifactStore = await load("../src/artifacts/store.js", "VelaArtifactStore");
const store = await load("../src/conversation/store.js", "VelaConversationStore");
const requests = await load("../src/services/provider-requests.js", "VelaProviderRequests", { URL });
const clock = () => 1700000000000;

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    dump: () => Object.fromEntries(values)
  };
}

test("conversation store serializes, saves, and reloads versioned state", () => {
  const storage = memoryStorage();
  const keys = { prefix: "conversation:", active: "active", compatibility: "compat", legacy: "legacy" };
  const state = {
    id: "chat-1", title: "Test", taskMode: "research", messages: [
      { role: "user", content: "Question", taskMode: "research", searchEnabled: true }
    ], artifacts: [], createdAt: clock(), updatedAt: clock()
  };
  const saved = store.save(storage, keys, state, clock);
  assert.equal(saved.version, store.CURRENT_VERSION);
  assert.equal(storage.getItem("active"), "chat-1");
  const loaded = store.load(storage, keys, "", artifactStore, clock);
  assert.equal(loaded.title, "Test");
  assert.equal(loaded.messages[0].taskMode, "research");
});

test("conversation persistence avoids duplicate mirrors and survives quota pressure", () => {
  const values = new Map([["compat", "obsolete duplicate"], ["legacy", "obsolete legacy"]]);
  let primaryAttempts = 0;
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => {
      if (key === "conversation:chat-quota" && primaryAttempts++ === 0) {
        const error = new Error("quota");
        error.name = "QuotaExceededError";
        throw error;
      }
      values.set(key, String(value));
    }
  };
  const hugeImage = `data:image/png;base64,${"A".repeat(500_000)}`;
  const state = {
    id: "chat-quota", title: "Quota safe", taskMode: "chat", artifacts: [],
    messages: [{ role: "user", content: "Image", attachments: [{ id: "i", name: "large.png", kind: "image", dataUrl: hugeImage }] }],
    createdAt: clock(), updatedAt: clock()
  };
  const saved = store.save(storage, { prefix: "conversation:", active: "active", compatibility: "compat", legacy: "legacy" }, state, clock);
  assert.equal(values.has("compat"), false);
  assert.equal(values.has("legacy"), false);
  assert.equal(values.get("active"), "chat-quota");
  assert.equal(saved.messages[0].attachments[0].dataUrl, "");
  assert.equal(JSON.parse(values.get("conversation:chat-quota")).messages[0].attachments[0].dataUrl, "");
});

test("quota-safe direct writes report failure without throwing", () => {
  const storage = {
    setItem() { const error = new Error("full"); error.name = "QuotaExceededError"; throw error; }
  };
  const result = store.writeRecord(storage, "conversation:x", {
    messages: [
      { role: "user", content: "Question", attachments: [{ dataUrl: "large", text: "large" }] },
      { role: "assistant", content: "Answer without attachments" }
    ]
  });
  assert.equal(result.persisted, false);
  assert.equal(result.compacted, true);
});

test("quota recovery safely strips attachments when messages lack attachments property", () => {
  const values = new Map();
  let attempts = 0;
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (attempts++ === 0) {
        const error = new Error("quota exceeded");
        error.name = "QuotaExceededError";
        throw error;
      }
      values.set(key, String(value));
    }
  };
  const record = {
    id: "rec-quota",
    title: "Quota recovery test",
    messages: [
      { role: "user", content: "Prompt with image", attachments: [{ id: "att-1", name: "doc.png", dataUrl: "data:image/png;base64,123", text: "doc text" }] },
      { role: "assistant", content: "Assistant reply without attachments" },
      { role: "user", content: "Plain follow-up" }
    ]
  };
  const result = store.writeRecord(storage, "conversation:rec-quota", record);
  assert.equal(result.persisted, true);
  assert.equal(result.compacted, true);
  const saved = JSON.parse(values.get("conversation:rec-quota"));
  assert.equal(saved.messages[0].attachments[0].dataUrl, "");
  assert.equal(saved.messages[0].attachments[0].text, "");
  assert.deepEqual(saved.messages[1].attachments, []);
  assert.deepEqual(saved.messages[2].attachments, []);
});

test("conversation migration rejects invalid messages and repairs modes", () => {
  const migrated = store.migrate({
    messages: [
      { role: "user", content: "ok", taskMode: "invalid" },
      { role: "system", content: "drop" },
      { role: "assistant", content: "answer" }
    ], artifacts: []
  }, artifactStore, clock);
  assert.equal(migrated.messages.length, 2);
  assert.equal(migrated.messages[0].taskMode, "chat");
});

test("conversation index is bounded and sorted", () => {
  const storage = memoryStorage();
  const records = Array.from({ length: 110 }, (_, index) => ({ id: String(index), updatedAt: index }));
  const written = store.writeIndex(storage, "index", records);
  assert.equal(written.length, 100);
  assert.equal(written[0].id, "109");
  assert.equal(store.readIndex(storage, "index").length, 100);
});

test("conversation bootstrap creates and hydrates stable state", () => {
  const empty = store.empty(clock);
  assert.equal(empty.title, "New conversation");
  assert.equal(empty.taskMode, "chat");
  assert.equal(empty.createdAt, clock());
  const restored = store.hydrate(empty, {
    id: "",
    title: "Restored",
    messages: [{ role: "user", content: "Hello", taskMode: "write" }],
    artifacts: [],
    createdAt: clock(),
    updatedAt: clock()
  }, { artifactStore, fallbackId: "fallback", clock });
  assert.equal(restored, true);
  assert.equal(empty.id, "fallback");
  assert.equal(empty.title, "Restored");
  assert.equal(empty.messages[0].taskMode, "write");
});

test("provider request service validates and builds supported protocol bodies", () => {
  assert.match(requests.validate({}), /endpoint/);
  const history = [{ role: "user", content: "Hello" }];
  const system = requests.buildSystemPrompt("Base.", "Research carefully.");
  assert.equal(system, "Base. Research carefully.");

  const anthropic = requests.buildBody({ format: "anthropic-messages", model: "claude" }, history, system);
  assert.equal(anthropic.system, system);
  assert.equal(anthropic.stream, true);

  const responses = requests.buildBody({ format: "openai-responses", model: "gpt" }, history, system);
  assert.equal(responses.input[0].role, "system");

  const openrouter = requests.buildBody({ format: "openai-chat", provider: "openrouter", model: "m" }, history, system);
  assert.equal(openrouter.reasoning.enabled, true);

  assert.equal(requests.resolveEndpoint("https://api.example/v1/chat/completions", "openai-responses"), "https://api.example/v1/responses");
  const historyWithAttachment = requests.buildHistory([
    { role: "user", content: "Review", attachments: [{ name: "note.txt", text: "Evidence", kind: "file" }] }
  ], 0, "openai-chat", "\n<context>Current</context>");
  assert.equal(typeof historyWithAttachment[0].content, "string");
  assert.match(historyWithAttachment[0].content, /Evidence/);
  assert.match(historyWithAttachment[0].content, /Current/);

  const historyWithImage = requests.buildHistory([
    { role: "user", content: "Look", attachments: [{ name: "pic.png", kind: "image", dataUrl: "data:image/png;base64,123" }] }
  ], 0, "openai-chat");
  assert.equal(Array.isArray(historyWithImage[0].content), true);
  assert.equal(historyWithImage[0].content[0].type, "text");
  assert.equal(historyWithImage[0].content[1].type, "image_url");
});

async function loadOrchestrator() {
  const context = vm.createContext({ URL });
  for (const file of ["provider-requests.js", "provider-config.js", "provider-orchestrator.js"]) {
    vm.runInContext(await readFile(new URL(`../src/services/${file}`, import.meta.url), "utf8"), context);
  }
  return context.VelaProviderOrchestrator;
}

test("orchestrator exposes truncation helpers and closes open fences", async () => {
  const orchestrator = await loadOrchestrator();
  assert.equal(orchestrator.isTruncationReason("length"), true);
  assert.equal(orchestrator.isTruncationReason("max_tokens"), true);
  assert.equal(orchestrator.isTruncationReason("stop"), false);
  assert.equal(orchestrator.closeOpenCodeFences("```html\n<div>").endsWith("\n```\n"), true);
  assert.equal(orchestrator.closeOpenCodeFences("```html\n<div>\n```"), "```html\n<div>\n```");
  assert.equal(orchestrator.mergeContinuation("abc\n", "\n  def"), "abc\n  def");
  assert.equal(orchestrator.mergeContinuation("abc", "def"), "abcdef");
});

test("orchestrator auto-continues a response cut off by the token limit", async () => {
  const orchestrator = await loadOrchestrator();
  const config = {
    enabled: true, provider: "custom", format: "openai-chat",
    endpoint: "https://provider.test/v1", apiKey: "key", model: "model"
  };
  const messages = [{ role: "user", content: "Build a page" }];
  const fetches = [];
  const chunks = [
    { text: "Here it is:\n```html\n<div>", reasoning: "", stopReason: "length" },
    { text: '<p>done</p>\n```', reasoning: "", stopReason: "stop" }
  ];
  const fetch = async (url, init) => {
    fetches.push(JSON.parse(init.body));
    return { ok: true, headers: new Headers() };
  };
  const consumeResponse = async () => chunks.shift();

  const result = await orchestrator.request({
    fetch, config, message: "Build a page", messages, userIndex: 0,
    conversation: "t", shouldSearch: false, searchContext: "", preferences: {},
    taskMode: "chat", taskGuidance: "", basePrompt: "Base.",
    requests, consumeResponse, readResponseError: async () => "err",
    onUpdate: () => {}, signal: null
  });

  assert.equal(fetches.length, 2);
  const continuationBody = fetches[1].requestBody;
  assert.equal(continuationBody.messages.at(-1).content, orchestrator.CONTINUATION_PROMPT);
  assert.match(continuationBody.messages.at(-2).content, /<div>/);
  assert.equal(result.text, 'Here it is:\n```html\n<div><p>done</p>\n```');
});

test("orchestrator bounds continuation rounds for runaway truncation", async () => {
  const orchestrator = await loadOrchestrator();
  const config = {
    enabled: true, provider: "custom", format: "openai-chat",
    endpoint: "https://provider.test/v1", apiKey: "key", model: "model"
  };
  let calls = 0;
  const fetch = async () => { calls += 1; return { ok: true, headers: new Headers() }; };
  const consumeResponse = async () => ({ text: "```html\n<p>x", reasoning: "", stopReason: "max_tokens" });

  const result = await orchestrator.request({
    fetch, config, message: "m", messages: [{ role: "user", content: "m" }], userIndex: 0,
    conversation: "t", shouldSearch: false, searchContext: "", preferences: {},
    taskMode: "chat", taskGuidance: "", basePrompt: "", requests,
    consumeResponse, readResponseError: async () => "err", onUpdate: () => {}, signal: null
  });

  assert.equal(calls, 1 + orchestrator.MAX_CONTINUATIONS);
  assert.ok(result.text.endsWith("```\n"));
});

const titling = await load("../src/conversation/titling.js", "VelaConversationTitling");

test("titling service cleans model titles, removes markdown markers, and formats one-line summaries", () => {
  assert.equal(
    titling.cleanModelTitle("Title: Voice Assistant Talkback Settings"),
    "Voice Assistant Talkback Settings"
  );
  assert.equal(
    titling.cleanModelTitle("**Two-Column Exam PDF Formatting**"),
    "Two-Column Exam PDF Formatting"
  );
  assert.equal(
    titling.cleanModelTitle('"Robust Web Search Integration."'),
    "Robust Web Search Integration"
  );
  assert.equal(
    titling.cleanModelTitle("```\nDeep Learning Architecture\n```"),
    "Deep Learning Architecture"
  );

  // Fallbacks on empty / generic / invalid input
  assert.equal(
    titling.cleanModelTitle("", "please fix the default talkback in settings"),
    "Fix the default talkback in settings"
  );
  assert.equal(
    titling.cleanModelTitle("Untitled", "can you write a resume for software engineer"),
    "Write a resume for software engineer"
  );

  // Long title bounds to clean ~50 char one-liner
  const longTitle = titling.cleanModelTitle("Comprehensive Guide to Distributed Consensus Algorithms in Modern Cloud Computing Networks");
  assert.ok(longTitle.length <= 50);
  assert.ok(longTitle.endsWith("…"));
});

test("titling service builds lightweight titling payloads across provider formats", () => {
  const configOpenAI = {
    provider: "custom",
    format: "openai-chat",
    endpoint: "https://api.example.com/v1",
    apiKey: "sk-test",
    model: "gpt-4o-mini"
  };
  const messages = [
    { role: "user", content: "How does photosynthesis work?" },
    { role: "assistant", content: "Photosynthesis converts light into chemical energy." }
  ];

  const payloadOpenAI = titling.buildTitlingPayload(requests, configOpenAI, messages);
  assert.equal(payloadOpenAI.provider, "custom");
  assert.equal(payloadOpenAI.format, "openai-chat");
  assert.equal(payloadOpenAI.requestBody.max_tokens, 300);
  assert.equal(payloadOpenAI.requestBody.temperature, 0.3);
  assert.equal(payloadOpenAI.requestBody.messages[0].role, "user");
  assert.ok(payloadOpenAI.requestBody.messages[0].content.includes("photosynthesis"));

  // Reasoning models use max_completion_tokens and omit temperature
  const configReasoning = {
    provider: "openai",
    format: "openai-chat",
    apiKey: "sk-test",
    model: "o3-mini"
  };
  const payloadReasoning = titling.buildTitlingPayload(requests, configReasoning, messages);
  assert.equal(payloadReasoning.requestBody.max_completion_tokens, 300);
  assert.equal(payloadReasoning.requestBody.temperature, undefined);

  const configAnthropic = {
    provider: "anthropic",
    format: "anthropic-messages",
    endpoint: "https://api.anthropic.com/v1",
    apiKey: "sk-ant",
    model: "claude-3-5-sonnet"
  };
  const payloadAnthropic = titling.buildTitlingPayload(requests, configAnthropic, messages);
  assert.equal(payloadAnthropic.format, "anthropic-messages");
  assert.equal(payloadAnthropic.requestBody.max_tokens, 300);
  assert.equal(payloadAnthropic.requestBody.messages[0].role, "user");
  assert.ok(payloadAnthropic.requestBody.messages[0].content.includes(titling.TITLING_SYSTEM_PROMPT));

  // Auto-resolves default endpoints when omitted
  const configGroq = {
    provider: "groq",
    apiKey: "gsk-test",
    model: "llama-3.3-70b-versatile"
  };
  const payloadGroq = titling.buildTitlingPayload(requests, configGroq, messages);
  assert.equal(payloadGroq.endpoint, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(payloadGroq.requestBody.model, "llama-3.3-70b-versatile");
});

test("titling service extracts and parses text from json, sse streams, and raw strings", () => {
  assert.equal(
    titling.extractTitlingText({ choices: [{ message: { content: "Web Search Fix" } }] }, "openai-chat"),
    "Web Search Fix"
  );
  assert.equal(
    titling.extractTitlingText({ content: [{ text: "Voice HUD Design" }] }, "anthropic-messages"),
    "Voice HUD Design"
  );
  assert.equal(
    titling.extractTitlingText({ output_text: "PDF Layout Fix" }, "openai-responses"),
    "PDF Layout Fix"
  );

  // parseTitlingResponse handles single JSON response
  const jsonResponse = JSON.stringify({ choices: [{ message: { content: "Neural Networks" } }] });
  assert.equal(titling.parseTitlingResponse(jsonResponse, "openai-chat"), "Neural Networks");

  // parseTitlingResponse handles SSE chunks
  const sseResponse = [
    'data: {"choices":[{"delta":{"content":"Quantum "}}]}',
    'data: {"choices":[{"delta":{"content":"Computing"}}]}',
    'data: [DONE]'
  ].join("\n");
  assert.equal(titling.parseTitlingResponse(sseResponse, "openai-chat"), "Quantum Computing");

  // parseTitlingResponse handles plain text
  assert.equal(titling.parseTitlingResponse("Distributed Consensus", "openai-chat"), "Distributed Consensus");
});
