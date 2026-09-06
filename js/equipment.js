// Equipment — survivor.io paper doll (navy, never brown).
// Opening PAUSES the world (main.js freezes while isOpen): her idle sprite
// stands middle, the IN HAND panel beside her names the equipped iron, and
// the weapon grid runs along the bottom. I key / 🔫 / ✕ / backdrop all close.
window.Equipment = (() => {
  const $ = (id) => document.getElementById(id);
  let open = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>\"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' }[c]));
  }

  function statLine(w) {
    if (w.kind === 'melee') return `${w.dmg} damage · reach ~90px`;
    const per = w.pellets > 1 ? `${w.dmg} × ${w.pellets} pellets (spread)` : `${w.dmg} per bullet`;
    return `${per} · every ${w.cd}s · range ~${w.range}px`;
  }

  function rows() {
    try { return window.Weapons && typeof window.Weapons.info === 'function' ? window.Weapons.info() : []; } catch (e) { return []; }
  }

  function cellBtn(w) {
    if (w.equipped) return `<button class="equip-cell-btn equipped" disabled>EQUIPPED</button>`;
    if (w.locked) return `<button class="equip-cell-btn" data-shop="1" title="sold in the 🏪 shop">🔒 SHOP</button>`;
    return `<button class="equip-cell-btn" data-equip="${esc(w.id)}">EQUIP</button>`;
  }

  function render() {
    const grid = $('equip-grid'), hand = $('equip-hand');
    if (!grid || !hand) return;
    const rs = rows();
    if (!rs.length) {
      hand.innerHTML = '<div class="equip-hand-name">no iron…</div>';
      grid.innerHTML = '<div class="equip-sub2">No iron yet… (weapons unreachable)</div>';
      return;
    }
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

  function setOpen(v) {
    open = !!v;
    if (open) render(); // repaint on every open — upgrades never go stale
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
        if (d.equip && window.Weapons && window.Weapons.equip(d.equip)) render(); // swap + repaint tags
      } catch (_) { /* a bad click equips nothing */ }
    });
  }

  return { init, toggle, setOpen, render, isOpen: () => open };
})();
