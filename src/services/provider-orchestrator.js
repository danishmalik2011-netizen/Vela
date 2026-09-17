(() => {
  "use strict";

  function normalizeFallback(value) {
    return typeof value === "string"
      ? { text: value, reasoning: "" }
      : {
          text: value?.text || value?.content || "",
          reasoning: value?.reasoning || value?.thinking || ""
        };
  }

  function localPayload(message, messages, userIndex, conversation, shouldSearch, searchContext, preferences, taskMode, taskGuidance) {
    return {
      message,
      messages: messages.slice(0, userIndex + 1),
      conversation,
      searchEnabled: shouldSearch,
      searchContext,
      preferences: { ...(preferences || {}), taskMode, taskGuidance },
      stream: true
    };
  }

  // Provider stop reasons that mean "the answer was cut off at the token
  // limit" — not a real end of turn. These trigger automatic continuation.
  const TRUNCATION_REASONS = Object.freeze([
    "length", "max_tokens", "max_output_tokens", "output_limit",
    "max_length", "length_limit", "token_limit", "context_overflow"
  ]);

  // Hard bound so a misbehaving provider that always reports truncation
  // cannot loop forever. Generous enough for very large single-file outputs.
  const MAX_CONTINUATIONS = 8;

  const CONTINUATION_PROMPT = "Your previous reply was cut off by the output token limit, mid-generation. Continue your answer from the exact character where it stopped: do not restart, do not repeat or re-format any content you already produced, and do not add commentary about the interruption. If a fenced code block was left open, carry on writing its contents directly (do not emit a new opening fence) and close it when the file is complete. Keep the same structure and style.";

  function isTruncationReason(reason) {
    const normalized = String(reason || "").toLowerCase().replace(/[\s-]+/g, "_");
    return TRUNCATION_REASONS.includes(normalized);
  }

  // If the final text ends inside an unclosed fenced code block, close it so
  // downstream markdown renderers and artifact extraction never see a broken
  // document (e.g. when every continuation budget was spent mid-file).
  function closeOpenCodeFences(text) {
    const value = String(text || "");
    const fences = value.match(/^```[^\n]*$/gm) || [];
    if (fences.length % 2 === 0) return value;
    return `${value.replace(/\s+$/, "")}\n\`\`\`\n`;
  }

  // Merge a continuation chunk onto the answer so far. Only strips leading
  // newlines the model adds when resuming (mid-file indentation is kept).
  function mergeContinuation(base, chunk) {
    const head = String(base || "");
    const tail = String(chunk || "");
    if (!head) return tail;
    if (!tail) return head;
    // If the model restarted inside a fresh line, avoid double newlines;
    // otherwise join exactly so code indenting survives.
    const trimmed = head.endsWith("\n") ? tail.replace(/^[\r\n]+/, "") : tail;
    return `${head}${trimmed}`;
  }

  async function continueUntilComplete({
    fetch, config, messages, userIndex, basePrompt, taskGuidance, requests,
    consumeResponse, readResponseError, onUpdate, signal, result
  }) {
    let combined = { text: result.text, reasoning: result.reasoning, stopReason: result.stopReason || "" };
    let rounds = 0;

    while (isTruncationReason(combined.stopReason) && rounds < MAX_CONTINUATIONS) {
      rounds += 1;
      const continuationMessages = [
        ...messages.slice(0, userIndex + 1),
        { role: "assistant", content: combined.text },
        { role: "user", content: CONTINUATION_PROMPT }
      ];
      const payload = globalThis.VelaProviderConfig.prepare(
        requests, config, continuationMessages, continuationMessages.length - 1,
        "", basePrompt, taskGuidance
      );
      const response = await fetch("/api/provider/chat", {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error(await readResponseError(response));

      const chunkBase = combined.text;
      const chunk = await consumeResponse(response, config.format, (partial) => {
        onUpdate?.({
          text: mergeContinuation(chunkBase, typeof partial === "string" ? partial : partial?.text || ""),
          reasoning: combined.reasoning
        });
      });

      combined = {
        text: mergeContinuation(combined.text, chunk.text),
        reasoning: combined.reasoning || chunk.reasoning || "",
        stopReason: chunk.stopReason || ""
      };
    }

    combined.text = closeOpenCodeFences(combined.text);
    return combined;
  }

  async function request(options) {
    const {
      fetch, config, message, messages, userIndex, conversation, shouldSearch, searchContext,
      searchError, preferences, taskMode, taskGuidance, basePrompt, requests,
      consumeResponse, readResponseError, onUpdate, signal, fallback
    } = options;

    if (shouldSearch && !searchContext) throw new Error(`Web search failed: ${searchError}`);

    if (!config.enabled) {
      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(localPayload(message, messages, userIndex, conversation, shouldSearch, searchContext, preferences, taskMode, taskGuidance))
        });
        if (!response.ok) throw new Error(await readResponseError(response));
        let result = await consumeResponse(response, "openai-chat", onUpdate);
        let rounds = 0;
        while (result.text && isTruncationReason(result.stopReason) && rounds < MAX_CONTINUATIONS) {
          rounds += 1;
          const continuationMessages = [
            ...messages.slice(0, userIndex + 1),
            { role: "assistant", content: result.text },
            { role: "user", content: CONTINUATION_PROMPT }
          ];
          const followUp = await fetch("/api/chat", {
            method: "POST",
            signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(localPayload(CONTINUATION_PROMPT, [...messages.slice(0, userIndex), ...continuationMessages], continuationMessages.length - 1, conversation, shouldSearch, searchContext, preferences, taskMode, taskGuidance))
          });
          if (!followUp.ok) break;
          const chunkBase = result.text;
          const chunk = await consumeResponse(followUp, "openai-chat", (partial) => {
            onUpdate?.({
              text: mergeContinuation(chunkBase, typeof partial === "string" ? partial : partial?.text || ""),
              reasoning: result.reasoning
            });
          });
          result = {
            text: mergeContinuation(result.text, chunk.text),
            reasoning: result.reasoning || chunk.reasoning || "",
            stopReason: chunk.stopReason || ""
          };
        }
        if (result.text) {
          return { ...result, text: closeOpenCodeFences(result.text), searchSources: options.searchSources || [], searchMeta: options.searchMeta || null };
        }
      } catch (error) {
        if (error?.name === "AbortError" || shouldSearch) throw error;
      }
      if (typeof fallback === "function") {
        const result = normalizeFallback(await fallback(message));
        onUpdate(result);
        return result;
      }
      throw new Error("No AI provider is configured. Open Settings and connect a provider.");
    }

    const payload = globalThis.VelaProviderConfig.prepare(
      requests, config, messages, userIndex, searchContext, basePrompt, taskGuidance
    );
    const response = await fetch("/api/provider/chat", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(await readResponseError(response));
    const result = await consumeResponse(response, config.format, onUpdate);
    if (!result.text) {
      // Empty turn with no provider error event: surface the provider's
      // stop reason (e.g. content_filter) before a bare generic message.
      const reason = String(result.stopReason || "").trim();
      throw new Error(
        reason
          ? `The selected model returned an empty response (stop reason: ${reason}).`
          : "The selected model returned an empty response."
      );
    }
    const completed = await continueUntilComplete({
      fetch, config, messages, userIndex, basePrompt, taskGuidance, requests,
      consumeResponse, readResponseError, onUpdate, signal, result
    });
    return { ...completed, searchSources: options.searchSources || [], searchMeta: options.searchMeta || null };
  }

  globalThis.VelaProviderOrchestrator = Object.freeze({
    normalizeFallback,
    localPayload,
    request,
    isTruncationReason,
    closeOpenCodeFences,
    mergeContinuation,
    MAX_CONTINUATIONS,
    CONTINUATION_PROMPT
  });
})();
