// Equipment — survivor.io paper doll (navy, never brown).
// Opening PAUSES the world (main.js freezes while isOpen): her idle sprite
// plays middle on a canvas, the IN HAND panel beside her names the equipped
// iron, her 3 trinket slots run under them, and two tabs (WEAPONS / TRINKETS)
// run along the bottom. Grids show OWNED pieces only — unowned never lists.
// Click a trinket icon and the empty slots jiggle: click one to wear it there.
window.Equipment = (() => {
  const $ = (id) => document.getElementById(id);
  let open = false;
  let animT = null;
  let tab = 'weapons'; // weapons | acc
  let pendingAcc = null; // trinket picked by icon, waiting on a jiggling slot

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>\\\"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\\\"': '&quot;' }[c]));
  }

  function statLine(w) {
    if (w.kind === 'melee') return `${w.dmg} damage · reach ~90px`;
    const per = w.pellets > 1 ? `${w.dmg} × ${w.pellets} pellets (spread)` : `${w.dmg} per bullet`;
    return `${per} · every ${w.cd}s · range ~${w.range}px`;
  }

  function rows() { // owned iron only — the deedless stay in the shop
    try {
      const rs = window.Weapons && typeof window.Weapons.info === 'function' ? window.Weapons.info() : [];
      return rs.filter((w) => !w.locked);
    } catch (e) { return []; }
  }
  function accs() { // owned trinkets only — unbought never lists
    try {
      const as = window.Accessories && typeof window.Accessories.list === 'function' ? window.Accessories.list() : [];
      return as.filter((a) => a.owned);
    } catch (e) { return []; }
  }
  function worn() {
    try { return window.Accessories && typeof window.Accessories.worn === 'function' ? window.Accessories.worn() : [null, null, null]; } catch (e) { return [null, null, null]; }
  }

  function render() {
    const grid = $('equip-grid'), hand = $('equip-hand'), slotsEl = $('equip-slots'), tabsEl = $('equip-tabs');
    if (!grid || !hand) return;
    if (tabsEl) {
      tabsEl.innerHTML =
        `<button class="equip-tab${tab === 'weapons' ? ' sel' : ''}" data-tab="weapons">WEAPONS</button>` +
        `<button class="equip-tab${tab === 'acc' ? ' sel' : ''}" data-tab="acc">TRINKETS</button>`;
    }
    const rs = rows();
    if (!rs.length) {
      hand.innerHTML = '<div class="equip-hand-name">no iron…</div>';
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
    }
    if (tab === 'weapons') {
      grid.innerHTML = rs.length ? rs.map((w) => (
        `<div class="equip-cell${w.equipped ? ' sel' : ''}">` +
          `<img class="equip-cell-icon" data-equip="${esc(w.id)}" title="${esc(w.name)} — click to EQUIP" src="${esc(w.icon || 'assets/m1.png')}" alt="" onerror="this.style.display='none'" />` +
          `<span class="equip-tip"><span class="t-name">${esc(w.name)}</span><br>${esc(statLine(w))}<br>${esc(w.desc)}</span>` +
        `</div>`
      )).join('') : '<div class="equip-sub2">No iron yet… (weapons unreachable)</div>';
    } else {
      const list = accs();
      grid.innerHTML = list.length ? list.map((a) => (
        `<div class="equip-cell${a.equipped ? ' sel' : ''}">` +
          `<span class="equip-cell-icon" data-acc-icon="${esc(a.id)}" title="${esc(a.name)} — click, then a jiggling slot">${esc(a.emoji)}</span>` +
          `<span class="equip-tip"><span class="t-name">${esc(a.name)}</span><br>${esc(a.desc)}</span>` +
        `</div>`
      )).join('') : '<div class="equip-sub2">no trinkets yet — the 🏪 shop sells them</div>' +
        `<button class="equip-cell-btn" data-shop="1">🏪 SHOP</button>`;
    }
    // trinket slots: small squares, emoji only — pending icon jiggles the empties
    if (slotsEl) {
      const w = worn();
      const list = accs();
      slotsEl.innerHTML = '<span class="equip-slots-label">TRINKETS</span>' + w.map((id, i) => {
        const a = list.find((x) => x.id === id);
        if (!a) {
          const jig = pendingAcc ? ' jiggle' : '';
          return `<button class="equip-slot empty${jig}" data-unslot="${i}"${pendingAcc ? '' : ' disabled'}>+</button>`;
        }
        return `<button class="equip-slot" data-unslot="${i}" title="${esc(a.name)} — click to take off">${esc(a.emoji)}<span class="equip-tip"><span class="t-name">${esc(a.name)}</span><br>${esc(a.desc)}<br>click to take off</span></button>`;
      }).join('');
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

  function tick() { try { window.Sound && window.Sound.playSfx('combat', 'release_click.mp3', { rate: 1.1, volume: 0.22 }); } catch (e) {} } // natural metal click, never chipmunk
  function ownsAcc(id) { try { return window.Accessories && typeof window.Accessories.owns === 'function' ? window.Accessories.owns(id) : false; } catch (e) { return false; } }

  function setOpen(v) {
    open = !!v;
    if (open) { render(); startDoll(); } else { stopDoll(); pendingAcc = null; } // repaint on every open — upgrades never go stale
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
        if (d.shop && window.Shop && window.Shop.setOpen) { setOpen(false); window.Shop.setOpen(true); return; } // 🏪 nudge jumps to the till
        if (d.tab) { tab = d.tab; pendingAcc = null; tick(); render(); return; } // WEAPONS | TRINKETS
        if (d.equip && window.Weapons && window.Weapons.equip(d.equip)) { tick(); render(); return; } // swap + repaint tags
        if (d.acc && window.Accessories && window.Accessories.equip(d.acc) >= 0) { pendingAcc = null; tick(); render(); return; } // WEAR fills first empty
        if (d.accIcon && ownsAcc(d.accIcon)) { pendingAcc = d.accIcon; tick(); render(); return; } // icon arms the jiggle
        if (d.unslot !== undefined && d.unslot !== null && d.unslot !== '') {
          const i = Number(d.unslot);
          if (pendingAcc && window.Accessories && window.Accessories.equipTo(pendingAcc, i)) { pendingAcc = null; tick(); render(); return; } // into the jiggling slot
          if (window.Accessories && window.Accessories.unequip(i)) { tick(); render(); } // trinket off
        }
      } catch (_) { /* a bad click equips nothing */ }
    });
  }

  return { init, toggle, setOpen, render, isOpen: () => open };
})();
