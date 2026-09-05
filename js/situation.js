// Situation snapshot — auto awareness for the maid (chat + brain).
// Single source of truth: her position, health, weapon state, nearby enemies.
// Classic script. Bind once from main.js: Situation.bind(character).
window.Situation = (() => {
  let charRef = null;
  function bind(character) { charRef = character; }

  function pos() {
    if (!charRef || !charRef.view) return { x: 0, y: 0 };
    return { x: Math.round(charRef.view.x), y: Math.round(charRef.view.y) };
  }

  // cardinal name for a screen-space delta (y down = south)
  function dirName(dx, dy) {
    const a = Math.atan2(dy, dx) * 180 / Math.PI; // -180..180, 0=east
    if (a >= -22.5 && a < 22.5) return 'east';
    if (a >= 22.5 && a < 67.5) return 'south-east';
    if (a >= 67.5 && a < 112.5) return 'south';
    if (a >= 112.5 && a < 157.5) return 'south-west';
    if (a >= 157.5 || a < -157.5) return 'west';
    if (a >= -157.5 && a < -112.5) return 'north-west';
    if (a >= -112.5 && a < -67.5) return 'north';
    return 'north-east';
  }

  function snapshot() {
    const p = pos();
    const H = window.Health;
    const hp = H ? H.hp : '?';
    const max = H ? H.max : 9;
    const dead = !!(H && H.dead);

    // weapon
    let weaponTxt = 'M1 Garand — not loaded';
    let weapon = { has: false, mode: '?', firing: false, bullets: 0 };
    try {
      if (window.Gun && typeof window.Gun.status === 'function') {
        const st = window.Gun.status();
        weapon = { has: true, mode: st.mode, firing: !!st.firing, bullets: st.bullets | 0 };
        weaponTxt = `M1 Garand — aim ${st.mode === 'ai' ? 'AI (maid aims herself, your mouse is OFF)' : 'MOUSE (you aim, she cannot aim)'}, ` +
          (st.firing ? 'FIRING now' : 'not firing') + `, ${st.bullets | 0} bullet(s) in flight`;
      } else if (window.Gun) {
        weapon = { has: true, mode: 'mouse', firing: false, bullets: 0 };
        weaponTxt = 'M1 Garand — aim MOUSE (legacy gun.js, update for AI mode)';
      }
    } catch (e) { /* deaf snapshot */ }

    // enemies
    let enemies = { total: 0, hostile: 0, nearest: null, list: [] };
    try {
      if (window.Enemies && typeof window.Enemies.sense === 'function') {
        enemies = window.Enemies.sense(p.x, p.y);
      } else if (window.Enemies && typeof window.Enemies.hostileCount === 'function') {
        enemies.hostile = window.Enemies.hostileCount();
      }
    } catch (e) { /* deaf snapshot */ }

    // stamina
    let staminaTxt = 'stamina: n/a';
    try {
      if (window.Stamina) {
        const st = window.Stamina.state();
        staminaTxt = st.exhausted
          ? `stamina ${st.v}/${st.max} — EXHAUSTED, cannot move until she catches her breath`
          : `stamina ${st.v}/${st.max}${st.pct < 0.3 ? ' (running low — she will need to rest soon)' : ''}`;
      }
    } catch (e) { /* deaf snapshot */ }

    // ---- human-readable block for the LLM ----
    const lines = [];
    lines.push(`Position: world (${p.x}, ${p.y}) — infinite grassland, no walls or cover.`);
    lines.push(`Health: ${hp}/${max}${dead ? ' — FAINTED (no actions possible until respawn)' : ''}.`);
    lines.push(staminaTxt);
    lines.push(`Weapon: ${weaponTxt}.`);
    if (!enemies || enemies.total === 0) {
      lines.push('Enemies: none nearby — field is calm.');
    } else {
      lines.push(`Enemies: ${enemies.total} critter(s), ${enemies.hostile} hostile.`);
      const shown = (enemies.list || []).slice(0, 4);
      shown.forEach((e, i) => {
        lines.push(`  #${i + 1}: ${Math.round(e.dist)}px ${dirName(e.dx, e.dy)} (dx ${Math.round(e.dx)}, dy ${Math.round(e.dy)}) — ${e.hostile ? 'HOSTILE, will bite' : 'calm, milling around'}${e.hp !== undefined ? `, ${e.hp}hp` : ''}.`);
      });
      if (enemies.total > shown.length) lines.push(`  (+${enemies.total - shown.length} more further out)`);
    }
    return { px: p.x, py: p.y, hp, max, dead, weapon, enemies, text: lines.join('\n') };
  }

  // one-line HUD readout
  function hudLine() {
    try {
      const s = snapshot();
      const n = s.enemies && s.enemies.nearest;
      const foe = !n ? 'calm' : `${Math.round(n.dist)}px ${dirName(n.dx, n.dy)}${n.hostile ? ' HOSTILE' : ''}`;
      return `(${s.px},${s.py}) · ${s.weapon.mode === 'ai' ? 'AI aim' : 'mouse aim'} · ${s.enemies.total} foe / ${s.enemies.hostile} hot · nearest ${foe}`;
    } catch (e) { return ''; }
  }

  return { bind, snapshot, hudLine, dirName };
})();
