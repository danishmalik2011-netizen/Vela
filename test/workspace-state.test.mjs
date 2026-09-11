import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../src/app/workspace-state.js", import.meta.url), "utf8");
const context = vm.createContext({});
vm.runInContext(source, context);
const workspace = context.VelaWorkspaceState;

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value))
  };
}

test("normalizes invalid canvas state", () => {
  const state = workspace.normalize({ open: 1, mode: "unknown", width: 50, pinned: "yes" });
  assert.equal(state.open, true);
  assert.equal(state.mode, "preview");
  assert.equal(state.width, 420);
  assert.equal(state.pinned, true);
});

test("persists and updates workspace state", () => {
  const storage = memoryStorage();
  workspace.write(storage, "workspace", { mode: "split", width: 810 });
  const state = workspace.update(storage, "workspace", { fullscreen: true, pinned: true });
  assert.equal(state.mode, "split");
  assert.equal(state.width, 810);
  assert.equal(state.fullscreen, true);
  assert.equal(workspace.read(storage, "workspace").pinned, true);
});

test("constrains canvas width against the available desktop viewport", () => {
  assert.equal(workspace.canvasWidth(900, 1280, 280), 900);
  assert.equal(workspace.canvasWidth(1200, 1024, 280), 720);
  assert.equal(workspace.canvasWidth(100, 1440, 280), 420);
});
