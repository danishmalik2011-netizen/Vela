import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../src/writing/store.js", import.meta.url), "utf8");
const context = vm.createContext({});
vm.runInContext(source, context);
const writing = context.VelaWritingStore;
const clock = () => 1700000000000;

test("maintains brief, outline, and versioned drafts", () => {
  let document = writing.update(writing.empty(), { brief: "Write warmly", outline: "1. Opening" }, clock);
  document = writing.saveDraft(document, "First draft", "Generated", clock);
  assert.equal(document.brief, "Write warmly");
  assert.equal(document.outline, "1. Opening");
  assert.equal(document.stage, "draft");
  assert.equal(document.revisions.length, 1);
});

test("creates a reversible selection proposal without mutating the draft", () => {
  const document = writing.saveDraft(writing.empty(), "Hello verbose world", "Generated", clock);
  const proposal = writing.propose(document, { action: "shorten", replacement: "clear", selectionStart: 6, selectionEnd: 13 }, clock);
  assert.equal(document.draft, "Hello verbose world");
  assert.equal(proposal.proposal.before, "verbose");
  assert.equal(proposal.proposal.after, "clear");
  assert.deepEqual([...writing.diff(proposal)].map((entry) => entry.type), ["removed", "added"]);
});

test("accepts and rejects proposals with recoverable history", () => {
  const initial = writing.saveDraft(writing.empty(), "Hello verbose world", "Generated", clock);
  const proposal = writing.propose(initial, { action: "shorten", replacement: "clear", selectionStart: 6, selectionEnd: 13 }, clock);
  const accepted = writing.accept(proposal, () => clock() + 1);
  assert.equal(accepted.draft, "Hello clear world");
  assert.equal(accepted.revisions.length, 2);
  assert.equal(writing.reject(proposal, clock).draft, initial.draft);
});

test("restores old content as a new version", () => {
  let document = writing.saveDraft(writing.empty(), "One", "Generated", clock);
  document = writing.saveDraft(document, "Two", "Edited", () => clock() + 1);
  document = writing.restore(document, 1, () => clock() + 2);
  assert.equal(document.draft, "One");
  assert.equal(document.revisions.length, 3);
});
