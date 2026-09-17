(() => {
  "use strict";

  const OPENING_GREETINGS = [
    "Hey, how's it going?",
    "Hello! How can I help you today?",
    "Hey there! What's on your mind today?",
    "Hi! Ready whenever you are.",
    "Hey! What can I help you build today?",
    "Hello! I'm all ears."
  ];

  class VelaVoiceAssistantCoordinator {
    constructor(options = {}) {
      this.options = {
        hudOverlayId: options.hudOverlayId || "voiceHudOverlay",
        canvasId: options.canvasId || "voiceGlobeCanvas",
        statusTextId: options.statusTextId || "voiceHudStatusText",
        timerId: options.timerId || "voiceHudTimer",
        transcriptRoleId: options.transcriptRoleId || "voiceHudTranscriptRole",
        transcriptTextId: options.transcriptTextId || "voiceHudTranscriptText",
        muteBtnId: options.muteBtnId || "voiceDockMuteBtn",
        interruptBtnId: options.interruptBtnId || "voiceDockInterruptBtn",
        endBtnId: options.endBtnId || "voiceDockEndBtn",
        closeBtnId: options.closeBtnId || "voiceHudCloseBtn",
        settingsBtnId: options.settingsBtnId || "voiceDockSettingsBtn",
        backdropId: options.backdropId || "voiceHudBackdrop",
        composerVoiceBtnId: options.composerVoiceBtnId || "composerVoiceButton",
        composerInputId: options.composerInputId || "composerInput",
        composerVoiceMenuId: options.composerVoiceMenuId || "composerVoiceMenu",
        voiceSettingsModalId: options.voiceSettingsModalId || "voiceSettingsModal",
        getProviderConfig: options.getProviderConfig || null,
        submitPrompt: options.submitPrompt || null,
        stopGeneration: options.stopGeneration || null,
        onOpenSettings: options.onOpenSettings || null,
        ...options
      };

      this.isOpen = false;
      this.isMuted = false;
      this.talkbackEnabled = typeof options.talkbackEnabled === "boolean"
        ? options.talkbackEnabled
        : (typeof localStorage !== "undefined" && localStorage.getItem("vela-voice-talkback") === "true");
      this.isComposerMenuOpen = false;
      this.isVoiceSettingsOpen = false;
      this.sessionTimer = null;
      this.sessionSeconds = 0;
      this.audioContext = null;
      this.micAnalyser = null;
      this.micStream = null;
      this.micSource = null;

      this.stt = null;
      this.tts = null;
      this.globe = null;

      this.composerSTT = null;
      this.isComposerDictating = false;
      this.composerBaselineText = "";

      this._lastReceivedTextLength = 0;
      this._streamedConversationalLength = 0;
      this._hasStreamedArtifact = false;

      this._initEngines();
    }

    _initEngines() {
      if (typeof window === "undefined") return;

      const STTEngineClass = window.VelaSTTEngine;
      const TTSEngineClass = window.VelaTTSEngine;

      if (TTSEngineClass) {
        this.tts = new TTSEngineClass({
          getProviderConfig: this.options.getProviderConfig,
          onSentenceStart: (sentence) => {
            this._setHUDStatus("Speaking…");
            this._setGlobeState("speaking");
            this._setHUDTranscript("Vela", sentence);
            // Pause STT while assistant is speaking through device speakers to avoid acoustic feedback
            if (this.stt?.isListening) {
              this.stt.stop();
            }
          },
          onAllSpoken: () => {
            if (this._greetingTimer) {
              clearTimeout(this._greetingTimer);
              this._greetingTimer = null;
            }
            this._isProcessingQuery = false;
            if (this.isOpen && !this.isMuted) {
              this._setHUDStatus("Listening…");
              this._setGlobeState("listening");
              this._setHUDTranscript("Vela", "Listening… Speak naturally.");
              this.stt?.resetTranscript?.();
              if (!this.stt?.isListening) {
                this.stt?.start(this.micStream);
              }
            } else if (this.isOpen) {
              this._setHUDStatus("Muted");
              this._setGlobeState("idle");
            }
          },
          onAudioActivity: (level) => {
            if (this.globe && this.globe.state === "speaking") {
              this.globe.setSyntheticActivity(level);
            }
          },
          onStop: () => {
            if (this.globe && this.globe.state === "speaking") {
              this.globe.setSyntheticActivity(0);
            }
          }
        });
      }

      if (STTEngineClass) {
        // Voice Assistant STT - 1400ms silence timeout after speech for fast, natural response
        this.stt = new STTEngineClass({
          silenceTimeoutMs: 1400,
          getProviderConfig: this.options.getProviderConfig,
          onSpeechStart: () => {
            // User began speaking
            if (this.isOpen && !this.isMuted) {
              this._setHUDStatus("Listening…");
              this._setGlobeState("listening");
            }
          },
          onInterim: (fullTranscript, delta) => {
            if (this.isOpen && !this.isMuted) {
              this._setHUDTranscript("You", fullTranscript || delta);
              this._setGlobeState("listening");
            }
          },
          onFinal: (fullTranscript, finalChunk) => {
            const query = (fullTranscript || finalChunk || "").trim();
            if (this.isOpen && query && !this.isMuted) {
              this._handleUserVoiceQuery(query);
            }
          },
          onError: (err) => {
            console.warn("Voice Assistant STT error:", err);
            // If transcription fails, resume listening so user can retry
            if (this.isOpen && !this.isMuted) {
              setTimeout(() => {
                if (this.isOpen && !this.isMuted && !this.stt?.isListening) {
                  this._setHUDStatus("Listening…");
                  this._setGlobeState("listening");
                  this.stt?.resetTranscript?.();
                  this.stt?.start?.();
                }
              }, 500);
            }
          },
          onStateChange: (state) => {
            if (state === "processing" && this.isOpen) {
              this._setHUDStatus("Processing…");
              this._setGlobeState("thinking");
            }
          }
        });

        // Composer Dictation STT
        this.composerSTT = new STTEngineClass({
          silenceTimeoutMs: 4000,
          getProviderConfig: this.options.getProviderConfig,
          onInterim: (full, interim) => {
            this._updateComposerInput(full, true);
          },
          onFinal: (full, finalChunk) => {
            this._updateComposerInput(full, false);
          },
          onStateChange: (state) => {
            this._updateComposerVoiceButtonState(state === "listening");
          },
          onError: (err) => {
            console.warn("Composer dictation error:", err);
            this.stopComposerDictation();
          }
        });
      }
    }

    async _ensureAudioContext() {
      if (typeof window === "undefined") return;
      if (!this.audioContext) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          this.audioContext = new AudioCtx();
        }
      }
      if (this.audioContext && this.audioContext.state === "suspended") {
        await this.audioContext.resume().catch(() => {});
      }

      if (!this.micAnalyser && this.audioContext) {
        try {
          this.micAnalyser = this.audioContext.createAnalyser();
          this.micAnalyser.fftSize = 256;
          this.micAnalyser.smoothingTimeConstant = 0.8;

          if (this.tts) {
            this.tts.options.audioContext = this.audioContext;
            this.tts.options.analyserNode = this.micAnalyser;
          }
        } catch (e) {
          console.warn("Could not create audio analyser:", e);
        }
      }

      // Connect mic stream to analyser for reactive listening globe
      if (!this.micSource && this.audioContext && this.micAnalyser && navigator.mediaDevices) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          this.micStream = stream;
          this.micSource = this.audioContext.createMediaStreamSource(stream);
          this.micSource.connect(this.micAnalyser);
        } catch (e) {
          console.warn("Could not attach mic stream to audio analyser:", e);
        }
      }
    }

    _getElement(id) {
      if (typeof document === "undefined" || !id) return null;
      return document.getElementById(id);
    }

    _ensureGlobe() {
      if (this.globe) return;
      if (typeof window === "undefined") return;

      const canvas = this._getElement(this.options.canvasId);
      if (!canvas) return;

      const GlobeClass = window.VelaGlobeRenderer;
      if (!GlobeClass) return;

      this.globe = new GlobeClass(canvas, {
        analyser: this.micAnalyser
      });
    }

    async openHUD() {
      if (this.isOpen) return;
      this.isOpen = true;
      this.isMuted = false;

      // Close composer voice menu and stop dictation if running
      this.closeComposerMenu();
      this.stopComposerDictation();

      const overlay = this._getElement(this.options.hudOverlayId);
      if (overlay) {
        overlay.hidden = false;
        overlay.classList.add("is-visible");
      }

      await this._ensureAudioContext();
      if (!this.isOpen) return;
      this._ensureGlobe();

      if (this.globe) {
        if (this.micAnalyser) this.globe.setAudioAnalyser(this.micAnalyser);
        this.globe.setState("speaking");
        this.globe.start();
      }

      this._startSessionTimer();

      // Pick and speak an opening greeting
      const greeting = OPENING_GREETINGS[Math.floor(Math.random() * OPENING_GREETINGS.length)];
      this._setHUDStatus("Speaking…");
      this._setHUDTranscript("Vela", greeting);

      const muteBtn = this._getElement(this.options.muteBtnId);
      if (muteBtn) {
        muteBtn.setAttribute("aria-pressed", "false");
        muteBtn.classList.remove("is-muted");
      }

      // Speak the greeting; when it finishes, transition to listening
      if (this._greetingTimer) {
        clearTimeout(this._greetingTimer);
        this._greetingTimer = null;
      }

      if (this.tts) {
        this.tts.speak(greeting);
        // Safety timeout in case TTS gets blocked, paused, or suspended: transition to listening after 3.8s
        this._greetingTimer = setTimeout(() => {
          if (this.isOpen && !this.isMuted && !this.stt?.isListening) {
            this._setHUDStatus("Listening…");
            this._setGlobeState("listening");
            this._setHUDTranscript("Vela", "Listening… Speak naturally.");
            this.stt?.resetTranscript?.();
            this.stt?.start?.(this.micStream);
          }
        }, 3800);
      } else {
        // No TTS available, immediately go to listening
        this._setHUDStatus("Listening…");
        this._setHUDTranscript("Vela", "Listening… Speak naturally.");
        this._setGlobeState("listening");
        this.stt?.start?.(this.micStream);
      }
    }

    closeHUD() {
      if (!this.isOpen) return;
      this.isOpen = false;
      this._isProcessingQuery = false;

      if (this._greetingTimer) {
        clearTimeout(this._greetingTimer);
        this._greetingTimer = null;
      }

      this._stopSessionTimer();
      if (this._interruptTimer) {
        clearTimeout(this._interruptTimer);
        this._interruptTimer = null;
      }
      this.stt?.stop?.();
      this.tts?.stop?.();

      if (this.globe) {
        this.globe.setState?.("idle");
        this.globe.stop?.();
      }

      if (this.micStream) {
        this.micStream.getTracks().forEach((t) => t.stop());
        this.micStream = null;
        this.micSource = null;
      }

      const overlay = this._getElement(this.options.hudOverlayId);
      if (overlay) {
        overlay.classList.remove("is-visible");
        overlay.hidden = true;
      }
    }

    toggleMute() {
      if (!this.isOpen) return;
      this.isMuted = !this.isMuted;

      const muteBtn = this._getElement(this.options.muteBtnId);
      if (muteBtn) {
        muteBtn.setAttribute("aria-pressed", String(this.isMuted));
        muteBtn.classList.toggle("is-muted", this.isMuted);
      }

      if (this.isMuted) {
        this.stt?.stop();
        this._setHUDStatus("Muted");
        this._setGlobeState("idle");
      } else {
        this._setHUDStatus("Listening…");
        this._setGlobeState("listening");
        this.stt?.start(this.micStream);
      }
    }

    interrupt() {
      this._isProcessingQuery = false;
      // 1. Stop speech synthesis immediately
      this.tts?.stop();

      // 2. Cancel active LLM request if in progress
      if (typeof this.options.stopGeneration === "function") {
        this.options.stopGeneration();
      }

      // 3. Globe interrupted flash
      this._setGlobeState("interrupted");
      this._setHUDStatus("Interrupted");

      // 4. Reset transcript for the user's interrupting utterance
      this.stt?.resetTranscript?.();

      // 5. Quickly settle back to listening
      if (this._interruptTimer) {
        clearTimeout(this._interruptTimer);
      }
      this._interruptTimer = setTimeout(() => {
        this._interruptTimer = null;
        if (this.isOpen && !this.isMuted) {
          this._setGlobeState("listening");
          this._setHUDStatus("Listening…");
          if (!this.stt?.isListening) {
            this.stt?.start?.(this.micStream);
          }
        }
      }, 350);
      if (this._interruptTimer?.unref) {
        this._interruptTimer.unref();
      }
    }

    _handleUserVoiceQuery(query) {
      const trimmed = (query || "").trim();
      if (!trimmed) return;

      if (this._isProcessingQuery) return;
      if (this._lastSubmittedQuery === trimmed && (Date.now() - (this._lastSubmittedTime || 0) < 2500)) {
        return;
      }

      // Filter out accidental echo of the opening greeting (exact match only)
      const lower = trimmed.toLowerCase();
      if (OPENING_GREETINGS.some((g) => g.toLowerCase() === lower)) {
        this.stt?.resetTranscript?.();
        return;
      }

      this._isProcessingQuery = true;
      this._lastSubmittedQuery = trimmed;
      this._lastSubmittedTime = Date.now();
      this._lastReceivedTextLength = 0;
      this._streamedConversationalLength = 0;
      this._hasStreamedArtifact = false;

      this._setHUDTranscript("You", trimmed);
      this._setHUDStatus("Thinking…");
      this._setGlobeState("thinking");

      // Pause STT while waiting for LLM and assistant speech
      this.stt?.stop?.();
      this.stt?.resetTranscript?.();

      if (typeof this.options.submitPrompt === "function") {
        this.options.submitPrompt(trimmed);
      }
    }

    _analyzeStreamText(text) {
      const str = String(text || "");
      const fenceMatches = [...str.matchAll(/```/g)];
      const inCodeBlock = fenceMatches.length % 2 === 1;
      const hasArtifact = fenceMatches.length > 0;

      let conversational = "";
      let lastIndex = 0;
      let firstBlockSnippet = "";
      let firstBlockLang = "";

      for (let i = 0; i < fenceMatches.length; i += 2) {
        conversational += str.slice(lastIndex, fenceMatches[i].index);
        if (i + 1 < fenceMatches.length) {
          const endIdx = fenceMatches[i + 1].index + 3;
          if (!firstBlockSnippet) {
            firstBlockSnippet = str.slice(fenceMatches[i].index, endIdx);
            const m = firstBlockSnippet.match(/^```([\w.+#-]*)/);
            if (m) firstBlockLang = m[1] || "";
          }
          lastIndex = endIdx;
        } else {
          // Unclosed code block currently streaming
          if (!firstBlockSnippet) {
            firstBlockSnippet = str.slice(fenceMatches[i].index);
            const m = firstBlockSnippet.match(/^```([\w.+#-]*)/);
            if (m) firstBlockLang = m[1] || "";
          }
          lastIndex = str.length;
        }
      }
      if (lastIndex < str.length) {
        conversational += str.slice(lastIndex);
      }

      return {
        inCodeBlock,
        hasArtifact,
        conversationalText: conversational.trim(),
        firstBlockLang,
        firstBlockSnippet
      };
    }

    _extractArtifactTitle(snippet, language) {
      if (!snippet) return "";
      const source = snippet.replace(/^```[\w.+#-]*\r?\n?/, "").replace(/\r?\n?```\s*$/, "");
      if (globalThis.VelaArtifacts?.inferredTitle) {
        const title = globalThis.VelaArtifacts.inferredTitle(language, source);
        if (title) return title;
      }
      if (globalThis.VelaArtifacts?.titleFor) {
        const title = globalThis.VelaArtifacts.titleFor(language, source);
        if (title) return title;
      }
      const yamlMatch = source.match(/^\s*title:\s*["']?([^"'\r\n]+)/im);
      if (yamlMatch) return yamlMatch[1].trim();
      const headingMatch = source.match(/^\s*#\s+(.+)$/m);
      if (headingMatch) return headingMatch[1].replace(/[`*_]/g, "").trim();
      const htmlTitleMatch = source.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || source.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
      if (htmlTitleMatch) return htmlTitleMatch[1].replace(/<[^>]+>/g, "").trim();
      return "";
    }

    _artifactKind(language) {
      const lang = String(language || "").toLowerCase();
      if (["html", "htm"].includes(lang)) return "website";
      if (["pdf"].includes(lang)) return "PDF document";
      if (["pptx", "presentation", "slides"].includes(lang)) return "presentation";
      if (["svg", "mermaid"].includes(lang)) return "diagram";
      if (["py", "python", "js", "javascript", "ts", "typescript", "css", "json", "csv"].includes(lang)) return "file";
      return "document";
    }

    _summarizeConversationalText(text, maxSentences = 3) {
      if (!text || typeof text !== "string") return "";
      const cleaned = text.trim();
      if (cleaned.length <= 320) return cleaned;
      const sentences = cleaned.match(/[^.!?\n]+[.!?]+(?:\s+|$)/g);
      if (sentences && sentences.length > 0) {
        const summary = sentences.slice(0, maxSentences).join("").trim();
        if (summary.length >= 60) return summary;
      }
      return cleaned.slice(0, 300).trim() + "…";
    }

    handleStreamChunk(partial) {
      if (!this.isOpen && !this.talkbackEnabled) return;

      const text = typeof partial === "string" ? partial : partial?.text || "";
      if (!text) return;

      // Switch to speaking state as soon as words start arriving (in HUD)
      if (this.isOpen && this.globe && this.globe.state !== "speaking") {
        this._setGlobeState("speaking");
        this._setHUDStatus("Speaking…");
      }

      const analysis = this._analyzeStreamText(text);

      if (!analysis.hasArtifact) {
        // Feed new chunk tokens to TTS for sentence-streaming playback
        const delta = text.slice(this._lastReceivedTextLength || 0);
        if (delta) {
          this.tts?.feedChunk(delta);
        }
        this._lastReceivedTextLength = text.length;
        this._streamedConversationalLength = text.length;

        if (this.isOpen) {
          this._setHUDTranscript("Vela", text);
        }
      } else {
        // Artifact / code fence detected in stream: suppress raw code tokens from TTS
        this._hasStreamedArtifact = true;

        // Feed conversational tokens outside code blocks
        const convDelta = analysis.conversationalText.slice(this._streamedConversationalLength || 0);
        if (convDelta) {
          this.tts?.feedChunk(convDelta);
          this._streamedConversationalLength = analysis.conversationalText.length;
        }
        this._lastReceivedTextLength = text.length;

        if (this.isOpen) {
          if (analysis.inCodeBlock) {
            this._setHUDStatus("Generating document in chat…");
            const preview = analysis.conversationalText
              ? `${analysis.conversationalText}\n\n📄 Generating document in chat…`
              : "📄 Generating document in chat…";
            this._setHUDTranscript("Vela", preview);
          } else {
            this._setHUDStatus("Speaking…");
            const preview = analysis.conversationalText
              ? `${analysis.conversationalText}\n\n📄 Document ready in chat`
              : "📄 Document ready in chat";
            this._setHUDTranscript("Vela", preview);
          }
        }
      }
    }

    handleStreamEnd(finalText) {
      this._isProcessingQuery = false;
      if (!this.isOpen && !this.talkbackEnabled) {
        this._lastReceivedTextLength = 0;
        this._streamedConversationalLength = 0;
        this._hasStreamedArtifact = false;
        return;
      }

      const text = typeof finalText === "string" ? finalText : finalText?.text || "";
      const analysis = this._analyzeStreamText(text);

      if (!analysis.hasArtifact) {
        const remainingDelta = text ? text.slice(this._lastReceivedTextLength || 0) : "";
        if (remainingDelta) {
          this.tts?.feedChunk(remainingDelta);
        }
        this._lastReceivedTextLength = 0;
        this._streamedConversationalLength = 0;
        this._hasStreamedArtifact = false;
        this.tts?.finishStream();
      } else {
        const title = this._extractArtifactTitle(analysis.firstBlockSnippet, analysis.firstBlockLang);
        const kind = this._artifactKind(analysis.firstBlockLang);
        const announcement = title
          ? `I've created the ${kind}, "${title}", in the chat for you to see.`
          : `I've created the ${kind} in the chat for you to see.`;

        const summarizedConv = this._summarizeConversationalText(analysis.conversationalText);
        const remainingConv = summarizedConv.slice(this._streamedConversationalLength || 0);

        if (this._streamedConversationalLength > 0) {
          this.tts?.feedChunk(`\n${announcement}${remainingConv ? ` ${remainingConv}` : ""}`);
        } else {
          this.tts?.feedChunk(`${announcement}${summarizedConv ? ` ${summarizedConv}` : ""}`);
        }

        if (this.isOpen) {
          const hudMessage = summarizedConv
            ? `${summarizedConv}\n\n📄 ${announcement}`
            : `📄 ${announcement}`;
          this._setHUDTranscript("Vela", hudMessage);
          this._setHUDStatus("Speaking…");
        }

        this._lastReceivedTextLength = 0;
        this._streamedConversationalLength = 0;
        this._hasStreamedArtifact = false;
        this.tts?.finishStream();
      }
    }

    handleStreamError(error) {
      this._lastReceivedTextLength = 0;
      this._streamedConversationalLength = 0;
      this._hasStreamedArtifact = false;
      this._isProcessingQuery = false;
      if (!this.isOpen && !this.talkbackEnabled) return;

      this._setHUDStatus("Error");
      this._setGlobeState("idle");

      const rawMsg = error?.message || "Generation failed";
      const is429 = /429|rate limit|quota|resource_exhausted/i.test(rawMsg);
      const friendlyMsg = is429
        ? "Rate limit or quota exceeded (429). Check your API quota or provider settings."
        : `Error: ${rawMsg}`;

      this._setHUDTranscript("Vela", friendlyMsg);

      if (this.tts) {
        this.tts.speak(friendlyMsg);
      } else {
        const errTimer = setTimeout(() => {
          if (this.isOpen && !this.isMuted) {
            this._setHUDStatus("Listening…");
            this._setGlobeState("listening");
            this.stt?.resetTranscript?.();
            this.stt?.start?.();
          }
        }, 3000);
        if (errTimer?.unref) {
          errTimer.unref();
        }
      }
    }

    _setHUDStatus(status) {
      const el = this._getElement(this.options.statusTextId);
      if (el) el.textContent = status;
    }

    _setHUDTranscript(role, text) {
      const roleEl = this._getElement(this.options.transcriptRoleId);
      const textEl = this._getElement(this.options.transcriptTextId);
      if (roleEl) roleEl.textContent = role;
      if (textEl) textEl.textContent = text;
    }

    _setGlobeState(state) {
      if (this.globe) {
        this.globe.setState(state);
      }
    }

    _startSessionTimer() {
      this._stopSessionTimer();
      this.sessionSeconds = 0;
      this._updateTimerDisplay();

      this.sessionTimer = setInterval(() => {
        this.sessionSeconds++;
        this._updateTimerDisplay();
      }, 1000);
      if (this.sessionTimer?.unref) {
        this.sessionTimer.unref();
      }
    }

    _stopSessionTimer() {
      if (this.sessionTimer) {
        clearInterval(this.sessionTimer);
        this.sessionTimer = null;
      }
      this.sessionSeconds = 0;
    }

    _updateTimerDisplay() {
      const el = this._getElement(this.options.timerId);
      if (!el) return;
      const mins = String(Math.floor(this.sessionSeconds / 60)).padStart(2, "0");
      const secs = String(this.sessionSeconds % 60).padStart(2, "0");
      el.textContent = `${mins}:${secs}`;
    }

    // Composer Dictation Methods
    toggleComposerDictation() {
      if (this.isComposerDictating) {
        this.stopComposerDictation();
      } else {
        this.startComposerDictation();
      }
    }

    startComposerDictation() {
      if (this.isOpen) {
        this.closeHUD();
      }

      const input = this._getElement(this.options.composerInputId);
      this.composerBaselineText = input ? input.value : "";
      this.isComposerDictating = true;

      this._updateComposerVoiceButtonState(true);
      this.composerSTT?.start();
    }

    stopComposerDictation() {
      if (!this.isComposerDictating) return;
      this.isComposerDictating = false;
      this._updateComposerVoiceButtonState(false);
      this.composerSTT?.stop();

      const input = this._getElement(this.options.composerInputId);
      if (input) {
        input.focus();
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }

    _updateComposerVoiceButtonState(isListening) {
      const btn = this._getElement(this.options.composerVoiceBtnId);
      if (!btn) return;

      if (typeof btn.setAttribute === "function") {
        btn.setAttribute("aria-pressed", String(isListening));
      }
      if (btn.classList && typeof btn.classList.toggle === "function") {
        btn.classList.toggle("is-listening", isListening);
      }
      btn.title = isListening ? "Stop dictation (Alt+D)" : "Dictate message (Alt+D)";
    }

    _updateComposerInput(transcript, isInterim) {
      const input = this._getElement(this.options.composerInputId);
      if (!input) return;

      let base = this.composerBaselineText;
      let text = (transcript || "").trim();

      if (base && text) {
        if (/^[.,!?;:]/.test(text)) {
          input.value = base.trimEnd() + text;
        } else if (/\s$/.test(base)) {
          input.value = base + text;
        } else {
          input.value = base + " " + text;
        }
      } else if (text) {
        input.value = text;
      } else {
        input.value = base;
      }

      // Trigger input event to auto-resize composer and update send button
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }

    // ─── Composer Voice Menu ────────────────────────────────────────
    toggleComposerMenu() {
      if (this.isComposerDictating) {
        // If actively dictating, clicking mic stops dictation directly
        this.stopComposerDictation();
        return;
      }
      if (this.isComposerMenuOpen) {
        this.closeComposerMenu();
      } else {
        this.openComposerMenu();
      }
    }

    openComposerMenu() {
      this.isComposerMenuOpen = true;
      const menu = this._getElement(this.options.composerVoiceMenuId);
      if (menu) {
        menu.classList.add("is-visible");
        menu.hidden = false;
      }
    }

    closeComposerMenu() {
      this.isComposerMenuOpen = false;
      const menu = this._getElement(this.options.composerVoiceMenuId);
      if (menu) {
        menu.classList.remove("is-visible");
        menu.hidden = true;
      }
    }

    // ─── Voice Settings Modal ─────────────────────────────────────
    openVoiceSettings() {
      this.closeComposerMenu();
      this.isVoiceSettingsOpen = true;
      const modal = this._getElement(this.options.voiceSettingsModalId);
      if (modal) {
        modal.hidden = false;
        modal.classList.add("is-visible");
      }
      this._renderVoiceSettingsCharacters();
      this._loadVoiceSettings();
    }

    closeVoiceSettings() {
      this.isVoiceSettingsOpen = false;
      this.tts?.stopPreview?.();
      const modal = this._getElement(this.options.voiceSettingsModalId);
      if (modal) {
        modal.classList.remove("is-visible");
        modal.hidden = true;
      }
    }

    _renderVoiceSettingsCharacters() {
      if (typeof document === "undefined") return;
      const container = document.getElementById("voiceCharacterList");
      if (!container) return;

      const TTSClass = typeof window !== "undefined" && window.VelaTTSEngine;
      const characters = TTSClass?.getCharacters?.() || [];
      const activeId = this.tts?.activeCharacter || this._loadSavedCharacter();

      container.innerHTML = "";

      for (const char of characters) {
        const card = document.createElement("div");
        card.className = "voice-char-card" + (char.id === activeId ? " is-active" : "");
        card.dataset.characterId = char.id;

        card.innerHTML = `
          <div class="voice-char-header">
            <span class="voice-char-name">${char.name}</span>
            <button class="voice-char-preview-btn" data-character="${char.id}" type="button" aria-label="Preview ${char.name} voice" title="Preview ${char.name}">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" stroke="none"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>
              <span>Play</span>
            </button>
          </div>
          <div class="voice-char-meta">
            <span class="voice-char-accent">${char.accent}</span>
            <span class="voice-char-tagline">${char.tagline}</span>
          </div>
        `;

        // Select character on card click
        card.addEventListener("click", (e) => {
          if (e.target.closest(".voice-char-preview-btn")) return;
          this._selectCharacter(char.id);
        });

        container.appendChild(card);
      }

      // Bind preview buttons
      container.querySelectorAll(".voice-char-preview-btn").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const charId = btn.dataset.character;
          if (this.tts?.isPreviewing && this.tts?._activePreviewCharacter === charId) {
            this.tts.stopPreview();
            btn.classList.remove("is-playing");
          } else {
            // Stop any other preview
            container.querySelectorAll(".voice-char-preview-btn").forEach((b) => b.classList.remove("is-playing"));
            btn.classList.add("is-playing");
            this.tts?.speakPreview?.(charId);
          }
        });
      });
    }

    _selectCharacter(characterId) {
      if (this.tts) {
        this.tts.setCharacter?.(characterId);
      }
      try {
        localStorage.setItem("vela-voice-character", characterId);
      } catch {}

      // Update active state on cards
      if (typeof document === "undefined") return;
      const container = document.getElementById("voiceCharacterList");
      if (!container) return;
      container.querySelectorAll(".voice-char-card").forEach((card) => {
        card.classList.toggle("is-active", card.dataset.characterId === characterId);
      });
    }

    _loadVoiceSettings() {
      try {
        const savedChar = localStorage.getItem("vela-voice-character");
        const savedSpeed = localStorage.getItem("vela-voice-speed");
        const savedEngine = localStorage.getItem("vela-voice-engine") || "auto";
        const savedApiKey = localStorage.getItem("vela-voice-api-key") || "";
        const savedEndpoint = localStorage.getItem("vela-voice-endpoint") || "";

        if (savedChar && this.tts) {
          this.tts.setCharacter?.(savedChar);
        }
        if (savedSpeed && this.tts) {
          const speed = parseFloat(savedSpeed);
          if (!isNaN(speed) && speed >= 0.5 && speed <= 2.0) {
            this.tts.options.rate = speed;
          }
        }
        if (this.tts) {
          const useSpeechSynthesis = savedEngine === "browser" || savedEngine === "groq" || savedEngine === "gemini";
          this.tts.options.mode = useSpeechSynthesis ? "speechSynthesis" : (savedEngine === "auto" ? "auto" : "server");
        }

        // Update form controls in modal
        if (typeof document !== "undefined") {
          const slider = document.getElementById("voiceSpeedSlider");
          const label = document.getElementById("voiceSpeedLabel");
          if (slider && savedSpeed) {
            slider.value = savedSpeed;
          }
          if (label && savedSpeed) {
            label.textContent = parseFloat(savedSpeed).toFixed(1) + "x";
          }

          const engineSelect = document.getElementById("voiceEngineSelect");
          if (engineSelect && savedEngine) {
            engineSelect.value = savedEngine;
            engineSelect.dispatchEvent(new Event("change", { bubbles: true }));
          }

          const apiKeyInput = document.getElementById("voiceApiKeyInput");
          if (apiKeyInput && savedApiKey) {
            apiKeyInput.value = savedApiKey;
          }

          const endpointInput = document.getElementById("voiceEndpointInput");
          if (endpointInput) {
            if (savedEndpoint) {
              endpointInput.value = savedEndpoint;
            }
            const providerEndpoints = {
              groq: "https://api.groq.com/openai/v1",
              openai: "https://api.openai.com/v1",
              gemini: "https://generativelanguage.googleapis.com",
              browser: "",
              auto: ""
            };
            const suggested = providerEndpoints[savedEngine] || "";
            if (suggested) {
              endpointInput.placeholder = suggested;
            }
          }

          const providerHints = {
            groq: "Groq powers ultra-fast speech recognition (Whisper). Voice replies play instantly using local speech.",
            openai: "OpenAI powers Whisper speech recognition and neural speech synthesis.",
            gemini: "Google Gemini powers speech recognition with instant local voice output.",
            browser: "Uses your device's built-in speech engine with zero network latency and no API key required.",
            auto: "Automatically selects the best speech engine based on your configured provider."
          };
          const hintEl = document.getElementById("voiceProviderHint");
          if (hintEl) {
            hintEl.textContent = providerHints[savedEngine] || "";
          }

          const talkbackToggle = document.getElementById("voiceTalkbackToggle");
          const savedTalkback = localStorage.getItem("vela-voice-talkback") === "true";
          this.talkbackEnabled = savedTalkback;
          if (talkbackToggle) {
            talkbackToggle.checked = savedTalkback;
          }
        }
      } catch {}
    }

    _loadSavedCharacter() {
      try {
        return localStorage.getItem("vela-voice-character") || "vela";
      } catch {
        return "vela";
      }
    }

    _saveVoiceSpeed(speed) {
      try {
        localStorage.setItem("vela-voice-speed", String(speed));
      } catch {}
      if (this.tts) {
        this.tts.options.rate = speed;
      }
    }

    bindDOMEvents() {
      if (typeof window === "undefined") return;

      // Composer voice button — opens dropdown menu (or stops dictation if active)
      const compBtn = this._getElement(this.options.composerVoiceBtnId);
      if (compBtn) {
        compBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.toggleComposerMenu();
        });
      }

      // Composer voice menu items
      const menuDictate = this._getElement("composerMenuDictate");
      if (menuDictate) {
        menuDictate.addEventListener("click", () => {
          this.closeComposerMenu();
          this.startComposerDictation();
        });
      }

      const menuVoiceAssistant = this._getElement("composerMenuVoiceAssistant");
      if (menuVoiceAssistant) {
        menuVoiceAssistant.addEventListener("click", () => {
          this.closeComposerMenu();
          this.openHUD();
        });
      }

      const menuVoiceSettings = this._getElement("composerMenuVoiceSettings");
      if (menuVoiceSettings) {
        menuVoiceSettings.addEventListener("click", () => {
          this.closeComposerMenu();
          this.openVoiceSettings();
        });
      }

      // Close composer menu when clicking outside
      if (typeof document !== "undefined") {
        document.addEventListener("click", (e) => {
          if (this.isComposerMenuOpen) {
            const menu = this._getElement(this.options.composerVoiceMenuId);
            const btn = this._getElement(this.options.composerVoiceBtnId);
            if (menu && btn && !menu.contains(e.target) && !btn.contains(e.target)) {
              this.closeComposerMenu();
            }
          }
        });
      }

      // Topbar Voice Assistant button (legacy, may be removed from DOM)
      const topbarVoiceBtn = this._getElement("topbarVoiceAssistant");
      if (topbarVoiceBtn) {
        topbarVoiceBtn.addEventListener("click", () => this.openHUD());
      }

      // HUD backdrop click to close
      const backdrop = this._getElement(this.options.backdropId || "voiceHudBackdrop");
      if (backdrop) {
        backdrop.addEventListener("click", () => this.closeHUD());
      }

      // HUD dock buttons
      const muteBtn = this._getElement(this.options.muteBtnId);
      if (muteBtn) {
        muteBtn.addEventListener("click", () => this.toggleMute());
      }

      const interruptBtn = this._getElement(this.options.interruptBtnId);
      if (interruptBtn) {
        interruptBtn.addEventListener("click", () => this.interrupt());
      }

      const settingsBtn = this._getElement(this.options.settingsBtnId);
      if (settingsBtn) {
        settingsBtn.addEventListener("click", () => {
          this.openVoiceSettings();
        });
      }

      const endBtn = this._getElement(this.options.endBtnId);
      if (endBtn) {
        endBtn.addEventListener("click", () => this.closeHUD());
      }

      const closeBtn = this._getElement(this.options.closeBtnId);
      if (closeBtn) {
        closeBtn.addEventListener("click", () => this.closeHUD());
      }

      // Voice settings modal close
      const settingsClose = this._getElement("voiceSettingsClose");
      if (settingsClose) {
        settingsClose.addEventListener("click", () => this.closeVoiceSettings());
      }

      const settingsBackdrop = this._getElement("voiceSettingsBackdrop");
      if (settingsBackdrop) {
        settingsBackdrop.addEventListener("click", () => this.closeVoiceSettings());
      }

      // Voice speed slider
      if (typeof document !== "undefined") {
        const speedSlider = document.getElementById("voiceSpeedSlider");
        const speedLabel = document.getElementById("voiceSpeedLabel");
        if (speedSlider) {
          speedSlider.addEventListener("input", () => {
            const val = parseFloat(speedSlider.value);
            if (speedLabel) speedLabel.textContent = val.toFixed(1) + "x";
            this._saveVoiceSpeed(val);
          });
        }

        const engineSelect = document.getElementById("voiceEngineSelect");
        if (engineSelect) {
          const providerEndpoints = {
            groq: "https://api.groq.com/openai/v1",
            openai: "https://api.openai.com/v1",
            gemini: "https://generativelanguage.googleapis.com",
            browser: "",
            auto: ""
          };
          engineSelect.addEventListener("change", () => {
            try {
              localStorage.setItem("vela-voice-engine", engineSelect.value);
            } catch {}
            if (this.tts) {
              const useSpeechSynthesis = engineSelect.value === "browser" || engineSelect.value === "groq" || engineSelect.value === "gemini";
              this.tts.options.mode = useSpeechSynthesis ? "speechSynthesis" : (engineSelect.value === "auto" ? "auto" : "server");
            }
            const endpointInput = document.getElementById("voiceEndpointInput");
            if (endpointInput) {
              const suggested = providerEndpoints[engineSelect.value] || "";
              endpointInput.placeholder = suggested || "Default provider endpoint";
            }
            const providerHints = {
              groq: "Groq powers ultra-fast speech recognition (Whisper). Voice replies play instantly using local speech.",
              openai: "OpenAI powers Whisper speech recognition and neural speech synthesis.",
              gemini: "Google Gemini powers speech recognition with instant local voice output.",
              browser: "Uses your device's built-in speech engine with zero network latency and no API key required.",
              auto: "Automatically selects the best speech engine based on your configured provider."
            };
            const hintEl = document.getElementById("voiceProviderHint");
            if (hintEl) {
              hintEl.textContent = providerHints[engineSelect.value] || "";
            }
          });
        }

        const apiKeyInput = document.getElementById("voiceApiKeyInput");
        if (apiKeyInput) {
          const syncKey = () => {
            try {
              localStorage.setItem("vela-voice-api-key", apiKeyInput.value.trim());
            } catch {}
          };
          apiKeyInput.addEventListener("input", syncKey);
          apiKeyInput.addEventListener("change", syncKey);
          apiKeyInput.addEventListener("paste", () => setTimeout(syncKey, 10));
        }

        const pasteKeyBtn = document.getElementById("pasteVoiceApiKey");
        if (pasteKeyBtn && apiKeyInput) {
          pasteKeyBtn.addEventListener("click", async () => {
            try {
              if (navigator?.clipboard?.readText) {
                const text = await navigator.clipboard.readText();
                if (text) {
                  apiKeyInput.value = text.trim();
                  apiKeyInput.dispatchEvent(new Event("input", { bubbles: true }));
                  apiKeyInput.dispatchEvent(new Event("change", { bubbles: true }));
                }
              } else {
                apiKeyInput.focus();
              }
            } catch {
              apiKeyInput.focus();
            }
          });
        }

        const toggleKeyBtn = document.getElementById("toggleVoiceApiKey");
        if (toggleKeyBtn && apiKeyInput) {
          toggleKeyBtn.addEventListener("click", () => {
            const isPass = apiKeyInput.type === "password";
            apiKeyInput.type = isPass ? "text" : "password";
            toggleKeyBtn.textContent = isPass ? "Hide" : "Show";
          });
        }

        const endpointInput = document.getElementById("voiceEndpointInput");
        if (endpointInput) {
          const syncEndpoint = () => {
            try {
              localStorage.setItem("vela-voice-endpoint", endpointInput.value.trim());
            } catch {}
          };
          endpointInput.addEventListener("input", syncEndpoint);
          endpointInput.addEventListener("change", syncEndpoint);
          endpointInput.addEventListener("paste", () => setTimeout(syncEndpoint, 10));
        }

        const talkbackToggle = document.getElementById("voiceTalkbackToggle");
        if (talkbackToggle) {
          talkbackToggle.addEventListener("change", () => {
            this.talkbackEnabled = Boolean(talkbackToggle.checked);
            try {
              localStorage.setItem("vela-voice-talkback", String(this.talkbackEnabled));
            } catch {}
          });
        }
      }

      // TTS preview end callback — reset preview button state
      if (this.tts) {
        const origOnPreviewEnd = this.tts.options.onPreviewEnd;
        this.tts.options.onPreviewEnd = (charId) => {
          if (typeof document !== "undefined") {
            document.querySelectorAll(".voice-char-preview-btn").forEach((b) => b.classList.remove("is-playing"));
          }
          if (typeof origOnPreviewEnd === "function") origOnPreviewEnd(charId);
        };
      }

      // Load saved settings on startup
      this._loadVoiceSettings();

      // Global keyboard shortcuts
      window.addEventListener("keydown", (e) => {
        // Never intercept typing or pasting inside input fields or textareas
        const isEditing = e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable);
        if (isEditing) {
          if (e.key === "Escape") {
            if (this.isVoiceSettingsOpen) {
              e.preventDefault();
              this.closeVoiceSettings();
            }
          }
          return;
        }

        // Alt+D or Ctrl+Shift+D: Toggle composer dictation
        if ((e.altKey && e.code === "KeyD") || (e.ctrlKey && e.shiftKey && e.code === "KeyD")) {
          e.preventDefault();
          this.toggleComposerDictation();
          return;
        }

        // Alt+V or Ctrl+Shift+V: Toggle voice assistant HUD
        if ((e.altKey && e.code === "KeyV") || (e.ctrlKey && e.shiftKey && e.code === "KeyV")) {
          e.preventDefault();
          if (this.isOpen) {
            this.closeHUD();
          } else {
            this.openHUD();
          }
          return;
        }

        // Escape: close voice settings, stop composer dictation, close HUD
        if (e.key === "Escape") {
          if (this.isVoiceSettingsOpen) {
            e.preventDefault();
            this.closeVoiceSettings();
            return;
          }
          if (this.isComposerMenuOpen) {
            e.preventDefault();
            this.closeComposerMenu();
            return;
          }
          if (this.isComposerDictating) {
            e.preventDefault();
            this.stopComposerDictation();
            return;
          }
          if (this.isOpen) {
            e.preventDefault();
            this.closeHUD();
            return;
          }
        }

        // When HUD is open:
        if (this.isOpen) {
          // Space: toggle mute (when not focused on form input)
          if (e.code === "Space" && e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA") {
            e.preventDefault();
            this.toggleMute();
            return;
          }
        }
      });
    }
  }

  globalThis.VelaVoiceAssistantCoordinator = VelaVoiceAssistantCoordinator;
  globalThis.OPENING_GREETINGS = OPENING_GREETINGS;
})();
