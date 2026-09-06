// Mouse click-to-move -> movement axis. No WASD — the player points, she walks.
// A click owns her feet briefly (AI movement yields while the pin is live);
// with no live click and a standing goal/task, the brain's orders flow again —
// that handoff IS the AI taking back over. Classic script.
window.Input = (() => {
  let attackQueued = false; // edge-triggered swing (Space/J), consumed by main

  window.addEventListener('keydown', (e) => {
    // typing in an input (chat box, dev sliders) — never game keys
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.code === 'KeyP') window.Settings.togglePanel(); // P toggles dev panel
    if (e.code === 'KeyI' && window.Equipment) window.Equipment.toggle(); // I toggles equipment
    if (e.code === 'KeyE' && window.EditMode.ready) window.EditMode.toggle();      // E toggles UI edit mode
    if (e.code === 'Escape' && window.EditMode.ready && window.EditMode.active) window.EditMode.toggle(); // Esc exits
    if (e.code === 'KeyR' && window.EditMode.ready && window.EditMode.active) window.EditMode.resetLayout(); // R resets UI layout (only while editing)
    if (!e.repeat && (e.code === 'Space' || e.code === 'KeyJ')) attackQueued = true; // swing
  });

  // Chat/brain-ordered walking: order(x, y, secs) sets a timed direction
  // vector; axis() merges it and drops it on expiry. stopWalk() cancels.
  // push=true = the PLAYER told her (chat words / move tag) — these legs may
  // drain the tank past quarter to empty. push=false (default) = her own
  // auto-run (brain strolls/follows) — parks at 1/4 to rest instead.
  let chatMove = null; // { x, y, until, push }
  function order(x, y, secs, push) {
    const s = Math.max(0.3, Math.min(8, Number(secs) || 2));
    chatMove = { x: Number(x) || 0, y: Number(y) || 0, until: performance.now() + s * 1000, push: !!push };
  }
  function stopWalk() { chatMove = null; }

  // Click-to-move: a world pin with a short leash. Arrival (~14px) or 4s ends
  // it; each new click re-pins. While live, AI orders are ignored (not lost).
  let clickMove = null; // { x, y, until }
  const CLICK_SECS = 4; // one click owns her feet up to 4s — then AI resumes
  const ARRIVE_R = 14;  // close enough: stop, hand the feet back
  function clickTo(wx, wy) {
    if (!isFinite(wx) || !isFinite(wy)) return;
    clickMove = { x: wx, y: wy, until: performance.now() + CLICK_SECS * 1000 };

  }
  function manualActive() { return !!clickMove && performance.now() <= clickMove.until; }
  // pushedActive: player-owned feet RIGHT NOW — live click pin, a live
  // player-pushed chat order, or a recent "keep going!" urge window.
  // Auto-run (brain legs) never counts.
  let pushWindowUntil = 0;
  function pushFor(secs) { pushWindowUntil = performance.now() + Math.max(1, Math.min(12, Number(secs) || 6)) * 1000; }
  function pushWindowLive() { return performance.now() <= pushWindowUntil; }
  function pushedActive() {
    if (!!clickMove && performance.now() <= clickMove.until) return true;
    if (chatMove && performance.now() <= chatMove.until && chatMove.push) return true;
    if (pushWindowLive()) return true;
    return false;
  }
  // directedPush: the player gave her a DIRECTION (click pin / pushed chat
  // order) — auto legs must not overwrite or cancel it. A bare "keep going!"
  // window does NOT count: during it the brain SHOULD keep issuing auto legs
  // (that's the whole point — she works on your word), stamina just bills
  // those legs as pushed so they can run past quarter.
  function directedPush() {
    if (!!clickMove && performance.now() <= clickMove.until) return true;
    if (chatMove && performance.now() <= chatMove.until && chatMove.push) return true;
    return false;
  }

  function bindCanvas(canvas) {
    if (!canvas || canvas._clickMoveBound) return;
    canvas._clickMoveBound = true;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return; // left clicks walk
      try {
        if (window.EditMode && window.EditMode.active) return; // editing, not walking
        if (window.Health && window.Health.dead) return;       // fainted: no control
        const cam = window.__maidCamera;
        if (!cam || typeof cam.toWorld !== 'function') return;
        const w = cam.toWorld(e.clientX, e.clientY);
        if (w) {
          try { if (window.Town && window.Town.tryTalk && window.Town.tryTalk(w.x, w.y)) return; } catch (err) {} // an NPC ate the click — talk, don't walk
          clickTo(w.x, w.y);
        }
      } catch (err) { /* a bad click walks nowhere */ }
    });
  }

  // axis(px, py): needs her feet position for click steering. Manual pin wins
  // while live; otherwise AI/chat orders flow — the take-over is automatic.
  function axis(px, py) {
    if (clickMove) {
      if (performance.now() > clickMove.until) clickMove = null;
      else {
        const dx = clickMove.x - (Number(px) || 0), dy = clickMove.y - (Number(py) || 0);
        const d = Math.hypot(dx, dy);
        if (d < ARRIVE_R) clickMove = null;
        else return { x: dx / d, y: dy / d };
      }
    }
    let x = 0, y = 0;
    if (chatMove) {
      if (performance.now() > chatMove.until) chatMove = null;
      else { x += chatMove.x; y += chatMove.y; }
    }
    const len = Math.hypot(x, y); // clamp AI/chat input to unit
    if (len > 1) { x /= len; y /= len; }
    return { x, y };
  }

  // swing edge: true once per press, then consumed
  function attackPressed() {
    const q = attackQueued;
    attackQueued = false;
    return q;
  }

  return { axis, order, stopWalk, clickTo, manualActive, pushedActive, directedPush, pushFor, bindCanvas, attackPressed };
})();
