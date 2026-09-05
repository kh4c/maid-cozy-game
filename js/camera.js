// Smooth camera: exponential-lerp toward the character, frame-rate independent.
// Infinite world = no clamping — the background streams in around the camera.
window.Camera = (() => {
  function create(worldContainer, app) {
    const cfg = window.CONFIG;
    let trauma = 0; // screen shake energy 0..1 — kicked by Health, decays fast

    function shake(s) { trauma = Math.min(1, trauma + (Number(s) || 0.4)); }

    function update(targetX, targetY, dtSec) {
      // pivot is at the FEET — aim at the sprite's visual middle instead
      const aimY = targetY - cfg.camAimHeightPx * window.Settings.settings.scale;
      const tX = app.screen.width / 2 - targetX;
      const tY = app.screen.height / 2 - aimY;
      const t = 1 - Math.exp(-cfg.camera.lerp * dtSec);
      worldContainer.x += (tX - worldContainer.x) * t;
      worldContainer.y += (tY - worldContainer.y) * t;
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
