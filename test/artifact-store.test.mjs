import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

async function loadGlobal(pathname, globalName) {
  const source = await readFile(new URL(pathname, import.meta.url), "utf8");
  const context = vm.createContext({});
  vm.runInContext(source, context);
  return context[globalName];
}

const store = await loadGlobal("../src/artifacts/store.js", "VelaArtifactStore");
const renderers = await loadGlobal("../src/artifacts/renderers.js", "VelaArtifactRenderers");
const clock = () => 1_700_000_000_000;

test("creates and migrates durable artifact records", () => {
  const artifact = store.create({
    id: "artifact-1",
    signature: "abc",
    language: "html",
    title: "Page",
    source: "<h1>Hello</h1>"
  }, clock);
  assert.equal(artifact.version, 1);
  assert.equal(artifact.revisions.length, 1);
  assert.equal(artifact.updatedAt, clock());

  const [migrated] = store.migrate([{ ...artifact, revisions: [] }], clock);
  assert.equal(migrated.revisions[0].source, artifact.source);
});

test("saves and restores immutable revision history", () => {
  const first = store.create({ id: "a", signature: "1", language: "markdown", title: "Doc", source: "one" }, clock);
  const second = store.saveRevision(first, "two", "Edited", () => clock() + 1);
  assert.equal(first.source, "one");
  assert.equal(second.version, 2);
  assert.equal(second.revisions.length, 2);

  const restored = store.restoreRevision(second, 1, () => clock() + 2);
  assert.equal(restored.source, "one");
  assert.equal(restored.version, 3);
  assert.match(restored.revisions[2].note, /Restored from version 1/);
});

test("upserts and removes artifacts without mutating input", () => {
  const original = [{ id: "a", source: "old" }];
  const updated = store.upsert(original, { id: "a", source: "new" });
  assert.equal(original[0].source, "old");
  assert.equal(updated[0].source, "new");
  assert.equal(store.remove(updated, "a").length, 0);
});

test("renderer registry creates previews from its enforced security policy", () => {
  function element(tag) {
    return {
      tag,
      attributes: {},
      children: [],
      setAttribute(name, value) { this.attributes[name] = value; },
      appendChild(child) { this.children.push(child); },
      className: "",
      innerHTML: "",
      textContent: ""
    };
  }
  const document = { createElement: element };
  const html = renderers.createPreview(document, "html", "<script>parent.x=1</script>", { title: "Page", escape: String });
  assert.equal(html.tag, "iframe");
  assert.equal(html.attributes.sandbox, renderers.get("html").security.sandbox);
  assert.equal(html.referrerPolicy, "no-referrer");
  const svg = renderers.createPreview(document, "svg", "<svg><script>x()</script></svg>", {
    sanitizeSvg: () => "<svg></svg>", escape: String
  });
  assert.equal(svg.innerHTML, "<svg></svg>");
  const python = renderers.createPreview(document, "python", "print(1)", { escape: String });
  assert.equal(python.children[0].textContent, "print(1)");
});

test("renderer registry declares explicit security and execution policies", () => {
  assert.equal(renderers.get("html").security.parentAccess, false);
  assert.equal(renderers.get("html").security.sandbox, "allow-scripts");
  assert.equal(renderers.get("svg").security.scripts, false);
  assert.equal(renderers.get("python").execution, "disabled");
  assert.equal(renderers.canPreview("markdown"), true);
  assert.equal(renderers.canPreview("python"), false);
});
