import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

const port = 3317;
let child;

function request(pathname) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: "127.0.0.1", port, path: pathname }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString("utf8")
      }));
    });
    request.on("error", reject);
  });
}

function postRequest(pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      host: "127.0.0.1",
      port,
      path: pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload)
      }
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString("utf8")
      }));
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function waitForServer() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const response = await request("/api/health");
      if (response.status === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Vela test server did not start");
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

test("health endpoint identifies the provider proxy", async () => {
  const response = await request("/api/health");
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true, service: "vela-provider-proxy" });
  assert.equal(response.headers["x-content-type-options"], "nosniff");
});

test("application serves the shell and every extracted browser module", async () => {
  const page = await request("/");
  assert.equal(page.status, 200);
  assert.match(page.body, /id="chatStream"/);
  assert.match(page.body, /id="artifactCanvas"/);
  assert.equal(page.headers["referrer-policy"], "strict-origin-when-cross-origin");
  assert.match(page.body, /rel="icon" href="\/favicon\.svg/);

  const expectedManifest = JSON.parse(
    await readFile(new URL("../manifest.webmanifest", import.meta.url), "utf8")
  );
  const manifest = await request("/manifest.webmanifest");
  assert.equal(manifest.status, 200);
  assert.match(manifest.headers["content-type"], /application\/manifest\+json/);
  assert.deepEqual(JSON.parse(manifest.body), expectedManifest);

  for (const icon of ["vela-icon-180.png", "vela-icon-192.png", "vela-icon-512.png", "vela-icon-maskable-512.png"]) {
    const response = await request(`/icons/${icon}`);
    assert.equal(response.status, 200, icon);
    assert.match(response.headers["content-type"], /image\/png/, icon);
    assert.ok(response.body.length > 0, icon);
  }

  const worker = await request("/sw.js");
  assert.equal(worker.status, 200);
  assert.match(worker.headers["content-type"], /javascript/);
  assert.match(worker.body, /vela-shell-v1/);

  const favicon = await request("/favicon.svg");
  assert.equal(favicon.status, 200);
  assert.match(favicon.headers["content-type"], /image\/svg\+xml/);
  assert.match(favicon.body, /aria-label="Vela"/);

  for (const asset of ["vela-wordmark.svg", "vela-wordmark-dark.svg", "vela-terminal-square.svg"]) {
    const response = await request(`/${asset}`);
    assert.equal(response.status, 200);
    assert.match(response.headers["content-type"], /image\/svg\+xml/);
    assert.match(response.body, /<svg/);
  }

  const modulePaths = [...page.body.matchAll(/<script\s+src="(\/src\/[^"]+\.js)"/g)].map((match) => match[1]);
  assert.ok(modulePaths.length >= 18, `Expected extracted modules, found ${modulePaths.length}`);
  for (const modulePath of modulePaths) {
    const module = await request(modulePath);
    assert.equal(module.status, 200, modulePath);
    assert.match(module.headers["content-type"], /javascript/, modulePath);
    assert.notEqual(module.body.trim(), "", modulePath);
  }
});

test("unknown routes return structured JSON errors", async () => {
  const response = await request("/missing");
  assert.equal(response.status, 404);
  assert.equal(JSON.parse(response.body).error.message, "Route not found.");
});

test("POST /api/search rejects requests with missing or empty query", async () => {
  const empty = await postRequest("/api/search", {});
  assert.equal(empty.status, 400);
  assert.match(JSON.parse(empty.body).error.message, /search query is required/i);

  const blank = await postRequest("/api/search", { query: "   " });
  assert.equal(blank.status, 400);
  assert.match(JSON.parse(blank.body).error.message, /search query is required/i);
});

test("POST /api/search executes multi-engine search and returns structured results with clean extracts", async () => {
  const response = await postRequest("/api/search", { query: "James Webb Space Telescope" });
  assert.equal(response.status, 200);
  const data = JSON.parse(response.body);
  assert.equal(typeof data.query, "string");
  assert.ok(Array.isArray(data.queries));
  assert.ok(Array.isArray(data.results));
  assert.ok(data.results.length > 0);
  assert.ok(data.intent, "has classified intent");
  assert.equal(typeof data.total_found, "number");
  assert.equal(typeof data.filtered_out, "number");
  assert.ok(Array.isArray(data.backends_tried));
  assert.ok(Array.isArray(data.backends_used));
  assert.equal(data.search_performed, true);
  for (const item of data.results) {
    assert.ok(item.title, "result has title");
    assert.match(item.url, /^https?:\/\//, "result has valid URL");
    assert.ok(item.host, "result has parsed host");
    assert.ok(item.engine, "result has identified engine");
    assert.ok(item.source_type, "result has source_type tag");
    assert.equal(typeof item.relevance_score, "number");
    assert.equal(typeof item.text, "string");
    assert.equal(typeof item.excerpt, "string");
  }
});

test("POST /api/search returns structured ambiguity guidance for vague queries", async () => {
  const response = await postRequest("/api/search", { query: "tell me about it" });
  assert.equal(response.status, 200);
  const data = JSON.parse(response.body);
  assert.equal(data.is_ambiguous, true);
  assert.equal(data.status, "ambiguous");
  assert.ok(data.suggested_clarification);
});

test("POST /api/search resolves anaphoric follow-ups against conversation history", async () => {
  const history = [
    { role: "user", content: "What are the latest AI models released in the last 7 days?" },
    { role: "assistant", content: "I searched the live web for AI model releases." }
  ];

  const response = await postRequest("/api/search", {
    query: "now that it is fixed...search for the same",
    history
  });
  assert.equal(response.status, 200);
  const data = JSON.parse(response.body);

  // The dispatched query must carry the antecedent topic, not the literal words
  // "fixed" / "now" that produced the garbage results in the reported failure.
  assert.match(data.query, /AI models/i);
  assert.ok(!/\bfixed\b/i.test(data.query), `query must not retain anaphora residue: ${data.query}`);
  assert.equal(data.is_ambiguous, undefined);
  assert.equal(data.intent.intent, "news");
  assert.equal(data.intent.time_constraint, "7d");
  assert.equal(data.intent.freshness_required, true);
  assert.equal(data.search_performed, true);

  // Relevance gate: the literal-word results from the failure report must be gone.
  for (const result of data.results) {
    assert.notEqual(result.is_off_topic, true, `off-topic result leaked through: ${result.url}`);
    assert.ok(result.relevance_score >= 0.40, `low-relevance result leaked through: ${result.url} (${result.relevance_score})`);
    assert.equal(typeof result.source_type, "string");
  }

  // Every surviving result must actually relate to the resolved topic, and none
  // may be an artifact of the literal words "now"/"fixed" in the raw message.
  for (const result of data.results) {
    const text = `${result.title} ${result.snippet || ""} ${result.url}`.toLowerCase();
    assert.ok(/ai|model|llm/.test(text), `result unrelated to resolved topic: ${result.url}`);
    assert.ok(
      !/fixed-?point|grammar|textranch|neutrali[sz]/i.test(text),
      `literal-word artifact leaked through: ${result.url}`
    );
  }
});

test("POST /api/search flags an unresolvable anaphora as ambiguous instead of searching literal words", async () => {
  const response = await postRequest("/api/search", {
    query: "now that it is fixed...search for the same",
    history: []
  });
  assert.equal(response.status, 200);
  const data = JSON.parse(response.body);
  assert.equal(data.status, "ambiguous");
  assert.equal(data.is_ambiguous, true);
  assert.equal(data.search_performed, false);
  assert.deepEqual(data.results, []);
  assert.ok(data.suggested_clarification);
});

test("POST /api/search keeps a concrete query intact while stripping conversational preamble", async () => {
  const response = await postRequest("/api/search", {
    query: "now that it is fixed, please search for James Webb Space Telescope",
    history: [{ role: "user", content: "What are the latest AI models?" }]
  });
  assert.equal(response.status, 200);
  const data = JSON.parse(response.body);
  assert.match(data.query, /James Webb Space Telescope/i);
  assert.ok(!/AI models/i.test(data.query), "must not merge an unrelated antecedent into a concrete query");
  assert.equal(data.search_performed, true);
  assert.ok(data.results.length > 0);
});
