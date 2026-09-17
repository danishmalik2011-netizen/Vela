import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

async function loadSTT() {
  const source = await readFile(new URL("../src/voice/stt-engine.js", import.meta.url), "utf8");
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    Math,
    Boolean,
    String,
    Object,
    Error,
    Date
  });
  context.globalThis = context;
  vm.runInContext(source, context);
  return context;
}

const { VelaSTTEngine, formatTranscript, stitchTranscripts } = await loadSTT();

test("formatTranscript capitalizes and trims correctly", () => {
  assert.equal(formatTranscript("hello world"), "Hello world");
  assert.equal(formatTranscript("  testing one two  "), "Testing one two");
  assert.equal(formatTranscript(""), "");
  assert.equal(formatTranscript(null), "");
});

test("formatTranscript handles prependSpace option", () => {
  assert.equal(formatTranscript("new sentence", true), " New sentence");
  assert.equal(formatTranscript(". continuing punctuation", true), ". continuing punctuation");
});

test("stitchTranscripts joins committed and interim without double spaces and preserves punctuation", () => {
  assert.equal(stitchTranscripts("Hello", "world"), "Hello world");
  assert.equal(stitchTranscripts("Hello ", " world "), "Hello world");
  assert.equal(stitchTranscripts("", "interim text"), "interim text");
  assert.equal(stitchTranscripts("committed text", ""), "committed text");
  assert.equal(stitchTranscripts("", ""), "");
  assert.equal(stitchTranscripts("Hello", ", how are you?"), "Hello, how are you?");
  assert.equal(stitchTranscripts("Wait", "..."), "Wait...");
});

test("VelaSTTEngine initializes with defaults and handles state transitions", () => {
  const engine = new VelaSTTEngine({
    silenceTimeoutMs: 3000,
    lang: "en-US"
  });

  assert.equal(engine.state, "idle");
  assert.equal(engine.isListening, false);
  assert.equal(engine.options.silenceTimeoutMs, 3000);
  assert.equal(engine.options.lang, "en-US");
});

test("VelaSTTEngine silence detection triggers callback on timeout", async () => {
  let timeoutTriggered = false;

  const engine = new VelaSTTEngine({
    silenceTimeoutMs: 50,
    onStateChange: (state) => {
      if (state === "idle") timeoutTriggered = true;
    }
  });

  // Emulate active listening with content
  engine.isListening = true;
  engine.state = "listening";
  engine.committedText = "User said something";
  engine._startSilenceTimer();

  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(engine.state, "idle");
  assert.equal(engine.isListening, false);
});

test("VelaSTTEngine stop and abort cleanly resets listening state", () => {
  const engine = new VelaSTTEngine();
  engine.isListening = true;
  engine.state = "listening";
  engine.stop();

  assert.equal(engine.isListening, false);
  assert.equal(engine.state, "idle");

  engine.isListening = true;
  engine.state = "listening";
  engine.abort();

  assert.equal(engine.isListening, false);
  assert.equal(engine.state, "idle");
});

test("VelaSTTEngine resetTranscript clears committed and interim transcripts", () => {
  const engine = new VelaSTTEngine();
  engine.committedText = "Previous utterance";
  engine.interimText = "interim utterance";

  engine.resetTranscript();

  assert.equal(engine.committedText, "");
  assert.equal(engine.interimText, "");
});

test("VelaSTTEngine flushAndCommit and stop commits pending interim speech", () => {
  let finalResult = "";
  const engine = new VelaSTTEngine({
    onFinal: (full) => {
      finalResult = full;
    }
  });

  engine.isListening = true;
  engine.state = "listening";
  engine.interimText = "what is the capital of France";

  engine.flushAndCommit();

  assert.equal(finalResult, "What is the capital of France");
  assert.equal(engine.committedText, "What is the capital of France");
  assert.equal(engine.interimText, "");

  // Now test stop() flushing remaining interim
  let stopFinalResult = "";
  const engine2 = new VelaSTTEngine({
    onFinal: (full) => {
      stopFinalResult = full;
    }
  });
  engine2.isListening = true;
  engine2.state = "listening";
  engine2.interimText = "hello there";

  engine2.stop();

  assert.equal(stopFinalResult, "Hello there");
  assert.equal(engine2.committedText, "Hello there");
  assert.equal(engine2.isListening, false);
});

