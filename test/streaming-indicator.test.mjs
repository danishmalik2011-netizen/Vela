import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const indicatorSource = await readFile(new URL("../src/conversation/streaming-indicator.js", import.meta.url), "utf8");

function createMockDocument() {
  const elements = [];
  return {
    createElement: (tag) => {
      let innerHtml = "";
      const children = [];
      const classListSet = new Set();
      const el = {
        tagName: tag.toUpperCase(),
        className: "",
        classList: {
          add: (...cls) => {
            cls.forEach((c) => classListSet.add(c));
            el.className = Array.from(classListSet).join(" ");
          },
          remove: (...cls) => {
            cls.forEach((c) => classListSet.delete(c));
            el.className = Array.from(classListSet).join(" ");
          },
          contains: (c) => classListSet.has(c),
          toggle: (c, force) => {
            const has = classListSet.has(c);
            const next = force !== undefined ? force : !has;
            if (next) classListSet.add(c);
            else classListSet.delete(c);
            el.className = Array.from(classListSet).join(" ");
            return next;
          }
        },
        dataset: {},
        attributes: {},
        children,
        isConnected: true,
        get firstElementChild() {
          return children[0] || null;
        },
        get lastElementChild() {
          return children[children.length - 1] || null;
        },
        get textContent() {
          return el._textContent !== undefined ? el._textContent : innerHtml;
        },
        set textContent(val) {
          el._textContent = String(val);
        },
        get innerHTML() {
          return innerHtml;
        },
        set innerHTML(val) {
          innerHtml = String(val);
          // Very lightweight mock child parser for template/div
          if (val.includes("<span class=\"streaming-cursor streaming-indicator\"")) {
            const childEl = createMockDocument().createElement("span");
            childEl.className = "streaming-cursor streaming-indicator";
            childEl.classList.add("streaming-cursor");
            childEl.classList.add("streaming-indicator");
            children.length = 0;
            children.push(childEl);
          }
        },
        content: {
          get firstElementChild() {
            return children[0] || null;
          }
        },
        setAttribute: (k, v) => { el.attributes[k] = String(v); },
        getAttribute: (k) => el.attributes[k],
        appendChild: (child) => {
          const idx = children.indexOf(child);
          if (idx !== -1) children.splice(idx, 1);
          children.push(child);
          child.parentNode = el;
          return child;
        },
        removeChild: (child) => {
          const idx = children.indexOf(child);
          if (idx !== -1) children.splice(idx, 1);
          child.parentNode = null;
          return child;
        },
        remove: () => {
          if (el.parentNode) el.parentNode.removeChild(el);
        },
        querySelector: (selector) => {
          if (selector === ".streaming-indicator") {
            return children.find((c) => c.classList.contains("streaming-indicator")) || null;
          }
          if (selector === ".streaming-indicator-label") {
            return el.querySelector ? children[0] || null : null;
          }
          return null;
        }
      };
      elements.push(el);
      return el;
    }
  };
}

function loadIndicatorInContext() {
  const mockDoc = createMockDocument();
  const context = vm.createContext({
    Date,
    Math,
    String,
    Array,
    Object,
    Set,
    WeakMap,
    document: mockDoc,
    window: {
      matchMedia: () => ({ matches: false })
    },
    setInterval: () => 1,
    clearInterval: () => {}
  });
  vm.runInContext(indicatorSource, context);
  return { indicator: context.VelaStreamingSpinner, mockDoc };
}

test("VelaStreamingSpinner detects inception categories accurately", () => {
  const { indicator } = loadIndicatorInContext();

  assert.equal(indicator.detectCategory({ text: "", reasoning: "", taskMode: "chat" }), "INCEPTION_DEFAULT");
  assert.equal(indicator.detectCategory({ text: "   ", reasoning: "Thinking deeply about options...", taskMode: "chat" }), "INCEPTION_REASONING");
  assert.equal(indicator.detectCategory({ text: "", taskMode: "research" }), "INCEPTION_RESEARCH");
  assert.equal(indicator.detectCategory({ text: "", taskMode: "code" }), "INCEPTION_CODE");
  assert.equal(indicator.detectCategory({ text: "", taskMode: "write" }), "INCEPTION_WRITE");
});

