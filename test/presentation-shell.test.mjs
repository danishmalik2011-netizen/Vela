import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../src/conversation/presentation.js", import.meta.url), "utf8");
const context = vm.createContext({ Date, Intl, document: { createElement: (tag) => ({ tagName: tag, className: "", classList: { add: () => {}, toggle: () => {}, remove: () => {}, contains: () => false }, dataset: {}, setAttribute: () => {}, innerHTML: "", appendChild: () => {}, append: () => {}, querySelector: () => null }) } });
vm.runInContext(source, context);
const presentation = context.VelaConversationPresentation;

const genSource = await readFile(new URL("../src/conversation/generation.js", import.meta.url), "utf8");
const genContext = vm.createContext({ Date, JSON, AbortController });
vm.runInContext(genSource, genContext);
const lifecycle = genContext.VelaGenerationLifecycle;

test("snapshotting preserves the task mode that produced a message", () => {
  const snapshot = lifecycle.snapshotMessages([
    { role: "user", content: "Plan", taskMode: "write", reasoning: "", searchEnabled: true },
    { role: "assistant", content: "Brief" }
  ]);
  assert.equal(snapshot[0].taskMode, "write");
  assert.equal(snapshot[0].searchEnabled, true);
  const original = snapshot[0];
  original.taskMode = "research";
  assert.equal(lifecycle.snapshotMessages([{ role: "user", content: "x", taskMode: "code" }])[0].taskMode, "code");
});

test("presentation summaries truncate to a concise preview", () => {
  assert.equal(presentation.reasoningSummary("## Step one\n\nDetailed plan content"), "Step one Detailed plan content");
  assert.equal(presentation.reasoningSummary("a".repeat(300)).endsWith("…"), true);
  assert.equal(presentation.reasoningSummary("clean thought"), "clean thought");
});

test("generation lifecycle builds runs and persists outcome records", () => {
  const run = lifecycle.createRun("chat-1", 0, { initialText: "partial" });
  assert.equal(run.latest.text, "partial");
  assert.equal(run.running, true);
  const stored = {};
  lifecycle.persistPending(stored, run, "hello");
  assert.equal(stored.pending.message, "hello");
  assert.equal(stored.pending.userIndex, 0);
  const completed = {};
  lifecycle.persistAssistant(completed, 100, "Done", "Because", [{ url: "https://x.test" }]);
  assert.equal(completed.messages[0].role, "assistant");
  assert.equal(completed.messages[0].content, "Done");
  assert.equal(completed.messages[0].sources.length, 1);
  assert.equal(completed.pending, null);
  assert.equal(lifecycle.persistError({}, 5, lifecycle.formatError("Nope", lifecycle.networkHint({ message: "Failed to fetch" }))), undefined);
});

test("error formatting appends a provider-proxy hint for network failures", () => {
  const network = lifecycle.formatError("Failed to fetch", lifecycle.networkHint({ message: "Failed to fetch" }));
  assert.match(network, /same-origin server proxy/);
  const local = lifecycle.formatError("Bad key", lifecycle.networkHint({ message: "Bad key" }));
  assert.equal(local, "I couldn’t complete the request.\n\n**Error:** Bad key");
});
