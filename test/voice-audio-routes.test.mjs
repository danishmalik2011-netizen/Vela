import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";

const port = 3319;
let child;

function postRequest(pathname, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = typeof payload === "string" ? payload : JSON.stringify(payload);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          ...headers
        }
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8")
          })
        );
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function getRequest(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: pathname }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () =>
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString("utf8")
        })
      );
    });
    req.on("error", reject);
  });
}

async function waitForServer() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const response = await getRequest("/api/health");
      if (response.status === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Vela audio test server did not start");
}

test.before(async () => {
  child = spawn(process.execPath, ["server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" },
    stdio: "ignore"
  });
  await waitForServer();
});

test.after(() => child?.kill());

test("POST /api/audio/transcribe rejects requests with missing audio data", async () => {
  const response = await postRequest("/api/audio/transcribe", {
    apiKey: "test-key"
  });

  assert.equal(response.status, 400);
  const json = JSON.parse(response.body);
  assert.match(json.error.message, /Audio data is required/i);
});

test("POST /api/audio/transcribe rejects requests with missing API key", async () => {
  const dummyBase64 = Buffer.from("fake-audio-bytes").toString("base64");
  const response = await postRequest("/api/audio/transcribe", {
    audio: dummyBase64
  });

  assert.equal(response.status, 400);
  const json = JSON.parse(response.body);
  assert.match(json.error.message, /API key is required/i);
});

test("POST /api/audio/transcribe enforces SSRF protection against private network targets", async () => {
  const dummyBase64 = Buffer.from("fake-audio-bytes").toString("base64");
  const response = await postRequest("/api/audio/transcribe", {
    audio: dummyBase64,
    apiKey: "test-key",
    endpoint: "http://127.0.0.1:8080/v1/audio/transcriptions"
  });

  assert.equal(response.status, 502);
  const json = JSON.parse(response.body);
  assert.match(json.error.message, /Private network|Local network/i);
});

test("POST /api/audio/speech rejects requests with missing text input", async () => {
  const response = await postRequest("/api/audio/speech", {
    apiKey: "test-key"
  });

  assert.equal(response.status, 400);
  const json = JSON.parse(response.body);
  assert.match(json.error.message, /Text input is required/i);
});

test("POST /api/audio/speech rejects requests with missing API key", async () => {
  const response = await postRequest("/api/audio/speech", {
    input: "Hello world"
  });

  assert.equal(response.status, 400);
  const json = JSON.parse(response.body);
  assert.match(json.error.message, /API key is required/i);
});

test("POST /api/audio/speech rejects text input exceeding maximum character limit", async () => {
  const oversizedText = "a".repeat(5000);
  const response = await postRequest("/api/audio/speech", {
    input: oversizedText,
    apiKey: "test-key"
  });

  assert.equal(response.status, 400);
  const json = JSON.parse(response.body);
  assert.match(json.error.message, /exceeds maximum limit/i);
});

test("POST /api/audio/speech enforces SSRF protection against localhost targets", async () => {
  const response = await postRequest("/api/audio/speech", {
    input: "Hello world",
    apiKey: "test-key",
    endpoint: "http://localhost:9000/v1/audio/speech"
  });

  assert.equal(response.status, 502);
  const json = JSON.parse(response.body);
  assert.match(json.error.message, /Local network provider endpoints are not allowed/i);
});

test("POST /api/audio/transcribe accepts Authorization: Bearer header and resolves base URL endpoint", async () => {
  const dummyBase64 = Buffer.from("fake-audio-bytes").toString("base64");
  const response = await postRequest(
    "/api/audio/transcribe",
    {
      audio: dummyBase64,
      endpoint: "http://localhost:8080/v1/chat/completions"
    },
    {
      Authorization: "Bearer test-bearer-key"
    }
  );

  // Reaches target validation and blocks private network, confirming key was accepted from Bearer header
  assert.equal(response.status, 502);
  const json = JSON.parse(response.body);
  assert.match(json.error.message, /Local network|Private network/i);
});

test("POST /api/audio/transcribe accepts raw binary audio streams", async () => {
  const audioData = Buffer.from("fake-audio-stream-bytes");
  const response = await new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/api/audio/transcribe",
        method: "POST",
        headers: {
          "Content-Type": "audio/webm",
          "Content-Length": audioData.length,
          Authorization: "Bearer test-bearer-key",
          "x-provider-endpoint": "http://127.0.0.1:9999/v1"
        }
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString("utf8")
          })
        );
      }
    );
    req.on("error", reject);
    req.write(audioData);
    req.end();
  });

  assert.equal(response.status, 502);
  const json = JSON.parse(response.body);
  assert.match(json.error.message, /Local network|Private network/i);
});

test("POST /api/audio/speech accepts Authorization: Bearer header and resolves base URL", async () => {
  const response = await postRequest(
    "/api/audio/speech",
    {
      input: "Hello world",
      endpoint: "http://localhost:8080/v1"
    },
    {
      Authorization: "Bearer test-bearer-key"
    }
  );

  // Reaches target validation and blocks private network, confirming key was accepted from Bearer header
  assert.equal(response.status, 502);
  const json = JSON.parse(response.body);
  assert.match(json.error.message, /Local network|Private network/i);
});

