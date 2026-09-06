// Character entity: root (position+scale) > [flat shadow, body (flip+tilt) > anims].
window.Entities = (() => {
  const { Container, AnimatedSprite, Graphics } = PIXI;

  function createCharacter(idleFrames, runFrames, dieFrames, fallFrames) {
    const settings = window.Settings.settings;

    // root: world position + overall scale. body: flip/tilt only —
    // keeping them separate means the shadow never flips or tilts with the sprite.
    const root = new Container();
    const body = new Container();
    // shadow added BEFORE body -> renders underneath the sprite
    const shadow = new Graphics();
    shadow.ellipse(0, -4, 18, 6).fill({ color: 0x000000, alpha: 0.3 });
    root.addChild(shadow);
    root.addChild(body);

    function makeAnim(frames) {
      const anim = new AnimatedSprite(frames);
      anim.anchor.set(0.5, 1); // pivot at feet so movement feels grounded
      return anim;
    }
    const idleAnim = makeAnim(idleFrames);
    const runAnim = makeAnim(runFrames);
    // death anim: plays ONCE and holds the last (fallen) frame — loop off.
    // fall anim (tripped, SG_Maid_fall 4x2): same treatment, one level below death.
    const dieAnim = dieFrames ? makeAnim(dieFrames) : null;
    if (dieAnim) dieAnim.loop = false;
    const fallAnim = fallFrames ? makeAnim(fallFrames) : null;
    if (fallAnim) fallAnim.loop = false;
    body.addChild(idleAnim);
    body.addChild(runAnim);
    if (dieAnim) body.addChild(dieAnim);
    if (fallAnim) body.addChild(fallAnim);

    let currentAnim = null; // only restart playback on state CHANGE
    function setAnimation(anim) {
      if (currentAnim === anim) return;
      idleAnim.visible = (idleAnim === anim);
      runAnim.visible = (runAnim === anim);
      if (dieAnim) dieAnim.visible = (dieAnim === anim);
      if (fallAnim) fallAnim.visible = (fallAnim === anim);
      anim.gotoAndPlay(0);
      currentAnim = anim;
    }

    // MAX_TILT read from settings so the dev panel can tune the lean live.
    function applySettings() {
      root.scale.set(settings.scale);
      idleAnim.animationSpeed = 1 / Math.max(0.5, settings.idleFps);
      runAnim.animationSpeed = 1 / Math.max(0.5, settings.runFps);
      if (dieAnim) dieAnim.animationSpeed = 1 / Math.max(0.5, settings.dieFps ?? 8);
      if (fallAnim) fallAnim.animationSpeed = 1 / Math.max(0.5, settings.fallFps ?? 8);
    }

    // a: current input axis; dead: fainted — play the die sheet, hold the fall;
    // face: attack override from the gun (-1 enemy-left, +1 enemy-right);
    // down: tripped — fall anim plays once and holds her down (below death).
    function update(a, dead, face, down) {
      if (dead && dieAnim) {
        body.rotation = 0;
        setAnimation(dieAnim);
        return;
      }
      if (down && fallAnim) {
        body.rotation = 0;
        setAnimation(fallAnim);
        return;
      }
      if (face === -1) body.scale.x = -Math.abs(body.scale.x);
      else if (face === 1) body.scale.x = Math.abs(body.scale.x);
      else if (a.x < 0) body.scale.x = -Math.abs(body.scale.x);
      else if (a.x > 0) body.scale.x = Math.abs(body.scale.x);

      // 8-way facing: lean toward vertical movement, flip-compensated (local-space tilt)
      if (a.x !== 0 || a.y !== 0) {
        const flipSign = body.scale.x < 0 ? -1 : 1;
        body.rotation = Math.max(-1, Math.min(1, a.y)) * settings.maxTilt * flipSign;
      } else {
        body.rotation = 0;
      }
      setAnimation((a.x !== 0 || a.y !== 0) ? runAnim : idleAnim);
    }

    root.position.set(0, 0); // infinite world: spawn at origin (chunk 0,0 center-ish)
    return { view: root, update, applySettings };
  }

  // Foot dust: world-space puff pool using the user's assets/dust.png.
  // Caller adds dust.layer to the world BEFORE the character so puffs render
  // under her feet. update() spawns while moving, each puff drifting up/back,
  // expanding and fading for ~half a second before recycling.
  function createFootDust(world, textures) {
    const { Container: C, Sprite } = PIXI;
    const texs = Array.isArray(textures) ? textures : [textures];
    const layer = new C();
    world.addChild(layer);

    const POOL = 40;
    const puffs = [];
    for (let i = 0; i < POOL; i++) {
      const s = new Sprite(texs[0]);
      s.anchor.set(0.5);
      s.visible = false;
      layer.addChild(s);
      puffs.push({ s, life: 0, max: 1, vx: 0, vy: 0, s0: 0.5, rot: 0, a0: 1 });
    }
    let idx = 0;
    let spawnAcc = 0;

    // x, y: feet position (character root); dx, dy: normalized input axis
    function update(dtSec, x, y, moving, dx, dy) {
      if (moving) {
        const len = Math.hypot(dx, dy) || 1;
        const nx = dx / len, ny = dy / len;
        spawnAcc += dtSec;
        while (spawnAcc > 0.05) {
          spawnAcc -= 0.05;
          const p = puffs[idx];
          idx = (idx + 1) % POOL;
          p.max = p.life = 0.5 + Math.random() * 0.5;
          p.s.texture = texs[(Math.random() * texs.length) | 0];
          p.s.visible = true;
          // spawn around the feet, kicked slightly opposite the travel direction
          p.s.position.set(
            x - nx * 10 + (Math.random() * 28 - 14),
            y - 4 + (Math.random() * 12 - 6)
          );
          // start big, shrink to ~30% by end of life
          p.s0 = 0.5 + Math.random() * 0.4;
          p.s.scale.set(p.s0);
          p.s.rotation = Math.random() * Math.PI * 2;
          p.rot = (Math.random() - 0.5) * 6; // spin either way, up to ~3 rad/s
          p.vx = -nx * 24 + (Math.random() * 44 - 22);
          p.vy = -26 - Math.random() * 30;
          p.a0 = 0.7 + Math.random() * 0.3;
          p.s.alpha = p.a0;
        }
      } else {
        spawnAcc = 0;
      }
      for (const p of puffs) {
        if (!p.s.visible) continue;
        p.life -= dtSec;
        if (p.life <= 0) { p.s.visible = false; continue; }
        const t = 1 - p.life / p.max; // 0 (fresh) -> 1 (gone)
        p.s.x += p.vx * dtSec;
        p.s.y += p.vy * dtSec;
        p.vx *= (1 - 2 * dtSec);
        p.vy *= (1 - 2 * dtSec);
        p.s.rotation += p.rot * dtSec;
        p.s.scale.set(p.s0 * (1 - 0.7 * t)); // shrink to ~30% as it dissipates
        p.s.alpha = p.a0 * (1 - t);
      }
    }

    return { layer, update };
  }

  return { createCharacter, createFootDust };
})();
