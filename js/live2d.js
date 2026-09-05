// Live2D companion (Cubism 5 via pixi-live2d5) — screen-space overlay.
// UPPER-BODY FRAMING: the model is full-body, so we scale it up and hang it
// from a top-center anchor — the head/torso fills the frame and the legs
// extend below the screen, out of view.
//
// EXPRESSIONS: real .exp3.json files (assets/live2d/Maid/expressions/, listed
// in Maid.model3.json) applied through the framework's own ExpressionManager
// via model.expression(name) — the same path the cursor-tracking uses, so the
// values land at the right slot in the update order and actually deform.
// Poses cycle on a timer with a neutral rest face between each one
// (resetExpression); l2dExpr (P panel) pins one manually.
//
// NATURAL MOTION: breathing + gentle head/body sway, written ABSOLUTE in a
// 'beforeModelUpdate' hook (after focus, right before the vertex bake) with
// self-owned smoothing — the only slot that survives to the draw.
//
// Script order matters (index.html):
//   pixi.min.js -> live2dcubismcore.min.js -> cubism5.min.js -> js/live2d.js
window.Live2D = (() => {
  const MODEL_URL = 'assets/live2d/Maid/Maid.model3.json';
  const EXPR_ORDER = ['happy', 'soft_smile', 'surprised', 'smug', 'pouty', 'sleepy'];
  let model = null;
  let appRef = null;
  let exprMgr = null;    // ExpressionManager — resetExpression() gives the neutral rest face
  let naturalH = 0;      // model height in px at scale 1 — measured after load
  let pinnedExpr = 0;    // 0 = auto-cycle; 1..n = index into EXPR_ORDER
  let curName = 'happy';
  let namedIdx = 0;      // index into EXPR_ORDER of the current/next pose
  let onNeutral = false; // true while showing the neutral rest face between poses
  let nextAt = 0;
  const HOLD_MS = 4200;
  const NEUTRAL_HOLD_MS = 2600; // rest face holds a little shorter than poses

  function applyFraming() {
    const W = appRef.screen.width, H = appRef.screen.height;
    const s = window.Settings.settings;
    model.visible = !!s.l2dOn;
    model.scale.set((H * 2 * s.l2dZoom) / (naturalH || 1));
    // l2dx/l2dy are fractions of the screen; anchor is top-center, so l2dy=0
    // puts the top of her head at the top edge. Negative y trims headroom.
    // Breath bob: scene-graph position isn't a Live2D param, so no framework
    // wiping — ±2px vertical heave at the breath rate guarantees visible
    // breathing even where the chest rig is subtle. Same phase as idleHook.
    const t = performance.now() / 1000;
    const br = 0.5 - 0.5 * Math.cos((t / 3.8) * Math.PI * 2); // 0..1
    model.position.set(W * s.l2dx, H * s.l2dy + (br - 0.5) * 4);
  }

  function currentExpression() {
    if (pinnedExpr > 0) return EXPR_ORDER[(pinnedExpr - 1) % EXPR_ORDER.length];
    return curName;
  }

  // REAL parameter indices, resolved once at init from the model's OWN
  // canonical CubismId objects (core._parameterIds).
  // WHY NOT setParameterValueById('ParamAngleY', v)? getParameterIndex
  // compares with != against CubismId OBJECTS — a plain string never matches
  // and silently falls into a phantom "non-existent parameter" side table.
  // Writes there render nothing, and reads echo your own writes back
  // (that's how the debug HUD showed oscillation on a frozen head).
  // The EyeBlink controller works because it passes CubismId objects.
  let P = {}; // name -> real numeric index
  function resolveParamIndices() {
    const core = model.internalModel.coreModel;
    const ids = core._parameterIds || [];
    const want = ['ParamBreath', 'ParamBodyAngleX', 'ParamBodyAngleY',
      'ParamAngleX', 'ParamAngleY', 'ParamAngleZ', 'ParamEyeBallX', 'ParamEyeBallY'];
    P = {};
    for (let i = 0; i < ids.length; i++) {
      let s = null;
      try { s = (ids[i] && ids[i].getString) ? ids[i].getString() : null; } catch (e) { /* skip */ }
      if (s && want.indexOf(s) >= 0 && !(s in P)) P[s] = i;
    }
    const missing = want.filter((w) => !(w in P));
    if (missing.length) throw new Error('unresolved Live2D params: ' + missing.join(','));
  }

  // SOFTEN: scale how far each expression moves facial features (user pref:
  // subtle). 0.5 = about half strength; tweak 0.3-0.7 to taste.
  const EXPR_SOFTNESS = 0.5;
  function softenExpressionManager(em) {
    // Wrap createExpression: it receives the parsed .exp3.json exactly once
    // per expression (then gets cached), so scaling here is idempotent —
    // no risk of double-scaling on repeat setExpression calls.
    const origCreate = em.createExpression.bind(em);
    em.createExpression = function (data, definition) {
      try {
        const obj = typeof data === 'string' ? JSON.parse(data) : JSON.parse(JSON.stringify(data));
        if (Array.isArray(obj.Parameters)) {
          for (const p of obj.Parameters) {
            if (typeof p.Value === 'number') p.Value *= EXPR_SOFTNESS;
          }
        }
        return origCreate(JSON.stringify(obj), definition);
      } catch (e) {
        return origCreate(data, definition); // never break loading over softening
      }
    };
    return em;
  }

  // ---- Natural idle motion -----------------------------------------------------
  // Calm breathing + a gentle head sway (max 10° on any axis) so she feels
  // alive without being twitchy. Every ~8-16s she also glances down for a
  // few seconds (lookDown eases 0..1) — a soft "reading/shy" idle beat.
  //
  // WHY A HOOK, NOT THE TICKER: the framework reloads base parameter values
  // every frame (loadParameters) at render time, and updateFocus() re-zeros
  // the head angles right before the bake — so ticker writes never survive
  // to the draw (that's why she looked frozen). Instead we hook
  // 'beforeModelUpdate', which fires AFTER focus and right BEFORE the vertex
  // bake: our absolute writes are the final word each frame. Smoothing state
  // is owned here (never read back from core) so it actually accumulates.
  const sm = { breath: 0, bodyX: 0, bodyY: 0, ax: 0, ay: 0, az: 0, eyeY: 0 };
  let lastIdleAt = 0;
  let lookDown = 0;          // eased 0..1 — how far she's looking down now
  let lookDownTarget = 0;    // what it's easing toward
  let nextGlanceAt = 8000;   // performance.now() ms of next glance

  function idleHook() {
    if (!model || !model.internalModel) return;
    const core = model.internalModel.coreModel;
    const now = performance.now();
    const dtMS = Math.min(now - (lastIdleAt || now), 100); // clamp tab-switch jumps
    lastIdleAt = now;
    const t = now / 1000;
    const k = 1 - Math.exp(-dtMS / 150); // smoothing (~150ms time constant)
    const ease = (key, target) => (sm[key] += (target - sm[key]) * k);
    const set = (name, v) => core.setParameterValueByIndex(P[name], v); // REAL index — see resolveParamIndices

    // breathing (~3.8s cycle) + slight body lean
    const breath = 0.5 - 0.5 * Math.cos((t / 3.8) * Math.PI * 2); // 0..1
    set('ParamBreath', ease('breath', breath));
    set('ParamBodyAngleX', ease('bodyX', Math.sin(t * 1.0 + 1.2) * 3));
    set('ParamBodyAngleY', ease('bodyY', breath * 2.5));

    // head sway on Y (nod) + Z (tilt) only — strong enough to read clearly,
    // still under the 10° max. X held frontal.
    const hy = Math.sin(t * 1.4 + 0.8) * 5.5 + Math.sin(t * 0.9) * 2.5;   // ±8
    const hz = Math.sin(t * 1.1 + 2.1) * 5;                               // ±5 tilt

    // occasional look-down: ease in, hold ~2.5s, ease out
    if (now >= nextGlanceAt && lookDownTarget === 0) {
      lookDownTarget = 0.55 + Math.random() * 0.45; // how far down
      nextGlanceAt = now + 2200 + Math.random() * 1500; // return time
    } else if (lookDownTarget > 0 && now >= nextGlanceAt) {
      lookDownTarget = 0;
      nextGlanceAt = now + 8000 + Math.random() * 8000; // next glance in 8-16s
    }
    const kd = 1 - Math.exp(-dtMS / 350); // slower ease for the gaze
    lookDown += (lookDownTarget - lookDown) * kd;

    set('ParamAngleX', ease('ax', 0)); // held frontal — no sideways turn
    set('ParamAngleY', ease('ay', hy - lookDown * 22)); // nod sway + look-down glances
    set('ParamAngleZ', ease('az', hz + lookDown * 2));  // tiny tilt as she lowers her head
    set('ParamEyeBallY', ease('eyeY', -lookDown * 0.8));  // eyes follow the downward gaze
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
      autoFocus: false,   // NO cursor-follow — she idles on her own
      idleMotion: false,  // we drive breath/sway ourselves each tick
    }).catch((e) => { throw new Error('model load failed: ' + e.message); });

    model.anchor.set(0.5, 0);
    naturalH = model.height;
    app.stage.addChild(model);
    enablePlacementTool(app);

    // Sanity: expressions must be registered by the ExpressionManager
    const em = model.internalModel.motionManager.expressionManager;
    if (!em) throw new Error('no ExpressionManager — check Expressions in model3.json');
    exprMgr = em;
    softenExpressionManager(em);
    resolveParamIndices(); // must come before idleHook can run (render starts after init)

    // idle motion hooks into the model's own update (fires after focus,
    // right before the vertex bake) — see idleHook above for why
    model.internalModel.on('beforeModelUpdate', idleHook);

    // kick the cycle: first expression immediately
    model.expression(EXPR_ORDER[0]);
    curName = EXPR_ORDER[0];
    nextAt = performance.now() + HOLD_MS;

    // framing + expression cycling ride the shared ticker (plain scene-graph
    // and manager calls — unaffected by the render-time parameter cycle)
    PIXI.Ticker.shared.add(() => {
      applyFraming();
      tickExpressions(performance.now());
    });
    applyFraming();

    return model;
  }

  function tickExpressions(now) {
    if (pinnedExpr > 0) return;            // manual pin: no cycling
    if (now < nextAt) return;
    if (!onNeutral) {
      // rest the face to neutral between poses — resetExpression() replays
      // the manager's empty default expression, easing params back to base
      onNeutral = true;
      curName = 'neutral';
      try { exprMgr.resetExpression(); } catch (e) { /* keep last pose */ }
      nextAt = now + NEUTRAL_HOLD_MS;
    } else {
      onNeutral = false;
      namedIdx = (namedIdx + 1) % EXPR_ORDER.length;
      curName = EXPR_ORDER[namedIdx];
      model.expression(curName);
      nextAt = now + HOLD_MS;
    }
  }

  function setPinned(n) {
    const prev = pinnedExpr;
    pinnedExpr = n | 0;
    if (pinnedExpr > 0) {
      onNeutral = false;
      namedIdx = (pinnedExpr - 1) % EXPR_ORDER.length;
      curName = EXPR_ORDER[namedIdx];
      model.expression(curName);
      nextAt = performance.now() + HOLD_MS;
    } else if (prev > 0) {
      // released the pin: hold the pinned pose briefly, then rest to
      // neutral and resume the cycle after it (tickExpressions handles it)
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
    // read a param value by name (index-resolved, bypasses the string-ID phantom table)
    param(name) {
      if (!model || !model.internalModel || !(name in P)) return NaN;
      return model.internalModel.coreModel.getParameterValueByIndex(P[name]);
    },
  };
})();
