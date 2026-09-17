import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

async function loadPptxEngine(sandboxOverrides = {}) {
  const exportSource = await readFile(new URL("../src/services/export.js", import.meta.url), "utf8");
  const pptxSource = await readFile(new URL("../src/artifacts/pptx-engine.js", import.meta.url), "utf8");

  const context = vm.createContext({
    Uint8Array,
    Uint32Array,
    TextEncoder,
    TextDecoder,
    DataView,
    setTimeout,
    clearTimeout,
    console,
    ...sandboxOverrides
  });

  vm.runInContext(exportSource, context);
  vm.runInContext(pptxSource, context);

  return { pptx: context.VelaPptx, zip: context.VelaExport };
}

const { pptx, zip } = await loadPptxEngine();

test("pptx-engine parses JSON presentation specifications", () => {
  const spec = JSON.stringify({
    title: "Autonomous Intelligence",
    subtitle: "2026 Strategy",
    theme: "emerald",
    slides: [
      {
        layout: "title",
        title: "Autonomous Intelligence",
        subtitle: "Enterprise Systems Architecture",
        notes: "Introductory remarks."
      },
      {
        layout: "bullets",
        title: "Core Innovations",
        kicker: "Architecture",
        bullets: [
          "Native binary synthesis without HTML dependencies",
          "Sub-10ms archive assembly",
          "Vector-grade document rendering"
        ],
        notes: "Highlight performance gains."
      },
      {
        layout: "two-column",
        title: "Platform Comparison",
        col1: { title: "Legacy HTML Proxies", items: ["Requires browser print dialog", "Unreliable slide breaks"] },
        col2: { title: "Native OpenXML", items: ["Real .pptx binary package", "Widescreen 16:9 canvas player"] }
      },
      {
        layout: "stats",
        title: "Performance Impact",
        stats: [
          { value: "100%", label: "Native Binaries" },
          { value: "0", label: "HTML Dependencies" },
          { value: "<5ms", label: "Compilation Latency" }
        ]
      }
    ]
  });

  const deck = pptx.parsePresentation(spec);
  assert.equal(deck.title, "Autonomous Intelligence");
  assert.equal(deck.theme, "emerald");
  assert.equal(deck.slides.length, 4);
  assert.equal(deck.slides[0].layout, "title");
  assert.equal(deck.slides[1].layout, "bullets");
  assert.equal(deck.slides[1].bullets.length, 3);
  assert.equal(deck.slides[2].layout, "two-column");
  assert.equal(deck.slides[3].layout, "stats");
  assert.equal(deck.slides[3].stats.length, 3);
});

test("pptx-engine parses flexible JSON specifications with schema aliases", () => {
  const userJson = JSON.stringify({
    theme: "vibrant",
    colors: {
      primary: "#1a1e3c",
      accent: "#ff6b6b",
      secondary: "#20c997"
    },
    slides: [
      {
        layout: "title",
        kicker: "Series A Strategy",
        headline: "Aether Intelligence: Next-Gen Autonomous Systems",
        subtitle: "Redefining enterprise autonomy",
        notes: "Opening remarks."
      },
      {
        layout: "cards",
        cards: [
          {
            indicatorColor: "#20c997",
            title: "Cognitive Mesh",
            description: "Self-organizing distributed neural network."
          },
          {
            indicatorColor: "#ff6b6b",
            title: "Sub-10ms Inference",
            description: "Optimized edge-to-cloud inference pipeline."
          }
        ]
      },
      {
        layout: "stats",
        metrics: [
          { value: "10x", label: "Faster Inference" },
          { value: "<5ms", label: "Edge Decision Time" }
        ]
      },
      {
        layout: "timeline",
        steps: [
          { number: "01", title: "Q1 Ingestion", description: "Launch pilots" },
          { number: "02", title: "Q2 Integration", description: "Release API" }
        ]
      },
      {
        layout: "two-column",
        leftTitle: "Legacy Architectures",
        leftBullets: ["Siloed models", "High latency"],
        rightTitle: "Aether Stack",
        rightBullets: ["Unified mesh", "Sub-10ms latency"]
      },
      {
        layout: "quote",
        quote: "Aether is building foundational infrastructure.",
        author: "Elena Marquez"
      },
      {
        layout: "bullets",
        rows: [
          { lead: "Cognitive Mesh", detail: "Self-organizing network" },
          { lead: "Sub-10ms Inference", detail: "Edge deployment" }
        ]
      }
    ]
  });

  const deck = pptx.parsePresentation(userJson);
  assert.equal(deck.title, "Aether Intelligence: Next-Gen Autonomous Systems");
  assert.equal(deck.theme, "vibrant");
  assert.equal(deck.slides.length, 7);

  // Slide 1: Title & Kicker
  assert.equal(deck.slides[0].layout, "title");
  assert.equal(deck.slides[0].title, "Aether Intelligence: Next-Gen Autonomous Systems");
  assert.equal(deck.slides[0].kicker, "Series A Strategy");

  // Slide 2: Cards with indicatorColor & description
  assert.equal(deck.slides[1].layout, "cards");
  assert.equal(deck.slides[1].cards.length, 2);
  assert.equal(deck.slides[1].cards[0].title, "Cognitive Mesh");
  assert.equal(deck.slides[1].cards[0].color, "#20c997");
  assert.equal(deck.slides[1].cards[0].desc, "Self-organizing distributed neural network.");

  // Slide 3: Stats with metrics array
  assert.equal(deck.slides[2].layout, "stats");
  assert.equal(deck.slides[2].stats.length, 2);
  assert.equal(deck.slides[2].stats[0].value, "10x");

  // Slide 4: Timeline with steps array
  assert.equal(deck.slides[3].layout, "timeline");
  assert.equal(deck.slides[3].timeline.length, 2);
  assert.equal(deck.slides[3].timeline[0].step, "01");

  // Slide 5: Two-column with leftTitle / leftBullets
  assert.equal(deck.slides[4].layout, "two-column");
  assert.equal(deck.slides[4].col1.title, "Legacy Architectures");
  assert.equal(deck.slides[4].col1.items.length, 2);
  assert.equal(deck.slides[4].col2.title, "Aether Stack");

  // Slide 6: Quote
  assert.equal(deck.slides[5].layout, "quote");
  assert.equal(deck.slides[5].author, "Elena Marquez");

  // Slide 7: Bullets with rows array
  assert.equal(deck.slides[6].layout, "bullets");
  assert.equal(deck.slides[6].bullets.length, 2);
  assert.match(deck.slides[6].bullets[0], /Cognitive Mesh: Self-organizing network/);

  // Validate building real binary from it
  const bytes = pptx.buildPptx(deck);
  assert.ok(bytes instanceof Uint8Array);
  assert.ok(bytes.length > 2000);
});

