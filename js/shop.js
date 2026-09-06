// Shop — the 🏪 fullscreen store (Shop.png covers the screen).
// Grid cells on the left (hover or click a cell to inspect it), detail pane on
// the right with description, price, and the BUY button; every cell also has
// its own small buy button below it. Stock: the pump shotgun (persistent
// unlock deed — Equipment shows 🔒 until bought) + 3 equipable accessories
// (same purse, deeds persist, worn in the 3 🎒 slots) + the Hover Drone pet
// (250c deed, auto-worn in the 🎒 pet square).
window.Shop = (() => {
  const $ = (id) => document.getElementById(id);
  const KEY = 'cosette.shop';
  const GUN_PRICE = 150;
  let open = false;
  let owned = { shotgun: false };
  let sel = 'shotgun';

  function load() {
    try { const raw = localStorage.getItem(KEY); if (raw) owned = Object.assign(owned, JSON.parse(raw)); } catch (e) {}
    owned.shotgun = !!owned.shotgun;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(owned)); } catch (e) {} }
  function ownsShotgun() { return !!owned.shotgun; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>\"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' }[c]));
  }
  function purse() { try { return window.Inventory && window.Inventory.purse ? window.Inventory.purse() : 0; } catch (e) { return 0; } }

  let toastT = null;
  function sndTick() { try { window.Sound && window.Sound.playSfx('combat', 'coin.ogg', { rate: 1.7, volume: 0.07 }); } catch (e) {} } // soft coin blip on hover, not a gun click
  function toast(msg) { // buy feedback line under the till head, pops + fades
    const t = $('shop-toast'); if (!t) return;
    t.textContent = msg;
    try { t.classList.remove('show'); void t.offsetWidth; t.classList.add('show'); } catch (e) {}
    try { clearTimeout(toastT); } catch (e) {}
    toastT = setTimeout(() => { try { t.classList.remove('show'); } catch (e) {} }, 2600);
  }
  function flashPanel() { // gold burst round the wooden frame on every sale
    const p = $('shop-panel'); if (!p) return;
    try { p.classList.remove('sold-flash'); void p.offsetWidth; p.classList.add('sold-flash'); } catch (e) {}
  }

  function gunDesc() {
    let stats = '2 × 6 pellets (spread) · every 1.5s · range ~390px';
    try {
      const rows = window.Weapons && typeof window.Weapons.info === 'function' ? window.Weapons.info() : [];
      const g = rows.find((r) => r.id === 'shotgun');
      if (g) stats = `${g.dmg} × ${g.pellets} pellets (spread) · every ${g.cd}s · range ~${g.range}px`;
    } catch (e) {}
    return `Close thunder for quarry work. ${stats}. One deed, yours forever — EQUIP it in 🔫 Equipment.`;
  }

  function stock() { // grid order: the iron first, then the trinkets, then the drone
    const cells = [{
      id: 'shotgun', img: 'assets/shotgun.png', emoji: '🔫', name: 'Pump Shotgun',
      price: GUN_PRICE, desc: gunDesc(), owned: ownsShotgun(), soldOut: ownsShotgun(), why: ownsShotgun() ? 'owned' : '',
    }];
    try {
      if (window.Accessories && typeof window.Accessories.list === 'function') {
        for (const a of window.Accessories.list()) {
          cells.push({ id: a.id, img: null, emoji: a.emoji, name: a.name, price: a.price,
            desc: a.desc, owned: a.owned, soldOut: a.owned, why: a.owned ? 'owned' : '' });
        }
      }
    } catch (e) {}
    try { // the pet: deeds persist, worn in the 🎒 pet slot
      if (window.Pet && typeof window.Pet.owns === 'function') {
        const owned = window.Pet.owns();
        cells.push({ id: 'drone', img: 'assets/drone1.png', emoji: '🛸', name: 'Hover Drone',
          price: window.Pet.price(), desc: window.Pet.describe(), owned, soldOut: owned, why: owned ? 'owned' : '' });
      }
    } catch (e) {}
    try { // the lodestone: second deed, second 🎒 square — fetches coins, slows the field
      if (window.Lode && typeof window.Lode.owns === 'function') {
        const owned = window.Lode.owns();
        cells.push({ id: 'lode', img: 'assets/drone2.png', emoji: '🧲', name: 'Lodestone Drone',
          price: window.Lode.price(), desc: window.Lode.describe(), owned, soldOut: owned, why: owned ? 'owned' : '' });
      }
    } catch (e) {}
    return cells;
  }

  function buy(id) {
    if (id === 'shotgun') {
      if (ownsShotgun()) { toast('Already yours — see 🔫 Equipment.'); return { ok: false, why: 'owned' }; }
      if (!window.Inventory || typeof window.Inventory.spend !== 'function') return { ok: false, why: 'no purse' };
      if (!window.Inventory.spend(GUN_PRICE)) { toast('Not enough coins!'); return { ok: false, why: 'too poor' }; }
      owned.shotgun = true; save(); render();
      try { window.Sound && window.Sound.playSfx('combat', 'coin.ogg', { rate: 1.2, volume: 0.5 }); } catch (e) {}
      try { window.Sound && window.Sound.playSfx('combat', 'pump_shotgun.mp3', { rate: 1.0, volume: 0.6 }); } catch (e) {} // rack it — the iron is yours
      toast('🔫 Pump Shotgun — YOURS! EQUIP it in 🔫 Equipment.');
      flashPanel();
      return { ok: true };
    }
    try {
      if (window.Accessories && typeof window.Accessories.known === 'function' && window.Accessories.known(id)) {
        const r = window.Accessories.buy(id);
        if (r && r.ok) { toast(`✨ ${r.name} — YOURS! Wear it in 🎒 Equipment.`); flashPanel(); }
        else toast(r && r.why === 'owned' ? 'Already yours — see 🎒 Equipment.' : 'Not enough coins!');
        render(); return r;
      }
      if (window.Pet && typeof window.Pet.known === 'function' && window.Pet.known(id)) {
        const r = window.Pet.buy();
        if (r && r.ok) { toast(`🛸 ${r.name} — YOURS! Wear it in the 🎒 pet slot.`); flashPanel(); }
        else toast(r && r.why === 'owned' ? 'Already yours — see the 🎒 pet slot.' : 'Not enough coins!');
        render(); return r;
      }
      if (window.Lode && typeof window.Lode.known === 'function' && window.Lode.known(id)) {
        const r = window.Lode.buy();
        if (r && r.ok) { toast(`🧲 ${r.name} — YOURS! Wear it in the 🎒 pet slot.`); flashPanel(); }
        else toast(r && r.why === 'owned' ? 'Already yours — see the 🎒 pet slot.' : 'Not enough coins!');
        render(); return r;
      }
    } catch (e) {}
    return { ok: false, why: 'no stock' };
  }

  function cellHtml(c, coins) {
    const icon = c.img
      ? `<img class="shop-cell-icon" src="${esc(c.img)}" alt="" onerror="this.style.display='none'" />`
      : `<span class="shop-cell-icon">${esc(c.emoji || '?')}</span>`;
    const state = c.soldOut ? (c.owned || c.why === 'owned' ? 'OWNED' : 'MAX') : `${c.price}c`;
    const poor = !c.soldOut && coins < c.price;
    return `<div class="shop-cell${sel === c.id ? ' sel' : ''}" data-cell="${esc(c.id)}">` +
      `${icon}<span class="shop-cell-name">${esc(c.name)}</span>` +
      `<button class="shop-cell-buy${(c.soldOut || poor) ? ' disabled' : ''}" data-buy="${esc(c.id)}"${(c.soldOut || poor) ? ' disabled' : ''}>${state}</button>` +
    `</div>`;
  }

  function render() {
    const grid = $('shop-grid'), detail = $('shop-detail'), coinsEl = $('shop-coins');
    if (!grid || !detail) return;
    const coins = purse();
    const cells = stock();
    if (!cells.some((c) => c.id === sel)) sel = cells[0].id;
    if (coinsEl) coinsEl.textContent = `purse: ${coins}c`;
    grid.innerHTML = cells.map((c) => cellHtml(c, coins)).join('');
    const c = cells.find((x) => x.id === sel) || cells[0];
    const bigIcon = c.img
      ? `<img class="shop-big-icon" src="${esc(c.img)}" alt="" onerror="this.style.display='none'" />`
      : `<span class="shop-big-icon">${esc(c.emoji || '?')}</span>`;
    const state = c.soldOut ? (c.owned || c.why === 'owned' ? `OWNED — see ${c.id === 'drone' ? '🎒 pet slot' : '🔫 Equipment'}` : `MAXED (${esc(c.why || 'maxed')})`) : `${c.price}c`;
    const poor = !c.soldOut && coins < c.price;
    detail.innerHTML =
      `${bigIcon}<div class="shop-detail-name">${esc(c.name)}</div>` +
      `<div class="shop-detail-desc">${esc(c.desc)}</div>` +
      `<div class="shop-detail-price">${state}${poor ? ' — too poor' : ''}</div>` +
      (c.soldOut ? '' : `<button class="shop-buy-big${poor ? ' disabled' : ''}" data-buy="${esc(c.id)}"${poor ? ' disabled' : ''}>BUY for ${c.price}c</button>`);
  }

  function setOpen(v) {
    open = !!v;
    if (open) render();
    const o = $('shop-overlay');
    if (o) o.style.display = open ? 'flex' : 'none';
  }
  function toggle() { setOpen(!open); }
  function isOpen() { return open; }

  function describe() {
    let gear = 'none';
    try { gear = window.Accessories && typeof window.Accessories.describe === 'function' ? window.Accessories.describe() : gear; } catch (e) {}
    return `Shop (🏪 button, Marta in town opens it): spends her persistent purse — pump shotgun ${GUN_PRICE}c (persistent unlock, EQUIP in 🎒 Equipment) + 3 equipable accessories (worn in the 3 🎒 slots). Shotgun owned: ${ownsShotgun() ? 'yes' : 'not yet'}. ${gear}`;
  }

  function init() {
    load();
    const btn = $('store-btn'); // 🛒 opens the till now (old list panel retired)
    if (btn) {
      btn.title = 'Shop — the shotgun deed and equipable trinkets';
      btn.addEventListener('click', (e) => { try { e.stopPropagation(); } catch (_) {} toggle(); });
    }
    const o = $('shop-overlay');
    if (o) {
      o.addEventListener('click', (e) => {
        try {
          const t = e.target;
          if (t.id === 'shop-overlay' || t.id === 'shop-close') { setOpen(false); return; }
          const buyBtn = t.closest ? t.closest('[data-buy]') : null;
          if (buyBtn && !buyBtn.disabled) { buy(buyBtn.getAttribute('data-buy')); return; }
          const cell = t.closest ? t.closest('[data-cell]') : null;
          if (cell) { sel = cell.getAttribute('data-cell'); render(); sndTick(); }
        } catch (_) {}
      });
      o.addEventListener('mouseover', (e) => { // hover inspects (with a tick), same as click
        try {
          const cell = e.target && e.target.closest ? e.target.closest('[data-cell]') : null;
          if (cell && cell.getAttribute('data-cell') !== sel) { sel = cell.getAttribute('data-cell'); render(); sndTick(); }
        } catch (_) {}
      });
    }
  }

  return { init, toggle, setOpen, isOpen, render, buy, ownsShotgun, stock, describe,
    gunPrice: () => GUN_PRICE, selected: () => sel };
})();
