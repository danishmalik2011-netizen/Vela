import http from "node:http";
import { readFile } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, extname, join, normalize, relative, resolve } from "node:path";
import net from "node:net";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const cMapUrl = pathToFileURL(join(currentDirectory, "node_modules", "pdfjs-dist", "cmaps")).href + "/";
const standardFontDataUrl = pathToFileURL(join(currentDirectory, "node_modules", "pdfjs-dist", "standard_fonts")).href + "/";
const htmlPath = join(currentDirectory, "component.html");
const faviconPath = join(currentDirectory, "favicon.svg");
const manifestPath = join(currentDirectory, "manifest.webmanifest");
const serviceWorkerPath = join(currentDirectory, "sw.js");
const iconsDirectory = join(currentDirectory, "icons");
const brandAssetNames = new Set([
  "vela-wordmark.svg",
  "vela-wordmark-dark.svg",
  "vela-terminal-square.svg"
]);
const publicSourceDirectory = join(currentDirectory, "src");
const port = Number.parseInt(process.env.PORT || "3000", 10);
const host = process.env.HOST || "127.0.0.1";

const MAX_REQUEST_BYTES = 100 * 1024 * 1024;
const MODEL_TIMEOUT_MS = 45_000;
const CHAT_TIMEOUT_MS = 5 * 60_000;
const SEARCH_TIMEOUT_MS = 15_000;
const MAX_SEARCH_QUERY_LENGTH = 500;
const MAX_SEARCH_RESULTS = 12;
const MAX_RESULTS_PER_QUERY = 8;
const MAX_SEARCH_QUERIES = 5;
const SEARCH_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36";

function sendJson(response, status, body) {
  const serialized = JSON.stringify(body);

  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(serialized),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });

  response.end(serialized);
}

function isPrivateIPv4(address) {
  const parts = address.split(".").map(Number);

  if (parts.length !== 4 || parts.some(Number.isNaN)) {
    return true;
  }

  const [first, second] = parts;

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
}

function isPrivateIPv6(address) {
  const normalized = address.toLowerCase();

  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.") ||
    /^::ffff:172\.(1[6-9]|2\d|3[01])\./.test(normalized)
  );
}

function isPrivateAddress(address) {
  const family = net.isIP(address);

  if (family === 4) return isPrivateIPv4(address);
  if (family === 6) return isPrivateIPv6(address);
  return true;
}

async function validateTarget(rawEndpoint) {
  let endpoint;

  try {
    endpoint = new URL(rawEndpoint);
  } catch {
    throw new Error("The provider endpoint is not a valid URL.");
  }

  if (!["https:", "http:"].includes(endpoint.protocol)) {
    throw new Error("Only HTTP and HTTPS provider endpoints are supported.");
  }

  if (endpoint.username || endpoint.password) {
    throw new Error("Provider URLs cannot contain embedded credentials.");
  }

  const hostname = endpoint.hostname.toLowerCase();

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  ) {
    throw new Error("Local network provider endpoints are not allowed.");
  }

  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new Error("Private network provider endpoints are not allowed.");
    }

    return endpoint;
  }

  let addresses;

  try {
    addresses = await lookup(hostname, {
      all: true,
      verbatim: true
    });
  } catch {
    throw new Error("The provider hostname could not be resolved.");
  }

  if (
    !addresses.length ||
    addresses.some(({ address }) => isPrivateAddress(address))
  ) {
    throw new Error("The provider resolves to a private network address.");
  }

  return endpoint;
}

async function readRawRequest(request) {
  const chunks = [];
  let receivedBytes = 0;

  for await (const chunk of request) {
    receivedBytes += chunk.length;

    if (receivedBytes > MAX_REQUEST_BYTES) {
      const error = new Error("The request is too large.");
      error.status = 413;
      throw error;
    }

    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

async function extractPdfText(request, response) {
  const raw = await readRawRequest(request);
  if (!raw.length) {
    sendJson(response, 400, { error: { message: "Empty request body." } });
    return;
  }

  let pdfBytes;
  const contentType = request.headers["content-type"] || "";

  if (contentType.includes("application/json")) {
    let payload;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      sendJson(response, 400, { error: { message: "Invalid JSON." } });
      return;
    }
    const b64 = typeof payload.data === "string"
      ? payload.data.replace(/^data:[^;,]+(?:;[^,]*)?;base64,/, "")
      : "";
    if (!b64) {
      sendJson(response, 400, { error: { message: "Missing data field." } });
      return;
    }
    pdfBytes = Buffer.from(b64, "base64");
  } else {
    pdfBytes = raw;
  }

  if (pdfBytes.length < 4 || pdfBytes[0] !== 0x25 /* % */ || pdfBytes[1] !== 0x50 /* P */) {
    sendJson(response, 400, { error: { message: "Not a valid PDF file." } });
    return;
  }

  let loadingTask;
  try {
    loadingTask = getDocument({
      data: new Uint8Array(pdfBytes.buffer, pdfBytes.byteOffset, pdfBytes.byteLength),
      cMapUrl,
      cMapPacked: true,
      standardFontDataUrl,
      useSystemFonts: true,
      isEvalSupported: false
    });
    const doc = await loadingTask.promise;

    const pageTexts = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const lines = [];
      let lastY = null;
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const y = item.transform?.[5];
        if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 2) {
          lines.push("\n");
        }
        lines.push(item.str);
        if (y !== undefined) lastY = y;
        if (item.hasEOL) {
          lines.push("\n");
          lastY = null;
        }
      }
      const pageText = lines.join("").trim();
      if (pageText) pageTexts.push(pageText);
    }

    try {
      await doc.cleanup();
    } catch {}
    try {
      await loadingTask.destroy();
    } catch {}

    sendJson(response, 200, { text: pageTexts.join("\n\n") });
  } catch (err) {
    if (loadingTask) {
      try {
        await loadingTask.destroy();
      } catch {}
    }
    sendJson(response, 422, {
      error: { message: `PDF extraction failed: ${err?.message || "unknown error"}` }
    });
  }
}

async function readJsonRequest(request) {
  const chunks = [];
  let receivedBytes = 0;

  for await (const chunk of request) {
    receivedBytes += chunk.length;

    if (receivedBytes > MAX_REQUEST_BYTES) {
      const error = new Error("The request is too large.");
      error.status = 413;
      throw error;
    }

    chunks.push(chunk);
  }

  if (!chunks.length) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("The request body must be valid JSON.");
    error.status = 400;
    throw error;
  }
}

function validateProxyPayload(payload, requireRequestBody = false) {
  const provider = String(payload.provider || "custom");
  const format = String(payload.format || "openai-chat");
  const endpoint = String(payload.endpoint || "").trim();
  const apiKey = String(payload.apiKey || "").trim();

  if (!endpoint) {
    throw new Error("A provider endpoint is required.");
  }

  if (!apiKey) {
    throw new Error("A provider API key is required.");
  }

  if (apiKey.length > 16_384) {
    throw new Error("The provider API key is invalid.");
  }

  if (
    ![
      "openai-chat",
      "openai-responses",
      "anthropic-messages"
    ].includes(format)
  ) {
    throw new Error("The selected provider format is unsupported.");
  }

  if (
    requireRequestBody &&
    (!payload.requestBody ||
      typeof payload.requestBody !== "object" ||
      Array.isArray(payload.requestBody))
  ) {
    throw new Error("A provider request body is required.");
  }

  return {
    provider,
    format,
    endpoint,
    apiKey,
    requestBody: payload.requestBody
  };
}

