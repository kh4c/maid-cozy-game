// Weapon system — registry of everything she can fight with (guns AND melee).
// The rifle is entry #1: slow, heavy, loud. Future guns/melee = one row here
// + art, no gun.js surgery — gun.js reads the active row live every shot.
// Melee shape (documented, proven by hweapons): { kind:'melee', reach, arc } —
// on trigger the gun calls damageAt() in an arc in front instead of spawning
// a slug. Active id persists (cosette.weapon). Store damage upgrades ride
// setActiveDamage on top of the row's base.
// Staged for the next rows (all real, all in assets/sfx): shotgun_real.wav,
// pistol_real.wav, chaingun_real.wav (OGA, CC-BY 3.0 Michel Baradari — credited
// in README); pump_shotgun.mp3, reload_spin.mp3, clip_click.mp3, release_click.mp3,
// gameshot_alt.mp3 (Mixkit license, free). Next gun = one TABLE row + art.
window.Weapons = (() => {
  const KEY = 'cosette.weapon';
  const TABLE = {
    rifle: { name: 'M1 Rifle', kind: 'gun', desc: 'Slow trigger, fast needle — one loud word at a time.',
      icon: 'assets/m1.png', tex: 'm1',
      cd: 0.85, dmg: 4, base: 4, speed: 1800, life: 0.47, slug: 0.18, recoil: 1.5,
      pellets: 1, spread: 0, pingEvery: 8,
      sfx: 'rifle_real.wav', rate: 1.0, ping: 'release_click.mp3' },
    shotgun: { name: 'Pump Shotgun', kind: 'gun', desc: 'Close thunder — a fan of pellets, short reach, huge manners.',
      icon: 'assets/shotgun.png', tex: 'shotgun',
      cd: 1.5, dmg: 2, base: 2, speed: 1500, life: 0.26, slug: 0.2, recoil: 2.4,
      pellets: 6, spread: 0.26, pingEvery: 6,
      sfx: 'shotgun_real.wav', rate: 0.6, ping: 'pump_shotgun.mp3' },
  };
  let active = 'rifle';

  function locked(id) { // shotgun is shop stock — no deed, no equip
    try { if (id === 'shotgun' && window.Shop && typeof window.Shop.ownsShotgun === 'function') return !window.Shop.ownsShotgun(); } catch (e) {}
    return false;
  }

  function load() { try { const id = localStorage.getItem(KEY); if (id && TABLE[id]) active = id; } catch (e) {} }
  function save() { try { localStorage.setItem(KEY, active); } catch (e) {} }
  function row() { const r = TABLE[active] || TABLE.rifle; return locked(active) ? TABLE.rifle : r; } // stale shotgun saves fall back to the M1

  function register(def) { // runtime/add-on weapons (harness + future packs)
    if (!def || !def.id || TABLE[def.id]) return false;
    TABLE[def.id] = Object.assign({ kind: 'gun', name: def.id, desc: '', cd: 0.8, dmg: 1, base: 1, pellets: 1, spread: 0, pingEvery: 8, tex: 'm1' }, def);
    return true;
  };
  function info() { // every row with live numbers — feeds the equipment panel
    return Object.keys(TABLE).map((id) => {
      const r = TABLE[id] || {};
      const pellets = Math.max(1, Math.round(Number(r.pellets) || 1));
      return { id, name: r.name || id, kind: r.kind || 'gun', desc: r.desc || '', icon: r.icon || 'assets/m1.png',
        equipped: id === active, locked: locked(id), dmg: Math.max(1, Math.round(Number(r.dmg) || 1)), cd: Number(r.cd) || 0.8,
        pellets, spread: Number(r.spread) || 0, range: Math.round((Number(r.speed) || 1400) * (Number(r.life) || 0.6)) };
    });
  }
  function equip(id) { if (!TABLE[id] || locked(id)) return false; active = id; save(); return true; }
  function activeId() { return active; }
  function list() { return Object.keys(TABLE).map((id) => ({ id, name: TABLE[id].name, kind: TABLE[id].kind, desc: TABLE[id].desc, equipped: id === active })); }

  // live getters — gun.js polls these every shot, so swaps need no gun surgery
  function kind() { return row().kind; }
  function cooldown() { return row().cd; }
  function damage() { return Math.max(1, Math.round(Number(row().dmg) || 1)); }
  function baseDamage() { return Math.max(1, Math.round(Number(row().base) || Number(row().dmg) || 1)); }
  function setActiveDamage(d) { row().dmg = Math.max(1, Math.round(Number(d) || 1)); }
  function projSpeed() { return row().speed || 1400; }
  function projLife() { return row().life || 0.6; }
  function rangePx() { return Math.round(projSpeed() * projLife()); }
  function slugScale() { return row().slug || 0.3; }
  function recoilMul() { return row().recoil || 1; }
  function shotSfx() { return row().sfx || 'gunshot.wav'; }
  function shotRate() { return row().rate == null ? 0.55 : row().rate; }
  function ping() { return row().ping || null; } // M1 clip-ping every 8th round (gun.js)
  function pingEvery() { return Math.max(1, Math.round(Number(row().pingEvery) || 8)); } // rounds between reload sounds
  function pellets() { return Math.max(1, Math.round(Number(row().pellets) || 1)); } // slugs per trigger pull
  function spread() { return Number(row().spread) || 0; } // pellet fan, radians across
  function gunTex() { return row().tex || 'm1'; } // which gun sprite the rig shows
  function activeName() { return row().name || active; }
  function meleeReach() { return row().reach || 90; }
  function meleeArc() { return row().arc || 70; }
  function describe() {
    const r = row();
    const extra = r.kind === 'melee' ? `reach ~${meleeReach()}px` : `range ~${rangePx()}px, ${damage()} damage${pellets() > 1 ? ` × ${pellets()} pellets (spread)` : ' per bullet'}, slug speed ${projSpeed()}px/s`;
    return `Weapon: ${r.name} (${r.kind}) — ${r.desc} one shot every ${cooldown()}s, ${extra}.`;
  }

  function init() { load(); }

  return { init, register, equip, activeId, activeName, list, info, kind, cooldown, damage, baseDamage, setActiveDamage,
    projSpeed, projLife, rangePx, slugScale, recoilMul, shotSfx, shotRate, ping, pingEvery, pellets, spread, gunTex, meleeReach, meleeArc, describe };
})();
