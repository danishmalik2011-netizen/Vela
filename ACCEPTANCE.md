# Vela Production Workspace Acceptance

This document records the automated acceptance surface for the modular production-workspace objective. It is evidence, not a claim that future changes remain compliant without rerunning the checks.

## Architecture boundaries

| Slice | Production module(s) | Acceptance tests |
|---|---|---|
| Shell and canvas lifecycle | `src/app/workspace-state.js`, `src/app/shell-coordinator.js` | `workspace-state.test.mjs`, `presentation-shell.test.mjs`, browser canvas tests |
| Conversation | `src/conversation/store.js`, `presentation.js`, `generation.js` | `conversation-services.test.mjs`, `presentation-shell.test.mjs`, browser persistence/recovery tests |
| Composer | `src/composer/state.js` | `composer-search.test.mjs`, browser task-mode and provider-failure tests |
| Provider and search | `src/services/provider-config.js`, `provider-requests.js`, `provider-orchestrator.js`, `search-orchestration.js` | `provider-config.test.mjs`, `conversation-services.test.mjs`, `composer-search.test.mjs`, browser failure recovery |
| Artifacts | `src/artifacts/core.js`, `store.js`, `renderers.js` | `artifacts.test.mjs`, `artifact-store.test.mjs`, browser preview/revision/persistence tests |
| Projects and library | `src/projects/store.js`, `src/library/global-library.js` | `projects-library.test.mjs`, browser project/library tests |
| Research | `src/research/store.js` | `research-store.test.mjs`, browser research and bibliography tests |
| Writing | `src/writing/store.js` | `writing-store.test.mjs`, browser accept/reject/revision tests |
| Coding | `src/code/workspace.js` | `code-workspace.test.mjs`, browser policy and patch tests |

The HTML shell remains the composition root and DOM event adapter. Durable state transitions, renderer policy, provider payload construction/orchestration, search policy, and workspace models are delegated to tested modules.

## Three-surface canvas

The canvas supports preview, source, and split surfaces, plus revision history. Its renderer registry is the enforcement point for:

- HTML in an iframe with `sandbox="allow-scripts"`, no same-origin parent access, and `referrerPolicy="no-referrer"`. HTML previews include a viewport picker (mobile/tablet/full), an in-canvas console fed by an injected `postMessage` bridge, and open-in-new-tab via a blob URL.
- Sanitized SVG rendering with zoom controls, checkerboard background toggle, and client-side PNG export.
- Sanitized Markdown rendering.
- Mermaid diagrams rendered in-canvas (strict security level) with zoom and PNG export of the rendered SVG.
- CSV/TSV rendered as real data tables (RFC-4180 quoted-field parsing); uniform JSON arrays render as tables, other JSON pretty-printed.
- Source-only, non-executing Python, JavaScript, CSS.

## Generation robustness

- Streaming stop reasons (`stop_reason`, `finish_reason`, `incomplete_details`) are surfaced from providers; responses cut off at the token limit are automatically continued (up to 8 rounds) with a resume-at-cut-off prompt, and an unclosed code fence is auto-closed if the budget is exhausted.

## Response actions and composer

- Every assistant message offers contextual follow-up actions specific to its task mode (Continue, Shorten, Refine, Explain, Fact-check, Expand, Outline, To bullets, Compare, Build brief, More sources, Add tests, Refactor, Optimize, Make responsive…) plus Export (Markdown download) and Canvas.
- Composer slash commands cover modes (`/chat /write /research /code /build`), prompt shapers (`/summarize /plan /compare /explain`), and app actions (`/export /canvas /shortcuts /quiet /project /remember`). `/remember` notes are injected into the system prompt.
- A keyboard-shortcut reference (`?`, Ctrl/⌘+K search, Ctrl/⌘+/ composer, Ctrl/⌘+Shift+A library) and a persistent quiet mode exist.
- The coding workspace exports its file set as a store-only `.zip` (`src/services/export.js`); the research workspace offers a source-comparison lane and bibliography download; the writing studio exports drafts as Markdown or standalone HTML.
- Whole-workspace backup/restore is in Settings → Data & export (all `vela-`/`sage-` keys, conflict-safe import).

## Acceptance categories

- **Behavior and interaction:** task modes; open/close/pin/fullscreen; preview/source/split/history; project assignment; global library; research sources/notes/draft; writing proposals; coding patches.
- **Persistence:** conversation schema/migration; artifacts and revisions; canvas state; projects; specialized workspaces; reload restoration.
- **Failure recovery:** corrupt storage; invalid provider configuration; rejected writing/code proposals; abort-safe generation state.
- **Responsive:** automated matrix at 1280×800, 1440×900, 1024×768, 768×1024, and 390×844.
- **Accessibility:** keyboard-focusable canvas controls, ARIA selected/pressed/hidden state, reduced-motion behavior, responsive usability.
- **Security:** same-origin provider proxy; endpoint protocol, credentials, DNS, and private-address controls; request size/time bounds; safe search URLs and escaped context; iframe sandbox; SVG/Markdown sanitization; disabled Python/JavaScript execution; attachment limits.

## Required commands

```text
npm run check
npm test
npm run test:browser
```

Acceptance requires all commands to pass. Browser tests use installed Chrome through the DevTools protocol and may require a slower startup timeout on heavily loaded systems.