test("VelaStreamingSpinner detects active code block, tables, and general generating phases", () => {
  const { indicator } = loadIndicatorInContext();

  // Active unclosed code block
  assert.equal(
    indicator.detectCategory({ text: "Here is the code:\n```typescript\nfunction start() {" }),
    "CODE"
  );

  // Markdown table
  assert.equal(
    indicator.detectCategory({ text: "Here is the table:\n| Feature | Status |\n| --- | --- |\n| Gyro | Active |" }),
    "TABLES"
  );

  // General generating phase once code block is closed
  assert.equal(
    indicator.detectCategory({ text: "Here is code:\n```python\nprint(1)\n```\nExplanation goes here." }),
    "GENERATING"
  );
});

test("VelaStreamingSpinner maps phases to static bespoke verbs", () => {
  const { indicator } = loadIndicatorInContext();

  assert.equal(indicator.STATIC_CATEGORY_VERBS.INCEPTION_DEFAULT, "Thinking…");
  assert.equal(indicator.STATIC_CATEGORY_VERBS.INCEPTION_REASONING, "Reasoning…");
  assert.equal(indicator.STATIC_CATEGORY_VERBS.INCEPTION_RESEARCH, "Investigating…");
  assert.equal(indicator.STATIC_CATEGORY_VERBS.INCEPTION_CODE, "Architecting…");
  assert.equal(indicator.STATIC_CATEGORY_VERBS.INCEPTION_WRITE, "Drafting…");
  assert.equal(indicator.STATIC_CATEGORY_VERBS.CODE, "Writing code…");
  assert.equal(indicator.STATIC_CATEGORY_VERBS.TABLES, "Structuring data…");
  assert.equal(indicator.STATIC_CATEGORY_VERBS.GENERATING, "Synthesizing…");
});

test("renderFlowingLetters builds cascading wave spans for each character", () => {
  const { indicator } = loadIndicatorInContext();
  const html = indicator.renderFlowingLetters("Writing code…");

  assert.match(html, /<span class="flowing-letter" style="--letter-idx:0">W<\/span>/);
  assert.match(html, /<span class="flowing-space">&nbsp;<\/span>/);
  assert.match(html, /<span class="flowing-letter" style="--letter-idx:12">…<\/span>/);
});

test("getSmartVerb returns static verbs for active phase", () => {
  const { indicator } = loadIndicatorInContext();
  const session = { category: null, verb: "" };

  const initialVerb = indicator.getSmartVerb({ text: "", taskMode: "chat" }, session);
  assert.equal(initialVerb, "Thinking…");

  const codeVerb = indicator.getSmartVerb({ text: "```typescript\ninterface Config {" }, session);
  assert.equal(codeVerb, "Writing code…");
  assert.equal(session.category, "CODE");
});

test("createIndicatorHTML produces bubble-free celestial gyroscope markup with flowing letters", () => {
  const { indicator } = loadIndicatorInContext();
  const html = indicator.createIndicatorHTML("Architecting…");

  assert.match(html, /class="streaming-cursor streaming-indicator"/);
  assert.match(html, /role="status"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /data-current-verb="Architecting…"/);
  assert.match(html, /<svg class="streaming-gyro-svg"/);
  assert.match(html, /class="gyro-outer-arc"/);
  assert.match(html, /class="gyro-inner-arc"/);
  assert.match(html, /class="gyro-core"/);
  assert.match(html, /class="flowing-letter"/);
  assert.match(html, /--letter-idx:0/);
});

test("attach mounts the indicator and preserves trailing DOM position", () => {
  const { indicator, mockDoc } = loadIndicatorInContext();
  const container = mockDoc.createElement("div");

  const attached = indicator.attach(container, { text: "", taskMode: "research" });
  assert.ok(attached);
  assert.equal(container.children.length, 1);
  assert.equal(container.children[0], attached);

  // Subsequent attach updates position if other content was added
  const paragraph = mockDoc.createElement("p");
  container.appendChild(paragraph);
  indicator.attach(container, { text: "Here is the response", taskMode: "research" });
  assert.equal(container.lastElementChild, attached, "Indicator should stay at the trailing edge");

  indicator.detach(container);
  assert.equal(container.children.length, 1);
  assert.equal(container.children[0], paragraph);
});