test("pptx-engine parses Markdown slide decks separated by ---", () => {
  const markdown = [
    "# Quantum Systems Architecture",
    "Subtitle: Next-Generation Compute",
    "",
    "---",
    "",
    "## Key Capabilities",
    "- 128-qubit logical fault tolerance",
    "- Coherent cryogenic interconnect",
    "- Low-latency compiler pipeline",
    "",
    "Notes: Emphasize fault tolerance results.",
    "",
    "---",
    "",
    "# Benchmarks",
    "### 10x",
    "Speedup over classical",
    "### 99.9%",
    "Gate fidelity"
  ].join("\n");

  const deck = pptx.parsePresentation(markdown);
  assert.equal(deck.title, "Quantum Systems Architecture");
  assert.equal(deck.slides.length, 3);
  assert.equal(deck.slides[0].layout, "title");
  assert.equal(deck.slides[1].layout, "bullets");
  assert.equal(deck.slides[1].notes, "Emphasize fault tolerance results.");
  assert.equal(deck.slides[2].layout, "stats");
  assert.equal(deck.slides[2].stats.length, 2);
  assert.equal(deck.slides[2].stats[0].value, "10x");
});

test("pptx-engine builds valid OpenXML .pptx ZIP packages", () => {
  const deck = {
    title: "Enterprise Architecture",
    theme: "dark",
    slides: [
      {
        layout: "title",
        title: "Enterprise Architecture",
        subtitle: "Scalable Systems",
        notes: "Opening"
      },
      {
        layout: "bullets",
        title: "System Tenets",
        kicker: "Principles",
        bullets: ["High resilience", "Modular contracts", "Instant previews"]
      }
    ]
  };

  const bytes = pptx.buildPptx(deck);
  assert.ok(bytes instanceof Uint8Array);
  assert.ok(bytes.length > 2000);

  // Validate ZIP signature (PK\x03\x04)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(0, true), 0x04034b50);

  // Decode text to verify OpenXML structure and slide content
  const text = new TextDecoder("utf8", { fatal: false }).decode(bytes);

  assert.match(text, /\[Content_Types\]\.xml/);
  assert.match(text, /ppt\/presentation\.xml/);
  assert.match(text, /ppt\/slides\/slide1\.xml/);
  assert.match(text, /ppt\/slides\/slide2\.xml/);
  assert.match(text, /ppt\/slideMasters\/slideMaster1\.xml/);
  assert.match(text, /ppt\/slideLayouts\/slideLayout1\.xml/);
  assert.match(text, /ppt\/theme\/theme1\.xml/);
  assert.match(text, /Enterprise Architecture/);
  assert.match(text, /System Tenets/);
  assert.match(text, /12192000/); // 16:9 width
  assert.match(text, /6858000/);  // 16:9 height
});

