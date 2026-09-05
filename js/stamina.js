// Maid stamina — she can only keep walking so long. Moving drains the tank;
// at empty she is EXHAUSTED: control locks (clicks + chat walks + brain runs)
// and she plants her feet to catch her breath until the tank refills enough.
// Classic script. main.js drives update(dt, moving) every frame.
window.Stamina = (() => {
  const MAX = 100;
  const DRAIN = 9;        // per second while moving -> ~11s of continuous travel
  const REGEN = 13;       // per second while resting -> ~4s to recover from empty
  const REST_UNTIL = 45;  // exhausted until the tank climbs back to here

  let v = MAX;
  let exhausted = false;
  let justExhausted = false; // edge flag for one-shot UI/sfx hooks
  let justRecovered = false; // edge flag: the tick breath was caught — speak once

  function update(dt, moving) {
    justExhausted = false;
    justRecovered = false;
    if (moving && !exhausted) {
      v -= DRAIN * dt;
      if (v <= 0) { v = 0; exhausted = true; justExhausted = true; }
    } else {
      v = Math.min(MAX, v + REGEN * dt);
      if (exhausted && v >= REST_UNTIL) { exhausted = false; justRecovered = true; } // breath caught
    }
    const bar = document.getElementById('stamina-fill');
    if (bar) {
      bar.style.width = (v / MAX) * 100 + '%';
      bar.classList.toggle('low', v / MAX < 0.3);
      bar.classList.toggle('rest', exhausted);
    }
    const wrap = document.getElementById('stamina-wrap');
    if (wrap) wrap.classList.toggle('resting', exhausted);
    const label = document.getElementById('stamina-label');
    if (label) label.textContent = exhausted ? 'catching breath…' : '';
  }

  // Anything that wants to move must pass this — exhausted = she won't budge.
  function canMove() { return !exhausted; }
  function state() { return { v: Math.round(v), max: MAX, exhausted, pct: v / MAX }; }

  function reset() { v = MAX; exhausted = false; justExhausted = false; justRecovered = false; } // new life = fresh legs

  function init() {
    const wrap = document.getElementById('stamina-wrap');
    if (wrap) wrap.style.display = 'flex';
    update(0, false);
  }

  return { init, update, canMove, state, reset, get exhausted() { return exhausted; }, get justExhausted() { return justExhausted; }, get justRecovered() { return justRecovered; }, get value() { return v; } };
})();
