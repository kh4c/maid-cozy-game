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
  const DESPAWN_R = 3000;              // pack anchor beyond this -> gone (far: dismissed packs must survive a stroll-away + march-back)
  const TOUCH_R = 42;                  // bite distance
  const HIT_CD = 1.0;                  // seconds between bites per critter
  const PACK_R = 60;                   // pack milling radius
  const SCALE = 2.75;                  // chunky critters (was 2 — they stacked into a blob)
  const SEP_R = 64;                    // packmates push apart inside this radius

  // ---- rarity randomizer -------------------------------------------------------
  // Every critter rolls size + rarity at spawn. Rarity shows as a colored
  // outline hugging the sprite (common = faint gray) and sets coin value + toughness. Tunables:
  // weights sum to 100; price = coins dropped on kill.
  const RARITY = [
    { key: 'common',    w: 60, color: 0x8b93a3,   price: 2,  size: [0.85, 1.00], hp: 3 },
    { key: 'uncommon',  w: 25, color: 0x51d651,   price: 5,  size: [1.00, 1.12], hp: 4 },
    { key: 'rare',      w: 10, color: 0x4aa8ff,   price: 12, size: [1.12, 1.25], hp: 5 },
    { key: 'epic',      w: 4,  color: 0xc26bff,   price: 25, size: [1.25, 1.40], hp: 7 },
    { key: 'legendary', w: 1,  color: 0xffd24a,   price: 60, size: [1.40, 1.60], hp: 10 },
  ];
  function rollRarity() {
    let r = Math.random() * 100, acc = 0;
    for (const t of RARITY) { acc += t.w; if (r < acc) return t; }
    return RARITY[0];
  }

  let frames = null;
  let gid = 0; // pack identity — the brain dismisses whole groups ("find another")
  const groups = []; // { id, anchor:{x,y}, dir, retarget, members:[...] }
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
    const g = { id: ++gid, anchor, dir: Math.random() * Math.PI * 2, retarget: 0, members: [], alerted: false };
    for (let i = 0; i < n; i++) {
      const view = new Container();
      const sh = new Graphics();
      sh.ellipse(0, -2, 13, 5).fill({ color: 0x000000, alpha: 0.3 });
      const anim = new AnimatedSprite(frames);
      anim.anchor.set(0.5, 1);
      anim.animationSpeed = 1 / 6;
      anim.play();
      view.addChild(sh, anim);
      // rarity roll: size + sprite outline + value + toughness. The outline
      // hugs the 24x24 sprite (anchor bottom-center: x -12..12, y -24..0),
      // so it reads as an outline, not a stray circle.
      const rar = rollRarity();
      const sizeMult = rar.size[0] + Math.random() * (rar.size[1] - rar.size[0]);
      const baseScale = SCALE * sizeMult;
      view.scale.set(baseScale);
      try {
        const ring = new Graphics();
        ring.ellipse(0, -12, 14, 14).stroke({ color: rar.color, width: 1, alpha: rar.key === 'common' ? 0.45 : 0.9 });
        view.addChild(ring);
      } catch (e) { /* an outlineless rare still pays */ }
      const ox = (Math.random() - 0.5) * PACK_R * 2;
      const oy = (Math.random() - 0.5) * PACK_R * 2;
      view.position.set(anchor.x + ox, anchor.y + oy);
      world.addChild(view);
      g.members.push({ view, anim, x: anchor.x + ox, y: anchor.y + oy, vx: 0, vy: 0, ox, oy,
        hostile: false, lastHit: 0, hp: rar.hp, flashT: 0, // white-out blink on hit
        rarity: rar.key, price: rar.price, baseScale, // appraisal: outline color + coin value
        brave: Math.random() < 0.6, // 3 in 5 stand and fight; the rest bolt
        orbit: Math.random() < 0.5 ? 1 : -1 }); // milling circle direction
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
    if (m.vx < -2) m.view.scale.x = -(m.baseScale || SCALE);
    else if (m.vx > 2) m.view.scale.x = (m.baseScale || SCALE);
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

      // retaliation cools when you leave them alone (or while she's down)
      if (g.alerted && (playerDead || ad > CALM_R)) {
        g.alerted = false;
        for (const m of g.members) m.hostile = false;
      }

      // the pack shadows you ONLY when alerted (you shot them or got REALLY
      // close). Unalerted packs ignore the player entirely — they mill where
      // they spawned. Never hostile on proximity alone.
      const SHADOW_R = 120; // walk this close to an unalerted pack and it starts trailing you
      if (!playerDead && g.alerted) {
        // trailing point ~FOLLOW_R off the player
        const FOLLOW_R = 300;
        const nx = (g.anchor.x - px) / (ad || 1), ny = (g.anchor.y - py) / (ad || 1);
        const k = Math.min(1, 1.2 * dt);
        g.anchor.x += ((px + nx * FOLLOW_R) - g.anchor.x) * k;
        g.anchor.y += ((py + ny * FOLLOW_R) - g.anchor.y) * k;
      } else if (!playerDead && ad < SHADOW_R && ad > 1) {
        // spooked: start trailing (but not attacking)
        g.spooked = true;
        const nx = (g.anchor.x - px) / (ad || 1), ny = (g.anchor.y - py) / (ad || 1);
        const k = Math.min(1, 0.8 * dt);
        const R = 320;
        g.anchor.x += ((px + nx * R) - g.anchor.x) * k;
        g.anchor.y += ((py + ny * R) - g.anchor.y) * k;
      } else {
        // anchor wanders slowly, retargeting every few seconds
        g.retarget -= dt;
        if (g.retarget <= 0) {
          g.retarget = 2 + Math.random() * 3;
          g.dir = Math.random() * Math.PI * 2;
        }
        g.anchor.x += Math.cos(g.dir) * WANDER_SPEED * 0.7 * dt;
        g.anchor.y += Math.sin(g.dir) * WANDER_SPEED * 0.7 * dt;
      }

      for (const m of g.members) {
        const pd = Math.hypot(m.x - px, m.y - py);

        // hit flicker: red tint + rapid alpha blink while flashT counts down
        if (m.flashT > 0) {
          m.flashT -= dt;
          m.anim.tint = 0xff6b6b;
          m.anim.alpha = ((m.flashT * 25) | 0) % 2 ? 0.35 : 1;
          if (m.flashT <= 0) { m.anim.tint = 0xffffff; m.anim.alpha = 1; }
        }

        if (m.hostile) {
          if (m.brave) {
            steer(m, px, py, HOSTILE_SPEED, dt);
            // bite: 1 heart, per-critter cooldown
            if (pd < TOUCH_R && now - m.lastHit > HIT_CD) {
              m.lastHit = now;
              if (window.Health) window.Health.damage(1);
            }
          } else {
            // coward under fire: bolts AWAY, never bites
            const nx = (m.x - px) / (pd || 1), ny = (m.y - py) / (pd || 1);
            const jx = (Math.random() - 0.5) * 30, jy = (Math.random() - 0.5) * 30; // panic
            steer(m, m.x + nx * 120 - ny * 40 * m.orbit + jx, m.y + ny * 120 + nx * 40 * m.orbit + jy, HOSTILE_SPEED * 0.85, dt);
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
          if (d > 0.01 && d < SEP_R) {
            const push = (SEP_R - d) * 0.35;
            const nx = dx / d, ny = dy / d;
            ms[i].x -= nx * push; ms[i].y -= ny * push;
            ms[j].x += nx * push; ms[j].y += ny * push;
          }
        }
      }
    }
  }

  // player swing: members in range take 1 (three pops one); ANY hit alerts
  // the whole pack — braves hunt, cowards bolt. Returns the hit count.
  function playerAttack(px, py, range) {
    const world = init._world;
    let hits = 0;
    for (let gi = groups.length - 1; gi >= 0; gi--) {
      const g = groups[gi];
      let alerted = false;
      for (let i = g.members.length - 1; i >= 0; i--) {
        const m = g.members[i];
        if (Math.hypot(m.x - px, m.y - py) > range) continue;
        hits++;
        alerted = true;
        m.hp -= 1;
        m.flashT = 0.18;
        if (m.hp <= 0) {
          world.removeChild(m.view);
          g.members.splice(i, 1);
        }
      }
      if (alerted) {
        g.alerted = true;
        for (const m of g.members) m.hostile = true;
      }
      if (g.members.length === 0) groups.splice(gi, 1); // wiped out
    }
    return hits;
  }

  // bullet hit: damage every critter within radius of (px,py). Whole pack
  // retaliates (braves charge, cowards bolt). Returns { hits, kills,
  // deaths:[{x,y}] } — gun.js layers spark/hit-sound/shake juice off this.
  function damageAt(px, py, radius, dmg) {
    const world = init._world;
    let hits = 0, kills = 0;
    const deaths = [];
    for (let gi = groups.length - 1; gi >= 0; gi--) {
      const g = groups[gi];
      let alerted = false;
      for (let i = g.members.length - 1; i >= 0; i--) {
        const m = g.members[i];
        if (Math.hypot(m.x - px, m.y - py) > radius) continue;
        hits++;
        alerted = true;
        m.hp -= dmg;
        m.flashT = 0.18; // flicker on any non-lethal connect
        if (m.hp <= 0) {
          deaths.push({ x: m.x, y: m.y, value: m.price || 2 }); // appraisal pays out
          world.removeChild(m.view);
          g.members.splice(i, 1);
          kills++;
        }
      }
      if (alerted) {
        g.alerted = true;
        for (const m of g.members) m.hostile = true;
      }
      if (g.members.length === 0) groups.splice(gi, 1);
    }
    return { hits, kills, deaths };
  }

  // how many critters are currently engaged — drives the battle music
  function hostileCount() {
    let n = 0;
    for (const g of groups) for (const m of g.members) if (m.hostile) n++;
    return n;
  }

  // ---- situation queries (for Situation.js / Brain) -------------------------
  // nearest(px,py,[maxDist]) -> closest critter within maxDist (default 500),
  // the maid's circle of awareness — bullets never fly at off-screen ghosts.
  function nearest(px, py, maxDist) {
    const cap = maxDist || 500;
    let best = null, bd = Infinity;
    for (const g of groups) {
      for (const m of g.members) {
        const dx = m.x - px, dy = m.y - py;
        const d = Math.hypot(dx, dy);
        if (d < bd && d <= cap) { bd = d; best = { x: m.x, y: m.y, dist: d, dx, dy, hostile: !!m.hostile, hp: m.hp, rarity: m.rarity || 'common', price: m.price || 2, pack: g.id }; }
      }
    }
    return best;
  }

  // sense(px,py,[maxDist]) -> { total, hostile, nearest, list[] } within cap
  function sense(px, py, maxDist) {
    const cap = maxDist || 500;
    const list = [];
    for (const g of groups) {
      for (const m of g.members) {
        const dx = m.x - px, dy = m.y - py;
        const d = Math.hypot(dx, dy);
        if (d <= cap) list.push({ x: m.x, y: m.y, dist: d, dx, dy, hostile: !!m.hostile, hp: m.hp, rarity: m.rarity || 'common', price: m.price || 2, pack: g.id });
      }
    }
    list.sort((a, b) => a.dist - b.dist);
    return { total: list.length, hostile: list.filter((e) => e.hostile).length, nearest: list[0] || null, list };
  }

  // price list: the single source of truth for critter worth — the snapshot
  // quotes this verbatim so BOTH minds (chat + brain) actually know prices.
  function priceListText() {
    const ring = { common: 'faint gray outline', uncommon: 'green outline', rare: 'blue outline', epic: 'purple outline', legendary: 'gold outline' };
    return 'Critter prices (coins per kill): ' +
      RARITY.map((t) => `${t.key} ${t.price} (${ring[t.key] || ''})`).join(' · ') +
      '. Bigger body = rarer + tougher (3-10hp).';
  }

  return { init, update, hostileCount, playerAttack, damageAt, nearest, sense, priceListText, debugGroups: () => groups };
})();