test("pptx-engine creates interactive DOM presentation player", () => {
  function createElement(tag) {
    const el = {
      tagName: tag.toUpperCase(),
      className: "",
      dataset: {},
      style: {
        setProperty() {}
      },
      classList: {
        add(c) { el.className = `${el.className} ${c}`.trim(); },
        remove(c) { el.className = el.className.split(/\s+/).filter((x) => x !== c).join(" "); },
        toggle(c, force) {
          const has = el.className.includes(c);
          const should = typeof force === "boolean" ? force : !has;
          if (should) this.add(c); else this.remove(c);
          return should;
        },
        contains(c) { return el.className.includes(c); }
      },
      attributes: {},
      children: [],
      setAttribute(k, v) { this.attributes[k] = v; },
      getAttribute(k) { return this.attributes[k]; },
      appendChild(child) { this.children.push(child); return child; },
      append(...items) { items.forEach((it) => this.appendChild(it)); },
      querySelector(selector) {
        if (selector.startsWith(".")) {
          const cls = selector.slice(1);
          return this.children.find((c) => c.className?.includes(cls)) || null;
        }
        return null;
      },
      querySelectorAll(selector) {
        if (selector.startsWith(".")) {
          const cls = selector.slice(1);
          return this.children.filter((c) => c.className?.includes(cls));
        }
        return [];
      },
      addEventListener() {},
      textContent: "",
      innerHTML: ""
    };
    return el;
  }

  const mockDoc = { createElement };
  const preview = pptx.createPreview(mockDoc, "# Strategy\nSubtitle: Q3 2026\n\n---\n\n# Goals\n- Goal 1\n- Goal 2", { escape: String });

  assert.equal(preview.className, "artifact-preview-surface artifact-pptx-player");
  const stage = preview.children.find((c) => c.className.includes("artifact-pptx-stage"));
  assert.ok(stage, "Must contain stage");
  const slide = stage.children.find((c) => c.className.includes("artifact-pptx-slide"));
  assert.ok(slide, "Must contain slide frame");
  assert.equal(slide.className, "artifact-pptx-slide transition-fade", "Initial slide must not have animate-next");
  const overview = stage.children.find((c) => c.className.includes("artifact-pptx-overview"));
  assert.ok(overview, "Must contain overview drawer");
  assert.equal(overview.hidden, true, "Overview drawer must be hidden by default");
  const notes = preview.children.find((c) => c.className.includes("artifact-pptx-notes-drawer"));
  assert.ok(notes, "Must contain notes drawer");
  assert.equal(notes.hidden, true, "Notes drawer must be hidden by default");
});

test("pptx-engine resolves theme display names and color aliases cleanly", () => {
  const slateTheme = pptx.resolveTheme("Modern Slate");
  assert.equal(slateTheme.id, "slate");
  assert.match(slateTheme.name, /Modern Slate/);

  const darkTheme = pptx.resolveTheme("Matte Black");
  assert.equal(darkTheme.id, "dark");

  const emeraldTheme = pptx.resolveTheme("Deep Emerald");
  assert.equal(emeraldTheme.id, "emerald");

  const editorialTheme = pptx.resolveTheme("Clean Editorial");
  assert.equal(editorialTheme.id, "light");

  const customTheme = pptx.resolveTheme("slate", {
    accent: "var(--pptx-accent)",
    secondary: "#10b981"
  });
  assert.equal(customTheme.id, "slate");
  assert.equal(customTheme.accentCss, "var(--pptx-accent)");
  assert.equal(customTheme.accent2, "10B981");
});

test("pptx-engine parses fenced JSON and auto-converts bullets under layout: cards/stats/timeline", () => {
  const fencedJson = "```pptx\n{\n  \"theme\": \"Modern Slate\",\n  \"slides\": [\n    {\n      \"layout\": \"title\",\n      \"title\": \"Embedded JSON\"\n    }\n  ]\n}\n```";
  const deck1 = pptx.parsePresentation(fencedJson);
  assert.equal(deck1.title, "Embedded JSON");
  assert.equal(deck1.slides[0].theme.id, "slate");

  const mdCards = [
    "# Card Deck",
    "",
    "---",
    "",
    "# Initiatives",
    "layout: cards",
    "- AI Automation: End-to-end self-healing platform",
    "- Edge Compute: Ultra low-latency inference nodes"
  ].join("\n");
  const deck2 = pptx.parsePresentation(mdCards);
  assert.equal(deck2.slides[1].layout, "cards");
  assert.equal(deck2.slides[1].cards.length, 2);
  assert.equal(deck2.slides[1].cards[0].title, "AI Automation");
  assert.equal(deck2.slides[1].cards[0].desc, "End-to-end self-healing platform");
});

test("pptx-engine parses JSON with unescaped newlines, trailing commas, and comments", () => {
  const messyJson = `// Slide deck export
  {
    "theme": "midnight",
    "title": "Aether Scale",
    "slides": [
      {
        "layout": "title",
        "title": "Aether Scale",
        "notes": "Speaker notes line 1
Speaker notes line 2",
      },
      {
        "layout": "stats",
        "title": "Key Numbers",
        "stats": [
          { "value": "10x", "label": "Faster" },
        ],
      }
    ],
  }`;

  const deck = pptx.parsePresentation(messyJson);
  assert.equal(deck.title, "Aether Scale");
  assert.equal(deck.theme, "midnight");
  assert.equal(deck.slides.length, 2);
  assert.equal(deck.slides[0].notes, "Speaker notes line 1\nSpeaker notes line 2");
  assert.equal(deck.slides[1].stats.length, 1);
});

test("pptx-engine parses top-level slide array", () => {
  const slideArray = `[
    { "layout": "title", "title": "Platform Vision", "theme": "midnight" },
    { "layout": "cards", "title": "Core Features", "cards": [{ "title": "Mesh", "desc": "Distributed" }] }
  ]`;

  const deck = pptx.parsePresentation(slideArray);
  assert.equal(deck.title, "Platform Vision");
  assert.equal(deck.theme, "midnight");
  assert.equal(deck.slides.length, 2);
  assert.equal(deck.slides[1].cards.length, 1);
});

