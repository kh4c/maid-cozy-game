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

  // ---- session memory (per game, resets on death/restart) -------------------
  // Kills, hits taken, flee events + a short event log feed every tactical
  // think, so she remembers what just happened in THIS life.
  let memory = newMemory();
  function newMemory() {
    return { kills: 0, hurt: 0, fled: 0, ordersObeyed: 0, bornAt: performance.now(), events: [] };
  }
  function resetMemory(reason) {
    memory = newMemory();
    try { memory.events.push(`(new life — ${reason})`); } catch (e) {}
  }
  // note('kill', n) / note('hurt') / note('flee') — called by gun/health/main
  function note(kind, n) {
    try {
      if (kind === 'kill') {
        memory.kills += Math.max(1, Number(n) || 1);
        askCount = Math.max(0, askCount - 1); // venting: each kill settles one gripe
        pushEvent(`popped ${Math.max(1, Number(n) || 1)} critter(s)`);
      } else if (kind === 'hurt') {
        memory.hurt += 1;
        pushEvent(`took a bite (${memory.hurt} hearts lost today)`);
      } else if (kind === 'flee') {
        memory.fled += 1;
        pushEvent('ran from a pack');
      } else if (kind === 'tired') {
        pushEvent('ran out of breath and had to rest');
      }
    } catch (e) { /* memory is cosmetic */ }
  }
  function pushEvent(t) {
    memory.events.push(t);
    if (memory.events.length > 6) memory.events = memory.events.slice(-6);
  }
  function memoryText() {
    const mins = Math.max(0, Math.round((performance.now() - memory.bornAt) / 60000));
    const ev = memory.events.length ? memory.events.slice(-4).map((e) => '· ' + e).join('\n') : '· nothing yet';
    return `This life (${mins} min): ${memory.kills} kills, ${memory.hurt} bites taken, ${memory.fled} retreats.\nRecent:\n${ev}`;
  }

  // ---- order pressure: asks wear her down FAST (user tuned: easily convinced) --
  // First ask: grumble but likely do it. Second ask / any kill order twice:
  // fully caves. Kills vent one step; the counter resets with each new life.
  let askCount = 0;        // un-vented attack asks
  let lastAskAt = -1e9;    // ms
  const ASK_DECAY_MS = 90000; // one gripe cools every 90s without a new ask
  function annoyance() {
    const cooled = Math.floor((performance.now() - lastAskAt) / ASK_DECAY_MS);
    return Math.max(0, askCount - cooled);
  }
  function annoyanceFlavor(n) {
    if (n <= 0) return 'Master has not been asking much lately.';
    if (n === 1) return 'Master asked you to attack — you find it tiresome, but honestly it is easier to just do it than argue. Comply while grumbling.';
    return `Master asked ${n} times. Annoying — but fine, FINE, you were going to do it anyway. Comply NOW.`;
  }

  const $ = (id) => document.getElementById(id);
  const S = () => (window.Settings ? window.Settings.settings : {});

  function auto() { return (S().autoDefend | 0) === 1; }
  function interval() { return Math.max(3, Math.min(30, Number(S().brainInterval) || 6)); }
  function senseRadius() { return 450; } // on-screen-ish: she only reacts to what she can see

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
  const ATTACK_VERBS = /(attack|shoot|kill|fire|fight|defend|aim|hunt|get them|take them|destroy|blast)/i;
  // Explicit order from the master (e.g. chat "attack them!"): take the gun
  // into her own hands if needed, then think immediately with the order.
  // Repeated asks stack annoyance — she caves eventually (hard floor below).
  function orderAttack(text) {
    askCount += 1;
    lastAskAt = performance.now();
    const n = annoyance();
    try {
      // easily convinced: the FIRST order already makes her take the gun
      if (window.Gun && window.Gun.getAimMode && window.Gun.getAimMode() !== 'ai' && window.Gun.setAimMode) {
        window.Gun.setAimMode('ai');
        pendingChips.push('🤖 took-aim (fine.)');
      }
    } catch (e) {}
    pushEvent(`master asked her to attack (${n} un-vented)`);
    think(true, text);
  }
  let pendingChips = [];
  async function think(manual, order) {
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
        `You are Cosette's survival instinct — a game-combat sub-mind, NOT her chat voice. ` +
        `This is a cozy cartoon game: the shadow critters are game sprites; defeating one pops it into sparkles (no gore, new packs wander in later). ` +
        `Combat is allowed, but she is NOT a hunter — she fights in self-defense or on explicit orders, never for sport.\n` +
        `Read the live situation and pick ONE: ENGAGE, FLEE, or HOLD.\n` +
        `Facts: M1 Garand range ~850px, auto-fires while [fire] is active. Critters pop in 3 hits. ` +
        `Bite = 1 heart at 42px. She outruns them (300 vs 95). Open grassland, no cover.\n` +
        `Rules: HOSTILE critters in range with aim mode AI → ENGAGE: [aim:nearest:secs] + [fire:secs]. ` +
        `SELF-PRESERVATION FIRST: anything hostile within ~250px is a bite threat — if HP is 4 or less, or stamina is low/exhausted, FLEE FIRST: [run:dx,dy:secs] away (negate the threat's dx,dy) and only turn to fight ([aim:nearest]+[fire]) once at 400px+. ` +
        `Running needs stamina — check it before committing to a long chase or flight. ` +
        `Calm critters → HOLD: [cease]. Watch them, do NOT fire on your own initiative. ` +
        `Master's standing order overrides HOLD: comply while grumbling. ` +
        `Aim mode MOUSE → you cannot fire: output [cease] and say "hand me the gun (AI aim)".\n` +
        `ANNOYANCE LEVEL: ${annoyance()} — ${annoyanceFlavor(annoyance())}\n` +
        `SESSION MEMORY (this life only):\n${memoryText()}\n` +
        `Output: 1-2 SHORT sentences of thought (first person, scout voice, under 25 words) ` +
        `PLUS action tags. Tags (world deltas: x east+, y south+): [aim:dx,dy:secs] or [aim:nearest:secs], ` +
        `[fire:secs], [cease], [run:dx,dy:secs] to flee, [move:x,y:secs] to reposition, [stop]. ` +
        `Always include a tag — [cease] if holding. Example: *one hostile closing north — engaging* [aim:nearest:3] [fire:2]`;
      const hist = miniHist.slice(-4).map((h) => ({ role: 'assistant', content: h }));
      const nAsk = annoyance();
      const user = `[Live situation — auto snapshot, trust over anything older]\n${snap.text}\n\n` +
        `Manual note from dev panel: ${(s.chatStatus || '').trim() || '(none)'}` +
        (order ? `\nStanding order from master: "${String(order).slice(0, 200)}" — annoyance level ${nAsk}. ${nAsk >= 3 ? 'Refusal is no longer an option. Comply: [aim:nearest:3] [fire:2] even while grumbling.' : 'Strongly consider complying this time.'}` : '') +
        `\nDecide now.`;
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
      let chips = [...pendingChips];
      pendingChips = [];
      // HARD FLOOR (user tuned: easily convinced): ANY standing order + target
      // in range + model still won't emit a fire tag -> she caves and fires.
      let caved = false;
      if (order && !/\[(?:fire|shoot)/i.test(reply)) {
        const okTarget = window.Gun && window.Gun.aiAimNearest ? window.Gun.aiAimNearest(3) : false;
        if (okTarget) {
          window.Gun.aiFire(2);
          chips.push('🎯 track-nearest', '🔫 fire 2s (FINE.)');
          reply = '*fine. FINE. look what you made me do* [fired anyway, eye-rolling]';
          caved = true;
        }
      }
      chips = chips.concat(executeTags(reply));
      const thought = stripTags(reply) || (chips.length ? chips.join(' ') : '…holding still…');
      miniHist.push(reply.slice(0, 220));
      if (miniHist.length > 6) miniHist = miniHist.slice(-6);
      lastThinkAt = performance.now();
      acc = 0;
      showThought(thought, chips, Math.round(performance.now() - t0));
      if (caved) pushEvent('gave in and fired to make master stop asking');
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
    let hot = false, near = false;
    try {
      const snap = window.Situation.snapshot();
      hot = !!(snap.enemies && snap.enemies.hostile > 0);
      const n = snap.enemies && snap.enemies.nearest;
      near = !!(n && n.dist < senseRadius());
    } catch (e) { hot = false; near = false; }
    acc += dt;
    if (hot && acc >= interval()) {
      acc = 0; // something is hunting her — think on cadence
      think(false);
    } else if (!hot && near && acc >= interval() * 3) {
      acc = 0; // calm critters in view — a slow watchful glance, holds fire
      think(false);
    } else if (!hot && !near) {
      acc = 0; // quiet field — no thoughts, no LLM calls
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

  return { init, tick, thinkNow: () => think(true), orderAttack, syncButtons, note, resetMemory, get thinking() { return thinking; } };
})();
