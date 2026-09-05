// Settings persistence (localStorage) + dev panel UI (hotkey P).
window.Settings = (() => {
  const KEY = 'maid-test-settings';

  let settings;
  try {
    const saved = localStorage.getItem(KEY);
    settings = saved ? Object.assign({}, window.CONFIG.defaults, JSON.parse(saved)) : { ...window.CONFIG.defaults };
  } catch {
    settings = { ...window.CONFIG.defaults }; // corrupted save -> start clean
  }

  let flashTimer = null;
  function flashSaved() {
    const el = document.getElementById('saved-flash');
    el.textContent = '✓ saved';
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => (el.textContent = ''), 1200);
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
      flashSaved();
    } catch (err) {
      // surface via the global error hook in main.js
      window.dispatchEvent(new ErrorEvent('error', { message: 'save failed: ' + err.message }));
    }
  }

  // Debounced save for high-frequency edits (drag / wheel placement tool).
  let saveSoonTimer = null;
  function saveSoon() {
    clearTimeout(saveSoonTimer);
    saveSoonTimer = setTimeout(save, 400);
  }

  // Sync the dev-panel sliders/labels to the current settings object
  // (called when something else — e.g. the drag tool — changes a value).
  function refreshControls() {
    controls.forEach(({ key, slider, val }) => {
      slider.value = settings[key];
      val.textContent = settings[key];
    });
  }

  // ---- Dev panel -----------------------------------------------------------
  let panelVisible = false;
  const controls = []; // { key, slider, val }
  let onChange = null;  // called with (key) when a slider moves

  function togglePanel() {
    panelVisible = !panelVisible;
    const panel = document.getElementById('devpanel');
    // Must set an explicit value — '' would fall back to CSS display:none and stay hidden
    panel.style.display = panelVisible ? 'block' : 'none';
  }

  function addSlider(key, min, max, step) {
    const panel = document.getElementById('devpanel');
    const row = document.createElement('div');
    row.className = 'row';
    const label = document.createElement('label');
    label.textContent = key;
    const slider = document.createElement('input');
    Object.assign(slider, { type: 'range', min, max, step });
    slider.value = settings[key];
    const val = document.createElement('span');
    val.className = 'val';
    val.textContent = settings[key];
    slider.addEventListener('input', () => {
      settings[key] = Number(slider.value);
      val.textContent = slider.value;
      if (onChange) onChange(key);
    });
    row.append(label, slider, val);
    panel.appendChild(row);
    controls.push({ key, slider, val });
  }

  function buildPanel(onChangeFn) {
    onChange = onChangeFn;
    addSlider('speed', 20, 500, 10);
    addSlider('idleFps', 1, 30, 1);
    addSlider('runFps', 1, 30, 1);
    addSlider('scale', 1, 4, 0.5);
    addSlider('sunray', 0, 1, 0.05);
    addSlider('maxTilt', 0, 1.2, 0.05);
    addSlider('l2dOn', 0, 1, 1);
    addSlider('l2dZoom', 0.1, 2, 0.05);
    addSlider('l2dx', 0, 1, 0.02);
    addSlider('l2dy', -1, 0.5, 0.02);
    addSlider('l2dExpr', 0, 5, 1); // 0=auto, 1..5 pin: happy/soft_smile/surprised/pouty/sleepy

    const btnRow = document.createElement('div');
    btnRow.className = 'btns';
    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', save);
    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Reset';
    resetBtn.addEventListener('click', () => {
      settings = { ...window.CONFIG.defaults };
      applyAll();
      controls.forEach(({ key, slider, val }) => {
        slider.value = settings[key];
        val.textContent = settings[key];
      });
      save(); // reset persists immediately so it survives reload
    });
    btnRow.append(saveBtn, resetBtn);
    document.getElementById('devpanel').appendChild(btnRow);
  }

  return { settings, save, saveSoon, refreshControls, buildPanel, togglePanel };
})();