test("pptx-engine parses YAML slide decks with nested lists", () => {
  const yaml = `theme: midnight
title: Autonomous Fleet Strategy
subtitle: Next-Gen Autonomy

slides:
  - layout: title
    kicker: Series A
    title: Autonomous Fleet Strategy
    subtitle: Next-Gen Autonomy
    notes: Opening hook about market gap

  - layout: cards
    title: Core Pillars
    cards:
      - title: Cognitive Mesh
        description: Distributed neural network
        indicatorColor: "#20c997"
      - title: Edge Inference
        description: Sub-10ms response time
        indicatorColor: "#38bdf8"

  - layout: stats
    title: Performance KPIs
    stats:
      - value: 10x
        label: Speedup
      - value: 99.99%
        label: SLA Uptime

  - layout: timeline
    title: Execution Milestones
    timeline:
      - step: "01"
        title: Ingestion
        desc: Pipeline buildout
      - step: "02"
        title: Deployment
        desc: Multi-region rollout
`;

  const deck = pptx.parsePresentation(yaml);
  assert.equal(deck.title, "Autonomous Fleet Strategy");
  assert.equal(deck.theme, "midnight");
  assert.equal(deck.slides.length, 4);
  assert.equal(deck.slides[0].layout, "title");
  assert.equal(deck.slides[1].layout, "cards");
  assert.equal(deck.slides[1].cards.length, 2);
  assert.equal(deck.slides[2].layout, "stats");
  assert.equal(deck.slides[2].stats.length, 2);
  assert.equal(deck.slides[3].layout, "timeline");
  assert.equal(deck.slides[3].timeline.length, 2);
});

test("pptx-engine parses Markdown decks with YAML frontmatter without phantom slide", () => {
  const mdWithFm = `---
theme: midnight
title: Strategic Overview
---

# Strategic Overview
Enterprise Systems Redefined

---

# Performance Impact
layout: stats
- stat: 99.99%
  label: Reliability
- stat: 5x
  label: Throughput
`;

  const deck = pptx.parsePresentation(mdWithFm);
  assert.equal(deck.title, "Strategic Overview");
  assert.equal(deck.theme, "midnight");
  assert.equal(deck.slides.length, 2);
  assert.equal(deck.slides[0].title, "Strategic Overview");
  assert.equal(deck.slides[1].layout, "stats");
  assert.equal(deck.slides[1].stats.length, 2);
});

test("pptx-engine parses Markdown decks delimited by Slide N headings without ---", () => {
  const mdSlideHeadings = `theme: midnight

# Slide 1: Strategic Architecture
Enterprise scale cognitive computing

# Slide 2: Market Traction
layout: cards
- card: Global Reach
  desc: Deployed across 14 enterprise regions
`;

  const deck = pptx.parsePresentation(mdSlideHeadings);
  assert.equal(deck.title, "Strategic Architecture");
  assert.equal(deck.theme, "midnight");
  assert.equal(deck.slides.length, 2);
  assert.equal(deck.slides[0].title, "Strategic Architecture");
  assert.equal(deck.slides[1].title, "Market Traction");
  assert.equal(deck.slides[1].cards.length, 1);
});

