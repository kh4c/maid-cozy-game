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
  // NOTE: the canvas bg gets re-tinted for night in applyNightBg() below
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

  // ---- Day/Night overlay + vignette -------------------------------------------------------
  // Sits ABOVE the world (tiles + critters + maid) but BELOW UI. Night = deep blue
  // wash + soft vignette darkening the screen edges (torch-light feel); day = invisible.
  // Toggled live from the dev panel (WORLD tab).
  const { Graphics, Sprite, Texture } = PIXI;
  const nightOverlay = new Graphics();
  app.stage.addChild(nightOverlay);
  // vignette texture: radial gradient (transparent center -> dark edges), generated once
  function makeVignetteTexture() {
    const c = document.createElement('canvas');
    c.width = 640; c.height = 360;
    const g = c.getContext('2d');
    // SPOTLIGHT: only the area near the character stays bright — tight clear
    // circle around her, everything else falls to near-black fast.
    const grad = g.createRadialGradient(320, 180, 30, 320, 180, 240);
    grad.addColorStop(0, 'rgba(1,2,8,0)');
    grad.addColorStop(0.3, 'rgba(1,2,8,0.35)');
    grad.addColorStop(0.55, 'rgba(1,2,8,0.82)');
    grad.addColorStop(0.8, 'rgba(1,2,8,0.99)');
    grad.addColorStop(1, 'rgba(0,0,4,1)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 640, 360);
    return Texture.from(c);
  }
  let vignette = null;
  function nightOn() { return (window.Settings && Number(window.Settings.settings.worldTime) === 1); }
  function applyNightBg(on) {
    try { app.renderer.background.color = on ? 0x04040c : 0x1a1730; } catch (e) { /* cosmetic */ }
  }
  function drawNightOverlay() {
    const on = nightOn();
    applyNightBg(on);
    nightOverlay.clear();
    if (on) nightOverlay.rect(0, 0, app.screen.width, app.screen.height).fill({ color: 0x03040a, alpha: 0.3 }); // light touch — night texture is already dark, vignette owns the dark
    if (on && !vignette) {
      vignette = new Sprite(makeVignetteTexture());
      app.stage.addChild(vignette); // above the flat wash
    }
    if (vignette) {
      vignette.visible = on;
      // OVERSIZED 2x so the clear center can sit on the maid anywhere on screen
      // and the sprite still covers every corner (no gaps when she moves).
      if (on) { vignette.width = app.screen.width * 2; vignette.height = app.screen.height * 2; }
    }
    try { window.Live2D && window.Live2D.setNight && window.Live2D.setNight(on); } catch (e) { /* cosmetic */ }
  }
  drawNightOverlay();
  window.addEventListener('resize', () => setTimeout(drawNightOverlay, 0));

  // Spotlight follows THE MAID: center the vignette's clear hole on her screen
  // position every frame (world -> screen via the camera-shifted world container).
  // Only near the character stays bright; everything else falls to black.
  function updateVignettePos(charView) {
    if (!vignette || !vignette.visible || !charView) return;
    try {
      const sx = world.x + charView.x;
      const sy = world.y + charView.y;
      vignette.x = sx - vignette.width / 2;
      vignette.y = sy - vignette.height / 2;
    } catch (e) { /* cosmetic */ }
  }

  // ---- Background (infinite chunk stream) -----------------------------------------
  let background;
  try {
    background = await window.Tilemap.create();
    background.setNight(nightOn()); // boot texture matches WORLD-tab default (night)
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
  window.__maidCamera = camera; // the brain's "look at that" focus (lookAt)
  try { window.Input && window.Input.bindCanvas && window.Input.bindCanvas(app.canvas); } catch (e) {} // click-to-move pin

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
    if (live2d && live2d.ready) live2d.setNight(nightOn()); // model loads above the overlay — tint it too
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

  // ---- M1 companion gun (Brotato-style hover rig, mouse aim + click fire) ----
  try {
    window.Gun && await window.Gun.init(world, app, camera);
  } catch (err) {
    reportError('gun failed: ' + err.message);
  }

  // ---- Dev panel --------------------------------------------------------------------
  window.Settings.buildPanel((key) => {
    if (key === 'scale' || key.endsWith('Fps')) character.applySettings();
    if (key === 'l2dExpr' && live2d && live2d.ready) live2d.setExpr(window.Settings.settings.l2dExpr);
    if (key === 'chatActions' && window.Chat) window.Chat.rerender(); // re-render dialog with/without *actions*
    if (key === 'worldTime') {
      drawNightOverlay();
      try { background && background.setNight && background.setNight(nightOn()); } catch (e) {}
    } // day/night flip, live: overlay + ground texture + Live2D tint
  });
  character.applySettings();

  // ---- Maid chat (local LLM; session-only history, non-fatal) --------------------
  try {
    window.Chat.init();
  } catch (err) {
    reportError('chat failed: ' + err.message);
  }

  // ---- Situation awareness + survival brain (separate from chat) --------------
  // Situation.bind gives chat + brain her live pos/weapon/foes. Brain owns the
  // thought box + aim/auto buttons and thinks on its own LLM loop.
  try {
    window.Situation && window.Situation.bind(character);
  } catch (err) {
    reportError('situation failed: ' + err.message);
  }
  try {
    window.Brain && window.Brain.init();
  } catch (err) {
    reportError('brain failed: ' + err.message);
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

  try {
    window.Inventory && window.Inventory.init();
    window.Weapons && window.Weapons.init();
    window.Store && window.Store.init();
    window.Bestiary && window.Bestiary.init();
  } catch (err) {
    reportError('inventory failed: ' + err.message);
  }

  // ---- Stamina (she walks until tired, then rests until recovered) ---------------
  try {
    window.Stamina && window.Stamina.init();
  } catch (err) {
    reportError('stamina failed: ' + err.message);
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
    // focus beats: while the camera holds a lookAt, the WORLD runs at ~30%
    // ( slow-mo ) but the CAMERA keeps full dt — the pan stays smooth. wdt is
    // the world's dt below; dtSec stays real for camera / music / fps clocks.
    const wdt = dtSec * (camera.timeScale ? camera.timeScale(dtSec) : 1);
    const s = window.Settings.settings;

    const view = character.view;
    const a = (window.EditMode.active || (window.Health && window.Health.dead))
      ? { x: 0, y: 0 } // fainted: no control until respawn
      : window.Input.axis(view.x, view.y); // click pin (yours) or AI orders (hers)
    // STAMINA: moving drains the tank; at empty she plants her feet and rests
    // (control locked — clicks, chat walks AND brain runs all stop) until she
    // catches her breath. Moving into exhaustion is allowed; moving after isn't.
    const wantsMove = (a.x !== 0 || a.y !== 0);
    let moved = false;
    if (window.Stamina) {
      try {
        // pushed = player-owned feet (click pin / player chat order): may drain
        // past quarter to empty. Auto legs park at 1/4 and resume at ~half.
        const pushed = !!(window.Input && window.Input.pushedActive && window.Input.pushedActive());
        window.Stamina.update(wdt, wantsMove, pushed);
        if (wantsMove && !window.Stamina.canMove(pushed)) { a.x = 0; a.y = 0; } // parked or out
        if (window.Stamina.justExhausted) {
          try { window.Brain && window.Brain.note && window.Brain.note('tired'); } catch (e) {}
          try { window.Live2D && window.Live2D.setMood && window.Live2D.setMood('sleepy'); } catch (e) {}
        }
        if (window.Stamina.justRested) {
          try { window.Brain && window.Brain.note && window.Brain.note('resting'); } catch (e) {}
        }
        if (window.Stamina.justRecovered) {
          try { window.Brain && window.Brain.note && window.Brain.note('rested'); } catch (e) {}
        }
        moved = wantsMove && window.Stamina.canMove(pushed);
      } catch (err) { moved = wantsMove; }
    } else {
      moved = wantsMove;
    }
    const spdMul = (window.Store && typeof window.Store.speedMult === 'function') ? window.Store.speedMult() : 1;
    view.x += a.x * s.speed * spdMul * wdt;
    view.y += a.y * s.speed * spdMul * wdt;

    // INFINITE world: no bounds clamping — background chunks stream in around the camera
    character.update(a, !!(window.Health && window.Health.dead));
    if (window.Enemies) {
      try { window.Enemies.update(wdt, view.x, view.y); }
      catch (err) { /* one bad tick must not kill the loop */ }
    }
    // hover gun: the maid always aims/fires herself now (cursor aim removed)
    if (window.Gun) {
      try { window.Gun.update(wdt, view.x, view.y); }
      catch (err) { /* a gun hiccup must not kill the loop */ }
    }
    // survival brain: auto-thinks when danger nears (own LLM loop + thought box)
    if (window.Brain) {
      try { window.Brain.tick(wdt); }
      catch (err) { /* a scared brain must not kill the loop */ }
    }
    // coin drops: magnet toward her feet + pickup
    if (window.Inventory) {
      try { window.Inventory.update(wdt, view.x, view.y); }
      catch (err) { /* loot is cosmetic */ }
    }
    // player swing (Space/J): whoosh always, thump + pack retaliation on hits
    if (window.Input.attackPressed && window.Input.attackPressed()) {
      const down = !!(window.Health && window.Health.dead);
      if (!down && !window.EditMode.active) {
        try { window.Sound && window.Sound.playSfx('combat', 'swing.ogg', { rate: 0.95 + Math.random() * 0.15 }); } catch (e) {}
        let hits = 0;
        try { hits = window.Enemies ? window.Enemies.playerAttack(view.x, view.y, 95) : 0; } catch (e) {}
        if (hits > 0) {
          try { window.Sound && window.Sound.playSfx('combat', 'hurt_' + ((Math.random() * 5) | 0) + '.ogg', { rate: 1.1 }); } catch (e) {}
          camera.shake(0.3);
        }
      }
    }
    if (dust) dust.update(wdt, view.x, view.y, moved, a.x, a.y);
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
    updateVignettePos(view); // spotlight tracks the maid, not screen center

    if (background) {
      const n = background.update(view.x, view.y, app.screen.width, app.screen.height);
      chunkEl.textContent = `chunks ${n}`;
    }

    if (effects) effects.update(wdt);
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
