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
  // range words for her head — direction + close/far, never pixels.
  // Bands match her trigger: hostile reach 650, calm reach 500.
  function rangeWord(d) {
    const x = Number(d) || 0;
    if (x < 300) return 'close up';
    if (x < 650) return 'nearby';
    return 'far off';
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

    // enemies — SEE = bigger than the screen now (1920x1080 day around the camera
    // center, ~80% at night), so she spots distant packs before they fill the
    // frame, corners included. REACH (who she fires at / approaches) stays
    // distance-based — that's the brain's job, not the eyes'.
    let enemies = { total: 0, hostile: 0, nearest: null, list: [] };
    try {
      let vc = null;
      try { vc = window.__maidCamera && window.__maidCamera.viewCenter ? window.__maidCamera.viewCenter() : null; } catch (e) {}
      if (window.Enemies && vc && typeof window.Enemies.senseView === 'function') {
        // NIGHT: vision is limited — she sees ~80% of her day eyes
        const night = !!(window.Settings && Number(window.Settings.settings.worldTime) === 1);
        const hw = night ? 768 : 960, hh = night ? 432 : 540;
        enemies = window.Enemies.senseView(p.x, p.y, vc.x, vc.y, hw, hh); // wide eyes (narrower in the dark)
      } else if (window.Enemies && typeof window.Enemies.sense === 'function') {
        enemies = window.Enemies.sense(p.x, p.y, 750); // no camera (tests) — full-circle fallback
      } else if (window.Enemies && typeof window.Enemies.hostileCount === 'function') {
        enemies.hostile = window.Enemies.hostileCount();
      }
    } catch (e) { /* deaf snapshot */ }

    // stamina — both minds read this every turn, so it names the CURRENT state,
    // not just the number: parked (autoRest), empty (exhausted), or getting low.
    let staminaTxt = 'stamina: n/a';
    try {
      if (window.Stamina) {
        const st = window.Stamina.state();
        staminaTxt = st.tripped
          ? `stamina ${st.v}/${st.max} — TRIPPED, face-down in the grass eating dirt, legs unlock in a beat`
          : st.exhausted
          ? `stamina ${st.v}/${st.max} — EXHAUSTED, legs locked, cannot move until she catches her breath (slow)`
          : st.autoRest
            ? `stamina ${st.v}/${st.max} — RESTING by her own choice (legs parked at a quarter, auto resumes shortly; only master's direct orders move her right now)`
            : `stamina ${st.v}/${st.max}${st.pct < 0.3 ? ' (running low — tired legs may trip if she keeps running)' : ''}`;
      }
    } catch (e) { /* deaf snapshot */ }

    // ---- human-readable block for the LLM ----
    const lines = [];
    const night = !!(window.Settings && Number(window.Settings.settings.worldTime) === 1);
    lines.push(`Time: ${night ? 'NIGHT — dark out, visibility is poorer, the field feels different' : 'daytime — clear light over the field'}.`);
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
        const rare = e.rarity && e.rarity !== 'common' ? `, ${String(e.rarity).toUpperCase()}` : '';
        const color = e.outline || { common: 'gray', uncommon: 'green', rare: 'blue', epic: 'purple', legendary: 'gold', hunter: 'red' }[e.rarity] || '';
        // her eyes, in words: state + range + direction (+ rare/color if shiny).
        // No pixels, no hp, no prices here — code aims by numbers, she thinks in words.
        lines.push(`  #${i + 1}: ${e.hostile ? 'HOSTILE, will bite' : 'calm, milling around'} — ${rangeWord(e.dist)} to the ${dirName(e.dx, e.dy)}${rare}${color ? ` (${color} outline)` : ''}.`);
      });
      if (enemies.total > shown.length) lines.push(`  (+${enemies.total - shown.length} more further out)`);
    }
    // price list so she actually KNOWS critter worth (chat + brain read this)
    try {
      if (window.Enemies && typeof window.Enemies.priceListText === 'function') lines.push(window.Enemies.priceListText());
    } catch (e) { /* she appraises from memory then */ }
    // bestiary so she KNOWS the world's monsters (lore questions get real answers)
    try {
      if (window.Enemies && typeof window.Enemies.bestiaryText === 'function') lines.push(window.Enemies.bestiaryText());
    } catch (e) { /* legends stay untold */ }
    // purse + loose coins — she collects by walking over them, and knows her total
    try {
      const st = window.Inventory && window.Inventory.state ? window.Inventory.state() : null;
      if (st) {
        let near = null;
        try { near = window.Inventory.dropsNear ? window.Inventory.dropsNear(p.x, p.y, 450) : null; } catch (e) {}
        lines.push(`Coins: ${st.coins} in her purse. ` +
          (near && near.n > 0 && near.nearest
            ? `${near.n} loose coin(s) nearby — nearest ~${Math.round(near.nearest.dist)}px ${dirName(near.nearest.dx, near.nearest.dy)}, walk over to scoop.`
            : (st.drops > 0 ? `${st.drops} loose coin(s) still on the ground further out.` : 'No loose coins lying around.')));
      }
      try { if (window.Store && typeof window.Store.describe === 'function') lines.push(window.Store.describe()); } catch (e2) {}
    } catch (e) { /* pockets uncounted */ }
    // standing posture (both minds track it — the brain enforces, chat reports)
    try {
      const ot = window.Brain && typeof window.Brain.getObjectiveText === 'function' ? window.Brain.getObjectiveText() : '';
      if (ot) lines.push('Objective: ' + ot);
    } catch (e) { /* no orders standing */ }
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
