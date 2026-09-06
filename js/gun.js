// M1 Garand companion — Brotato-style hovering gun.
// The sprite floats beside the maid, tracks the mouse, fires on click/hold.
// Juice: recoil kick + muzzle tilt, camera pop, additive muzzle flash,
// tracer bullets, hit sparks with knockback, layered shoot/hit sounds.
window.Gun = (() => {
  const { Container, Sprite } = PIXI;

  // tuning — all game-feel
  const HOVER_X = 26, HOVER_Y = -40;   // rest offset from her feet anchor
  const BOB_FREQ = 2.4, BOB_AMP = 4;   // idle hover bob
  // Shots come from the weapon system (js/weapons.js) — the rifle is entry #1.
  // W() reads the active row live so future guns/melee need no gun surgery.
  const W = (k, fb) => { try { const w = window.Weapons; return (w && typeof w[k] === 'function') ? w[k]() : fb; } catch (e) { return fb; } };
  const HIT_R = 44;                    // bullet splash vs critters (they're big)
  function setDamage(d) { try { if (window.Weapons) window.Weapons.setActiveDamage(d); } catch (e) {} } // store upgrades ride the active weapon row
  const RECOIL_DIST = 13, RECOIL_TILT = 0.38;
  const GUN_SCALE = 1.8;               // big iron (was 1.15)

  let world = null, app = null, camera = null;
  let rig = null, gunSpr = null, flash = null;
  let bullets = [], sparks = [];
  let texGun, texShotgun, texBullet, texFlash, texSpark, texCube;
  let curTex = 'm1'; // rig sprite tracks the equipped row — swaps live, mid-fight
  let cd = 0, recoil = 0, bobT = 0, flashT = 0;
  let shotsFired = 0; // M1 clip: every 8th round the en-bloc pings out
  let holding = false, mouseSX = 0, mouseSY = 0; // mouse in canvas css px
  let px = 0, py = 0;                            // her feet (world), set each frame

  // ---- aim authority: 'mouse' (you) vs 'ai' (the maid) ----------------------
  // The maid owns the gun by DEFAULT now — cursor aim is gone. setAimMode is
  // kept for programmatic use but the game always runs in 'ai'.
  let aimMode = 'ai';
  let aiAim = null;        // { x, y, until } world point — Brain's aim order
  let aiFireUntil = 0;     // performance.now() ms — hold trigger until then
  let lastAimX = null, lastAimY = null; // held aim — gun never snaps to the cursor
  try { if (window.Settings && window.Settings.settings) window.Settings.settings.aimMode = 'ai'; } catch (e) {} // migrate old 'mouse' saves
  try {
    const raw = localStorage.getItem('maid-test-settings');
    if (raw) { const p = JSON.parse(raw); } // legacy saves may hold aimMode — ignored, always 'ai'
  } catch (e) { /* fresh save */ }

  function setAimMode(m) {
    aimMode = 'ai'; // cursor aim removed — she always owns the gun
    try {
      if (window.Settings && window.Settings.settings) {
        window.Settings.settings.aimMode = 'ai';
      }
    } catch (e) { /* persistence is cosmetic */ }
    try { refreshAimBtn(); } catch (e) {}
    return aimMode;
  }
  function toggleAim() { return aimMode; } // kept for compat — no toggle anymore
  function getAimMode() { return aimMode; }

  // Brain orders: aim at a world point / direction for `secs`
  function aiAimAt(wx, wy, secs) {
    const s = Math.max(0.5, Math.min(10, Number(secs) || 3));
    aiAim = { x: Number(wx) || 0, y: Number(wy) || 0, until: performance.now() + s * 1000 };
  }
  function aiAimDir(dx, dy, secs) {
    const len = Math.hypot(dx, dy) || 1;
    aiAimAt(px + (dx / len) * 400, py + (dy / len) * 400, secs);
  }
  function aiAimNearest(secs) {
    try {
      if (window.Enemies && typeof window.Enemies.nearest === 'function') {
        const n = window.Enemies.nearest(px, py);
        if (n) { aiAimAt(n.x, n.y, secs); return true; }
      }
    } catch (e) {}
    return false;
  }
  // which way the gun is pointing, world-x: -1 enemy-left, +1 enemy-right.
  // main.js feeds it to the sprite while the trigger is latched (attack-face
  // override); 0 inside the dead zone = hold last side, no jitter.
  function aimSide() {
    if (lastAimX === null) return 0;
    const dx = lastAimX - px;
    return dx < -8 ? -1 : dx > 8 ? 1 : 0;
  }
  function aiFire(secs) {
    const s = Math.max(0.3, Math.min(10, Number(secs) || 2));
    aiFireUntil = Math.max(aiFireUntil, performance.now() + s * 1000);
  }
  function aiCease() { aiFireUntil = 0; }
  function status() {
    const now = performance.now();
    const firing = aimMode === 'ai' ? now < aiFireUntil : holding;
    return { mode: aimMode, firing, bullets: bullets.length, shown: !!(rig && rig.visible),
      aiAimValid: !!(aiAim && now < aiAim.until) };
  }

  // ---- mouse tracking (legacy — cursor aim removed; the maid owns the gun) --
  // Listeners stay attached only so old saves / old code paths don't crash;
  // in 'ai' mode the mouse position is never used for aiming or firing.
  function onMove(e) {
    if (aimMode === 'ai') return; // cursor is not her master
    const r = app.canvas.getBoundingClientRect();
    mouseSX = e.clientX - r.left;
    mouseSY = e.clientY - r.top;
  }
  function onDown(e) {
    // only the game canvas — clicks on HUD/chat/panel buttons never fire.
    // AI aim mode: your mouse is DISABLED by design — the maid owns the gun.
    if (e.button !== 0 || e.target !== app.canvas) return;
    if (aimMode === 'ai') return;
    holding = true;
    onMove(e);
  }
  function onUp() { holding = false; }

  // css px -> world px (camera offset lives on the world container)
  function screenToWorld() {
    const r = app.canvas.getBoundingClientRect();
    const sx = mouseSX / r.width * app.screen.width;
    const sy = mouseSY / r.height * app.screen.height;
    return { x: sx - world.x, y: sy - world.y };
  }

  // ---- effects --------------------------------------------------------------
  // Hit strike: one white-hot core + a few tiny embers, fast + short.
  // A small crisp pop on the hide — no lingering glow cloud.
  function burst(x, y, n, big) {
    if (big) { tntBurst(x, y); return; } // kills pop cubes, not glow
    const mk = (tint, sc, sp) => {
      const a = Math.random() * Math.PI * 2;
      const s = new Sprite(texSpark);
      s.anchor.set(0.5, 0.5); s.blendMode = 'add'; s.tint = tint;
      s.scale.set(sc); s.position.set(x, y); world.addChild(s);
      sparks.push({ spr: s, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
        life: 0, max: 0.16 + Math.random() * 0.1 });
    };
    mk(0xffffff, 0.035, 120); // white-hot core
    for (let i = 0; i < 4; i++) mk(0xffc46b, 0.018 + Math.random() * 0.014, 200 + Math.random() * 220); // embers
  }

  // TNT kill pop (minecraft-style): solid white + grey SQUARES with gravity +
  // spin, normal blend — chunky tumbling cubes, not glow. Plus a white blink.
  const TNT_TINTS = [0xffffff, 0xffffff, 0xe8e8e8, 0xbdbdbd, 0x8a8a8a];
  function tntBurst(x, y) {
    const base = (typeof texCube !== 'undefined' && texCube && texCube.valid !== false) ? texCube : texSpark;
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 120 + Math.random() * 340;
      const s = new Sprite(base);
      s.anchor.set(0.5, 0.5);
      s.tint = TNT_TINTS[(Math.random() * TNT_TINTS.length) | 0];
      s.scale.set(0.5 + Math.random() * 0.7); // 14px cube -> 7-17px chunks
      s.rotation = Math.random() * Math.PI * 2;
      s.position.set(x + (Math.random() - 0.5) * 10, y + (Math.random() - 0.5) * 10);
      world.addChild(s);
      sparks.push({ spr: s, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 160,
        life: 0, max: 0.5 + Math.random() * 0.45, g: 900, spin: (Math.random() - 0.5) * 20 });
    }
    if (texSpark && texSpark.valid !== false) { // white blink, gone in a breath
      const f = new Sprite(texSpark);
      f.anchor.set(0.5, 0.5); f.blendMode = 'add'; f.tint = 0xffffff;
      f.scale.set(0.3); f.position.set(x, y); world.addChild(f);
      sparks.push({ spr: f, vx: 0, vy: 0, life: 0, max: 0.12 });
    }
    if (camera) camera.shake(0.22); // TNT thud
  }

  function fire(ax, ay) {
    const mx = px + HOVER_X + ax * 70, my = py + HOVER_Y + ay * 70; // muzzle tip: 64px sprite x1.8, grip at 0.35
    const n = Math.max(1, Math.round(W('pellets', 1) || 1)); // trigger pulls a fan on multi-pellet rows
    const fan = Number(W('spread', 0)) || 0;
    const baseA = Math.atan2(ay, ax);
    for (let i = 0; i < n; i++) {
      const off = n > 1 ? ((i / (n - 1)) - 0.5) * fan + (Math.random() - 0.5) * 0.05 : 0;
      const a = baseA + off, dx = Math.cos(a), dy = Math.sin(a);
      const spr = new Sprite(texBullet);
      spr.anchor.set(0.5, 0.5);
      spr.scale.set(W('slugScale', 0.3)); // fast needle, not a lobbed slug
      spr.rotation = a;
      spr.position.set(mx, my);
      world.addChild(spr);
      bullets.push({ spr, vx: dx * W('projSpeed', 1400), vy: dy * W('projSpeed', 1400), life: W('projLife', 0.6) });
    }

    // muzzle flash sits ON the muzzle tip (64px sprite x1.8, grip at 0.35 -> ~75px), gone in a blink
    flash.position.set(ax * 74, ay * 74);
    flash.rotation = Math.atan2(ay, ax) + Math.PI / 2; // muzzle art is VERTICAL (222x412) — +90° lays its long axis along the aim
    flash.scale.set(0.13 + Math.random() * 0.08);
    flash.scale.y *= Math.random() < 0.5 ? 1 : -1;
    flash.visible = true;
    flashT = 0.05;

    recoil = W('recoilMul', 1.5); // kick back + muzzle up, decays in update()

    shotsFired += 1; // reload sounds on the row's own clock (M1 clip pings every 8th, pump rack every 6th)
    if (shotsFired % Math.max(1, W('pingEvery', 8) || 8) === 0) {
      try { const pf = W('ping', null); if (pf) window.Sound.playSfx('combat', pf, { rate: 1 }); } catch (e) {}
    }

    // layered shot: WAV body + high snap (row's sfx/rate — slow guns sound deep)
    try { window.Sound.playSfx('combat', W('shotSfx', 'gunshot.wav'), { rate: W('shotRate', 0.55) + Math.random() * 0.1 }); } catch (e) {}
    try { window.Sound.playSfx('combat', 'swing.ogg', { rate: 1.6 + Math.random() * 0.2, volume: 0.3 }); } catch (e) {}
    if (camera) camera.shake(n > 1 ? 0.18 : 0.1); // thunder kicks harder than needles
  }

  // strike: guns spawn a slug, melee swings an arc — same kill accounting
  function strike(ca, sa) {
    if (W('kind', 'gun') === 'melee') { meleeSwing(ca, sa); return; }
    fire(ca, sa);
  }
  function meleeSwing(ca, sa) {
    const reach = W('meleeReach', 90), arc = W('meleeArc', 70);
    const ix = px + HOVER_X + ca * reach, iy = py + HOVER_Y + sa * reach;
    flash.position.set(ca * 30 + 6, sa * 30);
    flash.rotation = Math.atan2(sa, ca) + Math.PI / 2; // vertical art — lay it along the swing
    flash.scale.set(0.2); flash.visible = true; flashT = 0.08;
    recoil = W('recoilMul', 1);
    try { window.Sound.playSfx('combat', W('shotSfx', 'swing.ogg'), { rate: W('shotRate', 1.2) }); } catch (e) {}
    if (camera) camera.shake(0.12);
    try {
      const res = window.Enemies && window.Enemies.damageAt(ix, iy, arc, W('damage', 8));
      if (res && res.hits > 0) accountHits(res, ix, iy);
    } catch (e) {}
  }
  // shared kill accounting: pops, counters, loot, hit sounds, shake
  function accountHits(res, hx, hy) {
    for (const p of res.deaths) burst(p.x, p.y - 14, 12, true); // kill pop
    burst(hx, hy, 6, false);                                    // hit sparks
    try {
      // kills split by kind: pack critters feed the critter counter,
      // lone hunters feed the hunter counter — never mixed.
      const hk = res.hunterKills | 0, pk = Math.max(0, (res.kills | 0) - hk);
      if (window.Brain && window.Brain.note) {
        if (pk > 0) window.Brain.note('kill', pk);
        if (hk > 0) window.Brain.note('hunterkill', hk);
      }
    } catch (e) {}
    // loot: each kill pays its appraised price in coins (Inventory picks up)
    try {
      for (const d of res.deaths) {
        const val = Math.max(1, Math.min(60, (d.value | 0) || 2));
        window.Inventory && window.Inventory.drop(d.x, d.y, val);
      }
    } catch (e) {}
    try { window.Sound.playSfx('combat', 'hit_' + ((Math.random() * 4) | 0) + '.ogg',
      { rate: 0.95 + Math.random() * 0.25, volume: 0.9 }); } catch (e) {}
    if (res.kills > 0) {
      try { window.Sound.playSfx('combat', 'hurt_' + ((Math.random() * 5) | 0) + '.ogg',
        { rate: 0.75, volume: 0.7 }); } catch (e) {}
      if (camera) camera.shake(0.28);
    } else if (camera) camera.shake(0.14);
  }

  // ---- lifecycle ------------------------------------------------------------
  async function init(worldContainer, appRef, cam) {
    world = worldContainer; app = appRef; camera = cam;
    [texGun, texShotgun, texBullet, texFlash, texSpark] = await Promise.all([
      PIXI.Assets.load('assets/m1.png'),
      PIXI.Assets.load('assets/shotgun.png'),
      PIXI.Assets.load('assets/bullet.png'),
      PIXI.Assets.load('assets/muzzle.png'),
      PIXI.Assets.load('assets/spark.png'),
    ]);
    try { // TNT cube: one 14px white square, tinted per-cube at burst time
      const c = document.createElement('canvas'); c.width = c.height = 14;
      c.getContext('2d').fillStyle = '#ffffff';
      c.getContext('2d').fillRect(0, 0, 14, 14);
      texCube = PIXI.Texture.from(c);
    } catch (e) { texCube = texSpark; }

    rig = new Container();
    gunSpr = new Sprite(texGun);
    gunSpr.anchor.set(0.35, 0.5); // pivot at the grip — swings around it
    gunSpr.scale.set(GUN_SCALE);
    flash = new Sprite(texFlash);
    flash.anchor.set(0.15, 0.5);
    flash.blendMode = 'add';
    flash.visible = false;
    rig.addChild(gunSpr, flash);
    world.addChild(rig); // after enemies -> renders above them

    // coins render between enemies and the gun
    try { window.InventoryLayer = new window.PIXI.Container(); world.addChild(window.InventoryLayer); } catch (e) {}

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('blur', onUp);
  }

  function update(dt, cx, cy) {
    if (!rig) return;
    px = cx; py = cy;
    bobT += dt;
    cd -= dt;
    recoil *= Math.exp(-11 * dt);
    if (flashT > 0) { flashT -= dt; if (flashT <= 0) flash.visible = false; }

    const blocked = (window.EditMode && window.EditMode.active) ||
      (window.Health && window.Health.dead);
    if (blocked) holding = false;
    if (blocked) aiFireUntil = 0;

    // aim point: ALWAYS hers now — the cursor is never consulted. With no
    // fresh order she tracks the nearest critter in her 500px circle herself
    // (self-defense fallback), else holds her last aim so the gun never snaps
    // toward the mouse.
    let aimWX, aimWY, firing;
    if (aimMode === 'ai') {
      const now = performance.now();
      firing = now < aiFireUntil && !blocked;
      let tgt = (aiAim && now < aiAim.until) ? aiAim : null;
      if (!tgt) {
        try {
          const n = window.Enemies && window.Enemies.nearest ? window.Enemies.nearest(px, py, 650) : null;
          if (n) tgt = { x: n.x, y: n.y };
        } catch (e) {}
      }
      if (tgt) { lastAimX = tgt.x; lastAimY = tgt.y; }
      else if (lastAimX === null) { lastAimX = px + 300; lastAimY = py + HOVER_Y; }
      aimWX = lastAimX; aimWY = lastAimY;
    } else {
      const w = screenToWorld();
      aimWX = w.x; aimWY = w.y;
      firing = holding && !blocked;
    }
    const aim = Math.atan2(aimWY - (py + HOVER_Y), aimWX - (px + HOVER_X));
    const ca = Math.cos(aim), sa = Math.sin(aim);

    // hover beside her + bob, kicked back along the aim while recoiling
    const bob = Math.sin(bobT * BOB_FREQ) * BOB_AMP;
    rig.position.set(
      px + HOVER_X - ca * RECOIL_DIST * recoil,
      py + HOVER_Y + bob - sa * RECOIL_DIST * recoil);
    gunSpr.rotation = aim - RECOIL_TILT * recoil; // muzzle jumps up
    gunSpr.scale.y = GUN_SCALE * (ca < 0 ? -1 : 1); // no upside-down gun aiming left
    flash.rotation = aim;

    if (firing && cd <= 0) { cd = W('cooldown', 0.85); strike(ca, sa); }

    // EQUIP SWAP: the rig sprite follows the weapon row — equip mid-fight and
    // the iron in her hands changes on the next frame, no re-init.
    try {
      const want = W('gunTex', 'm1');
      if (want !== curTex) { gunSpr.texture = want === 'shotgun' ? texShotgun : texGun; curTex = want; }
    } catch (e) { /* a missing skin never stops the shooting */ }

    // HIDE WHEN RUNNING (dev option gunHide=1): iron only comes out to shoot —
    // latch the trigger and the gun is there, cease and it's gone. Bullets and
    // Bullets live on the world layer, so fired shots keep flying while hidden.
    try {
      const hide = window.Settings && Number(window.Settings.settings.gunHide) === 1;
      rig.visible = hide ? !!firing : true;
    } catch (e) { rig.visible = true; }

    // FACE THE ENEMY: while the trigger is latched she turns head + eyes to
    // the target's side (Live2D carries it — the overlay can't turn around).
    // 30px dead zone: straight above/below holds the last side, no jitter.
    // Trigger released -> 0, head eases back to idle sway.
    try {
      const L2D = window.Live2D;
      if (L2D && L2D.setCombatLook) {
        if (!firing) L2D.setCombatLook(0);
        else {
          const fdx = aimWX - px;
          if (fdx < -30) L2D.setCombatLook(-1);
          else if (fdx > 30) L2D.setCombatLook(1);
        }
      }
    } catch (e) { /* cosmetic */ }

    // bullets: fly, splash-check critters, die
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.life -= dt;
      b.spr.x += b.vx * dt;
      b.spr.y += b.vy * dt;
      // No tracer trail — shedding a glow per bullet per frame (6 pellets x 60fps)
      // built a fat additive rope no scale could slim. Slug + muzzle + hit sparks only.
      let dead = b.life <= 0;
      if (!dead && window.Enemies) {
        try {
          const res = window.Enemies.damageAt(b.spr.x, b.spr.y, HIT_R, W('damage', 4));
          if (res.hits > 0) { dead = true; accountHits(res, b.spr.x, b.spr.y); }
        } catch (e) { /* deaf frame */ }
      }
      if (dead) { world.removeChild(b.spr); b.spr.destroy(); bullets.splice(i, 1); }
    }

    // sparks: fly out, drag, shrink, fade
    for (let i = sparks.length - 1; i >= 0; i--) {
      const p = sparks[i];
      p.life += dt;
      const t = p.life / p.max;
      if (t >= 1) { world.removeChild(p.spr); p.spr.destroy(); sparks.splice(i, 1); continue; }
      p.spr.x += p.vx * dt;
      p.spr.y += p.vy * dt;
      p.vy += (p.g || 0) * dt; // TNT cubes fall; sparks fly straight
      if (p.spin) p.spr.rotation += p.spin * dt; // cubes tumble
      p.vx *= Math.exp(-4 * dt);
      p.vy *= Math.exp(-(p.g ? 0.6 : 4) * dt); // cubes keep falling, sparks drag fast
      p.spr.alpha = 1 - t;
      p.spr.scale.set(Math.max(0.02, p.spr.scale.x * Math.exp(-2.5 * dt)));
    }
  }

  // test/inspection hook
  function debug() {
    return { bullets: bullets.length, sparks: sparks.length, holding,
      aimMode, aiFiring: performance.now() < aiFireUntil, recoil: +recoil.toFixed(2) };
  }

  // aim button label sync (Brain.js owns the button; gun calls this on change)
  function refreshAimBtn() {
    try { window.Brain && window.Brain.syncButtons && window.Brain.syncButtons(); } catch (e) {}
  }

  return { init, update, debug, status, aimSide,
    setAimMode, toggleAim, getAimMode,
    aiAimAt, aiAimDir, aiAimNearest, aiFire, aiCease,
    bulletDamage: () => W('damage', 4), setDamage, rangePx: () => W('rangePx', 840) };
})();