function createUpstreamHeaders(config, isModelRequest = false) {
  const headers = {
    Accept: isModelRequest
      ? "application/json"
      : "application/json, text/event-stream",
    "Content-Type": "application/json"
  };

  if (config.format === "anthropic-messages") {
    headers["x-api-key"] = config.apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  if (config.provider === "openrouter") {
    headers["HTTP-Referer"] =
      process.env.PUBLIC_APP_URL || `http://${host}:${port}`;
    headers["X-Title"] = "Vela";
  }

  return headers;
}

async function proxyModels(request, response) {
  const payload = await readJsonRequest(request);
  const config = validateProxyPayload(payload);
  const endpoint = await validateTarget(config.endpoint);

  const upstream = await fetch(endpoint, {
    method: "GET",
    headers: createUpstreamHeaders(config, true),
    redirect: "error",
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS)
  });

  const responseText = await upstream.text();

  response.writeHead(upstream.status, {
    "Content-Type":
      upstream.headers.get("content-type") ||
      "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });

  response.end(responseText);
}

async function proxyChat(request, response) {
  const payload = await readJsonRequest(request);
  const config = validateProxyPayload(payload, true);
  const endpoint = await validateTarget(config.endpoint);

  let body = { ...config.requestBody };

  // Sanitize messages for strict OpenAI-compatible providers (e.g. Groq, StepFun, OpenRouter)
  if (Array.isArray(body?.messages)) {
    body.messages = body.messages.filter(Boolean).map((msg) => {
      const sanitized = {
        role: String(msg.role || "user"),
        content: msg.content
      };
      if (msg.name) sanitized.name = String(msg.name);
      if (msg.tool_calls) sanitized.tool_calls = msg.tool_calls;
      if (msg.tool_call_id) sanitized.tool_call_id = msg.tool_call_id;

      // Flatten text-only arrays to a single string so strict providers don't reject with "Unrecognized chat message"
      if (Array.isArray(sanitized.content)) {
        const hasImage = sanitized.content.some((part) =>
          part?.type === "image_url" || part?.type === "image" || part?.type === "input_image"
        );
        if (!hasImage) {
          sanitized.content = sanitized.content
            .map((part) => (typeof part === "string" ? part : part?.text || part?.input_text || ""))
            .filter(Boolean)
            .join("\n\n");
        } else {
          // Guard against non-image data URLs inside image_url (e.g. PDFs)
          sanitized.content = sanitized.content.map((part) => {
            if (part?.type === "image_url" && typeof part?.image_url?.url === "string") {
              const url = part.image_url.url;
              if (url.startsWith("data:") && !url.startsWith("data:image/")) {
                return { type: "text", text: "[Attached non-image document]" };
              }
            }
            return part;
          });
        }
      }

      if (typeof sanitized.content !== "string" && !Array.isArray(sanitized.content)) {
        sanitized.content = String(sanitized.content || "");
      }

      return sanitized;
    }).filter((msg) => {
      // Filter out empty assistant messages that strict providers reject
      if (msg.role === "assistant" && typeof msg.content === "string" && !msg.content.trim()) {
        return false;
      }
      return true;
    });
  }

  let upstream = await fetch(endpoint, {
    method: "POST",
    headers: createUpstreamHeaders(config),
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(CHAT_TIMEOUT_MS)
  });

  // Upstream error recovery:
  // 1. Max output tokens clamping
  // 2. Vision / image decode fallback: if provider rejects messages with "Cannot decode visions" or image errors,
  //    strip image parts and retry with pure text so the user prompt and document text succeed cleanly.
  if (upstream.status === 400 || upstream.status === 422) {
    const errorText = await upstream.text().catch(() => "");
    let retried = false;

    if (
      /max_tokens|max_output_tokens/i.test(errorText) &&
      (Number(body?.max_tokens) > 8192 || Number(body?.max_output_tokens) > 8192)
    ) {
      const retryBody = { ...body };
      if (Number(retryBody.max_tokens) > 8192) retryBody.max_tokens = 8192;
      if (Number(retryBody.max_output_tokens) > 8192) retryBody.max_output_tokens = 8192;
      upstream = await fetch(endpoint, {
        method: "POST",
        headers: createUpstreamHeaders(config),
        body: JSON.stringify(retryBody),
        redirect: "error",
        signal: AbortSignal.timeout(CHAT_TIMEOUT_MS)
      });
      retried = true;
    } else if (/decode vision|cannot decode|vision|image format|unsupported image|invalid image/i.test(errorText)) {
      const hasImages = Array.isArray(body?.messages) && body.messages.some((msg) =>
        Array.isArray(msg?.content) && msg.content.some((part) =>
          part?.type === "image_url" || part?.type === "image" || part?.type === "input_image"
        )
      );

      if (hasImages) {
        const retryBody = {
          ...body,
          messages: body.messages.map((msg) => {
            if (Array.isArray(msg?.content)) {
              const textContent = msg.content
                .map((part) => (typeof part === "string" ? part : part?.text || part?.input_text || ""))
                .filter(Boolean)
                .join("\n\n");
              return { ...msg, content: textContent || " " };
            }
            return msg;
          })
        };

        upstream = await fetch(endpoint, {
          method: "POST",
          headers: createUpstreamHeaders(config),
          body: JSON.stringify(retryBody),
          redirect: "error",
          signal: AbortSignal.timeout(CHAT_TIMEOUT_MS)
        });
        retried = true;
      }
    }

    if (!retried) {
      upstream = new Response(errorText, {
        status: upstream.status,
        headers: { "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8" }
      });
    }
  }

  response.writeHead(upstream.status, {
    "Content-Type":
      upstream.headers.get("content-type") ||
      "application/json; charset=utf-8",
    "Cache-Control": "no-store, no-transform",
    "X-Accel-Buffering": "no",
    "X-Content-Type-Options": "nosniff"
  });

  if (!upstream.body) {
    response.end();
    return;
  }

  const reader = upstream.body.getReader();

  request.on("close", () => {
    reader.cancel().catch(() => {});
  });

  try {
    while (true) {
      const { value, done } = await reader.read();

      if (done) break;

      if (!response.write(Buffer.from(value))) {
        await new Promise((resolve) => {
          response.once("drain", resolve);
        });
      }
    }
  } finally {
    response.end();
  }
}

function resolveAudioEndpoint(rawEndpoint, audioAction = "transcriptions", apiKey = "") {
  if (!rawEndpoint) {
    if (apiKey && apiKey.startsWith("gsk_")) {
      return `https://api.groq.com/openai/v1/audio/${audioAction}`;
    }
    return `https://api.openai.com/v1/audio/${audioAction}`;
  }
  try {
    const url = new URL(rawEndpoint);
    if (url.pathname.includes("/audio/")) {
      return url.toString();
    }
    if (url.hostname.includes("groq.com")) {
      return `https://api.groq.com/openai/v1/audio/${audioAction}`;
    }
    let path = url.pathname.replace(/\/+$/, "").replace(/\/(?:chat\/completions|responses|messages|models)\/?$/i, "");
    if (!path.endsWith("/audio")) {
      path = `${path}/audio/${audioAction}`;
    } else {
      path = `${path}/${audioAction}`;
    }
    url.pathname = path.replace(/\/{2,}/g, "/");
    return url.toString();
  } catch {
    return rawEndpoint;
  }
}

async function proxyAudioTranscribe(request, response) {
  let audioBuffer;
  let mimeType = "audio/webm";
  let apiKey = "";
  let endpoint = "";
  let model = "";
  let language = "";
  let prompt = "";
  let temperature;

  const contentType = request.headers["content-type"] || "";
  const authHeader = String(request.headers["authorization"] || "").trim();
  const bearerKey = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  if (contentType.includes("application/json")) {
    const payload = await readJsonRequest(request);
    if (!payload.audio || typeof payload.audio !== "string") {
      const error = new Error("Audio data is required for transcription.");
      error.status = 400;
      throw error;
    }
    audioBuffer = Buffer.from(payload.audio, "base64");
    if (!audioBuffer.length) {
      const error = new Error("Audio buffer cannot be empty.");
      error.status = 400;
      throw error;
    }
    mimeType = String(payload.mimeType || "audio/webm");
    apiKey = String(payload.apiKey || request.headers["x-provider-key"] || bearerKey || "").trim();
    endpoint = String(payload.endpoint || request.headers["x-provider-endpoint"] || "").trim();
    model = String(payload.model || request.headers["x-provider-model"] || "").trim();
    language = String(payload.language || "");
    prompt = String(payload.prompt || "");
    temperature = payload.temperature;
  } else {
    apiKey = String(request.headers["x-provider-key"] || bearerKey || "").trim();
    endpoint = String(request.headers["x-provider-endpoint"] || "").trim();
    model = String(request.headers["x-provider-model"] || "").trim();
    mimeType = contentType.split(";")[0] || "audio/webm";

    const chunks = [];
    let receivedBytes = 0;
    for await (const chunk of request) {
      receivedBytes += chunk.length;
      if (receivedBytes > MAX_REQUEST_BYTES) {
        const error = new Error("The request is too large.");
        error.status = 413;
        throw error;
      }
      chunks.push(chunk);
    }
    audioBuffer = Buffer.concat(chunks);
    if (!audioBuffer.length) {
      const error = new Error("Audio buffer cannot be empty.");
      error.status = 400;
      throw error;
    }
  }

  if (!apiKey) {
    const error = new Error("A provider API key is required.");
    error.status = 400;
    throw error;
  }

  if (apiKey.length > 16_384) {
    const error = new Error("The provider API key is invalid.");
    error.status = 400;
    throw error;
  }

  const isGemini = endpoint.toLowerCase().includes("generativelanguage.googleapis.com") ||
                   endpoint.toLowerCase().includes("googleapis.com") ||
                   apiKey.startsWith("AIzaSy");

  if (isGemini) {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
    const validatedGemini = await validateTarget(geminiUrl);
    const upstream = await fetch(validatedGemini, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: "Transcribe this audio recording verbatim into text. Output only the transcript, with no additional notes or Markdown code block." },
            {
              inline_data: {
                mime_type: mimeType,
                data: audioBuffer.toString("base64")
              }
            }
          ]
        }]
      }),
      redirect: "error",
      signal: AbortSignal.timeout(MODEL_TIMEOUT_MS)
    });

    const responseText = await upstream.text();
    if (!upstream.ok) {
      response.writeHead(upstream.status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      });
      response.end(responseText);
      return;
    }

    try {
      const data = JSON.parse(responseText);
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      });
      response.end(JSON.stringify({ text }));
      return;
    } catch {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ text: "" }));
      return;
    }
  }

  const targetEndpoint = resolveAudioEndpoint(endpoint, "transcriptions", apiKey);
  const validatedEndpoint = await validateTarget(targetEndpoint);

  const isGroq = apiKey.startsWith("gsk_") || validatedEndpoint.toLowerCase().includes("groq.com");
  let targetModel = model;
  if (isGroq) {
    targetModel = "whisper-large-v3";
  } else if (!targetModel || !targetModel.toLowerCase().includes("whisper")) {
    targetModel = "whisper-1";
  }

  const ext = mimeType.includes("wav") ? "wav" : mimeType.includes("mp3") ? "mp3" : mimeType.includes("ogg") ? "ogg" : mimeType.includes("m4a") ? "m4a" : "webm";
  const formData = new FormData();
  const blob = new Blob([audioBuffer], { type: mimeType });
  formData.append("file", blob, `audio.${ext}`);
  formData.append("model", targetModel);
  formData.append("response_format", "json");
  if (language) formData.append("language", language);
  if (prompt) formData.append("prompt", prompt);
  formData.append("temperature", typeof temperature === "number" ? String(temperature) : "0");

  const upstream = await fetch(validatedEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: formData,
    redirect: "error",
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS)
  });

  const responseText = await upstream.text();
  if (!upstream.ok) {
    console.error(`Audio transcription upstream error (${upstream.status}) from ${validatedEndpoint}:`, responseText);
  }
  response.writeHead(upstream.status, {
    "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(responseText);
}

async function proxyAudioSpeech(request, response) {
  const payload = await readJsonRequest(request);
  const input = String(payload.input || "").trim();
  const authHeader = String(request.headers["authorization"] || "").trim();
  const bearerKey = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const apiKey = String(payload.apiKey || request.headers["x-provider-key"] || bearerKey || "").trim();
  const endpoint = String(payload.endpoint || request.headers["x-provider-endpoint"] || "").trim();
  const rawModel = String(payload.model || request.headers["x-provider-model"] || "").trim();
  const model = (rawModel && rawModel.toLowerCase().includes("tts")) ? rawModel : "tts-1";
  const voice = String(payload.voice || "alloy").trim();
  const speed = typeof payload.speed === "number" ? payload.speed : 1.0;
  const responseFormat = String(payload.response_format || "mp3").trim();

  if (!input) {
    const error = new Error("Text input is required for speech synthesis.");
    error.status = 400;
    throw error;
  }

  if (input.length > 4096) {
    const error = new Error("Text input exceeds maximum limit of 4096 characters.");
    error.status = 400;
    throw error;
  }

  if (!apiKey) {
    const error = new Error("A provider API key is required.");
    error.status = 400;
    throw error;
  }

  if (apiKey.length > 16_384) {
    const error = new Error("The provider API key is invalid.");
    error.status = 400;
    throw error;
  }

  const isGoogle = endpoint.includes("googleapis.com") || payload.provider === "gemini" || payload.provider === "google";
  if (isGoogle) {
    const googleEndpoint = endpoint && endpoint.includes("synthesize")
      ? endpoint
      : "https://texttospeech.googleapis.com/v1/text:synthesize";
    const validatedGoogle = await validateTarget(googleEndpoint);
    const googleUrl = `${validatedGoogle}?key=${encodeURIComponent(apiKey)}`;
    const googleUpstream = await fetch(googleUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text: input },
        voice: {
          languageCode: "en-US",
          name: voice.includes("-") ? voice : "en-US-Journey-F"
        },
        audioConfig: {
          audioEncoding: "MP3",
          speakingRate: speed
        }
      }),
      redirect: "error",
      signal: AbortSignal.timeout(MODEL_TIMEOUT_MS)
    });

    if (!googleUpstream.ok) {
      const errorText = await googleUpstream.text();
      response.writeHead(googleUpstream.status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      });
      response.end(errorText);
      return;
    }

    const data = await googleUpstream.json();
    const audioBuf = Buffer.from(data.audioContent || "", "base64");
    response.writeHead(200, {
      "Content-Type": "audio/mpeg",
      "Content-Length": audioBuf.length,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    });
    response.end(audioBuf);
    return;
  }

  if (endpoint.includes("groq.com")) {
    const error = new Error("Groq provides Whisper speech recognition, but does not support TTS speech synthesis. Voice output uses local browser speech.");
    error.status = 400;
    throw error;
  }

  const targetEndpoint = resolveAudioEndpoint(endpoint, "speech");
  const validatedEndpoint = await validateTarget(targetEndpoint);

  const upstream = await fetch(validatedEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input,
      voice,
      response_format: responseFormat,
      speed
    }),
    redirect: "error",
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS)
  });

  if (!upstream.ok) {
    const errorText = await upstream.text();
    response.writeHead(upstream.status, {
      "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    });
    response.end(errorText);
    return;
  }

  response.writeHead(upstream.status, {
    "Content-Type": upstream.headers.get("content-type") || (responseFormat === "opus" ? "audio/opus" : "audio/mpeg"),
    "Cache-Control": "no-store, no-transform",
    "X-Accel-Buffering": "no",
    "X-Content-Type-Options": "nosniff"
  });

  if (!upstream.body) {
    response.end();
    return;
  }

  const reader = upstream.body.getReader();
  request.on("close", () => {
    reader.cancel().catch(() => {});
  });

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!response.write(Buffer.from(value))) {
        await new Promise((resolve) => {
          response.once("drain", resolve);
        });
      }
    }
  } finally {
    response.end();
  }
}

