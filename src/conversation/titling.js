(() => {
  "use strict";

  const TITLING_SYSTEM_PROMPT =
    "You are an expert conversation titling engine. Output ONLY a concise, professional, one-line summary title (3 to 6 words, maximum 45 characters) that accurately summarizes the topic of the conversation. Do not use quotation marks, markdown formatting, prefixes like 'Title:', or punctuation at the end.";

  const DEFAULT_ENDPOINTS = Object.freeze({
    groq: "https://api.groq.com/openai/v1",
    gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
    openai: "https://api.openai.com/v1",
    openrouter: "https://openrouter.ai/api/v1",
    deepseek: "https://api.deepseek.com/v1",
    anthropic: "https://api.anthropic.com/v1",
    custom: "https://api.openai.com/v1"
  });

  function createSmartTitle(message) {
    const cleaned = String(message || "")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/[`*_#>\[\](){}]/g, " ")
      .replace(
        /^(?:hey|hi|hello|please|can you|could you|would you|i want you to|help me(?: to)?|tell me(?: about)?)\s+/i,
        ""
      )
      .replace(/\s+/g, " ")
      .trim();

    if (!cleaned) return "Untitled conversation";

    const firstSentence =
      cleaned.split(/[.!?\n]/)[0]?.trim() || cleaned;
    const words = firstSentence.split(/\s+/);
    let smartTitle = words.slice(0, 8).join(" ");

    if (smartTitle.length > 52) {
      smartTitle = smartTitle.slice(0, 49).trimEnd() + "…";
    } else if (words.length > 8) {
      smartTitle += "…";
    }

    return (
      smartTitle.charAt(0).toUpperCase() +
      smartTitle.slice(1)
    );
  }

  function cleanModelTitle(raw, fallbackPrompt = "") {
    if (!raw || typeof raw !== "string" || !raw.trim()) {
      return fallbackPrompt ? createSmartTitle(fallbackPrompt) : "";
    }

    let title = raw
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/```[a-z]*\n?|```/gi, "")
      .replace(/^[\s\r\n]+|[\s\r\n]+$/g, "")
      .replace(
        /^(?:here\s+is\s+(?:a|the)\s+(?:one-?line\s+)?(?:summary\s+)?title\s*[:：\-–]?|title|session\s*title|conversation\s*title|summary\s*title|summary|name)\s*[:：\-–]\s*/i,
        ""
      )
      .replace(/^["'«»“”‘’`*_#]+|["'«»“”‘’`*_#]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();

    title = title.replace(/^["'«»“”‘’`]+|["'«»“”‘’`]+$/g, "").trim();
    title = title.replace(/[.!?]+$/, "").trim();

    if (
      !title ||
      title.length < 2 ||
      /^(?:untitled|new conversation|here is|sure|okay)$/i.test(title)
    ) {
      return fallbackPrompt ? createSmartTitle(fallbackPrompt) : "";
    }

    title = title.charAt(0).toUpperCase() + title.slice(1);

    if (title.length > 50) {
      const cut = title.slice(0, 48);
      const lastSpace = cut.lastIndexOf(" ");
      title = (lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
    }

    return title;
  }

  function buildTitlingPayload(requests, config, messages) {
    const userMessages = (messages || []).filter(
      (m) => m.role === "user" && m.content
    );
    const firstUser = userMessages[0]?.content || "";
    const assistantMsg =
      (messages || []).find((m) => m.role === "assistant" && m.content)?.content || "";

    const userExcerpt = firstUser.slice(0, 400);
    const assistantExcerpt = assistantMsg.slice(0, 400);

    const titlingPrompt =
      `${TITLING_SYSTEM_PROMPT}\n\nConversation Excerpt:\nUser: ${userExcerpt}\nAssistant: ${assistantExcerpt}\n\nProvide ONLY the 3-6 word summary title:`;

    const endpoint =
      config.endpoint ||
      DEFAULT_ENDPOINTS[config.provider] ||
      DEFAULT_ENDPOINTS.custom;
    const format =
      config.format ||
      (config.provider === "anthropic"
        ? "anthropic-messages"
        : "openai-chat");
    const model = config.model || "default";
    const isReasoningModel = /^o[13](?:-|\b)/i.test(model);

    let body;
    if (format === "anthropic-messages") {
      body = {
        model,
        max_tokens: 300,
        messages: [{ role: "user", content: titlingPrompt }]
      };
    } else if (format === "openai-responses") {
      body = {
        model,
        input: [{ role: "user", content: titlingPrompt }],
        max_output_tokens: 300
      };
    } else {
      body = {
        model,
        messages: [{ role: "user", content: titlingPrompt }]
      };
      if (isReasoningModel) {
        body.max_completion_tokens = 300;
      } else {
        body.max_tokens = 300;
        body.temperature = 0.3;
      }
    }

    return {
      provider: config.provider || "custom",
      format,
      endpoint: requests.resolveEndpoint(endpoint, format),
      apiKey: config.apiKey,
      requestBody: body
    };
  }

  function extractTitlingText(payload, format) {
    if (!payload) return "";
    if (typeof payload === "string") return payload;

    if (format === "anthropic-messages") {
      if (Array.isArray(payload.content)) {
        return payload.content.map((c) => c.text || "").join("");
      }
      return payload.delta?.text || "";
    }

    if (format === "openai-responses") {
      return payload.output_text || payload.delta?.text || "";
    }

    if (Array.isArray(payload.candidates?.[0]?.content?.parts)) {
      return payload.candidates[0].content.parts.map((p) => p.text || "").join("");
    }

    const choice = payload.choices?.[0];
    const text =
      choice?.message?.content ||
      choice?.delta?.content ||
      choice?.text ||
      "";

    if (text) return text;

    const reasoning =
      choice?.message?.reasoning_content ||
      choice?.delta?.reasoning_content ||
      "";
    return reasoning;
  }

  function parseTitlingResponse(responseText, format) {
    if (!responseText) return "";
    const trimmed = String(responseText).trim();

    // 1. Try parsing as single JSON object
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmed);
        const extracted = extractTitlingText(parsed, format);
        if (extracted) return extracted;
      } catch {}
    }

    // 2. Try parsing as Server-Sent Events (data: {...})
    let streamText = "";
    const lines = trimmed.split(/\r?\n/);
    for (const line of lines) {
      const l = line.trim();
      if (l.startsWith("data:") && l !== "data: [DONE]") {
        try {
          const json = JSON.parse(l.slice(5).trim());
          const chunk = extractTitlingText(json, format);
          if (chunk) streamText += chunk;
        } catch {}
      }
    }
    if (streamText) return streamText;

    // 3. Plain text response fallback
    if (!trimmed.includes("{") && !trimmed.startsWith("<")) {
      return trimmed;
    }

    return "";
  }

  globalThis.VelaConversationTitling = Object.freeze({
    TITLING_SYSTEM_PROMPT,
    DEFAULT_ENDPOINTS,
    createSmartTitle,
    cleanModelTitle,
    buildTitlingPayload,
    extractTitlingText,
    parseTitlingResponse
  });
})();
