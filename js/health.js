// Maid health — 9 hearts. At 0 she faints: player control locks, the
// dialog box + chat hide, and she respawns at full hearts after a beat.
// Nothing damages her yet except the P-panel Hurt button (and the console:
// Health.damage(1)) — future hazards/enemies call the same API.
window.Health = (() => {
  const MAX = 9;
  const RESPAWN_MS = 5000;
  let hp = MAX;
  let dead = false;

  function render() {
    const el = document.getElementById('hearts');
    if (!el) return;
    let s = '';
    for (let i = 0; i < MAX; i++) {
      s += i < hp ? '<span class="px-heart hp-on"></span>' : '<span class="px-heart hp-off"></span>';
    }
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
    if (d) d.style.display = visible ? '' : 'none';
    if (c) c.style.display = visible ? '' : 'none';
    if (!visible) {
      const inp = document.getElementById('chat-input');
      if (inp) { inp.value = ''; inp.blur(); }
    }
  }

  function die() {
    if (dead) return;
    dead = true;
    hp = 0;
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

  return { init, damage, heal, get hp() { return hp; }, get dead() { return dead; }, get max() { return MAX } };
})();
