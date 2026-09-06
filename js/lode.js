// Lode — the 🧲 Lodestone Drone. A 🏪 shop deed (350c) with its own 🎒 slot.
// No gun: it FETCHES (dives onto loose coins and scoops them into her purse)
// and SNARES (everything inside its 200px ring moves at half speed, frost-blue).
// Benched it stays home; slotted it rides a wider, higher oval than the scout
// (phase-shifted too), so the two never stack.
window.Lode = (() => {
  const { Sprite, AnimatedSprite } = PIXI;
  // tuning — all game-feel, one number each
  const PRICE = 350;
  const HOVER_RX = 150, HOVER_RY = 64, HOVER_Y = -130; // wider + higher than the scout's 120/52/-100
  const HOVER_WX = 1.5, HOVER_WY = 2.2, PHASE = Math.PI; // opposite beat — the two never stack
  const LODE_SCALE = 1.5, ANIM_SPD = 0.35;               // same rotor flicker
  const FETCH_R = 700;   // spots loose coins this far from its own feet
  const SCOOP_R = 50;    // swallows coins this close
  const SNARE_R = 200, SNARE_F = 0.5; // the frost ring: half speed inside
  const EASE = 5;        // flight smoothing — eased, never teleported
  const OWN_KEY = 'cosette.lode';

  let world = null, spr = null, ring = null;
  let t = 0, dx = 0, dy = 0; // flight clock, smoothed feet
  let rot = 0, lx = null, ly = null; // nose heading + last feet (art faces UP, so heading aims the nose)
  let owned = false, on = false;     // the deed + the slot

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
    owned = true; on = true; save(); // bought means worn — it rides home humming, bench it in 🎒 if you'd rather walk alone
    try { window.Sound && window.Sound.playSfx('combat', 'coin.ogg', { rate: 1.4, volume: 0.5 }); } catch (e) {}
    return { ok: true, name: 'Lodestone Drone' };
  }
  function equip() { if (!owned) return false; on = true; save(); return true; }
  function unequip() { on = false; save(); return true; }
  function toggle() { if (equipped()) { unequip(); return true; } return equip(); } // equipment square: always truthy on success (deploy AND dismiss repaint)
  function known(id) { return id === 'lode'; }

  function describe() {
    return `Lodestone Drone ${PRICE}c (🏪 shop, own 🎒 PET slot): fetches loose coins into her purse (700px nose for them) and slows everything in its 200px frost ring to half speed. No gun — the scout's job. Owned: ${owned ? 'yes' : 'no'}. Riding: ${equipped() ? 'yes' : 'benched'}.`;
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
    try { // the frost ring: a faint blue circle that marks the slow zone
      ring = new PIXI.Graphics();
      ring.circle(0, 0, SNARE_R).stroke({ color: 0x9fd8ff, width: 3, alpha: 0.35 });
      ring.visible = false;
      world.addChild(ring);
    } catch (e) { ring = null; }
  }

  function update(wdt, px, py) {
    if (!spr) return;
    spr.visible = equipped();
    if (ring) ring.visible = equipped();
    if (!equipped()) return;
    t += wdt;
    let dead = false;
    try { dead = !!(window.Health && window.Health.dead); } catch (e) {}
    // home is the wide high oval; a loose coin drags home onto itself instead
    let tx = px + Math.cos(t * HOVER_WX + PHASE) * HOVER_RX;
    let ty = py + HOVER_Y + Math.sin(t * HOVER_WY + PHASE) * HOVER_RY;
    let fetch = null;
    if (!dead) {
      try {
        const near = window.Inventory && window.Inventory.dropsNear ? window.Inventory.dropsNear(dx, dy, FETCH_R) : null;
        if (near && near.nearest) fetch = { x: dx + near.nearest.dx, y: dy + near.nearest.dy };
      } catch (e) {}
    }
    if (fetch) { tx = fetch.x; ty = fetch.y - 10; }
    const k = 1 - Math.exp(-EASE * wdt);
    if (!dx && !dy) { dx = tx; dy = ty; } // first frame: start home, never fly in from origin
    dx += (tx - dx) * k; dy += (ty - dy) * k;
    spr.position.set(dx, dy);
    try { // face travel — but mid-fetch the nose locks onto the coin, not the flight path
      if (lx === null) { lx = dx; ly = dy; }
      const vx = dx - lx, vy = dy - ly;
      lx = dx; ly = dy;
      let want = null;
      if (fetch && Math.hypot(fetch.x - dx, fetch.y - dy) < FETCH_R) {
        want = Math.atan2(fetch.y - dy, fetch.x - dx) + Math.PI / 2; // fetching: stare it down
      } else if (vx * vx + vy * vy > 0.04) { // ~0.2px/frame dead zone — no spin on the hover
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
      try { if (window.Inventory && window.Inventory.scoopAt) window.Inventory.scoopAt(dx, dy, SCOOP_R); } catch (e) {}
      try { if (window.Enemies && window.Enemies.snare) window.Enemies.snare(dx, dy, SNARE_R, SNARE_F); } catch (e) {} // the frost holds every frame she's up
    }
    if (ring) { // the ring breathes with the hover — the slow zone, readable
      ring.position.set(dx, dy);
      try { ring.alpha = 0.75 + Math.sin(t * 3) * 0.25; } catch (e) {}
    }
  }

  function grant() { owned = true; save(); return true; } // dev-panel free deed — testing skips the till
  return { init, update, buy, grant, equip, unequip, toggle, known, owns, equipped, price, describe,
    snareR: () => SNARE_R, snareF: () => SNARE_F, fetchR: () => FETCH_R, scoopR: () => SCOOP_R };
})();
