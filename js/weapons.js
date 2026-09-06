// Weapon system — registry of everything she can fight with (guns AND melee).
// The rifle is entry #1: slow, heavy, loud. Future guns/melee = one row here
// + art, no gun.js surgery — gun.js reads the active row live every shot.
// Melee shape (documented, proven by hweapons): { kind:'melee', reach, arc } —
// on trigger the gun calls damageAt() in an arc in front instead of spawning
// a slug. Active id persists (cosette.weapon). Store damage upgrades ride
// setActiveDamage on top of the row's base.
window.Weapons = (() => {
  const KEY = 'cosette.weapon';
  const TABLE = {
    rifle: { name: 'M1 Rifle', kind: 'gun', desc: 'Slow trigger, fast needle — one loud word at a time.',
      cd: 0.85, dmg: 4, base: 4, speed: 1400, life: 0.6, slug: 0.3, recoil: 1.5,
      sfx: 'gunshot.wav', rate: 0.55 },
  };
  let active = 'rifle';

  function load() { try { const id = localStorage.getItem(KEY); if (id && TABLE[id]) active = id; } catch (e) {} }
  function save() { try { localStorage.setItem(KEY, active); } catch (e) {} }
  function row() { return TABLE[active] || TABLE.rifle; }

  function register(def) { // runtime/add-on weapons (harness + future packs)
    if (!def || !def.id || TABLE[def.id]) return false;
    TABLE[def.id] = Object.assign({ kind: 'gun', name: def.id, desc: '', cd: 0.8, dmg: 1, base: 1 }, def);
    return true;
  }
  function equip(id) { if (!TABLE[id]) return false; active = id; save(); return true; }
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
  function meleeReach() { return row().reach || 90; }
  function meleeArc() { return row().arc || 70; }
  function describe() {
    const r = row();
    const extra = r.kind === 'melee' ? `reach ~${meleeReach()}px` : `range ~${rangePx()}px, slug speed ${projSpeed()}px/s`;
    return `Weapon: ${r.name} (${r.kind}) — ${r.desc} ${damage()} damage, one shot every ${cooldown()}s, ${extra}.`;
  }

  function init() { load(); }

  return { init, register, equip, activeId, list, kind, cooldown, damage, baseDamage, setActiveDamage,
    projSpeed, projLife, rangePx, slugScale, recoilMul, shotSfx, shotRate, meleeReach, meleeArc, describe };
})();
