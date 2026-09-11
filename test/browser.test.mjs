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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
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
    document.getElementById('pinArtifactCanvas').click();
    document.getElementById('fullscreenArtifactCanvas').click();
    const canvas = document.getElementById('artifactCanvas');
    return {
      split: Boolean(splitView),
      selected: split.getAttribute('aria-selected'),
      pinned: canvas.classList.contains('pinned'),
      fullscreen: canvas.classList.contains('fullscreen'),
      state: JSON.parse(localStorage.getItem('vela-workspace-state-v1'))
    };
  })()`);
  assert.equal(result.split, true);
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

test("global library aggregates artifacts and exposes project metadata", async () => {
  const result = await evaluate(`(() => {
    document.getElementById('topbarArtifactLibrary').click();
    const cards = [...document.querySelectorAll('.artifact-library-card')];
    return {
      title: document.getElementById('artifactCanvasTitle').textContent,
      cards: cards.length,
      metadata: cards.map((card) => card.querySelector('.artifact-library-meta').textContent),
      filterOptions: document.querySelectorAll('.artifact-library-project option').length
    };
  })()`);
  assert.equal(result.title, "Global artifact library");
  assert.ok(result.cards >= 1);
  assert.ok(result.metadata.some((value) => /Website redesign/.test(value)));
  assert.ok(result.filterOptions >= 2);
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
  await command("Page.enable");
  await command("Page.reload", { ignoreCache: true });
  await waitFor(() => evaluate("Boolean(window.__sageConversationControllerV2 && window.VelaResearchWorkspace)"));
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

  await command("Page.reload", { ignoreCache: true });
  await waitFor(() => evaluate("Boolean(window.__sageConversationControllerV2 && window.VelaWritingStudio)"));
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

  await command("Page.reload", { ignoreCache: true });
  await waitFor(() => evaluate("Boolean(window.__sageConversationControllerV2 && window.VelaCodingWorkspace)"));
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
  await command("Page.enable");
  await command("Page.reload", { ignoreCache: true });
  await waitFor(() => evaluate("Boolean(window.__sageConversationControllerV2 && window.VelaArtifactStore)"));
  const after = await evaluate(`Object.keys(localStorage).filter((key) => key.startsWith('vela-conversation-v1:')).map((key) => window.VelaConversationStore.safeParse(localStorage.getItem(key), null)).filter(Boolean).some((record) => record.artifacts?.some((artifact) => artifact.source.includes('Safe preview')))`);
  assert.equal(after, true);
});
