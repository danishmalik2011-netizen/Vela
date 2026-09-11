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

const requests = await load("../src/services/provider-requests.js", "VelaProviderRequests", { URL });
const configService = await load("../src/services/provider-config.js", "VelaProviderConfig");
const orchestrator = await load("../src/services/provider-orchestrator.js", "VelaProviderOrchestrator", { VelaProviderConfig: configService });

function storage(values = {}) {
  const map = new Map(Object.entries(values));
  return { getItem: (key) => map.get(key) ?? null };
}
function documentWith(values = {}, enabled = false) {
  return { getElementById: (id) => id === "byokSwitch"
    ? { getAttribute: () => enabled ? "true" : "false" }
    : { value: values[id] || "" } };
}

test("provider configuration reads form, persisted metadata, and session-only secrets", () => {
  const localStorage = storage({ "sage-byok-config": JSON.stringify({ enabled: true, provider: "custom", format: "openai-chat", endpoint: "https://saved.example/v1", model: "saved", profileId: "p1" }) });
  const sessionStorage = storage({ "vela-provider-key:p1": "secret-profile", "sage-byok-key": "legacy" });
  const config = configService.read({
    document: documentWith({ providerSelect: "openrouter", providerEndpoint: " https://api.example/v1 ", providerModel: "model-a" }),
    localStorage,
    sessionStorage
  });
  assert.equal(config.enabled, true);
  assert.equal(config.provider, "openrouter");
  assert.equal(config.endpoint, "https://api.example/v1");
  assert.equal(config.apiKey, "secret-profile");
  assert.equal(config.profileId, "p1");
});

test("provider configuration repairs corrupt saved metadata", () => {
  assert.equal(Object.keys(configService.parseSaved(storage({ "sage-byok-config": "{" }))).length, 0);
});

test("provider preparation validates and assembles one proxy payload", () => {
  const payload = configService.prepare(requests, {
    enabled: true, provider: "custom", format: "openai-chat", endpoint: "https://api.example/v1", model: "m", apiKey: "k"
  }, [{ role: "user", content: "Hello" }], 0, "", "Base.", "Be concise.");
  assert.equal(payload.endpoint, "https://api.example/v1/chat/completions");
  assert.equal(payload.requestBody.messages[0].role, "system");
  assert.throws(() => configService.prepare(requests, { enabled: true }, [], 0, "", "", ""), /endpoint/);
});

test("provider orchestrator sends configured requests through same-origin proxy", async () => {
  const calls = [];
  const result = await orchestrator.request({
    fetch: async (url, init) => { calls.push({ url, init }); return { ok: true }; },
    config: { enabled: true, provider: "custom", format: "openai-chat", endpoint: "https://api.example/v1", model: "m", apiKey: "k" },
    message: "Hello", messages: [{ role: "user", content: "Hello" }], userIndex: 0, conversation: "Test",
    shouldSearch: false, searchContext: "", searchError: "", searchSources: [{ url: "https://source.test" }],
    preferences: {}, taskMode: "chat", taskGuidance: "Help.", basePrompt: "Base.", requests,
    consumeResponse: async () => ({ text: "Answer", reasoning: "" }), readResponseError: async () => "error", onUpdate: () => {}
  });
  assert.equal(calls[0].url, "/api/provider/chat");
  assert.equal(result.text, "Answer");
  assert.equal(result.searchSources.length, 1);
  assert.equal(JSON.parse(calls[0].init.body).apiKey, "k");
});

test("provider orchestrator supports local endpoint and fallback recovery", async () => {
  let updates = 0;
  const result = await orchestrator.request({
    fetch: async () => ({ ok: false }), config: { enabled: false }, message: "Hello", messages: [{ role: "user", content: "Hello" }], userIndex: 0,
    conversation: "Test", shouldSearch: false, searchContext: "", searchError: "", preferences: {}, taskMode: "chat", taskGuidance: "", requests,
    consumeResponse: async () => ({}), readResponseError: async () => "offline", onUpdate: () => { updates += 1; }, fallback: async () => "Recovered"
  });
  assert.equal(result.text, "Recovered");
  assert.equal(updates, 1);
});
