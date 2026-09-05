// Maid health — 9 hearts. At 0 she faints: player control locks, the
// dialog box + chat hide, and she respawns at full hearts after a beat.
// Nothing damages her yet except the P-panel Hurt button (and the console:
// Health.damage(1)) — future hazards/enemies call the same API.
window.Health = (() => {
  const MAX = 9;
  const RESPAWN_MS = 5000;
  let hp = MAX;
  let dead = false;

  // Combat feel, all cosmetic: random hurt thump at a random pitch, a camera
  // kick the main loop picks up, and a heavy body-thud on the final blow.
  const HURT_FILES = ['hurt_0.ogg', 'hurt_1.ogg', 'hurt_2.ogg', 'hurt_3.ogg', 'hurt_4.ogg'];
  let pendingShake = 0; // main loop drains this into Camera.shake()
  function sfx(file, rate) {
    try {
      const S = window.Sound;
      if (S && typeof S.playSfx === 'function') S.playSfx('combat', file, { rate });
    } catch (e) { /* deaf game is still a game — never break hp */ }
  }
  function shakeAmount() { const s = pendingShake; pendingShake = 0; return s; }

  function heartImg(on) {
    return '<img src="assets/' + (on ? 'heart_full.png?v=2' : 'heart_empty.png?v=2') + '" draggable="false">';
  }

  function render() {
    const el = document.getElementById('hearts');
    if (!el) return;
    let s = '';
    for (let i = 0; i < MAX; i++) s += heartImg(i < hp);
    el.innerHTML = s;
    el.title = hp + '/' + MAX;
  }

  function flash() {
    const el = document.getElementById('hurt-flash');
    if (!el) return;
    el.style.transition = 'none';
    el.style.opacity = '0.45';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.style.transition = 'opacity 0.6s';
      el.style.opacity = '0';
    }));
  }

  function setTalkUI(visible) {
    const d = document.getElementById('dialog-box');
    const c = document.getElementById('chat-row');
    const t = document.getElementById('thought-box');
    const cb = document.getElementById('combat-bar');
    if (d) d.style.display = visible ? '' : 'none';
    if (c) c.style.display = visible ? '' : 'none';
    if (t) t.style.display = visible ? '' : 'none';
    if (cb) cb.style.display = visible ? '' : 'none';
    if (!visible) {
      const inp = document.getElementById('chat-input');
      if (inp) { inp.value = ''; inp.blur(); }
    }
  }

  function die() {
    if (dead) return;
    dead = true;
    hp = 0;
    pendingShake = 1; // full camera rattle on the killing blow
    sfx('die.ogg', 0.85 + Math.random() * 0.15);
    render();
    setTalkUI(false); // dialog + chat gone while she's out
    const veil = document.getElementById('faint-veil');
    if (veil) veil.style.display = 'flex';
    setTimeout(respawn, RESPAWN_MS);
  }

  function respawn() {
    if (!dead) return;
    dead = false;
    hp = MAX;
    render();
    const veil = document.getElementById('faint-veil');
    if (veil) veil.style.display = 'none';
    setTalkUI(true);
  }

  function damage(n) {
    if (dead) return hp;
    hp = Math.max(0, hp - (Math.abs(Math.round(Number(n))) || 1));
    flash();
    pendingShake = Math.max(pendingShake, 0.45); // a proper jolt, not a quake
    sfx(HURT_FILES[(Math.random() * HURT_FILES.length) | 0], 0.9 + Math.random() * 0.25);
    render();
    if (hp <= 0) die();
    return hp;
  }

  function heal(n) {
    if (dead) return hp; // she has to sleep it off — respawn handles it
    hp = Math.min(MAX, hp + (Math.abs(Math.round(Number(n))) || 1));
    render();
    return hp;
  }

  function init() { render(); }

  return { init, damage, heal, shakeAmount, get hp() { return hp; }, get dead() { return dead; }, get max() { return MAX } };
})();
