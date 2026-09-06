// Smooth camera: exponential-lerp toward the character, frame-rate independent.
// Infinite world = no clamping — the background streams in around the camera.
// Combat zoom: while a fight holds the whole world eases out to 80% (pivot on
// the screen center, so the focus never drifts), then leans back in on calm.
window.Camera = (() => {
  // focus-beat tunables: every lookAt ("look at that!") drops the WORLD into
  // slow-mo for a breath while the camera leans harder toward the monster.
  // The camera itself never slows — only the world's dt shrinks (see main.js).
  const SLOW_SCALE = 0.3;   // world runs at 30% while the beat holds
  const SLOW_SECS = 1.2;    // how long the beat lasts per lookAt
  const BLEND_CALM = 0.55;  // normal focus: meet the target partway
  const BLEND_SLOW = 0.8;   // slow-mo focus: lean almost all the way in
  const ZOOM_CALM = 1;      // leaning in close on quiet grass
  const ZOOM_COMBAT = 0.8;  // the fight breathes out — ~25% more field on screen
  const ZOOM_EASE = 2.2;    // eased both ways, never a snap-cut
  const ZOOM_HOLD = 4;      // the lens stays out this long after the last hostile drops
  let combatOn = false, holdT = 0; // live combat flag + the linger timer
  let zoom = 1, zoomT = 1;  // eased scale + where it's headed
  let baseX = 0, baseY = 0; // follow position at scale 1 — zoom maps on top, never inside the math
  function setCombat(on) {
    combatOn = !!on;
    if (combatOn) holdT = ZOOM_HOLD; // every combat frame re-arms the linger
  }
  function getZoom() { return zoom; }
  function create(worldContainer, app) {
    const cfg = window.CONFIG;
    let trauma = 0; // screen shake energy 0..1 — kicked by Health, decays fast
    let slowUntil = 0; // performance.now() horizon of the current slow-mo beat
    let curScale = 1;  // eased time scale — snaps down fast, floats back up

    function shake(s) { trauma = Math.min(1, trauma + (Number(s) || 0.4)); }

    // deadzone: she walks freely while inside this center box (fractions of
    // the screen); exiting an edge makes the camera drift until she's back
    // on the box rim — no more constant centering wobble.
    const DEAD = { w: 0.18, h: 0.22 };
    let swayX = 0, swayY = 0, swayW = 0, t = 0; // idle drift inside the box

    // lookAt(x, y, secs): "look at that for a moment" — the follow point blends
    // toward a world spot (e.g. a found critter pack) while the focus holds,
    // then eases back to her. Purely cosmetic; never moves the character.
    // Every lookAt ALSO punches slow-mo: the world drops to SLOW_SCALE for
    // SLOW_SECS while the camera leans in — the focus beat.
    let focus = null; // { x, y, until }
    function lookAt(x, y, secs) {
      const s = Math.max(0.5, Math.min(8, Number(secs) || 2.5));
      focus = { x: Number(x) || 0, y: Number(y) || 0, until: performance.now() + s * 1000 };
      try { slowUntil = performance.now() + SLOW_SECS * 1000; } catch (e) {}
    }

    // world's time scale for this frame — main.js multiplies the WORLD dt by
    // this (never the camera's). Eases: dives fast, floats back up soft.
    function timeScale(dt) {
      let target = 1;
      try { target = performance.now() < slowUntil ? SLOW_SCALE : 1; } catch (e) {}
      const k = Math.min(1, 5 * (Number(dt) || 0.016));
      curScale += (target - curScale) * k;
      if (Math.abs(curScale - target) < 0.01) curScale = target;
      return curScale;
    }

    function update(targetX, targetY, dtSec) {
      t += dtSec;
      // focus blend: while a lookAt holds, meet it partway — and lean almost
      // all the way in while the slow-mo beat holds (the focus moment)
      let slowmo = false;
      try { slowmo = performance.now() < slowUntil; } catch (e) {}
      const blend = slowmo ? BLEND_SLOW : BLEND_CALM;
      let fX = targetX, fY = targetY;
      try {
        if (focus && performance.now() < focus.until) {
          fX = targetX + (focus.x - targetX) * blend;
          fY = targetY + (focus.y - targetY) * blend;
        } else focus = null;
      } catch (e) { focus = null; }
      const aimY = fY - cfg.camAimHeightPx * window.Settings.settings.scale;
      // strip last frame's sway so it never feeds back into the clamp math
      baseX -= swayX;
      baseY -= swayY;
      // pivot is at the FEET — aim at the sprite's visual middle instead
      const cx = app.screen.width / 2, cy = app.screen.height / 2;
      const dw = app.screen.width * DEAD.w / 2, dh = app.screen.height * DEAD.h / 2;
      // her on-screen position right now (follow offset + world pos, scale-1 space)
      const sx = baseX + fX, sy = baseY + aimY;
      // clamp her into the box — camera moves only by the overshoot
      const qx = Math.max(cx - dw, Math.min(cx + dw, sx));
      const qy = Math.max(cy - dh, Math.min(cy + dh, sy));
      const tX = baseX - (sx - qx);
      const tY = baseY - (sy - qy);
      // inside the box (no overshoot) the camera breathes: slow layered drift
      const inside = sx === qx && sy === qy;
      swayW += ((inside ? 1 : 0) - swayW) * Math.min(1, 1.5 * dtSec);
      swayX = (Math.sin(t * 0.5) * 3.5 + Math.sin(t * 0.83 + 1.7) * 1.5) * swayW;
      swayY = (Math.sin(t * 0.62 + 0.9) * 2.6 + Math.sin(t * 1.03 + 3.1) * 1.2) * swayW;
      const tt = 1 - Math.exp(-cfg.camera.lerp * dtSec);
      baseX += (tX - baseX) * tt + swayX;
      baseY += (tY - baseY) * tt + swayY;
      if (trauma > 0) {
        trauma = Math.max(0, trauma - dtSec * 1.6); // full kick ≈ 0.6s of rattle
        const mag = trauma * trauma * 14; // quadratic: punchy start, soft tail
        baseX += (Math.random() * 2 - 1) * mag;
        baseY += (Math.random() * 2 - 1) * mag;
      }
      // combat zoom maps on top: ease the scale, then pin the container so the
      // screen center shows the same world point at every zoom (no drift).
      // The hold keeps the lens out after the fight — it leans back in late.
      if (holdT > 0) holdT -= dtSec;
      zoomT = (combatOn || holdT > 0) ? ZOOM_COMBAT : ZOOM_CALM;
      zoom += (zoomT - zoom) * Math.min(1, ZOOM_EASE * dtSec);
      if (Math.abs(zoom - zoomT) < 0.002) zoom = zoomT;
      try {
        worldContainer.scale.set(zoom);
        worldContainer.x = cx + (baseX - cx) * zoom;
        worldContainer.y = cy + (baseY - cy) * zoom;
      } catch (e) { try { worldContainer.x = baseX; worldContainer.y = baseY; } catch (e2) {} }
    }

    // snap instantly (used on init so the camera doesn't glide from 0,0)
    function snap(targetX, targetY) {
      const aimY = targetY - cfg.camAimHeightPx * window.Settings.settings.scale;
      baseX = app.screen.width / 2 - targetX;
      baseY = app.screen.height / 2 - aimY;
      try {
        const cx = app.screen.width / 2, cy = app.screen.height / 2;
        worldContainer.scale.set(zoom);
        worldContainer.x = cx + (baseX - cx) * zoom;
        worldContainer.y = cy + (baseY - cy) * zoom;
      } catch (e) { try { worldContainer.x = baseX; worldContainer.y = baseY; } catch (e2) {} }
    }

    // view center in WORLD coords — zoom pivots exactly on the screen center,
    // so the center world point never moves with the scale
    function viewCenter() {
      try {
        return { x: app.screen.width / 2 - baseX, y: app.screen.height / 2 - baseY };
      } catch (e) { return { x: 0, y: 0 }; }
    }

    // client (CSS-pixel) click -> world coords, for click-to-move
    function toWorld(clientX, clientY) {
      try {
        const r = app.canvas.getBoundingClientRect();
        const c = viewCenter();
        const sx = (clientX - r.left) / r.width * app.screen.width;
        const sy = (clientY - r.top) / r.height * app.screen.height;
        return { x: c.x + (sx - app.screen.width / 2) / zoom, y: c.y + (sy - app.screen.height / 2) / zoom };
      } catch (e) { return null; }
    }

    // view rect in WORLD coords — the half-extents breathe with the zoom, so
    // pan decisions ("is that find on screen?") stay honest mid-fight
    function viewRect() {
      try {
        const c = viewCenter();
        return { x: c.x, y: c.y, hw: app.screen.width / 2 / zoom, hh: app.screen.height / 2 / zoom };
      } catch (e) { return { x: 0, y: 0, hw: 640, hh: 360 }; }
    }

    // spotlight hook: the live lookAt point (world) while a pan holds, else
    // null — at night the clear hole centers on what the camera SHOWS.
    function spot() {
      try { if (focus && performance.now() < focus.until) return { x: focus.x, y: focus.y }; } catch (e) {}
      return null;
    }

    return { update, snap, shake, lookAt, viewCenter, viewRect, toWorld, timeScale, spot, setCombat, getZoom };
  }
  return { create };
})();
