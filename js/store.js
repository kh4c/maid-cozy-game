// Store — the 🛒 button (bottom-right, where the bag was) opens the shop.
// Coins are persistent (Inventory purse, cosette.coins) and so are upgrades
// (cosette.store levels), re-applied on every boot via init().
// STOCK tunables at the top: price, cap, blurb. Maid knowledge comes from
// describe(), quoted into the snapshot (situation.js) + think (brain.js).
window.Store = (() => {
  const $ = (id) => document.getElementById(id);
  const STORE_KEY = 'cosette.store';
  let open = false;
  let levels = { stamina: 0, damage: 0, magnet: 0, speed: 0 };

  function loadLevels() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) levels = Object.assign(levels, JSON.parse(raw));
    } catch (e) {}
    for (const k of Object.keys(levels)) levels[k] = Math.max(0, Math.round(Number(levels[k]) || 0));
  }
  function saveLevels() { try { localStorage.setItem(STORE_KEY, JSON.stringify(levels)); } catch (e) {} }

  // effect of one more level, applied cumulatively (idempotent — safe to re-run on boot)
  function applyAll() {
    try { window.Stamina && window.Stamina.setMax && window.Stamina.setMax(100 + 25 * levels.stamina); } catch (e) {}
    try {
      if (window.Weapons && window.Weapons.setActiveDamage) window.Weapons.setActiveDamage(window.Weapons.baseDamage() + levels.damage);
      else if (window.Gun && window.Gun.setDamage) window.Gun.setDamage(4 + levels.damage);
    } catch (e) {}
    try { window.Inventory && window.Inventory.setMagnetBonus && window.Inventory.setMagnetBonus(40 * levels.magnet); } catch (e) {}
  }
  function speedMult() { return 1 + 0.08 * levels.speed; } // read live by main.js movement

  const STOCK = [
    { id: 'heal', icon: '🩹', name: 'Full heal', price: 30, cap: 99,
      blurb: () => 'Back to full hearts, instantly.',
      can: () => ({ ok: true }),
      effect: () => { try { window.Health && window.Health.heal(window.Health.max); } catch (e) {} } },
    { id: 'stamina', icon: '🫀', name: 'Bigger tank', price: 60, cap: 4,
      blurb: () => `+25 max stamina (now ${100 + 25 * levels.stamina} → ${100 + 25 * (levels.stamina + 1)}).`,
      can: () => (levels.stamina >= 4 ? { ok: false, why: 'maxed' } : { ok: true }),
      effect: () => { levels.stamina++; applyAll(); } },
    { id: 'damage', icon: '🔫', name: 'Stronger bullets', price: 120, cap: 3,
      blurb: () => { let now = 4 + levels.damage; try { now = window.Weapons ? window.Weapons.damage() : (window.Gun && window.Gun.bulletDamage ? window.Gun.bulletDamage() : now); } catch (e) {} return `+1 bullet damage (now ${now} → ${now + 1}).`; },
      can: () => (levels.damage >= 3 ? { ok: false, why: 'maxed' } : { ok: true }),
      effect: () => { levels.damage++; applyAll(); } },
    { id: 'magnet', icon: '🧲', name: 'Wider magnet', price: 40, cap: 4,
      blurb: () => `+40px coin pull (now ~${110 + 40 * levels.magnet}px).`,
      can: () => (levels.magnet >= 4 ? { ok: false, why: 'maxed' } : { ok: true }),
      effect: () => { levels.magnet++; applyAll(); } },
    { id: 'speed', icon: '👟', name: 'Faster legs', price: 80, cap: 5,
      blurb: () => `+8% move speed (now ×${speedMult().toFixed(2)}).`,
      can: () => (levels.speed >= 5 ? { ok: false, why: 'maxed' } : { ok: true }),
      effect: () => { levels.speed++; } },
  ];

  function items() { // shop-grid descriptors: live blurbs + owned pips, no backend coupling
    return STOCK.map((s) => { const c = s.can(); return { id: s.id, icon: s.icon, name: s.name, price: s.price, cap: s.cap, desc: s.blurb(), owned: s.id === 'heal' ? 0 : (levels[s.id] || 0), soldOut: !c.ok, why: c.why || '' }; });
  }

  function purse() { try { return window.Inventory && window.Inventory.purse ? window.Inventory.purse() : 0; } catch (e) { return 0; } }

  function buy(id) {
    const item = STOCK.find((s) => s.id === id);
    if (!item) return { ok: false, why: 'no such ware' };
    const c = item.can();
    if (!c.ok) return { ok: false, why: c.why || 'maxed' };
    if (!window.Inventory || typeof window.Inventory.spend !== 'function') return { ok: false, why: 'no purse' };
    if (!window.Inventory.spend(item.price)) return { ok: false, why: 'too poor' };
    item.effect();
    saveLevels();
    render();
    try { window.Sound && window.Sound.playSfx('combat', 'coin.ogg', { rate: 1.4, volume: 0.5 }); } catch (e) {}
    return { ok: true };
  }

  function ownedRefund() {
    return STOCK.reduce((t, s) => (s.id === 'heal' ? t : t + s.price * (levels[s.id] || 0)), 0);
  }

  function resetUpgrades() { // ↺ button: full refund, muscles back to base, persistent save cleared
    const refund = ownedRefund();
    if (refund <= 0) return { ok: false, why: 'nothing to reset' };
    levels = { stamina: 0, damage: 0, magnet: 0, speed: 0 };
    saveLevels();
    try { window.Inventory && window.Inventory.refund && window.Inventory.refund(refund); } catch (e) {}
    applyAll(); // base stats back: tank 100, damage base, magnet base
    render();
    return { ok: true, refund };
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function render() {
    const box = $('store-list');
    const coins = purse();
    const line = $('store-coins-line');
    if (line) line.textContent = `purse: ${coins}c — yours forever, death can't take it`;
    if (!box) return;
    box.innerHTML = STOCK.map((s) => {
      const c = s.can();
      const maxed = !c.ok;
      const poor = coins < s.price;
      const dis = (maxed || poor) ? ' disabled' : '';
      const tag = maxed ? 'MAX' : `${s.price}c`;
      const owned = (s.id !== 'heal') ? `<span class="store-owned">${'●'.repeat(levels[s.id])}${'○'.repeat(s.cap - levels[s.id])}</span>` : '';
      return '<div class="store-row">' +
        `<span class="store-icon">${s.icon}</span>` +
        '<span class="store-body">' +
          `<span class="store-name">${esc(s.name)} ${owned}</span>` +
          `<span class="store-blurb">${esc(s.blurb())}</span>` +
        '</span>' +
        `<button class="store-buy${dis}" data-buy="${s.id}"${dis ? ' disabled' : ''}>${tag}</button>` +
      '</div>';
    }).join('');
    const back = ownedRefund();
    if (back > 0) box.innerHTML += `<div class="store-row store-reset"><span class="store-blurb">changed your mind? full refund, muscles back to base</span><button class="store-buy" data-reset="1">↺ reset +${back}c</button></div>`;
  }

  function setOpen(v) {
    open = !!v;
    if (open) render();
    const p = $('store-panel');
    if (p) p.style.display = open ? 'block' : 'none';
  }
  function isOpen() { return open; }

  function describe() {
    const bits = STOCK.map((s) => `${s.icon} ${s.name} ${s.price}c`);
    return `Store (🛒 button): spends her persistent purse on ${bits.join(' · ')}. Owned upgrades: tank+${levels.stamina * 25} stamina, +${levels.damage} damage, +${levels.magnet * 40}px magnet, ×${speedMult().toFixed(2)} speed.`;
  }

  function init() {
    loadLevels();
    applyAll(); // bought muscles survive reloads
    // NOTE: the 🛒 button belongs to the fullscreen Shop now (js/shop.js) —
    // upgrades are bought there; this backend keeps levels + purse logic only.
  }

  return { init, setOpen, isOpen, render, buy, items, resetUpgrades, describe, speedMult, levels: () => Object.assign({}, levels) };
})();
