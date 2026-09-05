// Enemy spawner — one critter type (assets/enemy.png, 4x24px frames).
// Behavior spec:
// - spawns in small packs of 3-5 on a ring around the player (off-screen)
// - slow wanderers that mill around their pack anchor, NOT hostile by default
// - aggro when the player gets close: chase + touch for 1 heart (1s cooldown)
// - calm down when the player escapes; whole pack despawns if left far behind
window.Enemies = (() => {
  const { Container, AnimatedSprite, Graphics } = PIXI;

  // tuning — all game-feel, no persistence
  const GROUP_MIN = 3, GROUP_MAX = 5;  // pack size
  const MAX_GROUPS = 2;                // packs alive at once
  const SPAWN_EVERY = 6;               // spawner tick (seconds)
  const SPAWN_R_MIN = 750, SPAWN_R_MAX = 1050; // ring around player (off-view)
  const WANDER_SPEED = 45;             // slow drift
  const HOSTILE_SPEED = 95;            // chase (player runs 300 — outrunnable)
  const AGGRO_R = 260;                 // someone gets close -> pack hunts
  const CALM_R = 420;                  // escape this far -> back to wandering
  const DESPAWN_R = 1500;              // pack anchor beyond this -> gone
  const TOUCH_R = 42;                  // bite distance
  const HIT_CD = 1.0;                  // seconds between bites per critter
  const PACK_R = 60;                   // pack milling radius

  let frames = null;
  const groups = []; // { anchor:{x,y}, dir, retarget, members:[{view,anim,x,y,vx,vy,ox,oy,hostile,lastHit}] }
  let spawnAcc = 0;

  async function init(world) {
    const loaded = await PIXI.Assets.load('assets/enemy.png');
    const slice = window.Assets.makeSlicer(loaded, 24, 24);
    frames = [slice(0, 0), slice(1, 0), slice(2, 0), slice(3, 0)];
    init._world = world;
  }

  function spawnPack(px, py) {
    const world = init._world;
    const n = GROUP_MIN + ((Math.random() * (GROUP_MAX - GROUP_MIN + 1)) | 0);
    const a = Math.random() * Math.PI * 2;
    const r = SPAWN_R_MIN + Math.random() * (SPAWN_R_MAX - SPAWN_R_MIN);
    const anchor = { x: px + Math.cos(a) * r, y: py + Math.sin(a) * r };
    const g = { anchor, dir: Math.random() * Math.PI * 2, retarget: 0, members: [] };
    for (let i = 0; i < n; i++) {
      const view = new Container();
      const sh = new Graphics();
      sh.ellipse(0, -2, 9, 3.5).fill({ color: 0x000000, alpha: 0.3 });
      const anim = new AnimatedSprite(frames);
      anim.anchor.set(0.5, 1);
      anim.animationSpeed = 1 / 6;
      anim.play();
      view.addChild(sh, anim);
      view.scale.set(2);
      const ox = (Math.random() - 0.5) * PACK_R * 2;
      const oy = (Math.random() - 0.5) * PACK_R * 2;
      view.position.set(anchor.x + ox, anchor.y + oy);
      world.addChild(view);
      g.members.push({ view, anim, x: anchor.x + ox, y: anchor.y + oy, vx: 0, vy: 0, ox, oy,
        hostile: false, lastHit: 0,
        brave: Math.random() < 0.6, // 3 in 5 charge; the rest bottle it
        orbit: Math.random() < 0.5 ? 1 : -1 }); // cowards circle left or right
    }
    groups.push(g);
  }

  function destroyPack(g) {
    const world = init._world;
    for (const m of g.members) world.removeChild(m.view);
    groups.splice(groups.indexOf(g), 1);
  }

  function steer(m, tx, ty, speed, dt) {
    const dx = tx - m.x, dy = ty - m.y;
    const d = Math.hypot(dx, dy) || 1;
    const k = 1 - Math.exp(-3 * dt); // ease velocity toward desired (no snapping)
    m.vx += ((dx / d) * speed - m.vx) * k;
    m.vy += ((dy / d) * speed - m.vy) * k;
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    if (m.vx < -2) m.view.scale.x = -2;
    else if (m.vx > 2) m.view.scale.x = 2;
    m.view.position.set(m.x, m.y);
  }

  function update(dt, px, py) {
    if (!frames) return;
    const playerDead = !!(window.Health && window.Health.dead);
    const now = performance.now() / 1000;

    // spawner tick — never while she's down
    if (!playerDead) {
      spawnAcc += dt;
      if (spawnAcc >= SPAWN_EVERY) {
        spawnAcc = 0;
        if (groups.length < MAX_GROUPS) spawnPack(px, py);
      }
    }

    for (let gi = groups.length - 1; gi >= 0; gi--) {
      const g = groups[gi];
      const ad = Math.hypot(g.anchor.x - px, g.anchor.y - py);

      // left far behind -> despawn the whole pack
      if (ad > DESPAWN_R) { destroyPack(g); continue; }

      // anchor wanders slowly, retargeting every few seconds
      g.retarget -= dt;
      if (g.retarget <= 0) {
        g.retarget = 2 + Math.random() * 3;
        g.dir = Math.random() * Math.PI * 2;
      }
      g.anchor.x += Math.cos(g.dir) * WANDER_SPEED * 0.7 * dt;
      g.anchor.y += Math.sin(g.dir) * WANDER_SPEED * 0.7 * dt;

      for (const m of g.members) {
        const pd = Math.hypot(m.x - px, m.y - py);
        if (!playerDead && pd < AGGRO_R) m.hostile = true;
        else if (m.hostile && pd > CALM_R) m.hostile = false;
        if (playerDead) m.hostile = false; // no corpse-camping

        if (m.hostile) {
          if (m.brave) {
            steer(m, px, py, HOSTILE_SPEED, dt);
            // bite: 1 heart, per-critter cooldown
            if (pd < TOUCH_R && now - m.lastHit > HIT_CD) {
              m.lastHit = now;
              if (window.Health) window.Health.damage(1);
            }
          } else {
            // scared stalemate: holds a nervous ring, never bites. Too far ->
            // creeps closer, too close -> backs off, inside the band -> orbits.
            const nx = (m.x - px) / (pd || 1), ny = (m.y - py) / (pd || 1);
            const jx = (Math.random() - 0.5) * 30, jy = (Math.random() - 0.5) * 30; // nerves
            if (pd > 280) steer(m, px + jx, py + jy, HOSTILE_SPEED * 0.55, dt);
            else if (pd < 190) steer(m, m.x + nx * 70 - ny * 40 * m.orbit + jx, m.y + ny * 70 + nx * 40 * m.orbit + jy, HOSTILE_SPEED * 0.7, dt);
            else steer(m, m.x - ny * 60 * m.orbit + jx, m.y + nx * 60 * m.orbit + jy, HOSTILE_SPEED * 0.5, dt);
          }
        } else {
          // mill around the pack: personal offset + slow swirl
          const sw = now * 0.4 + m.ox;
          const tx = g.anchor.x + m.ox * 0.6 + Math.cos(sw) * 18;
          const ty = g.anchor.y + m.oy * 0.6 + Math.sin(sw) * 18;
          steer(m, tx, ty, WANDER_SPEED, dt);
        }
      }

      // cheap separation so packmates don't stack
      const ms = g.members;
      for (let i = 0; i < ms.length; i++) {
        for (let j = i + 1; j < ms.length; j++) {
          const dx = ms[j].x - ms[i].x, dy = ms[j].y - ms[i].y;
          const d = Math.hypot(dx, dy);
          if (d > 0.01 && d < 26) {
            const push = (26 - d) * 0.5;
            const nx = dx / d, ny = dy / d;
            ms[i].x -= nx * push; ms[i].y -= ny * push;
            ms[j].x += nx * push; ms[j].y += ny * push;
          }
        }
      }
    }
  }

  // how many critters are currently engaged — drives the battle music
  function hostileCount() {
    let n = 0;
    for (const g of groups) for (const m of g.members) if (m.hostile) n++;
    return n;
  }

  return { init, update, hostileCount };
})();
