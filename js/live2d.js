// Live2D companion (Cubism 5 via pixi-live2d5) — screen-space overlay.
// UPPER-BODY FRAMING: the model is full-body, so we scale it up and hang it
// from a top-center anchor — the head/torso fills the frame and the legs
// extend below the screen, out of view.
//
// DEV PLACEMENT TOOL: drag the maid with the mouse to move her, scroll the
// mouse wheel over her to resize. Changes write straight into Settings and
// auto-persist to localStorage (debounced), so the pose survives reloads.
// The dev panel (P) sliders stay in sync via Settings.refreshControls().
//
// Script order matters (index.html):
//   pixi.min.js -> live2dcubismcore.min.js -> cubism5.min.js -> js/live2d.js
// Shaders: Cubism R5 fetches 13 GLSL files from /cubism5/shaders/ at render
// time; the dir sits at the project root so both http:// and maid:// serve it.
window.Live2D = (() => {
  const MODEL_URL = 'assets/live2d/Maid/Maid.model3.json';
  let model = null;
  let appRef = null;
  let naturalH = 0; // model height in px at scale 1 — measured after load

  async function init(app) {
    const ns = window.PIXI && window.PIXI.live2d;
    if (!ns || !ns.Live2DModel) throw new Error('pixi-live2d5 missing — check vendor/cubism5.min.js');
    if (!window.Live2DCubismCore) throw new Error('Cubism Core missing — check vendor/live2dcubismcore.min.js');

    // autoUpdate needs a ticker: register the UMD PIXI namespace's shared ticker.
    ns.Live2DModel.registerTicker(PIXI.Ticker);

    appRef = app;
    model = await ns.Live2DModel.from(MODEL_URL, {
      autoUpdate: true,   // physics + eye-blink update on the shared ticker
      autoHitTest: false, // we do our own drag/hit logic below
      autoFocus: false,   // no eye-tracking of the mouse (can enable later)
    });
    // anchor (0.5, 0) = top-center of the model bounds: position pins the HEAD,
    // everything below (legs) hangs off-screen when zoomed in.
    model.anchor.set(0.5, 0);
    naturalH = model.height; // scale is still 1 here -> true natural height
    app.stage.addChild(model);
    enablePlacementTool(app);
    return model;
  }

  // ---- Drag / wheel placement tool -----------------------------------------
  // DOM pointer coords -> internal 1280x720 render coords (canvas is CSS-scaled).
  function toCanvas(e) {
    const r = appRef.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (appRef.screen.width / r.width),
      y: (e.clientY - r.top) * (appRef.screen.height / r.height),
    };
  }

  function enablePlacementTool(app) {
    const S = window.Settings;
    // v8 events: root must be 'static' (with a hitArea) for children to be hit-tested
    app.stage.eventMode = 'static';
    app.stage.hitArea = app.screen;
    model.eventMode = 'static';
    model.cursor = 'grab';

    // Placement edits are an EDIT-MODE-ONLY behavior — the maid is never
    // draggable/resizable during normal play.
    const editActive = () => !!(window.EditMode && window.EditMode.active);

    // -- drag to move --
    let drag = null; // last pointer pos in canvas coords
    model.on('pointerdown', (e) => {
      if (!editActive()) return;
      drag = { x: e.global.x, y: e.global.y };
      model.cursor = 'grabbing';
    });
    window.addEventListener('pointermove', (e) => {
      if (!drag || !editActive()) return;
      const p = toCanvas(e);
      const s = S.settings;
      s.l2dx += (p.x - drag.x) / app.screen.width;
      s.l2dy += (p.y - drag.y) / app.screen.height;
      drag = { x: p.x, y: p.y };
      S.refreshControls();
      S.saveSoon();
    });
    window.addEventListener('pointerup', () => {
      if (!drag) return;
      drag = null;
      model.cursor = 'grab';
      S.save();
    });

    // -- wheel over the model to resize --
    let saveTimer = null;
    app.canvas.addEventListener('wheel', (e) => {
      if (!model || !model.visible || !editActive()) return;
      const p = toCanvas(e);
      const b = model.getBounds();
      if (!b.containsPoint(p.x, p.y)) return; // only when hovering the maid
      e.preventDefault();
      const s = S.settings;
      s.l2dZoom = Math.min(2, Math.max(0.1, s.l2dZoom * (e.deltaY < 0 ? 1.05 : 1 / 1.05)));
      S.refreshControls();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => S.save(), 400); // debounce: wheel fires in bursts
    }, { passive: false });
  }

  // Called every tick with the settings object — cheap, just sets transform.
  // FRAMING: zoom 1.0 = model is 2x screen height, so the top half (head +
  // torso, ~upper body) fills the screen and the legs fall below the edge.
  function apply(s) {
    if (!model || !appRef) return;
    const W = appRef.screen.width, H = appRef.screen.height;
    model.visible = !!s.l2dOn;
    model.scale.set((H * 2 * s.l2dZoom) / (naturalH || 1));
    // l2dx/l2dy are fractions of the screen; anchor is top-center, so l2dy=0
    // puts the top of her head at the top edge. Negative y trims headroom.
    model.position.set(W * s.l2dx, H * s.l2dy);
  }

  function destroy() { if (model) { model.destroy(); model = null; } }

  return { init, apply, destroy, get ready() { return !!model; }, get model() { return model; } };
})();
