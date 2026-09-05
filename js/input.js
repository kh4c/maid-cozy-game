// Keyboard input -> movement axis. Classic script.
window.Input = (() => {
  const keys = Object.create(null);

  window.addEventListener('keydown', (e) => {
    // typing in an input (chat box, dev sliders) — never game keys
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.code === 'KeyP') window.Settings.togglePanel(); // P toggles dev panel
    if (e.code === 'KeyE' && window.EditMode.ready) window.EditMode.toggle();      // E toggles UI edit mode
    if (e.code === 'Escape' && window.EditMode.ready && window.EditMode.active) window.EditMode.toggle(); // Esc exits
    if (e.code === 'KeyR' && window.EditMode.ready && window.EditMode.active) window.EditMode.resetLayout(); // R resets UI layout (only while editing)
    keys[e.code] = true;
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });

  // Chat-ordered walking: "go left" drives the sprite without keys.
  // order(x, y, secs) sets a timed direction vector; axis() merges it with
  // WASD and drops it on expiry. stopWalk() cancels (user "stop" / new pin).
  let chatMove = null; // { x, y, until }
  function order(x, y, secs) {
    const s = Math.max(0.3, Math.min(8, Number(secs) || 2));
    chatMove = { x: Number(x) || 0, y: Number(y) || 0, until: performance.now() + s * 1000 };
  }
  function stopWalk() { chatMove = null; }

  // Normalized movement axis (diagonals scaled so speed is consistent)
  function axis() {
    let x = 0, y = 0;
    if (keys['KeyA'] || keys['ArrowLeft'])  x -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) x += 1;
    if (keys['KeyW'] || keys['ArrowUp'])    y -= 1;
    if (keys['KeyS'] || keys['ArrowDown'])  y += 1;
    if (x !== 0 && y !== 0) { const inv = 1 / Math.SQRT2; x *= inv; y *= inv; }
    if (chatMove) {
      if (performance.now() > chatMove.until) chatMove = null;
      else { x += chatMove.x; y += chatMove.y; }
    }
    const len = Math.hypot(x, y); // clamp combined keys+chat input to unit
    if (len > 1) { x /= len; y /= len; }
    return { x, y };
  }

  return { axis, order, stopWalk };
})();
