// Combat mode — HER feet in a fight, owned per-tick in code (never the LLM).
// While any hostile is near (or a boss lane is live) this overrides every
// other AI order — strolls, shadows, keep-distance — until the battle ends.
// The player still outranks it: a live click pin always wins (Input.axis).
// Doctrine: kite at gun range, strafe what she can't outrange, and NEVER
// stand in red paint — the boss lane out-prioritizes everything.
window.Combat = (() => {
  let active = false, moving = false;
  let orbitDir = 1, orbitT = 0; // strafe side, re-rolled every couple seconds

  function gunRange() {
    try { if (window.Gun && window.Gun.rangePx) return window.Gun.rangePx() || 500; } catch (e) {}
    return 500;
  }
  function foesNear(mx, my) {
    try {
      if (!window.Enemies || !window.Enemies.sense) return [];
      const s = window.Enemies.sense(mx, my, 650);
      return (s && s.list ? s.list : []).filter((e) => e.hostile);
    } catch (e) { return []; }
  }

  // lane dodge: closest point on the painted lane, then straight away from
  // it with margin. Behind the boss (t<0) the closest point IS the boss —
  // so this also clears the body. Returns true when a dodge vector was set.
  function laneDodge(mx, my, tele, out) {
    const rx = mx - tele.x, ry = my - tele.y;
    const t = rx * tele.dx + ry * tele.dy;
    const c = Math.max(0, Math.min(tele.len, t));
    const cx = tele.x + tele.dx * c, cy = tele.y + tele.dy * c;
    let ex = mx - cx, ey = my - cy;
    let d = Math.hypot(ex, ey);
    if (d < 1) { ex = -tele.dy; ey = tele.dx; d = 1; } // dead-center in the paint: pick a side
    if (d >= tele.half + 60) return false; // already clear — hold ground, keep shooting
    out.x = ex / d; out.y = ey / d;
    return true;
  }

  function update(wdt, mx, my) {
    active = false; moving = false;
    if ((window.Health && window.Health.dead) || (window.EditMode && window.EditMode.active)) { stop(); return; }
    try { if (window.Gun && window.Gun.getAimMode && window.Gun.getAimMode() !== 'ai') { stop(); return; } } catch (e) { stop(); return; }

    const out = { x: 0, y: 0 };
    let tele = null;
    try { tele = window.Enemies && window.Enemies.combatTelegraph ? window.Enemies.combatTelegraph() : null; } catch (e) {}
    if (tele) {
      active = true; // red paint live = combat, even mid-dash
      laneDodge(mx, my, tele, out);
    } else {
      const foes = foesNear(mx, my);
      if (foes.length) {
        active = true;
        const range = gunRange();
        const fleeR = Math.max(220, Math.min(420, range * 0.45)); // inside this: back off
        const holdR = range * 0.85;                               // past this: close in
        let n = foes[0];
        for (const f of foes) if (f.dist < n.dist) n = f; // nearest anchors the strafe
        const nd = n.dist || 1;
        const ax = (mx - n.x) / nd, ay = (my - n.y) / nd; // away from the nearest
        if (n.dist < fleeR) { out.x += ax; out.y += ay; }
        else if (n.dist > holdR) { out.x -= ax; out.y -= ay; }
        else { // in the pocket: orbit-strafe so bites and lanes keep missing
          orbitT -= wdt;
          if (orbitT <= 0) { orbitT = 2 + Math.random() * 1.5; if (Math.random() < 0.35) orbitDir *= -1; }
          out.x += -ay * orbitDir; out.y += ax * orbitDir;
        }
        for (const f of foes) { // separation: don't let the pack collapse on her
          if (f === n) continue;
          const d = f.dist || 1;
          if (d < 300) { const w = (300 - d) / 300; out.x += ((mx - f.x) / d) * w; out.y += ((my - f.y) / d) * w; }
        }
      }
    }
    const len = Math.hypot(out.x, out.y);
    if (active && len > 0.01) {
      moving = true; // she shoots on the move — the gun doesn't care
      try { window.Input && window.Input.setCombat && window.Input.setCombat(out.x / len, out.y / len); } catch (e) {}
      // weak-prey escape (mirrors the old flee reflex): hp 4 or less, or legs
      // under 30% — combat legs bill as PUSHED so she can run past quarter.
      try {
        let hp = 99; try { hp = window.Health && window.Health.hp != null ? window.Health.hp : 99; } catch (e2) {}
        let tired = false; try { const st = window.Stamina && window.Stamina.state ? window.Stamina.state() : null; tired = !!(st && st.pct < 0.3); } catch (e2) {}
        if ((hp <= 4 || tired) && window.Input && window.Input.pushFor) window.Input.pushFor(0.6);
      } catch (e) {}
    } else stop();
  }

  function stop() { try { window.Input && window.Input.clearCombat && window.Input.clearCombat(); } catch (e) {} }

  return { update, active: () => active, dodging: () => active && moving };
})();
