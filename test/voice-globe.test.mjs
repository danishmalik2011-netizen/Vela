import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

async function loadGlobe(windowMock = undefined) {
  const source = await readFile(new URL("../src/voice/globe-canvas.js", import.meta.url), "utf8");
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    Math,
    Boolean,
    String,
    Object,
    Array,
    Error,
    Date,
    window: windowMock
  });
  context.globalThis = context;
  vm.runInContext(source, context);
  return context;
}

const {
  VelaGlobeRenderer,
  generateFibonacciSphere,
  generateOrbitalRing
} = await loadGlobe();

test("generateFibonacciSphere generates requested number of points on unit sphere", () => {
  const points = generateFibonacciSphere(500);
  assert.equal(points.length, 500);

  for (const p of points) {
    const dist = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
    assert.ok(Math.abs(dist - 1.0) < 0.001, `Point not on unit sphere: dist=${dist}`);
    assert.ok(p.y >= -1.0 && p.y <= 1.0);
  }
});

test("generateOrbitalRing generates circular orbit points at specified radius and tilt", () => {
  const points = generateOrbitalRing(60, 1.25, 0.3, -0.2);
  assert.equal(points.length, 60);

  for (const p of points) {
    const dist = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
    assert.ok(Math.abs(dist - 1.25) < 0.001, `Ring point not at expected radius: dist=${dist}`);
  }
});

test("VelaGlobeRenderer handles all 5 visual states", () => {
  const mockContext = {
    clearRect: () => {},
    beginPath: () => {},
    arc: () => {},
    fill: () => {},
    save: () => {},
    restore: () => {},
    createRadialGradient: () => ({
      addColorStop: () => {}
    })
  };

  const mockCanvas = {
    getContext: () => mockContext,
    getBoundingClientRect: () => ({ width: 400, height: 400 }),
    width: 400,
    height: 400
  };

  const renderer = new VelaGlobeRenderer(mockCanvas, { pointCount: 100 });
  assert.equal(renderer.state, "idle");

  const states = ["listening", "thinking", "speaking", "interrupted", "idle"];
  for (const s of states) {
    renderer.setState(s);
    assert.equal(renderer.state, s);
    const colors = renderer._getStateColors();
    assert.ok(colors.front);
    assert.ok(colors.back);
    assert.ok(colors.coreGlow);
  }

  renderer.setSyntheticActivity(0.75);
  assert.equal(renderer.syntheticActivity, 0.75);

  renderer.destroy();
  assert.equal(renderer.points.length, 0);
});

test("VelaGlobeRenderer registers window resize listener and cleans up on destroy", async () => {
  let added = false;
  let removed = false;

  const windowMock = {
    addEventListener: (event) => { if (event === "resize") added = true; },
    removeEventListener: (event) => { if (event === "resize") removed = true; },
    devicePixelRatio: 2
  };

  const { VelaGlobeRenderer: RendererWithWindow } = await loadGlobe(windowMock);

  const mockCanvas = {
    getContext: () => ({
      clearRect: () => {},
      beginPath: () => {},
      arc: () => {},
      fill: () => {},
      save: () => {},
      restore: () => {},
      createRadialGradient: () => ({ addColorStop: () => {} })
    }),
    getBoundingClientRect: () => ({ width: 500, height: 500 }),
    width: 500,
    height: 500
  };

  const renderer = new RendererWithWindow(mockCanvas, { pointCount: 50 });
  assert.equal(added, true, "Window resize listener should be added");

  renderer.destroy();
  assert.equal(removed, true, "Window resize listener should be removed on destroy");
});

