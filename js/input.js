// Keyboard input -> movement axis. Classic script.
window.Input = (() => {
  const keys = Object.create(null);

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyP') window.Settings.togglePanel(); // P toggles dev panel
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
