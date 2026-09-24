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

test("VelaStreamingSpinner detects active code block categories and language nuances", () => {
  const { indicator } = loadIndicatorInContext();

  // Web stack code
  assert.equal(
    indicator.detectCategory({ text: "Here is the component:\n```tsx\nexport function Button() {" }),
    "CODE_WEB"
  );
  assert.equal(
    indicator.detectCategory({ text: "Here is the styles:\n```css\n.button { display: flex;" }),
    "CODE_WEB"
  );

  // Database / Data code
  assert.equal(
    indicator.detectCategory({ text: "Here is the migration:\n```sql\nSELECT * FROM users WHERE" }),
    "CODE_DATA"
  );

  // Systems code
  assert.equal(
    indicator.detectCategory({ text: "Here is the implementation:\n```rust\nfn main() {" }),
    "CODE_SYSTEMS"
  );

  // General code
  assert.equal(
    indicator.detectCategory({ text: "Here is the script:\n```python\ndef solve():" }),
    "CODE_DEFAULT"
  );

  // Closed code fence returns to narrative/prose
  assert.equal(
    indicator.detectCategory({ text: "Here is the script:\n```python\ndef solve(): pass\n```\nThis function finishes the task." }),
    "PROSE_EARLY"
  );
});

test("VelaStreamingSpinner detects markdown tables, lists, math and citations", () => {
  const { indicator } = loadIndicatorInContext();

  // Table
  assert.equal(
    indicator.detectCategory({ text: "Here is the breakdown:\n| Feature | Status | Priority |\n| --- | --- | --- |\n| Auth | Done | High |" }),
    "TABLES"
  );

  // List breakdown
  assert.equal(
    indicator.detectCategory({ text: "Please follow these steps:\n1. Open settings\n2. Configure API key\n3. Click save" }),
    "LISTS"
  );

  // Math formula
  assert.equal(
    indicator.detectCategory({ text: "The theorem states that:\n$$E = mc^2$$" }),
    "MATH"
  );

  // Citations / URLs
  assert.equal(
    indicator.detectCategory({ text: "According to recent studies [source: https://example.com/paper]:" }),
    "CITATIONS"
  );
});

test("VelaStreamingSpinner categorizes generative prose progression and closing", () => {
  const { indicator } = loadIndicatorInContext();

  // Early prose (< 350 chars)
  assert.equal(
    indicator.detectCategory({ text: "To understand this architecture, we begin with the fundamental design pattern." }),
    "PROSE_EARLY"
  );

  // Mid prose (350 - 1400 chars)
  const midText = "Detailed explanation paragraph here. ".repeat(20);
  assert.equal(indicator.detectCategory({ text: midText }), "PROSE_MID");

  // Late prose (> 1400 chars)
  const lateText = "Comprehensive analysis paragraph here. ".repeat(60);
  assert.equal(indicator.detectCategory({ text: lateText }), "PROSE_LATE");

  // Concluding keywords
  assert.equal(
    indicator.detectCategory({ text: "In conclusion, the system satisfies all operational requirements." }),
    "PROSE_CLOSING"
  );
});

test("getSmartVerb returns beautiful verbs and respects smart cadence", () => {
  const { indicator } = loadIndicatorInContext();
  const session = { lastSwitch: 0, category: null, verb: "" };

  const initialVerb = indicator.getSmartVerb({ text: "", taskMode: "chat" }, session);
  assert.ok(initialVerb.endsWith("…"), "Verb should end with an ellipsis");
  assert.ok(indicator.VERB_CATEGORIES.INCEPTION_DEFAULT.includes(initialVerb));

  // Urgent category switch (Inception -> Code) switches immediately regardless of dwell
  const codeVerb = indicator.getSmartVerb({ text: "```javascript\nconst a = 1;" }, session);
  assert.ok(indicator.VERB_CATEGORIES.CODE_WEB.includes(codeVerb));
  assert.equal(session.category, "CODE_WEB");

  // Subsequent call within dwell time maintains stable verb to prevent flicker
  const sameCodeVerb = indicator.getSmartVerb({ text: "```javascript\nconst a = 1;\nconst b = 2;" }, session);
  assert.equal(sameCodeVerb, codeVerb, "Verb should dwell without twitching");
});

test("createIndicatorHTML produces accessible, beautiful SVG spinner markup", () => {
  const { indicator } = loadIndicatorInContext();
  const html = indicator.createIndicatorHTML("Architecting…");

  assert.match(html, /class="streaming-cursor streaming-indicator"/);
  assert.match(html, /role="status"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /<svg class="streaming-spinner-svg"/);
  assert.match(html, /class="spinner-track"/);
  assert.match(html, /class="spinner-head"/);
  assert.match(html, /class="streaming-spinner-core"/);
  assert.match(html, /<span class="streaming-indicator-verb">Architecting…<\/span>/);
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
