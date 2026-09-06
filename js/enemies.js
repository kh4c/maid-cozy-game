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
  const DESPAWN_R = 3000;              // pack anchor beyond this -> gone (far cleanup)
  const DISMISS_AFTER = 8;               // "not interested" tag -> wanders off (despawns) this soon after
  const TOUCH_R = 42;                  // bite distance
  const HIT_CD = 1.0;                  // seconds between bites per critter
  const PACK_R = 60;                   // pack milling radius
  const SCALE = 2.75;                  // chunky critters (was 2 — they stacked into a blob)
  const SEP_R = 64;                    // packmates push apart inside this radius

  // ---- lone hunter: the OTHER kind of monster --------------------------------
  // Lone-hunter doctrine: spawns ALONE (never a pack) and mills around calmly
  // like scenery — NO spawn-rush. Cross the proximity fuse (she stays close)
  // and it turns permanently hostile: faster than packs, tougher, worth more,
  // and it never calms down. Reads at a glance: ~1.5x body, hunter-red outline.
  // All tunables, top.
  const LONER_EVERY = 30;              // one shows up about this often (seconds)
  const LONER_MAX = 1;                 // never more than this many hunting her
  const LONER_AGGRO = 450;             // proximity fuse — she must stay this close to provoke it
  const LONER_SPEED = 150;             // outrunnable (she runs 300), but pressing
  const LONER_GRIT = 4;                // extra HP over its rolled tier — hunters are built tougher
  const LONER_BOUNTY = 10;             // extra coins over its rolled tier — folk pay for the menace
  const LONER_BULK = 1.3;              // extra body over its rolled tier — reads dangerous at a glance
  const LONER_COLOR = 0xff5040;        // hunter-red outline = SPECIES mark (tier shows in size, not ring)

  // ---- rarity randomizer -------------------------------------------------------
  // Every MONSTER rolls size + rarity at spawn — pack critters AND lone
  // hunters. Rarity is a tier, not a species: it sets toughness, body size
  // and coin value. Species shows in the OUTLINE (tier colors on packs,
  // hunter-red on hunters) and in behavior.
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
  const loners = []; // lone hunters — same member shape, no pack (pack:'lone')
  let lonerAcc = 0, lonerId = 0;

  let hunterFrames = null; // assets/hunter.png (4x24px) — enemy frames stand in until it exists
  async function init(world) {
    const loaded = await PIXI.Assets.load('assets/enemy.png');
    const slice = window.Assets.makeSlicer(loaded, 24, 24);
    frames = [slice(0, 0), slice(1, 0), slice(2, 0), slice(3, 0)];
    try {
      const hLoaded = await PIXI.Assets.load('assets/hunter.png');
      const hSlice = window.Assets.makeSlicer(hLoaded, 24, 24);
      hunterFrames = [hSlice(0, 0), hSlice(1, 0), hSlice(2, 0), hSlice(3, 0)];
    } catch (e) { hunterFrames = null; }
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
      g.members.push({ view, anim, id: 'p' + g.id + 'c' + i, x: anchor.x + ox, y: anchor.y + oy, vx: 0, vy: 0, ox, oy,
        hostile: false, lastHit: 0, hp: rar.hp, flashT: 0, // white-out blink on hit
        rarity: rar.key, price: rar.price, baseScale, // appraisal: outline color + coin value
        brave: Math.random() < 0.6, // 3 in 5 stand and fight; the rest bolt
        orbit: Math.random() < 0.5 ? 1 : -1 }); // milling circle direction
    }
    groups.push(g);
  }

  function spawnLoner(px, py) {
    const world = init._world;
    const a = Math.random() * Math.PI * 2;
    const r = SPAWN_R_MIN + Math.random() * (SPAWN_R_MAX - SPAWN_R_MIN);
    const view = new Container();
    const sh = new Graphics();
    sh.ellipse(0, -2, 13, 5).fill({ color: 0x000000, alpha: 0.3 });
    const anim = new AnimatedSprite(hunterFrames || frames);
    anim.anchor.set(0.5, 1);
    anim.animationSpeed = 1 / 6;
    anim.play();
    view.addChild(sh, anim);
    // hunters roll rarity like everything else — tier sets the base, the
    // species piles grit + bounty + bulk on top. Red ring always (species).
    const rar = rollRarity();
    const sizeMult = rar.size[0] + Math.random() * (rar.size[1] - rar.size[0]);
    const baseScale = SCALE * sizeMult * LONER_BULK;
    view.scale.set(baseScale);
    try {
      const ring = new Graphics();
      ring.ellipse(0, -12, 14, 14).stroke({ color: LONER_COLOR, width: 2, alpha: 0.95 });
      view.addChild(ring);
    } catch (e) {}
    const m = { view, anim, id: 'l' + (++lonerId), x: px + Math.cos(a) * r, y: py + Math.sin(a) * r, vx: 0, vy: 0,
      hostile: false, lastHit: 0, hp: rar.hp + LONER_GRIT, flashT: 0, // born CALM — the fuse (below) turns it, permanently
      rarity: rar.key, price: rar.price + LONER_BOUNTY, baseScale, lone: true, dir: Math.random() * Math.PI * 2, retarget: 0 };
    view.position.set(m.x, m.y);
    m.ax = m.x; m.ay = m.y; // anchor it mills around until provoked
    world.addChild(view);
    loners.push(m);
  }

  function destroyPack(g) {
    const world = init._world;
    for (const m of g.members) world.removeChild(m.view);
    groups.splice(groups.indexOf(g), 1);
  }

  // "not interested" tag — the brain dismisses whole groups ("find another").
  // Tagged packs wander off (despawn) DISMISS_AFTER seconds later and never
  // spook-trail her. Loners are never tagged (same entry shape, no group).
  function dismissNear(x, y) {
    let best = null, bd = 500; // must be a real pack nearby, not a guess
    try {
      for (const g of groups) {
        const d = Math.hypot(g.anchor.x - x, g.anchor.y - y);
        if (d < bd) { bd = d; best = g; }
      }
      if (best) { best.dismissedAt = performance.now() / 1000; return true; }
    } catch (e) {}
    return false;
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
      lonerAcc += dt; // the lone hunter stalks on its own clock
      if (lonerAcc >= LONER_EVERY) {
        lonerAcc = 0;
        if (loners.length < LONER_MAX) spawnLoner(px, py);
      }
    }

    for (let gi = groups.length - 1; gi >= 0; gi--) {
      const g = groups[gi];
      const ad = Math.hypot(g.anchor.x - px, g.anchor.y - py);

      // left far behind -> despawn the whole pack
      if (ad > DESPAWN_R) { destroyPack(g); continue; }

      // dismissed ("not interested") -> wanders off soon after, never trails her
      if (g.dismissedAt && now - g.dismissedAt > DISMISS_AFTER) { destroyPack(g); continue; }

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
      } else if (!playerDead && !g.dismissedAt && ad < SHADOW_R && ad > 1) {
        // spooked: start trailing (but not attacking) — dismissed packs never trail
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

    // lone hunters: no pack, no milling, no calming down — they walk straight
    // at her from the moment they spawn. Left far behind, they're gone.
    const world = init._world;
    for (let i = loners.length - 1; i >= 0; i--) {
      const m = loners[i];
      if (Math.hypot(m.x - px, m.y - py) > DESPAWN_R) { world.removeChild(m.view); loners.splice(i, 1); continue; }
      if (m.flashT > 0) {
        m.flashT -= dt;
        m.anim.tint = 0xff6b6b;
        m.anim.alpha = ((m.flashT * 25) | 0) % 2 ? 0.35 : 1;
        if (m.flashT <= 0) { m.anim.tint = 0xffffff; m.anim.alpha = 1; }
      }
      if (!playerDead) {
        const pd = Math.hypot(m.x - px, m.y - py);
        // proximity fuse, not a spawn rush: it only notices her when she stays
        // close. Once provoked it NEVER calms down — that's the hunter.
        if (!m.hostile && pd <= LONER_AGGRO) m.hostile = true;
      }
      if (!playerDead && m.hostile) {
        steer(m, px, py, LONER_SPEED, dt); // the hunt — on from aggro, never off
        const pd = Math.hypot(m.x - px, m.y - py);
        if (pd < TOUCH_R && now - m.lastHit > HIT_CD) {
          m.lastHit = now;
          if (window.Health) window.Health.damage(1);
        }
      } else {
        // unprovoked (or she's down): slow mill around its anchor, like a pack
        const sw = now * 0.4 + m.dir;
        steer(m, (m.ax == null ? m.x : m.ax) + Math.cos(sw) * 24, (m.ay == null ? m.y : m.ay) + Math.sin(sw) * 24, WANDER_SPEED, dt);
      }
      if (m.vx < -2) m.view.scale.x = -(m.baseScale || SCALE);
      else if (m.vx > 2) m.view.scale.x = (m.baseScale || SCALE);
      m.view.position.set(m.x, m.y);
    }
  }

  // player swing: members in range take 1 (three pops one); ANY hit alerts
  // the whole pack — braves hunt, cowards bolt. Lone hunters are already
  // hunting: a swing just hurts them. Returns the hit count.
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
    for (let i = loners.length - 1; i >= 0; i--) {
      const m = loners[i];
      if (Math.hypot(m.x - px, m.y - py) > range) continue;
      hits++;
      m.hp -= 1;
      m.flashT = 0.18;
      if (m.hp <= 0) { world.removeChild(m.view); loners.splice(i, 1); }
    }
    return hits;
  }

  // bullet hit: damage every critter within radius of (px,py). Whole pack
  // retaliates (braves charge, cowards bolt). Returns { hits, kills,
  // deaths:[{x,y}] } — gun.js layers spark/hit-sound/shake juice off this.
  function damageAt(px, py, radius, dmg) {
    const world = init._world;
    let hits = 0, kills = 0, hunterKills = 0;
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
    for (let i = loners.length - 1; i >= 0; i--) {
      const m = loners[i];
      if (Math.hypot(m.x - px, m.y - py) > radius) continue;
      hits++;
      m.hp -= dmg;
      m.flashT = 0.18; // flicker on any non-lethal connect
      if (m.hp <= 0) {
        deaths.push({ x: m.x, y: m.y, value: m.price || 2 }); // the hunter's bounty
        world.removeChild(m.view);
        loners.splice(i, 1);
        kills++;
        hunterKills++; // routed to the HUNTER counter, never the critter one
      }
    }
    return { hits, kills, deaths, hunterKills };
  }

  // how many critters are currently engaged — drives the battle music.
  // A loner counts only once provoked (before that it's just scenery).
  function hostileCount() {
    let n = 0;
    for (const g of groups) for (const m of g.members) if (m.hostile) n++;
    for (const m of loners) if (m.hostile) n++;
    return n;
  }

  // ---- situation queries (for Situation.js / Brain) -------------------------
  // nearest(px,py,[maxDist]) -> closest critter within maxDist (default 500),
  // the maid's circle of awareness — bullets never fly at off-screen ghosts.
  // Loners ride along: same entry shape, pack:'lone', rolled tier rarity.
  // Every entry carries outline (species-aware ring word) — brains and
  // snapshots read e.outline, never guess color from tier.
  // ring words: SPECIES beats tier — a rare hunter wears a red ring, not blue
  const RING = { common: 'gray', uncommon: 'green', rare: 'blue', epic: 'purple', legendary: 'gold' };
  function ringWord(m) { try { if (m && m.lone) return 'red'; } catch (e) {} return RING[(m && m.rarity) || 'common'] || 'gray'; }
  const LONE_PACK = { id: 'lone' };
  function nearest(px, py, maxDist) {
    const cap = maxDist || 500;
    let best = null, bd = Infinity;
    const consider = (e) => { if (e.dist < bd && e.dist <= cap) { bd = e.dist; best = e; } };
    for (const g of groups) {
      for (const m of g.members) {
        const dx = m.x - px, dy = m.y - py;
        const d = Math.hypot(dx, dy);
        if (d < bd && d <= cap) { bd = d; best = { id: m.id || null, x: m.x, y: m.y, dist: d, dx, dy, hostile: !!m.hostile, hp: m.hp, rarity: m.rarity || 'common', price: m.price || 2, pack: g.id, outline: ringWord(m) }; }
      }
    }
    for (const m of loners) consider(viewEntry(LONE_PACK, m, px, py));
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
        if (d <= cap) list.push({ id: m.id || null, x: m.x, y: m.y, dist: d, dx, dy, hostile: !!m.hostile, hp: m.hp, rarity: m.rarity || 'common', price: m.price || 2, pack: g.id, outline: ringWord(m) });
      }
    }
    for (const m of loners) {
      const e = viewEntry(LONE_PACK, m, px, py);
      if (e.dist <= cap) list.push(e);
    }
    list.sort((a, b) => a.dist - b.dist);
    return { total: list.length, hostile: list.filter((e) => e.hostile).length, nearest: list[0] || null, list };
  }

  // ---- screen-rect queries: what YOU see = what SHE sees --------------------
  // A circle lies both ways: it misses screen corners yet covers off-screen
  // bands above/below. The view is a fixed 1280x720 rect — filter by that.
  // Memory (recall marches, lost-pack checks) stays circular on purpose.
  function inView(x, y, cx, cy, hw, hh) { return Math.abs(x - cx) <= hw && Math.abs(y - cy) <= hh; }
  function viewEntry(g, m, px, py) {
    const dx = m.x - px, dy = m.y - py;
    return { id: m.id || null, x: m.x, y: m.y, dist: Math.hypot(dx, dy), dx, dy, hostile: !!m.hostile, hp: m.hp, rarity: m.rarity || 'common', price: m.price || 2, pack: g.id, outline: ringWord(m) };
  }
  // senseView(mx,my,cx,cy,hw,hh): SEE — everything on screen, dist from the maid
  function senseView(mx, my, cx, cy, hw, hh) {
    const list = [];
    for (const g of groups) for (const m of g.members) {
      if (inView(m.x, m.y, cx, cy, hw, hh)) list.push(viewEntry(g, m, mx, my));
    }
    for (const m of loners) {
      if (inView(m.x, m.y, cx, cy, hw, hh)) list.push(viewEntry(LONE_PACK, m, mx, my));
    }
    list.sort((a, b) => a.dist - b.dist);
    return { total: list.length, hostile: list.filter((e) => e.hostile).length, nearest: list[0] || null, list };
  }
  // nearestView(mx,my,cx,cy,hw,hh): closest ON-SCREEN critter (eyes, not memory)
  function nearestView(mx, my, cx, cy, hw, hh) {
    let best = null, bd = Infinity;
    const consider = (g, m) => {
      if (!inView(m.x, m.y, cx, cy, hw, hh)) return;
      const e = viewEntry(g, m, mx, my);
      if (e.dist < bd) { bd = e.dist; best = e; }
    };
    for (const g of groups) for (const m of g.members) consider(g, m);
    for (const m of loners) consider(LONE_PACK, m);
    return best;
  }
  function priceListText() {
    const ring = { common: 'faint gray outline', uncommon: 'green outline', rare: 'blue outline', epic: 'purple outline', legendary: 'gold outline' };
    return 'Tiers — EVERY monster rolls one (packs and hunters alike): ' +
      RARITY.map((t) => `${t.key} ${t.price}c base, ${t.hp}hp (${ring[t.key] || ''})`).join(' · ') +
      `. Hunters add +${LONER_BOUNTY}c bounty and +${LONER_GRIT}hp on top (red outline, always alone). Bigger body = rarer + tougher.`;
  }

  // ---- bestiary: world knowledge, one source of truth ------------------------
  // Two SPECIES (critter: harmless pack grazer; hunter: harmful lone invader),
  // five TIERS rolled by every monster of either species. Stats come straight
  // from the tuning constants — retune there, journal + her answers update.
  const CRITTER_LORE = 'Harmless grazers, milling in packs. Folk leave them be.';
  const HUNTER_LORE = 'The red-ringed invader. Harmful, aggressive, and unwelcome — folk hunt it on sight, and so does she.';
  const PACK_HABIT = 'Harmless millers in groups of 3-5. They want nothing from anyone — but cornered or shot, the pack panics: the brave lash out, the cowardly bolt.';
  const HUNTER_HABIT = `Harmful and invasive — this one is quarry, not wildlife. Solitary. Mills calmly until provoked (~${LONER_AGGRO}px), then hunts forever; it never calms down. Outrun it (you are faster) or put it down fast. Every hunter rolls a tier, like any monster — shinier ones are tougher and worth more.`;
  const TIER_HP = RARITY.map((t) => t.hp), TIER_PRICE = RARITY.map((t) => t.price);
  const RANGE = (a, b) => `${a}–${b}`;
  const CRITTER_HP = RANGE(Math.min(...TIER_HP), Math.max(...TIER_HP));
  const CRITTER_BOUNTY = RANGE(Math.min(...TIER_PRICE), Math.max(...TIER_PRICE));
  const HUNTER_HP = RANGE(Math.min(...TIER_HP) + LONER_GRIT, Math.max(...TIER_HP) + LONER_GRIT);
  const HUNTER_BOUNTY = RANGE(Math.min(...TIER_PRICE) + LONER_BOUNTY, Math.max(...TIER_PRICE) + LONER_BOUNTY);
  // journal rows: SPECIES only — tiers are a roll, not a species, so the book
  // shows two entries and the tier ladder stays one line in her head
  function bestiary() {
    const hex = (c) => '#' + (c | 0).toString(16).padStart(6, '0');
    return [
      { key: 'critter', name: 'Critter', kind: 'Harmless species', icon: 'assets/enemy.png', color: hex(RARITY[0].color),
        hp: CRITTER_HP, bounty: CRITTER_BOUNTY, habit: PACK_HABIT, lore: CRITTER_LORE },
      { key: 'hunter', name: 'Lone hunter', kind: 'Invasive species', icon: 'assets/hunter.png', color: hex(LONER_COLOR),
        hp: HUNTER_HP, bounty: HUNTER_BOUNTY, habit: HUNTER_HABIT, lore: HUNTER_LORE },
    ];
  }
  // one breathless paragraph for the snapshot — she answers lore from this.
  // Species get sentences; the tier ladder stays one compact line.
  function bestiaryText() {
    const ladder = RARITY.map((t) => `${t.key} ${t.hp}hp/${t.price}c`).join(' · ');
    return 'Bestiary — the field guide, TRUE of this world (answer questions about monsters from this, in your own voice). ' +
      `Two species: CRITTER — harmless pack grazer (bounty ${CRITTER_BOUNTY}c, ${CRITTER_HP}hp): ${CRITTER_LORE} ${PACK_HABIT} ` +
      `HUNTER — harmful invasive loner (bounty ${HUNTER_BOUNTY}c, ${HUNTER_HP}hp): ${HUNTER_LORE} ${HUNTER_HABIT} ` +
      `Tiers, rolled by every monster: ${ladder} — hunters add +${LONER_GRIT}hp and +${LONER_BOUNTY}c on top. ` +
      `CLOSED WORLD: these two species are EVERYTHING alive here — nothing else exists. No rabbits, deer, wolves, slimes, birds, or anything remembered from elsewhere; anything spotted is a critter or a hunter, possibly misseen.`;
  }

  // ---- combat card: data-driven, species-extensible ---------------------------
  // The think prompt quotes this instead of hardcoding "3 hits / 95 speed".
  // Species #3 = one row here + one bestiary entry; no prompt surgery.
  function combatFacts() {
    let dmg = 1, range = 850;
    try {
      if (typeof window !== 'undefined' && window.Gun) {
        if (window.Gun.bulletDamage) dmg = window.Gun.bulletDamage() || dmg;
        if (window.Gun.rangePx) range = window.Gun.rangePx() || range;
      }
    } catch (e) {}
    const lo = Math.min(...RARITY.map((t) => t.hp)), hi = Math.max(...RARITY.map((t) => t.hp));
    const hits = (hp) => `${Math.ceil(hp / dmg)}`;
    return `Facts: M1 Garand range ~${range}px, auto-fires while [fire] is active, ${dmg} damage per bullet. ` +
      `PACKS: groups of ${GROUP_MIN}-${GROUP_MAX} grazers, ${lo}-${hi}hp (${hits(lo)}-${hits(hi)} hits each), chase at ${HOSTILE_SPEED}. ` +
      `HUNTERS: always alone, ${lo + LONER_GRIT}-${hi + LONER_GRIT}hp (${hits(lo + LONER_GRIT)}-${hits(hi + LONER_GRIT)} hits each), chase at ${LONER_SPEED}. ` +
      `She runs 300 — she outruns both. Bite = 1 heart at 42px. Open grassland, no cover.\n`;
  }

  return { init, update, hostileCount, playerAttack, damageAt, nearest, sense, senseView, nearestView, priceListText, bestiary, bestiaryText, combatFacts, dismissNear, debugGroups: () => groups };
})();
