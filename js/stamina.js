// Maid stamina — she can only keep walking so long. Moving drains the tank;
// at empty she is EXHAUSTED: control locks (clicks + chat walks + brain runs)
// and she plants her feet to catch her breath until the tank refills enough.
// Classic script. main.js drives update(dt, moving) every frame.
window.Stamina = (() => {
  const MAX = 100;
  const DRAIN = 4.5;        // per second while moving -> ~22s continuous travel (2x)
  const REGEN = 8;          // per second while quarter-resting -> a real breather, not instant
  const REGEN_EMPTY = 3.5;  // per second while fully exhausted -> running dry costs real time
  const REST_DELAY = 1.5;   // seconds standing still before quarter-rest regen kicks in
  const EMPTY_DELAY = 3.0;  // seconds doubled-over before empty-tank regen even starts
  const REST_UNTIL = 50;    // exhausted until the tank climbs back to here
  const AUTO_REST_AT = 25;  // auto-run parks HERE (1/4) — only pushed legs go lower
  const AUTO_RESUME_AT = 55;// auto-run resumes here (hysteresis, no flicker)

  let v = MAX;
  let exhausted = false;
  let autoRest = false;      // latched voluntary rest at 1/4 (auto legs only)
  let stillFor = 0;          // seconds since her feet actually stopped — regen waits out the cooldown
  let justExhausted = false; // edge flag for one-shot UI/sfx hooks
  let justRecovered = false; // edge flag: the tick breath was caught — speak once
  let justRested = false;    // edge flag: the tick auto-run parked at 1/4 — speak once

  function update(dt, moving, pushed) {
    justExhausted = false;
    justRecovered = false;
    justRested = false;
    const wantGo = moving && !exhausted && !(autoRest && !pushed);
    if (wantGo) {
      stillFor = 0; // moving resets the regen cooldown
      v -= DRAIN * dt;
      if (!pushed && v <= AUTO_REST_AT) {
        // her own legs park at a quarter — pushed legs blow straight past
        v = AUTO_REST_AT;
        if (!autoRest) { autoRest = true; justRested = true; }
      }
      if (v <= 0) { v = 0; exhausted = true; autoRest = false; justExhausted = true; }
    } else {
      stillFor += dt; // standing still — cooldown ticks
      const delay = exhausted ? EMPTY_DELAY : REST_DELAY;
      if (stillFor >= delay) {
        v = Math.min(MAX, v + (exhausted ? REGEN_EMPTY : REGEN) * dt);
        if (exhausted && v >= REST_UNTIL) { exhausted = false; justRecovered = true; } // breath caught (slow)
        if (autoRest && v >= AUTO_RESUME_AT) autoRest = false; // legs back — auto resumes quietly
      }
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
    if (label) label.textContent = exhausted ? 'catching breath…' : (autoRest ? 'resting legs…' : '');
  }

  // Anything that wants to move must pass this — exhausted stops everything;
  // autoRest stops AUTO legs only (pushed legs walk her down to empty).
  function canMove(pushed) { return !exhausted && !(autoRest && !pushed); }
  function state() { return { v: Math.round(v), max: MAX, exhausted, autoRest, pct: v / MAX }; }

  function reset() { v = MAX; exhausted = false; autoRest = false; stillFor = 0; justExhausted = false; justRecovered = false; justRested = false; } // new life = fresh legs

  function init() {
    const wrap = document.getElementById('stamina-wrap');
    if (wrap) wrap.style.display = 'flex';
    update(0, false);
  }

  return { init, update, canMove, state, reset, get exhausted() { return exhausted; }, get justExhausted() { return justExhausted; }, get justRecovered() { return justRecovered; }, get justRested() { return justRested; }, get value() { return v; } };
})();
