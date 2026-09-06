// Lode — the 🧲 Lodestone Drone. A 🏪 shop deed (350c) flown from the 🎒 PETS tab.
// No leash, no loop: it wanders the screen at one fixed pace (nearby dreams,
// never a dash, nev...[truncated]
// it hangs a storm cone — narrow at the rotor, wide on the grass — drawn
// slightly from the side (flattened mouth ellipse, not a top-down circle).
// Everything inside the mouth is SLOWED to half speed AND zapped for 1dmg
// every second (payouts ride the scout-proven damageAt → accountHits path).
// Benched it stays home: no drone, no cone, no storm.
window.Lode = (() => {
  const { Sprite, AnimatedSprite } = PIXI;
  // tuning — all game-feel, one number each
  const PRICE = 350;
  const LODE_SCALE = 1.5, ANIM_SPD = 0.35;               // same rotor flicker
  const DROP = 70;         // altitude: the ground point hangs 70px under its feet
  const ROAM_X = 380, ROAM_Y = 260; // drift box half-extents around her — the screen, not her heels
  const SPD = 120, FETCH_SPD = 180; // px/s — ONE pace everywhere, the commute only slightly brisker. No easing, no bursts, no teleports
  const FETCH_R = 700;     // spots loose coins this far from its ground point
  const SCOOP_R = 50;      // swallows coins this close (at the ground point)
  const SNARE_R = 140, SNARE_F = 0.5; // the storm mouth: half speed inside
  const ZAP_CD = 1.0, ZAP_DMG = 1;    // electric tick — polite, not a second rifle
  const LEASH = 900;       // she outruns it this far and it comes home
  const OWN_KEY = 'cosette.lode';

  let world = null, spr = null, cone = null;
  let sh = null; // blob shadow on the grass below — the mouth center, altitude you can read
  let t = 0, zd = 0, zapFlash = 0;
  let dx = 0, dy = 0; // smoothed air feet; ground point is (dx, dy + DROP)
  let rot = 0, lx = null, ly = null; // nose heading + last feet (art faces UP, so heading aims the nose)
  let roamTx = null, roamTy = 0; // the current dream — nearby, so it wanders instead of crossing
  let owned = false, on = false;     // the deed + the tab

  function load() {
    try {
      const raw = localStorage.getItem(OWN_KEY);
      if (raw) { const p = JSON.parse(raw); owned = !!p.owned; on = !!p.on && !!p.owned; }
    } catch (e) {}
  }
  function save() { try { localStorage.setItem(OWN_KEY, JSON.stringify({ owned, on })); } catch (e) {} }

  function price() { return PRICE; }
  function owns() { return owned; }
  function equipped() { return on && owned; }

  function buy() {
    if (owned) return { ok: false, why: 'owned' };
    if (!window.Inventory || typeof window.Inventory.spend !== 'function') return { ok: false, why: 'no purse' };
    if (!window.Inventory.spend(PRICE)) return { ok: false, why: 'too poor' };
    owned = true; on = true; save(); // bought means flying — it rides home humming, bench it in 🎒 PETS if you'd rather walk alone
    try { window.Sound && window.Sound.playSfx('combat', 'coin.ogg', { rate: 1.4, volume: 0.5 }); } catch (e) {}
    return { ok: true, name: 'Lodestone Drone' };
  }
  function equip() { if (!owned) return false; on = true; save(); return true; }
  function unequip() { on = false; save(); return true; }
  function toggle() { if (equipped()) { unequip(); return true; } return equip(); } // PETS grid: always truthy on success (fly AND bench repaint)
  function known(id) { return id === 'lode'; }

  function describe() {
    return `Lodestone Drone ${PRICE}c (🏪 shop, 🎒 PETS tab): roams the screen on its own, fetches loose coins into her purse, and hangs a storm cone over the field — everything in its 140px mouth moves at half speed and takes 1 electric dmg every second. Kills pay full coins. Owned: ${owned ? 'yes' : 'no'}. Flying: ${equipped() ? 'yes' : 'benched'}.`;
  }

  async function init(w) {
    world = w;
    load();
    try {
      const loaded = await PIXI.Assets.load('assets/drone2.png');
      const base = (loaded && loaded.texture) || loaded;
      const slice = window.Assets.makeSlicer(base, 32, 32);
      const frames = [slice(0, 0), slice(1, 0), slice(2, 0), slice(3, 0)]; // 4-frame rotor loop
      spr = new AnimatedSprite(frames);
      spr.anchor.set(0.5);
      spr.scale.set(LODE_SCALE);
      spr.animationSpeed = ANIM_SPD;
      spr.play();
      spr.visible = false;
      world.addChild(spr);
    } catch (e) { spr = null; }
    try { // the storm cone: redrawn every frame, crackling — one Graphics, no garbage
      cone = new PIXI.Graphics();
      cone.blendMode = 'add'; // lightning glows day and night
      cone.visible = false;
      world.addChild(cone);
    } catch (e) { cone = null; }
    try {
      sh = new PIXI.Graphics();
      sh.ellipse(0, 0, 16, 6).fill({ color: 0x000000, alpha: 0.3 });
      sh.visible = false;
      world.addChild(sh);
    } catch (e) { sh = null; }
  }

  function bolt(c, x0, y0, x1, y1, bright) { // one jagged arc, 5 joints — lightning never draws straight
    try {
      c.moveTo(x0, y0);
      for (let i = 1; i <= 5; i++) {
        const k = i / 5;
        c.lineTo(x0 + (x1 - x0) * k + (Math.random() - 0.5) * 36, y0 + (y1 - y0) * k + (Math.random() - 0.5) * 24);
      }
      c.stroke({ color: 0xcfeaff, width: 2, alpha: 0.35 + bright * 0.5 });
    } catch (e) {}
  }

  function drawCone(gx, gy) { // mouth on the grass, rotor at the throat — slightly from the side
    if (!cone) return;
    try {
      cone.position.set(0, 0);
      cone.clear();
      const RY = SNARE_R * 0.38; // flattened: a ground circle seen slightly from the side
      cone.ellipse(gx, gy, SNARE_R, RY).fill({ color: 0x3fa8ff, alpha: 0.06 }); // faint wash over the slow zone
      cone.ellipse(gx, gy, SNARE_R, RY).stroke({ color: 0x9fd8ff, width: 2, alpha: 0.28 }); // the mouth rim
      for (const a of [Math.PI * 0.15, Math.PI * 0.35, Math.PI * 0.65, Math.PI * 0.85]) { // cone walls, throat to rim
        cone.moveTo(dx, dy);
        cone.lineTo(gx + Math.cos(a) * SNARE_R, gy + Math.sin(a) * RY);
        cone.stroke({ color: 0x9fd8ff, width: 2, alpha: 0.22 });
      }
      for (let b = 0; b < 3; b++) { // loose arcs, re-rolled every frame — the crackle
        bolt(cone, dx + (Math.random() - 0.5) * 40, dy + 8,
          gx + (Math.random() - 0.5) * SNARE_R * 1.6, gy + (Math.random() - 0.5) * RY * 1.6, zapFlash);
      }
    } catch (e) { /* a missed frame crackles nothing */ }
  }

  function zap(gx, gy) { // the electric tick — same payout road as every other kill
    let res = null;
    try { res = window.Enemies && window.Enemies.damageAt ? window.Enemies.damageAt(gx, gy, SNARE_R, ZAP_DMG) : null; } catch (e) {}
    if (res && res.hits > 0) {
      try { window.Gun && window.Gun.accountHits && window.Gun.accountHits(res, gx, gy); } catch (e) {}
      zapFlash = 1; // the whole cone flares on a connect
      try { if (window.Gun && window.Gun.blip) window.Gun.blip(gx, gy, 0.6); } catch (e) {}
      try { window.Sound && window.Sound.playSfx('combat', 'hit_1.ogg', { rate: 1.7, volume: 0.14 }); } catch (e) {} // the crackle
    }
  }

  function update(wdt, px, py) {
    if (!spr) return;
    spr.visible = equipped();
    if (cone) cone.visible = equipped();
    if (sh) sh.visible = equipped();
    if (!equipped()) return;
    t += wdt; zd -= wdt;
    zapFlash = Math.max(0, zapFlash - wdt * 3);
    let dead = false;
    try { dead = !!(window.Health && window.Health.dead); } catch (e) {}
    if (!dx && !dy) { dx = px; dy = py - 100; } // first frame: above her, never flying in from origin
    const gx = dx, gy = dy + DROP;
    // a loose coin is a commute; otherwise dream a new drift every few seconds
    let tx = null, ty = 0, fetching = false;
    if (!dead) {
      try {
        const near = window.Inventory && window.Inventory.dropsNear ? window.Inventory.dropsNear(gx, gy, FETCH_R) : null;
        if (near && near.nearest) { tx = gx + near.nearest.dx; ty = (gy + near.nearest.dy) - DROP; fetching = true; }
      } catch (e) {}
    }
    if (!fetching && !dead) {
      if (roamTx === null || Math.hypot(roamTx - dx, roamTy - dy) < 12) {
        roamTx = Math.max(px - ROAM_X, Math.min(px + ROAM_X, dx + (Math.random() * 2 - 1) * 240)); // nearby dreams only — wander, never cross
        roamTy = Math.max(py - 100 - ROAM_Y, Math.min(py - 100 + ROAM_Y, dy + (Math.random() * 2 - 1) * 180));
      }
      tx = roamTx; ty = roamTy;
    }
    if (tx === null) { tx = px; ty = py - 100; } // dead or dreamless: hold above her
    if (!dead && Math.hypot(dx - px, dy - py) > LEASH) { tx = px; ty = py - 100; } // she outran it — it walks home at the same pace, never blinks over
    const spd = fetching ? FETCH_SPD : SPD;
    const mdx = tx - dx, mdy = ty - dy, mdist = Math.hypot(mdx, mdy);
    if (mdist > 1) { const step = Math.min(mdist, spd * wdt); dx += mdx / mdist * step; dy += mdy / mdist * step; }
    const nx = dx, ny = dy + DROP;
    spr.position.set(dx, dy);
    if (sh) { sh.position.set(nx, ny); sh.zIndex = ny; } // the mouth center — sorted with the grass, below the iron
    try { // face travel — but mid-fetch the nose locks onto the coin, not the flight path
      if (lx === null) { lx = dx; ly = dy; }
      const vx = dx - lx, vy = dy - ly;
      lx = dx; ly = dy;
      let want = null;
      if (fetching && Math.hypot(tx - dx, ty - dy) < FETCH_R) {
        want = Math.atan2(ty - dy, tx - dx) + Math.PI / 2; // fetching: stare it down
      } else if (vx * vx + vy * vy > 0.04) { // ~0.2px/frame dead zone — no spin on the drift
        want = Math.atan2(vy, vx) + Math.PI / 2;
      }
      if (want !== null) {
        let dr = want - rot;
        while (dr > Math.PI) dr -= Math.PI * 2;
        while (dr < -Math.PI) dr += Math.PI * 2;
        rot += dr * Math.min(1, 10 * wdt); // bank onto it, never snap
      }
      spr.rotation = rot;
    } catch (e) {}
    spr.zIndex = Math.max(dy, py + 4); // it flies higher than the scout (+3) — over her head always, honest y-sort everywhere else
    if (!dead) {
      try { if (window.Inventory && window.Inventory.scoopAt) window.Inventory.scoopAt(nx, ny, SCOOP_R); } catch (e) {}
      try { if (window.Enemies && window.Enemies.snare) window.Enemies.snare(nx, ny, SNARE_R, SNARE_F); } catch (e) {} // the storm holds every frame she's up
      if (zd <= 0) { zd = ZAP_CD; zap(nx, ny); }
      if (cone) { cone.zIndex = ny + 1; drawCone(nx, ny); }
    } else if (cone) { cone.visible = false; } // she's down: the storm grounds itself, the hull still hovers
  }

  function grant() { owned = true; save(); return true; } // dev-panel free deed — testing skips the till
  return { init, update, buy, grant, equip, unequip, toggle, known, owns, equipped, price, describe,
    debug: () => ({ x: dx, y: dy, gx: dx, gy: dy + DROP, sh, cone }),
    snareR: () => SNARE_R, snareF: () => SNARE_F, fetchR: () => FETCH_R, scoopR: () => SCOOP_R,
    zapCd: () => ZAP_CD, zapDmg: () => ZAP_DMG, drop: () => DROP };
})();
