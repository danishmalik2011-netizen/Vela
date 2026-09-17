import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

async function loadCoordinator(windowMock = undefined) {
  const source = await readFile(new URL("../src/voice/assistant-coordinator.js", import.meta.url), "utf8");
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
    Error,
    Date,
    window: windowMock,
    Event: class {
      constructor(type, init = {}) {
        this.type = type;
        this.bubbles = Boolean(init.bubbles);
      }
    }
  });
  context.globalThis = context;
  vm.runInContext(source, context);
  return context.VelaVoiceAssistantCoordinator;
}

const VelaVoiceAssistantCoordinator = await loadCoordinator();

test("VelaVoiceAssistantCoordinator initializes cleanly with default options", () => {
  const coordinator = new VelaVoiceAssistantCoordinator();
  assert.equal(coordinator.isOpen, false);
  assert.equal(coordinator.isMuted, false);
  assert.equal(coordinator.isComposerDictating, false);
});

test("VelaVoiceAssistantCoordinator handles HUD open, mute, interrupt, and close lifecycle", () => {
  let stoppedGeneration = false;

  const coordinator = new VelaVoiceAssistantCoordinator({
    stopGeneration: () => {
      stoppedGeneration = true;
    }
  });

  coordinator.isOpen = true;
  assert.equal(coordinator.isOpen, true);

  coordinator.toggleMute();
  assert.equal(coordinator.isMuted, true);

  coordinator.toggleMute();
  assert.equal(coordinator.isMuted, false);

  coordinator.interrupt();
  assert.equal(stoppedGeneration, true);

  coordinator.closeHUD();
  assert.equal(coordinator.isOpen, false);
});

test("VelaVoiceAssistantCoordinator processes stream chunks and end correctly", () => {
  let feedChunkCalledWith = "";
  let finishStreamCalled = false;

  const coordinator = new VelaVoiceAssistantCoordinator();
  coordinator.isOpen = true;
  coordinator.tts = {
    feedChunk: (chunk) => { feedChunkCalledWith += chunk; },
    finishStream: () => { finishStreamCalled = true; }
  };

  coordinator.handleStreamChunk("Hello, ");
  assert.equal(feedChunkCalledWith, "Hello, ");

  coordinator.handleStreamChunk("Hello, I am Vela.");
  assert.equal(feedChunkCalledWith, "Hello, I am Vela.");

  coordinator.handleStreamEnd("Hello, I am Vela.");
  assert.equal(finishStreamCalled, true);
});

test("VelaVoiceAssistantCoordinator manages composer dictation state", () => {
  const coordinator = new VelaVoiceAssistantCoordinator();
  assert.equal(coordinator.isComposerDictating, false);

  coordinator.isComposerDictating = true;
  coordinator.stopComposerDictation();
  assert.equal(coordinator.isComposerDictating, false);
});

test("VelaVoiceAssistantCoordinator handleStreamEnd feeds un-streamed delta before finishing stream", () => {
  const fedChunks = [];
  let finished = false;

  const coordinator = new VelaVoiceAssistantCoordinator();
  coordinator.isOpen = true;
  coordinator.tts = {
    feedChunk: (chunk) => fedChunks.push(chunk),
    finishStream: () => { finished = true; }
  };

  // Only partial was fed
  coordinator.handleStreamChunk("Short answer");
  assert.equal(fedChunks.length, 1);
  assert.equal(fedChunks[0], "Short answer");

  // Final text has additional un-streamed content
  coordinator.handleStreamEnd("Short answer with extra words.");
  assert.equal(fedChunks.length, 2);
  assert.equal(fedChunks[1], " with extra words.");
  assert.equal(finished, true);
});

test("VelaVoiceAssistantCoordinator does not feed stream chunks or end when closed and talkback disabled", () => {
  let feedChunkCalled = false;
  let finishStreamCalled = false;

  const coordinator = new VelaVoiceAssistantCoordinator();
  coordinator.isOpen = false;
  coordinator.talkbackEnabled = false;
  coordinator.tts = {
    feedChunk: () => { feedChunkCalled = true; },
    finishStream: () => { finishStreamCalled = true; }
  };

  coordinator.handleStreamChunk("Normal chat text");
  assert.equal(feedChunkCalled, false);

  coordinator.handleStreamEnd("Normal chat text");
  assert.equal(feedChunkCalled, false);
  assert.equal(finishStreamCalled, false);
});

