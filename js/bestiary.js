// Bestiary journal — the 📖 button toggles the field guide panel.
// Entries come from window.Enemies.bestiary() (single source of truth),
// rendered fresh on every open so retunes never go stale.
window.Bestiary = (() => {
  const $ = (id) => document.getElementById(id);
  let open = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function render() {
    const box = $('book-list');
    if (!box) return;
    let entries = [];
    try { entries = (window.Enemies && typeof window.Enemies.bestiary === 'function') ? window.Enemies.bestiary() : []; } catch (e) { entries = []; }
    if (!entries.length) { box.innerHTML = '<div class="beast"><div class="beast-lore">The pages are blank… (bestiary unreachable)</div></div>'; return; }
    box.innerHTML = entries.map((b) => (
      '<div class="beast">' +
        `<img class="beast-icon" src="${esc(b.icon)}" alt="" onerror="this.style.display='none'" style="border-color:${esc(b.color)}" />` +
        '<div class="beast-body">' +
          `<div class="beast-name" style="color:${esc(b.color)}">${esc(b.name)} <span class="beast-kind">${esc(b.kind)} · ${esc(b.hp)}hp · ${esc(b.bounty)}c</span></div>` +
          `<div class="beast-lore">${esc(b.lore)}</div>` +
          `<div class="beast-habit">${esc(b.habit)}</div>` +
        '</div>' +
      '</div>'
    )).join('');
  }

  function setOpen(v) {
    open = !!v;
    if (open) render();
    const p = $('book-panel');
    if (p) p.style.display = open ? 'block' : 'none';
  }

  function init() {
    const btn = $('book-btn');
    if (btn) btn.addEventListener('click', (e) => { try { e.stopPropagation(); } catch (_) {} setOpen(!open); });
  }

  return { init, setOpen, render };
})();
