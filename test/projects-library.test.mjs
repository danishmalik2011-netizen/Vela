import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

async function load(path, name) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const context = vm.createContext({});
  vm.runInContext(source, context);
  return context[name];
}
const projects = await load("../src/projects/store.js", "VelaProjectStore");
const library = await load("../src/library/global-library.js", "VelaGlobalLibrary");
const artifactStore = await load("../src/artifacts/store.js", "VelaArtifactStore");

function memoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
}

test("project store creates, updates, persists, and removes projects", () => {
  const storage = memoryStorage();
  let list = projects.create([], "Website redesign", "p1", () => 10);
  assert.equal(list[0].name, "Website redesign");
  list = projects.update(list, "p1", { instructions: "Use the brand guide" }, () => 20);
  projects.write(storage, "projects", list);
  assert.equal(projects.read(storage, "projects")[0].instructions, "Use the brand guide");
  assert.equal(projects.remove(list, "p1").length, 0);
});

test("project store repairs malformed and duplicate records", () => {
  const normalized = projects.normalize([
    { id: "p", name: " First ", createdAt: 1 },
    { id: "p", name: "Duplicate", createdAt: 2 },
    { name: "Missing id" }
  ]);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].name, "First");
});

test("global library aggregates artifacts across conversations and projects", () => {
  const storage = memoryStorage({
    index: JSON.stringify([{ id: "c1", projectId: "p1" }, { id: "c2" }]),
    "chat:c1": JSON.stringify({ title: "Site", projectId: "p1", artifacts: [{ id: "a1", source: "<h1>Site</h1>", language: "html", title: "Landing", updatedAt: 20, version: 1 }] }),
    "chat:c2": JSON.stringify({ title: "Notes", artifacts: [{ id: "a2", source: "# Notes", language: "markdown", title: "Brief", updatedAt: 10, version: 1 }] })
  });
  const artifacts = library.collect(storage, { indexKey: "index", prefix: "chat:", artifactStore, projects: [{ id: "p1", name: "Website" }] });
  assert.equal(artifacts.length, 2);
  assert.equal(artifacts[0].conversationTitle, "Site");
  assert.equal(artifacts[0].projectName, "Website");
  assert.equal(library.filter(artifacts, { projectId: "p1" }).length, 1);
  assert.equal(library.filter(artifacts, { query: "notes" })[0].id, "a2");
});
