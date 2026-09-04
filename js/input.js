// Keyboard input -> movement axis. Classic script.
window.Input = (() => {
  const keys = Object.create(null);

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyP') window.Settings.togglePanel(); // P toggles dev panel
    if (e.code === 'KeyE' && window.EditMode.ready) window.EditMode.toggle();      // E toggles UI edit mode
    if (e.code === 'Escape' && window.EditMode.ready && window.EditMode.active) window.EditMode.toggle(); // Esc exits
    if (e.code === 'KeyR' && window.EditMode.ready && window.EditMode.active) window.EditMode.resetLayout(); // R resets UI layout (only while editing)
    keys[e.code] = true;
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });

  // Normalized movement axis (diagonals scaled so speed is consistent)
  function axis() {
    let x = 0, y = 0;
    if (keys['KeyA'] || keys['ArrowLeft'])  x -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) x += 1;
    if (keys['KeyW'] || keys['ArrowUp'])    y -= 1;
    if (keys['KeyS'] || keys['ArrowDown'])  y += 1;
    if (x !== 0 && y !== 0) { const inv = 1 / Math.SQRT2; x *= inv; y *= inv; }
    return { x, y };
  }

  return { axis };
})();
