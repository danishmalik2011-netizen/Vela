(() => {
  "use strict";

  const VALID_MODES = Object.freeze(["preview", "source", "split", "history", "library"]);
  const DEFAULTS = Object.freeze({
    open: false,
    pinned: false,
    fullscreen: false,
    mode: "preview",
    width: 720
  });

  function normalize(value = {}) {
    const width = Math.min(1400, Math.max(420, Number(value.width) || DEFAULTS.width));
    return {
      open: Boolean(value.open),
      pinned: Boolean(value.pinned),
      fullscreen: Boolean(value.fullscreen),
      mode: VALID_MODES.includes(value.mode) ? value.mode : DEFAULTS.mode,
      width
    };
  }

  function read(storage, key) {
    try {
      return normalize(JSON.parse(storage.getItem(key) || "{}"));
    } catch {
      return normalize();
    }
  }

  function write(storage, key, value) {
    const normalized = normalize(value);
    storage.setItem(key, JSON.stringify(normalized));
    return normalized;
  }

  function update(storage, key, patch) {
    return write(storage, key, { ...read(storage, key), ...patch });
  }

  function canvasWidth(width, viewportWidth, sidebarWidth = 280) {
    const maximum = Math.max(420, Number(viewportWidth) - Number(sidebarWidth) - 24);
    return Math.min(maximum, Math.max(420, Number(width) || DEFAULTS.width));
  }

  globalThis.VelaWorkspaceState = Object.freeze({
    VALID_MODES,
    DEFAULTS,
    normalize,
    read,
    write,
    update,
    canvasWidth
  });
})();
