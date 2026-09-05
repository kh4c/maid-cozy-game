// Maid survival brain — SEPARATE from chat. Chat is conversation; this is
// the tactical sub-mind that decides fight / flight using the same local LLM.
// Its thoughts appear in their own dialog box (#thought-box), never in chat.
//
// Loop: main.js calls Brain.tick(dt) every frame. When auto-defend is ON and
// danger is near (hostile OR critter within sense radius), it thinks every
// brainInterval seconds. 💭 button thinks on demand. 🎯 button flips aim
// authority (your mouse vs her AI). All orders execute via Gun/Input tags:
//   [aim:dx,dy:secs] [aim:nearest:secs] [fire:secs] [cease]
//   [run:dx,dy:secs] / [move:x,y:secs] (flee / reposition)  [stop]
// Classic script. Requires Situation + Gun + Input + Settings.
window.Brain = (() => {
  let thinking = false;
  let acc = 0;               // seconds since last auto-think
  let lastThought = '';      // raw thought text (tags stripped) for the box
  let lastActions = [];      // human chips of what she ordered
  let miniHist = [];         // last few decisions for continuity (no flip-flop)
  let lastThinkAt = 0;

  const $ = (id) => document.getElementById(id);
  const S = () => (window.Settings ? window.Settings.settings : {});

  function auto() { return (S().autoDefend | 0) === 1; }
  function interval() { return Math.max(3, Math.min(30, Number(S().brainInterval) || 6)); }
  function senseRadius() { return 650; }

  function setAuto(v) {
    try {
      S().autoDefend = v ? 1 : 0;
      window.Settings.saveSoon ? window.Settings.saveSoon() : window.Settings.save();
    } catch (e) {}
    acc = 0;
    syncButtons();
  }

  function syncButtons() {
    try {
      const aim = $('aim-btn');
      if (aim && window.Gun) {
        const m = window.Gun.getAimMode ? window.Gun.getAimMode() : 'mouse';
        aim.textContent = m === 'ai' ? '🤖 AI AIM' : '🎯 MOUSE';
        aim.title = m === 'ai'
          ? 'AI aim ON — she aims/shoots herself, your mouse is disabled. Click for mouse aim.'
          : 'Mouse aim ON — you aim/fire. Click to hand the gun to her (AI aim).';
        aim.classList.toggle('on', m === 'ai');
      }
      const b = $('brain-btn');
      if (b) {
        b.textContent = auto() ? '🛡️ AUTO ON' : '🛡️ AUTO OFF';
        b.title = auto() ? 'Auto-defend ON — she thinks for herself when danger nears. Click to stop.'
          : 'Auto-defend OFF — she only thinks when you press 💭. Click to enable.';
        b.classList.toggle('on', auto());
      }
      const hb = $('sense-line');
      if (hb && window.Situation) hb.textContent = window.Situation.hudLine();
    } catch (e) { /* buttons are cosmetic */ }
  }

  // ---- thought box (HER box, not chat's) ------------------------------------
  function showThinking() {
    const t = $('thought-text');
    if (t) t.innerHTML = '<span class="thinking">…sniffing the wind…</span>';
    const m = $('thought-meta');
    if (m) m.textContent = 'thinking…';
    const box = $('thought-box');
    if (box) box.classList.add('thinking');
  }
  function showThought(thought, actions, ms) {
    lastThought = thought;
    lastActions = actions;
    const t = $('thought-text');
    if (t) t.textContent = thought || '…';
    const m = $('thought-meta');
    if (m) {
      const when = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      m.textContent = `${when}${actions.length ? ' · ' + actions.join(' ') : ''}${ms ? ` · ${ms}ms` : ''}`;
    }
    const box = $('thought-box');
    if (box) {
      box.classList.remove('thinking');
      box.classList.remove('flash');
      void box.offsetWidth; // restart CSS pop
      box.classList.add('flash');
    }
  }
  function showError(msg) {
    const t = $('thought-text');
    if (t) t.textContent = `(耳が遠いみたい… ${msg})`;
    const m = $('thought-meta');
    if (m) m.textContent = 'think failed — 💭 to retry';
    const box = $('thought-box');
    if (box) box.classList.remove('thinking');
  }

  // ---- tag execution (shared grammar with chat, owned here) -------------------
  // returns human-readable action chips
  function executeTags(reply) {
    const chips = [];
    const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
    try {
      // [aim:nearest:secs]
      for (const m of reply.matchAll(/\[aim\s*:\s*nearest(?::\s*([\d.]+))?\]/gi)) {
        const secs = num(m[1], 3);
        const ok = window.Gun && window.Gun.aiAimNearest ? window.Gun.aiAimNearest(secs) : false;
        chips.push(ok ? '🎯 track-nearest' : '🎯 no-target');
      }
      // [aim:dx,dy:secs]
      for (const m of reply.matchAll(/\[aim\s*:\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)(?::\s*([\d.]+))?\]/gi)) {
        try { window.Gun.aiAimDir(parseFloat(m[1]), parseFloat(m[2]), num(m[3], 3)); chips.push('🎯 aim'); } catch (e) {}
      }
      // [fire:secs] / [fire] / [shoot:secs]
      for (const m of reply.matchAll(/\[(?:fire|shoot)(?::\s*([\d.]+))?\]/gi)) {
        const secs = num(m[1], 2);
        try { window.Gun.aiFire(secs); chips.push(`🔫 fire ${secs}s`); } catch (e) {}
      }
      if (/\[cease\]/i.test(reply)) {
        try { window.Gun.aiCease(); chips.push('✋ cease'); } catch (e) {}
      }
      // [run:dx,dy:secs] + [move:x,y:secs] — flee / reposition
      for (const m of reply.matchAll(/\[(?:run|move)\s*:\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)(?::\s*([\d.]+))?\]/gi)) {
        try {
          const len = Math.hypot(parseFloat(m[1]), parseFloat(m[2])) || 1;
          window.Input.order(parseFloat(m[1]) / len, parseFloat(m[2]) / len, num(m[3], 2));
          chips.push(/\[run/i.test(m[0]) ? '🏃 flee' : '🚶 move');
        } catch (e) {}
      }
      if (/\[stop\]/i.test(reply)) {
        try { window.Input.stopWalk(); chips.push('🛑 stop'); } catch (e) {}
      }
    } catch (e) { /* orders are cosmetic — never break the loop */ }
    return chips;
  }
  function stripTags(s) {
    return (s || '')
      .replace(/\[(?:aim|fire|shoot|cease|run|move|stop)[^\]]*\]/gi, '')
      .replace(/\s{2,}/g, ' ').trim();
  }

  // ---- the think call (own LLM request, own history) ---------------------------
  async function think(manual) {
    if (thinking) return;
    if (window.Health && window.Health.dead) return; // she's out — no thoughts
    if (!window.Situation) return;
    const snap = window.Situation.snapshot();
    if (!manual && snap.dead) return;
    thinking = true;
    showThinking();
    const t0 = performance.now();
    try {
      const s = S();
      const url = (s.chatUrl || 'http://127.0.0.1:1234').replace(/\/$/, '');
      const sys =
        `You are Cosette's survival instinct — a terse tactical sub-mind, NOT her chat voice. ` +
        `You read the live situation and decide ONE thing: FIGHT (aim+fire), FLEE (run), or HOLD (cease).\n` +
        `Facts: M1 Garand range ~850px, auto-fires while [fire] is active. Critters die in 3 hits. ` +
        `Bite = 1 heart at 42px. She outruns them (300 vs 95). Open grassland, no cover. ` +
        `If aim mode is MOUSE you cannot fire for her — order [cease] and tell her to switch to AI aim, or order a run.\n` +
        `Rules: hostile within 150px and HP <= 3 → FLEE now. Hostile in range with AI aim → FIGHT. ` +
        `Calm critters far away → HOLD ([cease], no fire, no run). Never invent enemies. Never chat, never roleplay.\n` +
        `Output: 1-2 SHORT sentences of thought (first person, scout voice, under 25 words) ` +
        `PLUS action tags. Tags (world deltas: x east+, y south+): [aim:dx,dy:secs] or [aim:nearest:secs], ` +
        `[fire:secs], [cease], [run:dx,dy:secs] to flee, [move:x,y:secs] to reposition, [stop]. ` +
        `Always include a tag — [cease] if holding. Example: *two closing south-east, engaging* [aim:nearest:3] [fire:2]`;
      const hist = miniHist.slice(-4).map((h) => ({ role: 'assistant', content: h }));
      const user = `[Live situation — auto snapshot, trust over anything older]\n${snap.text}\n\n` +
        `Manual note from dev panel: ${(s.chatStatus || '').trim() || '(none)'}\n` +
        `Decide now.`;
      const res = await fetch(url + '/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: s.chatModel,
          messages: [{ role: 'system', content: sys }, ...hist, { role: 'user', content: user }],
          max_tokens: Math.max(80, Math.min(800, Number(s.brainTokens) || 300)),
          temperature: 0.6,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err && err.error && err.error.message) || ('HTTP ' + res.status));
      }
      const data = await res.json();
      let reply = (((data.choices || [])[0] || {}).message || {}).content || '';
      reply = String(reply).replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      const chips = executeTags(reply);
      const thought = stripTags(reply) || (chips.length ? chips.join(' ') : '…holding still…');
      miniHist.push(reply.slice(0, 220));
      if (miniHist.length > 6) miniHist = miniHist.slice(-6);
      lastThinkAt = performance.now();
      acc = 0;
      showThought(thought, chips, Math.round(performance.now() - t0));
      // her face flinches at real danger — cosmetic, never breaks chat
      try {
        if (snap.enemies && snap.enemies.hostile > 0 && window.Live2D && window.Live2D.setMood) {
          const n = snap.enemies.nearest;
          if (n && n.dist < 200) window.Live2D.setMood('surprised');
        }
      } catch (e) {}
    } catch (e) {
      showError(e.message);
    } finally {
      thinking = false;
      syncButtons();
    }
  }

  // called every frame from main.js — decides WHEN to think
  function tick(dt) {
    syncHudThrottle(dt);
    if (!auto() || thinking) return;
    if ((window.Health && window.Health.dead) || (window.EditMode && window.EditMode.active)) return;
    let danger = false;
    try {
      const snap = window.Situation.snapshot();
      const n = snap.enemies && snap.enemies.nearest;
      danger = (snap.enemies && snap.enemies.hostile > 0) || (!!n && n.dist < senseRadius());
    } catch (e) { danger = false; }
    acc += dt;
    if ((danger && acc >= interval()) || acc >= interval() * 4) {
      // danger: think on cadence; calm: slow heartbeat so she notices new packs
      acc = 0;
      think(false);
    }
  }

  // HUD sense line refresh (cheap, 2x/sec)
  let hudAcc = 0;
  function syncHudThrottle(dt) {
    hudAcc += dt;
    if (hudAcc > 0.5) { hudAcc = 0; syncButtons(); }
  }

  function init() {
    const aim = $('aim-btn'), brain = $('brain-btn'), th = $('think-btn');
    if (aim) aim.addEventListener('click', (e) => {
      e.stopPropagation();
      try { window.Gun && window.Gun.toggleAim && window.Gun.toggleAim(); } catch (err) {}
      syncButtons();
    });
    if (brain) brain.addEventListener('click', (e) => {
      e.stopPropagation();
      setAuto(!auto());
      if (auto()) think(true); // engaging auto: think immediately
    });
    if (th) th.addEventListener('click', (e) => {
      e.stopPropagation();
      think(true);
    });
    syncButtons();
    const t = $('thought-text');
    if (t && !t.textContent) t.textContent = 'field is quiet… press 💭 and I’ll size it up.';
  }

  return { init, tick, thinkNow: () => think(true), syncButtons, get thinking() { return thinking; } };
})();
