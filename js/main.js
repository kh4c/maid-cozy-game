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
  const { Graphics, Sprite, Texture, Text } = PIXI;
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
  let vigScale = 2; // eased: 2x tight on her, 3x while a pan holds (ring stays off-frame)
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
  // URGE BUTTON: bare "keep going!" on a click — the same trio as typing it
  // (pushed cover 6s + rest latch drop + brain note), no words needed.
  try {
    const ub = document.getElementById('urge-btn');
    if (ub) ub.addEventListener('click', () => {
      const nowMs = performance.now();
      if (nowMs < (window.__urgeReadyAt || 0)) return; // one order per cooldown — no button-mashing the maid
      window.__urgeReadyAt = nowMs + 8000;
      let legs = 'fresh legs'; // her tone bends with this; her obedience doesn't
      try {
        const st = window.Stamina && window.Stamina.state ? window.Stamina.state() : null;
        const p = st && st.pct != null ? st.pct : 1;
        legs = p < 0.3 ? 'spent legs, about to buckle' : p < 0.6 ? 'winded legs' : 'fresh legs';
      } catch (e) {}
      try { window.Input && window.Input.pushFor && window.Input.pushFor(6); } catch (e) {}
      try { window.Stamina && window.Stamina.kick && window.Stamina.kick(); } catch (e) {}
      try { window.Brain && window.Brain.note && window.Brain.note('urged'); } catch (e) {}
      try { window.Chat && window.Chat.announce && window.Chat.announce({ event: 'urge-push', legs }, 'Yes, master — moving!'); } catch (e) {} // an order gets a YES, in whatever tone her legs allow
      try { ub.classList.add('poked'); setTimeout(() => ub.classList.remove('poked'), 180); } catch (e) {}
      try { ub.classList.add('cooling'); setTimeout(() => ub.classList.remove('cooling'), 8000); } catch (e) {}
    });
  } catch (e) {}
  // FIND BUTTON: bare "keep finding" order on a click — same as typing it
  // (master-locked find posture + her salute line), one order per cooldown.
  try {
    const fb = document.getElementById('find-btn');
    if (fb) fb.addEventListener('click', () => {
      const nowMs = performance.now();
      if (nowMs < (window.__findReadyAt || 0)) return; // one order per cooldown
      window.__findReadyAt = nowMs + 8000;
      try { window.Brain && window.Brain.orderFind && window.Brain.orderFind(); } catch (e) {}
      try { fb.classList.add('poked'); setTimeout(() => fb.classList.remove('poked'), 180); } catch (e) {}
      try { fb.classList.add('cooling'); setTimeout(() => fb.classList.remove('cooling'), 8000); } catch (e) {}
    });
  } catch (e) {}

  // Spotlight follows THE MAID: center the vignette's clear hole on her screen
  // position every frame (world -> screen via the camera-shifted world container).
  // Only near the character stays bright; everything else falls to black.
  function updateVignettePos(charView) {
    if (!vignette || !vignette.visible || !charView) return;
    try {
      let wx = charView.x, wy = charView.y; // her, by default
      let panHolds = false;
      try { const s = camera && camera.spot ? camera.spot() : null; if (s) { wx = s.x; wy = s.y; panHolds = true; } } catch (e) {} // a pan holds: light what the camera shows, not her
      vigScale += ((panHolds ? 3 : 2) - vigScale) * 0.1; // breathe bigger on pans so the dark ring never enters the frame
      try { vignette.width = app.screen.width * vigScale; vignette.height = app.screen.height * vigScale; } catch (e) {}
      const sx = world.x + wx;
      const sy = world.y + wy;
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
    world.sortableChildren = true; // y-sort: feet decide who covers whom
    background.layer.zIndex = -1000; // dirt always at the bottom
    document.getElementById('bg-status').textContent = 'bg ✓';
  } catch (err) {
    reportError('background failed: ' + err.message);
  }

  // trip bubble state: created with the character below, shown by maidBubble()
  // ("ahh!" over her head on a face-plant — a sprite visual, never dialog),
  // hidden by the loop when its timer runs out.
  let tripBubble = null, tripBg = null, tripTx = null, tripBubbleT = 0;
  let launchX = 0, launchY = 0; // leftover trip-slide, eased out over ~0.3s so the fall reads as momentum, not a teleport
  function showDayBanner(dayLabel) { // dawn announcement: big day, small time — gone in ~3s
    try {
      const b = document.getElementById('day-banner');
      if (!b) return;
      const parts = String(dayLabel || '').split(' ');
      const big = b.querySelector('.big'), small = b.querySelector('.small');
      if (big) big.textContent = parts[0] || dayLabel;
      if (small) small.textContent = parts.slice(1).join(' ') + ' — a new day';
      b.style.display = 'flex';
      b.style.animation = 'none'; void b.offsetWidth; b.style.animation = ''; // restart the fade
      setTimeout(() => { try { b.style.display = 'none'; } catch (e) {} }, 3300);
    } catch (e) {}
  }
  function maidBubble(line) {
    if (!tripBubble) return;
    try {
      tripTx.text = line;
      const tw = tripTx.width || 90, th = tripTx.height || 40;
      const w = Math.min(170, tw + 30), h = 44; // small white oval, text centered
      tripBg.clear(); tripBg.beginFill(0xffffff, 0.95); tripBg.drawEllipse(w / 2, h / 2, w / 2, h / 2); tripBg.endFill();
      tripTx.position.set((w - tw) / 2, (h - th) / 2);
      tripBubbleT = 1.8; // linger, then fade with the loop
      tripBubble.visible = true;
    } catch (e) { /* a silent bubble must not break the loop */ }
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
    const { idleFrames, runFrames, dieFrames, fallFrames } = await window.Assets.loadSheets();
    character = window.Entities.createCharacter(idleFrames, runFrames, dieFrames, fallFrames);
    character.applySettings();
    world.addChild(character.view);
    tripBubble = new Container();
    tripBg = new Graphics();
    tripTx = new Text('ahh!', { fontSize: 20, fill: '#3a2a1a', fontFamily: '"Press Start 2P", monospace' });
    tripBubble.addChild(tripBg); tripBubble.addChild(tripTx);
    tripBubble.visible = false;
    world.addChild(tripBubble);
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

  // ---- Hometown (walk-to district east of spawn; decor sits under the cast) --
  try {
    window.Town && window.Town.init && await window.Town.init(world);
    world.setChildIndex(window.Town.layer || world.children[world.children.length - 1], 1);
    try { if (window.Town && window.Town.layer) window.Town.layer.zIndex = -500; } catch (e) {} // streets under actors
  } catch (err) {
    reportError('town failed: ' + err.message);
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
      try { window.Settings.settings.clockOn = 0; window.Settings.refreshControls && window.Settings.refreshControls(); } catch (e) {} // hand-set time naps the clock — manual wins
      drawNightOverlay();
      try { background && background.setNight && background.setNight(nightOn()); } catch (e) {}
    } // day/night flip, live: overlay + ground texture + Live2D tint
  });
  try { if (window.Clock) window.Clock.onFlip = () => { // the day clock flips visuals exactly like a manual flip
    drawNightOverlay();
    try { background && background.setNight && background.setNight(nightOn()); } catch (e) {}
  }; } catch (e) {}
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
    window.Shop && window.Shop.init();
    window.Bestiary && window.Bestiary.init();
    window.Equipment && window.Equipment.init();
    window.Accessories && window.Accessories.init(); // deeds + loadout, then hearts resize
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
    if (window.Shop && window.Shop.isOpen && window.Shop.isOpen()) return; // shop pause: frozen world behind the till (equipment never pauses)
    // focus beats: while the camera holds a lookAt, the WORLD runs at ~30%
    // ( slow-mo ) but the CAMERA keeps full dt — the pan stays smooth. wdt is
    // the world's dt below; dtSec stays real for camera / music / fps clocks.
    const wdt = dtSec * (camera.timeScale ? camera.timeScale(dtSec) : 1);
    const s = window.Settings.settings;

    const view = character.view;
    // COMBAT MODE: owns her feet while the battle runs (kite/strafe/dodge).
    // Runs before axis() so the combat vector outranks brain/chat orders;
    // click pins still outrank combat. Clears itself when the fight ends.
    if (window.Combat) {
      try { window.Combat.update(wdt, view.x, view.y); }
      catch (err) { /* a clumsy fighter must not kill the loop */ }
    }
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
        // urged = bare "keep going!" window (no direction): she works on his word —
        // and in the orange zone that word ALWAYS ends face-down. Directed pushes
        // (click pin / pushed order) risk only the stumble chance.
        let urged = false;
        try { urged = pushed && window.Input && window.Input.directedPush && !window.Input.directedPush(); } catch (e) {}
        window.Stamina.update(wdt, wantsMove, pushed, urged);
        if (wantsMove && !window.Stamina.canMove(pushed)) { a.x = 0; a.y = 0; } // parked or out
        if (window.Stamina.justExhausted) {
          try { window.Brain && window.Brain.note && window.Brain.note('tired'); } catch (e) {}
          try { window.Live2D && window.Live2D.setMood && window.Live2D.setMood('sleepy'); } catch (e) {}
        }
        if (window.Stamina.justTripped) { // face-plant: bubble + thud, never dialog
          try { window.Brain && window.Brain.note && window.Brain.note('trip'); } catch (e) {}
          try { maidBubble('ahh!'); } catch (e) {} // sprite bubble over her head, every trip
          try { window.Sound && window.Sound.playSfx && window.Sound.playSfx('combat', 'hurt_0.ogg', { rate: 0.7, volume: 0.6 }); } catch (e) {}
          try { camera.shake(0.55); } catch (e) {} // the ground hits back — screen takes the fall with her
          try { // momentum: she slides a step along her SPRITE facing (left/right ±30°) — never along the run vector
            let f = 1; try { f = character && character.facing ? character.facing() : 1; } catch (e) {}
            if (!f) f = 1;
            const j = (Math.random() - 0.5) * (Math.PI / 3); // ±30° of wobble, like a real stumble
            const d = 104 + (Math.random() - 0.5) * 30; // a proper tumble — no two face-plants land identical
            launchX = Math.cos(j) * f * d; launchY = Math.sin(j) * d;
          } catch (e) { launchX = 0; launchY = 0; }
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
    const spdMul = ((window.Store && typeof window.Store.speedMult === 'function') ? window.Store.speedMult() : 1) *
      ((window.Accessories && typeof window.Accessories.speedMult === 'function') ? window.Accessories.speedMult() : 1); // Swift Boots ride along
    // STOP AND SHOOT: trigger latched -> plant feet, no strafing while firing.
    // (Flee still works: legs run only when the trigger is released — [cease] to run.)
    // COMBAT MODE exempts itself: kiting/strafing/dodging keeps shooting on
    // the move — planting during a boss charge is how maids die.
    try { if (window.Gun && window.Gun.status && window.Gun.status().firing && !(window.Combat && window.Combat.dodging && window.Combat.dodging())) { a.x = 0; a.y = 0; moved = false; } } catch (e) {}
    view.x += a.x * s.speed * spdMul * wdt;
    view.y += a.y * s.speed * spdMul * wdt;
    view.zIndex = view.y; // y-sort: whoever stands lower covers whoever stands higher
    if (launchX !== 0 || launchY !== 0) { // trip-slide: ease the leftover out fast (~12/s) — a decelerating skid, not a hop
      const k = 1 - Math.exp(-12 * wdt);
      view.x += launchX * k; view.y += launchY * k;
      launchX -= launchX * k; launchY -= launchY * k;
      if (Math.abs(launchX) + Math.abs(launchY) < 0.5) { launchX = 0; launchY = 0; }
    }

    // INFINITE world: no bounds clamping — background chunks stream in around the camera
    // FACE THE ENEMY: trigger latched -> sprite faces the gun's side, not her
    // feet (art faces right at +scale). No fire -> 0, movement flips as before.
    let face = 0;
    try {
      const g = window.Gun;
      if (g && g.status && g.status().firing && g.aimSide) face = g.aimSide() | 0;
    } catch (e) { /* keep movement facing */ }
    let down = false;
    try { down = !!(window.Stamina && window.Stamina.tripped); } catch (e) {} // face-down: fall anim holds
    character.update(a, !!(window.Health && window.Health.dead), face, down);
    if (window.Enemies) {
      try { window.Enemies.update(wdt, view.x, view.y); }
      catch (err) { /* one bad tick must not kill the loop */ }
    }
    // hometown: wanderers, bubbles, pending talks, first-arrival wonder
    if (window.Town) {
      try { window.Town.update(wdt, view.x, view.y); }
      catch (err) { /* town nap */ }
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
    try { window.Clock && window.Clock.update && window.Clock.update(dtSec); } catch (e) {} // her week: Mon-Sat 9-9, night from 5PM (freezes with the shop pause)
    try { const dl = window.Clock && window.Clock.popDay ? window.Clock.popDay() : null; if (dl) showDayBanner(dl); } catch (e) {} // one banner per dawn, boot included
    if (tripBubbleT > 0) { // the "ahh!" floats over her head, then goes away
      try {
        tripBubble.position.set(view.x - 45, view.y - 180);
        tripBubble.zIndex = view.y + 1; // the "ahh!" floats above every head
        tripBubbleT -= wdt;
        if (tripBubbleT <= 0) tripBubble.visible = false;
      } catch (e) { tripBubbleT = 0; }
    }
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
