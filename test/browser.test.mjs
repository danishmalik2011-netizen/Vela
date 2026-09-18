import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appPort = 3318;
const debugPort = 9338;
const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const chromeScratchRoot = process.env.VELA_CHROME_SCRATCH || join(projectRoot, ".browser-test-tmp");
let server;
let chrome;
let profile;
let socket;
let sequence = 0;
const pending = new Map();

function httpRequest({ port, path, method = "GET" }) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, path, method }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject);
    request.end();
  });
}

async function waitFor(fn, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for browser test dependency");
}

function command(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await command("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    const d = result.exceptionDetails;
    throw new Error(`${d.exception?.description || d.text} at ${d.lineNumber}:${d.columnNumber}`);
  }
  return result.result.value;
}

async function openPage() {
  const target = await httpRequest({ port: debugPort, path: `/json/new?http://127.0.0.1:${appPort}/`, method: "PUT" });
  assert.equal(target.status, 200);
  const descriptor = JSON.parse(target.body);
  socket = new WebSocket(descriptor.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const promise = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) promise.reject(new Error(message.error.message));
    else promise.resolve(message.result);
  });
  await command("Runtime.enable");
  await waitFor(() => evaluate("Boolean(window.__sageConversationControllerV2 && window.VelaArtifactStore && window.VelaArtifactRenderers)"));
}

async function reloadPage(extraCheck = "") {
  await evaluate("window.__reloading = true").catch(() => {});
  await command("Page.enable").catch(() => {});
  await command("Page.reload", { ignoreCache: true });
  const check = extraCheck ? ` && Boolean(${extraCheck})` : "";
  await waitFor(() => evaluate(`!window.__reloading && Boolean(document.getElementById('composerInput') && window.__sageConversationControllerV2 && window.VelaArtifactStore)${check}`));
}

test.before(async () => {
  server = spawn(process.execPath, ["server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(appPort), HOST: "127.0.0.1" },
    stdio: "ignore"
  });
  await waitFor(async () => (await httpRequest({ port: appPort, path: "/api/health" })).status === 200);

  await mkdir(chromeScratchRoot, { recursive: true });
  profile = await mkdtemp(join(chromeScratchRoot, "vela-chrome-"));
  chrome = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--disable-extensions",
    "--disable-background-networking",
    "--js-flags=--max-old-space-size=256",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    `--disk-cache-dir=${join(profile, "Cache")}`,
    "about:blank"
  ], { stdio: "ignore" });
  await waitFor(async () => (await httpRequest({ port: debugPort, path: "/json/version" })).status === 200);
  await openPage();
});

test.after(async () => {
  socket?.close();

  if (chrome && chrome.exitCode === null) {
    const exited = new Promise((resolve) => chrome.once("exit", resolve));
    chrome.kill();
    await exited;
  }

  if (server && server.exitCode === null) {
    const exited = new Promise((resolve) => server.once("exit", resolve));
    server.kill();
    await exited;
  }

  if (profile) {
    await rm(profile, {
      recursive: true,
      force: true,
      maxRetries: 8,
      retryDelay: 150
    });
  }
});