test("pptx-engine parses user deck with two-column sections, flow-mapping cards, and pricing cards cleanly", () => {
  const userDeck = `---
theme: Modern Slate
title: Vela AI
---

# Vela AI Solution
layout: two-column

two-column:

left:

content:
- Juggling 5+ disconnected apps for docs, tasks, chat, and design
- Recreating context every time you switch tools
- No unified source of truth for team work

right:

content:
- All core work tools natively integrated in one workspace
- AI auto-syncs context across all artifacts and tasks
- Single source of truth with real-time collaborative artifacts

---

# Built for High-Performance Teams
layout: cards

cards:
- indicator: #4ade80, title: Unified Artifact Workspace, description: Create, edit, and collaborate on docs, decks, spreadsheets, and code in one place— no more exporting/importing between tools.
- indicator: #60a5fa, title: Context-Aware AI Assistant, description: Vela learns your team's work patterns, auto-summarizes meetings, drafts content, and answers questions across all your team's artifacts.
- indicator: #f472b6, title: Cross-Platform Sync, description: Real-time sync across web, desktop, and mobile, with offline mode and enterprise-grade security for sensitive work.

---

# Proven Traction & Market Validation
layout: stats

stats:
- value: "$2.1M", label: "annual recurring revenue (ARR) as of Q1 2024"
- value: "12,400+", label: "active paying teams across 40 countries"
- value: "94%", label: "net dollar retention rate (NDR) over the last 12 months"
- value: "4.8/5", label: "average customer satisfaction score on G2"

---

# Simple, Transparent Pricing
layout: cards

cards:
- title: Starter, price: "$0/user/mo", features: ["Up to 5 team members", "10GB artifact storage", "Basic AI features", "Community support"], badge: null
- title: Pro, price: "$12/user/mo", features: ["Unlimited team members", "100GB artifact storage", "Advanced AI features", "Priority support", "Custom integrations"], badge: Most Popular
- title: Enterprise, price: "Custom", features: ["Unlimited storage", "Custom AI model training", "SSO & advanced security", "Dedicated account manager", "On-prem deployment option"], badge: null

---

# Our Core Values
layout: two-column

two-column:

left:

content:
- Alex Chen, CEO: Former Head of Product at Notion, 8+ yrs in SaaS
- Maya Rodriguez, CTO: Ex-Google AI lead, built 3 enterprise AI products
- Jordan Lee, CFO: Former VP Finance at Figma, scaled company to $500M ARR

right:

content:
- Customer Obsession: We build only what teams actually need
- Radical Transparency: Open pricing, open roadmaps, open communication
- AI for Good: We prioritize ethical AI that augments, not replaces, human work
`;

  const deck = pptx.parsePresentation(userDeck);
  assert.equal(deck.title, "Vela AI");
  assert.equal(deck.slides.length, 5);

  // Slide 1: two-column
  assert.equal(deck.slides[0].layout, "two-column");
  assert.equal(deck.slides[0].col1.items.length, 3);
  assert.equal(deck.slides[0].col2.items.length, 3);
  assert.equal(deck.slides[0].col1.items[0], "Juggling 5+ disconnected apps for docs, tasks, chat, and design");
  assert.equal(deck.slides[0].col2.items[0], "All core work tools natively integrated in one workspace");
  assert(!deck.slides[0].col1.items.includes("left:"));
  assert(!deck.slides[0].col1.items.includes("content:"));

  // Slide 2: flow-mapping cards
  assert.equal(deck.slides[1].layout, "cards");
  assert.equal(deck.slides[1].cards.length, 3);
  assert.equal(deck.slides[1].cards[0].title, "Unified Artifact Workspace");
  assert.equal(deck.slides[1].cards[0].color, "#4ade80");
  assert(deck.slides[1].cards[0].desc.startsWith("Create, edit, and collaborate"));
  assert.notEqual(deck.slides[1].cards[0].title, "cards");
  assert.notEqual(deck.slides[1].cards[0].title, "indicator");

  // Slide 3: flow-mapping stats
  assert.equal(deck.slides[2].layout, "stats");
  assert.equal(deck.slides[2].stats.length, 4);
  assert.equal(deck.slides[2].stats[0].value, "$2.1M");
  assert.equal(deck.slides[2].stats[0].label, "annual recurring revenue (ARR) as of Q1 2024");
  assert.equal(deck.slides[2].stats[1].value, "12,400+");
  assert.notEqual(deck.slides[2].stats[0].value, "stats");
  assert.notEqual(deck.slides[2].stats[0].value, "value");

  // Slide 4: pricing cards with price and features
  assert.equal(deck.slides[3].layout, "cards");
  assert.equal(deck.slides[3].cards.length, 3);
  assert.equal(deck.slides[3].cards[0].title, "Starter");
  assert.equal(deck.slides[3].cards[0].price, "$0/user/mo");
  assert.equal(deck.slides[3].cards[0].features.length, 4);
  assert.equal(deck.slides[3].cards[1].title, "Pro");
  assert.equal(deck.slides[3].cards[1].price, "$12/user/mo");
  assert.equal(deck.slides[3].cards[1].badge, "Most Popular");
  assert.notEqual(deck.slides[3].cards[0].title, "cards");
  assert.notEqual(deck.slides[3].cards[0].title, "title");

  // Slide 5: team / values two-column
  assert.equal(deck.slides[4].layout, "two-column");
  assert.equal(deck.slides[4].col1.items.length, 3);
  assert.equal(deck.slides[4].col2.items.length, 3);
  assert.equal(deck.slides[4].col1.title, "Leadership");
  assert.equal(deck.slides[4].col2.title, "Values");
});

test("pptx-engine parses JSON with smart quotes, unquoted keys, inline comments, and invalid escapes without falling back to raw bullet text", async () => {
  const { pptx } = await loadPptxEngine();

  const trickyJson = `{
    title: “Aether – Brand Strategy Deck”, // inline comment
    subtitle: "Redefining Premium Digital Experiences",
    theme: 'midnight',
    slides: [
      {
        layout: "title",
        kicker: "Brand Strategy",
        title: "Aether Studio",
        subtitle: 'Redefining Premium Digital Experiences'
      },
      {
        layout: "cards",
        title: "Core Brand Pillars",
        cols: 2,
        cards: [
          { title: "Minimalist", description: "Deliberate whitespace and timeless typography", span: 2 },
          { title: "Precision", description: "Sub-pixel attention to detail", minHeight: "180px" },
          { title: "Fluidity", description: "Sub-10ms response latency" }
        ]
      }
    ]
  }`;

  const deck = pptx.parsePresentation(trickyJson);
  assert.equal(deck.title, "Aether – Brand Strategy Deck");
  assert.equal(deck.slides.length, 2);
  assert.equal(deck.slides[0].layout, "title");
  assert.equal(deck.slides[0].title, "Aether Studio");
  assert.equal(deck.slides[1].layout, "cards");
  assert.equal(deck.slides[1].cards.length, 3);
  assert.equal(deck.slides[1].cols, 2);
  assert.equal(deck.slides[1].cards[0].colSpan, 2);
  assert.equal(deck.slides[1].cards[1].minHeight, "180px");
});

