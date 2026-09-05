// Live2D companion (Cubism 5 via pixi-live2d5) — screen-space overlay.
// UPPER-BODY FRAMING: the model is full-body, so we scale it up and hang it
// from a top-center anchor — the head/torso fills the frame and the legs
// extend below the screen, out of view.
//
// EXPRESSIONS: the Maid model ships NO .exp3.json files, so expressions are
// sculpted procedurally — every tick we write parameter values (smile eyes,
// brow forms, mouth shapes, cheek puff, blush) through the 'beforeModelUpdate'
// hook, which runs after motion/blink/physics so nothing can overwrite us.
// SIX poses cycle automatically; set l2dExpr = 0..6 to pin one manually
// (0 = auto cycle). Blend is eased, so changes morph instead of popping.
//
// PLACEMENT: drag/wheel only in edit mode; edits auto-save (Settings).
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

  // ---- Procedural expressions ------------------------------------------------
  // Values are Cubism parameter targets. The Maid rig binds eyes to the
  // standard IDs (ParamEyeLOpen/Smile) but the visible mouth to the VTS-style
  // IDs (MouthJawOpen/Funnel/Pucker) — so mouth "open" drives BOTH sets.
  const EXPR = {
    neutral: {
      EyeLOpen: 1, EyeROpen: 1, EyeLSmile: 0, EyeRSmile: 0,
      BrowY: 0, BrowForm: 0, MouthForm: 0.3, MouthOpen: 0,
      Cheek: 0, CheekPuff: 0,
    },
    happy: {
      EyeLOpen: 0.1, EyeROpen: 0.1, EyeLSmile: 1, EyeRSmile: 1,     // closed happy eyes ^^
      BrowY: 0.5, BrowForm: 1, MouthForm: 1, MouthOpen: 0.85,       // big open smile
      Cheek: 0.8, CheekPuff: 0,
    },
    soft_smile: {
      EyeLOpen: 0.65, EyeROpen: 0.65, EyeLSmile: 0.7, EyeRSmile: 0.7, // gentle smile eyes
      BrowY: 0.3, BrowForm: 0.6, MouthForm: 1, MouthOpen: 0.12,     // closed-lip smile
      Cheek: 0.55, CheekPuff: 0,
    },
    surprised: {
      EyeLOpen: 1.15, EyeROpen: 1.15, EyeLSmile: 0, EyeRSmile: 0,   // wide open
      BrowY: -1, BrowForm: -1,                                      // brows shot up
      MouthForm: -0.9, MouthOpen: 1,                                // round O mouth
      Cheek: 0, CheekPuff: 0.5,
    },
    pouty: {
      EyeLOpen: 0.5, EyeROpen: 0.5, EyeLSmile: 0.2, EyeRSmile: 0.2,
      BrowY: -0.7, BrowForm: -0.6,                                  // inner brows up = pout
      MouthForm: -1, MouthOpen: 0.05,                               // pursed pout
      Cheek: 0.9, CheekPuff: 0.7,                                   // puffed cheeks
    },
    sleepy: {
      EyeLOpen: 0.08, EyeROpen: 0.08, EyeLSmile: 0.3, EyeRSmile: 0.3, // heavy lids
      BrowY: -0.35, BrowForm: 0.3,
      MouthForm: -0.4, MouthOpen: 0.35,                             // small yawn-ish mouth
      Cheek: 0.3, CheekPuff: 0,
    },
  };
  const EXPR_ORDER = ['neutral', 'happy', 'soft_smile', 'surprised', 'pouty', 'sleepy'];

  // Humanize: hold each pose, then blend to the next (eased per tick).
  // curExpr starts with the UNION of all keys (0 default) — blending into a
  // missing key would produce NaN (undefined + number), which freezes Cubism.
  const ALL_KEYS = {};
  for (const e of Object.values(EXPR)) for (const k of Object.keys(e)) ALL_KEYS[k] = 0;
  const curExpr = Object.assign(ALL_KEYS, structuredClone(EXPR.neutral));
  let curName = 'neutral';
  let nextAt = 0;      // performance.now() ms when to switch
  const HOLD_MS = 4200, BLEND_MS = 700;

  // Own procedural blink (the built-in eyeBlink writes the same eye params
  // earlier in the frame — our hook would override it, so we replace it).
  // Quick close-open dip every ~3.4s; f = 1 open, ~0.05 at the closed peak.
  function blinkFactor(now) {
    const t = now % 3400;
    if (t >= 260) return 1;
    const p = (t / 260) * Math.PI;
    return 0.05 + 0.95 * Math.abs(Math.cos(p));
  }

  function tickExpressions(now, dtSec) {
    if (nextAt === 0) nextAt = now + HOLD_MS; // first call
    if (now >= nextAt) {
      const i = EXPR_ORDER.indexOf(curName);
      curName = EXPR_ORDER[(i + 1) % EXPR_ORDER.length];
      nextAt = now + HOLD_MS + BLEND_MS;
    }
    const manual = window.Settings.settings.l2dExpr | 0;
    const target = manual > 0
      ? (EXPR[EXPR_ORDER[(manual - 1) % EXPR_ORDER.length]] || EXPR[curName])
      : EXPR[curName];
    const k = 1 - Math.exp(-6 * Math.min(dtSec, 0.05)); // frame-rate independent ease
    for (const key in target) {
      const v = curExpr[key] + (target[key] - curExpr[key]) * k;
      curExpr[key] = Number.isFinite(v) ? v : 0;
    }
  }

  function applyExpressions() {
    if (!model || !model.internalModel) return;
    const core = model.internalModel.coreModel;
    // multiply open by blink so happy's closed-smile eyes stay closed,
    // open eyes blink, and heavy sleepy lids blink from a lower base
    const blink = blinkFactor(performance.now());
    core.setParameterValueById('ParamEyeLOpen', curExpr.EyeLOpen * blink);
    core.setParameterValueById('ParamEyeROpen', curExpr.EyeROpen * blink);
    core.setParameterValueById('ParamEyeLSmile', curExpr.EyeLSmile);
    core.setParameterValueById('ParamEyeRSmile', curExpr.EyeRSmile);
    core.setParameterValueById('ParamBrowLY', curExpr.BrowY);
    core.setParameterValueById('ParamBrowRY', curExpr.BrowY);
    core.setParameterValueById('ParamBrowLForm', curExpr.BrowForm);
    core.setParameterValueById('ParamBrowRForm', curExpr.BrowForm);
    core.setParameterValueById('ParamMouthForm', curExpr.MouthForm);
    core.setParameterValueById('ParamMouthOpenY', curExpr.MouthOpen);
    core.setParameterValueById('ParamCheek', curExpr.Cheek);
    core.setParameterValueById('CheekPuff', curExpr.CheekPuff);
    // VTS-style mouth rig on this model — drive the same intent on both sets
    core.setParameterValueById('MouthJawOpen', curExpr.MouthOpen);
    core.setParameterValueById('MouthFunnel', (1 - curExpr.MouthForm) * 0.5 * curExpr.MouthOpen);
    core.setParameterValueById('MouthPucker', curExpr.MouthForm < 0 ? -curExpr.MouthForm * 0.5 : 0);
    core.setParameterValueById('MouthPressLipOpen', 0);
    core.setParameterValueById('MouthShrug', curExpr.MouthForm < 0 ? 0.5 : 0);
  }

  async function init(app) {
    const ns = window.PIXI && window.PIXI.live2d;
    if (!ns || !ns.Live2DModel) throw new Error('pixi-live2d5 missing — check vendor/cubism5.min.js');
    if (!window.Live2DCubismCore) throw new Error('Cubism Core missing — check vendor/live2dcubismcore.min.js');

    // autoUpdate needs a ticker: register the UMD PIXI namespace's shared ticker.
    ns.Live2DModel.registerTicker(PIXI.Ticker);

    appRef = app;
    model = await ns.Live2DModel.from(MODEL_URL, {
      autoUpdate: true,   // physics + eye-blink update on the shared ticker
      autoHitTest: false, // game input; drag handled by our own edit-mode tool
      autoFocus: false,   // mouse-tracking off — expressions are authored, not reactive
    });
    // anchor (0.5, 0) = top-center of the model bounds: position pins the HEAD,
    // everything below (legs) hangs off-screen when zoomed in.
    model.anchor.set(0.5, 0);
    naturalH = model.height; // scale is still 1 here -> true natural height
    app.stage.addChild(model);
    enablePlacementTool(app);

    // Sculpt parameters right before every model update: runs AFTER motion,
    // blink, physics and focus, so nothing overwrites the expression values.
    let last = performance.now();
    model.internalModel.on('beforeModelUpdate', () => {
      const now = performance.now();
      const dtSec = Math.min((now - last) / 1000, 0.05);
      last = now;
      tickExpressions(now, dtSec);
      applyExpressions();
    });
    return model;
  }

  // ---- Drag / wheel placement tool (EDIT MODE ONLY) --------------------------
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

  return {
    init, apply, destroy,
    get ready() { return !!model; },
    get model() { return model; },
    get exprName() { return curName; },
    setExpr(name) { if (EXPR[name]) { curName = name; nextAt = performance.now() + HOLD_MS + BLEND_MS; } },
  };
})();
