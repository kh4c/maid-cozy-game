// Equipment — survivor.io paper doll (navy, never brown).
// Opening PAUSES the world (main.js freezes while isOpen): her idle sprite
// plays middle on a canvas, the IN HAND panel beside her names the equipped
// iron, her 3 trinket slots run under them, and the weapon + accessory grids
// run along the bottom. I key / 🔫 / ✕ / backdrop all close.
window.Equipment = (() => {
  const $ = (id) => document.getElementById(id);
  let open = false;
  let animT = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>\\\"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\\\"': '&quot;' }[c]));
  }

  function statLine(w) {
    if (w.kind === 'melee') return `${w.dmg} damage · reach ~90px`;
    const per = w.pellets > 1 ? `${w.dmg} × ${w.pellets} pellets (spread)` : `${w.dmg} per bullet`;
    return `${per} · every ${w.cd}s · range ~${w.range}px`;
  }

  function rows() {
    try { return window.Weapons && typeof window.Weapons.info === 'function' ? window.Weapons.info() : []; } catch (e) { return []; }
  }
  function accs() {
    try { return window.Accessories && typeof window.Accessories.list === 'function' ? window.Accessories.list() : []; } catch (e) { return []; }
  }

  function cellBtn(w) {
    if (w.equipped) return `<button class="equip-cell-btn equipped" disabled>EQUIPPED</button>`;
    if (w.locked) return `<button class="equip-cell-btn" data-shop="1" title="sold in the 🏪 shop">🔒 SHOP</button>`;
    return `<button class="equip-cell-btn" data-equip="${esc(w.id)}">EQUIP</button>`;
  }
  function accBtn(a) {
    if (a.equipped) return `<button class="equip-cell-btn equipped" disabled>WORN</button>`;
    if (!a.owned) return `<button class="equip-cell-btn" data-shop="1" title="sold in the 🏪 shop">🔒 SHOP</button>`;
    return `<button class="equip-cell-btn" data-acc="${esc(a.id)}">WEAR</button>`;
  }

  function render() {
    const grid = $('equip-grid'), hand = $('equip-hand'), slotsEl = $('equip-slots');
    if (!grid || !hand) return;
    const rs = rows();
    if (!rs.length) {
      hand.innerHTML = '<div class="equip-hand-name">no iron…</div>';
      grid.innerHTML = '<div class="equip-sub2">No iron yet… (weapons unreachable)</div>';
    } else {
      const eq = rs.find((w) => w.equipped) || rs[0];
      hand.innerHTML =
        `<img class="equip-hand-icon" src="${esc(eq.icon || 'assets/m1.png')}" alt="" onerror="this.style.display='none'" />` +
        '<div class="equip-hand-body">' +
          `<div class="equip-inhand">✦ IN HAND</div>` +
          `<div class="equip-hand-name">${esc(eq.name)}</div>` +
          `<div class="equip-hand-stats">${esc(statLine(eq))}</div>` +
          `<div class="equip-hand-desc">${esc(eq.desc)}</div>` +
        '</div>';
      grid.innerHTML = rs.map((w) => (
        `<div class="equip-cell${w.equipped ? ' sel' : ''}">` +
          `<img class="equip-cell-icon" src="${esc(w.icon || 'assets/m1.png')}" alt="" onerror="this.style.display='none'" />` +
          `<span class="equip-cell-name">${esc(w.name)}</span>` +
          `<span class="equip-cell-stats">${esc(statLine(w))}</span>` +
          cellBtn(w) +
        `</div>`
      )).join('');
    }
    // trinket slots: click a worn one to take it off, WEAR below fills empties
    if (slotsEl) {
      let worn = [null, null, null];
      try { worn = window.Accessories && typeof window.Accessories.worn === 'function' ? window.Accessories.worn() : worn; } catch (e) {}
      const list = accs();
      slotsEl.innerHTML = '<span class="equip-slots-label">TRINKETS</span>' + worn.map((id, i) => {
        const a = list.find((x) => x.id === id);
        if (!a) return `<button class="equip-slot empty" disabled>empty</button>`;
        return `<button class="equip-slot" data-unslot="${i}" title="click to take off">${esc(a.emoji)} ${esc(a.name)}</button>`;
      }).join('') +
      (list.length ? '<div class="equip-sub2">accessories — WEAR fills an empty slot</div><div class="equip-acc-grid">' +
        list.map((a) => (
          `<div class="equip-cell${a.equipped ? ' sel' : ''}">` +
            `<span class="equip-cell-icon">${esc(a.emoji)}</span>` +
            `<span class="equip-cell-name">${esc(a.name)}</span>` +
            `<span class="equip-cell-stats">${a.price}c · ${esc(a.desc)}</span>` +
            accBtn(a) +
          `</div>`
        )).join('') + '</div>' : '');
    }
  }

  // idle doll: the 9 pixel-verified frames from CONFIG, ~6fps, 2x on canvas
  function startDoll() {
    stopDoll();
    const cv = $('equip-sprite');
    if (!cv || typeof cv.getContext !== 'function') return;
    let frames = [[0,0],[0,1],[0,2],[0,3],[1,0],[1,1],[1,2],[1,3],[2,0]];
    try {
      const s = window.CONFIG && window.CONFIG.sheets && window.CONFIG.sheets.idle;
      if (s && Array.isArray(s.frames) && s.frames.length) frames = s.frames;
    } catch (e) {}
    const img = new Image();
    img.src = 'assets/SG_Maid_Idle.png';
    let f = 0;
    animT = setInterval(() => {
      try {
        const ctx = cv.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, cv.width, cv.height);
        if (img.complete && img.naturalWidth) {
          const fr = frames[f % frames.length];
          ctx.drawImage(img, fr[1] * 64, fr[0] * 64, 64, 64, 0, 0, cv.width, cv.height);
        }
        f++;
      } catch (_) { /* a dropped frame animates nothing */ }
    }, 1000 / 6);
  }
  function stopDoll() { try { clearInterval(animT); } catch (e) {} animT = null; }

  function tick() { try { window.Sound && window.Sound.playSfx('combat', 'release_click.mp3', { rate: 1.8, volume: 0.12 }); } catch (e) {} }

  function setOpen(v) {
    open = !!v;
    if (open) { render(); startDoll(); } else stopDoll(); // repaint on every open — upgrades never go stale
    const p = $('equip-panel');
    if (p) p.style.display = open ? 'flex' : 'none';
  }
  function toggle() { setOpen(!open); }

  function init() {
    const btn = $('equip-btn');
    if (btn) btn.addEventListener('click', (e) => { try { e.stopPropagation(); } catch (_) {} toggle(); });
    const p = $('equip-panel');
    if (p) p.addEventListener('click', (e) => {
      try {
        const t = e.target || {};
        if (t.id === 'equip-panel' || t.id === 'equip-close') { setOpen(false); return; } // backdrop + ✕ close
        const d = t.dataset || {};
        if (d.shop && window.Shop && window.Shop.setOpen) { setOpen(false); window.Shop.setOpen(true); return; } // 🔒 SHOP jumps to the till
        if (d.equip && window.Weapons && window.Weapons.equip(d.equip)) { tick(); render(); return; } // swap + repaint tags
        if (d.acc && window.Accessories && window.Accessories.equip(d.acc) >= 0) { tick(); render(); return; } // trinket on
        if (d.unslot !== undefined && window.Accessories && window.Accessories.unequip(Number(d.unslot))) { tick(); render(); } // trinket off
      } catch (_) { /* a bad click equips nothing */ }
    });
  }

  return { init, toggle, setOpen, render, isOpen: () => open };
})();
