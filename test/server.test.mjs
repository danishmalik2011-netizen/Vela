import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";

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
  assert.match(page.body, /rel="icon" href="\/favicon\.svg"/);

  const favicon = await request("/favicon.svg");
  assert.equal(favicon.status, 200);
  assert.match(favicon.headers["content-type"], /image\/svg\+xml/);
  assert.match(favicon.body, /aria-label="Vela"/);

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
