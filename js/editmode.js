// Edit Mode — move/resize the screen-space UI: gear button, HUD, dev panel,
// and the Live2D maid. Toggle with E (or Esc to exit). While active:
//   drag a component = move it · wheel over it = resize it · R = reset layout
// The maid keeps its always-on drag/wheel behavior (js/live2d.js); edit mode
// just adds its outline so all editable things are visible in one glance.
//
// Layout persists as JSON in localStorage ('maid-ui-layout'), one entry per
// component: { anchor: 'tl'|'tr', x, y = px from that corner, s = scale }.
// Corner anchors mean window resizes behave like the original fixed margins.
window.EditMode = (() => {
  const KEY = 'maid-ui-layout';
  const DEFAULTS = {
    gear: { anchor: 'tr', x: 12, y: 12, s: 1 },   // audio gear button
    hud:  { anchor: 'tl', x: 10, y: 10, s: 1 },   // top-left status line
    dev:  { anchor: 'tr', x: 12, y: 12, s: 1 },   // dev panel (P)
  };
  const CLAMPS = { gear: [0.5, 3], hud: [0.5, 3], dev: [0.5, 2.5] };
  const LABELS = { gear: 'GEAR', hud: 'HUD', dev: 'DEV PANEL', maid: 'MAID — drag / wheel' };

  let layout = load();
  let active = false;
  let comps = [];        // { id, el, box, tag }
  let maidBox = null, maidTag = null, maidRectFn = null;
  let legend = null, flashEl = null, flashTimer = null, rafId = 0;
  let saveTimer = null;
  let drag = null;       // { id, dx, dy, w, h, st }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return structuredClone(DEFAULTS);
      const p = JSON.parse(raw);
      // merge so newly added components get their defaults
      for (const k of Object.keys(DEFAULTS)) p[k] = { ...DEFAULTS[k], ...(p[k] || {}) };
      return p;
    } catch { return structuredClone(DEFAULTS); }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(layout)); } catch {}
    flashSaved();
  }
  function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 400); }
  function flashSaved() {
    if (!flashEl) return;
    flashEl.textContent = '✓ saved';
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => (flashEl.textContent = ''), 1200);
  }

  const stageEl = () => document.getElementById('stage-wrap');

  // Write one component's layout entry into its DOM style.
  function applyComp(id) {
    const c = layout[id];
    const comp = comps.find((k) => k.id === id);
    if (!c || !comp) return;
    const el = comp.el;
    if (c.anchor === 'tr') { el.style.left = 'auto'; el.style.right = c.x + 'px'; }
    else                   { el.style.right = 'auto'; el.style.left = c.x + 'px'; }
    el.style.top = c.y + 'px';
    el.style.transformOrigin = c.anchor === 'tr' ? 'top right' : 'top left';
    el.style.transform = `scale(${c.s})`;
    // the audio panel hangs below the gear, mirroring its x
    if (id === 'gear') {
      const ap = document.getElementById('audio-panel');
      if (ap) { ap.style.top = (c.y + 38 * c.s + 8) + 'px'; ap.style.right = c.x + 'px'; }
    }
  }

  function wireDrag(comp) {
    const el = comp.el;
    el.addEventListener('pointerdown', (e) => {
      if (!active) return;
      e.preventDefault();
      e.stopPropagation(); // don't leak to canvas / audio gesture handling
      const st = stageEl().getBoundingClientRect();
      const r = el.getBoundingClientRect();
      drag = { id: comp.id, dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height, st };
      el.setPointerCapture && el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!active || !drag || drag.id !== comp.id) return;
      const { st, dx, dy, w, h } = drag;
      const left = e.clientX - dx - st.left;
      const top = e.clientY - dy - st.top;
      const c = layout[comp.id];
      // keep a fifth of the element on screen so it can't be lost off-edge
      c.y = Math.round(Math.max(0, Math.min(st.height - h * 0.2, top)));
      if (c.anchor === 'tr') c.x = Math.round(Math.max(0, Math.min(st.width - w * 0.2, st.width - left - w)));
      else                   c.x = Math.round(Math.max(0, Math.min(st.width - w * 0.2, left)));
      applyComp(comp.id);
      saveSoon();
    });
    const end = () => { if (drag && drag.id === comp.id) { drag = null; save(); } };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (e) => {
      if (!active) return;
      e.preventDefault();
      e.stopPropagation();
      const [min, max] = CLAMPS[comp.id];
      const c = layout[comp.id];
      c.s = Math.min(max, Math.max(min, c.s * (e.deltaY < 0 ? 1.05 : 1 / 1.05)));
      c.s = Math.round(c.s * 100) / 100;
      applyComp(comp.id);
      saveSoon();
    }, { passive: false });
  }

  // Overlay boxes/labels follow the live element rects while editing.
  function place(box, tag, r, st, id) {
    box.style.left = (r.left - st.left) + 'px';
    box.style.top = (r.top - st.top) + 'px';
    box.style.width = r.width + 'px';
    box.style.height = r.height + 'px';
    tag.style.left = (r.left - st.left) + 'px';
    tag.style.top = Math.max(0, r.top - st.top - 16) + 'px';
    tag.textContent = LABELS[id] || id.toUpperCase();
  }
  function startLoop() {
    (function frame() {
      if (!active) return;
      const st = stageEl().getBoundingClientRect();
      for (const comp of comps) place(comp.box, comp.tag, comp.el.getBoundingClientRect(), st, comp.id);
      if (maidRectFn) {
        const r = maidRectFn();
        if (r) place(maidBox, maidTag, r, st, 'maid');
      }
      rafId = requestAnimationFrame(frame);
    })();
  }

  function buildLegend() {
    legend = document.createElement('div');
    legend.className = 'edit-legend';
    legend.innerHTML = '✏ EDIT MODE — drag = move · wheel = size · E/Esc = done · R = reset UI · ';
    flashEl = document.createElement('span');
    flashEl.id = 'edit-flash';
    legend.appendChild(flashEl);
    legend.style.display = 'none';
    stageEl().appendChild(legend);
  }

  function toggle() {
    if (!legend) return; // init() not run yet (e.g. key pressed during page load)
    active = !active;
    stageEl().classList.toggle('editing', active);
    for (const comp of comps) {
      comp.el.style.pointerEvents = active ? 'auto' : (comp.id === 'hud' ? 'none' : '');
      comp.el.style.cursor = active ? 'move' : '';
      comp.box.style.display = comp.tag.style.display = active ? 'block' : 'none';
    }
    if (maidBox) maidBox.style.display = maidTag.style.display = active ? 'block' : 'none';
    legend.style.display = active ? 'block' : 'none';
    if (active) {
      // avoid overlap confusion while placing things
      const ap = document.getElementById('audio-panel');
      if (ap) ap.style.display = 'none';
      startLoop();
    } else {
      cancelAnimationFrame(rafId);
      save(); // flush any pending edit on exit
    }
  }

  function resetLayout() {
    layout = structuredClone(DEFAULTS);
    for (const comp of comps) applyComp(comp.id);
    save();
  }

  function init(opts = {}) {
    maidRectFn = opts.maidRect || null;
    const defs = [
      ['gear', document.getElementById('gear-btn')],
      ['hud', document.getElementById('hud')],
      ['dev', document.getElementById('devpanel')],
    ];
    for (const [id, el] of defs) {
      if (!el) continue;
      const box = document.createElement('div');
      box.className = 'edit-box';
      const tag = document.createElement('div');
      tag.className = 'edit-tag';
      box.style.display = tag.style.display = 'none';
      stageEl().append(box, tag);
      const comp = { id, el, box, tag };
      comps.push(comp);
      applyComp(id);   // apply saved layout immediately (also outside edit mode)
      wireDrag(comp);
    }
    if (maidRectFn) {
      maidBox = document.createElement('div');
      maidBox.className = 'edit-box';
      maidTag = document.createElement('div');
      maidTag.className = 'edit-tag';
      maidBox.style.display = maidTag.style.display = 'none';
      stageEl().append(maidBox, maidTag);
    }
    buildLegend();
  }

  return { init, toggle, resetLayout, get active() { return active; }, get ready() { return !!legend; } };
})();
