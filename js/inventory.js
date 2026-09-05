// Inventory — coin drops from critters, picked up by walking over them,
// stored in a simple grid. Click the 🎒 icon (bottom-right) to open/close.
// Session-only: coins reset on death (new life = new pockets, same as memory).
// Coin sprite: Kenney tiny-town tile_0093 (gold coin). SFX: Kenney RPG audio
// handleCoins.ogg. Classic script — coins are a toy, not a save.
window.Inventory = (() => {
  const $ = (id) => document.getElementById(id);
  let coins = 0;
  const PICKUP_R = 46;   // walk this close to scoop a coin
  const MAGNET_R = 110;  // coins inside this drift toward her
  // coin feel: big, soft shadow, hovering (not glued to the grass)
  const COIN_SCALE = 1.6;  // was 0.9 — easy to spot mid-fight
  const FLOAT_AMP = 6;     // hover height (px each way)
  const FLOAT_SPEED = 3;   // hover rhythm
  const SHADOW_W = 10, SHADOW_H = 4, SHADOW_A = 0.28;
  let drops = [];        // { spr, sh, x, y, vx, vy, t, settled, phase }
  let tex = null;
  let open = false;

  function init() {
    const btn = $('bag-btn');
    if (btn) btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggle();
    });
    render();
  }

  function toggle(force) {
    open = (force === undefined) ? !open : !!force;
    const p = $('inv-panel');
    if (p) p.style.display = open ? 'block' : 'none';
    render();
  }
  function isOpen() { return open; }

  async function ensureTex() {
    if (tex) return tex;
    tex = await PIXI.Assets.load('assets/coin.png');
    return tex;
  }

  // critters call drop(x, y, n) when they die
  async function drop(x, y, n) {
    const count = Math.max(1, Math.round(Number(n) || 1));
    try {
      const t = await ensureTex();
      for (let i = 0; i < count; i++) {
        const spr = new PIXI.Sprite(t);
        spr.anchor.set(0.5, 0.5);
        spr.scale.set(COIN_SCALE);
        // simple ground shadow — sibling in the same layer, posed each frame
        let sh = null;
        try {
          sh = new PIXI.Graphics();
          sh.ellipse(0, 0, SHADOW_W, SHADOW_H).fill({ color: 0x000000, alpha: SHADOW_A });
          if (window.InventoryLayer) window.InventoryLayer.addChild(sh);
        } catch (e) { sh = null; }
        const a = Math.random() * Math.PI * 2;
        const sp = 40 + Math.random() * 90;
        const d = {
          spr, sh, x, y,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 50,
          t: 0, settled: false, phase: Math.random() * Math.PI * 2,
        };
        spr.position.set(x, y);
        if (window.InventoryLayer) window.InventoryLayer.addChild(spr);
        drops.push(d);
      }
    } catch (e) { coinsFallback(count); }
  }
  // no coin texture? credit directly so the loop never breaks
  function coinsFallback(n) { coins += n; render(); flash(); }

  // main.js calls update(dt, px, py) with her feet position
  function update(dt, px, py) {
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.t += dt;
      if (!d.settled) {
        // pop out, then settle (simple fake gravity on the ground plane)
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.vx *= Math.exp(-4 * dt);
        d.vy *= Math.exp(-4 * dt);
        if (d.t > 0.45) d.settled = true;
      }
      // magnet + pickup
      const dx = px - d.x, dy = (py - 14) - d.y;
      const dist = Math.hypot(dx, dy);
      if (dist < MAGNET_R && d.t > 0.25) {
        const k = 1 - Math.exp(-8 * dt);
        d.x += dx * k; d.y += dy * k;
      }
      if (dist < PICKUP_R) {
        coins += 1;
        flash();
        try { window.Sound && window.Sound.playSfx('combat', 'coin.ogg', { rate: 1 + Math.random() * 0.2, volume: 0.5 }); } catch (e) {}
        if (d.spr.parent) d.spr.parent.removeChild(d.spr);
        d.spr.destroy();
        if (d.sh) { try { if (d.sh.parent) d.sh.parent.removeChild(d.sh); d.sh.destroy(); } catch (e2) {} }
        drops.splice(i, 1);
        if (open) render();
        continue;
      }
      // hover: coin floats on a slow sine, shadow breathes underneath
      // (coin low → shadow wide; coin high → shadow tight)
      const bob = Math.sin(d.t * FLOAT_SPEED + (d.phase || 0)) * FLOAT_AMP;
      d.spr.position.set(d.x, d.y + bob);
      if (d.sh) {
        d.sh.position.set(d.x, d.y + FLOAT_AMP + 3);
        const k = 1 + bob / (FLOAT_AMP * 10);
        try { d.sh.scale.set(k, k); } catch (e2) {}
      }
    }
  }

  function flash() {
    const c = $('inv-count');
    if (c) { c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); }
    renderCount();
  }

  function renderCount() {
    const c = $('inv-count');
    if (c) c.textContent = String(coins);
  }

  function render() {
    renderCount();
    const grid = $('inv-grid');
    if (!grid) return;
    const slots = Math.max(8, coins + 4);
    let h = '';
    for (let i = 0; i < slots; i++) {
      h += (i < coins) ? '<div class="slot has" title="coin">🪙</div>' : '<div class="slot"></div>';
    }
    grid.innerHTML = h;
    const meta = $('inv-meta');
    if (meta) meta.textContent = `${coins} coin${coins === 1 ? '' : 's'} · this life only`;
  }

  function state() { return { coins, drops: drops.length }; }
  // coins lying on the ground near (px,py): count + nearest vector (brain/snapshot)
  function dropsNear(px, py, r) {
    let n = 0, best = null;
    try {
      for (const d of drops) {
        const dx = d.x - px, dy = d.y - py, dist = Math.hypot(dx, dy);
        if (dist <= r) { n++; if (!best || dist < best.dist) best = { dist, dx, dy }; }
      }
    } catch (e) {}
    return { n, nearest: best };
  }
  function reset() { // new life: pockets empty, world drops stay (they're world objects)
    coins = 0;
    render();
  }

  return { init, update, drop, toggle, isOpen, state, dropsNear, reset, render };
})();