function decodeXml(value) {
  const entities = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    quot: '"'
  };

  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (match, code) => {
      const radix = code[0].toLowerCase() === "x" ? 16 : 10;
      const value = Number.parseInt(radix === 16 ? code.slice(1) : code, radix);
      return Number.isFinite(value) ? String.fromCodePoint(value) : match;
    })
    .replace(/&([a-z]+);/gi, (match, name) =>
      Object.hasOwn(entities, name.toLowerCase())
        ? entities[name.toLowerCase()]
        : match
    );
}

function readXmlTag(xml, tagName) {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(xml || "").match(
    new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i")
  );

  return match ? decodeXml(match[1]).trim() : "";
}

function parseSearchFeed(xml) {
  return [...String(xml || "").matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)]
    .slice(0, MAX_RESULTS_PER_QUERY)
    .map((match) => ({
      title: readXmlTag(match[1], "title"),
      url: readXmlTag(match[1], "link"),
      snippet: readXmlTag(match[1], "description"),
      publishedAt: readXmlTag(match[1], "pubDate"),
      engine: "bing"
    }))
    .filter((result) => result.title && /^https?:\/\//i.test(result.url));
}

function stripHtml(value) {
  return decodeXml(
    String(value || "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function parseBraveResults(html) {
  const source = String(html || "");
  const starts = [...source.matchAll(
    /<div class="snippet[^>]*data-pos="\d+"[^>]*data-type="web"[^>]*>/gi
  )];
  const results = [];

  starts.forEach((match, index) => {
    const start = match.index + match[0].length;
    const end = starts[index + 1]?.index || source.length;
    const fragment = source.slice(start, end);
    const link = fragment.match(
      /<a\s+href="(https?:\/\/[^"#]+)"[^>]*class="[^"]*\bl1\b[^"]*"[^>]*>/i
    );
    const title = fragment.match(
      /<div class="title search-snippet-title[^>]*>([\s\S]*?)<\/div>/i
    );
    const snippet = fragment.match(
      /<div class="content desktop-default-regular[^>]*>([\s\S]*?)<\/div>/i
    );

    if (!link || !title) return;

    results.push({
      title: stripHtml(title[1]),
      url: decodeXml(link[1]),
      snippet: snippet ? stripHtml(snippet[1]) : "",
      publishedAt: "",
      engine: "brave"
    });
  });

  return results
    .filter((result) => result.title && result.url)
    .slice(0, MAX_RESULTS_PER_QUERY);
}

function normalizeSearchText(value) {
  return stripHtml(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function planSearchQueries(query) {
  const clean = String(query || "").replace(/\s+/g, " ").trim();
  const base = clean.slice(0, MAX_SEARCH_QUERY_LENGTH);
  const queries = [base];

  // Concise stripped version removing question fluff
  const stripped = base
    .replace(/^(?:please\s+)?(?:tell\s+me|show\s+me|find|search\s+for|look\s+up|what\s+is|who\s+is|where\s+is|when\s+was|how\s+to|can\s+you)\s+/i, "")
    .replace(/[?!.]+$/, "")
    .trim();

  if (stripped && stripped.length >= 3 && stripped.toLowerCase() !== base.toLowerCase()) {
    queries.push(stripped);
  }

  // If asking for recent / breaking events, add targeted fresh variation
  if (looksLikeFreshQuery(clean)) {
    const hasYear = /\b20\d{2}\b/.test(clean);
    const year = new Date().getFullYear();
    const freshQuery = hasYear ? `${stripped || base} news` : `${stripped || base} ${year} news`;
    queries.push(freshQuery);

    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const currentMonth = monthNames[new Date().getMonth()];
    if (/\b(?:7\s*days?|24\s*hours?|recently|this\s+week)\b/i.test(clean)) {
      queries.push(`${stripped || base} ${currentMonth} ${year}`);
    }
    if (/\b(?:model|models|llm|ai)\b/i.test(clean)) {
      queries.push(`"AI models" OR "LLM" released ${year}`);
    }
  }

  return [...new Set(queries)].slice(0, MAX_SEARCH_QUERIES);
}

function canonicalSearchUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|gclid|fbclid|ref|source|spm|from)/i.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.pathname = url.pathname.replace(/\/$/, "") || "/";
    return url.toString();
  } catch {
    return String(value || "");
  }
}

function isGenericHomepageOrCategory(urlStr) {
  try {
    const u = new URL(urlStr);
    const path = u.pathname.replace(/\/$/, "");
    if (!path || path === "") return true;
    if (/^\/(world|news|latest|category|categories|section|topics|feed|home|index|en|us|uk|default\.asp|index\.html|index\.php)$/i.test(path)) return true;
    if (/^\/[a-z]{2}(-[a-z]{2})?$/i.test(path)) return true;
    return false;
  } catch {
    return false;
  }
}

const OFFICIAL_TECH_DOMAINS = new Set([
  "openai.com", "anthropic.com", "deepmind.google", "blog.google",
  "ai.google", "meta.com", "ai.meta.com", "microsoft.com", "nvidia.com",
  "github.com", "huggingface.co", "deepseek.com", "apple.com",
  "amazon.science", "aws.amazon.com", "nature.com", "science.org",
  "whitehouse.gov", "nasa.gov", "nih.gov", "who.int", "cdc.gov"
]);

const TRUSTED_NEWS_DOMAINS = new Set([
  "reuters.com", "apnews.com", "bloomberg.com", "bbc.com", "bbc.co.uk",
  "theverge.com", "techcrunch.com", "arstechnica.com", "wired.com",
  "wsj.com", "nytimes.com", "ft.com", "cnbc.com", "economist.com",
  "theguardian.com", "forbes.com", "washingtonpost.com", "scientificamerican.com"
]);

const WIKI_ACADEMIC_DOMAINS = new Set([
  "wikipedia.org", "en.wikipedia.org", "britannica.com", "plato.stanford.edu",
  "ncbi.nlm.nih.gov", "arxiv.org", "biorxiv.org", "semanticscholar.org"
]);

const FORUM_DOMAINS = new Set([
  "reddit.com", "stackoverflow.com", "stackexchange.com", "quora.com",
  "news.ycombinator.com", "x.com", "twitter.com"
]);

function categorizeSourceType(url, host = "") {
  let hostname = host.toLowerCase().replace(/^www\./, "");
  if (!hostname && url) {
    try { hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch {}
  }

  if (OFFICIAL_TECH_DOMAINS.has(hostname) || hostname.endsWith(".gov") || hostname.endsWith(".edu")) {
    return "official_blog";
  }
  for (const d of OFFICIAL_TECH_DOMAINS) {
    if (hostname.endsWith(`.${d}`)) return "official_blog";
  }

  if (TRUSTED_NEWS_DOMAINS.has(hostname)) return "news_outlet";
  for (const d of TRUSTED_NEWS_DOMAINS) {
    if (hostname.endsWith(`.${d}`)) return "news_outlet";
  }

  if (WIKI_ACADEMIC_DOMAINS.has(hostname)) return "wiki";
  for (const d of WIKI_ACADEMIC_DOMAINS) {
    if (hostname.endsWith(`.${d}`)) return "wiki";
  }

  if (FORUM_DOMAINS.has(hostname)) return "forum";
  for (const d of FORUM_DOMAINS) {
    if (hostname.endsWith(`.${d}`)) return "forum";
  }

  return "unknown";
}

function extractPublishedDate(result) {
  if (result.publishedAt && String(result.publishedAt).trim()) {
    try {
      const d = new Date(result.publishedAt);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    } catch {}
    const match = String(result.publishedAt).match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (match) return match[1];
  }

  // URL pattern: /2026/09/10/ or /2026-09-10/
  const urlMatch = String(result.url || "").match(/\/(20\d{2})[-/](0[1-9]|1[0-2])[-/](0[1-9]|[12]\d|3[01])\b/);
  if (urlMatch) {
    return `${urlMatch[1]}-${urlMatch[2]}-${urlMatch[3]}`;
  }

  // Snippet pattern: Sep 10, 2026 or 10 Sep 2026
  const snippet = String(result.snippet || "");
  const dateMatch = snippet.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(20\d{2})\b/i);
  if (dateMatch) {
    try {
      const d = new Date(`${dateMatch[1]} ${dateMatch[2]}, ${dateMatch[3]}`);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    } catch {}
  }

  return "";
}

function isWithinTimeConstraint(publishedDate, timeConstraint) {
  if (!timeConstraint || timeConstraint === "none" || !publishedDate) return true;
  const pubTime = new Date(publishedDate).getTime();
  if (isNaN(pubTime)) return true;
  const now = Date.now();
  const ageDays = (now - pubTime) / (1000 * 60 * 60 * 24);

  if (timeConstraint === "24h") return ageDays <= 2.5;
  if (timeConstraint === "7d") return ageDays <= 9;
  if (timeConstraint === "30d") return ageDays <= 35;
  if (timeConstraint === "1y") return ageDays <= 375;
  return true;
}

function sourceQualityScore(result) {
  const type = result.source_type || categorizeSourceType(result.url, result.host);
  if (type === "official_blog") return 25;
  if (type === "news_outlet") return 18;
  if (type === "wiki") return 15;
  if (type === "forum") return -10;
  return 0;
}

function rankSearchResults(query, results, intentObj = {}) {
  const normalizedQuery = normalizeSearchText(query);
  const terms = normalizedQuery
    .split(" ")
    .filter((term) => term.length > 1);

  const entities = (intentObj.entities || []).map((e) => normalizeSearchText(e)).filter(Boolean);

  const STOP_WORDS = new Set([
    "the", "a", "an", "in", "on", "at", "for", "of", "to", "is", "are", "was", "were",
    "it", "and", "or", "with", "by", "from", "that", "this", "last", "past", "few",
    "days", "about", "what", "how", "who", "when", "where", "can", "please", "tell",
    "show", "find", "search", "week", "month", "year"
  ]);
  const coreTerms = terms.filter((t) => !STOP_WORDS.has(t) && t.length > 1);

  return results
    .map((result, index) => {
      const title = normalizeSearchText(result.title);
      const snippet = normalizeSearchText(result.snippet || "");
      const urlText = normalizeSearchText(result.url || "");
      const searchable = `${title} ${snippet} ${urlText}`;

      const sourceType = result.source_type || categorizeSourceType(result.url, result.host);
      const publishedDate = extractPublishedDate(result);
      const timeConstraint = intentObj.time_constraint || "none";
      const withinWindow = isWithinTimeConstraint(publishedDate, timeConstraint);

      // 1. Entity matching check
      let entityMatched = false;
      let titleEntityMatch = false;
      for (const entity of entities) {
        if (entity.length >= 2) {
          if (title.includes(entity)) {
            entityMatched = true;
            titleEntityMatch = true;
          } else if (searchable.includes(entity)) {
            entityMatched = true;
          }
        }
      }

      // 2. Core terms coverage check
      let matchedCoreCount = 0;
      for (const term of coreTerms) {
        if (searchable.includes(term)) {
          matchedCoreCount += 1;
        }
      }
      const termCoverage = coreTerms.length > 0 ? (matchedCoreCount / coreTerms.length) : (entityMatched ? 1.0 : 0);

      // HARD RELEVANCE GATE:
      // If there are core query terms and ZERO of them match and no entity matched,
      // this result is completely off-topic (e.g. Brouwer fixed-point theorem).
      if (coreTerms.length >= 2 && matchedCoreCount === 0 && !entityMatched) {
        return {
          ...result,
          score: -100,
          relevance_score: 0.05,
          source_type: sourceType,
          published_date: publishedDate,
          out_of_window: !withinWindow,
          is_off_topic: true
        };
      }

      // If coverage is poor and no entity matched, mark as low-quality
      if (coreTerms.length >= 2 && termCoverage < 0.34 && !entityMatched) {
        return {
          ...result,
          score: -20,
          relevance_score: 0.15,
          source_type: sourceType,
          published_date: publishedDate,
          out_of_window: !withinWindow,
          is_off_topic: true
        };
      }

      let score = Math.max(0, MAX_RESULTS_PER_QUERY - (result.resultIndex ?? index));
      if (result.queryIndex === 0) score += 5;

      // Penalize generic homepages and shallow landing hubs heavily
      if (isGenericHomepageOrCategory(result.url)) {
        score -= 40;
      } else {
        score += 15; // Specific deep article / page bonus
      }

      // Entity matching bonus
      if (titleEntityMatch) score += 50;
      else if (entityMatched) score += 25;

      // Exact phrase matches
      if (normalizedQuery && title.includes(normalizedQuery)) score += 80;
      else if (normalizedQuery && searchable.includes(normalizedQuery)) score += 35;

      // Term coverage bonus
      score += Math.round(termCoverage * 40);

      // Matching query terms
      for (const term of terms) {
        if (title.split(" ").includes(term)) score += 14;
        else if (title.includes(term)) score += 8;
        if (snippet.includes(term)) score += 5;
        if (urlText.includes(term)) score += 8;
      }

      // Source quality bonus (only for on-topic results)
      score += sourceQualityScore({ ...result, source_type: sourceType });

      // Wikipedia authoritative match bonus (only if on-topic)
      if (result.engine === "wikipedia" && (termCoverage >= 0.5 || entityMatched)) score += 15;

      // Direct instant answer bonus
      if (result.engine === "ddg-instant" || result.engine === "tavily" || result.engine === "serper") score += 25;

      // Recency bonus / penalty
      if (publishedDate && withinWindow && intentObj.freshness_required) {
        score += 25;
      } else if (!withinWindow) {
        score -= 50; // Heavy penalty for out-of-window results
      }

      // Normalize relevance score to 0.05 - 0.99
      let normalizedRel = 0.30 + (termCoverage * 0.35);
      if (titleEntityMatch) normalizedRel += 0.20;
      else if (entityMatched) normalizedRel += 0.10;
      if (sourceType === "official_blog") normalizedRel += 0.12;
      else if (sourceType === "news_outlet") normalizedRel += 0.08;
      if (publishedDate && withinWindow && intentObj.freshness_required) normalizedRel += 0.08;

      const relevanceScore = Math.max(0.05, Math.min(0.99, Number(normalizedRel.toFixed(2))));

      return {
        ...result,
        score,
        relevance_score: relevanceScore,
        source_type: sourceType,
        published_date: publishedDate,
        out_of_window: !withinWindow,
        is_off_topic: false
      };
    })
    .sort((left, right) => right.score - left.score);
}

async function fetchWikipediaResults(query) {
  try {
    const url = new URL("https://en.wikipedia.org/w/api.php");
    url.searchParams.set("action", "query");
    url.searchParams.set("list", "search");
    url.searchParams.set("srsearch", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("utf8", "1");
    url.searchParams.set("srlimit", "4");

    const upstream = await fetch(url, {
      headers: {
        "User-Agent": "Vela-Intelligence/1.0 (https://vela.chat; research@vela.chat)"
      },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS)
    });
    if (!upstream.ok) return [];
    const data = await upstream.json();
    const items = data?.query?.search || [];
    return items.map((item, idx) => {
      const title = item.title;
      const slug = title.replace(/\s+/g, "_");
      return {
        title: `${title} - Wikipedia`,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(slug)}`,
        snippet: stripHtml(item.snippet),
        publishedAt: item.timestamp || "",
        wikiSlug: slug,
        engine: "wikipedia",
        resultIndex: idx
      };
    });
  } catch {
    return [];
  }
}

async function fetchDuckDuckGoResults(query) {
  try {
    const url = new URL("https://html.duckduckgo.com/html/");
    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "User-Agent": SEARCH_USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
      },
      body: "q=" + encodeURIComponent(query),
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS)
    });
    if (!upstream.ok) return [];
    const html = await upstream.text();
    const results = [];
    const parts = html.split(/class="[^"]*result__body/i).slice(1);
    for (let idx = 0; idx < parts.length; idx++) {
      const part = parts[idx];
      const titleM = part.match(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      const snippetM = part.match(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
      if (titleM) {
        let rawUrl = titleM[1];
        if (rawUrl.includes("uddg=")) {
          try {
            const u = new URL(rawUrl.startsWith("//") ? "https:" + rawUrl : rawUrl);
            rawUrl = decodeURIComponent(u.searchParams.get("uddg") || rawUrl);
          } catch {}
        }
        const title = stripHtml(titleM[2]);
        const snippet = stripHtml(snippetM ? snippetM[1] : "");
        if (title && /^https?:\/\//i.test(rawUrl)) {
          results.push({
            title,
            url: rawUrl,
            snippet,
            publishedAt: "",
            engine: "duckduckgo",
            resultIndex: idx
          });
        }
      }
    }
    return results.slice(0, MAX_RESULTS_PER_QUERY);
  } catch {
    return [];
  }
}

async function fetchDuckDuckGoInstantAnswer(query) {
  try {
    const url = new URL("https://api.duckduckgo.com/");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("no_html", "1");
    url.searchParams.set("skip_disambig", "1");

    const upstream = await fetch(url, {
      headers: { "User-Agent": SEARCH_USER_AGENT },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS)
    });
    if (!upstream.ok) return [];
    const data = await upstream.json();
    const results = [];
    if (data.AbstractText && data.AbstractURL) {
      results.push({
        title: data.Heading ? `${data.Heading} - Overview` : "Summary",
        url: data.AbstractURL,
        snippet: data.AbstractText,
        publishedAt: "",
        engine: "ddg-instant",
        resultIndex: 0
      });
    }
    if (data.Answer && data.AnswerType) {
      results.push({
        title: `Direct Answer: ${query}`,
        url: data.AbstractURL || "https://duckduckgo.com/?q=" + encodeURIComponent(query),
        snippet: data.Answer,
        publishedAt: "",
        engine: "ddg-instant",
        resultIndex: 0
      });
    }
    return results;
  } catch {
    return [];
  }
}

async function fetchBraveResults(query) {
  try {
    const searchUrl = new URL("https://search.brave.com/search");
    searchUrl.searchParams.set("q", query);
    searchUrl.searchParams.set("source", "web");

    const upstream = await fetch(searchUrl, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": SEARCH_USER_AGENT
      },
      redirect: "error",
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS)
    });

    if (!upstream.ok) return [];
    return parseBraveResults(await upstream.text());
  } catch {
    return [];
  }
}

async function fetchBingResults(query) {
  try {
    const searchUrl = new URL("https://www.bing.com/search");
    searchUrl.searchParams.set("format", "rss");
    searchUrl.searchParams.set("q", query);

    const upstream = await fetch(searchUrl, {
      headers: {
        Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8",
        "User-Agent": SEARCH_USER_AGENT
      },
      redirect: "error",
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS)
    });

    if (!upstream.ok) return [];
    return parseSearchFeed(await upstream.text());
  } catch {
    return [];
  }
}

async function fetchTavilyResults(query) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return [];
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "basic",
        include_answer: true,
        max_results: 8
      }),
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS)
    });
    if (!res.ok) return [];
    const data = await res.json();
    const results = [];
    if (data.answer) {
      results.push({
        title: `Summary: ${query}`,
        url: data.results?.[0]?.url || "https://tavily.com",
        snippet: data.answer,
        publishedAt: "",
        engine: "tavily",
        resultIndex: 0
      });
    }
    (data.results || []).forEach((item, idx) => {
      results.push({
        title: item.title,
        url: item.url,
        snippet: item.content || "",
        publishedAt: item.published_date || "",
        engine: "tavily",
        resultIndex: idx + 1
      });
    });
    return results;
  } catch {
    return [];
  }
}

async function fetchBraveApiResults(query) {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) return [];
  try {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", "8");
    const res = await fetch(url.toString(), {
      headers: {
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": apiKey
      },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS)
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.web?.results || []).map((item, idx) => ({
      title: item.title || "",
      url: item.url || "",
      snippet: item.description || "",
      publishedAt: item.page_age || "",
      engine: "brave",
      resultIndex: idx + 1
    }));
  } catch {
    return [];
  }
}

async function fetchSerperResults(query) {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return [];
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey
      },
      body: JSON.stringify({ q: query, num: 8 }),
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS)
    });
    if (!res.ok) return [];
    const data = await res.json();
    const results = [];
    if (data.answerBox?.snippet || data.answerBox?.answer) {
      results.push({
        title: data.answerBox.title || `Answer: ${query}`,
        url: data.answerBox.link || "https://google.com",
        snippet: data.answerBox.snippet || data.answerBox.answer || "",
        publishedAt: "",
        engine: "serper",
        resultIndex: 0
      });
    }
    (data.organic || []).forEach((item, idx) => {
      results.push({
        title: item.title || "",
        url: item.link || "",
        snippet: item.snippet || "",
        publishedAt: item.date || "",
        engine: "serper",
        resultIndex: idx + 1
      });
    });
    return results;
  } catch {
    return [];
  }
}

const MAX_EXTRACT_CHARS = 1600;
const MAX_EXTRACT_PAGES = 10;

function looksLikeFreshQuery(query) {
  return /\b(today|tonight|right now|currently|latest|current|news|breaking|recently|this week|this month|this year|weather|price|prices|stock|score|won|winner|release|update|updates|announced|announce|election|rates?|deadline|schedule|who won|what happened|who is the current|prime minister|president of|ceo of)\b/i.test(
    query
  );
}

function isCodeOrJunk(text) {
  if (!text || typeof text !== "string") return true;
  const trimmed = text.trim();
  if (trimmed.length < 25) return true;
  if (/^[\s{}[\]();,.<>+=!|&^%$#@~`"'-]+$/.test(trimmed)) return true;
  if (/(?:function\s*\(|const\s+\w+\s*=|var\s+\w+\s*=|let\s+\w+\s*=|document\.|window\.|addEventListener|\{\s*this\.|x-cloak|x-data|v-if|v-for)/i.test(trimmed)) {
    return true;
  }
  return false;
}

function extractPageText(html) {
  let content = String(html || "");
  content = content
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, " ")
    .replace(/<(nav|header|footer|aside|form|dialog)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<div\b[^>]*(?:class|id)=["'][^"']*(?:cookie|consent|banner|overlay|nav|menu|sidebar|footer|ad-|advertisement)[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, " ");

  const articleMatch = content.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i) ||
                       content.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i) ||
                       content.match(/<div\b[^>]*(?:class|id)=["'][^"']*(?:article-body|post-content|entry-content|content-body|story-body|mw-parser-output)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  if (articleMatch) {
    content = articleMatch[1];
  }

  const stripped = decodeXml(
    content
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();

  if (isCodeOrJunk(stripped)) {
    return "";
  }

  return stripped.slice(0, MAX_EXTRACT_CHARS);
}

async function safeFetchHtml(initialUrl, maxRedirects = 3) {
  let currentUrl = initialUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    let validated;
    try {
      validated = await validateTarget(currentUrl);
    } catch {
      return "";
    }

    try {
      const response = await fetch(validated.toString(), {
        headers: {
          "User-Agent": SEARCH_USER_AGENT,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9"
        },
        redirect: "manual",
        signal: AbortSignal.timeout(8000)
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const loc = response.headers.get("location");
        if (!loc) break;
        currentUrl = new URL(loc, currentUrl).toString();
        continue;
      }

      if (!response.ok) return "";
      const contentType = response.headers.get("content-type") || "";
      if (!/text\/html|application\/xhtml\+xml|text\/plain/i.test(contentType)) return "";
      return await response.text();
    } catch {
      return "";
    }
  }
  return "";
}

async function extractResultPages(results, query) {
  const top = results.slice(0, MAX_EXTRACT_PAGES);
  const extractions = await Promise.allSettled(
    top.map(async (result) => {
      try {
        if (result.wikiSlug || (result.url && result.url.includes("wikipedia.org/wiki/"))) {
          try {
            const slug = result.wikiSlug || result.url.split("/wiki/")[1]?.split(/[?#]/)[0];
            if (slug) {
              const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`;
              const res = await fetch(summaryUrl, {
                headers: { "User-Agent": "Vela-Intelligence/1.0 (https://vela.chat; research@vela.chat)" },
                signal: AbortSignal.timeout(5000)
              });
              if (res.ok) {
                const data = await res.json();
                if (data.extract) {
                  return { text: data.extract, excerpt: data.extract.slice(0, 420) };
                }
              }
            }
          } catch {}
        }

        const html = await safeFetchHtml(result.url);
        if (!html) {
          return { text: result.snippet || "", excerpt: (result.snippet || "").slice(0, 420) };
        }
        const text = extractPageText(html);
        const finalExtract = (!isCodeOrJunk(text) ? text : "") || result.snippet || "";
        return { text: finalExtract, excerpt: finalExtract.slice(0, 420) };
      } catch {
        return { text: result.snippet || "", excerpt: (result.snippet || "").slice(0, 420) };
      }
    })
  );

  return top.map((result, index) => {
    const extraction =
      extractions[index]?.status === "fulfilled"
        ? extractions[index].value
        : { text: result.snippet || "", excerpt: (result.snippet || "").slice(0, 420) };

    return {
      ...result,
      ...extraction,
      host: (() => {
        try {
          return new URL(result.url).hostname.replace(/^www\./, "");
        } catch {
          return "";
        }
      })(),
      favicon: (() => {
        try {
          const { hostname } = new URL(result.url);
          return `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(hostname)}`;
        } catch {
          return "";
        }
      })()
    };
  });
}

const SERVER_ANAPHORA_PATTERNS = [
  /\b(?:the\s+same(?:\s+thing)?|same\s+thing|same\s+query|same\s+topic|same\s+search)\b/i,
  /\b(?:for\s+the\s+same|about\s+the\s+same)\b/i,
  /\b(?:search\s+again|try\s+again|run\s+again|check\s+again|retry(?:\s+search)?|re-?run|repeat(?:\s+search)?)\b/i,
  /\b(?:what\s+about|how\s+about|and\s+for|what\s+of)\b/i,
  /\b(?:as\s+(?:mentioned|asked|discussed|said)(?:\s+earlier|\s+above|\s+before)?)\b/i,
  /\b(?:that\s+thing\s+I\s+asked(?:\s+about)?|the\s+previous\s+(?:question|topic|search))\b/i,
  // Trailing bare pronouns ("the open source ones?", "not those") are anaphoric,
  // but an interior "one"/"those" is usually a real quantifier, not a reference.
  /\b(?:ones?|those|these)\s*[?.!]*$/i
];

// Words that only exist to point back at the previous turn; removed when we
// merge a follow-up with its antecedent so the merged query stays clean.
const SERVER_ANAPHORA_RESIDUAL = /\b(?:the\s+same(?:\s+thing)?|for\s+the\s+same|about\s+the\s+same|same\s+here|same\s+query|same\s+topic|same\s+search|it|this|that|those|them|these|ones?|search\s+(?:for\s+)?(?:the\s+)?same|try\s+searching|searching\s+again|search\s+again|try\s+again|trying\s+again|run\s+again|check\s+again|re-?run|repeat|retry|again|look\s+up|the\s+previous\s+(?:question|topic|search)|previous\s+(?:question|topic|search)|as\s+(?:mentioned|asked|discussed|said)(?:\s+earlier|\s+above|\s+before)?)\b/gi;

const SERVER_PREAMBLE_PATTERNS = [
  /\b(?:now\s+that\s+(?:it\s+is|it's|we've|you've)\s+(?:fixed|working|resolved|ready|back)[^,.;!?]*[,.;!?]?)\s*/gi,
  /\b(?:since\s+(?:it\s+is|it's)\s+(?:fixed|working|resolved)[^,.;!?]*[,.;!?]?)\s*/gi,
  /\b(?:ok|okay|great|awesome|cool|thanks|thank you|perfect|now)\s*[,.;!:-]\s*/gi,
  /\b(?:can\s+you\s+(?:please\s+)?search(?:\s+for)?|could\s+you\s+(?:please\s+)?search(?:\s+for)?|please\s+search(?:\s+for)?|search\s+for|look\s+up|find(?:\s+me)?)\s*/gi
];

function stripServerPreamble(message) {
  let text = String(message || "").trim();
  for (const pattern of SERVER_PREAMBLE_PATTERNS) {
    text = text.replace(pattern, " ").trim();
  }
  return text
    .replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9?.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveServerConversationalQuery(rawQuery, history = []) {
  const raw = String(rawQuery || "").trim();
  if (!raw) return "";

  const stripped = stripServerPreamble(raw);
  const isAnaphoric = SERVER_ANAPHORA_PATTERNS.some((p) => p.test(raw)) ||
    /^(?:it|this|that|those|them|for the same|search for the same)[?.!]*$/i.test(stripped);

  if (!isAnaphoric) {
    if (stripped.length >= 3 && stripped !== raw) {
      return stripped;
    }
    return raw;
  }

  if (Array.isArray(history) && history.length > 0) {
    for (let i = history.length - 1; i >= 0; i--) {
      const turn = history[i];
      if (turn?.role === "user" && turn?.content) {
        const pastContent = stripServerPreamble(turn.content);
        if (pastContent.length >= 6 && !SERVER_ANAPHORA_PATTERNS.some((p) => p.test(pastContent))) {
          const residual = stripped
            .replace(SERVER_ANAPHORA_RESIDUAL, " ")
            .replace(/^(?:what\s+about|how\s+about|what\s+of|and\s+for|and)\s+/i, "")
            .replace(/\s+/g, " ")
            .replace(/[?.!]+$/, "")
            .trim();

          if (residual.length >= 3) {
            return `${pastContent} ${residual}`.trim();
          }
          return pastContent;
        }
      }
    }
  }

  return stripped || raw;
}

function classifyServerQueryIntent(query) {
  const clean = String(query || "").trim();
  const timeConstraints = [
    { type: "24h", pattern: /\b(?:today|tonight|past 24 hours|last 24 hours|past day)\b/i },
    { type: "7d", pattern: /\b(?:last 7 days|past 7 days|past week|this week|last week|recently|recent|few days)\b/i },
    { type: "30d", pattern: /\b(?:this month|past 30 days|last 30 days|last month|past month)\b/i },
    { type: "1y", pattern: /\b(?:this year|past year|last year|20\d{2})\b/i }
  ];

  let time_constraint = "none";
  for (const c of timeConstraints) {
    if (c.pattern.test(clean)) {
      time_constraint = c.type;
      break;
    }
  }

  let intent = "factual_lookup";
  if (/\b(?:latest|breaking|news|recent|recently|today|tonight|yesterday|this week|this month|just announced|released?|updates?|election|launch|score|winner)\b/i.test(clean) || (time_constraint !== "none" && time_constraint !== "1y")) {
    intent = "news";
  } else if (/\b(?:vs\.?|versus|compare|comparison|difference between|pros and cons)\b/i.test(clean)) {
    intent = "comparison";
  } else if (/\b(?:how to|how do|steps to|guide to|tutorial)\b/i.test(clean)) {
    intent = "how_to";
  } else if (/\b(?:what (?:is|are)|define|definition of|meaning of)\b/i.test(clean)) {
    intent = "definition";
  }

  const entities = [];
  const capMatches = clean.match(/\b[A-Z][a-zA-Z0-9]+(?:\s+[A-Z0-9][a-zA-Z0-9.]*)+(?:\s+(?:V\d+|v\d+|Opus|Sonnet|Pro|Max|Mini|Flash|R1|o1|o3))?\b/g);
  if (capMatches) {
    capMatches.forEach((m) => {
      const c = m.trim();
      if (!/^(?:Please|Tell|Show|Find|Search|Look|What|Where|When|Who|How|Can|The|This|That)\b/i.test(c)) {
        entities.push(c);
      }
    });
  }

  const aiMatches = clean.match(/\b(?:AI\s+models?|LLMs?|large\s+language\s+models?|AI\s+agents?|vision\s+models?|foundation\s+models?|reasoning\s+models?)\b/gi);
  if (aiMatches) {
    aiMatches.forEach((m) => entities.push(m.trim()));
  }

  const is_ambiguous = /^(\s*(?:it|this|that|those|them|something|the\s+same(?:\s+thing)?|what\s+is\s+it|search\s+it|look\s+it\s+up|tell\s+me\s+about\s+it|tell\s+me\s+more|what\s+about\s+it|what\s+happened|is\s+it\s+true|find\s+it|for\s+the\s+same)\s*[?.!]*)$/i.test(clean);

  return {
    intent,
    entities: [...new Set(entities)].slice(0, 5),
    time_constraint,
    freshness_required: time_constraint !== "none" || intent === "news" || looksLikeFreshQuery(clean),
    is_ambiguous,
    ambiguity_reason: is_ambiguous ? "Query lacks identifiable search entities or references an unresolved topic." : "",
    suggested_clarification: is_ambiguous ? "Please name the specific topic, person, product, or event you want to find." : ""
  };
}

async function searchWeb(request, response) {
  const payload = await readJsonRequest(request);
  const rawInput = String(payload.query || payload.prompt || payload.message || "").replace(/\s+/g, " ").trim();
  const history = Array.isArray(payload.history) ? payload.history : [];
  const resolvedQuery = resolveServerConversationalQuery(rawInput, history);
  const sanitized = resolvedQuery
    .replace(/\b(please|identify|tell me|show me|find|search|verify|compare|cite|citations?|sources?|official|reputable|independent|finish|table|every|statement|claim|claims|using|current)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const query = (sanitized || resolvedQuery).slice(0, MAX_SEARCH_QUERY_LENGTH).trim();

  if (!query) {
    const error = new Error("A search query is required.");
    error.status = 400;
    throw error;
  }

  const intentObj = classifyServerQueryIntent(resolvedQuery || query);
  const backendsTried = [];
  if (process.env.TAVILY_API_KEY) backendsTried.push("tavily");
  if (process.env.BRAVE_SEARCH_API_KEY) backendsTried.push("brave-api");
  backendsTried.push("brave");
  if (process.env.SERPER_API_KEY) backendsTried.push("serper");
  backendsTried.push("bing", "duckduckgo", "ddg-instant", "wikipedia");

  if (intentObj.is_ambiguous) {
    sendJson(response, 200, {
      query,
      queries: [query],
      intent: intentObj,
      status: "ambiguous",
      is_ambiguous: true,
      ambiguity_reason: intentObj.ambiguity_reason,
      suggested_clarification: intentObj.suggested_clarification,
      results: [],
      total_found: 0,
      filtered_out: 0,
      backends_tried: backendsTried,
      backends_used: [],
      search_performed: false
    });
    return;
  }

  const queries = planSearchQueries(query);
  const tasks = queries.flatMap((plannedQuery, queryIndex) => {
    const enginePromises = [
      fetchWikipediaResults(plannedQuery).then((results) =>
        results.map((r, resultIndex) => ({ ...r, engine: "wikipedia", queryIndex, resultIndex }))
      ),
      fetchDuckDuckGoResults(plannedQuery).then((results) =>
        results.map((r, resultIndex) => ({ ...r, engine: "duckduckgo", queryIndex, resultIndex }))
      ),
      fetchDuckDuckGoInstantAnswer(plannedQuery).then((results) =>
        results.map((r, resultIndex) => ({ ...r, engine: "ddg-instant", queryIndex, resultIndex }))
      ),
      fetchBingResults(plannedQuery).then((results) =>
        results.map((r, resultIndex) => ({ ...r, engine: "bing", queryIndex, resultIndex }))
      ),
      fetchBraveResults(plannedQuery).then((results) =>
        results.map((r, resultIndex) => ({ ...r, engine: "brave", queryIndex, resultIndex }))
      )
    ];

    if (process.env.BRAVE_SEARCH_API_KEY) {
      enginePromises.push(
        fetchBraveApiResults(plannedQuery).then((results) =>
          results.map((r, resultIndex) => ({ ...r, engine: "brave", queryIndex, resultIndex }))
        )
      );
    }

    if (process.env.SERPER_API_KEY) {
      enginePromises.push(
        fetchSerperResults(plannedQuery).then((results) =>
          results.map((r, resultIndex) => ({ ...r, engine: "serper", queryIndex, resultIndex }))
        )
      );
    }

    if (process.env.TAVILY_API_KEY) {
      enginePromises.push(
        fetchTavilyResults(plannedQuery).then((results) =>
          results.map((r, resultIndex) => ({ ...r, engine: "tavily", queryIndex, resultIndex }))
        )
      );
    }

    return enginePromises;
  });

  const settled = await Promise.allSettled(tasks);
  const batches = settled
    .filter((item) => item.status === "fulfilled")
    .map((item) => item.value);

  if (!batches.some((batch) => batch.length)) {
    sendJson(response, 200, {
      query,
      queries,
      intent: intentObj,
      status: "zero_results",
      results: [],
      total_found: 0,
      filtered_out: 0,
      backends_tried: backendsTried,
      backends_used: [],
      search_performed: true,
      searchedAt: new Date().toISOString()
    });
    return;
  }

  const seenUrls = new Set();
  const seenTitles = new Set();
  const merged = batches.flat().filter((result) => {
    if (!result.url) return false;
    const urlKey = canonicalSearchUrl(result.url);
    const titleKey = normalizeSearchText(result.title).slice(0, 100);
    if (seenUrls.has(urlKey) || (titleKey && seenTitles.has(titleKey))) return false;
    seenUrls.add(urlKey);
    if (titleKey) seenTitles.add(titleKey);
    result.url = urlKey;
    return true;
  });

  const totalFound = merged.length;
  const rankedAll = rankSearchResults(query, merged, intentObj);

  let candidatePool = rankedAll;
  let filteredCount = 0;

  // Filter out-of-window results if explicit time constraint was given and enough fresh results exist
  if (intentObj.time_constraint !== "none") {
    const withinWindow = rankedAll.filter((r) => !r.out_of_window);
    if (withinWindow.length >= 2) {
      filteredCount += (rankedAll.length - withinWindow.length);
      candidatePool = withinWindow;
    }
  }

  // Filter out low quality and off-topic results using relevance gate (0.40)
  const MIN_RELEVANCE = 0.40;
  const highQuality = candidatePool.filter((r) => !r.is_off_topic && r.relevance_score >= MIN_RELEVANCE && r.score > 0);
  filteredCount += (candidatePool.length - highQuality.length);
  candidatePool = highQuality;

  if (!candidatePool.length) {
    sendJson(response, 200, {
      query,
      queries,
      intent: intentObj,
      status: "zero_results",
      results: [],
      total_found: totalFound,
      filtered_out: totalFound,
      backends_tried: backendsTried,
      backends_used: [...new Set(merged.map((r) => r.engine).filter(Boolean))],
      search_performed: true,
      searchedAt: new Date().toISOString()
    });
    return;
  }

  const selected = [];
  const hostCounts = new Map();
  for (const result of candidatePool) {
    let resultHost = "";
    try {
      resultHost = new URL(result.url).hostname.replace(/^www\./, "");
    } catch {}
    const count = hostCounts.get(resultHost) || 0;
    if (count >= 2) continue;
    selected.push(result);
    hostCounts.set(resultHost, count + 1);
    if (selected.length >= MAX_SEARCH_RESULTS) break;
  }

  const enriched = await extractResultPages(selected, query);
  const activeEngines = [...new Set(enriched.map((r) => r.engine).filter(Boolean))];

  sendJson(response, 200, {
    query,
    queries,
    intent: intentObj,
    provider: activeEngines.join("+") || "web",
    routed: looksLikeFreshQuery(query),
    searchedAt: new Date().toISOString(),
    total_found: totalFound,
    filtered_out: filteredCount,
    backends_tried: backendsTried,
    backends_used: activeEngines,
    search_performed: true,
    results: enriched.slice(0, MAX_SEARCH_RESULTS)
  });
}

async function serveApplication(response) {
  const html = await readFile(htmlPath);

  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": html.length,
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin"
  });

  response.end(html);
}

function serveJsonFile(response, body, contentType) {
  response.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": body.length,
    "Cache-Control": "public, max-age=3600",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(body);
}

async function serveIcon(pathname, response) {
  const requested = pathname.slice("/icons/".length);
  const filePath = resolve(iconsDirectory, normalize(requested));
  const relativePath = relative(iconsDirectory, filePath);

  if (
    !requested ||
    relativePath.startsWith("..") ||
    relativePath.includes(`..${process.platform === "win32" ? "\\" : "/"}`)
  ) {
    return false;
  }

  let body;
  try {
    body = await readFile(filePath);
  } catch {
    return false;
  }

  serveJsonFile(response, body, extname(filePath).toLowerCase() === ".svg"
    ? "image/svg+xml; charset=utf-8"
    : "image/png");
  return true;
}

async function serveSourceModule(pathname, response) {
  const requested = pathname.slice("/src/".length);
  const filePath = resolve(publicSourceDirectory, normalize(requested));
  const relativePath = relative(publicSourceDirectory, filePath);

  if (
    !requested ||
    relativePath.startsWith("..") ||
    relativePath.includes(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    ![".js", ".css"].includes(extname(filePath).toLowerCase())
  ) {
    return false;
  }

  let body;
  try {
    body = await readFile(filePath);
  } catch {
    return false;
  }

  response.writeHead(200, {
    "Content-Type": extname(filePath).toLowerCase() === ".css"
      ? "text/css; charset=utf-8"
      : "text/javascript; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(body);
  return true;
}

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(
      request.url || "/",
      `http://${request.headers.host || `${host}:${port}`}`
    );

    if (request.method === "GET" && requestUrl.pathname === "/api/health") {
      sendJson(response, 200, {
        ok: true,
        service: "vela-provider-proxy"
      });
      return;
    }

    if (
      request.method === "POST" &&
      requestUrl.pathname === "/api/provider/models"
    ) {
      await proxyModels(request, response);
      return;
    }

    if (
      request.method === "POST" &&
      requestUrl.pathname === "/api/provider/chat"
    ) {
      await proxyChat(request, response);
      return;
    }

    if (
      request.method === "POST" &&
      requestUrl.pathname === "/api/search"
    ) {
      await searchWeb(request, response);
      return;
    }

    if (
      request.method === "POST" &&
      requestUrl.pathname === "/api/audio/transcribe"
    ) {
      await proxyAudioTranscribe(request, response);
      return;
    }

    if (
      request.method === "POST" &&
      requestUrl.pathname === "/api/audio/speech"
    ) {
      await proxyAudioSpeech(request, response);
      return;
    }

    if (
      request.method === "POST" &&
      requestUrl.pathname === "/api/extract-pdf"
    ) {
      await extractPdfText(request, response);
      return;
    }

    if (
      request.method === "GET" &&
      requestUrl.pathname.startsWith("/src/") &&
      await serveSourceModule(requestUrl.pathname, response)
    ) {
      return;
    }

    if (
      request.method === "GET" &&
      ["/", "/component.html"].includes(requestUrl.pathname)
    ) {
      await serveApplication(response);
      return;
    }

    if (
      request.method === "GET" &&
      ["/favicon.svg", "/favicon.ico"].includes(requestUrl.pathname)
    ) {
      const favicon = await readFile(faviconPath);
      response.writeHead(200, {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Content-Length": favicon.length,
        "Cache-Control": "public, max-age=3600",
        "X-Content-Type-Options": "nosniff"
      });
      response.end(favicon);
      return;
    }

    if (
      request.method === "GET" &&
      requestUrl.pathname === "/manifest.webmanifest"
    ) {
      const manifest = await readFile(manifestPath);
      serveJsonFile(response, manifest, "application/manifest+json; charset=utf-8");
      return;
    }

    if (
      request.method === "GET" &&
      requestUrl.pathname.startsWith("/icons/") &&
      await serveIcon(requestUrl.pathname, response)
    ) {
      return;
    }

    if (
      request.method === "GET" &&
      requestUrl.pathname === "/sw.js"
    ) {
      const worker = await readFile(serviceWorkerPath);
      response.writeHead(200, {
        "Content-Type": "text/javascript; charset=utf-8",
        "Content-Length": worker.length,
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff"
      });
      response.end(worker);
      return;
    }

    const brandAssetName = requestUrl.pathname.slice(1);
    if (request.method === "GET" && brandAssetNames.has(brandAssetName)) {
      const asset = await readFile(join(currentDirectory, brandAssetName));
      response.writeHead(200, {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Content-Length": asset.length,
        "Cache-Control": "public, max-age=3600",
        "X-Content-Type-Options": "nosniff"
      });
      response.end(asset);
      return;
    }

    sendJson(response, 404, {
      error: {
        message: "Route not found."
      }
    });
  } catch (error) {
    if (response.headersSent || response.writableEnded) {
      if (!response.writableEnded) response.end();
      console.error("Request failed after the response started:", error?.message || error);
      return;
    }

    const timeout =
      error?.name === "TimeoutError" ||
      error?.name === "AbortError";

    const status = Number(error?.status) || (timeout ? 504 : 502);

    sendJson(response, status, {
      error: {
        message: timeout
          ? "The provider request timed out."
          : error?.message || "The provider proxy request failed."
      }
    });
  }
});

server.listen(port, host, () => {
  console.log(`Vela is running at http://${host}:${port}`);
  console.log("Provider API keys are forwarded per request and are not logged.");
});
