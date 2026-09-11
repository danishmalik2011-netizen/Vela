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
    const attachments = Array.isArray(entry?.attachments) ? entry.attachments : [];
    if (!attachments.length) return entry?.content || "";
    const textAttachments = attachments.filter((item) => item.text).map((item) => `\n\n<attachment name="${String(item.name || "Attachment").replace(/["<>]/g, "")}">\n${item.text}\n</attachment>`).join("");
    const promptText = `${entry?.content || ""}${textAttachments}`.trim();
    const content = [];
    if (promptText) content.push({ type: format === "openai-responses" ? "input_text" : "text", text: promptText });
    attachments.filter((item) => !item.text).forEach((attachment) => {
      if (format === "anthropic-messages") {
        const source = dataURLParts(attachment.dataUrl);
        if (!source) return;
        content.push(attachment.kind === "image"
          ? { type: "image", source: { type: "base64", media_type: source.mediaType, data: source.base64 } }
          : { type: "document", source: { type: "base64", media_type: source.mediaType, data: source.base64 }, title: attachment.name });
      } else if (format === "openai-responses") {
        content.push(attachment.kind === "image"
          ? { type: "input_image", image_url: attachment.dataUrl }
          : { type: "input_file", filename: attachment.name, file_data: attachment.dataUrl });
      } else {
        content.push(attachment.kind === "image"
          ? { type: "image_url", image_url: { url: attachment.dataUrl } }
          : { type: "file", file: { filename: attachment.name, file_data: attachment.dataUrl } });
      }
    });
    return content;
  }

  function buildHistory(messages, userIndex, format, searchContext = "") {
    return (Array.isArray(messages) ? messages : []).slice(0, userIndex + 1).map((entry, index) => ({
      role: entry.role,
      content: entry.role === "user"
        ? contentFor(index === userIndex && searchContext ? { ...entry, content: `${entry.content}${searchContext}` } : entry, format)
        : entry.content
    }));
  }

  function buildSystemPrompt(basePrompt, taskGuidance) {
    return [String(basePrompt || "").trim(), String(taskGuidance || "").trim()]
      .filter(Boolean)
      .join(" ");
  }

  function buildBody(config, history, systemPrompt) {
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
      return {
        model: config.model,
        input: [{ role: "system", content: systemPrompt }, ...history],
        // No max_output_tokens: let the model emit its full response.
        stream: true,
        reasoning: { summary: "auto" }
      };
    }

    const body = {
      model: config.model,
      messages: [{ role: "system", content: systemPrompt }, ...history],
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
