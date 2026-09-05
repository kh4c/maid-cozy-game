// Live2D companion (Cubism 5 via pixi-live2d5) — screen-space overlay.
// UPPER-BODY FRAMING: the model is full-body, so we scale it up and hang it
// from a top-center anchor — the head/torso fills the frame and the legs
// extend below the screen, out of view.
//
// EXPRESSIONS: real .exp3.json files (assets/live2d/Maid/expressions/, listed
// in Maid.model3.json) applied through the framework's own ExpressionManager
// via model.expression(name) — the same path the cursor-tracking uses, so the
// values land at the right slot in the update order and actually deform.
// We cycle poses on a timer; l2dExpr (P panel) pins one manually.
//
// NATURAL MOTION: breathing + gentle head/body sway, re-applied every frame
// AFTER the model update (ticker phase) so the framework doesn't flatten it;
// fade weight is reduced while an expression transition is in progress.
//
// Script order matters (index.html):
//   pixi.min.js -> live2dcubismcore.min.js -> cubism5.min.js -> js/live2d.js
window.Live2D = (() => {
  const MODEL_URL = 'assets/live2d/Maid/Maid.model3.json';
  const EXPR_ORDER = ['happy', 'soft_smile', 'surprised', 'pouty', 'sleepy'];
  let model = null;
  let appRef = null;
  let naturalH = 0;      // model height in px at scale 1 — measured after load
  let pinnedExpr = 0;    // 0 = auto-cycle; 1..n = index into EXPR_ORDER
  let curName = 'happy';
  let nextAt = 0;
  const HOLD_MS = 4200;

  function applyFraming() {
    const W = appRef.screen.width, H = appRef.screen.height;
    const s = window.Settings.settings;
    model.visible = !!s.l2dOn;
    model.scale.set((H * 2 * s.l2dZoom) / (naturalH || 1));
    // l2dx/l2dy are fractions of the screen; anchor is top-center, so l2dy=0
    // puts the top of her head at the top edge. Negative y trims headroom.
    model.position.set(W * s.l2dx, H * s.l2dy);
  }

  function currentExpression() {
    if (pinnedExpr > 0) return EXPR_ORDER[(pinnedExpr - 1) % EXPR_ORDER.length];
    return curName;
  }

  // ---- Natural idle motion (breathing + sway) --------------------------------
  // Applied in the ticker (AFTER model.update): we blend toward target values
  // with a time constant, so we nudge rather than fight the framework — the
  // same "lerp after update" pattern from the pixi-live2d-display guide.
  function naturalMotionTick(deltaMS) {
    if (!model || !model.internalModel) return;
    const core = model.internalModel.coreModel;
    const t = performance.now() / 1000;
    const k = 1 - Math.exp(-deltaMS / 120); // smoothing (~120ms time constant)
    const lerpTo = (id, target) => {
      const cur = core.getParameterValueById(id);
      core.setParameterValueById(id, cur + (target - cur) * k);
    };
    const breath = 0.5 - 0.5 * Math.cos((t / 3.4) * Math.PI * 2); // 0..1
    lerpTo('ParamBreath', breath);
    lerpTo('ParamAngleX', Math.sin(t * 0.53) * 7 + Math.sin(t * 0.31 + 1.7) * 4);
    lerpTo('ParamAngleY', Math.sin(t * 0.41 + 0.8) * 5 + Math.sin(t * 0.23) * 3);
    lerpTo('ParamAngleZ', Math.sin(t * 0.36 + 2.1) * 5);
    lerpTo('ParamBodyAngleX', Math.sin(t * 0.43 + 1.2) * 4);
    lerpTo('ParamBodyAngleY', breath * 3);
  }

  async function init(app) {
    const ns = window.PIXI && window.PIXI.live2d;
    if (!ns || !ns.Live2DModel) throw new Error('pixi-live2d5 missing — check vendor/cubism5.min.js');
    if (!window.Live2DCubismCore) throw new Error('Cubism Core missing — check vendor/live2dcubismcore.min.js');

    ns.Live2DModel.registerTicker(PIXI.Ticker);

    appRef = app;
    model = await ns.Live2DModel.from(MODEL_URL, {
      autoUpdate: true,   // framework updates on the shared ticker
      autoHitTest: false, // game input; drag handled by our edit-mode tool
      autoFocus: true,    // keep cursor-follow — it is what makes the head move
      // idle motion is disabled: we drive breath/sway ourselves each tick
      idleMotion: false,
    }).catch((e) => { throw new Error('model load failed: ' + e.message); });

    model.anchor.set(0.5, 0);
    naturalH = model.height;
    app.stage.addChild(model);
    enablePlacementTool(app);

    // Sanity: expressions must be registered by the ExpressionManager
    const em = model.internalModel.motionManager.expressionManager;
    if (!em) throw new Error('no ExpressionManager — check Expressions in model3.json');

    // kick the cycle: first expression immediately
    model.expression(EXPR_ORDER[0]);
    curName = EXPR_ORDER[0];
    nextAt = performance.now() + HOLD_MS;

    // natural motion rides the same shared ticker, added after the model's
    // own update handler -> runs later in the frame
    PIXI.Ticker.shared.add(() => {
      applyFraming();
      naturalMotionTick(PIXI.Ticker.shared.deltaMS);
      tickExpressions(performance.now());
    });
    applyFraming();

    return model;
  }

  function tickExpressions(now) {
    if (pinnedExpr > 0) return;            // manual pin: no cycling
    if (now < nextAt) return;
    const i = EXPR_ORDER.indexOf(curName);
    curName = EXPR_ORDER[(i + 1) % EXPR_ORDER.length];
    model.expression(curName);
    nextAt = now + HOLD_MS;
  }

  function setPinned(n) {
    const prev = pinnedExpr;
    pinnedExpr = n | 0;
    if (pinnedExpr > 0) {
      curName = EXPR_ORDER[(pinnedExpr - 1) % EXPR_ORDER.length];
      model.expression(curName);
      nextAt = performance.now() + HOLD_MS;
    } else if (prev > 0) {
      // released the pin: restart the auto-cycle from the pinned pose
      nextAt = performance.now() + HOLD_MS;
    }
  }

  // ---- Drag / wheel placement tool (EDIT MODE ONLY) --------------------------
  function toCanvas(e) {
    const r = appRef.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (appRef.screen.width / r.width),
      y: (e.clientY - r.top) * (appRef.screen.height / r.height),
    };
  }

  function enablePlacementTool(app) {
    const S = window.Settings;
    app.stage.eventMode = 'static';
    app.stage.hitArea = app.screen;
    model.eventMode = 'static';
    model.cursor = 'grab';

    const editActive = () => !!(window.EditMode && window.EditMode.active);

    let drag = null;
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

    let saveTimer = null;
    app.canvas.addEventListener('wheel', (e) => {
      if (!model || !model.visible || !editActive()) return;
      const p = toCanvas(e);
      const b = model.getBounds();
      if (!b.containsPoint(p.x, p.y)) return;
      e.preventDefault();
      const s = S.settings;
      s.l2dZoom = Math.min(2, Math.max(0.1, s.l2dZoom * (e.deltaY < 0 ? 1.05 : 1 / 1.05)));
      S.refreshControls();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => S.save(), 400);
    }, { passive: false });
  }

  function destroy() { if (model) { model.destroy(); model = null; } }

  return {
    init, destroy,
    get ready() { return !!model; },
    get model() { return model; },
    get exprName() { return currentExpression(); },
    setExpr(n) { setPinned(n); },
    apply: applyFraming,
  };
})();
