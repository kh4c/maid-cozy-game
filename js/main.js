// Bootstrap: init Pixi app, build world, run the game loop. Classic script.
(async () => {
  function reportError(msg) {
    const el = document.getElementById('hud');
    el.innerHTML += `<br><span style="color:#ff6b6b">ERROR: ${msg}</span>`;
    console.error(msg);
  }
  window.addEventListener('error', (e) => reportError(e.message));

  const { Application, Container } = PIXI;
  const cfg = window.CONFIG;

  // ---- App -------------------------------------------------------------------
  const app = new Application();
  await app.init({ width: 1280, height: 720, backgroundColor: '#1a1730' });
  document.getElementById('stage-wrap').appendChild(app.canvas);
  // Fixed 16:9 scene: scale the canvas with CSS to fit any window (letterboxed).
  function fitCanvas() {
    const s = Math.min(window.innerWidth / 1280, window.innerHeight / 720);
    app.canvas.style.width = `${Math.floor(1280 * s)}px`;
    app.canvas.style.height = `${Math.floor(720 * s)}px`;
  }
  fitCanvas();
  window.addEventListener('resize', fitCanvas);

  // ---- World -------------------------------------------------------------------
  const world = new Container();
  app.stage.addChild(world);

  // ---- Background (infinite chunk stream) -----------------------------------------
  let background;
  try {
    background = await window.Tilemap.create();
    world.addChild(background.layer);
    document.getElementById('bg-status').textContent = 'bg ✓';
  } catch (err) {
    reportError('background failed: ' + err.message);
  }

  // ---- Foot dust (world-space, under the character's feet) ------------------------
  // Created BEFORE the character so puffs render underneath her. Non-fatal:
  // if the texture fails, the game runs fine without dust.
  let dust = null;
  try {
    const dustTexs = await Promise.all([
      PIXI.Assets.load('assets/dust.png'),
      PIXI.Assets.load('assets/dust_puff.png'),
    ]);
    dust = window.Entities.createFootDust(world, dustTexs);
  } catch (err) {
    reportError('dust failed: ' + err.message);
  }

  // ---- Character -----------------------------------------------------------------
  let character;
  try {
    const { idleFrames, runFrames, dieFrames } = await window.Assets.loadSheets();
    character = window.Entities.createCharacter(idleFrames, runFrames, dieFrames);
    character.applySettings();
    world.addChild(character.view);
  } catch (err) {
    reportError('character failed: ' + err.message);
    return;
  }

  // ---- Camera ---------------------------------------------------------------------
  const camera = window.Camera.create(world, app);
  camera.snap(character.view.x, character.view.y);

  // ---- Sunrays + dust motes (screen-space overlay, above character) -----------------
  let effects;
  try {
    effects = window.Effects.create(app);
    app.stage.addChild(effects.layer);
  } catch (err) {
    reportError('effects failed: ' + err.message);
  }

  // ---- Live2D companion (upper body at the right edge) ------------------------------
  let live2d = window.Live2D;
  try {
    live2d && await live2d.init(app);
    document.getElementById('l2d-status').textContent = 'l2d ✓';
  } catch (err) {
    live2d = null;
    document.getElementById('l2d-status').textContent = 'l2d ✗';
    reportError('live2d failed: ' + err.message);
  }

  // ---- Enemy packs (shadow critters; wander, hunt close, despawn far) --------
  try {
    window.Enemies && await window.Enemies.init(world);
  } catch (err) {
    reportError('enemies failed: ' + err.message);
  }

  // ---- Dev panel --------------------------------------------------------------------
  window.Settings.buildPanel((key) => {
    if (key === 'scale' || key.endsWith('Fps')) character.applySettings();
    if (key === 'l2dExpr' && live2d && live2d.ready) live2d.setExpr(window.Settings.settings.l2dExpr);
    if (key === 'chatActions' && window.Chat) window.Chat.rerender(); // re-render dialog with/without *actions*
  });
  character.applySettings();

  // ---- Maid chat (local LLM; session-only history, non-fatal) --------------------
  try {
    window.Chat.init();
  } catch (err) {
    reportError('chat failed: ' + err.message);
  }

  // ---- Maid health (9 hearts; faint locks control + hides talk UI) ------------
  try {
    window.Health.init();
  } catch (err) {
    reportError('health failed: ' + err.message);
  }

  // ---- Sound manager (BGM + gear volume panel; starts on first gesture) --------------
  try {
    window.Sound.init();
  } catch (err) {
    reportError('audio failed: ' + err.message);
  }

  // ---- Edit mode (E): move/resize gear, HUD, dev panel + maid outline -----------------
  try {
    window.EditMode.init({
      // live maid screen rect (canvas px) -> edit mode converts to stage px
      maidRect: () => {
        if (!live2d || !live2d.ready) return null;
        const m = live2d.model;
        if (!m || !m.visible) return null;
        // Pixi v8: getBounds() returns a Bounds (minX/minY/maxX/maxY) — passing a
        // Rectangle here throws "clear is not a function" (v8 wants its own Bounds).
        const b = m.getBounds();
        // canvas px -> viewport CSS px (canvas is CSS-scaled inside stage-wrap);
        // edit mode's place() subtracts the stage origin itself.
        const cr = app.canvas.getBoundingClientRect();
        const scaleX = cr.width / app.screen.width;
        const scaleY = cr.height / app.screen.height;
        return {
          left: cr.left + b.minX * scaleX,
          top: cr.top + b.minY * scaleY,
          width: (b.maxX - b.minX) * scaleX,
          height: (b.maxY - b.minY) * scaleY,
        };
      },
    });
  } catch (err) {
    reportError('edit mode failed: ' + err.message);
  }

  // ---- Game loop -----------------------------------------------------------------------
  let fpsAccum = 0, fpsCount = 0, fpsTimer = 0;
  let battleCalmFor = 0; // seconds since last hostile — battle music lingers 3s
  const fpsEl = document.getElementById('fps');
  const chunkEl = document.getElementById('bg-status');

  app.ticker.add((ticker) => {
    // clamp dt: this pane throttles hard when unfocused — spikes teleport the character
    const dtSec = Math.min(ticker.deltaMS / 1000, 0.05);
    const s = window.Settings.settings;

    const a = (window.EditMode.active || (window.Health && window.Health.dead))
      ? { x: 0, y: 0 } // fainted: no control until respawn
      : window.Input.axis();
    const view = character.view;
    view.x += a.x * s.speed * dtSec;
    view.y += a.y * s.speed * dtSec;

    // INFINITE world: no bounds clamping — background chunks stream in around the camera
    character.update(a, !!(window.Health && window.Health.dead));
    if (window.Enemies) {
      try { window.Enemies.update(dtSec, view.x, view.y); }
      catch (err) { /* one bad tick must not kill the loop */ }
    }
    if (dust) dust.update(dtSec, view.x, view.y, (a.x !== 0 || a.y !== 0), a.x, a.y);
    if (window.Health) { // damage kicks the camera before it settles
      const sh = window.Health.shakeAmount();
      if (sh) camera.shake(sh);
    }
    // combat music: battle while any critter is engaged, cozy 3s after calm
    // (hysteresis so it doesn't flicker when one coward wavers)
    if (window.Sound && window.Sound.setBgmMood && window.Enemies) {
      let hot = 0;
      try { hot = window.Enemies.hostileCount(); } catch (e) { /* deaf calm */ }
      if (hot > 0) { battleCalmFor = 0; window.Sound.setBgmMood('battle'); }
      else {
        battleCalmFor += dtSec;
        if (battleCalmFor > 3) window.Sound.setBgmMood('cozy');
      }
    }
    camera.update(view.x, view.y, dtSec);

    if (background) {
      const n = background.update(view.x, view.y, app.screen.width, app.screen.height);
      chunkEl.textContent = `chunks ${n}`;
    }

    if (effects) effects.update(dtSec);
    if (live2d) live2d.apply(s);

    // fps readout
    fpsAccum += dtSec; fpsCount++; fpsTimer += dtSec;
    if (fpsTimer >= 0.5) {
      fpsEl.textContent = `${Math.round(fpsCount / fpsAccum)} fps`;
      if (live2d && live2d.ready) {
        document.getElementById('l2d-status').textContent = `l2d ✓ (${live2d.exprName})`;
      }
      fpsAccum = 0; fpsCount = 0; fpsTimer = 0;
    }
  });

  console.log('Maid test ready — infinite world build');
})();
