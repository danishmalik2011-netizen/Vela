(() => {
  "use strict";

  /**
   * Sentence boundary splitting helper for streaming tokens.
   * Recognizes standard sentence delimiters (. ! ? \n) while
   * avoiding false splits on abbreviations and numbers.
   */
  const COMMON_ABBREVIATIONS = new Set([
    "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "vs", "etc", "inc", "ltd", "co",
    "corp", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
    "approx", "apt", "dept", "est", "min", "max", "no", "vs", "eg", "ie"
  ]);

  function isSentenceBoundary(text, index) {
    const char = text[index];
    if (![".", "!", "?", "\n"].includes(char)) return false;

    // Line break is always a boundary if surrounded by content
    if (char === "\n") return true;

    // Check if next character is whitespace or end of string
    const nextChar = text[index + 1];
    if (nextChar !== undefined && !/\s/.test(nextChar)) {
      // E.g. decimal in 3.14 or url domain vela.ai
      return false;
    }

    // If period, check for common abbreviations
    if (char === ".") {
      const preceding = text.slice(0, index).trim();
      const lastWordMatch = preceding.match(/([a-zA-Z]+)$/);
      if (lastWordMatch) {
        const word = lastWordMatch[1].toLowerCase();
        if (COMMON_ABBREVIATIONS.has(word)) return false;
        // Single capital letter like "J. K. Rowling"
        if (lastWordMatch[1].length === 1 && /^[A-Z]$/.test(lastWordMatch[1])) return false;
      }
    }

    return true;
  }

  function extractSentences(buffer, isFinal = false) {
    const sentences = [];
    let start = 0;
    let i = 0;

    while (i < buffer.length) {
      if (isSentenceBoundary(buffer, i)) {
        // Include delimiter in the sentence
        let end = i + 1;
        // Also capture any immediate closing quotes/brackets like ." or !)
        while (end < buffer.length && /['"”)\]]/.test(buffer[end])) {
          end++;
        }
        const sentence = buffer.slice(start, end).trim();
        if (sentence) {
          sentences.push(sentence);
        }
        // Advance past following whitespace
        while (end < buffer.length && /\s/.test(buffer[end])) {
          end++;
        }
        start = end;
        i = end;
      } else {
        i++;
      }
    }

    let remaining = buffer.slice(start);
    if (isFinal && remaining.trim()) {
      sentences.push(remaining.trim());
      remaining = "";
    }

    return { sentences, remaining };
  }

  /**
   * Cleans Markdown formatting, code blocks, and syntax delimiters
   * for natural speech synthesis.
   */
  function cleanTextForSpeech(text) {
    if (!text || typeof text !== "string") return "";
    return text
      // Strip YAML frontmatter (closed or unclosed)
      .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/g, "")
      .replace(/^---[\s\S]*$/g, "")
      // Strip fenced code blocks (closed or unclosed)
      .replace(/```[\w.+#-]*\s*[\s\S]*?```/g, "")
      .replace(/```[\s\S]*$/g, "")
      // Strip TeX math blocks and inline math
      .replace(/\$\$[\s\S]*?\$\$/g, "")
      .replace(/\\\[[\s\S]*?\\\]/g, "")
      .replace(/\\\([\s\S]*?\\\)/g, "")
      .replace(/(?:^|\s)\$([^$\n]+)\$(?:\s|$)/g, " ")
      // Strip HTML tags
      .replace(/<[^>]+>/g, "")
      // Strip citations and footnotes e.g. [1], [2], [1, 2], [1-3], [^1], [citation needed]
      .replace(/\[\^?[0-9]+(?:[-,–\s]+[0-9]+)*\]/g, "")
      .replace(/\[(?:citation needed|note|ref|source|sources)\]/gi, "")
      // Strip images ![alt](url)
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "")
      // Convert markdown links [text](url) -> text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      // Strip bare URLs
      .replace(/https?:\/\/\S+/gi, "")
      // Strip markdown headings #, ##, ###
      .replace(/^#{1,6}\s+/gm, "")
      // Strip blockquote markers
      .replace(/^[ \t]*>[ \t]*/gm, "")
      // Strip horizontal rules
      .replace(/^[ \t]*(?:---+|\*\*\*+|___+)[ \t]*$/gm, "")
      // Strip table separator lines and table bars
      .replace(/^[ \t]*\|[\s:-|-]+\|[ \t]*$/gm, "")
      .replace(/\|/g, " ")
      // Strip bold & italic markers
      .replace(/(\*\*|__)(.*?)\1/g, "$2")
      .replace(/(\*|_)(.*?)\1/g, "$2")
      // Strip strikethrough
      .replace(/~~(.*?)~~/g, "$1")
      // Strip inline backtick code
      .replace(/`([^`]+)`/g, "$1")
      .replace(/`/g, "")
      // Strip list markers
      .replace(/^[ \t]*[\*\-+]\s+/gm, "")
      .replace(/^[ \t]*\d+\.\s+/gm, "")
      // Strip emojis and pictographs
      .replace(/[\p{Extended_Pictographic}\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}]/gu, "")
      // Strip decorative symbols that speech synthesis shouldn't pronounce
      .replace(/[•·→←★☆✓✔❌✕■□◆▲▼<>~^]/g, "")
      // Collapse whitespace and fix spacing before punctuation
      .replace(/\s+/g, " ")
      .replace(/\s+([,.:;?!])/g, "$1")
      .trim();
  }

  const VELA_CHARACTERS = [
    {
      id: "vela",
      name: "Vela",
      neuralVoice: "alloy",
      speechVoiceKeywords: ["samantha", "natural", "google uk english female", "karen", "en-us"],
      gender: "female",
      accent: "Neutral / Warm",
      tagline: "Thoughtful & Natural",
      description: "Balanced, warm, mindful, and articulate. Vela's signature conversational voice.",
      sampleText: "Hello, I'm Vela. I'm ready to collaborate, explore ideas, and build with you."
    },
    {
      id: "aether",
      name: "Aether",
      neuralVoice: "echo",
      speechVoiceKeywords: ["daniel", "google us english male", "oliver", "alex", "en-gb"],
      gender: "male",
      accent: "Deep / Calm",
      tagline: "Thoughtful & Measured",
      description: "Deep, calm, philosophical resonance for in-depth focus and architectural reasoning.",
      sampleText: "Greetings, I'm Aether. Let's delve into the nuances of your system design and problem space."
    },
    {
      id: "nova",
      name: "Nova",
      neuralVoice: "nova",
      speechVoiceKeywords: ["victoria", "google us english female", "moira", "fiona", "en-us"],
      gender: "female",
      accent: "Lively / Crisp",
      tagline: "Energetic & Sharp",
      description: "Bright, energetic, and articulate. Ideal for creative brainstorming and rapid iterations.",
      sampleText: "Hey there! I'm Nova. Let's move fast, spark fresh thinking, and bring your ideas to life!"
    },
    {
      id: "sol",
      name: "Sol",
      neuralVoice: "onyx",
      speechVoiceKeywords: ["fred", "google uk english male", "arthur", "george", "en-us"],
      gender: "male",
      accent: "Rich / Grounded",
      tagline: "Grounded & Authoritative",
      description: "Confident, grounded baritone with steady presence for executive summaries and reviews.",
      sampleText: "Good day, I'm Sol. I provide direct, concise, and structured perspectives on your work."
    },
    {
      id: "sage",
      name: "Sage",
      neuralVoice: "shimmer",
      speechVoiceKeywords: ["serena", "tessa", "google australian english female", "veena", "en-au"],
      gender: "female",
      accent: "Gentle / Empathetic",
      tagline: "Gentle & Attuned",
      description: "Soft, gentle cadence with empathetic inflection, crafted for serene reflection.",
      sampleText: "Hello, I'm Sage. Take your time, and together we can gently unravel any complex question."
    },
    {
      id: "fable",
      name: "Fable",
      neuralVoice: "fable",
      speechVoiceKeywords: ["stephanie", "google uk english female", "kate", "en-gb"],
      gender: "neutral",
      accent: "Cultured / Expressive",
      tagline: "Expressive & Scholarly",
      description: "Warm British cadence with literary clarity and imaginative nuance.",
      sampleText: "Splendid to meet you. I'm Fable, delighted to assist with prose, research, and intricate thought."
    }
  ];

  class VelaTTSEngine {
    constructor(options = {}) {
      this.options = {
        character: options.character || "vela",
        voice: options.voice || null,
        rate: options.rate || 1.0,
        pitch: options.pitch || 1.0,
        volume: options.volume || 1.0,
        neuralVoice: options.neuralVoice || "alloy",
        neuralModel: options.neuralModel || "tts-1",
        mode: options.mode || "auto", // "auto" | "speechSynthesis" | "server"
        audioEndpoint: options.audioEndpoint || "/api/audio/speech",
        getProviderConfig: options.getProviderConfig || null,
        audioContext: options.audioContext || null,
        analyserNode: options.analyserNode || null,
        onSentenceStart: options.onSentenceStart || null,
        onSentenceEnd: options.onSentenceEnd || null,
        onAllSpoken: options.onAllSpoken || null,
        onAudioActivity: options.onAudioActivity || null,
        onStop: options.onStop || null,
        onPreviewStart: options.onPreviewStart || null,
        onPreviewEnd: options.onPreviewEnd || null,
        speakHandler: options.speakHandler || null,
        ...options
      };

      this.activeCharacter = this.options.character || "vela";
      const initialChar = VELA_CHARACTERS.find((c) => c.id === this.activeCharacter);
      if (initialChar && !options.neuralVoice) {
        this.options.neuralVoice = initialChar.neuralVoice;
      }

      this.queue = [];
      this.buffer = "";
      this.isSpeaking = false;
      this._streamEnded = false;
      this._currentUtterance = null;
      this._currentAudio = null;
      this._currentAudioSource = null;
      this._cadenceInterval = null;

      this.isPreviewing = false;
      this._previewUtterance = null;
      this._previewAudio = null;
      this._activePreviewCharacter = null;
    }

    static isSpeechSynthesisSupported() {
      return typeof window !== "undefined" && "speechSynthesis" in window;
    }

    getVoices() {
      if (!VelaTTSEngine.isSpeechSynthesisSupported()) return [];
      return window.speechSynthesis.getVoices() || [];
    }

    feedChunk(chunk) {
      if (!chunk || typeof chunk !== "string") return;
      this.buffer += chunk;

      const { sentences, remaining } = extractSentences(this.buffer, false);
      this.buffer = remaining;

      if (sentences.length > 0) {
        for (const sentence of sentences) {
          this.queue.push(sentence);
        }
        this._processQueue();
      }
    }

    finishStream() {
      this._streamEnded = true;
      if (this.buffer.trim()) {
        const { sentences } = extractSentences(this.buffer, true);
        this.buffer = "";
        for (const sentence of sentences) {
          this.queue.push(sentence);
        }
      }
      this._processQueue();
    }

    speak(text) {
      if (!text || typeof text !== "string") return;
      this.stop();
      const { sentences } = extractSentences(text, true);
      this.queue = sentences;
      this._streamEnded = true;
      this._processQueue();
    }

    _processQueue() {
      if (this.isSpeaking) return;

      if (this.queue.length === 0) {
        if (this._streamEnded) {
          this._streamEnded = false;
          if (typeof this.options.onAllSpoken === "function") {
            this.options.onAllSpoken();
          }
        }
        return;
      }

      const rawSentence = this.queue.shift();
      if (!rawSentence) {
        this._processQueue();
        return;
      }

      const sentence = cleanTextForSpeech(rawSentence);
      if (!sentence) {
        this._processQueue();
        return;
      }

      this.isSpeaking = true;
      if (typeof this.options.onSentenceStart === "function") {
        this.options.onSentenceStart(sentence);
      }

      if (typeof this.options.speakHandler === "function") {
        this.options.speakHandler(sentence, () => {
          this.isSpeaking = false;
          this._processQueue();
        });
        return;
      }

      const useServer =
        this.options.mode === "server" ||
        (!VelaTTSEngine.isSpeechSynthesisSupported() && this.options.mode === "auto");

      if (useServer) {
        this._speakWithServer(sentence);
      } else {
        this._speakWithSpeechSynthesis(sentence);
      }
    }

    _speakWithSpeechSynthesis(sentence) {
      if (!VelaTTSEngine.isSpeechSynthesisSupported()) {
        this._speakWithServer(sentence);
        return;
      }

      try {
        const utterance = new SpeechSynthesisUtterance(sentence);
        utterance.rate = this.options.rate;
        utterance.pitch = this.options.pitch;
        utterance.volume = this.options.volume;

        if (this.options.voice) {
          utterance.voice = this.options.voice;
        } else {
          // Select an optimal voice if available
          const voices = this.getVoices();
          const preferredVoice = voices.find(
            (v) => (v.name.includes("Natural") || v.name.includes("Google") || v.name.includes("Samantha")) && v.lang.startsWith("en")
          ) || voices.find((v) => v.lang.startsWith("en"));
          if (preferredVoice) utterance.voice = preferredVoice;
        }

        this._currentUtterance = utterance;

        // Simulate natural audio activity envelope for speech synthesis
        this._startCadenceSimulation();

        utterance.onboundary = () => {
          if (typeof this.options.onAudioActivity === "function") {
            this.options.onAudioActivity(0.6 + Math.random() * 0.4);
          }
        };

        // Safety watchdog timer: Chrome speech synthesis can occasionally hang indefinitely
        const maxDuration = Math.max(4500, sentence.length * 130);
        const watchdogTimer = setTimeout(() => {
          if (this._currentUtterance === utterance) {
            this._stopCadenceSimulation();
            this._currentUtterance = null;
            this.isSpeaking = false;
            if (typeof this.options.onSentenceEnd === "function") {
              this.options.onSentenceEnd(sentence);
            }
            this._processQueue();
          }
        }, maxDuration);

        utterance.onend = () => {
          clearTimeout(watchdogTimer);
          this._stopCadenceSimulation();
          this._currentUtterance = null;
          this.isSpeaking = false;
          if (typeof this.options.onSentenceEnd === "function") {
            this.options.onSentenceEnd(sentence);
          }
          this._processQueue();
        };

        utterance.onerror = (e) => {
          clearTimeout(watchdogTimer);
          this._stopCadenceSimulation();
          const wasCurrent = this._currentUtterance === utterance;
          this._currentUtterance = null;
          this.isSpeaking = false;

          // If canceled via stop(), do not treat as error and do not re-trigger queue
          if (e.error === "canceled" || e.error === "interrupted" || !wasCurrent) {
            return;
          }

          if (typeof this.options.onError === "function") {
            this.options.onError(e);
          }
          this._processQueue();
        };

        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }

        window.speechSynthesis.speak(utterance);
      } catch (err) {
        this._stopCadenceSimulation();
        this.isSpeaking = false;
        if (typeof this.options.onError === "function") {
          this.options.onError(err);
        }
        this._processQueue();
      }
    }

    async _speakWithServer(sentence) {
      try {
        const providerConfig = typeof this.options.getProviderConfig === "function"
          ? this.options.getProviderConfig()
          : {};

        const payload = {
          input: sentence,
          voice: this.options.neuralVoice || "alloy",
          model: this.options.neuralModel || "tts-1",
          speed: this.options.rate || 1.0,
          response_format: "mp3",
          apiKey: providerConfig.apiKey || "",
          endpoint: providerConfig.endpoint || ""
        };

        const response = await fetch(this.options.audioEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          throw new Error(`TTS server request failed with status ${response.status}`);
        }

        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        this._currentAudio = audio;

        // Wire to Web Audio API Analyser if audioContext and analyserNode exist
        if (this.options.audioContext && this.options.analyserNode) {
          try {
            const source = this.options.audioContext.createMediaElementSource(audio);
            source.connect(this.options.analyserNode);
            this.options.analyserNode.connect(this.options.audioContext.destination);
            this._currentAudioSource = source;
          } catch {}
        }

        audio.onended = () => {
          URL.revokeObjectURL(audioUrl);
          this._cleanupAudio();
          this.isSpeaking = false;
          if (typeof this.options.onSentenceEnd === "function") {
            this.options.onSentenceEnd(sentence);
          }
          this._processQueue();
        };

        audio.onerror = (e) => {
          URL.revokeObjectURL(audioUrl);
          this._cleanupAudio();
          this.isSpeaking = false;
          if (VelaTTSEngine.isSpeechSynthesisSupported()) {
            this._speakWithSpeechSynthesis(sentence);
            return;
          }
          if (typeof this.options.onError === "function") {
            this.options.onError(e);
          }
          this._processQueue();
        };

        await audio.play();
      } catch (err) {
        this._cleanupAudio();
        this.isSpeaking = false;
        if (VelaTTSEngine.isSpeechSynthesisSupported()) {
          this._speakWithSpeechSynthesis(sentence);
          return;
        }
        if (typeof this.options.onError === "function") {
          this.options.onError(err);
        }
        this._processQueue();
      }
    }

    _cleanupAudio() {
      if (this._currentAudio) {
        this._currentAudio.onended = null;
        this._currentAudio.onerror = null;
        this._currentAudio.pause();
        this._currentAudio.src = "";
        this._currentAudio = null;
      }
      this._currentAudioSource = null;
    }

    _startCadenceSimulation() {
      this._stopCadenceSimulation();
      this._cadenceInterval = setInterval(() => {
        if (!this.isSpeaking) {
          this._stopCadenceSimulation();
          return;
        }
        if (typeof this.options.onAudioActivity === "function") {
          // Synthetic prosody wave between 0.2 and 0.85
          const activity = 0.25 + 0.55 * Math.abs(Math.sin(Date.now() / 140));
          this.options.onAudioActivity(activity);
        }
      }, 50);
    }

    _stopCadenceSimulation() {
      if (this._cadenceInterval) {
        clearInterval(this._cadenceInterval);
        this._cadenceInterval = null;
      }
      if (typeof this.options.onAudioActivity === "function") {
        this.options.onAudioActivity(0);
      }
    }

    static getCharacters() {
      return VELA_CHARACTERS.map((c) => ({
        id: c.id,
        name: c.name,
        neuralVoice: c.neuralVoice,
        gender: c.gender,
        accent: c.accent,
        tagline: c.tagline,
        description: c.description,
        sampleText: c.sampleText
      }));
    }

    setCharacter(characterId) {
      const char = VELA_CHARACTERS.find((c) => c.id === characterId);
      if (!char) return false;
      this.activeCharacter = char.id;
      this.options.neuralVoice = char.neuralVoice;

      // Try to match a suitable speech synthesis voice
      if (VelaTTSEngine.isSpeechSynthesisSupported()) {
        const voices = this.getVoices();
        const matched = char.speechVoiceKeywords.reduce((found, kw) => {
          if (found) return found;
          return voices.find((v) => v.name.toLowerCase().includes(kw) && v.lang.startsWith("en"));
        }, null);
        if (matched) this.options.voice = matched;
      }

      return true;
    }

    speakPreview(characterId) {
      this.stopPreview();
      const char = VELA_CHARACTERS.find((c) => c.id === characterId);
      if (!char) return;

      this.isPreviewing = true;
      this._activePreviewCharacter = char.id;

      if (typeof this.options.onPreviewStart === "function") {
        this.options.onPreviewStart(char.id);
      }

      const text = char.sampleText;

      // Use SpeechSynthesis for previews (works offline, no API key needed)
      if (VelaTTSEngine.isSpeechSynthesisSupported()) {
        try {
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.rate = this.options.rate || 1.0;
          utterance.pitch = this.options.pitch || 1.0;
          utterance.volume = this.options.volume || 1.0;

          const voices = this.getVoices();
          const matched = char.speechVoiceKeywords.reduce((found, kw) => {
            if (found) return found;
            return voices.find((v) => v.name.toLowerCase().includes(kw) && v.lang.startsWith("en"));
          }, null);
          if (matched) utterance.voice = matched;

          this._previewUtterance = utterance;

          utterance.onend = () => {
            this._previewUtterance = null;
            this.isPreviewing = false;
            this._activePreviewCharacter = null;
            if (typeof this.options.onPreviewEnd === "function") {
              this.options.onPreviewEnd(char.id);
            }
          };

          utterance.onerror = (e) => {
            this._previewUtterance = null;
            this.isPreviewing = false;
            this._activePreviewCharacter = null;
            if (e.error !== "canceled" && e.error !== "interrupted") {
              if (typeof this.options.onPreviewEnd === "function") {
                this.options.onPreviewEnd(char.id);
              }
            }
          };

          if (window.speechSynthesis.paused) {
            window.speechSynthesis.resume();
          }

          window.speechSynthesis.speak(utterance);
        } catch {
          this.isPreviewing = false;
          this._activePreviewCharacter = null;
        }
      }
    }

    stopPreview() {
      if (!this.isPreviewing) return;
      this.isPreviewing = false;
      this._activePreviewCharacter = null;

      if (this._previewUtterance) {
        this._previewUtterance.onend = null;
        this._previewUtterance.onerror = null;
        this._previewUtterance = null;
      }

      if (this._previewAudio) {
        this._previewAudio.pause();
        this._previewAudio.src = "";
        this._previewAudio = null;
      }

      if (VelaTTSEngine.isSpeechSynthesisSupported()) {
        try {
          window.speechSynthesis.cancel();
        } catch {}
      }

      if (typeof this.options.onPreviewEnd === "function") {
        this.options.onPreviewEnd(null);
      }
    }

    stop() {
      this.queue = [];
      this.buffer = "";
      this._streamEnded = false;
      this._stopCadenceSimulation();

      if (VelaTTSEngine.isSpeechSynthesisSupported()) {
        try {
          window.speechSynthesis.cancel();
        } catch {}
      }

      this._cleanupAudio();
      this._currentUtterance = null;
      this.isSpeaking = false;

      if (typeof this.options.onStop === "function") {
        this.options.onStop();
      }
    }
  }

  globalThis.VelaTTSEngine = VelaTTSEngine;
  globalThis.extractSentences = extractSentences;
  globalThis.cleanTextForSpeech = cleanTextForSpeech;
  globalThis.COMMON_ABBREVIATIONS = COMMON_ABBREVIATIONS;
  globalThis.VELA_CHARACTERS = VELA_CHARACTERS;
})();
