// Pet — the 🛸 Scout Drone. A 🏪 shop deed (250c) with its own 🎒 slot.
// Benched it stays home; slotted it rides a lissajous oval above her head and,
// when anything strays into HER 520px circle, slides to a 230px standoff and
// pews. Kills pay out through Gun.accountHits — same coins, same counters.
window.Pet = (() => {
  const { Sprite, AnimatedSprite } = PIXI;
  // tuning — all game-feel, one number each
  const PRICE = 250;
  const HOVER_RX = 120, HOVER_RY = 52, HOVER_Y = -100; // oval above her head — wide patrol, never a perfect circle
  const HOVER_WX = 1.5, HOVER_WY = 2.2;               // lissajous pair — a hover, never a perfect circle
  const PET_SCALE = 1.5, ANIM_SPD = 0.35;             // rotor flicker
  const SEE_R = 520;      // it guards HER circle, not its own
  const ATK_HOLD = 230;   // standoff from the target's teeth
  const PET_CD = 0.9, PET_DMG = 2;                    // polite pew, not a second rifle
  const PET_SPD = 1250, PET_LIFE = 0.4, PET_HIT_R = 30;
  const EASE = 5;         // flight smoothing — eased, never teleported
  const OWN_KEY = 'cosette.pet';

  let world = null, spr = null, texBullet = null, texSpark = null;
  let bullets = [];
  let sh = null; // blob shadow on the grass below — altitude you can read
  let t = 0, cd = 0, dx = 0, dy = 0; // flight clock, trigger clock, smoothed feet
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
    owned = true; on = true; save(); // bought means worn — it rides home on her head, bench it in 🎒 if you'd rather walk alone
    try { window.Sound && window.Sound.playSfx('combat', 'coin.ogg', { rate: 1.4, volume: 0.5 }); } catch (e) {}
    return { ok: true, name: 'Hover Drone' };
  }
  function equip() { if (!owned) return false; on = true; save(); return true; }
  function unequip() { on = false; save(); return true; }
  function toggle() { if (equipped()) { unequip(); return true; } return equip(); } // equipment square: always truthy on success (deploy AND dismiss repaint)
  function known(id) { return id === 'drone'; }

  function describe() {
    return `Hover Drone ${PRICE}c (🏪 shop, 🎒 PETS tab): rides an oval above her head, slides to 230px and pews (2dmg every 0.9s) at anything in her 520px circle. Kills pay full coins. Owned: ${owned ? 'yes' : 'no'}. Flying: ${equipped() ? 'yes' : 'benched'}.`;
  }

  async function init(w) {
    world = w;
    load();
    try {
      const loaded = await PIXI.Assets.load('assets/drone1.png');
      const base = (loaded && loaded.texture) || loaded;
      const slice = window.Assets.makeSlicer(base, 32, 32);
      const frames = [slice(0, 0), slice(1, 0), slice(2, 0), slice(3, 0)]; // 4-frame rotor loop
      spr = new AnimatedSprite(frames);
      spr.anchor.set(0.5);
      spr.scale.set(PET_SCALE);
      spr.animationSpeed = ANIM_SPD;
      spr.play();
      spr.visible = false;
      world.addChild(spr);
    } catch (e) { spr = null; }
    try {
      sh = new PIXI.Graphics();
      sh.ellipse(0, 0, 13, 5).fill({ color: 0x000000, alpha: 0.3 });
      sh.visible = false;
      world.addChild(sh);
    } catch (e) { sh = null; }
    try {
      const b = await PIXI.Assets.load('assets/bullet.png');
      texBullet = (b && b.texture) || b;
    } catch (e) {}
    try {
      const s = await PIXI.Assets.load('assets/spark.png');
      texSpark = (s && s.texture) || s;
    } catch (e) {}
  }

  function pew(ex, ey) {
    try {
      const a = Math.atan2(ey - dy, ex - dx);
      const s = new Sprite(texBullet);
      s.anchor.set(0.5, 0.5);
      s.blendMode = 'add'; // tracer needle — glows day and night
      s.scale.set(0.14);
      s.rotation = a;
      s.position.set(dx, dy);
      s.zIndex = 1e9; // needles fly over heads, like hers
      world.addChild(s);
      bullets.push({ spr: s, vx: Math.cos(a) * PET_SPD, vy: Math.sin(a) * PET_SPD, life: PET_LIFE, trail: null });
      try { if (window.Gun && window.Gun.blip) window.Gun.blip(dx, dy, 0.45); } catch (e) {} // needles wink too — a small lamp, quiet like its sound
      try { window.Sound && window.Sound.playSfx('combat', 'rifle_real.wav', { rate: 1.8, volume: 0.18 }); } catch (e) {} // pew, pitched up and quiet
    } catch (e) { /* a silent drone still flies */ }
  }

  function flyBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.life -= dt;
      b.spr.x += b.vx * dt;
      b.spr.y += b.vy * dt;
      try { if (window.Gun && window.Gun.trailStep) window.Gun.trailStep(b); } catch (e) {} // her comet style, on loan
      let dead = b.life <= 0;
      if (!dead && window.Enemies) {
        try {
          const res = window.Enemies.damageAt(b.spr.x, b.spr.y, PET_HIT_R, PET_DMG);
          if (res.hits > 0) {
            dead = true;
            try { window.Gun && window.Gun.accountHits && window.Gun.accountHits(res, b.spr.x, b.spr.y); } catch (e) {} // same coins, same counters, same pops
          }
        } catch (e) { /* deaf frame */ }
      }
      if (dead) { try { if (window.Gun && window.Gun.trailDone) window.Gun.trailDone(b); } catch (e) {} try { world.removeChild(b.spr); b.spr.destroy(); } catch (e) {} bullets.splice(i, 1); }
    }
  }

  function update(wdt, px, py) {
    if (!spr) return;
    spr.visible = equipped();
    if (sh) sh.visible = equipped();
    if (!equipped()) { flyBullets(wdt); return; } // benched: old needles finish flying, nothing new
    t += wdt; cd -= wdt;
    let dead = false;
    try { dead = !!(window.Health && window.Health.dead); } catch (e) {}
    // home is the oval; a target drags home to the standoff instead
    let tx = px + Math.cos(t * HOVER_WX) * HOVER_RX;
    let ty = py + HOVER_Y + Math.sin(t * HOVER_WY) * HOVER_RY;
    let tgt = null;
    if (!dead) { try { tgt = window.Enemies && window.Enemies.nearest ? window.Enemies.nearest(px, py, SEE_R) : null; } catch (e) {} }
    if (tgt && tgt.x !== undefined) {
      const ex = tgt.x - px, ey = tgt.y - py, L = Math.hypot(ex, ey) || 1;
      tx = tgt.x - (ex / L) * ATK_HOLD;
      ty = tgt.y - (ey / L) * ATK_HOLD - 20;
    }
    const k = 1 - Math.exp(-EASE * wdt);
    if (!dx && !dy) { dx = tx; dy = ty; } // first frame: start home, never fly in from origin
    dx += (tx - dx) * k; dy += (ty - dy) * k;
    spr.position.set(dx, dy);
    if (sh) { sh.position.set(dx, dy + 22); sh.zIndex = dy; } // glued to the grass under it, sorted below the iron
    try { // face travel — but in range the nose locks onto the victim, not the flight path
      if (lx === null) { lx = dx; ly = dy; }
      const vx = dx - lx, vy = dy - ly;
      lx = dx; ly = dy;
      let want = null;
      if (tgt && tgt.x !== undefined && Math.hypot(tgt.x - dx, (tgt.y - 10) - dy) < PET_SPD * PET_LIFE) {
        want = Math.atan2((tgt.y - 10) - dy, tgt.x - dx) + Math.PI / 2; // attacking: stare it down
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
    spr.zIndex = Math.max(dy, py + 3); // it flies — over her head always, honest y-sort everywhere else
    if (tgt && tgt.x !== undefined && cd <= 0 && !dead) {
      if (Math.hypot(tgt.x - dx, tgt.y - dy) < PET_SPD * PET_LIFE) { cd = PET_CD; pew(tgt.x, tgt.y - 10); }
    }
    flyBullets(wdt);
  }

  function grant() { owned = true; save(); return true; } // dev-panel free deed — testing skips the till
  return { init, update, buy, grant, equip, unequip, toggle, known, owns, equipped, price, describe,
    debug: () => ({ x: dx, y: dy, sh }) };
})();
