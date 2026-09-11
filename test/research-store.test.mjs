import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../src/research/store.js", import.meta.url), "utf8");
const context = vm.createContext({ URL });
vm.runInContext(source, context);
const research = context.VelaResearchStore;
const clock = () => 1700000000000;

test("normalizes structured research sources", () => {
  const source = research.normalizeSource({ title: "Paper", url: "https://www.example.com/paper", snippet: "  useful   claim " }, 0, clock);
  assert.equal(source.host, "example.com");
  assert.equal(source.excerpt, "useful claim");
  assert.equal(source.saved, true);
  assert.equal(source.accessedAt, "2023-11-14T22:13:20.000Z");
});

test("merges and deduplicates source sets across searches", () => {
  let state = research.mergeSources(research.empty(), [{ title: "A", url: "https://example.com/a" }], "first", clock);
  state = research.mergeSources(state, [
    { title: "A revised", url: "https://example.com/a" },
    { title: "B", url: "https://example.org/b" }
  ], "second", clock);
  assert.equal(state.sources.length, 2);
  assert.deepEqual([...state.queries], ["first", "second"]);
  assert.equal(state.status, "synthesizing");
});

test("updates durable notes, draft, and status", () => {
  const state = research.update(research.empty(), { notes: "Evidence", draft: "Brief", status: "complete" }, clock);
  assert.equal(state.notes, "Evidence");
  assert.equal(state.draft, "Brief");
  assert.equal(state.status, "complete");
});

test("exports saved sources as a traceable bibliography", () => {
  const state = research.normalize({ sources: [
    { title: "Report", url: "https://example.com/report", author: "A. Author", publishedAt: "2025-01-01", accessedAt: "2025-02-01T00:00:00.000Z", saved: true },
    { title: "Hidden", url: "https://example.com/hidden", saved: false }
  ]}, clock);
  const bibliography = research.bibliography(state);
  assert.match(bibliography, /A\. Author/);
  assert.match(bibliography, /accessed 2025-02-01/);
  assert.doesNotMatch(bibliography, /Hidden/);
});
