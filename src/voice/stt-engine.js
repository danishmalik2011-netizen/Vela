(() => {
  "use strict";

  /**
   * Punctuation and capitalization formatting helper.
   * Cleans and capitalizes transcripts for natural text input.
   */
  function formatTranscript(text, prependSpace = false) {
    if (!text) return "";
    let trimmed = text.trim();
    if (!trimmed) return "";

    // Capitalize first character
    trimmed = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);

    // Ensure space prefix if requested and not starting with punctuation
    if (prependSpace && !/^[.,!?;:]/.test(trimmed)) {
      return " " + trimmed;
    }
    return trimmed;
  }

  /**
   * Stitch committed transcript with incoming interim transcript
   */
  function stitchTranscripts(committed, interim) {
    const c = (committed || "").trim();
    const i = (interim || "").trim();
    if (!c) return i;
    if (!i) return c;
    if (/^[.,!?;:]/.test(i)) return c + i;
    return c + " " + i;
  }

  class VelaSTTEngine {
    constructor(options = {}) {
      this.options = {
        lang: options.lang || "en-US",
        continuous: options.continuous !== false,
        interimResults: options.interimResults !== false,
        silenceTimeoutMs: options.silenceTimeoutMs || 1400,
        onInterim: options.onInterim || null,
        onFinal: options.onFinal || null,
        onStateChange: options.onStateChange || null,
        onError: options.onError || null,
        onSpeechStart: options.onSpeechStart || null,
        onSpeechEnd: options.onSpeechEnd || null,
        getProviderConfig: options.getProviderConfig || null,
        transcribeEndpoint: options.transcribeEndpoint || "/api/audio/transcribe"
      };

      this.state = "idle"; // "idle" | "listening" | "processing"
      this.committedText = "";
      this.interimText = "";
      this.isListening = false;
      this._desiredListening = false;
      this._hasSpoken = false;
      this._recognition = null;
      this._mediaRecorder = null;
      this._mediaStream = null;
      this._ownsStream = false;
      this._audioChunks = [];
      this._silenceTimer = null;
      this._vadInterval = null;
      this._vadAudioCtx = null;
      this._mode = "none"; // "webspeech" | "mediarecorder"
      this._webSpeechFailed = false;

      this._initRecognition();
    }

    static isWebSpeechSupported() {
      if (typeof window === "undefined") return false;
      return Boolean(
        window.SpeechRecognition ||
        window.webkitSpeechRecognition
      );
    }

    static isMediaRecorderSupported() {
      if (typeof window === "undefined" || typeof navigator === "undefined") return false;
      return Boolean(
        navigator.mediaDevices &&
        typeof navigator.mediaDevices.getUserMedia === "function" &&
        window.MediaRecorder
      );
    }

    /**
     * Determine the best STT mode based on available provider config.
     * - If user explicitly selected "browser", use native Web Speech API
     * - If an API key is configured (Groq, OpenAI, Gemini), prefer MediaRecorder + Whisper
     * - Otherwise fall back to Web Speech API or MediaRecorder
     */
    _chooseBestMode() {
      const config = typeof this.options.getProviderConfig === "function"
        ? this.options.getProviderConfig()
        : {};
      const provider = (config?.provider || "").toLowerCase();
      const apiKey = (config?.apiKey || "").trim();

      if (provider === "browser") {
        if (VelaSTTEngine.isWebSpeechSupported() && !this._webSpeechFailed) {
          return "webspeech";
        }
        return VelaSTTEngine.isMediaRecorderSupported() ? "mediarecorder" : "none";
      }

      if (apiKey && VelaSTTEngine.isMediaRecorderSupported()) {
        return "mediarecorder";
      }

      if (VelaSTTEngine.isWebSpeechSupported() && !this._webSpeechFailed) {
        return "webspeech";
      }

      if (VelaSTTEngine.isMediaRecorderSupported()) {
        return "mediarecorder";
      }

      return "none";
    }

    _initRecognition() {
      if (!VelaSTTEngine.isWebSpeechSupported()) {
        this._mode = "mediarecorder";
        return;
      }

      const SpeechRecognition =
        window.SpeechRecognition || window.webkitSpeechRecognition;

      try {
        const recognition = new SpeechRecognition();
        recognition.continuous = this.options.continuous;
        recognition.interimResults = this.options.interimResults;
        recognition.lang = this.options.lang;
        recognition.maxAlternatives = 1;

        recognition.onstart = () => {
          this.isListening = true;
          this._setState("listening");
          this._resetSilenceTimer();
        };

        recognition.onspeechstart = () => {
          this._resetSilenceTimer();
          if (typeof this.options.onSpeechStart === "function") {
            this.options.onSpeechStart();
          }
        };

        recognition.onspeechend = () => {
          this._startSilenceTimer();
          if (typeof this.options.onSpeechEnd === "function") {
            this.options.onSpeechEnd();
          }
        };

        recognition.onresult = (event) => {
          this._resetSilenceTimer();
          let interim = "";
          let finalDelta = "";

          for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            const transcript = result[0]?.transcript || "";

            if (result.isFinal) {
              finalDelta += transcript;
            } else {
              interim += transcript;
            }
          }

          if (finalDelta) {
            const formatted = formatTranscript(finalDelta);
            this.committedText = stitchTranscripts(this.committedText, formatted);
            this.interimText = "";
            if (typeof this.options.onFinal === "function") {
              this.options.onFinal(this.committedText, formatted);
            }
          }

          if (interim) {
            this.interimText = interim;
            if (typeof this.options.onInterim === "function") {
              this.options.onInterim(stitchTranscripts(this.committedText, interim), interim);
            }
          }

          this._startSilenceTimer();
        };

        recognition.onerror = (event) => {
          const errorType = event.error || "unknown";

          if (errorType === "no-speech" || errorType === "aborted") {
            return;
          }

          if (
            (errorType === "not-allowed" || errorType === "service-not-allowed" || errorType === "network" || errorType === "audio-capture") &&
            VelaSTTEngine.isMediaRecorderSupported()
          ) {
            console.warn("[VelaSTT] Web Speech API error, switching to MediaRecorder fallback:", errorType);
            this._webSpeechFailed = true;
            this._mode = "mediarecorder";
            this._recognition = null;
            if (this._desiredListening) {
              this._startMediaRecorder();
            }
            return;
          }

          if (typeof this.options.onError === "function") {
            this.options.onError(errorType, event);
          }
        };

        recognition.onend = () => {
          this.isListening = false;
          if (this._desiredListening && this._mode === "webspeech") {
            setTimeout(() => {
              if (this._desiredListening && this._mode === "webspeech" && this._recognition) {
                try {
                  this._recognition.start();
                } catch {
                  this._setState("idle");
                }
              }
            }, 250);
          } else if (!this._desiredListening) {
            this._setState("idle");
          }
        };

        this._recognition = recognition;
        this._mode = this._chooseBestMode();
      } catch (err) {
        console.warn("[VelaSTT] Could not initialize SpeechRecognition:", err);
        this._mode = "mediarecorder";
      }
    }

    _setState(newState) {
      if (this.state === newState) return;
      this.state = newState;
      if (typeof this.options.onStateChange === "function") {
        this.options.onStateChange(newState);
      }
    }

    _resetSilenceTimer() {
      if (this._silenceTimer) {
        clearTimeout(this._silenceTimer);
        this._silenceTimer = null;
      }
    }

    flushAndCommit() {
      const pending = (this.interimText || "").trim();
      if (pending && pending !== "…" && pending !== "Listening to your voice…") {
        const formatted = formatTranscript(pending);
        this.committedText = stitchTranscripts(this.committedText, formatted);
        this.interimText = "";
        if (typeof this.options.onFinal === "function") {
          this.options.onFinal(this.committedText, formatted);
        }
      } else if (this.committedText && typeof this.options.onFinal === "function") {
        this.options.onFinal(this.committedText, this.committedText);
      }
    }

    _startSilenceTimer() {
      this._resetSilenceTimer();
      if (!this.options.silenceTimeoutMs || this.options.silenceTimeoutMs <= 0) return;

      this._silenceTimer = setTimeout(() => {
        if (this.isListening && (this.committedText || this.interimText || this._hasSpoken || this._mode === "mediarecorder")) {
          this.flushAndCommit();
          this.stop();
        }
      }, this.options.silenceTimeoutMs);
    }

    resetTranscript() {
      this.committedText = "";
      this.interimText = "";
      this._hasSpoken = false;
    }

    async start(existingStream = null) {
      this._desiredListening = true;
      this._hasSpoken = false;
      this.committedText = "";
      this.interimText = "";

      this._mode = this._chooseBestMode();

      if (this._mode === "webspeech" && this._recognition) {
        try {
          this._recognition.start();
          return true;
        } catch (err) {
          if (err.name !== "InvalidStateError") {
            console.warn("[VelaSTT] SpeechRecognition start failed, switching to MediaRecorder:", err);
            this._mode = "mediarecorder";
            return this._startMediaRecorder(existingStream);
          }
          return true;
        }
      }

      if (this._mode === "mediarecorder") {
        return this._startMediaRecorder(existingStream);
      }

      if (typeof this.options.onError === "function") {
        this.options.onError("not-supported", new Error("No speech recognition engine available."));
      }
      return false;
    }

    async _startMediaRecorder(existingStream = null) {
      if (!VelaSTTEngine.isMediaRecorderSupported()) {
        const error = new Error("Neither Web Speech API nor MediaRecorder are supported in this browser.");
        this._setState("idle");
        if (typeof this.options.onError === "function") {
          this.options.onError("not-supported", error);
        }
        return false;
      }

      try {
        let stream = existingStream;
        const isStreamLive = stream && stream.active && stream.getAudioTracks && stream.getAudioTracks().some((t) => t.readyState === "live");
        if (!isStreamLive) {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            }
          });
          this._ownsStream = true;
        } else {
          this._ownsStream = false;
        }

        this._mediaStream = stream;
        this._audioChunks = [];
        this._hasSpoken = false;

        let mimeType = "audio/webm;codecs=opus";
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = MediaRecorder.isTypeSupported("audio/webm")
            ? "audio/webm"
            : MediaRecorder.isTypeSupported("audio/mp4")
            ? "audio/mp4"
            : "";
        }

        const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
        this._mediaRecorder = recorder;

        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            this._audioChunks.push(e.data);
          }
        };

        recorder.onstart = () => {
          this.isListening = true;
          this._setState("listening");
          this._startVAD(stream);
        };

        recorder.onstop = async () => {
          this.isListening = false;
          this._stopVAD();
          if (this._ownsStream) {
            this._cleanupMediaStream();
          }

          if (!this._audioChunks.length) {
            this._setState("idle");
            return;
          }

          const audioBlob = new Blob(this._audioChunks, {
            type: recorder.mimeType || "audio/webm"
          });
          this._audioChunks = [];

          // If blob has meaningful audio data (> 1500 bytes), transcribe it
          // Also check hadSpeech flag or size > 6000 bytes as fallback
          const hadSpeech = this._hasSpoken || audioBlob.size > 6000;
          this._hasSpoken = false;

          if (audioBlob.size > 1500 && hadSpeech) {
            this._setState("processing");
            try {
              const transcript = await this._transcribeAudioBlob(audioBlob);
              const cleaned = (transcript || "").trim();
              if (cleaned) {
                const formatted = formatTranscript(cleaned);
                this.committedText = formatted;
                this.interimText = "";
                if (typeof this.options.onFinal === "function") {
                  this.options.onFinal(formatted, formatted);
                }
              }
            } catch (err) {
              console.error("[VelaSTT] Transcription error:", err);
              if (typeof this.options.onError === "function") {
                this.options.onError("transcribe-error", err);
              }
            } finally {
              this._setState("idle");
            }
          } else {
            // Under 1500 bytes or pure silence: resume listening if still active
            this._setState("idle");
            if (this._desiredListening) {
              setTimeout(() => {
                if (this._desiredListening && !this.isListening) {
                  this._startMediaRecorder(this._mediaStream);
                }
              }, 120);
            }
          }
        };

        recorder.start(100);
        return true;
      } catch (err) {
        if (this._ownsStream) {
          this._cleanupMediaStream();
        }
        this._setState("idle");
        if (typeof this.options.onError === "function") {
          this.options.onError("mic-permission-denied", err);
        }
        return false;
      }
    }

    /**
     * Voice Activity Detection (VAD) using Web Audio API Analyser.
     * Uses raw audio waveform amplitude (time-domain data) to detect human speech
     * accurately across any microphone, without cutting off prematurely.
     */
    _startVAD(stream) {
      this._stopVAD();
      if (typeof window === "undefined") return;

      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) {
          this._hasSpoken = true;
          this._startSilenceTimer();
          return;
        }

        const ctx = new AudioCtx();
        this._vadAudioCtx = ctx;

        if (ctx.state === "suspended") {
          ctx.resume().catch(() => {});
        }

        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.3;
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        let lastSpeechTime = 0;
        const silenceThresholdMs = Math.max(1000, this.options.silenceTimeoutMs || 1400);
        const startTime = Date.now();

        this._vadInterval = setInterval(() => {
          if (!this.isListening || !this._mediaRecorder || this._mediaRecorder.state !== "recording") {
            this._stopVAD();
            return;
          }

          // Use raw audio waveform amplitude: 128 is center silence, deviations indicate voice
          analyser.getByteTimeDomainData(dataArray);

          let maxDev = 0;
          for (let i = 0; i < dataArray.length; i++) {
            const dev = Math.abs(dataArray[i] - 128);
            if (dev > maxDev) maxDev = dev;
          }

          // maxDev > 4 detects speech clearly on any microphone
          if (maxDev > 4) {
            if (!this._hasSpoken) {
              this._hasSpoken = true;
              if (typeof this.options.onSpeechStart === "function") {
                this.options.onSpeechStart();
              }
              if (typeof this.options.onInterim === "function") {
                this.options.onInterim("Listening to your voice…", "…");
              }
            }
            lastSpeechTime = Date.now();
          } else if (this._hasSpoken) {
            // User was speaking, now silent: check if silence exceeds threshold
            const silentFor = Date.now() - lastSpeechTime;
            if (silentFor >= silenceThresholdMs) {
              this._stopVAD();
              if (this._mediaRecorder && this._mediaRecorder.state === "recording") {
                try {
                  this._mediaRecorder.stop();
                } catch {}
              }
            }
          } else {
            // User hasn't spoken yet; max wait 30 seconds before cycling
            if (Date.now() - startTime > 30000) {
              this._stopVAD();
              if (this._mediaRecorder && this._mediaRecorder.state === "recording") {
                try {
                  this._mediaRecorder.stop();
                } catch {}
              }
            }
          }
        }, 50);
      } catch (e) {
        console.warn("[VelaSTT] VAD initialization failed, falling back to timer:", e);
        this._hasSpoken = true;
        this._startSilenceTimer();
      }
    }

    _stopVAD() {
      if (this._vadInterval) {
        clearInterval(this._vadInterval);
        this._vadInterval = null;
      }
      if (this._vadAudioCtx) {
        try {
          this._vadAudioCtx.close().catch(() => {});
        } catch {}
        this._vadAudioCtx = null;
      }
    }

    _cleanupMediaStream() {
      if (this._mediaStream) {
        this._mediaStream.getTracks().forEach((t) => t.stop());
        this._mediaStream = null;
      }
      this._ownsStream = false;
    }

    async _transcribeAudioBlob(blob) {
      const buffer = await blob.arrayBuffer();
      const base64 = typeof Buffer !== "undefined"
        ? Buffer.from(buffer).toString("base64")
        : btoa(
            new Uint8Array(buffer).reduce(
              (data, byte) => data + String.fromCharCode(byte),
              ""
            )
          );

      const providerConfig = typeof this.options.getProviderConfig === "function"
        ? this.options.getProviderConfig()
        : {};

      const apiKey = (providerConfig.apiKey || "").trim();
      const endpoint = (providerConfig.endpoint || "").trim();
      const provider = (providerConfig.provider || "").toLowerCase();

      let whisperModel = "whisper-1";
      let targetEndpoint = endpoint;

      if (provider === "groq" || apiKey.startsWith("gsk_") || endpoint.toLowerCase().includes("groq.com")) {
        whisperModel = "whisper-large-v3";
        if (!targetEndpoint || !targetEndpoint.toLowerCase().includes("groq.com")) {
          targetEndpoint = "https://api.groq.com/openai/v1";
        }
      } else if (provider === "gemini" || apiKey.startsWith("AIzaSy") || endpoint.toLowerCase().includes("googleapis.com")) {
        if (!targetEndpoint) {
          targetEndpoint = "https://generativelanguage.googleapis.com";
        }
      } else if (provider === "openai" || apiKey.startsWith("sk-") || endpoint.toLowerCase().includes("openai.com")) {
        whisperModel = "whisper-1";
        if (!targetEndpoint) {
          targetEndpoint = "https://api.openai.com/v1";
        }
      }

      const payload = {
        audio: base64,
        mimeType: blob.type || "audio/webm",
        apiKey: apiKey,
        endpoint: targetEndpoint,
        model: whisperModel,
        language: this.options.lang ? this.options.lang.split("-")[0] : "en"
      };

      const response = await fetch(this.options.transcribeEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData?.error?.message || `Audio transcription failed with status ${response.status}`);
      }

      const data = await response.json();
      return data?.text || "";
    }

    stop() {
      this._desiredListening = false;
      this._resetSilenceTimer();
      this._stopVAD();

      if (this.interimText) {
        this.flushAndCommit();
      }

      if (this._recognition && this.isListening) {
        try {
          this._recognition.stop();
        } catch {}
      }

      if (this._mediaRecorder && this._mediaRecorder.state !== "inactive") {
        try {
          this._mediaRecorder.stop();
        } catch {}
      }

      this.isListening = false;
      if (this.state !== "processing") {
        this._setState("idle");
      }
    }

    abort() {
      this._desiredListening = false;
      this._resetSilenceTimer();
      this._stopVAD();

      if (this._recognition) {
        try {
          this._recognition.abort();
        } catch {}
      }

      if (this._mediaRecorder && this._mediaRecorder.state !== "inactive") {
        try {
          this._mediaRecorder.stop();
        } catch {}
      }

      this._cleanupMediaStream();
      this.isListening = false;
      this._setState("idle");
    }
  }

  globalThis.VelaSTTEngine = VelaSTTEngine;
  globalThis.formatTranscript = formatTranscript;
  globalThis.stitchTranscripts = stitchTranscripts;
})();
