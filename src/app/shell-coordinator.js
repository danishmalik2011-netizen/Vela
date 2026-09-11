(() => {
  "use strict";

  function create({ app, canvas, workspaceState, updateState, applyWidth }) {
    if (!app || !canvas || typeof updateState !== "function") throw new Error("Shell coordinator requires app, canvas, and updateState.");
    let state = { ...workspaceState };

    function apply() {
      canvas.classList.toggle("pinned", Boolean(state.pinned));
      canvas.classList.toggle("fullscreen", Boolean(state.fullscreen));
      app.classList.toggle("canvas-fullscreen", Boolean(state.fullscreen));
      if (state.fullscreen) app.style.removeProperty("--artifact-canvas-space");
      else applyWidth?.(state.width);
      return { ...state };
    }

    function open() {
      canvas.classList.add("open");
      canvas.setAttribute("aria-hidden", "false");
      app.classList.add("canvas-engaged");
      state = updateState({ open: true });
      return apply();
    }

    function close({ force = false } = {}) {
      if (state.pinned && !force) return { closed: false, reason: "pinned", state: { ...state } };
      canvas.classList.remove("open", "fullscreen");
      canvas.setAttribute("aria-hidden", "true");
      app.classList.remove("canvas-engaged", "canvas-fullscreen");
      state = updateState({ open: false, fullscreen: false });
      return { closed: true, reason: "", state: { ...state } };
    }

    function togglePinned() {
      state = updateState({ pinned: !state.pinned });
      apply();
      return state.pinned;
    }

    function toggleFullscreen() {
      state = updateState({ fullscreen: !state.fullscreen });
      apply();
      return state.fullscreen;
    }

    function setState(nextState) {
      state = { ...state, ...nextState };
      return apply();
    }

    function closeMobileSidebar() {
      app.classList.remove("mobile-sidebar-open");
    }

    function snapshot() { return { ...state }; }

    return Object.freeze({ apply, open, close, togglePinned, toggleFullscreen, setState, closeMobileSidebar, snapshot });
  }

  globalThis.VelaShellCoordinator = Object.freeze({ create });
})();
