(() => {
  "use strict";

  function resolveEndpoint(baseURL, format) {
    const url = new URL(baseURL);
    let path = url.pathname.replace(/\/+$/, "").replace(/\/(?:chat\/completions|responses|messages)\/?$/i, "");
    path += format === "openai-responses" ? "/responses" : format === "anthropic-messages" ? "/messages" : "/chat/completions";
    url.pathname = path.replace(/\/{2,}/g, "/");
    return url.toString();
  }

  function dataURLParts(dataUrl) {
    const match = String(dataUrl || "").match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.+)$/s);
    return match ? { mediaType: match[1] || "application/octet-stream", base64: match[2] } : null;
  }

  function contentFor(entry, format) {
    const attachments = Array.isArray(entry?.attachments) ? entry.attachments.filter(Boolean) : [];
    if (!attachments.length) return String(entry?.content || "");

    const textAttachments = attachments
      .filter((item) => {
        if (!item?.text) return false;
        const s = String(item.text).trim();
        if (s.startsWith("%PDF-") || (s.includes("/Filter") && s.includes("/FlateDecode"))) {
          return false;
        }
        return true;
      })
      .map((item) => `\n\n<attachment name="${String(item?.name || "Attachment").replace(/["<>]/g, "")}">\n${item.text}\n</attachment>`)
      .join("");

    const nonTextAttachments = attachments.filter((item) => !item?.text);
    const directImageAttachments = attachments.filter((item) => {
      if (item?.kind === "image") return true;
      const source = dataURLParts(item?.dataUrl);
      return Boolean(source?.mediaType?.startsWith("image/"));
    });

    // Also include any page images extracted from attachments (e.g. scanned PDF pages)
    // ONLY if the attachment has NO extracted text (scanned document).
    // If text was extracted, it is already included in textAttachments — do not send image streams.
    const extractedPageImages = [];
    attachments.forEach((item) => {
      if (!item?.text && Array.isArray(item.images) && item.images.length) {
        item.images.forEach((imgUrl, i) => {
          extractedPageImages.push({
            kind: "image",
            name: `${item.name || "page"}_page_${i + 1}.jpg`,
            dataUrl: imgUrl
          });
        });
      }
    });

    const imageAttachments = [...directImageAttachments, ...extractedPageImages];
    const otherNonTextAttachments = nonTextAttachments.filter((item) => !directImageAttachments.includes(item) && (!item.images || !item.images.length));

    const otherNotes = otherNonTextAttachments
      .map((item) => `\n\n[Attached file: ${String(item?.name || "attachment").replace(/["<>]/g, "")}]`)
      .join("");

    const promptText = `${entry?.content || ""}${textAttachments}${otherNotes}`.trim();

    if (format === "anthropic-messages") {
      const parts = [];
      if (promptText) parts.push({ type: "text", text: promptText });
      nonTextAttachments.forEach((attachment) => {
        const source = dataURLParts(attachment.dataUrl);
        if (!source) return;
        if (attachment.kind === "image" || source.mediaType.startsWith("image/")) {
          parts.push({
            type: "image",
            source: { type: "base64", media_type: source.mediaType, data: source.base64 }
          });
        } else if (attachment.kind === "pdf" || source.mediaType === "application/pdf") {
          parts.push({
            type: "document",
            source: { type: "base64", media_type: source.mediaType || "application/pdf", data: source.base64 },
            title: attachment.name || "Document"
          });
        }
      });
      if (parts.length === 1 && parts[0].type === "text") return parts[0].text;
      return parts.length ? parts : promptText;
    }

    if (format === "openai-responses") {
      const parts = [];
      if (promptText) parts.push({ type: "input_text", text: promptText });
      imageAttachments.forEach((attachment) => {
        parts.push({ type: "input_image", image_url: attachment.dataUrl });
      });
      otherNonTextAttachments.forEach((attachment) => {
        if (attachment.dataUrl) {
          parts.push({ type: "input_file", filename: attachment.name || "file", file_data: attachment.dataUrl });
        }
      });
      if (parts.length === 1 && parts[0].type === "input_text") return parts[0].text;
      return parts.length ? parts : promptText;
    }

    // Standard openai-chat format (OpenAI, Groq, OpenRouter, Mistral, Ollama, StepFun, etc.)
    // If there are NO real image attachments, ALWAYS return a plain string.
    // Strict providers (Groq, StepFun) reject array content for text models with 400 "Unrecognized chat message".
    if (!imageAttachments.length) {
      return promptText;
    }

    // Only return an array of content parts when there are actual image attachments
    const parts = [];
    if (promptText) {
      parts.push({ type: "text", text: promptText });
    }
    imageAttachments.forEach((attachment) => {
      parts.push({
        type: "image_url",
        image_url: { url: attachment.dataUrl }
      });
    });
    return parts;
  }

  function buildHistory(messages, userIndex, format, searchContext = "") {
    const raw = (Array.isArray(messages) ? messages : []).slice(0, userIndex + 1).filter(Boolean);
    const history = [];

    for (let index = 0; index < raw.length; index++) {
      const entry = raw[index];
      const isUser = entry?.role === "user" || (!entry?.role && index === userIndex);
      const isSystem = entry?.role === "system";
      const role = isSystem ? "system" : isUser ? "user" : "assistant";

      let content;
      if (isUser) {
        const enriched = index === userIndex && searchContext
          ? { ...entry, content: `${entry.content || ""}${searchContext}` }
          : entry;
        content = contentFor(enriched, format);
      } else {
        content = entry?.content || "";
      }

      // Drop empty messages unless it is the active user message
      if (!content || (typeof content === "string" && !content.trim()) || (Array.isArray(content) && !content.length)) {
        if (index === userIndex) {
          content = " ";
        } else {
          continue;
        }
      }

      history.push({ role, content });
    }

    return history;
  }

  function buildSystemPrompt(basePrompt, taskGuidance) {
    return [String(basePrompt || "").trim(), String(taskGuidance || "").trim()]
      .filter(Boolean)
      .join(" ");
  }

  function buildBody(config, history, systemPrompt) {
    const system = String(systemPrompt || "").trim();

    if (config.format === "anthropic-messages") {
      return {
        model: config.model,
        // Generous default so long, complete files are never cut off;
        // the server retries with a smaller value if the model rejects it.
        max_tokens: 32768,
        system: systemPrompt,
        messages: history,
        stream: true
      };
    }

    if (config.format === "openai-responses") {
      const input = [];
      if (system) {
        input.push({ role: "system", content: system });
      }
      input.push(...history);
      return {
        model: config.model,
        input,
        // No max_output_tokens: let the model emit its full response.
        stream: true,
        reasoning: { summary: "auto" }
      };
    }

    const messages = [];
    if (system) {
      messages.push({ role: "system", content: system });
    }
    messages.push(...history);

    const body = {
      model: config.model,
      messages,
      stream: true
    };
    if (config.provider === "openrouter") body.reasoning = { enabled: true };
    return body;
  }

  function buildProxyPayload(config, endpoint, history, systemPrompt) {
    return {
      provider: config.provider,
      format: config.format,
      endpoint,
      apiKey: config.apiKey,
      requestBody: buildBody(config, history, systemPrompt)
    };
  }

  function validate(config) {
    if (!config.endpoint) return "Add an endpoint or base URL in Settings.";
    if (!config.apiKey) return "Add your API key in Settings.";
    if (!config.model) return "Fetch and select a model before sending.";
    return "";
  }

  globalThis.VelaProviderRequests = Object.freeze({
    resolveEndpoint,
    dataURLParts,
    contentFor,
    buildHistory,
    buildSystemPrompt,
    buildBody,
    buildProxyPayload,
    validate
  });
})();
