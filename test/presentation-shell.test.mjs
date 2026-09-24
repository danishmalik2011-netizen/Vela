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
  assert.equal(
    JSON.stringify(presentation.reasoningSteps("Understand the request.\n\nPlan the implementation.\n\nValidate the result.")),
    JSON.stringify(["Understand the request.", "Plan the implementation.", "Validate the result."])
  );
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

test("createUserArticle renders interactive attachment preview buttons with metadata", () => {
  const elements = [];
  const mockDocument = {
    createElement: (tag) => {
      const el = {
        tagName: tag.toUpperCase(),
        className: "",
        classList: { add: () => {}, toggle: () => {}, remove: () => {}, contains: () => false },
        dataset: {},
        attributes: {},
        children: [],
        setAttribute: (k, v) => { el.attributes[k] = v; },
        innerHTML: "",
        appendChild: (child) => { el.children.push(child); return child; },
        append: (...items) => { el.children.push(...items); },
        querySelector: () => null
      };
      elements.push(el);
      return el;
    }
  };

  const sampleAttachments = [
    { id: "att-img-1", name: "diagram.png", kind: "image", dataUrl: "data:image/png;base64,123", size: 4500 },
    { id: "att-pdf-2", name: "report.pdf", kind: "pdf", size: 128000, text: "Extracted PDF content" }
  ];

  const article = presentation.createUserArticle(mockDocument, {
    message: "Here are the files",
    index: 0,
    attachments: sampleAttachments
  });

  assert.equal(article.className, "message user-message");
  assert.equal(article.dataset.messageIndex, "0");

  const attachmentButtons = elements.filter((el) => el.className === "message-attachment");
  assert.equal(attachmentButtons.length, 2);

  // Verify first attachment (image)
  assert.equal(attachmentButtons[0].tagName, "BUTTON");
  assert.equal(attachmentButtons[0].type, "button");
  assert.equal(attachmentButtons[0].dataset.attachmentId, "att-img-1");
  assert.equal(attachmentButtons[0].dataset.attachmentIndex, "0");
  assert.equal(attachmentButtons[0].title, "Click to preview diagram.png");
  assert.equal(attachmentButtons[0]._velaAttachment, sampleAttachments[0]);

  // Verify second attachment (pdf)
  assert.equal(attachmentButtons[1].tagName, "BUTTON");
  assert.equal(attachmentButtons[1].dataset.attachmentId, "att-pdf-2");
  assert.equal(attachmentButtons[1].dataset.attachmentIndex, "1");
  assert.equal(attachmentButtons[1].title, "Click to preview report.pdf");
  assert.equal(attachmentButtons[1]._velaAttachment, sampleAttachments[1]);
});

test("createAssistantArticle renders smart streaming indicator with task-aware initial verb", () => {
  const mockDocument = {
    createElement: (tag) => ({
      tagName: tag.toUpperCase(),
      className: "",
      classList: { add: () => {}, toggle: () => {}, remove: () => {}, contains: () => false },
      dataset: {},
      attributes: {},
      innerHTML: "",
      querySelector: () => null
    })
  };

  const article = presentation.createAssistantArticle(mockDocument, {
    userIndex: 0,
    taskMode: "code"
  });

  assert.match(article.innerHTML, /class="streaming-cursor streaming-indicator"/);
  assert.match(article.innerHTML, /class="streaming-indicator-spinner"/);
  assert.match(article.innerHTML, /<svg class="streaming-spinner-svg"/);
  assert.match(article.innerHTML, /class="streaming-spinner-core"/);
  assert.match(article.innerHTML, /class="streaming-indicator-verb"/);
  assert.match(article.innerHTML, /Architecting…/);
});

