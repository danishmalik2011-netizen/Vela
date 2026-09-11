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
  const context = search.buildContext({ query: 'topic "quoted"', searchedAt: "2026-01-01", results: [{ title: "A < B", url: "https://example.com", snippet: "Evidence & detail" }] });
  assert.match(context, /query="topic &quot;quoted&quot;"/);
  assert.match(context, /A &lt; B/);
  assert.match(context, /Evidence &amp; detail/);
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
