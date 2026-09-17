import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

async function loadTTS() {
  const source = await readFile(new URL("../src/voice/tts-engine.js", import.meta.url), "utf8");
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Math,
    Boolean,
    String,
    Object,
    Array,
    Set,
    RegExp,
    Error,
    Date
  });
  context.globalThis = context;
  vm.runInContext(source, context);
  return context;
}

const { VelaTTSEngine, extractSentences, cleanTextForSpeech } = await loadTTS();

test("extractSentences splits on sentence boundaries (. ! ? \\n)", () => {
  const text = "Hello there! How are you doing? I am doing well. This is great.";
  const { sentences, remaining } = extractSentences(text, false);

  assert.deepEqual(Array.from(sentences), [
    "Hello there!",
    "How are you doing?",
    "I am doing well.",
    "This is great."
  ]);
  assert.equal(remaining, "");
});

test("extractSentences avoids false splits on common abbreviations and decimals", () => {
  const text = "Dr. Smith met with Mr. Jones at 3.14 PM. It was etc. and so on.";
  const { sentences, remaining } = extractSentences(text, false);

  assert.deepEqual(Array.from(sentences), [
    "Dr. Smith met with Mr. Jones at 3.14 PM.",
    "It was etc. and so on."
  ]);
  assert.equal(remaining, "");
});

test("extractSentences preserves incomplete sentence in buffer when not final", () => {
  const text = "First sentence completed. Incomplete sentence";
  const { sentences, remaining } = extractSentences(text, false);

  assert.deepEqual(Array.from(sentences), ["First sentence completed."]);
  assert.equal(remaining, "Incomplete sentence");
});

test("extractSentences flushes incomplete sentence when isFinal is true", () => {
  const text = "First sentence completed. Final incomplete chunk";
  const { sentences, remaining } = extractSentences(text, true);

  assert.deepEqual(Array.from(sentences), [
    "First sentence completed.",
    "Final incomplete chunk"
  ]);
  assert.equal(remaining, "");
});

test("VelaTTSEngine streams incoming tokens and triggers sentence playback immediately", () => {
  const spokenSentences = [];
  const engine = new VelaTTSEngine({
    onSentenceStart: (s) => spokenSentences.push(s),
    speakHandler: (sentence, done) => {
      // Mock active speaker (keeps speaking until done is called)
    }
  });

  // Simulating token streaming
  engine.feedChunk("The quick ");
  assert.equal(spokenSentences.length, 0);
  assert.equal(engine.buffer, "The quick ");

  engine.feedChunk("brown fox ");
  assert.equal(spokenSentences.length, 0);

  // Complete first sentence -> immediate dispatch to speaker (~300ms latency)
  engine.feedChunk("jumps over the lazy dog. ");
  assert.equal(spokenSentences.length, 1);
  assert.equal(spokenSentences[0], "The quick brown fox jumps over the lazy dog.");
  assert.equal(engine.buffer, "");

  // While first sentence is speaking, second sentence enqueues
  engine.feedChunk("Second sentence here! And more text");
  assert.equal(engine.queue.length, 1);
  assert.equal(engine.queue[0], "Second sentence here!");
  assert.equal(engine.buffer, "And more text");

  // Stream finish flushes the remainder into queue
  engine.finishStream();
  assert.equal(engine.queue.length, 2);
  assert.equal(engine.queue[1], "And more text");
  assert.equal(engine.buffer, "");
});

test("VelaTTSEngine stop cancels speech, clears queue and buffer immediately", () => {
  const engine = new VelaTTSEngine();
  engine.queue = ["Sentence 1", "Sentence 2"];
  engine.buffer = "Trailing buffer";
  engine.isSpeaking = true;

  engine.stop();

  assert.equal(engine.queue.length, 0);
  assert.equal(engine.buffer, "");
  assert.equal(engine.isSpeaking, false);
});

test("cleanTextForSpeech strips code blocks, inline code, and Markdown formatting", () => {
  const markdown = "# Title\nHere is **bold** and *italic* text with `const a = 1;` code.\n```javascript\nconsole.log('test');\n```\nCheck [Vela](https://vela.ai) now.";
  const cleaned = cleanTextForSpeech(markdown);

  assert.ok(!cleaned.includes("```"), "Code fences should be removed");
  assert.ok(!cleaned.includes("**"), "Bold asterisks should be stripped");
  assert.ok(!cleaned.includes("*italic*"), "Italic markers should be stripped");
  assert.ok(!cleaned.includes("`const"), "Inline backticks should be stripped");
  assert.ok(!cleaned.includes("https://vela.ai"), "URL should be stripped");
  assert.ok(cleaned.includes("Vela"), "Link text should be preserved");
  assert.ok(cleaned.includes("bold"), "Bold content should be preserved");
});

