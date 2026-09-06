// Day clock — Mon-Sat, 9:00AM to 9:00PM. HER week, owned in code (never the LLM).
// 1 real second = 1 game minute, so a full workday runs ~12 real minutes.
// From 5:00PM the light cycles day -> night; at 9:00PM the day rolls over
// (Sat night wraps to Mon morning — no Sunday, the town rests). While the
// clock runs it owns worldTime (dev WORLD slider follows); dragging time-of-day
// by hand naps the clock so the manual override always wins.
window.Clock = (() => {
  const DAY_START = 9;   // 9:00AM — boots into morning light
  const DAY_END = 21;    // 9:00PM — shutters down, next morning
  const NIGHT_AT = 17;   // 5:00PM — day cycles to night from here
  const MIN_PER_SEC = 1; // game pace: 1 real second = 1 game minute
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let di = 0, mins = DAY_START * 60;
  let lastNight = null, lastLabel = '';
  let onFlip = null; // main.js registers the night-visual refresh here

  function label() {
    const h24 = Math.floor(mins / 60) % 24, mm = Math.floor(mins % 60);
    const h12 = ((h24 + 11) % 12) + 1, ap = h24 < 12 ? 'AM' : 'PM';
    return `${DAYS[di]} ${h12}:${String(mm).padStart(2, '0')}${ap}`;
  }
  function paint() {
    const l = label();
    if (l === lastLabel) return;
    lastLabel = l;
    try { const el = document.getElementById('clock-line'); if (el) el.textContent = '🕰 ' + l; } catch (e) {}
  }
  function update(rdt) {
    try {
      if (!window.Settings || Number(window.Settings.settings.clockOn) !== 1) return;
      mins += Math.max(0, Number(rdt) || 0) * MIN_PER_SEC;
      if (mins >= DAY_END * 60) { mins = DAY_START * 60; di = (di + 1) % DAYS.length; } // tomorrow, same grind
      const night = mins >= NIGHT_AT * 60;
      if (night !== lastNight) {
        lastNight = night;
        try { window.Settings.settings.worldTime = night ? 1 : 0; } catch (e) {}
        try { window.Settings.refreshControls && window.Settings.refreshControls(); } catch (e) {} // dev slider follows the clock
        try { if (typeof onFlip === 'function') onFlip(); } catch (e) {} // overlay + ground + Live2D tint, same as a manual flip
      }
      paint();
    } catch (e) {}
  }
  function state() { return { day: DAYS[di], mins, night: mins >= NIGHT_AT * 60 }; }

  return { update, state, label, set onFlip(fn) { onFlip = fn; } };
})();
