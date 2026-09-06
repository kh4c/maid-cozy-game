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
    controls.forEach(({ key, slider, val, fmt }) => {
      slider.value = settings[key];
      val.textContent = fmt ? fmt(settings[key]) : settings[key];
    });
  }

  // ---- Dev panel -----------------------------------------------------------
  // Two tabs: MAIN (gameplay/Live2D sliders) and CHAT (LLM character + params).
  let tabMain = null, tabChat = null, tabWorld = null;
  const textControls = []; // { key, el } — text inputs/textareas (autosave debounced)

  // Single-line text input or multi-line textarea bound to a settings key.
  // Saves debounced while typing so a long system prompt never gets lost.
  function addText(key, label, multiline, parent) {
    const box = parent || tabChat || document.getElementById('devpanel');
    const row = document.createElement('div');
    row.className = 'trow';
    const lab = document.createElement('label');
    lab.textContent = label;
    const el = document.createElement(multiline ? 'textarea' : 'input');
    if (!multiline) el.type = 'text';
    el.value = settings[key] ?? '';
    el.spellcheck = false;
    el.addEventListener('input', () => {
      settings[key] = el.value;
      saveSoon();
    });
    row.append(lab, el);
    box.appendChild(row);
    textControls.push({ key, el });
  }

  function selectTab(which) {
    if (!tabMain || !tabChat || !tabWorld) return;
    tabMain.style.display = which === 'main' ? 'block' : 'none';
    tabChat.style.display = which === 'chat' ? 'block' : 'none';
    tabWorld.style.display = which === 'world' ? 'block' : 'none';
    const btns = document.querySelectorAll('#devpanel .tabs button');
    btns.forEach((b) => b.classList.toggle('active', b.dataset.tab === which));
  }
  let panelVisible = false;
  const controls = []; // { key, slider, val }
  let onChange = null;  // called with (key) when a slider moves

  function togglePanel() {
    panelVisible = !panelVisible;
    const panel = document.getElementById('devpanel');
    // Must set an explicit value — '' would fall back to CSS display:none and stay hidden
    panel.style.display = panelVisible ? 'block' : 'none';
  }

  function addSlider(key, min, max, step, parent, labelText, fmt) {
    const panel = parent || tabMain || document.getElementById('devpanel');
    const row = document.createElement('div');
    row.className = 'row';
    const label = document.createElement('label');
    label.textContent = labelText || key;
    const slider = document.createElement('input');
    Object.assign(slider, { type: 'range', min, max, step });
    slider.value = settings[key];
    const val = document.createElement('span');
    val.className = 'val';
    const show = (v) => { val.textContent = fmt ? fmt(v) : v; };
    show(settings[key]);
    slider.addEventListener('input', () => {
      settings[key] = Number(slider.value);
      show(slider.value);
      if (onChange) onChange(key);
    });
    row.append(label, slider, val);
    panel.appendChild(row);
    controls.push({ key, slider, val, fmt });
  }

  function buildPanel(onChangeFn) {
    onChange = onChangeFn;
    const panel = document.getElementById('devpanel');

    // tab bar: MAIN | CHAT
    const tabRow = document.createElement('div');
    tabRow.className = 'tabs';
    for (const [id, label] of [['main', 'MAIN'], ['chat', 'CHAT'], ['world', 'WORLD']]) {
      const b = document.createElement('button');
      b.textContent = label;
      b.dataset.tab = id;
      if (id === 'main') b.classList.add('active');
      b.addEventListener('click', () => selectTab(id));
      tabRow.appendChild(b);
    }
    panel.appendChild(tabRow);
    tabMain = document.createElement('div');
    tabMain.id = 'devtab-main';
    tabChat = document.createElement('div');
    tabChat.id = 'devtab-chat';
    tabChat.style.display = 'none';
    tabWorld = document.createElement('div');
    tabWorld.id = 'devtab-world';
    tabWorld.style.display = 'none';
    panel.append(tabMain, tabChat, tabWorld);

    // WORLD tab: day/night + future world toggles
    addSlider('worldTime', 0, 1, 1, tabWorld, 'time of day', (v) => (Number(v) === 1 ? 'night 🌙' : 'day ☀️'));
    addSlider('clockOn', 0, 1, 1, tabWorld, 'day clock (Mon-Sat 9-9)', (v) => (Number(v) === 1 ? 'running' : 'paused'));

    addSlider('speed', 20, 500, 10);
    addSlider('idleFps', 1, 30, 1);
    addSlider('runFps', 1, 30, 1);
    addSlider('dieFps', 1, 30, 1);
    addSlider('fallFps', 1, 30, 1);
    addSlider('scale', 1, 4, 0.5);
    addSlider('sunray', 0, 1, 0.05);
    addSlider('maxTilt', 0, 1.2, 0.05);
    addSlider('l2dOn', 0, 1, 1);
    addSlider('gunHide', 0, 1, 1, undefined, 'hide gun unless shooting', (v) => (Number(v) === 1 ? 'hide' : 'always out'));
    addSlider('goalHide', 0, 1, 1, undefined, 'tactic goal line', (v) => (Number(v) === 1 ? 'hide' : 'show'));

    addSlider('l2dZoom', 0.1, 2, 0.05);
    addSlider('l2dx', 0, 1, 0.02);
    addSlider('l2dy', -1, 0.5, 0.02);
    addSlider('l2dExpr', 0, 6, 1); // 0=auto, 1..6 pin: happy/beaming/surprised/smug/pouty/sleepy

    // Health test buttons: nothing hurts her in-game yet, so Hurt/Heal here
    // (or Health.damage(1) in the console) exercises the faint/respawn loop.
    {
      const row = document.createElement('div');
      row.className = 'btns';
      const hurt = document.createElement('button');
      hurt.textContent = 'Hurt ♥-1';
      hurt.addEventListener('click', () => window.Health && window.Health.damage(1));
      const heal = document.createElement('button');
      heal.textContent = 'Heal ♥+1';
      heal.addEventListener('click', () => window.Health && window.Health.heal(1));
      const boss = document.createElement('button');
      boss.textContent = 'Spawn boss 🐗';
      boss.title = 'One DREADBOAR, off-screen — refuses while one already walks';
      boss.addEventListener('click', () => { try { window.Enemies && window.Enemies.spawnBoss && window.Enemies.spawnBoss(); } catch (e) {} });
      const drone = document.createElement('button');
      drone.textContent = 'Give drone 🛸';
      drone.title = 'Free Hover Drone deed + slotted — testing skips the till';
      drone.addEventListener('click', () => { try { if (window.Pet && window.Pet.grant) { window.Pet.grant(); window.Pet.equip(); } } catch (e) {} });
      row.append(hurt, heal, boss, drone);
      tabMain.appendChild(row);
    }

    // CHAT tab: character + LLM params. Applies to the NEXT message sent.
    addText('chatModel', 'model', false, tabChat);
    addText('chatUrl', 'server', false, tabChat);
    addSlider('chatTokens', 50, 2000, 50, tabChat); // max tokens per reply
    addSlider('chatTemp', 0, 2, 0.05, tabChat);     // temperature
    addSlider('chatActions', 0, 1, 1, tabChat, 'show actions', (v) => (Number(v) === 1 ? 'show' : 'hide')); // *action* highlight on/off
    addText('chatStatus', 'situation', false, tabChat); // e.g. Location: grassland — change when she moves
    addText('chatSystem', 'persona', true, tabChat);
    // Survival brain tuning (applies to the NEXT think).
    addSlider('brainInterval', 3, 30, 1, tabChat, 'think every (secs)', (v) => `${v}s ${Number(v) <= 6 ? '(fast)' : Number(v) >= 15 ? '(lazy)' : ''}`); // secs between auto thinks — LEFT = faster
    addSlider('brainTokens', 80, 800, 20, tabChat, 'thought length (max tokens)');

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
      controls.forEach(({ key, slider, val, fmt }) => {
        slider.value = settings[key];
        val.textContent = fmt ? fmt(settings[key]) : settings[key];
      });
      textControls.forEach(({ key, el }) => { el.value = settings[key] ?? ''; });
      save(); // reset persists immediately so it survives reload
    });
    btnRow.append(saveBtn, resetBtn);
    document.getElementById('devpanel').appendChild(btnRow);
  }

  return { settings, save, saveSoon, refreshControls, buildPanel, togglePanel };
})();