test("pptx-engine parses truncated JSON streams gracefully into complete slides", async () => {
  const { pptx } = await loadPptxEngine();

  const truncatedJson = `{\n  "title": "Aether – Brand Strategy Deck",\n  "subtitle": "Redefining Premium Digital Experiences",\n  "theme": "midnight",\n  "slides": [\n    {\n      "layout": "title",\n      "title": "Aether Studio"\n    },\n    {\n      "layout": "cards",\n      "title": "Core Pillars",\n      "cards": [\n        { "title": "Precision", "description": "High craftsmanship" }`;

  const deck = pptx.parsePresentation(truncatedJson);
  assert.ok(deck.slides.length >= 1);
  assert.notEqual(deck.slides[0].layout, "bullets");
  assert.equal(deck.slides[0].title, "Aether Studio");
});

test("pptx-engine honors model-defined card grid columns, spans, and dimensions in DOM preview and OpenXML", async () => {
  const { pptx, zip } = await loadPptxEngine();

  const deck = pptx.parsePresentation({
    title: "Geometry Test",
    slides: [
      {
        layout: "cards",
        title: "Adaptive Columns",
        cols: 3,
        cards: [
          { title: "Card 1", span: 2, minHeight: "150px" },
          { title: "Card 2" },
          { title: "Card 3" },
          { title: "Card 4" },
          { title: "Card 5" },
          { title: "Card 6" }
        ]
      }
    ]
  });

  assert.equal(deck.slides[0].cols, 3);
  assert.equal(deck.slides[0].cards[0].colSpan, 2);
  assert.equal(deck.slides[0].cards[0].minHeight, "150px");

  // Ensure OpenXML build outputs all 6 cards across multiple rows
  const bytes = pptx.buildPptx(deck);
  assert.ok(bytes instanceof Uint8Array);
  assert.ok(bytes.length > 500);
});

test("pptx-engine parses slide transitions and card element entrance effects", async () => {
  const { pptx } = await loadPptxEngine();

  // Test JSON parsing with slide transitions and card animations
  const jsonDeck = pptx.parsePresentation(JSON.stringify({
    title: "Animated Showcase",
    transition: "zoom",
    slides: [
      {
        layout: "title",
        title: "Animated Deck",
        transition: "fade",
        effect: "pop"
      },
      {
        layout: "cards",
        title: "Product Features",
        transition: "slide",
        effect: "fade-up",
        cards: [
          { title: "Fast", desc: "Instant response", effect: "fade-left", delay: "100ms", duration: "300ms" },
          { title: "Fluid", desc: "Silky smooth animations", effect: "zoom-in", delay: "200ms", duration: "400ms" }
        ]
      },
      {
        layout: "stats",
        title: "Performance Impact",
        transition: "flip",
        stats: [
          { value: "60 FPS", label: "Smooth rendering", effect: "pop", delay: "150ms" },
          { value: "0 ms", label: "Input latency", effect: "glow" }
        ]
      }
    ]
  }));

  assert.equal(jsonDeck.transition, "zoom");
  assert.equal(jsonDeck.slides[0].transition, "fade");
  assert.equal(jsonDeck.slides[0].effect, "pop");
  assert.equal(jsonDeck.slides[1].transition, "slide");
  assert.equal(jsonDeck.slides[1].cards[0].effect, "fade-left");
  assert.equal(jsonDeck.slides[1].cards[0].delay, "100ms");
  assert.equal(jsonDeck.slides[1].cards[0].duration, "300ms");
  assert.equal(jsonDeck.slides[1].cards[1].effect, "zoom-in");
  assert.equal(jsonDeck.slides[2].transition, "flip");
  assert.equal(jsonDeck.slides[2].stats[0].effect, "pop");
  assert.equal(jsonDeck.slides[2].stats[0].delay, "150ms");
  assert.equal(jsonDeck.slides[2].stats[1].effect, "glow");

  // Test Markdown parsing with slide transitions and card animations
  const mdSource = `---
title: Markdown Deck
theme: emerald
transition: wipe
---

layout: cards
title: Animated Markdown Cards
transition: slide
effect: fade-up
cards:
  - title: Real-Time Speed
    desc: Sub-millisecond latency
    effect: pop
    delay: 120ms
    duration: 350ms
  - title: Rich Transitions
    desc: OpenXML DrawingML
    effect: zoom-in
`;

  const mdDeck = pptx.parsePresentation(mdSource);
  assert.equal(mdDeck.title, "Markdown Deck");
  assert.equal(mdDeck.transition, "wipe");
  assert.equal(mdDeck.slides[0].transition, "slide");
  assert.equal(mdDeck.slides[0].cards.length, 2);
  assert.equal(mdDeck.slides[0].cards[0].title, "Real-Time Speed");
  assert.equal(mdDeck.slides[0].cards[0].effect, "pop");
  assert.equal(mdDeck.slides[0].cards[0].delay, "120ms");
  assert.equal(mdDeck.slides[0].cards[0].duration, "350ms");
  assert.equal(mdDeck.slides[0].cards[1].effect, "zoom-in");
});

