// Patience — her fuse while awaiting master's word.
// She asks (calm critters: "want them dead?") and the meter drains in
// silence; talk to her or click the field and it refills. Hit zero and SHE
// decides — code, not the LLM: calm critters walk free, announced with
// tsundere smugness. Tunables below; dev panel patienceSecs overrides.
window.Patience = (() => {
  const WAIT_SECS = 25; // silence tolerated while a question stands (dev: patienceSecs)
  const NAG_AT = 0.5;   // one foot-tap reminder at half fuse

  let waiting = null;   // { topic } while a question is open
  let v = 100;          // 0..100
  let nagged = false;

  function waitSecs() {
    try {
      const s = Number(window.Settings && window.Settings.settings.patienceSecs);
      if (isFinite(s) && s >= 5 && s <= 120) return s;
    } catch (e) {}
    return WAIT_SECS;
  }
  function ask(topic) { waiting = { topic: topic || 'orders' }; v = 100; nagged = false; paint(); }
  function hear() { if (waiting && v < 100) { v = 100; paint(); } } // master's voice/hand — fuse full again, question stands
  function resolve() { waiting = null; v = 100; nagged = false; paint(); } // answered or decided — fuse gone
  function update(dt) { if (!waiting) return; v = Math.max(0, v - (100 / waitSecs()) * Math.max(0, Number(dt) || 0)); paint(); }
  function needsNag() { return !!(waiting && !nagged && v <= 100 * NAG_AT); }
  function markNagged() { nagged = true; }
  function expired() { return !!(waiting && v <= 0); }
  function state() { return { waiting: !!waiting, topic: waiting ? waiting.topic : null, pct: Math.round(v) }; }
  function reset() { resolve(); } // new life: no grudges carried

  // Thin fuse bar inside the dialog — visible only while a question stands.
  function paint() {
    try {
      const w = document.getElementById('patience-wrap');
      if (!w) return;
      if (!waiting) { w.style.display = 'none'; return; }
      w.style.display = 'block';
      const f = document.getElementById('patience-fill');
      if (f) f.style.width = Math.max(0, Math.min(100, v)) + '%';
    } catch (e) {}
  }

  return { ask, hear, resolve, update, needsNag, markNagged, expired, state, reset };
})();
