// Maid stamina — she can only keep walking so long. Moving drains the tank;
// at empty she is EXHAUSTED: control locks (clicks + chat walks + brain runs)
// and she plants her feet to catch her breath until the tank refills enough.
// Classic script. main.js drives update(dt, moving) every frame.
window.Stamina = (() => {
  let MAX = 100; // raised by the store (bigger-tank upgrade), persisted in cosette.store
  const DRAIN = 4.5;        // per second while moving -> ~22s continuous travel (2x)
  const REGEN = 8;          // per second while quarter-resting -> a real breather, not instant
  const REGEN_EMPTY = 3.5;  // per second while fully exhausted -> running dry costs real time
  const REST_DELAY = 5;   // seconds standing still before quarter-rest regen kicks in
  const EMPTY_DELAY = 10; // seconds doubled-over before empty-tank regen even starts
  const REST_UNTIL = 50;    // exhausted until the tank climbs back to here
  const AUTO_REST_AT = 25;  // auto-run parks HERE (1/4) — only pushed legs go lower
  const AUTO_RESUME_AT = 55;// auto-run resumes here (hysteresis, no flicker)
  // ORANGE ZONE (matches the bar's 'low' line): tired legs stumble. Chance per
  // second while running down here; urged (pushed) legs ALWAYS eat dirt.
  const TRIP_PCT = 0.30;   // below this fraction of the tank, every step can trip
  const TRIP_CHANCE = 0.10;// per second of orange running -> a fall every ~10s of pushing it
  const FALL_SECS = 2.2;   // face-down time: fall anim plays once, legs locked
  const TRIP_GRACE = 3.0;  // no-trip window after getting up (no chain face-plants)

  let v = MAX;
  let exhausted = false;
  let autoRest = false;      // latched voluntary rest at 1/4 (auto legs only)
  let stillFor = 0;          // seconds since her feet actually stopped — regen waits out the cooldown
  let justExhausted = false; // edge flag for one-shot UI/sfx hooks
  let justRecovered = false; // edge flag: the tick breath was caught — speak once
  let justRested = false;    // edge flag: the tick auto-run parked at 1/4 — speak once
  let tripped = false, tripT = 0, graceT = 0; // fall state: down timer + post-fall grace
  let justTripped = false; // edge flag: the tick she ate dirt — anim + line once

  function update(dt, moving, pushed, urged) {
    justExhausted = false;
    justRecovered = false;
    justRested = false;
    justTripped = false;
    if (graceT > 0) graceT -= dt;
    if (tripped) { // face-down: the fall plays, then she gets up with a no-trip grace
      tripT -= dt;
      if (tripT <= 0) { tripped = false; graceT = TRIP_GRACE; }
    }
    const wantGo = moving && !exhausted && !tripped && !(autoRest && !pushed);
    if (wantGo) {
      stillFor = 0; // moving resets the regen cooldown
      v -= DRAIN * dt;
      if (!pushed && v <= AUTO_REST_AT) {
        // her own legs park at a quarter — pushed legs blow straight past.
        // (latch only, never clamp UP: a pushed dip below quarter stays dipped)
        if (!autoRest) { autoRest = true; justRested = true; }
      }
      if (v <= 0) { v = 0; exhausted = true; autoRest = false; justExhausted = true; }
      else if (graceT <= 0 && v / MAX < TRIP_PCT) {
        // ORANGE ZONE: tired legs stumble — small chance per second, but a bare
        // URGE (master's "keep going!", no direction) ALWAYS eats dirt: she obeys
        // on his word and falls on his word. Directed pushes risk only the chance.
        if (urged || Math.random() < TRIP_CHANCE * dt) { tripped = true; tripT = FALL_SECS; justTripped = true; }
      }
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
  function canMove(pushed) { return !exhausted && !tripped && !(autoRest && !pushed); }
  function state() { return { v: Math.round(v), max: MAX, exhausted, autoRest, tripped, pct: v / MAX }; }

  function setMax(m) { MAX = Math.max(50, Math.round(Number(m) || MAX)); if (v > MAX) v = MAX; } // store-bought tank
  function reset() { v = MAX; exhausted = false; autoRest = false; stillFor = 0; tripped = false; tripT = 0; graceT = 0; justExhausted = false; justRecovered = false; justRested = false; justTripped = false; } // new life = fresh legs
  // kick: master's "get back to work!" — drops a voluntary rest latch so auto
  // legs flow again (under pushed cover if a push window is live). Never
  // touches true exhaustion — empty legs stay locked till they recover.
  function kick() { if (!exhausted) autoRest = false; }

  function init() {
    const wrap = document.getElementById('stamina-wrap');
    if (wrap) wrap.style.display = 'flex';
    update(0, false);
  }

  return { init, update, canMove, state, reset, kick, setMax, get exhausted() { return exhausted; }, get tripped() { return tripped; }, get justTripped() { return justTripped; }, get justExhausted() { return justExhausted; }, get justRecovered() { return justRecovered; }, get justRested() { return justRested; }, get value() { return v; } };
})();
