// Equipment panel — the 🔫 button (or I key) opens her iron closet.
// Every weapon row renders with its sprite, numbers, and an EQUIP button;
// swapping calls Weapons.equip and the gun in her hands changes live.
// Rendered fresh on every open so store damage upgrades never go stale.
window.Equipment = (() => {
  const $ = (id) => document.getElementById(id);
  let open = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function statLine(w) {
    if (w.kind === 'melee') return `${w.dmg} damage · reach ~90px`;
    const per = w.pellets > 1 ? `${w.dmg} × ${w.pellets} pellets (spread)` : `${w.dmg} per bullet`;
    return `${per} · every ${w.cd}s · range ~${w.range}px`;
  }

  function render() {
    const box = $('equip-list');
    if (!box) return;
    let rows = [];
    try { rows = window.Weapons && typeof window.Weapons.info === 'function' ? window.Weapons.info() : []; } catch (e) { rows = []; }
    if (!rows.length) { box.innerHTML = '<div class="equip-blurb">No iron yet… (weapons unreachable)</div>'; return; }
    box.innerHTML = rows.map((w) => (
      '<div class="equip-row">' +
        `<img class="equip-icon" src="${esc(w.icon || 'assets/m1.png')}" alt="" onerror="this.style.display='none'" />` +
        '<div class="equip-body">' +
          `<div class="equip-name">${esc(w.name)}${w.equipped ? ' <span class="equip-owned">EQUIPPED</span>' : ''}</div>` +
          `<div class="equip-blurb">${esc(w.desc)}</div>` +
          `<div class="equip-stats">${esc(statLine(w))}</div>` +
        '</div>' +
        (w.equipped ? '' : `<button class="store-buy" data-equip="${esc(w.id)}">EQUIP</button>`) +
      '</div>'
    )).join('');
  }

  function setOpen(v) {
    open = !!v;
    if (open) render();
    const p = $('equip-panel');
    if (p) p.style.display = open ? 'block' : 'none';
  }
  function toggle() { setOpen(!open); }

  function init() {
    const btn = $('equip-btn');
    if (btn) btn.addEventListener('click', (e) => { try { e.stopPropagation(); } catch (_) {} toggle(); });
    const p = $('equip-panel');
    if (p) p.addEventListener('click', (e) => {
      try {
        const id = e.target && e.target.dataset && e.target.dataset.equip;
        if (id && window.Weapons && window.Weapons.equip(id)) render(); // swap + repaint tags
      } catch (_) { /* a bad click equips nothing */ }
    });
  }

  return { init, toggle, setOpen, render, isOpen: () => open };
})();
