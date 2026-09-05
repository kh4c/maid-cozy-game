// Smooth camera: exponential-lerp toward the character, frame-rate independent.
// Infinite world = no clamping — the background streams in around the camera.
window.Camera = (() => {
  function create(worldContainer, app) {
    const cfg = window.CONFIG;
    let trauma = 0; // screen shake energy 0..1 — kicked by Health, decays fast

    function shake(s) { trauma = Math.min(1, trauma + (Number(s) || 0.4)); }

    // deadzone: she walks freely while inside this center box (fractions of
    // the screen); exiting an edge makes the camera drift until she's back
    // on the box rim — no more constant centering wobble.
    const DEAD = { w: 0.18, h: 0.22 };
    let swayX = 0, swayY = 0, swayW = 0, t = 0; // idle drift inside the box

    function update(targetX, targetY, dtSec) {
      t += dtSec;
      // strip last frame's sway so it never feeds back into the clamp math
      worldContainer.x -= swayX;
      worldContainer.y -= swayY;
      // pivot is at the FEET — aim at the sprite's visual middle instead
      const aimY = targetY - cfg.camAimHeightPx * window.Settings.settings.scale;
      const cx = app.screen.width / 2, cy = app.screen.height / 2;
      const dw = app.screen.width * DEAD.w / 2, dh = app.screen.height * DEAD.h / 2;
      // her on-screen position right now (camera offset + world pos)
      const sx = worldContainer.x + targetX, sy = worldContainer.y + aimY;
      // clamp her into the box — camera moves only by the overshoot
      const qx = Math.max(cx - dw, Math.min(cx + dw, sx));
      const qy = Math.max(cy - dh, Math.min(cy + dh, sy));
      const tX = worldContainer.x - (sx - qx);
      const tY = worldContainer.y - (sy - qy);
      // inside the box (no overshoot) the camera breathes: slow layered drift
      const inside = sx === qx && sy === qy;
      swayW += ((inside ? 1 : 0) - swayW) * Math.min(1, 1.5 * dtSec);
      swayX = (Math.sin(t * 0.5) * 3.5 + Math.sin(t * 0.83 + 1.7) * 1.5) * swayW;
      swayY = (Math.sin(t * 0.62 + 0.9) * 2.6 + Math.sin(t * 1.03 + 3.1) * 1.2) * swayW;
      const tt = 1 - Math.exp(-cfg.camera.lerp * dtSec);
      worldContainer.x += (tX - worldContainer.x) * tt + swayX;
      worldContainer.y += (tY - worldContainer.y) * tt + swayY;
      if (trauma > 0) {
        trauma = Math.max(0, trauma - dtSec * 1.6); // full kick ≈ 0.6s of rattle
        const mag = trauma * trauma * 14; // quadratic: punchy start, soft tail
        worldContainer.x += (Math.random() * 2 - 1) * mag;
        worldContainer.y += (Math.random() * 2 - 1) * mag;
      }
    }

    // snap instantly (used on init so the camera doesn't glide from 0,0)
    function snap(targetX, targetY) {
      const aimY = targetY - cfg.camAimHeightPx * window.Settings.settings.scale;
      worldContainer.x = app.screen.width / 2 - targetX;
      worldContainer.y = app.screen.height / 2 - aimY;
    }

    return { update, snap, shake };
  }
  return { create };
})();