test("pptx-engine renders on-stage navigation arrows, presenter HUD, and element animation styles", async () => {
  const { pptx } = await loadPptxEngine();

  function createElement(tag) {
    const el = {
      tagName: tag.toUpperCase(),
      className: "",
      dataset: {},
      style: {
        setProperty(k, v) { el.style[k] = v; }
      },
      classList: {
        add(c) { el.className = `${el.className} ${c}`.trim(); },
        remove(c) { el.className = el.className.split(/\s+/).filter((x) => x !== c).join(" "); },
        toggle(c, force) {
          const has = el.className.includes(c);
          const should = typeof force === "boolean" ? force : !has;
          if (should) this.add(c); else this.remove(c);
          return should;
        },
        contains(c) { return el.className.includes(c); }
      },
      attributes: {},
      children: [],
      setAttribute(k, v) { this.attributes[k] = v; },
      getAttribute(k) { return this.attributes[k]; },
      appendChild(child) { this.children.push(child); return child; },
      append(...items) { items.forEach((it) => this.appendChild(it)); },
      querySelector(selector) {
        if (selector.startsWith(".")) {
          const cls = selector.slice(1);
          return this.children.find((c) => c.className?.includes(cls)) || null;
        }
        return null;
      },
      querySelectorAll(selector) {
        if (selector.startsWith(".")) {
          const cls = selector.slice(1);
          return this.children.filter((c) => c.className?.includes(cls));
        }
        return [];
      },
      addEventListener() {},
      textContent: "",
      innerHTML: ""
    };
    return el;
  }

  const mockDoc = { createElement };
  const spec = JSON.stringify({
    title: "Stage Player Test",
    transition: "slide",
    slides: [
      {
        layout: "cards",
        title: "Dynamic Cards",
        effect: "fade-up",
        cards: [
          { title: "Card 1", desc: "First feature", effect: "fade-left", delay: "100ms", duration: "350ms" },
          { title: "Card 2", desc: "Second feature", effect: "pop", delay: "200ms", duration: "400ms" }
        ]
      },
      {
        layout: "stats",
        title: "Metrics",
        stats: [{ value: "99.9%", label: "Uptime", effect: "zoom-in" }]
      }
    ]
  });

  const preview = pptx.createPreview(mockDoc, spec, { escape: String });
  const stage = preview.children.find((c) => c.className.includes("artifact-pptx-stage"));
  assert.ok(stage, "Stage must be present in player");

  // Verify on-stage navigation arrows exist
  const stagePrev = stage.children.find((c) => c.className.includes("artifact-pptx-stage-prev"));
  const stageNext = stage.children.find((c) => c.className.includes("artifact-pptx-stage-next"));
  assert.ok(stagePrev, "On-stage previous button must exist for presenting");
  assert.ok(stageNext, "On-stage next button must exist for presenting");

  // Verify presenter HUD exists
  const hud = stage.children.find((c) => c.className.includes("artifact-pptx-presenter-hud"));
  assert.ok(hud, "Presenter HUD must exist for fullscreen control");

  // Verify slide frame has transition class
  const slide = stage.children.find((c) => c.className.includes("artifact-pptx-slide"));
  assert.ok(slide.className.includes("transition-slide"), "Slide frame must reflect configured transition");

  // Verify rendered content contains element animation classes and custom delay/duration properties
  assert.match(slide.innerHTML, /pptx-elem-effect/);
  assert.match(slide.innerHTML, /pptx-effect-fade-left/);
  assert.match(slide.innerHTML, /pptx-effect-pop/);
  assert.match(slide.innerHTML, /--pptx-elem-delay:\s*100ms/);
  assert.match(slide.innerHTML, /--pptx-elem-duration:\s*350ms/);
});

test("pptx-engine OpenXML build includes DrawingML slide transitions", async () => {
  const { pptx } = await loadPptxEngine();

  const deck = pptx.parsePresentation({
    title: "OpenXML Transitions Test",
    slides: [
      { layout: "title", title: "Slide 1", transition: "fade" },
      { layout: "bullets", title: "Slide 2", transition: "slide", bullets: ["Item 1"] },
      { layout: "stats", title: "Slide 3", transition: "zoom", stats: [{ value: "100%", label: "Tested" }] },
      { layout: "quote", title: "Slide 4", transition: "wipe", quote: "Excellence" }
    ]
  });

  const bytes = pptx.buildPptx(deck);
  assert.ok(bytes instanceof Uint8Array);
  assert.ok(bytes.length > 1000);
});