test("cleanTextForSpeech strips emojis, citations, math, blockquotes, and YAML frontmatter", () => {
  const dirty = `---
title: "Next 7 Days: Global AI & Technology Release Radar"
author: "Vela Research & Intelligence"
date: "2026-09-17"
---

# Global AI Radar 🚀✨

> Breakthrough updates across frontier labs:

According to reports [1, 2], new models have been trained with loss $$L = \\sum (y - \\hat{y})^2$$ at 99% accuracy [citation needed].
Check out the table below:
| Model | Status |
|---|---|
| GPT-5 | Alpha |

Hope this helps! 📅`;

  const cleaned = cleanTextForSpeech(dirty);

  // YAML frontmatter and redundant title stripped
  assert.ok(!cleaned.includes("title:"), "Frontmatter keys stripped");
  assert.ok(!cleaned.includes("author:"), "Frontmatter author stripped");
  assert.ok(!cleaned.includes("---"), "YAML delimiters stripped");

  // Emojis stripped
  assert.ok(!cleaned.includes("🚀"), "Rocket emoji stripped");
  assert.ok(!cleaned.includes("✨"), "Sparkles emoji stripped");
  assert.ok(!cleaned.includes("📅"), "Calendar emoji stripped");

  // Blockquote > marker stripped without leaving greater-than
  assert.ok(!cleaned.includes(">"), "Blockquote marker stripped");
  assert.ok(cleaned.includes("Breakthrough updates across frontier labs:"), "Blockquote text preserved");

  // Citations stripped
  assert.ok(!cleaned.includes("[1, 2]"), "Citation markers stripped");
  assert.ok(!cleaned.includes("[citation needed]"), "Footnote stripped");

  // Math stripped
  assert.ok(!cleaned.includes("$$"), "Math delimiters stripped");
  assert.ok(!cleaned.includes("\\sum"), "TeX commands stripped");

  // Table separator stripped
  assert.ok(!cleaned.includes("|---|---|"), "Table bar stripped");

  // Plain prose preserved
  assert.ok(cleaned.includes("According to reports, new models have been trained with loss at 99% accuracy"));
  assert.ok(cleaned.includes("Hope this helps!"));
});

test("VelaTTSEngine sanitizes markdown in _processQueue before dispatching to speaker", () => {
  let spokenText = "";
  const engine = new VelaTTSEngine({
    onSentenceStart: (s) => { spokenText = s; },
    speakHandler: (s, done) => {}
  });

  engine.queue = ["**Hello world!** Check `code`."];
  engine._processQueue();

  assert.equal(spokenText, "Hello world! Check code.");
});

test("VelaTTSEngine _cleanupAudio clears event handlers before resetting source", () => {
  const engine = new VelaTTSEngine();
  let paused = false;
  const mockAudio = {
    onended: () => {},
    onerror: () => {},
    pause: () => { paused = true; },
    src: "blob:http://localhost/test"
  };

  engine._currentAudio = mockAudio;
  engine._cleanupAudio();

  assert.equal(mockAudio.onended, null, "onended should be nulled out");
  assert.equal(mockAudio.onerror, null, "onerror should be nulled out");
  assert.equal(mockAudio.src, "", "src should be cleared");
  assert.equal(paused, true, "Audio should be paused");
  assert.equal(engine._currentAudio, null);
});

test("VelaTTSEngine _speakWithServer falls back to speech synthesis on failure", async () => {
  let fallbackInvoked = false;
  const engine = new VelaTTSEngine({
    audioEndpoint: "http://127.0.0.1:9999/does-not-exist"
  });

  const origSupported = VelaTTSEngine.isSpeechSynthesisSupported;
  VelaTTSEngine.isSpeechSynthesisSupported = () => true;

  engine._speakWithSpeechSynthesis = (sentence) => {
    fallbackInvoked = true;
  };

  try {
    await engine._speakWithServer("Fallback test sentence");
    assert.equal(fallbackInvoked, true, "Should fall back to speech synthesis when server fails");
  } finally {
    VelaTTSEngine.isSpeechSynthesisSupported = origSupported;
  }
});