test("VelaVoiceAssistantCoordinator feeds stream when closed if talkback is explicitly enabled", () => {
  let feedChunkCalledWith = "";
  let finishStreamCalled = false;

  const coordinator = new VelaVoiceAssistantCoordinator({ talkbackEnabled: true });
  coordinator.isOpen = false;
  coordinator.tts = {
    feedChunk: (chunk) => { feedChunkCalledWith += chunk; },
    finishStream: () => { finishStreamCalled = true; }
  };

  coordinator.handleStreamChunk("Talkback message.");
  assert.equal(feedChunkCalledWith, "Talkback message.");

  coordinator.handleStreamEnd("Talkback message.");
  assert.equal(finishStreamCalled, true);
});

test("VelaVoiceAssistantCoordinator formats composer input with proper spacing and punctuation", () => {
  const dispatchedEvents = [];
  const fakeInput = {
    value: "Initial message",
    dispatchEvent: (e) => dispatchedEvents.push(e)
  };

  const coordinator = new VelaVoiceAssistantCoordinator();
  coordinator._getElement = () => fakeInput;

  // Case 1: normal phrase appended
  coordinator.composerBaselineText = "Initial message";
  coordinator._updateComposerInput("second sentence", false);
  assert.equal(fakeInput.value, "Initial message second sentence");
  assert.equal(dispatchedEvents.length, 1);

  // Case 2: transcript starting with punctuation attaches directly without leading space
  coordinator.composerBaselineText = "Hello world";
  coordinator._updateComposerInput(", how are you?", false);
  assert.equal(fakeInput.value, "Hello world, how are you?");

  // Case 3: multi-line baseline with newline preserved
  coordinator.composerBaselineText = "First line\n";
  coordinator._updateComposerInput("Second line", false);
  assert.equal(fakeInput.value, "First line\nSecond line");
});

test("VelaVoiceAssistantCoordinator barge-in interruption halts speech and LLM generation", () => {
  let ttsStopped = false;
  let generationStopped = false;
  let sttReset = false;

  const coordinator = new VelaVoiceAssistantCoordinator({
    stopGeneration: () => {
      generationStopped = true;
    }
  });

  coordinator.isOpen = true;
  coordinator.tts = {
    isSpeaking: true,
    stop: () => { ttsStopped = true; }
  };
  coordinator.stt = {
    resetTranscript: () => { sttReset = true; },
    start: () => {},
    stop: () => {}
  };
  coordinator.globe = {
    state: "speaking",
    setState: (s) => { coordinator.globe.state = s; },
    stop: () => {}
  };

  // Trigger barge-in
  coordinator.interrupt();

  assert.equal(ttsStopped, true, "TTS speech should immediately halt");
  assert.equal(generationStopped, true, "LLM generation should be stopped");
  assert.equal(sttReset, true, "STT transcript buffer should be reset for new utterance");
  assert.equal(coordinator.globe.state, "interrupted", "Globe should flash interrupted state");
  coordinator.closeHUD();
});

test("VelaVoiceAssistantCoordinator bindDOMEvents registers settings, backdrop and shortcuts", async () => {
  const listeners = {};

  const elements = {
    composerVoiceButton: {
      addEventListener: (type, fn) => { listeners.composerBtn = fn; },
      setAttribute: () => {},
      classList: { toggle: () => {} },
      contains: () => false
    },
    composerVoiceMenu: {
      classList: { add: () => {}, remove: () => {} },
      hidden: true,
      contains: () => false
    },
    composerMenuDictate: { addEventListener: (type, fn) => { listeners.menuDictate = fn; } },
    composerMenuVoiceAssistant: { addEventListener: (type, fn) => { listeners.menuVoiceAssistant = fn; } },
    composerMenuVoiceSettings: { addEventListener: (type, fn) => { listeners.menuVoiceSettings = fn; } },
    topbarVoiceAssistant: { addEventListener: (type, fn) => { listeners.topbarBtn = fn; } },
    voiceHudBackdrop: { addEventListener: (type, fn) => { listeners.backdrop = fn; } },
    voiceDockMuteBtn: { addEventListener: (type, fn) => { listeners.muteBtn = fn; } },
    voiceDockInterruptBtn: { addEventListener: (type, fn) => { listeners.interruptBtn = fn; } },
    voiceDockSettingsBtn: { addEventListener: (type, fn) => { listeners.settingsBtn = fn; } },
    voiceDockEndBtn: { addEventListener: (type, fn) => { listeners.endBtn = fn; } },
    voiceHudCloseBtn: { addEventListener: (type, fn) => { listeners.closeBtn = fn; } },
    voiceSettingsClose: { addEventListener: (type, fn) => { listeners.settingsClose = fn; } },
    voiceSettingsBackdrop: { addEventListener: (type, fn) => { listeners.settingsBackdrop = fn; } }
  };

  const fakeWindow = {
    addEventListener: (type, fn) => { listeners.windowKeydown = fn; }
  };

  const CoordinatorWithWindow = await loadCoordinator(fakeWindow);
  const coordinator = new CoordinatorWithWindow();
  coordinator._getElement = (id) => elements[id] || null;

  coordinator.bindDOMEvents();

  // Settings dock button now opens voice settings modal
  assert.ok(listeners.settingsBtn, "Settings button click listener registered");
  listeners.settingsBtn();
  assert.equal(coordinator.isVoiceSettingsOpen, true, "Clicking settings button opens voice settings modal");

  // Close voice settings
  coordinator.closeVoiceSettings();
  assert.equal(coordinator.isVoiceSettingsOpen, false, "closeVoiceSettings resets state");

    assert.ok(listeners.backdrop, "Backdrop click listener registered");
    coordinator.isOpen = true;
    listeners.backdrop();
    assert.equal(coordinator.isOpen, false, "Clicking backdrop closes HUD");

    // Keyboard shortcut Escape when dictating
    coordinator.isComposerDictating = true;
    let defaultPrevented = false;
    listeners.windowKeydown({ key: "Escape", preventDefault: () => { defaultPrevented = true; } });
    assert.equal(coordinator.isComposerDictating, false, "Escape stops composer dictation");
    assert.equal(defaultPrevented, true);

    // Keyboard shortcut Alt+V toggles HUD
    coordinator.isOpen = false;
    listeners.windowKeydown({ altKey: true, code: "KeyV", preventDefault: () => {} });
    assert.equal(coordinator.isOpen, true, "Alt+V opens HUD");
    coordinator.closeHUD();
    assert.equal(coordinator.isOpen, false, "closeHUD cleans up timers");
});