test("VELA brand assets render in the sidebar for both themes", async () => {
  const result = await evaluate(`(() => {
    const wordmark = document.querySelector('.brand-wordmark');
    const mark = document.querySelector('.sage-mark svg');
    document.documentElement.dataset.theme = 'light';
    const lightColor = getComputedStyle(wordmark).color;
    document.documentElement.dataset.theme = 'dark';
    const darkColor = getComputedStyle(wordmark).color;
    return {
      wordmarkVisible: getComputedStyle(wordmark).display !== 'none',
      wordmarkPaths: wordmark?.querySelectorAll('path').length || 0,
      markRect: Boolean(mark?.querySelector('rect')),
      markV: Boolean(mark?.querySelector('path[fill="url(#velaMarkFace)"]')),
      markGradients: mark?.querySelectorAll('linearGradient').length || 0,
      lightColor,
      darkColor,
      currentColor: getComputedStyle(wordmark).color,
      accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
    };
  })()`);
  assert.equal(result.wordmarkVisible, true);
  assert.equal(result.wordmarkPaths, 4);
  assert.equal(result.markRect, true);
  assert.equal(result.markV, true);
  assert.equal(result.markGradients, 2);
  assert.notEqual(result.currentColor, "rgba(0, 0, 0, 0)");
  assert.match(result.accent, /^#[0-9a-f]{6}$/i);
});

test("VELA PWA metadata, manifest, icons, and service worker registration", async () => {
  const result = await evaluate(`(async () => {
    const manifest = document.querySelector('link[rel="manifest"]');
    const appleIcon = document.querySelector('link[rel="apple-touch-icon"]');
    const appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    const windowCapable = document.querySelector('meta[name="mobile-web-app-capable"]');
    const manifestResponse = manifest ? await fetch(manifest.href) : null;
    const manifestData = manifestResponse?.ok ? await manifestResponse.json() : null;
    if (navigator.serviceWorker) {
      try { await navigator.serviceWorker.register('/sw.js'); } catch {}
    }
    return {
      manifestHref: manifest?.getAttribute('href') || '',
      hasIcons: manifestData?.icons?.length > 0,
      has196: manifestData?.icons?.some((icon) => icon.sizes === '192x192'),
      hasMaskable: manifestData?.icons?.some((icon) => icon.purpose === 'maskable'),
      appleIconHref: appleIcon?.getAttribute('href') || '',
      appleTitle: appleTitle?.content || '',
      windowCapable: windowCapable?.content || ''
    };
  })()`);
  assert.equal(result.manifestHref, "/manifest.webmanifest");
  assert.equal(result.hasIcons, true);
  assert.equal(result.has196, true);
  assert.equal(result.hasMaskable, true);
  assert.equal(result.appleIconHref, "/icons/vela-icon-180.png");
  assert.equal(result.appleTitle, "Vela");
  assert.equal(result.windowCapable, "yes");
});

test("sidebar footer shows an install button and icon-only account", async () => {
  const result = await evaluate(`(async () => {
    const button = document.getElementById('installAppButton');
    const profile = document.getElementById('profileButton');
    const footer = profile?.closest('.sidebar-footer');
    // Simulate the beforeinstallprompt flow in a browser (non-standalone) context.
    window.dispatchEvent(new Event('beforeinstallprompt'));
    const visibleWithPrompt = button && !button.hidden;
    window.dispatchEvent(new Event('appinstalled'));
    // In a browser tab the button stays visible as an install/guidance entry.
    const staysVisibleAfterInstall = button && !button.hidden;
    const copy = button?.querySelector('.install-app-copy');
    const copyVisible = copy ? getComputedStyle(copy).display !== 'none' : false;
    const toast = document.getElementById('toast');
    button?.click();
    const toastShown = toast ? toast.classList.contains('show') : false;
    return {
      visibleWithPrompt,
      staysVisibleAfterInstall,
      copyVisible,
      toastShown,
      accountIconOnly: Boolean(profile && !profile.querySelector('.profile-copy, .profile-name, .profile-plan')),
      profileRounded: Boolean(profile && getComputedStyle(profile).borderRadius !== '0px'),
      footerHasRow: Boolean(footer && footer.querySelector('.sidebar-footer-row'))
    };
  })()`);
  assert.equal(result.visibleWithPrompt, true);
  assert.equal(result.staysVisibleAfterInstall, true);
  assert.equal(result.copyVisible, true);
  assert.equal(result.toastShown, true);
  assert.equal(result.accountIconOnly, true);
  assert.equal(result.profileRounded, true);
  assert.equal(result.footerHasRow, true);
});

test("collapsed sidebar places download and profile buttons at bottom in vertical stack", async () => {
  await command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const result = await evaluate(`(() => {
    const app = document.getElementById('app');
    const sidebar = document.querySelector('.sidebar');
    const footer = document.querySelector('.sidebar-footer');
    const footerRow = document.querySelector('.sidebar-footer-row');
    const installBtn = document.getElementById('installAppButton');
    const profileBtn = document.getElementById('profileButton');

    app.classList.add('sidebar-collapsed');

    const sidebarRect = sidebar.getBoundingClientRect();
    const footerRect = footer.getBoundingClientRect();
    const installRect = installBtn.getBoundingClientRect();
    const profileRect = profileBtn.getBoundingClientRect();

    const flexDirection = getComputedStyle(footerRow).flexDirection;
    const copyHidden = getComputedStyle(installBtn.querySelector('.install-app-copy')).display === 'none';

    app.classList.remove('sidebar-collapsed');

    return {
      footerAtBottom: Math.abs(footerRect.bottom - sidebarRect.bottom) < 2,
      flexDirection,
      installAboveProfile: installRect.bottom <= profileRect.top + 2,
      verticallyAligned: Math.abs((installRect.left + installRect.right) / 2 - (profileRect.left + profileRect.right) / 2) < 2,
      copyHidden
    };
  })()`);
  assert.equal(result.footerAtBottom, true);
  assert.equal(result.flexDirection, "column");
  assert.equal(result.installAboveProfile, true);
  assert.equal(result.verticallyAligned, true);
  assert.equal(result.copyHidden, true);
});

test("model responses surface the exact provider error instead of a generic empty-response message", async () => {
  await reloadPage();
  const result = await evaluate(`(async () => {
    const originalFetch = window.fetch;
    localStorage.setItem('sage-byok-config', JSON.stringify({ enabled: true, provider: 'custom', format: 'openai-chat', endpoint: 'https://provider.test/v1/chat/completions', model: 'test' }));
    sessionStorage.setItem('sage-byok-key', 'test-key');

    // 200 "success" stream carrying a provider error event mid-stream.
    const encoder = new TextEncoder();
    const streamBody = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(': ping\\n\\n'));
        controller.enqueue(encoder.encode('data: {"error":{"code":"rate_limit_exceeded","message":"Rate limit reached for model gpt-5 in organization org-test on tokens per min (RPM): Limit 5, Used 9."}}\\n\\n'));
        controller.enqueue(encoder.encode('data: [DONE]\\n\\n'));
        controller.close();
      }
    });
    window.fetch = async (url) => {
      if (!String(url).includes('/api/provider') && !String(url).includes('/api/chat')) return originalFetch(url);
      return new Response(streamBody, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };
    const input = document.getElementById('composerInput');
    input.value = 'Trigger a provider error inside a 200 stream';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('composer').requestSubmit();
    const deadline = Date.now() + 12000;
    let lastText = '';
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 60));
      const state = document.getElementById('sendButton').dataset.state;
      const article = [...document.querySelectorAll('.assistant-message')].at(-1);
      lastText = article?.querySelector('.sage-response')?.textContent || '';
      if (state === 'send' && lastText.trim()) break;
    }
    window.fetch = originalFetch;
    return { lastText };
  })()`);
  assert.ok(
    result.lastText.includes("Rate limit reached for model gpt-5 in organization org-test"),
    `Provider error message should surface verbatim, got: ${JSON.stringify(result.lastText.slice(0, 300))}`
  );
  assert.ok(
    !result.lastText.includes("returned an empty response"),
    "No generic empty-response placeholder should appear"
  );
});

test("model responses surface refusal and raw provider bodies verbatim", async () => {
  await reloadPage();
  const result = await evaluate(`(async () => {
    const originalFetch = window.fetch;
    localStorage.setItem('sage-byok-config', JSON.stringify({ enabled: true, provider: 'custom', format: 'openai-chat', endpoint: 'https://provider.test/v1/chat/completions', model: 'test' }));
    sessionStorage.setItem('sage-byok-key', 'test-key');
    const input = document.getElementById('composerInput');
    const deadline = 12000;

    async function submitAndWait() {
      document.getElementById('composer').requestSubmit();
      const until = Date.now() + deadline;
      let lastText = '';
      while (Date.now() < until) {
        await new Promise((resolve) => setTimeout(resolve, 60));
        const state = document.getElementById('sendButton').dataset.state;
        const article = [...document.querySelectorAll('.assistant-message')].at(-1);
        lastText = article?.querySelector('.sage-response')?.textContent || '';
        if (state === 'send' && lastText.trim()) break;
      }
      return lastText;
    }

    // HTTP 200 JSON with no content but a refusal should surface exactly.
    window.fetch = async (url) => {
      if (!String(url).includes('/api/provider') && !String(url).includes('/api/chat')) return originalFetch(url);
      return new Response(JSON.stringify({ choices: [{ message: { refusal: 'I cannot help with that.' }, finish_reason: 'stop' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    input.value = 'Trigger a refusal response';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const refusalText = await submitAndWait();

    // Non-JSON raw body on a failed response should surface verbatim too.
    window.fetch = async (url) => {
      if (!String(url).includes('/api/provider') && !String(url).includes('/api/chat')) return originalFetch(url);
      return new Response('Model cluster temporarily unreachable.', { status: 502, headers: { 'Content-Type': 'text/plain' } });
    };
    input.value = 'Trigger a raw body failure';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const rawText = await submitAndWait();
    window.fetch = originalFetch;
    return { refusalText, rawText };
  })()`);
  assert.ok(
    result.refusalText.includes("I cannot help with that."),
    `Refusal text should surface verbatim, got: ${JSON.stringify(result.refusalText.slice(0, 300))}`
  );
  assert.ok(
    result.rawText.includes("Model cluster temporarily unreachable."),
    `Raw provider body should surface verbatim, got: ${JSON.stringify(result.rawText.slice(0, 300))}`
  );
});

test("send control swaps to an accessible stop control while streaming", async () => {
  const result = await evaluate(`(async () => {
    const originalFetch = window.fetch;
    window.fetch = (url, options = {}) => {
      if (!String(url).includes('/api/provider') && !String(url).includes('/api/chat')) return originalFetch(url, options);
      return new Promise((resolve, reject) => {
        const abort = () => reject(new DOMException('Aborted', 'AbortError'));
        if (options.signal?.aborted) abort();
        else options.signal?.addEventListener('abort', abort, { once: true });
      });
    };
    const input = document.getElementById('composerInput');
    input.value = 'Keep streaming until stopped';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('composer').requestSubmit();
    await new Promise((resolve) => setTimeout(resolve, 80));
    const button = document.getElementById('sendButton');
    const streaming = {
      state: button.dataset.state,
      label: button.getAttribute('aria-label'),
      disabled: button.getAttribute('aria-disabled')
    };
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    const stopped = {
      state: button.dataset.state,
      label: button.getAttribute('aria-label')
    };
    window.fetch = originalFetch;
    return { streaming, stopped };
  })()`);
  assert.equal(result.streaming.state, "stop");
  assert.equal(result.streaming.label, "Stop generating");
  assert.equal(result.streaming.disabled, "false");
  assert.equal(result.stopped.state, "send");
  assert.equal(result.stopped.label, "Send message");
});

test("composer mode dropdown exposes icons and updates accessible state", async () => {
  const result = await evaluate(`(() => {
    const trigger = document.getElementById('composerModeTrigger');
    trigger.click();
    const menu = document.getElementById('composerModeMenu');
    const options = [...menu.querySelectorAll('.composer-mode-option')];
    const research = options.find((option) => option.dataset.mode === 'research');
    research.click();
    return {
      count: options.length,
      icons: options.every((option) => Boolean(option.querySelector('svg'))),
      expanded: trigger.getAttribute('aria-expanded'),
      label: document.getElementById('composerModeTriggerLabel').textContent,
      triggerIcon: Boolean(document.querySelector('#composerModeTriggerIcon svg')),
      placeholder: document.getElementById('composerInput').placeholder,
      search: document.getElementById('webSearchButton').getAttribute('aria-pressed')
    };
  })()`);
  assert.deepEqual(result, {
    count: 5,
    icons: true,
    expanded: "false",
    label: "Research",
    triggerIcon: true,
    placeholder: "What would you like to investigate?",
    search: "true"
  });
});

test("slash commands filter, navigate, and select composer modes", async () => {
  const result = await evaluate(`(() => {
    const input = document.getElementById('composerInput');
    input.value = '/c';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const menu = document.getElementById('slashCommandMenu');
    const commands = [...menu.querySelectorAll('.slash-command-option')].map((option) => option.dataset.mode || option.dataset.command);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return {
      commands,
      hidden: menu.hidden,
      label: document.getElementById('composerModeTriggerLabel').textContent,
      value: input.value,
      placeholder: input.placeholder
    };
  })()`);
  assert.deepEqual(result, {
    commands: ["chat", "code", "/compare", "/canvas"],
    hidden: true,
    label: "Code",
    value: "",
    placeholder: "Describe the code, bug, or system…"
  });
});

test("sidebar keeps All conversations polished when expanded and collapsed", async () => {
  await command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const result = await evaluate(`(() => {
    const app = document.getElementById('app');
    app.classList.remove('sidebar-collapsed');
    const item = document.querySelector('.project-nav-all');
    const expanded = {
      text: item?.textContent.trim(),
      labelDisplay: getComputedStyle(item?.querySelector('.project-nav-label')).display,
      overflow: item?.scrollWidth <= item?.clientWidth
    };
    document.getElementById('brandButton').click();
    const collapsed = {
      active: app.classList.contains('sidebar-collapsed'),
      labelDisplay: getComputedStyle(item?.querySelector('.project-nav-label')).display,
      width: Math.round(item?.getBoundingClientRect().width || 0),
      aria: item?.getAttribute('aria-label'),
      title: item?.title
    };
    document.getElementById('brandButton').click();
    return { expanded, collapsed };
  })()`);
  assert.equal(result.expanded.text, "All conversations");
  assert.equal(result.expanded.labelDisplay, "block");
  assert.equal(result.expanded.overflow, true);
  assert.equal(result.collapsed.active, true);
  assert.equal(result.collapsed.labelDisplay, "none");
  assert.equal(result.collapsed.width, 44);
  assert.equal(result.collapsed.aria, "All conversations");
  assert.equal(result.collapsed.title, "All conversations");
});

test("model code receives safe language-aware syntax highlighting", async () => {
  const result = await evaluate(`(() => {
    const host = document.createElement('div');
    host.className = 'markdown-body';
    host.innerHTML = '<pre><code class="language-javascript">const answer = "&lt;script&gt;"; // note</code></pre>';
    window.VelaSyntaxHighlight.enhance(host);
    const code = host.querySelector('code');
    return {
      language: code.dataset.language,
      // Either highlight.js (when its CDN bundle loaded) or the built-in
      // fallback may serve the tokens — accept both class vocabularies.
      keyword: code.querySelector('.tok-keyword, .hljs-keyword')?.textContent,
      string: code.querySelector('.tok-string, .hljs-string')?.textContent,
      comment: code.querySelector('.tok-comment, .hljs-comment')?.textContent,
      scripts: host.querySelectorAll('script').length,
      highlighted: code.classList.contains('vela-highlighted')
    };
  })()`);
  assert.equal(result.language, "javascript");
  assert.equal(result.keyword, "const");
  assert.equal(result.string, '"<script>"');
  assert.equal(result.comment, "// note");
  assert.equal(result.scripts, 0);
  assert.equal(result.highlighted, true);
});

test("latest control clears the composer at every supported viewport", async () => {
  for (const [width, height] of [[1440, 900], [1024, 768], [390, 844]]) {
    await command("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width <= 390 });
    const result = await evaluate(`(() => {
      const latest = document.querySelector('.jump-to-latest');
      const composerZone = document.querySelector('.composer-zone');
      latest.classList.add('visible');
      const latestRect = latest.getBoundingClientRect();
      const composerRect = composerZone.getBoundingClientRect();
      latest.classList.remove('visible');
      return { latestBottom: latestRect.bottom, composerTop: composerRect.top };
    })()`);
    assert.ok(result.latestBottom < result.composerTop, `${width}x${height} latest control overlaps composer`);
  }
});

test("artifact canvas opens from generated HTML and uses an isolated iframe", async () => {
  const result = await evaluate(`(() => {
    const host = document.createElement('article');
    host.innerHTML = '<div class="markdown-code"><button class="markdown-code-open">Open canvas</button><pre><code class="language-html">&lt;h1&gt;Safe preview&lt;/h1&gt;</code></pre></div>';
    document.getElementById('chatStream').appendChild(host);
    host.querySelector('button').click();
    const canvas = document.getElementById('artifactCanvas');
    const frame = canvas.querySelector('iframe');
    return {
      open: canvas.classList.contains('open'),
      hidden: canvas.getAttribute('aria-hidden'),
      sandbox: frame?.getAttribute('sandbox'),
      source: frame?.srcdoc
    };
  })()`);
  assert.equal(result.open, true);
  assert.equal(result.hidden, "false");
  assert.equal(result.sandbox, "allow-scripts");
  assert.match(result.source, /Safe preview/);
});

test("expanded canvas constrains the composer without covering it", async () => {
  await command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const result = await evaluate(`(() => {
    const canvas = document.getElementById('artifactCanvas');
    if (!canvas.classList.contains('open')) {
      const host = document.createElement('article');
      host.innerHTML = '<div class="markdown-code"><button class="markdown-code-open">Open canvas</button><pre><code class="language-html">&lt;h1&gt;Composer geometry&lt;/h1&gt;</code></pre></div>';
      document.getElementById('chatStream').appendChild(host);
      host.querySelector('button').click();
    }
    if (canvas.classList.contains('fullscreen')) document.getElementById('fullscreenArtifactCanvas').click();
    const composerZone = document.querySelector('.composer-zone');
    const composer = document.getElementById('composer');
    const canvasRect = canvas.getBoundingClientRect();
    const zoneRect = composerZone.getBoundingClientRect();
    const composerRect = composer.getBoundingClientRect();
    return {
      open: canvas.classList.contains('open'),
      zoneRight: Math.round(zoneRect.right),
      composerRight: Math.round(composerRect.right),
      canvasLeft: Math.round(canvasRect.left),
      zoneWidth: Math.round(zoneRect.width),
      composerWidth: Math.round(composerRect.width),
      appClass: document.getElementById('app').className,
      computedRight: getComputedStyle(composerZone).right,
      canvasSpace: getComputedStyle(document.getElementById('app')).getPropertyValue('--artifact-canvas-space').trim()
    };
  })()`);
  assert.equal(result.open, true);
  assert.ok(result.zoneRight <= result.canvasLeft, `composer zone extends beneath canvas: ${JSON.stringify(result)}`);
  assert.ok(result.composerRight <= result.canvasLeft, `composer extends beneath canvas: ${JSON.stringify(result)}`);
  assert.ok(result.composerWidth <= result.zoneWidth, "composer exceeds available chat width");
});

test("message hover reveals actions without moving chat geometry", async () => {
  const result = await evaluate(`(() => {
    const article = document.querySelector('.assistant-message') || (() => {
      const host = document.createElement('article');
      host.className = 'message assistant-message';
      host.innerHTML = '<div class="message-body"><div class="sage-response markdown-body"><p>Stable response text</p></div></div><footer class="assistant-message-meta"><div class="response-actions"><button class="mini-action">Copy</button></div><time class="message-time assistant-message-time">10:30</time></footer>';
      document.getElementById('chatStream').appendChild(host);
      return host;
    })();
    const actions = article.querySelector('.response-actions');
    const before = article.getBoundingClientRect();
    const responseBefore = article.querySelector('.sage-response').getBoundingClientRect();
    article.classList.add('browser-hover-test');
    actions.style.visibility = 'visible';
    actions.style.opacity = '1';
    actions.style.pointerEvents = 'auto';
    const after = article.getBoundingClientRect();
    const responseAfter = article.querySelector('.sage-response').getBoundingClientRect();
    actions.removeAttribute('style');
    article.classList.remove('browser-hover-test');
    return {
      articleHeightBefore: before.height,
      articleHeightAfter: after.height,
      responseTopBefore: responseBefore.top,
      responseTopAfter: responseAfter.top
    };
  })()`);
  assert.equal(result.articleHeightAfter, result.articleHeightBefore);
  assert.equal(result.responseTopAfter, result.responseTopBefore);
});

test("light theme typography maintains strong contrast", async () => {
  const result = await evaluate(`(() => {
    document.documentElement.dataset.theme = 'light';
    const probe = document.createElement('span');
    probe.style.color = 'var(--text)';
    document.body.appendChild(probe);
    const primary = getComputedStyle(probe).color;
    probe.style.color = 'var(--text-soft)';
    const secondary = getComputedStyle(probe).color;
    probe.style.color = 'var(--text-faint)';
    const faint = getComputedStyle(probe).color;
    probe.remove();
    return { primary, secondary, faint };
  })()`);
  assert.equal(result.primary, "rgb(11, 14, 12)");
  assert.equal(result.secondary, "rgb(56, 61, 56)");
  assert.equal(result.faint, "rgb(92, 98, 92)");
});

test("conversation save remains usable when local storage quota is exhausted", async () => {
  const result = await evaluate(`(() => {
    const store = window.VelaConversationStore;
    let attempts = 0;
    const memory = new Map([['compat', 'duplicate']]);
    const storage = {
      getItem: (key) => memory.get(key) || null,
      removeItem: (key) => memory.delete(key),
      setItem: (key, value) => {
        if (key === 'conversation:quota-chat' && attempts++ < 1) throw new DOMException('full', 'QuotaExceededError');
        memory.set(key, String(value));
      }
    };
    const saved = store.save(storage, { prefix: 'conversation:', active: 'active', compatibility: 'compat' }, {
      id: 'quota-chat', title: 'Quota', taskMode: 'chat', artifacts: [], createdAt: Date.now(), updatedAt: Date.now(),
      messages: [{ role: 'user', content: 'image', attachments: [{ id: '1', name: 'large.png', kind: 'image', dataUrl: 'data:image/png;base64,' + 'A'.repeat(10000) }] }]
    });
    return { active: memory.get('active'), compat: memory.has('compat'), payload: saved.messages[0].attachments[0].dataUrl };
  })()`);
  assert.equal(result.active, "quota-chat");
  assert.equal(result.compat, false);
  assert.equal(result.payload, "");
});

test("code blocks follow light and dark theme surfaces", async () => {
  const result = await evaluate(`(() => {
    const host = document.createElement('div');
    host.className = 'markdown-body';
    host.innerHTML = '<div class="markdown-code"><div class="markdown-code-header">js</div><pre><code>const green = true;</code></pre></div>';
    document.body.appendChild(host);
    const root = document.documentElement;
    root.dataset.theme = 'light';
    const light = getComputedStyle(host.querySelector('pre')).backgroundColor;
    const lightText = getComputedStyle(host.querySelector('code')).color;
    root.dataset.theme = 'dark';
    const dark = getComputedStyle(host.querySelector('pre')).backgroundColor;
    host.remove();
    return { light, dark, lightText };
  })()`);
  assert.equal(result.light, "rgb(244, 245, 241)");
  assert.equal(result.dark, "rgb(16, 16, 16)");
  assert.notEqual(result.light, result.dark);
  assert.notEqual(result.lightText, "rgb(213, 222, 232)");
});

test("generated code is nested beneath collapsed Writing and filename toggles", async () => {
  const result = await evaluate(`(() => {
    const input = document.getElementById('composerInput');
    const original = input.value;
    const article = window.VelaConversationPresentation.createAssistantArticle(document, { userIndex: 0, taskMode: 'build', validModes: ['build'] });
    const container = article.querySelector('.sage-response');
    document.getElementById('chatStream').replaceChildren(article);
    container.innerHTML = '<div class="markdown-code"><div class="markdown-code-header"><span>html</span></div><pre><code class="language-html" data-language="html">&lt;!doctype html&gt;&lt;title&gt;Nested file&lt;/title&gt;</code></pre></div>';
    const block = container.querySelector('.markdown-code');
    const name = window.VelaArtifacts.fileNameFor('html', block.querySelector('code').textContent, 0);
    const writing = document.createElement('details');
    writing.className = 'writing-code-step';
    writing.innerHTML = '<summary><span class="writing-code-title">Writing</span><span class="writing-code-count">1 file</span></summary>';
    const file = document.createElement('details');
    file.className = 'generation-step';
    file.innerHTML = '<summary><span class="generation-step-title"><code></code></span></summary>';
    file.querySelector('code').textContent = name;
    block.before(writing);
    writing.appendChild(file);
    file.appendChild(block);
    input.value = original;
    return {
      writingLabel: writing.querySelector('.writing-code-title').textContent,
      fileName: file.querySelector('code').textContent,
      writingOpen: writing.open,
      fileOpen: file.open,
      nested: file.parentElement === writing && block.parentElement === file
    };
  })()`);
  assert.equal(result.writingLabel, "Writing");
  assert.match(result.fileName, /\.html$/);
  assert.equal(result.writingOpen, false);
  assert.equal(result.fileOpen, false);
  assert.equal(result.nested, true);
});

test("dark theme uses matte black surfaces without ambient button glow", async () => {
  const result = await evaluate(`(() => {
    document.documentElement.dataset.theme = 'dark';
    const root = getComputedStyle(document.documentElement);
    const send = getComputedStyle(document.getElementById('sendButton'));
    const composer = getComputedStyle(document.getElementById('composer'));
    return { bg: root.getPropertyValue('--bg').trim(), accent: root.getPropertyValue('--accent').trim(), sendShadow: send.boxShadow, composerShadow: composer.boxShadow };
  })()`);
  assert.equal(result.bg, "#0a0a0a");
  assert.equal(result.accent, "#5fa77f");
  assert.doesNotMatch(result.sendShadow, /rgba\([^)]*0\.24\)/);
  assert.doesNotMatch(result.composerShadow, /62px|60px/);
});

test("final generated markup uses collapsed Writing and filename toggles", async () => {
  await reloadPage();
  const result = await evaluate(`(async () => {
    const originalFetch = window.fetch;
    localStorage.setItem('sage-byok-config', JSON.stringify({ enabled: true, provider: 'custom', format: 'openai-chat', endpoint: 'https://provider.test/v1/chat/completions', model: 'test' }));
    sessionStorage.setItem('sage-byok-key', 'test-key');
    window.fetch = async (url) => {
      if (!String(url).includes('/api/provider') && !String(url).includes('/api/chat')) return originalFetch(url);
      await new Promise((resolve) => setTimeout(resolve, 120));
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Done.\\n\\n' + String.fromCharCode(96).repeat(3) + 'html\\n<!doctype html><title>Real nested file</title>\\n' + String.fromCharCode(96).repeat(3) }, finish_reason: 'stop' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const input = document.getElementById('composerInput');
    input.value = '/build create a tiny html page';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('composer').requestSubmit();
    const startedDeadline = Date.now() + 5000;
    while (document.getElementById('sendButton').dataset.state !== 'stop' && Date.now() < startedDeadline) await new Promise((resolve) => setTimeout(resolve, 25));
    const completedDeadline = Date.now() + 5000;
    while (document.getElementById('sendButton').dataset.state !== 'send' && Date.now() < completedDeadline) await new Promise((resolve) => setTimeout(resolve, 25));
    const article = [...document.querySelectorAll('.assistant-message')].at(-1);
    const writing = article?.querySelector('.writing-code-step');
    const file = writing?.querySelector('.generation-step');
    const block = file?.querySelector('.markdown-code');
    window.fetch = originalFetch;
    return {
      writingLabel: writing?.querySelector('.writing-code-title')?.textContent || '',
      fileName: file?.querySelector('.generation-step-title code')?.textContent || '',
      writingOpen: writing?.open ?? null,
      fileOpen: file?.open ?? null,
      nested: Boolean(writing && file?.parentElement === writing && block?.parentElement === file)
    };
  })()`);
  assert.match(result.writingLabel, /^(Writing|Wrote)$/);
  assert.match(result.fileName, /\.html$/);
  assert.equal(result.writingOpen, false);
  assert.equal(result.fileOpen, false);
  assert.equal(result.nested, true);
  await evaluate(`(() => {
    const card = document.querySelector('.file-card');
    if (card) card.querySelector('.file-card-open')?.click();
    return document.getElementById('artifactCanvas').classList.contains('open');
  })()`);
});

test("responsive canvas becomes full viewport on mobile", async () => {
  await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const result = await evaluate(`(() => {
    const canvas = document.getElementById('artifactCanvas');
    const style = getComputedStyle(canvas);
    const rect = canvas.getBoundingClientRect();
    return { width: Math.round(rect.width), top: style.top, right: style.right, radius: style.borderRadius };
  })()`);
  assert.equal(result.width, 390);
  assert.equal(result.top, "0px");
  assert.equal(result.right, "0px");
  assert.equal(result.radius, "0px");
});

test("canvas split, pin, and full-screen controls persist workspace state", async () => {
  await command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const result = await evaluate(`(() => {
    const split = document.getElementById('artifactSplitTab');
    split.click();
    const splitView = document.querySelector('.artifact-split');
    const saveButton = document.querySelector('.artifact-split-shell .artifact-save-button');
    const bodyRect = document.getElementById('artifactCanvasBody').getBoundingClientRect();
    const saveRect = saveButton?.getBoundingClientRect();
    document.getElementById('pinArtifactCanvas').click();
    document.getElementById('fullscreenArtifactCanvas').click();
    const canvas = document.getElementById('artifactCanvas');
    return {
      split: Boolean(splitView),
      saveVisible: Boolean(saveRect && saveRect.top >= bodyRect.top && saveRect.bottom <= bodyRect.bottom),
      selected: split.getAttribute('aria-selected'),
      pinned: canvas.classList.contains('pinned'),
      fullscreen: canvas.classList.contains('fullscreen'),
      state: JSON.parse(localStorage.getItem('vela-workspace-state-v1'))
    };
  })()`);
  assert.equal(result.split, true);
  assert.equal(result.saveVisible, true);
  assert.equal(result.selected, "true");
  assert.equal(result.pinned, true);
  assert.equal(result.fullscreen, true);
  assert.equal(result.state.mode, "split");
  assert.equal(result.state.pinned, true);
  assert.equal(result.state.fullscreen, true);
});

test("workspace remains usable across required responsive viewports", async () => {
  const viewports = [
    [1280, 800], [1440, 900], [1024, 768], [768, 1024], [390, 844]
  ];
  for (const [width, height] of viewports) {
    await command("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width <= 390 });
    const result = await evaluate(`(() => {
      const main = document.querySelector('.main').getBoundingClientRect();
      const composer = document.getElementById('composer').getBoundingClientRect();
      const canvas = document.getElementById('artifactCanvas').getBoundingClientRect();
      return {
        mainWidth: Math.round(main.width),
        composerVisible: composer.width > 0 && composer.bottom > 0,
        canvasWidth: Math.round(canvas.width),
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      };
    })()`);
    assert.equal(result.composerVisible, true, `${width}x${height} composer`);
    assert.equal(result.overflow, false, `${width}x${height} overflow`);
    assert.ok(result.mainWidth > 0, `${width}x${height} main`);
    if (width <= 820) assert.equal(result.canvasWidth, width, `${width}x${height} canvas`);
  }
});

test("canvas controls expose keyboard focus and accessible state", async () => {
  const result = await evaluate(`(() => {
    const canvas = document.getElementById('artifactCanvas');
    const controls = [...canvas.querySelectorAll('button')];
    return {
      asideLabel: canvas.getAttribute('aria-label'),
      tabpanel: document.getElementById('artifactCanvasBody').getAttribute('role'),
      unnamed: controls.filter((button) => !button.textContent.trim() && !button.getAttribute('aria-label')).length,
      tabs: [...canvas.querySelectorAll('[role="tab"]')].every((tab) => tab.hasAttribute('aria-selected') && tab.getAttribute('aria-controls') === 'artifactCanvasBody'),
      statusLive: document.getElementById('artifactSaveStatus').getAttribute('aria-live')
    };
  })()`);
  assert.equal(result.asideLabel, "Artifact canvas");
  assert.equal(result.tabpanel, "tabpanel");
  assert.equal(result.unnamed, 0);
  assert.equal(result.tabs, true);
  assert.equal(result.statusLive, "polite");
});

test("reduced-motion preference disables workspace transitions", async () => {
  await command("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }]
  });
  const result = await evaluate(`(() => {
    const canvas = getComputedStyle(document.getElementById('artifactCanvas'));
    const main = getComputedStyle(document.querySelector('.main'));
    return { canvasDuration: canvas.transitionDuration, mainDuration: main.transitionDuration };
  })()`);
  assert.ok(parseFloat(result.canvasDuration) < 0.001, result.canvasDuration);
  assert.ok(parseFloat(result.mainDuration) < 0.001, result.mainDuration);
  await command("Emulation.setEmulatedMedia", { features: [] });
});

test("projects can be created and assigned to the active conversation", async () => {
  await command("Page.addScriptToEvaluateOnNewDocument", { source: "window.prompt = () => 'Website redesign';" });
  const result = await evaluate(`(() => {
    window.prompt = () => 'Website redesign';
    document.getElementById('newProjectButton').click();
    const stored = JSON.parse(localStorage.getItem('vela-projects-v1'));
    const activeId = localStorage.getItem('vela-active-conversation-id');
    const conversation = window.VelaConversationStore.safeParse(localStorage.getItem('vela-conversation-v1:' + activeId), null);
    return {
      projectCount: stored.projects.length,
      projectName: stored.projects[0].name,
      assigned: conversation.projectId === stored.projects[0].id,
      header: document.getElementById('conversationProject').textContent,
      selected: document.querySelector('.project-nav-item.active')?.textContent.trim()
    };
  })()`);
  assert.equal(result.projectCount, 1);
  assert.equal(result.projectName, "Website redesign");
  assert.equal(result.assigned, true);
  assert.equal(result.header, "Website redesign");
  assert.equal(result.selected, "Website redesign");
});

test("artifact library stays scoped to the active conversation", async () => {
  const result = await evaluate(`(() => {
    const activeId = localStorage.getItem('vela-active-conversation-id');
    const host = document.createElement('article');
    host.innerHTML = '<div class="markdown-code"><button class="markdown-code-open">Open canvas</button><pre><code class="language-html">&lt;h1&gt;Local artifact&lt;/h1&gt;</code></pre></div>';
    document.getElementById('chatStream').appendChild(host);
    host.querySelector('button').click();

    const active = JSON.parse(localStorage.getItem('vela-conversation-v1:' + activeId));
    localStorage.setItem('vela-conversation-v1:foreign-artifact-chat', JSON.stringify({
      ...active,
      id: 'foreign-artifact-chat',
      title: 'Foreign conversation',
      artifacts: [{ id: 'foreign-artifact', title: 'Foreign artifact', language: 'html', source: '<h1>Foreign</h1>', version: 1 }]
    }));

    document.getElementById('topbarArtifactLibrary').click();
    const cards = [...document.querySelectorAll('.artifact-library-card')];
    return {
      activeId,
      title: document.getElementById('artifactCanvasTitle').textContent,
      cards: cards.length,
      conversationIds: cards.map((card) => card.querySelector('.artifact-library-open').dataset.conversationId),
      names: cards.map((card) => card.querySelector('.artifact-library-name').textContent)
    };
  })()`);
  assert.equal(result.title, "Conversation artifacts");
  assert.ok(result.cards >= 1);
  assert.ok(result.conversationIds.every((id) => id === result.activeId));
  assert.ok(!result.names.includes("Foreign artifact"));
});

test("only the latest assistant turn exposes an icon-free follow-up menu", async () => {
  const result = await evaluate(`(() => {
    const presentation = window.VelaConversationPresentation;
    const stream = document.getElementById('chatStream');
    const first = presentation.createAssistantArticle(document, { userIndex: 0, taskMode: 'chat', validModes: ['chat'], timestamp: Date.now() });
    const second = presentation.createAssistantArticle(document, { userIndex: 2, taskMode: 'chat', validModes: ['chat'], timestamp: Date.now() });
    stream.replaceChildren(first, second);
    second.classList.add('latest-assistant-turn');
    second.querySelector('.response-more-trigger').click();
    return {
      oldActions: getComputedStyle(first.querySelector('.response-actions')).display,
      latestActions: getComputedStyle(second.querySelector('.response-actions')).display,
      expanded: second.querySelector('.response-more-trigger').getAttribute('aria-expanded'),
      menuHidden: second.querySelector('.response-followups').hidden,
      labels: [...second.querySelectorAll('.response-followup')].map((button) => button.textContent.trim()),
      icons: second.querySelectorAll('.response-followups svg').length
    };
  })()`);
  assert.equal(result.oldActions, "none");
  assert.notEqual(result.latestActions, "none");
  assert.equal(result.expanded, "true");
  assert.equal(result.menuHidden, false);
  assert.ok(result.labels.includes("Continue"));
  assert.equal(result.icons, 0);
});

test("reasoning renders progressive step notes", async () => {
  const result = await evaluate(`(() => {
    const article = window.VelaConversationPresentation.createAssistantArticle(document, { userIndex: 0, taskMode: 'chat', validModes: ['chat'] });
    document.getElementById('chatStream').replaceChildren(article);
    const steps = window.VelaConversationPresentation.reasoningSteps('Understand the goal.\\n\\nPlan the response structure.\\n\\nValidate the final answer.');
    const list = article.querySelector('.thought-step-notes');
    steps.forEach((step) => {
      const item = document.createElement('li');
      item.className = 'thought-step-note';
      item.textContent = step;
      list.appendChild(item);
    });
    return { steps: [...list.children].map((item) => item.textContent), label: article.querySelector('.sage-thought-label').textContent };
  })()`);
  assert.deepEqual(result.steps, ["Understand the goal.", "Plan the response structure.", "Validate the final answer."]);
  assert.equal(result.label, "Planning response…");
});

test("artifact canvas scrollbar styling is minimal", async () => {
  const result = await evaluate(`(() => {
    const body = document.getElementById('artifactCanvasBody');
    const style = getComputedStyle(body);
    return { width: style.scrollbarWidth, color: style.scrollbarColor };
  })()`);
  assert.equal(result.width, "thin");
  assert.notEqual(result.color, "auto");
});

test("switching conversations closes and clears the active artifact canvas", async () => {
  const result = await evaluate(`(() => {
    const canvas = document.getElementById('artifactCanvas');
    if (!canvas.classList.contains('open')) document.getElementById('topbarArtifactLibrary').click();
    const current = localStorage.getItem('vela-active-conversation-id');
    const target = 'browser-isolated-chat';
    const saved = JSON.parse(localStorage.getItem('vela-conversation-v1:' + current));
    localStorage.setItem('vela-conversation-v1:' + target, JSON.stringify({ ...saved, id: target, title: 'Isolated chat', messages: [{ role: 'user', content: 'Separate', timestamp: Date.now() }], artifacts: [] }));
    const link = document.createElement('button');
    link.className = 'chat-link';
    link.dataset.conversationId = target;
    document.querySelector('.history').appendChild(link);
    link.click();
    return {
      active: localStorage.getItem('vela-active-conversation-id'),
      canvasOpen: canvas.classList.contains('open'),
      canvasEngaged: document.getElementById('app').classList.contains('canvas-engaged')
    };
  })()`);
  assert.equal(result.active, "browser-isolated-chat");
  assert.equal(result.canvasOpen, false);
  assert.equal(result.canvasEngaged, false);
});

test("research workspace persists structured sources, notes, and draft", async () => {
  const initial = await evaluate(`(() => {
    window.VelaResearchWorkspace.addSources([{
      title: 'Example research report',
      url: 'https://example.com/report',
      host: 'example.com',
      excerpt: 'A directly traceable research claim.'
    }], 'test query');
    return window.VelaResearchWorkspace.snapshot();
  })()`);
  assert.equal(initial.sources.length, 1);
  await reloadPage("window.VelaResearchWorkspace");
  const workspace = await evaluate(`(async () => {
    document.getElementById('topbarResearchWorkspace').click();
    const notes = document.getElementById('researchNotes');
    const draft = document.getElementById('researchDraft');
    notes.value = 'Evidence note [1]';
    notes.dispatchEvent(new Event('input', { bubbles: true }));
    draft.value = 'Cited draft [1]';
    draft.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 150));
    const activeId = localStorage.getItem('vela-active-conversation-id');
    const saved = JSON.parse(localStorage.getItem('vela-conversation-v1:' + activeId));
    return {
      title: document.getElementById('artifactCanvasTitle').textContent,
      sources: document.querySelectorAll('.research-source-card').length,
      sourceText: document.querySelector('.research-source-card')?.textContent || '',
      notes: saved.research.notes,
      draft: saved.research.draft,
      query: saved.research.query
    };
  })()`);
  assert.equal(workspace.title, "Research workspace");
  assert.equal(workspace.sources, 1);
  assert.match(workspace.sourceText, /Example research report/);
  assert.equal(workspace.notes, "Evidence note [1]");
  assert.equal(workspace.draft, "Cited draft [1]");
  assert.equal(workspace.query, "test query");
});

test("research bibliography remains traceable to source URLs", async () => {
  const bibliography = await evaluate(`window.VelaResearchStore.bibliography(window.VelaResearchWorkspace.snapshot())`);
  assert.match(bibliography, /Example research report/);
  assert.match(bibliography, /https:\/\/example\.com\/report/);
  assert.match(bibliography, /accessed/);
});

test("writing studio persists documents and accepts reversible proposals", async () => {
  const seeded = await evaluate(`window.VelaWritingStudio.setDocument({
    brief: 'A concise launch note for customers.',
    outline: '1. Context\\n2. Benefit\\n3. Next step',
    draft: 'This is a very detailed launch update for our customers.',
    stage: 'draft'
  })`);
  assert.equal(seeded.brief, "A concise launch note for customers.");
  const result = await evaluate(`(() => {
    document.getElementById('topbarWritingStudio').click();
    const editor = document.getElementById('writingEditor');
    editor.setSelectionRange(10, 23);
    document.querySelector('[data-writing-action="clarify"]').click();
    const beforeAccept = {
      stage: window.VelaWritingStudio.snapshot().stage,
      removed: document.querySelector('.writing-diff.removed')?.textContent,
      added: document.querySelector('.writing-diff.added')?.textContent
    };
    document.querySelector('.writing-accept').click();
    const after = window.VelaWritingStudio.snapshot();
    return {
      ...beforeAccept,
      draft: after.draft,
      proposal: after.proposal,
      revisions: after.revisions.length,
      title: document.getElementById('artifactCanvasTitle').textContent
    };
  })()`);
  assert.equal(result.title, "Writing studio");
  assert.equal(result.stage, "revision");
  assert.ok(result.removed.length > 0);
  assert.ok(result.added.length > 0);
  assert.equal(result.proposal, null);
  assert.ok(result.revisions >= 1);

  await reloadPage("window.VelaWritingStudio");
  const persisted = await evaluate("window.VelaWritingStudio.snapshot()");
  assert.equal(persisted.brief, "A concise launch note for customers.");
  assert.equal(persisted.outline, "1. Context\n2. Benefit\n3. Next step");
  assert.equal(persisted.draft, result.draft);
});

test("writing studio rejects proposals without changing the draft", async () => {
  const result = await evaluate(`(() => {
    const original = window.VelaWritingStudio.snapshot().draft;
    window.VelaWritingStudio.propose({ action: 'warm', replacement: 'A warmer alternative.', selectionStart: 0, selectionEnd: original.length });
    document.querySelector('.writing-reject').click();
    const next = window.VelaWritingStudio.snapshot();
    return { original, draft: next.draft, proposal: next.proposal };
  })()`);
  assert.equal(result.draft, result.original);
  assert.equal(result.proposal, null);
});

test("coding workspace persists files and enforces execution policy", async () => {
  const seeded = await evaluate(`window.VelaCodingWorkspace.addFiles([
    { path: 'index.html', language: 'html', content: '<!doctype html><h1>Safe preview</h1><script>document.body.dataset.preview="yes";<\\/script>' },
    { path: 'app.js', language: 'javascript', content: 'eval("unsafe")' },
    { path: 'data.json', language: 'json', content: '{' }
  ], 'Browser test files')`);
  assert.equal(seeded.files.length, 3);
  assert.ok(seeded.diagnostics.length >= 2);
  const result = await evaluate(`(() => {
    document.getElementById('topbarCodeWorkspace').click();
    const frame = document.querySelector('.code-preview-frame');
    const frameSandbox = frame?.getAttribute('sandbox');
    const filePaths = [...document.querySelectorAll('.code-file')].map((button) => button.textContent);
    const policies = filePaths.map((path) => {
      [...document.querySelectorAll('.code-file')].find((button) => button.textContent === path)?.click();
      return document.querySelector('.code-policy')?.textContent;
    });
    return {
      title: document.getElementById('artifactCanvasTitle').textContent,
      files: document.querySelectorAll('.code-file').length,
      diagnostics: document.querySelectorAll('.code-diagnostic').length,
      frameSandbox,
      policies,
      parentAccess: frame?.contentWindow?.parent === window
    };
  })()`);
  assert.equal(result.title, "Coding workspace");
  assert.equal(result.files, 3);
  assert.ok(result.diagnostics >= 2);
  assert.equal(result.frameSandbox, "allow-scripts");
  assert.ok(result.policies.includes("disabled"));

  await reloadPage("window.VelaCodingWorkspace");
  const persisted = await evaluate("window.VelaCodingWorkspace.snapshot()");
  assert.equal(persisted.files.length, 3);
  assert.ok(persisted.logs.some((entry) => /not run/.test(entry.message)));
});

test("coding workspace requires explicit patch acceptance", async () => {
  const result = await evaluate(`(() => {
    const original = window.VelaCodingWorkspace.snapshot().files.find((file) => file.path === 'app.js').content;
    window.VelaCodingWorkspace.propose([{ path: 'app.js', language: 'javascript', content: 'const safe = true;' }], 'Remove dynamic execution');
    const pending = document.querySelectorAll('.code-patch-file').length;
    document.querySelector('.code-patch-reject').click();
    const rejected = window.VelaCodingWorkspace.snapshot().files.find((file) => file.path === 'app.js').content;
    window.VelaCodingWorkspace.propose([{ path: 'app.js', language: 'javascript', content: 'const safe = true;' }], 'Remove dynamic execution');
    document.querySelector('.code-patch-accept').click();
    const accepted = window.VelaCodingWorkspace.snapshot();
    return { original, rejected, updated: accepted.files.find((file) => file.path === 'app.js').content, pending, patch: accepted.patch, revisions: accepted.revisions.length };
  })()`);
  assert.equal(result.pending, 1);
  assert.equal(result.rejected, result.original);
  assert.equal(result.updated, "const safe = true;");
  assert.equal(result.patch, null);
  assert.ok(result.revisions >= 2);
});

test("provider configuration failures preserve input and present recovery text", async () => {
  const result = await evaluate(`(async () => {
    localStorage.setItem('sage-byok-config', JSON.stringify({
      enabled: true,
      provider: 'custom',
      format: 'openai-chat',
      endpoint: '',
      model: '',
      profileId: ''
    }));
    const byok = document.getElementById('byokSwitch');
    byok?.setAttribute('aria-checked', 'true');
    document.querySelector('[data-mode="chat"]')?.click();
    const searchButton = document.getElementById('webSearchButton');
    if (searchButton?.getAttribute('aria-pressed') === 'true') searchButton.click();
    const endpoint = document.getElementById('providerEndpoint');
    const model = document.getElementById('providerModel');
    const key = document.getElementById('providerApiKey');
    if (endpoint) endpoint.value = '';
    if (model) model.value = '';
    if (key) key.value = '';
    const input = document.getElementById('composerInput');
    input.value = 'Preserve this failed request';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('composer').requestSubmit();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const records = Object.keys(localStorage)
      .filter((item) => item.startsWith('vela-conversation-v1:'))
      .map((item) => JSON.parse(localStorage.getItem(item)));
    const matching = records.find((record) => record.messages?.some((message) => message.content === 'Preserve this failed request'));
    return {
      hasUser: Boolean(matching),
      hasError: Boolean(matching?.messages?.some((message) => /Add an endpoint or base URL/.test(message.content))),
      pendingCleared: matching?.pending === null,
      visibleError: document.querySelector('.sage-response-error')?.textContent || ''
    };
  })()`);
  assert.equal(result.hasUser, true);
  assert.equal(result.hasError, true, JSON.stringify(result));
  assert.equal(result.pendingCleared, true);
  assert.match(result.visibleError, /Add an endpoint or base URL/);
});

test("corrupt conversation storage recovers without breaking the shell", async () => {
  const result = await evaluate(`(() => {
    localStorage.setItem('vela-active-conversation-id', 'corrupt');
    localStorage.setItem('vela-conversation-v1:corrupt', '{not json');
    return window.VelaConversationStore.load(localStorage, {
      prefix: 'vela-conversation-v1:',
      active: 'vela-active-conversation-id',
      compatibility: 'missing-compatibility',
      legacy: 'missing-legacy'
    }, '', window.VelaArtifactStore);
  })()`);
  assert.equal(result, null);
});

test("artifact persistence survives a page reload", async () => {
  const before = await evaluate(`(() => {
    const keys = Object.keys(localStorage).filter((key) => key.startsWith('vela-conversation-v1:'));
    const records = keys.map((key) => window.VelaConversationStore.safeParse(localStorage.getItem(key), null)).filter(Boolean);
    return records.some((record) => Array.isArray(record.artifacts) && record.artifacts.some((artifact) => artifact.source.includes('Safe preview')));
  })()`);
  assert.equal(before, true);
  await reloadPage();
  const after = await evaluate(`Object.keys(localStorage).filter((key) => key.startsWith('vela-conversation-v1:')).map((key) => window.VelaConversationStore.safeParse(localStorage.getItem(key), null)).filter(Boolean).some((record) => record.artifacts?.some((artifact) => artifact.source.includes('Safe preview')))`);
  assert.equal(after, true);
});

test("chat scroller enforces scroll-behavior auto and overflow-anchor auto", async () => {
  const result = await evaluate(`(() => {
    const scroller = document.querySelector('.chat-scroll');
    const chat = document.querySelector('.chat');
    const scrollerStyle = getComputedStyle(scroller);
    const chatStyle = getComputedStyle(chat);
    return {
      scrollerScrollBehavior: scrollerStyle.scrollBehavior,
      scrollerOverflowAnchor: scrollerStyle.overflowAnchor,
      chatOverflowAnchor: chatStyle.overflowAnchor
    };
  })()`);
  assert.equal(result.scrollerScrollBehavior, "auto");
  assert.equal(result.scrollerOverflowAnchor, "auto");
  assert.equal(result.chatOverflowAnchor, "auto");
});

test("assistant system prompt instructs targeted edits and complete files", async () => {
  const prompt = await evaluate(`window.buildVelaAssistantSystemPrompt({ responseStyle: 'balanced' })`);
  assert.match(prompt, /SEARCH\/REPLACE/);
  assert.match(prompt, /targeted patch/);
});

test("targeted edits generate collapsed Updating step and deliver updated file card", async () => {
  const result = await evaluate(`(async () => {
    const originalFetch = window.fetch;
    localStorage.setItem('sage-byok-config', JSON.stringify({ enabled: true, provider: 'custom', format: 'openai-chat', endpoint: 'https://provider.test/v1/chat/completions', model: 'test' }));
    sessionStorage.setItem('sage-byok-key', 'test-key');
    const byok = document.getElementById('byokSwitch');
    if (byok) byok.setAttribute('aria-checked', 'true');
    const endpointEl = document.getElementById('providerEndpoint');
    if (endpointEl) endpointEl.value = 'https://provider.test/v1/chat/completions';
    const modelEl = document.getElementById('providerModel');
    if (modelEl) modelEl.value = 'test';

    window.fetch = async (url) => {
      if (!String(url).includes('/api/provider') && !String(url).includes('/api/chat')) return originalFetch(url);
      await new Promise((resolve) => setTimeout(resolve, 80));
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Here is the app:\\n\\n' + String.fromCharCode(96).repeat(3) + 'html\\n<!doctype html><title>Version 1</title><body><h1>Hello</h1></body>\\n' + String.fromCharCode(96).repeat(3) }, finish_reason: 'stop' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const input = document.getElementById('composerInput');
    input.value = '/code build an app';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('composer').requestSubmit();

    const start1 = Date.now() + 5000;
    while (document.getElementById('sendButton').dataset.state !== 'stop' && Date.now() < start1) await new Promise((r) => setTimeout(r, 25));
    const done1 = Date.now() + 5000;
    while (document.getElementById('sendButton').dataset.state !== 'send' && Date.now() < done1) await new Promise((r) => setTimeout(r, 25));

    window.fetch = async (url) => {
      if (!String(url).includes('/api/provider') && !String(url).includes('/api/chat')) return originalFetch(url);
      await new Promise((resolve) => setTimeout(resolve, 80));
      const patchContent = 'Updated the title:\\n\\n' +
        String.fromCharCode(96).repeat(3) + 'edit\\n' +
        '<<<<<<< SEARCH\\n' +
        '<title>Version 1</title>\\n' +
        '=======\\n' +
        '<title>Version 2 Updated</title>\\n' +
        '>>>>>>>\\n' +
        String.fromCharCode(96).repeat(3);
      return new Response(JSON.stringify({ choices: [{ message: { content: patchContent }, finish_reason: 'stop' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    input.value = 'change title to Version 2';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('composer').requestSubmit();

    const start2 = Date.now() + 5000;
    while (document.getElementById('sendButton').dataset.state !== 'stop' && Date.now() < start2) await new Promise((r) => setTimeout(r, 25));
    const done2 = Date.now() + 5000;
    while (document.getElementById('sendButton').dataset.state !== 'send' && Date.now() < done2) await new Promise((r) => setTimeout(r, 25));

    const latestArticle = [...document.querySelectorAll('.assistant-message')].at(-1);
    const updateStep = latestArticle?.querySelector('.writing-code-step');
    const titleText = updateStep?.querySelector('.writing-code-title')?.textContent || '';
    const countText = updateStep?.querySelector('.writing-code-count')?.textContent || '';
    const card = latestArticle?.querySelector('.file-card');
    const cardName = card?.querySelector('.file-card-name')?.textContent || '';
    const cardMeta = card?.querySelector('.file-card-meta')?.textContent || '';

    window.fetch = originalFetch;

    return {
      titleText,
      countText,
      hasCard: Boolean(card),
      cardName,
      cardMeta,
      openArtifactWorks: Boolean(card?.querySelector('.file-card-open'))
    };
  })()`);

  assert.equal(result.titleText, "Updated");
  assert.equal(result.countText, "1 edit");
  assert.equal(result.hasCard, true);
  assert.match(result.cardMeta, /updated/i);
  assert.equal(result.openArtifactWorks, true);
});

test("half-finished incomplete code blocks are not wrapped in file-card and omit open-canvas button", async () => {
  const result = await evaluate(`(async () => {
    const originalFetch = window.fetch;
    localStorage.setItem('sage-byok-config', JSON.stringify({ enabled: true, provider: 'custom', format: 'openai-chat', endpoint: 'https://provider.test/v1/chat/completions', model: 'test' }));
    sessionStorage.setItem('sage-byok-key', 'test-key');
    const byok = document.getElementById('byokSwitch');
    if (byok) byok.setAttribute('aria-checked', 'true');
    const endpointEl = document.getElementById('providerEndpoint');
    if (endpointEl) endpointEl.value = 'https://provider.test/v1/chat/completions';
    const modelEl = document.getElementById('providerModel');
    if (modelEl) modelEl.value = 'test';

    // Mock assistant stopping midway through writing an HTML app
    window.fetch = async (url) => {
      if (!String(url).includes('/api/provider') && !String(url).includes('/api/chat')) return originalFetch(url);
      await new Promise((resolve) => setTimeout(resolve, 80));
      const truncated = 'Here is what I have so far:\\n\\n' +
        String.fromCharCode(96).repeat(3) + 'html\\n' +
        '<!doctype html>\\n<html>\\n<head><title>Unfinished Dashboard</title></head>\\n<body>\\n  <div class=\"grid-incomplete\">\\n' +
        String.fromCharCode(96).repeat(3);
      return new Response(JSON.stringify({ choices: [{ message: { content: truncated }, finish_reason: 'stop' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const input = document.getElementById('composerInput');
    input.value = 'create dashboard';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('composer').requestSubmit();

    const start = Date.now() + 5000;
    while (document.getElementById('sendButton').dataset.state !== 'stop' && Date.now() < start) await new Promise((r) => setTimeout(r, 25));
    const done = Date.now() + 5000;
    while (document.getElementById('sendButton').dataset.state !== 'send' && Date.now() < done) await new Promise((r) => setTimeout(r, 25));

    window.fetch = originalFetch;

    const latestArticle = [...document.querySelectorAll('.assistant-message')].at(-1);
    const codeBlock = latestArticle?.querySelector('.markdown-code');
    const openCanvasButton = codeBlock?.querySelector('.markdown-code-open');
    const card = latestArticle?.querySelector('.file-card');
    const responseArtifacts = latestArticle?.querySelector('.response-artifacts');
    const rawCode = codeBlock?.querySelector('pre > code')?.textContent || '';
    const isComplete = window.VelaArtifacts?.isComplete ? window.VelaArtifacts.isComplete('html', rawCode) : null;
    const extractedCount = window.VelaArtifacts?.extractFromMarkdown ? window.VelaArtifacts.extractFromMarkdown(latestArticle?.textContent || '').length : 0;

    return {
      hasCodeBlock: Boolean(codeBlock),
      hasOpenCanvasButton: Boolean(openCanvasButton),
      hasCard: Boolean(card),
      hasResponseArtifacts: Boolean(responseArtifacts && responseArtifacts.children.length > 0),
      isComplete,
      extractedCount
    };
  })()`);

  assert.equal(result.hasCodeBlock, true);
  assert.equal(result.hasOpenCanvasButton, false);
  assert.equal(result.hasCard, false);
  assert.equal(result.hasResponseArtifacts, false);
  assert.equal(result.isComplete, false);
  assert.equal(result.extractedCount, 0);
});

test("page reload never shows old placeholder chat or mock conversations in document", async () => {
  const pageHtml = (await httpRequest({ port: appPort, path: "/" })).body;
  assert.ok(!pageHtml.includes("Designing a calmer workspace"), "Document HTML must not contain old mock title");
  assert.ok(!pageHtml.includes("I want to redesign my workspace"), "Document HTML must not contain old mock user prompt");
  assert.ok(!pageHtml.includes("Today, 9:12 PM"), "Document HTML must not contain old mock date divider");
  assert.ok(!pageHtml.includes("Practical shopping checklist"), "Document HTML must not contain old mock checklist");

  await reloadPage();
  const domCheck = await evaluate(`(() => {
    const text = document.body.innerText;
    return {
      hasMockTitle: text.includes("Designing a calmer workspace"),
      hasMockPrompt: text.includes("I want to redesign my workspace"),
      hasMockDate: text.includes("Today, 9:12 PM"),
      hasMockChecklist: text.includes("Practical shopping checklist")
    };
  })()`);
  assert.equal(domCheck.hasMockTitle, false);
  assert.equal(domCheck.hasMockPrompt, false);
  assert.equal(domCheck.hasMockDate, false);
  assert.equal(domCheck.hasMockChecklist, false);
});

test("chat responses survive tab reload and are accurately restored", async () => {
  const sent = await evaluate(`(async () => {
    const originalFetch = window.fetch;
    localStorage.setItem('sage-byok-config', JSON.stringify({ enabled: true, provider: 'custom', format: 'openai-chat', endpoint: 'https://provider.test/v1/chat/completions', model: 'test' }));
    sessionStorage.setItem('sage-byok-key', 'test-key');
    const byok = document.getElementById('byokSwitch');
    if (byok) byok.setAttribute('aria-checked', 'true');
    const endpointEl = document.getElementById('providerEndpoint');
    if (endpointEl) endpointEl.value = 'https://provider.test/v1/chat/completions';
    const modelEl = document.getElementById('providerModel');
    if (modelEl) modelEl.value = 'test';

    window.fetch = async (url) => {
      if (!String(url).includes('/api/provider') && !String(url).includes('/api/chat')) return originalFetch(url);
      await new Promise((r) => setTimeout(r, 60));
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'Persisted answer for tab refresh resilience.' }, finish_reason: 'stop' }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const input = document.getElementById('composerInput');
    input.value = 'Hello Vela keep this response safe';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('composer').requestSubmit();

    const start = Date.now() + 5000;
    while (document.getElementById('sendButton').dataset.state !== 'stop' && Date.now() < start) await new Promise((r) => setTimeout(r, 25));
    const done = Date.now() + 5000;
    while (document.getElementById('sendButton').dataset.state !== 'send' && Date.now() < done) await new Promise((r) => setTimeout(r, 25));

    window.fetch = originalFetch;

    const latest = [...document.querySelectorAll('.assistant-message')].at(-1);
    return {
      responseContent: latest?.querySelector('.sage-response')?.textContent?.trim() || ''
    };
  })()`);

  assert.equal(sent.responseContent, "Persisted answer for tab refresh resilience.");

  await reloadPage();

  const restored = await evaluate(`(() => {
    const messages = [...document.querySelectorAll('.message')];
    const userMsg = [...document.querySelectorAll('.user-message .message-body')].at(-1)?.textContent?.trim() || '';
    const assistantMsg = [...document.querySelectorAll('.assistant-message .sage-response')].at(-1)?.textContent?.trim() || '';
    return {
      messageCount: messages.length,
      userMsg,
      assistantMsg
    };
  })()`);

  assert.ok(restored.messageCount >= 2, "Both user and assistant messages must be present after reload");
  assert.ok(restored.userMsg.includes("Hello Vela keep this response safe"));
  assert.equal(restored.assistantMsg, "Persisted answer for tab refresh resilience.");
});

test("startup screen height does not clip brand mark and renders polished balanced prompt cards", async () => {
  const result = await evaluate(`(() => {
    document.getElementById('newChatButton').click();
    const mark = document.querySelector('.sage-startup-mark');
    const topbar = document.querySelector('.topbar');
    const title = document.querySelector('.sage-startup-title, .sage-startup h1');
    const prompts = document.querySelectorAll('.sage-startup-prompt');
    const markRect = mark?.getBoundingClientRect();
    const topbarRect = topbar?.getBoundingClientRect();
    const scroller = document.getElementById('chatScroll');
    const scrollerRect = scroller?.getBoundingClientRect();
    return {
      hasStartup: Boolean(document.querySelector('.sage-startup')),
      titleText: title?.textContent?.trim() || '',
      promptCount: prompts.length,
      markTop: markRect ? markRect.top : 0,
      topbarBottom: topbarRect ? topbarRect.bottom : 0,
      isMarkVisibleBelowTopbar: markRect && topbarRect ? markRect.top >= topbarRect.bottom - 4 : false,
      isMarkInsideScroller: markRect && scrollerRect ? markRect.top >= scrollerRect.top : false
    };
  })()`);

  assert.equal(result.hasStartup, true);
  assert.equal(result.titleText, "Where would you like to begin?");
  assert.equal(result.promptCount, 4);
  assert.equal(result.isMarkVisibleBelowTopbar, true, "Brand mark must not be clipped under the topbar");
  assert.equal(result.isMarkInsideScroller, true, "Brand mark must be visible inside the scroll container");
});

test("native PDF artifact renders in the canvas with page viewer and controls without depending on HTML", async () => {
  const result = await evaluate(`(() => {
    const host = document.createElement('article');
    host.innerHTML = '<div class="markdown-code"><button class="markdown-code-open">Open canvas</button><pre><code class="language-pdf"># Strategic Report\\n\\nExecutive overview for native PDF engine.\\n\\n---page---\\n\\n## Details\\n\\nPage two content.</code></pre></div>';
    document.getElementById('chatStream').appendChild(host);
    host.querySelector('button').click();
    const canvas = document.getElementById('artifactCanvas');
    const viewer = canvas.querySelector('.artifact-pdf-viewer');
    const pages = canvas.querySelectorAll('.artifact-pdf-page');
    const prevBtn = canvas.querySelector('.artifact-pdf-prev');
    const nextBtn = canvas.querySelector('.artifact-pdf-next');
    const downloadBtn = canvas.querySelector('.artifact-pdf-download');
    return {
      open: canvas.classList.contains('open'),
      hasViewer: Boolean(viewer),
      pageCount: pages.length,
      hasNavigation: Boolean(prevBtn && nextBtn),
      hasDownload: Boolean(downloadBtn),
      firstPageTitle: pages[0]?.querySelector('.artifact-pdf-heading')?.textContent?.trim() || ''
    };
  })()`);

  assert.equal(result.open, true);
  assert.equal(result.hasViewer, true, "Must render .artifact-pdf-viewer in canvas");
  assert.equal(result.pageCount, 2, "Must render multi-page PDF document");
  assert.equal(result.hasNavigation, true, "Must expose page navigation controls");
  assert.equal(result.hasDownload, true, "Must expose direct .pdf download button");
  assert.equal(result.firstPageTitle, "Strategic Report");
});

test("native PPTX presentation renders in the canvas with 16:9 player and controls without depending on HTML", async () => {
  await command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const result = await evaluate(`(() => {
    const host = document.createElement('article');
    host.innerHTML = '<div class="markdown-code"><button class="markdown-code-open">Open canvas</button><pre><code class="language-pptx"># Enterprise Intelligence\\nSubtitle: 2026 Strategy\\n\\n---\\n\\n# Core Capabilities\\n- Native binary generation\\n- Sub-10ms assembly\\n\\nNotes: Focus on zero HTML dependencies.</code></pre></div>';
    document.getElementById('chatStream').appendChild(host);
    host.querySelector('button').click();
    const canvas = document.getElementById('artifactCanvas');
    canvas.style.transition = 'none';
    canvas.style.transform = 'none';
    const player = canvas.querySelector('.artifact-pptx-player');
    const stage = canvas.querySelector('.artifact-pptx-stage');
    const slide = canvas.querySelector('.artifact-pptx-slide');
    const heroTitle = canvas.querySelector('.artifact-pptx-title-hero');
    const prevBtn = canvas.querySelector('.artifact-pptx-prev');
    const nextBtn = canvas.querySelector('.artifact-pptx-next');
    const notesBtn = canvas.querySelector('.artifact-pptx-notes-toggle');
    const notesDrawer = canvas.querySelector('.artifact-pptx-notes-drawer');
    const overviewDrawer = canvas.querySelector('.artifact-pptx-overview');
    const indicator = canvas.querySelector('.artifact-pptx-total');

    if (heroTitle?.scrollIntoView) heroTitle.scrollIntoView();
    const heroRect = heroTitle ? heroTitle.getBoundingClientRect() : null;
    const topEl = heroRect ? document.elementFromPoint(heroRect.x + heroRect.width / 2, heroRect.y + heroRect.height / 2) : null;

    return {
      open: canvas.classList.contains('open'),
      hasPlayer: Boolean(player),
      hasStage: Boolean(stage),
      hasSlide: Boolean(slide),
      slideOpacity: slide ? window.getComputedStyle(slide).opacity : null,
      slideVisibility: slide ? window.getComputedStyle(slide).visibility : null,
      overviewHidden: overviewDrawer ? overviewDrawer.hidden : false,
      overviewDisplay: overviewDrawer ? window.getComputedStyle(overviewDrawer).display : null,
      topElTag: topEl?.tagName,
      heroText: heroTitle?.textContent?.trim(),
      totalSlides: indicator?.textContent?.trim() || '0',
      hasNavigation: Boolean(prevBtn && nextBtn),
      hasNotesToggle: Boolean(notesBtn && notesDrawer)
    };
  })()`);

  assert.equal(result.open, true);
  assert.equal(result.hasPlayer, true, "Must render .artifact-pptx-player in canvas");
  assert.equal(result.hasStage, true, "Must render 16:9 stage");
  assert.equal(result.hasSlide, true, "Must render active slide");
  assert.equal(result.slideOpacity, "1", "Slide must have full opacity 1 on load");
  assert.equal(result.slideVisibility, "visible", "Slide must be visible");
  assert.equal(result.overviewHidden, true, "Overview drawer must be hidden by default");
  assert.equal(result.overviewDisplay, "none", "Overview drawer display must be none when hidden");
  assert.equal(result.topElTag, "H1", "Hero title must not be occluded by overview drawer");
  assert.equal(result.heroText, "Enterprise Intelligence", "Hero text must render");
  assert.equal(result.totalSlides, "2", "Must detect 2 slides in deck");
  assert.equal(result.hasNavigation, true, "Must expose slide navigation");
  assert.equal(result.hasNotesToggle, true, "Must expose speaker notes drawer");
});

test("assistant system prompt declares native PDF and PPTX deliverable contracts", async () => {
  const prompt = await evaluate(`window.buildVelaAssistantSystemPrompt({ responseStyle: 'balanced' })`);
  assert.match(prompt, /PDF and PPTX artifacts are supported natively/);
  assert.match(prompt, /```pdf/);
  assert.match(prompt, /```pptx/);
  assert.doesNotMatch(prompt, /do not claim native PPTX generation/);
  assert.doesNotMatch(prompt, /browser's print dialog performs the final PDF save/);
});

test("attachment preview opens on clicking attachment chips in prompter and in chat messages", async () => {
  const result = await evaluate(`(async () => {
    const fileInput = document.getElementById("fileAttachmentInput");
    const tray = document.getElementById("attachmentTray");
    const modal = document.getElementById("attachmentPreviewModal");
    const closeBtn = document.getElementById("attachmentPreviewCloseBtn");
    const filenameEl = document.getElementById("attachmentPreviewFilename");
    const bodyEl = document.getElementById("attachmentPreviewBody");
    const stream = document.getElementById("chatStream");

    // 1. Attach a file
    const file = new File(["console.log('hello world');"], "script.js", { type: "text/javascript" });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    fileInput.files = dataTransfer.files;
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));

    // Allow async addFiles to complete
    await new Promise((r) => setTimeout(r, 200));

    const chip = tray.querySelector(".attachment-chip");
    if (!chip) return { error: "Chip not rendered" };

    // 2. Click chip in composer
    chip.click();
    await new Promise((r) => setTimeout(r, 100));

    const prompterOpened = modal.classList.contains("is-visible") && !modal.hidden;
    const prompterName = filenameEl?.textContent;
    const prompterHasCode = Boolean(bodyEl?.querySelector(".attachment-preview-code"));

    // 3. Close modal
    closeBtn.click();
    await new Promise((r) => setTimeout(r, 300));
    const closedAfterPrompter = !modal.classList.contains("is-visible");

    // 4. Send the message
    const composer = document.getElementById("composer");
    const input = document.getElementById("composerInput");
    input.value = "Review this script";
    composer.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    await new Promise((r) => setTimeout(r, 250));

    // 5. Find message-attachment in stream
    const messageAttachment = stream.querySelector(".message-attachment");
    if (!messageAttachment) {
      return { error: "Message attachment not in chat stream", prompterOpened, prompterName, closedAfterPrompter };
    }

    // 6. Click message attachment in chat
    messageAttachment.click();
    await new Promise((r) => setTimeout(r, 100));

    const chatOpened = modal.classList.contains("is-visible") && !modal.hidden;
    const chatName = filenameEl?.textContent;
    const chatHasCode = Boolean(bodyEl?.querySelector(".attachment-preview-code"));

    // 7. Press Escape to close
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    const closedAfterChat = !modal.classList.contains("is-visible");

    return {
      prompterOpened,
      prompterName,
      prompterHasCode,
      closedAfterPrompter,
      chatOpened,
      chatName,
      chatHasCode,
      closedAfterChat
    };
  })()`);

  assert.equal(result.error, undefined, `Unexpected error: ${result.error}`);
  assert.equal(result.prompterOpened, true, "Modal must open when clicking chip in composer");
  assert.equal(result.prompterName, "script.js");
  assert.equal(result.prompterHasCode, true, "Code preview must render in modal");
  assert.equal(result.closedAfterPrompter, true, "Modal must close on close button click");
  assert.equal(result.chatOpened, true, "Modal must open when clicking message attachment in chat");
  assert.equal(result.chatName, "script.js");
  assert.equal(result.chatHasCode, true, "Code preview must render from chat attachment");
  assert.equal(result.closedAfterChat, true, "Modal must close on Escape key");
});

test("PDF attachment preview renders document viewer and Open in Canvas opens PDF in canvas", async () => {
  const result = await evaluate(`(async () => {
    const fileInput = document.getElementById("fileAttachmentInput");
    const tray = document.getElementById("attachmentTray");
    const modal = document.getElementById("attachmentPreviewModal");
    const canvasBtn = document.getElementById("attachmentPreviewCanvasBtn");
    const canvas = document.getElementById("artifactCanvas");
    const canvasTitle = document.getElementById("artifactCanvasTitle");
    const canvasBody = document.getElementById("artifactCanvasBody");

    // 1. Attach a PDF file
    const pdfContent = "%PDF-1.4\\n1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj\\n2 0 obj <</Type /Pages /Kids [3 0 R] /Count 1>> endobj\\n3 0 obj <</Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R>> endobj\\n4 0 obj <</Length 44>> stream\\nBT /F1 18 Tf 50 100 Td (Hello PDF) Tj ET\\nendstream\\nendobj\\nxref\\n0 5\\n0000000000 65535 f\\n0000000010 00000 n\\n0000000060 00000 n\\n0000000117 00000 n\\n0000000201 00000 n\\ntrailer <</Size 5 /Root 1 0 R>>\\nstartxref\\n296\\n%%EOF";
    const file = new File([pdfContent], "report.pdf", { type: "application/pdf" });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    fileInput.files = dataTransfer.files;
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));

    await new Promise((r) => setTimeout(r, 250));

    const chip = tray.querySelector(".attachment-chip");
    if (!chip) return { error: "PDF chip not rendered in composer" };

    // 2. Click PDF chip in composer
    chip.click();
    await new Promise((r) => setTimeout(r, 150));

    const previewBody = document.getElementById("attachmentPreviewBody");
    const pdfFrame = previewBody?.querySelector(".attachment-preview-pdf-frame, object[type='application/pdf'], iframe");
    const hasPdfViewer = Boolean(pdfFrame);

    // 3. Click Open in Canvas
    canvasBtn.click();
    await new Promise((r) => setTimeout(r, 300));

    const modalClosedAfterCanvas = !modal.classList.contains("is-visible");
    const canvasOpen = !canvas.hidden && (canvas.classList.contains("open") || canvas.classList.contains("is-open"));
    const titleText = canvasTitle?.textContent || "";
    const canvasPdfViewer = canvasBody?.querySelector(".artifact-pdf-viewer");
    const hasCanvasViewer = Boolean(canvasPdfViewer);

    return {
      hasPdfViewer,
      modalClosedAfterCanvas,
      canvasOpen,
      titleText,
      hasCanvasViewer
    };
  })()`);

  assert.equal(result.error, undefined, `Unexpected error: ${result.error}`);
  assert.equal(result.hasPdfViewer, true, "PDF preview modal must render PDF document viewer");
  assert.equal(result.modalClosedAfterCanvas, true, "Preview modal must close when Open in Canvas is clicked");
  assert.equal(result.canvasOpen, true, "Artifact Canvas must open when Open in Canvas is clicked");
  assert.match(result.titleText, /report\.pdf/i, "Canvas title must match the attachment name");
  assert.equal(result.hasCanvasViewer, true, "Artifact Canvas must render PDF viewer surface");
});

test("composer attachment tray truncates long document names with ellipsis and styles images minimally without UI names", async () => {
  const result = await evaluate(`(async () => {
    const fileInput = document.getElementById("fileAttachmentInput");
    const imageInput = document.getElementById("imageAttachmentInput");
    const tray = document.getElementById("attachmentTray");
    const modal = document.getElementById("attachmentPreviewModal");
    const closeBtn = document.getElementById("attachmentPreviewCloseBtn");
    const bodyEl = document.getElementById("attachmentPreviewBody");

    // 1. Attach a long-named PDF document
    const longName = "Chemical Coordination and Integration DPP 05 Zoology By Dr.pdf";
    const pdfFile = new File(["%PDF-1.4 test"], longName, { type: "application/pdf" });
    const pdfDt = new DataTransfer();
    pdfDt.items.add(pdfFile);
    fileInput.files = pdfDt.files;
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));

    // 2. Attach an image
    const pixelBase64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const blob = await fetch(pixelBase64).then((r) => r.blob());
    const imgFile = new File([blob], "diagram_sample_photo.png", { type: "image/png" });
    const imgDt = new DataTransfer();
    imgDt.items.add(imgFile);
    imageInput.files = imgDt.files;
    imageInput.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 250));

    const chips = [...tray.querySelectorAll(".attachment-chip")];
    if (chips.length < 2) return { error: "Expected at least 2 chips, found " + chips.length };

    const docChip = chips.find((c) => !c.classList.contains("attachment-chip-image"));
    const imgChip = chips.find((c) => c.classList.contains("attachment-chip-image"));

    if (!docChip) return { error: "Document chip not found" };
    if (!imgChip) return { error: "Image chip not found" };

    // Check docChip truncation styles
    const docName = docChip.querySelector(".attachment-chip-name");
    const docNameStyle = docName ? window.getComputedStyle(docName) : null;
    const docChipStyle = window.getComputedStyle(docChip);

    const docHasOverflowHidden = docChipStyle.overflow === "hidden";
    const docNameEllipsis = docNameStyle?.textOverflow === "ellipsis";
    const docNameNoWrap = docNameStyle?.whiteSpace === "nowrap";

    // Check image chip: must have NO UI name (.attachment-chip-copy should not exist)
    const imgHasCopy = Boolean(imgChip.querySelector(".attachment-chip-copy"));
    const imgThumb = imgChip.querySelector(".attachment-image-thumb");
    const imgHasThumb = Boolean(imgThumb);
    const imgRemoveBtn = imgChip.querySelector(".attachment-remove");
    const imgHasRemove = Boolean(imgRemoveBtn);

    // Check lightbox preview on click
    imgChip.click();
    await new Promise((r) => setTimeout(r, 150));
    const modalVisibleOnImgClick = modal.classList.contains("is-visible") && !modal.hidden;
    const modalHasImage = Boolean(bodyEl?.querySelector(".attachment-preview-image"));

    // Close modal
    closeBtn.click();
    await new Promise((r) => setTimeout(r, 200));

    // Remove image chip via remove button
    imgRemoveBtn.click();
    await new Promise((r) => setTimeout(r, 150));
    const remainingChips = [...tray.querySelectorAll(".attachment-chip")];
    const imageRemoved = !remainingChips.some((c) => c.classList.contains("attachment-chip-image"));

    return {
      docHasOverflowHidden,
      docNameEllipsis,
      docNameNoWrap,
      imgHasCopy,
      imgHasThumb,
      imgHasRemove,
      modalVisibleOnImgClick,
      modalHasImage,
      imageRemoved
    };
  })()`);

  assert.equal(result.error, undefined, `Unexpected error: ${result.error}`);
  assert.equal(result.docHasOverflowHidden, true, "Document chip must have overflow: hidden");
  assert.equal(result.docNameEllipsis, true, "Document chip name must have text-overflow: ellipsis");
  assert.equal(result.docNameNoWrap, true, "Document chip name must have white-space: nowrap");
  assert.equal(result.imgHasCopy, false, "Image chip must NOT render text copy/name in the UI");
  assert.equal(result.imgHasThumb, true, "Image chip must render minimal image thumbnail");
  assert.equal(result.imgHasRemove, true, "Image chip must render floating remove button");
  assert.equal(result.modalVisibleOnImgClick, true, "Clicking minimal image chip must open preview modal");
  assert.equal(result.modalHasImage, true, "Preview modal must show full image preview");
  assert.equal(result.imageRemoved, true, "Clicking remove button on image chip must remove it from tray");
});

test("PDF attachment extracts text into prompt payload and provides copy text in preview", async () => {
  const result = await evaluate(`(async () => {
    const fileInput = document.getElementById("fileAttachmentInput");
    const tray = document.getElementById("attachmentTray");
    const modal = document.getElementById("attachmentPreviewModal");
    const closeBtn = document.getElementById("attachmentPreviewCloseBtn");
    const copyBtn = document.getElementById("attachmentPreviewCopyBtn");

    if (!fileInput) return { error: "fileAttachmentInput not found" };

    // 1. Build a PDF with clear textual content
    const doc = window.VelaPdf.parseDocument("# Zoology DPP 05\\n\\nChemical Coordination and Integration mechanisms in human body.");
    const bytes = window.VelaPdf.buildPdf(doc);
    const pdfFile = new File([bytes], "Zoology_DPP_05.pdf", { type: "application/pdf" });
    const dt = new DataTransfer();
    dt.items.add(pdfFile);
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));

    // Wait for addFiles and extractText to complete
    let chip = null;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 100));
      chip = tray.querySelector(".attachment-chip");
      if (chip) break;
    }
    if (!chip) return { error: "PDF chip was not created in attachment tray" };

    // 2. Click the chip to open preview modal
    chip.click();
    await new Promise((r) => setTimeout(r, 200));

    const modalVisible = modal.classList.contains("is-visible") && !modal.hidden;
    const copyBtnVisible = copyBtn && window.getComputedStyle(copyBtn).display !== "none";

    // Close preview modal
    closeBtn.click();
    await new Promise((r) => setTimeout(r, 150));

    // 3. Verify that the pending attachment has extracted text by checking contentFor
    const activeMsg = {
      content: "Review this DPP",
      attachments: [{
        name: "Zoology_DPP_05.pdf",
        type: "application/pdf",
        kind: "pdf",
        text: (await window.VelaPdf.extractText(bytes))
      }]
    };
    const payload = window.VelaProviderRequests.contentFor(activeMsg, "openai-chat");

    // Clean up tray
    const removeBtn = chip.querySelector(".attachment-remove");
    if (removeBtn) removeBtn.click();
    await new Promise((r) => setTimeout(r, 100));

    return {
      modalVisible,
      copyBtnVisible,
      payload,
      hasHeading: payload.includes("Zoology DPP 05"),
      hasBody: payload.includes("Chemical Coordination"),
      hasTag: payload.includes('<attachment name="Zoology_DPP_05.pdf">')
    };
  })()`);

  assert.equal(result.error, undefined, `Unexpected error: ${result.error}`);
  assert.equal(result.modalVisible, true, "Clicking PDF chip must open preview modal");
  assert.equal(result.copyBtnVisible, true, "Copy button must be visible when text is extracted");
  assert.equal(result.hasHeading, true, "Payload must contain document heading");
  assert.equal(result.hasBody, true, "Payload must contain document body text");
  assert.equal(result.hasTag, true, "Payload must format document in <attachment name=...> tags");
});

test("customization suite controls theme, accent palettes, density, and typography", async () => {
  const result = await evaluate(`(() => {
    const root = document.documentElement;

    // 1. OLED theme switch
    const oledBtn = document.querySelector('[data-theme-choice="oled"]');
    if (oledBtn) oledBtn.click();
    const oledTheme = root.dataset.theme;
    const oledBg = getComputedStyle(root).getPropertyValue('--bg').trim();
    const metaColor = document.querySelector('meta[name="theme-color"]').getAttribute('content');

    // 2. Accent color switch
    const azureSwatch = document.querySelector('[data-accent="azure"]');
    if (azureSwatch) azureSwatch.click();
    const azureAccent = root.dataset.accent;
    const azureColor = getComputedStyle(root).getPropertyValue('--accent').trim();

    // 3. Density switch
    const compactBtn = document.querySelector('[data-density-choice="compact"]');
    if (compactBtn) compactBtn.click();
    const compactDensity = root.dataset.density;

    // 4. Typography switch
    const fontSelect = document.getElementById('fontChoice');
    if (fontSelect) {
      fontSelect.value = 'editorial';
      fontSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const editorialFont = root.dataset.font;

    // Reset back to defaults
    const lightBtn = document.querySelector('[data-theme-choice="light"]');
    if (lightBtn) lightBtn.click();
    const mossSwatch = document.querySelector('[data-accent="moss"]');
    if (mossSwatch) mossSwatch.click();
    const balancedBtn = document.querySelector('[data-density-choice="balanced"]');
    if (balancedBtn) balancedBtn.click();
    if (fontSelect) {
      fontSelect.value = 'modern';
      fontSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }

    return {
      oledTheme,
      oledBg,
      metaColor,
      azureAccent,
      azureColor,
      compactDensity,
      editorialFont
    };
  })()`);

  assert.equal(result.oledTheme, "oled");
  assert.equal(result.oledBg, "#000000");
  assert.equal(result.metaColor, "#000000");
  assert.equal(result.azureAccent, "azure");
  assert.equal(result.azureColor, "#2997ff");
  assert.equal(result.compactDensity, "compact");
  assert.equal(result.editorialFont, "editorial");
});

test("markdown artifacts with YAML frontmatter render publication-grade editorial masthead and strip duplicate title", async () => {
  const result = await evaluate(`(() => {
    const docMarkdown = \`---
title: "Next 7 Days: Global AI & Technology Release Radar"
author: "Vela Research & Intelligence"
date: "2026-09-17"
sources: "Verified Reuters, TechCrunch, ArXiv"
---

# Next 7 Days: Global AI & Technology Release Radar

Executive summary of frontier releases.\`;

    const container = document.createElement('div');
    container.className = 'artifact-preview-surface markdown-body';
    
    // Test extraction and rendering
    const { frontmatter, body } = window.VelaMarkdown.extractFrontmatter(docMarkdown);
    const headerHtml = window.VelaMarkdown.renderFrontmatterHeader(frontmatter);
    
    // Test container rendering via renderMarkdown
    container.innerHTML = renderMarkdown(docMarkdown);

    const header = container.querySelector('.markdown-frontmatter-header');
    const titleEl = container.querySelector('.frontmatter-title');
    const authorEl = container.querySelector('.frontmatter-author');
    const dateEl = container.querySelector('.frontmatter-date');
    const sourcesEl = container.querySelector('.frontmatter-sources');
    const kickerEl = container.querySelector('.frontmatter-kicker');
    
    // Count h1 tags to ensure no duplicate title exists
    const h1s = container.querySelectorAll('h1');

    return {
      hasHeader: Boolean(header),
      title: titleEl?.textContent,
      author: authorEl?.textContent,
      date: dateEl?.textContent,
      sources: sourcesEl?.textContent,
      kicker: kickerEl?.textContent,
      h1Count: h1s.length,
      bodyContainsRawYaml: container.textContent.includes('title: "Next 7 Days'),
      bodyContainsExecutiveSummary: container.textContent.includes('Executive summary of frontier releases')
    };
  })()`);

  assert.equal(result.hasHeader, true, "Masthead header should be rendered");
  assert.equal(result.title, "Next 7 Days: Global AI & Technology Release Radar");
  assert.ok(result.author.includes("Vela Research & Intelligence"));
  assert.ok(result.date.includes("2026-09-17"));
  assert.ok(result.sources.includes("Verified Reuters, TechCrunch, ArXiv"));
  assert.ok(result.kicker.length > 0);
  assert.equal(result.h1Count, 1, "There should only be one title h1 element, redundant duplicate stripped");
  assert.equal(result.bodyContainsRawYaml, false, "Raw YAML frontmatter must not be rendered as plain text");
  assert.equal(result.bodyContainsExecutiveSummary, true, "Executive summary body text must be preserved");
});

test("mobile executive UX enforces 16px inputs, accessible touch targets, visible model pill, and responsive drawers", async () => {
  await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  const result = await evaluate(`(() => {
    const metaViewport = document.querySelector('meta[name="viewport"]')?.getAttribute('content') || '';
    const composerInput = document.getElementById('composerInput');
    const composerStyle = window.getComputedStyle(composerInput);
    const modelPicker = document.querySelector('.model-picker-wrap');
    const modelPickerStyle = window.getComputedStyle(modelPicker);
    const topbarCode = document.getElementById('topbarCodeWorkspace');
    const topbarCodeStyle = window.getComputedStyle(topbarCode);
    const menuBtn = document.getElementById('mobileMenuButton');
    const menuBtnRect = menuBtn?.getBoundingClientRect();
    const sendBtn = document.getElementById('sendButton');
    const sendBtnRect = sendBtn?.getBoundingClientRect();
    const sidebarCode = document.getElementById('sidebarCodeWorkspace');

    // Test mobile drawer interaction
    menuBtn?.click();
    const isDrawerOpen = document.getElementById('app')?.classList.contains('mobile-sidebar-open');

    // Click sidebar workspace item
    sidebarCode?.click();
    const isCanvasOpenAfterClick = document.getElementById('artifactCanvas')?.classList.contains('open');
    const isDrawerClosedAfterClick = !document.getElementById('app')?.classList.contains('mobile-sidebar-open');

    // Close canvas
    document.getElementById('closeArtifactCanvas')?.click();

    return {
      viewportHasCover: metaViewport.includes('viewport-fit=cover'),
      viewportHasInteractive: metaViewport.includes('interactive-widget=resizes-content'),
      composerFontSize: composerStyle.fontSize,
      modelPickerVisible: modelPickerStyle.display !== 'none' && modelPicker.offsetWidth > 0,
      topbarCodeHidden: topbarCodeStyle.display === 'none',
      menuBtnSize: Math.round(Math.min(menuBtnRect?.width || 0, menuBtnRect?.height || 0)),
      sendBtnSize: Math.round(Math.min(sendBtnRect?.width || 0, sendBtnRect?.height || 0)),
      isDrawerOpen,
      isCanvasOpenAfterClick,
      isDrawerClosedAfterClick,
      noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
    };
  })()`);

  assert.equal(result.viewportHasCover, true, "Viewport must declare viewport-fit=cover for safe-area insets");
  assert.equal(result.viewportHasInteractive, true, "Viewport must declare interactive-widget=resizes-content");
  assert.equal(result.composerFontSize, "16px", "Composer input font-size must be at least 16px to prevent iOS auto-zoom");
  assert.equal(result.modelPickerVisible, true, "Model picker must remain visible and accessible on mobile");
  assert.equal(result.topbarCodeHidden, true, "Desktop workspace buttons must be hidden from mobile topbar to avoid crowding");
  assert.ok(result.menuBtnSize >= 38, "Mobile menu button touch target must be at least 38px");
  assert.ok(result.sendBtnSize >= 38, "Send button touch target must be at least 38px");
  assert.equal(result.isDrawerOpen, true, "Mobile menu button must open navigation drawer");
  assert.equal(result.isCanvasOpenAfterClick, true, "Tapping workspace in mobile drawer must open canvas");
  assert.equal(result.isDrawerClosedAfterClick, true, "Opening workspace must close mobile navigation drawer");
  assert.equal(result.noHorizontalOverflow, true, "No horizontal page overflow on mobile viewport");

  await command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
});

test("mobile dropdowns and options menus fit cleanly within viewport without clipping or half-hidden states", async () => {
  await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  const result = await evaluate(`(() => {
    // 1. Test model picker dropdown
    const modelPicker = document.getElementById('topbarModelPicker');
    modelPicker.click();
    const modelMenu = document.getElementById('topbarModelMenu');
    const mRect = modelMenu.getBoundingClientRect();
    const modelFitsH = mRect.left >= 0 && mRect.right <= window.innerWidth;
    const modelFitsV = mRect.top >= 0 && mRect.bottom <= window.innerHeight;
    modelPicker.click(); // close

    // 2. Test conversation options dropdown
    const menuBtn = document.getElementById('mobileMenuButton');
    menuBtn?.click();
    const history = document.querySelector('.history');
    let testItem = document.getElementById('test-conv-dropdown-item');
    if (!testItem) {
      testItem = document.createElement('div');
      testItem.id = 'test-conv-dropdown-item';
      testItem.className = 'chat-link';
      testItem.dataset.conversationId = 'test-conv-menu';
      testItem.innerHTML = '<span class="chat-link-label">Test</span><button class="chat-more" id="testConvMore">···</button>';
      history?.appendChild(testItem);
    }
    const moreBtn = document.getElementById('testConvMore');
    moreBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const convMenu = document.getElementById('conversationMenu');
    const cRect = convMenu.getBoundingClientRect();
    const convFitsH = cRect.left >= 0 && cRect.right <= window.innerWidth;
    const convFitsV = cRect.top >= 0 && cRect.bottom <= window.innerHeight;
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // 3. Test API key auto-persistence into localStorage
    const keyInput = document.getElementById('providerApiKey');
    keyInput.value = 'gsk_browser_test_key_xyz';
    keyInput.dispatchEvent(new Event('input', { bubbles: true }));
    keyInput.dispatchEvent(new Event('change', { bubbles: true }));
    const storedKey = localStorage.getItem('sage-byok-key');

    return {
      modelFitsH,
      modelFitsV,
      convFitsH,
      convFitsV,
      storedKeyMatches: storedKey === 'gsk_browser_test_key_xyz'
    };
  })()`);

  assert.equal(result.modelFitsH, true, "Model dropdown must fit within horizontal mobile screen boundaries");
  assert.equal(result.modelFitsV, true, "Model dropdown must fit within vertical mobile screen boundaries");
  assert.equal(result.convFitsH, true, "Conversation options dropdown must fit horizontally without clipping");
  assert.equal(result.convFitsV, true, "Conversation options dropdown must fit vertically without being cut in half");
  assert.equal(result.storedKeyMatches, true, "API key input must auto-persist to localStorage");

  await command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
});
