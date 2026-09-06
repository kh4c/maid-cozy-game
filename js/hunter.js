// Hunter — the 🚀 Hunter Drone. A 🏪 shop deed (500c) flown from the 🎒 PETS tab.
// It rides its own high oval and, when anything enters HER 560px circle,
// cold-launches a missile, russian style: UP off the rail first, then a 90°
// pitch-over into a homing seek. The boom pays through damageAt → accountHits.
window.Hunter = (() => {
  const { Sprite, AnimatedSprite } = PIXI;
  // tuning — all game-feel, one number each
  const PRICE = 500;
  const HOVER_RX = 90, HOVER_RY = 40, HOVER_Y = -140; // high tight oval — above the scout, off-phase from it
  const HOVER_WX = 1.1, HOVER_WY = 1.7;
  const HUNTER_SCALE = 1.5, ANIM_SPD = 0.35;          // same rotor flicker
  const SEE_R = 560;      // it guards HER circle, like the scout
  const CD = 2.4, DMG = 5, BLAST_R = 75; // one fat boom every 2.4s
  const COLD_T = 0.35, COLD_SPD = 320;   // straight up off the rail, no steering
  const CRUISE_SPD = 520, TURN = 4.5;    // then the pitch-over into the seek (rad/s)
  const LIFE = 3.0, MAX_ALOFT = 3;       // old rockets burst overhead rather than fly forever
  const FUSE_R = 30;      // the nose kisses this close and it all goes up
  const DROP = 70;        // shadow hangs 70px under its feet — the mouth-center rule, no iron above it
  const EASE = 5;         // flight smoothing — eased, never teleported
  const OWN_KEY = 'cosette.hunter';

  let world = null, spr = null, texBullet = null, texSpark = null, texPuff = null;
  let missiles = []; // { spr, flame, x, y, vx, vy, age }
  let puffs = [];    // launch smoke + trail: { spr, life, max }
  let sh = null;     // blob shadow on the grass below — altitude you can read
  let t = 0, cd = 0, dx = 0, dy = 0; // flight clock, launch clock, smoothed feet
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
    owned = true; on = true; save(); // bought means flying — bench it in 🎒 PETS if you'd rather walk alone
    try { window.Sound && window.Sound.playSfx('combat', 'coin.ogg', { rate: 1.4, volume: 0.5 }); } catch (e) {}
    return { ok: true, name: 'Hunter Drone' };
  }
  function equip() { if (!owned) return false; on = true; save(); return true; }
  function unequip() { on = false; save(); return true; }
  function toggle() { if (equipped()) { unequip(); return true; } return equip(); } // PETS grid: always truthy on success (fly AND bench repaint)
  function known(id) { return id === 'hunter'; }

  function describe() {
    return `Hunter Drone ${PRICE}c (🏪 shop, 🎒 PETS tab): rides a high oval and cold-launches homing missiles (up off the rail, 90° pitch-over, then the seek) at anything in her 560px circle — 5dmg blast every 2.4s. Kills pay full coins. Owned: ${owned ? 'yes' : 'no'}. Flying: ${equipped() ? 'yes' : 'benched'}.`;
  }

  async function init(w) {
    world = w;
    load();
    try {
      const loaded = await PIXI.Assets.load('assets/drone3.png');
      const base = (loaded && loaded.texture) || loaded;
      const slice = window.Assets.makeSlicer(base, 32, 32);
      const frames = [slice(0, 0), slice(1, 0), slice(2, 0), slice(3, 0)]; // 4-frame rotor loop
      spr = new AnimatedSprite(frames);
      spr.anchor.set(0.5);
      spr.scale.set(HUNTER_SCALE);
      spr.animationSpeed = ANIM_SPD;
      spr.play();
      spr.visible = false;
      world.addChild(spr);
    } catch (e) { spr = null; }
    try {
      sh = new PIXI.Graphics();
      sh.ellipse(0, 0, 16, 6).fill({ color: 0x000000, alpha: 0.3 });
      sh.visible = false;
      world.addChild(sh);
    } catch (e) { sh = null; }
    try { const b = await PIXI.Assets.load('assets/bullet.png'); texBullet = (b && b.texture) || b; } catch (e) {}
    try { const s = await PIXI.Assets.load('assets/spark.png'); texSpark = (s && s.texture) || s; } catch (e) {}
    try { const p = await PIXI.Assets.load('assets/dust_puff.png'); texPuff = (p && p.texture) || p; } catch (e) {}
  }

  function puff(x, y, big) { // cold-launch smoke — grey, soft, normal blend, rises and fades
    try {
      if (!texPuff) return;
      const s = new Sprite(texPuff);
      s.anchor.set(0.5, 0.5);
      s.tint = 0xbdbdbd;
      s.scale.set((big ? 0.5 : 0.3) + Math.random() * 0.2);
      s.position.set(x + (Math.random() - 0.5) * 8, y + (Math.random() - 0.5) * 6);
      world.addChild(s);
      puffs.push({ spr: s, life: 0, max: 0.5 + Math.random() * 0.3 });
    } catch (e) { /* a smokeless launch still flies */ }
  }

  function launch(tx, ty) { // UP off the rail — steering unlocks after the cold climb
    try {
      const s = new Sprite(texBullet);
      s.anchor.set(0.5, 0.5);
      s.tint = 0xffa63f; // hot nose
      s.scale.set(0.5);
      s.rotation = -Math.PI / 2; // pointing up
      s.position.set(dx, dy);
      s.zIndex = 1e9; // rockets fly over heads, like her slugs
      world.addChild(s);
      let flame = null;
      try {
        flame = new Sprite(texSpark);
        flame.anchor.set(0.5, 0.5); flame.blendMode = 'add'; flame.tint = 0xffc46b;
        flame.scale.set(0.12); flame.position.set(dx, dy + 8);
        flame.zIndex = 1e9;
        world.addChild(flame);
      } catch (e) {}
      missiles.push({ spr: s, flame, x: dx, y: dy, vx: 0, vy: -COLD_SPD, age: 0, tx, ty });
      puff(dx, dy + 10, true); puff(dx, dy + 10, true); // the rail coughs twice
      try { window.Sound && window.Sound.playSfx('combat', 'pistol_real.wav', { rate: 1.6, volume: 0.2 }); } catch (e) {} // the cold pop
    } catch (e) { /* a silent rail still flies */ }
  }

  function explode(m) { // the seek ends — boom, debris, lamp, payout
    try {
      let res = null;
      try { res = window.Enemies && window.Enemies.damageAt ? window.Enemies.damageAt(m.x, m.y, BLAST_R, DMG) : null; } catch (e) {}
      if (res && res.hits > 0) {
        try { window.Gun && window.Gun.accountHits && window.Gun.accountHits(res, m.x, m.y); } catch (e) {} // same coins, same counters, same pops
      }
      try { window.Gun && window.Gun.birthPop && window.Gun.birthPop(m.x, m.y); } catch (e) {} // the boom wears cubes too
      try { window.Gun && window.Gun.blip && window.Gun.blip(m.x, m.y, 1.6); } catch (e) {} // thunder files its light
      try { window.Sound && window.Sound.playSfx('combat', 'shotgun_real.wav', { rate: 0.6, volume: 0.5 }); } catch (e) {} // the deep boom
    } catch (e) {}
    try { world.removeChild(m.spr); m.spr.destroy(); } catch (e) {}
    try { if (window.Gun && window.Gun.trailDone) window.Gun.trailDone(m); } catch (e) {} // the comet winks out with it, never orphaned
    try { if (m.flame) { world.removeChild(m.flame); m.flame.destroy(); } } catch (e) {}
  }

  function flyMissiles(dt) {
    for (let i = missiles.length - 1; i >= 0; i--) {
      const m = missiles[i];
      m.age += dt;
      if (m.age < COLD_T) { // cold phase — locked vertical, coughing smoke
        m.vx = 0; m.vy = -COLD_SPD;
        if (Math.random() < 0.6) puff(m.x, m.y + 8, false);
      } else { // the 90° pitch-over into the seek — banked, never snapped
        let tgt = null;
        try { tgt = window.Enemies && window.Enemies.nearest ? window.Enemies.nearest(m.x, m.y, SEE_R * 1.5) : null; } catch (e) {}
        if (tgt && tgt.x !== undefined) { m.tx = tgt.x; m.ty = tgt.y; } // re-seeks every tick — dead locks don't fly on
        const want = Math.atan2(m.ty - m.y, m.tx - m.x);
        let cur = Math.atan2(m.vy, m.vx);
        let dr = want - cur;
        while (dr > Math.PI) dr -= Math.PI * 2;
        while (dr < -Math.PI) dr += Math.PI * 2;
        const turn = Math.max(-TURN * dt, Math.min(TURN * dt, dr)); // capped bank — the missile arcs, never corners
        cur += turn;
        m.vx = Math.cos(cur) * CRUISE_SPD; m.vy = Math.sin(cur) * CRUISE_SPD;
        try { m.spr.rotation = cur + Math.PI / 2; } catch (e) {}
        if (Math.random() < 0.8) puff(m.x - m.vx * 0.02, m.y - m.vy * 0.02, false); // smoke trails the tail
      }
      m.x += m.vx * dt; m.y += m.vy * dt;
      try { m.spr.position.set(m.x, m.y); } catch (e) {}
      try { if (m.flame) { m.flame.position.set(m.x - m.vx * 0.015, m.y - m.vy * 0.015); m.flame.scale.set(0.1 + Math.random() * 0.06); } } catch (e) {} // the flame dances
      try { if (window.Gun && window.Gun.trailStep) window.Gun.trailStep(m); } catch (e) {} // her comet style, on loan — reposed per tick, never shed
      let dead = m.age > LIFE;
      if (!dead) {
        const d = Math.hypot(m.tx - m.x, m.ty - m.y);
        if (d < FUSE_R) dead = true; // the nose kisses and it all goes up
      }
      if (dead) { explode(m); missiles.splice(i, 1); }
    }
    for (let i = puffs.length - 1; i >= 0; i--) { // smoke rises, spreads, fades
      const p = puffs[i];
      p.life += dt;
      if (p.life > p.max) { try { world.removeChild(p.spr); p.spr.destroy(); } catch (e) {} puffs.splice(i, 1); continue; }
      try {
        const k = p.life / p.max;
        p.spr.position.y -= 30 * dt;
        p.spr.scale.set(p.spr.scale.x + dt * 0.4);
        p.spr.alpha = 0.5 * (1 - k);
      } catch (e) {}
    }
  }

  function update(wdt, px, py) {
    if (!spr) return;
    spr.visible = equipped();
    if (sh) sh.visible = equipped();
    if (!equipped()) { flyMissiles(wdt); return; } // benched: old rockets finish flying, nothing new
    t += wdt; cd -= wdt;
    let dead = false;
    try { dead = !!(window.Health && window.Health.dead); } catch (e) {}
    // home is the high oval; it doesn't peel off — the missiles do the travelling
    const tx = px + Math.cos(t * HOVER_WX + 2.1) * HOVER_RX;
    const ty = py + HOVER_Y + Math.sin(t * HOVER_WY + 1.3) * HOVER_RY;
    const k = 1 - Math.exp(-EASE * wdt);
    if (!dx && !dy) { dx = tx; dy = ty; } // first frame: start home, never fly in from origin
    dx += (tx - dx) * k; dy += (ty - dy) * k;
    spr.position.set(dx, dy);
    if (sh) { sh.position.set(dx, dy + DROP); sh.zIndex = dy + DROP; } // same hang as the others — the mouth-center rule, no iron above it
    try { // face travel — art faces UP, so heading aims the nose
      if (lx === null) { lx = dx; ly = dy; }
      const vx = dx - lx, vy = dy - ly;
      lx = dx; ly = dy;
      if (vx * vx + vy * vy > 0.04) rot += (((Math.atan2(vy, vx) + Math.PI / 2) - rot + Math.PI * 3) % (Math.PI * 2) - Math.PI) * Math.min(1, 10 * wdt);
      spr.rotation = rot;
    } catch (e) {}
    spr.zIndex = Math.max(dy, py + 5); // highest hull — over the scout, over her head, honest y-sort everywhere else
    if (cd <= 0 && !dead && missiles.length < MAX_ALOFT) {
      let tgt = null;
      try { tgt = window.Enemies && window.Enemies.nearest ? window.Enemies.nearest(px, py, SEE_R) : null; } catch (e) {}
      if (tgt && tgt.x !== undefined) { cd = CD; launch(tgt.x, tgt.y); }
    }
    flyMissiles(wdt);
  }

  function grant() { owned = true; save(); return true; } // dev-panel free deed — testing skips the till
  return { init, update, buy, grant, equip, unequip, toggle, known, owns, equipped, price, describe,
    debug: () => ({ x: dx, y: dy, gx: dx, gy: dy + DROP, sh, aloft: missiles.length, shots: missiles.map((m) => ({ x: m.x, y: m.y, vx: m.vx, vy: m.vy, age: m.age })) }) };
})();