test("VelaVoiceAssistantCoordinator suppresses code fences from TTS during streaming and announces created artifact on completion", () => {
  const fedChunks = [];
  let finished = false;

  const coordinator = new VelaVoiceAssistantCoordinator();
  coordinator.isOpen = true;
  coordinator.tts = {
    feedChunk: (chunk) => fedChunks.push(chunk),
    finishStream: () => { finished = true; }
  };

  // Chunk 1: conversational intro
  coordinator.handleStreamChunk("Here is the latest intelligence report: ");
  assert.equal(fedChunks.length, 1);
  assert.equal(fedChunks[0], "Here is the latest intelligence report: ");

  // Chunk 2: model enters markdown code fence with YAML frontmatter
  coordinator.handleStreamChunk("Here is the latest intelligence report: \n```markdown\n---\ntitle: \"Next 7 Days: Global AI & Technology Release Radar\"\nauthor: \"Vela Research\"\n---\n# Next 7 Days: Global AI & Technology Release Radar\nContent...");
  // Should NOT feed the code fence or YAML frontmatter to TTS!
  assert.equal(fedChunks.length, 1);

  // Stream ends with full completed markdown document and closing remarks
  const finalText = "Here is the latest intelligence report: \n```markdown\n---\ntitle: \"Next 7 Days: Global AI & Technology Release Radar\"\nauthor: \"Vela Research\"\n---\n# Next 7 Days: Global AI & Technology Release Radar\nContent...\n```\nLet me know if you need any follow-up analysis.";
  coordinator.handleStreamEnd(finalText);

  // Should have fed document announcement and closing remarks without code blocks
  assert.equal(finished, true);
  assert.equal(fedChunks.length, 2);
  assert.ok(fedChunks[1].includes("I've created the document, \"Next 7 Days: Global AI & Technology Release Radar\", in the chat for you to see."));
  assert.ok(fedChunks[1].includes("Let me know if you need any follow-up analysis."));
  assert.ok(!fedChunks[1].includes("```"));
  assert.ok(!fedChunks[1].includes("author: \"Vela Research\""));
});

test("VelaVoiceAssistantCoordinator announces document creation even when model starts directly with code fence", () => {
  const fedChunks = [];
  let finished = false;

  const coordinator = new VelaVoiceAssistantCoordinator();
  coordinator.isOpen = true;
  coordinator.tts = {
    feedChunk: (chunk) => fedChunks.push(chunk),
    finishStream: () => { finished = true; }
  };

  const rawDocument = "```html\n<title>Quantum Simulator</title>\n<h1>Simulator</h1>\n```";
  coordinator.handleStreamChunk(rawDocument);
  // Code suppressed during streaming
  assert.equal(fedChunks.length, 0);

  coordinator.handleStreamEnd(rawDocument);
  assert.equal(finished, true);
  assert.equal(fedChunks.length, 1);
  assert.ok(fedChunks[0].includes("I've created the website, \"Quantum Simulator\", in the chat for you to see."));
  assert.ok(!fedChunks[0].includes("```"));
  assert.ok(!fedChunks[0].includes("<title>"));
});

