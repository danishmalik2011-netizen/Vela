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
  assert.equal(historyWithAttachment[0].content[0].type, "text");
  assert.match(historyWithAttachment[0].content[0].text, /Evidence/);
  assert.match(historyWithAttachment[0].content[0].text, /Current/);
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
