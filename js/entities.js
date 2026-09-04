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

    function applySettings() {
      root.scale.set(settings.scale);
      idleAnim.animationSpeed = 1 / Math.max(0.5, settings.idleFps);
      runAnim.animationSpeed = 1 / Math.max(0.5, settings.runFps);
    }

    const MAX_TILT = 0.22; // radians ~12.6° lean at full vertical input
    // a: current input axis
    function update(a) {
      if (a.x < 0) body.scale.x = -Math.abs(body.scale.x);
      else if (a.x > 0) body.scale.x = Math.abs(body.scale.x);

      // 8-way facing: lean toward vertical movement, flip-compensated (local-space tilt)
      if (a.x !== 0 || a.y !== 0) {
        const flipSign = body.scale.x < 0 ? -1 : 1;
        body.rotation = Math.max(-1, Math.min(1, a.y)) * MAX_TILT * flipSign;
      } else {
        body.rotation = 0;
      }
      setAnimation((a.x !== 0 || a.y !== 0) ? runAnim : idleAnim);
    }

    root.position.set(0, 0); // infinite world: spawn at origin (chunk 0,0 center-ish)
    return { view: root, update, applySettings };
  }

  return { createCharacter };
})();
