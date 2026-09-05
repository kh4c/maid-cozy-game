// Character entity: root (position+scale) > [flat shadow, body (flip+tilt) > anims].
window.Entities = (() => {
  const { Container, AnimatedSprite, Graphics } = PIXI;

  function createCharacter(idleFrames, runFrames) {
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
    body.addChild(idleAnim);
    body.addChild(runAnim);

    let currentAnim = null; // only restart playback on state CHANGE
    function setAnimation(anim) {
      if (currentAnim === anim) return;
      idleAnim.visible = (idleAnim === anim);
      runAnim.visible = (runAnim === anim);
      anim.gotoAndPlay(0);
      currentAnim = anim;
    }

    // MAX_TILT read from settings so the dev panel can tune the lean live.
    function applySettings() {
      root.scale.set(settings.scale);
      idleAnim.animationSpeed = 1 / Math.max(0.5, settings.idleFps);
      runAnim.animationSpeed = 1 / Math.max(0.5, settings.runFps);
    }

    // a: current input axis
    function update(a) {
      if (a.x < 0) body.scale.x = -Math.abs(body.scale.x);
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
      puffs.push({ s, life: 0, max: 1, vx: 0, vy: 0, grow: 1 });
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
          p.max = p.life = 0.6 + Math.random() * 0.3;
          p.s.texture = texs[(Math.random() * texs.length) | 0];
          p.s.visible = true;
          // spawn at the feet, kicked slightly opposite the travel direction
          p.s.position.set(
            x - nx * 10 + (Math.random() * 16 - 8),
            y - 4 + (Math.random() * 6 - 3)
          );
          p.s.scale.set(0.35 + Math.random() * 0.25);
          p.grow = 0.9 + Math.random() * 0.5;
          p.vx = -nx * 24 + (Math.random() * 20 - 10);
          p.vy = -26 - Math.random() * 18;
          p.s.alpha = 1;
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
        p.s.scale.set(p.s.scale.x + p.grow * dtSec);
        p.s.alpha = 1 - t;
      }
    }

    return { layer, update };
  }

  return { createCharacter, createFootDust };
})();
