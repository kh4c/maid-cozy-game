// Shop — the 🏪 fullscreen store (Shop.png covers the screen).
// Grid cells on the left (hover or click a cell to inspect it), detail pane on
// the right with description, price, and the BUY button; every cell also has
// its own small buy button below it. Stock: the pump shotgun (persistent
// unlock deed — Equipment shows 🔒 until bought) + all Store upgrades
// (same backend, same purse, same levels).
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
  function sndTick() { try { window.Sound && window.Sound.playSfx('combat', 'release_click.mp3', { rate: 1.8, volume: 0.15 }); } catch (e) {} } // wooden counter tick
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

  function stock() { // grid order: the iron first, then the muscles
    const cells = [{
      id: 'shotgun', img: 'assets/shotgun.png', emoji: '🔫', name: 'Pump Shotgun',
      price: GUN_PRICE, desc: gunDesc(), owned: ownsShotgun(), soldOut: ownsShotgun(), why: ownsShotgun() ? 'owned' : '',
    }];
    try {
      if (window.Store && typeof window.Store.items === 'function') {
        for (const s of window.Store.items()) {
          cells.push({ id: s.id, img: null, emoji: s.icon, name: s.name, price: s.price,
            desc: s.desc + (s.cap > 1 ? ` (${s.owned}/${s.cap} owned)` : ''),
            owned: false, soldOut: s.soldOut, why: s.why });
        }
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
      if (window.Store && typeof window.Store.buy === 'function') {
        const r = window.Store.buy(id);
        if (r && r.ok) { const c = stock().find((x) => x.id === id); toast(`${c ? c.name : id} bought!`); flashPanel(); }
        else toast(r && r.why === 'maxed' ? 'Sold out!' : 'Not enough coins!');
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
    const state = c.soldOut ? (c.owned || c.why === 'owned' ? 'OWNED — see 🔫 Equipment' : `MAXED (${esc(c.why || 'maxed')})`) : `${c.price}c`;
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
    return `Shop (🏪 button, Marta in town opens it): spends her persistent purse — pump shotgun ${GUN_PRICE}c (persistent unlock, EQUIP in 🔫 Equipment), full heal 30c, tank/magnet/legs/damage upgrades. Shotgun owned: ${ownsShotgun() ? 'yes' : 'not yet'}.`;
  }

  function init() {
    load();
    const btn = $('store-btn'); // 🛒 opens the till now (old list panel retired)
    if (btn) {
      btn.title = 'Shop — spend coins on the shotgun and upgrades';
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
