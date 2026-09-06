// Accessories — trinkets with live effects, sold in the 🏪 shop, worn in the
// 🎒 equipment panel (3 slots). Boots +12% speed (read live by main.js),
// Locket +2 max hearts while worn (Health.setBonusMax via apply()), Charm
// +25% coins on every drop (read live by Inventory.drop). Ownership persists
// in cosette.shop.acc, the worn loadout in cosette.gear — both survive reboot.
window.Accessories = (() => {
  const OWN_KEY = 'cosette.shop.acc';
  const GEAR_KEY = 'cosette.gear';
  const TABLE = [
    { id: 'boots', emoji: '👟', tag: 'SPD', name: 'Swift Boots', price: 100,
      desc: '+12% move speed, always on. Lace them and go.' },
    { id: 'locket', emoji: '💖', tag: 'HP', name: 'Heart Locket', price: 140,
      desc: '+2 max hearts while worn. She hates taking it off.' },
    { id: 'charm', emoji: '🪙', tag: '+25%', name: 'Greedy Charm', price: 160,
      desc: '+25% coins from every kill. Money is money.' },
  ];
  let owned = { boots: false, locket: false, charm: false };
  let slots = [null, null, null]; // 3 worn slots, accessory ids or null

  function load() {
    try { const raw = localStorage.getItem(OWN_KEY); if (raw) owned = Object.assign(owned, JSON.parse(raw)); } catch (e) {}
    for (const k of Object.keys(owned)) owned[k] = !!owned[k];
    try {
      const raw = localStorage.getItem(GEAR_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (Array.isArray(s)) slots = [s[0] || null, s[1] || null, s[2] || null];
      }
    } catch (e) {}
    slots = slots.map((id) => (id && owned[id] ? id : null)); // deeds lost, loadout lost
  }
  function save() {
    try { localStorage.setItem(OWN_KEY, JSON.stringify(owned)); } catch (e) {}
    try { localStorage.setItem(GEAR_KEY, JSON.stringify(slots)); } catch (e) {}
  }

  function known(id) { return TABLE.some((t) => t.id === id); }
  function owns(id) { return !!owned[id]; }
  function list() {
    return TABLE.map((t) => ({ id: t.id, emoji: t.emoji, tag: t.tag, name: t.name, price: t.price,
      desc: t.desc + (slots.includes(t.id) ? ' (wearing it)' : ''),
      owned: !!owned[t.id], equipped: slots.includes(t.id) }));
  }
  function worn() { return slots.slice(); }

  function buy(id) {
    const t = TABLE.find((x) => x.id === id);
    if (!t) return { ok: false, why: 'no such trinket' };
    if (owned[id]) return { ok: false, why: 'owned', name: t.name };
    if (!window.Inventory || typeof window.Inventory.spend !== 'function') return { ok: false, why: 'no purse' };
    if (!window.Inventory.spend(t.price)) return { ok: false, why: 'too poor' };
    owned[id] = true; save();
    try { window.Sound && window.Sound.playSfx('combat', 'coin.ogg', { rate: 1.4, volume: 0.5 }); } catch (e) {}
    return { ok: true, name: t.name };
  }

  function equip(id) { // returns the slot index, or -1 when full / unowned
    if (!owned[id] || !known(id)) return -1;
    if (slots.includes(id)) return slots.indexOf(id);
    const i = slots.indexOf(null);
    if (i < 0) return -1;
    return equipTo(id, i) ? i : -1;
  }
  function equipTo(id, i) { // wear into one exact slot (icon click → jiggling slot)
    if (!owned[id] || !known(id) || i < 0 || i > 2) return false;
    const cur = slots.indexOf(id);
    if (cur >= 0 && cur !== i) slots[cur] = null;
    slots[i] = id; save(); apply();
    return true;
  }
  function unequip(i) {
    if (i < 0 || i > 2 || !slots[i]) return false;
    slots[i] = null; save(); apply();
    return true;
  }

  function speedMult() { return slots.includes('boots') ? 1.12 : 1; }
  function coinMult() { return slots.includes('charm') ? 1.25 : 1; }
  function apply() { // Locket lives here — hearts resize the frame she fights in
    try {
      if (window.Health && typeof window.Health.setBonusMax === 'function') {
        window.Health.setBonusMax(slots.includes('locket') ? 2 : 0);
      }
    } catch (e) {}
  }

  function describe() {
    const have = TABLE.filter((t) => owned[t.id]).map((t) => t.name);
    const wear = slots.filter(Boolean).map((id) => (TABLE.find((t) => t.id === id) || {}).name || id);
    return `Accessories (🏪 shop, worn 3 slots in 🎒 Equipment): Swift Boots 100c (+12% speed), Heart Locket 140c (+2 max hearts while worn), Greedy Charm 160c (+25% coins). Owned: ${have.length ? have.join(', ') : 'none'}. Wearing: ${wear.length ? wear.join(', ') : 'nothing'}.`;
  }

  function init() { load(); apply(); } // apply after boot — Health exists by main init

  return { init, known, owns, list, worn, buy, equip, equipTo, unequip, speedMult, coinMult, apply, describe };
})();