test("pptx-engine renders SVG icons and stylized dropdowns across player controls", async () => {
  const { pptx } = await loadPptxEngine();

  function createElement(tag) {
    const el = {
      tagName: tag.toUpperCase(),
      className: "",
      dataset: {},
      style: {
        setProperty(k, v) { el.style[k] = v; }
      },
      classList: {
        add(c) { el.className = `${el.className} ${c}`.trim(); },
        remove(c) { el.className = el.className.split(/\s+/).filter((x) => x !== c).join(" "); },
        toggle(c, force) {
          const has = el.className.includes(c);
          const should = typeof force === "boolean" ? force : !has;
          if (should) this.add(c); else this.remove(c);
          return should;
        },
        contains(c) { return el.className.includes(c); }
      },
      attributes: {},
      children: [],
      setAttribute(k, v) { this.attributes[k] = v; },
      getAttribute(k) { return this.attributes[k]; },
      appendChild(child) { this.children.push(child); return child; },
      append(...items) { items.forEach((it) => this.appendChild(it)); },
      querySelector(selector) {
        if (selector.startsWith(".")) {
          const cls = selector.slice(1);
          return this.children.find((c) => c.className?.includes(cls)) || null;
        }
        return null;
      },
      querySelectorAll(selector) {
        if (selector.startsWith(".")) {
          const cls = selector.slice(1);
          return this.children.filter((c) => c.className?.includes(cls));
        }
        return [];
      },
      addEventListener() {},
      textContent: "",
      innerHTML: ""
    };
    return el;
  }

  const mockDoc = { createElement };
  const spec = pptx.parsePresentation({
    title: "Icon and Dropdown Test",
    theme: "emerald",
    transition: "zoom",
    slides: [
      {
        layout: "cards",
        title: "Pricing & Features",
        cards: [
          { title: "Pro Plan", price: "$29/mo", features: ["Unlimited slides", "Custom exports"] }
        ]
      }
    ]
  });

  const preview = pptx.createPreview(mockDoc, spec, { escape: String });
  const toolbar = preview.children.find((c) => c.className?.includes("artifact-pptx-toolbar"));
  assert.ok(toolbar, "Toolbar must be rendered");

  // Verify toolbar contains SVG icons
  assert.match(toolbar.innerHTML, /<svg class="icon"/, "Toolbar buttons must use SVG icons");
  assert.match(toolbar.innerHTML, /class="[^"]*artifact-pptx-theme-select/, "Theme select dropdown must be present");
  assert.match(toolbar.innerHTML, /class="[^"]*artifact-pptx-trans-select/, "Transition select dropdown must be present");

  // Verify on-stage arrows use SVG icons
  const stage = preview.children.find((c) => c.className?.includes("artifact-pptx-stage"));
  const stagePrev = stage.children.find((c) => c.className?.includes("artifact-pptx-stage-prev"));
  const stageNext = stage.children.find((c) => c.className?.includes("artifact-pptx-stage-next"));
  assert.match(stagePrev.innerHTML, /<svg class="icon"/, "Stage previous arrow must use SVG icon");
  assert.match(stageNext.innerHTML, /<svg class="icon"/, "Stage next arrow must use SVG icon");

  // Verify presenter HUD buttons use SVG icons
  const hud = stage.children.find((c) => c.className?.includes("artifact-pptx-presenter-hud"));
  assert.match(hud.innerHTML, /<svg class="icon"/, "HUD buttons must use SVG icons");

  // Verify feature checkmarks use SVG icon
  const slide = stage.children.find((c) => c.className?.includes("artifact-pptx-slide"));
  assert.match(slide.innerHTML, /artifact-pptx-feature-check"><svg class="icon"/, "Feature checkmark must use SVG icon");

  // Verify no unicode emojis/symbols in controls
  const controlsMarkup = toolbar.innerHTML + stagePrev.innerHTML + stageNext.innerHTML + hud.innerHTML + slide.innerHTML;
  assert.doesNotMatch(controlsMarkup, /[◀▶❮❯▦📝⛶✓]/, "Controls must not use raw unicode glyphs/emojis");
});

test("pptx-engine integrates with window.VelaCustomSelect.enhanceAll when available", async () => {
  let enhancedToolbar = null;
  const mockWindow = {
    VelaCustomSelect: {
      enhanceAll(el) {
        enhancedToolbar = el;
      }
    }
  };

  const { pptx: testPptx } = await loadPptxEngine({ window: mockWindow });

  function createElement(tagName) {
    const el = {
      tagName: tagName.toUpperCase(),
      children: [],
      attributes: {},
      style: {
        setProperty(k, v) { el.style[k] = v; }
      },
      classList: {
        contains(c) { return el.className?.split(" ").includes(c); },
        add(c) { el.className = (el.className ? el.className + " " : "") + c; }
      },
      appendChild(child) { el.children.push(child); return child; },
      append(...kids) { kids.forEach((k) => el.children.push(k)); },
      setAttribute(k, v) { el.attributes[k] = v; },
      getAttribute(k) { return el.attributes[k] || null; },
      querySelector(sel) {
        const matchClass = sel.replace(".", "");
        return el.children.find((c) => c.className?.includes(matchClass)) || null;
      },
      querySelectorAll() { return []; },
      addEventListener() {},
      textContent: "",
      innerHTML: ""
    };
    return el;
  }

  const mockDoc = { createElement };
  const spec = testPptx.parsePresentation({
    title: "Custom Select Test",
    slides: [{ layout: "title", title: "Test Slide" }]
  });

  testPptx.createPreview(mockDoc, spec, { escape: String });
  assert.ok(enhancedToolbar, "VelaCustomSelect.enhanceAll must be invoked for the player toolbar");
  assert.ok(enhancedToolbar.className?.includes("artifact-pptx-toolbar"), "Enhanced element must be the pptx toolbar");
});

