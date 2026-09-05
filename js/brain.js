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
    memo = { text: 'No tactical intent yet — treat as casual watch.', from: '', at: -1e9 }; // new life: old wishes expire
    attackOrder = false; // new life: gun down
    try { stopFollow(); } catch (e) {}
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

  // ---- attack-mode latch ------------------------------------------------------
  // A kill order (or an attack wish in the memo) flips this on: while ANY
  // critter is alive in range she keeps aiming + firing WITHOUT waiting for
  // the LLM — so packs that wander in mid-slaughter get shot too, not
  // politely ignored until the next think. Cleared by a stop-memo or death.
  let attackOrder = false;
  let atkAcc = 0;
  function combatDrive(dt) {
    if (!attackOrder) return;
    if ((window.Health && window.Health.dead) || (window.EditMode && window.EditMode.active)) return;
    try { if (!window.Gun || window.Gun.getAimMode() !== 'ai') return; } catch (e) { return; }
    atkAcc += dt;
    if (atkAcc < 0.25) return; // 4x/sec is plenty to keep the trigger held
    atkAcc = 0;
    try {
      const p = window.Situation && window.Situation.snapshot ? window.Situation.snapshot() : null;
      if (!p) return;
      const en = p.enemies;
      if (!en || !en.nearest || en.nearest.dist > 500) return; // nothing in her circle
      // FIRE DISCIPLINE: hostiles are always fair game (self-defense). Calm
      // critters only while the order is FRESH (45s) — a stale "kill them"
      // from minutes ago must not mow down every new pack that wanders in.
      // Otherwise she waits: hold fire, keep watching.
      const fresh = performance.now() - lastAskAt < 45000;
      if (!en.nearest.hostile && !fresh) {
        try { window.Gun && window.Gun.aiCease && window.Gun.aiCease(); } catch (e) {}
        return;
      }
      window.Gun.aiAimNearest(1); // keep tracking
      const st = window.Gun.status();
      if (!st.firing) window.Gun.aiFire(1); // top the trigger up as it expires
    } catch (e) {}
  }
  function setAttackOrder(v, why) {
    attackOrder = !!v;
    try { pushEvent(v ? `hunting mode ON (${why || 'ordered'})` : 'hunting mode OFF'); } catch (e) {}
    if (!v) { try { window.Gun && window.Gun.aiCease && window.Gun.aiCease(); } catch (e) {} } // stop = trigger released now
  }
  function annoyance() {
    const cooled = Math.floor((performance.now() - lastAskAt) / ASK_DECAY_MS);
    return Math.max(0, askCount - cooled);
  }
  function annoyanceFlavor(n) {
    if (n <= 0) return 'Master has not been asking much lately.';
    if (n === 1) return 'Master asked you to attack — you find it tiresome, but honestly it is easier to just do it than argue. Comply while grumbling.';
    return `Master asked ${n} times. Annoying — but fine, FINE, you were going to do it anyway. Comply NOW.`;
  }

  // ---- master's intent memo (written by chat.js) -----------------------------
  // Chat understands natural language, so IT summarizes what master wants into
  // a standing memo; the tactical brain reads it every think and obeys the
  // spirit of it. Expires with the life (resetMemory), replaceable any time.
  let memo = { text: 'No tactical intent yet — treat as casual watch.', from: '', at: -1e9 };
  // Negation-aware: "don't kill / do not shoot / stop / no more / leave them /
  // stand down / come here / rest" always wins over attack words — telling
  // her NOT to kill must never latch hunting mode on.
  const STOP_RE = /(stop|cease|\bdon[’']t\b|\bdo not\b|\bnot\b|\bno more\b|never mind|leave them|leave it|stand down|come here|\brest\b|hold fire|hold your fire)/;
  const ATTACK_RE = /(kill|attack|shoot|hunt|fire|destroy|wipe|clear|blast)/;
  function wantsStop(t) { return STOP_RE.test(t); }
  function wantsAttack(t) { return ATTACK_RE.test(t) && !STOP_RE.test(t); }
  function setMemo(text, from) {
    memo = { text: String(text || '').slice(0, 240), from: String(from || '').slice(0, 120), at: performance.now() };
    pushEvent(`master's wish noted: ${memo.text.slice(0, 60)}`);
    const t = memo.text.toLowerCase();
    // stop FIRST — negation beats attack words ("don't kill those" = stand down)
    if (wantsStop(t)) { setAttackOrder(false, 'master said stop'); stopFollow(); stopStroll(); }
    else if (wantsAttack(t)) setAttackOrder(true, 'master ordered');
    // movement wishes start the stroll even with no direction known
    if (/(find|look for|search|go|wander|explore|patrol|somewhere|anywhere)/.test(t) && !/(stop|don.t|cease)/.test(t)) beginStroll();
    if (/(stop|come here|stay|halt|stand down)/.test(t)) stopStroll();
  }
  function memoText() {
    const ageMin = Math.round((performance.now() - memo.at) / 60000);
    const when = memo.at === -1e9 ? '' : ` (set ${ageMin <= 0 ? 'just now' : ageMin + ' min ago'})`;
    return `MASTER'S CURRENT WISH${when}: ${memo.text}${memo.from ? `\n(their exact words: "${memo.from}")` : ''}`;
  }

  const $ = (id) => document.getElementById(id);
  const S = () => (window.Settings ? window.Settings.settings : {});

  function auto() { return (S().autoDefend | 0) === 1; }
  function interval() { return Math.max(3, Math.min(30, Number(S().brainInterval) || 6)); }
  // ---- ranges: everything tactical lives at 500px -----------------------------
  const SENSE_R = 500;    // her circle of awareness — nothing beyond this exists
  const SAFE_MIN = 170;   // back away inside this (bite is 42px — plenty of margin)
  function senseRadius() { return SENSE_R; } // she only reacts to what is on/near screen

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
      // [fire:secs] / [fire] / [shoot:secs] — agreeing to fire while still in
      // MOUSE aim does nothing, so any fire tag auto-takes the gun first.
      for (const m of reply.matchAll(/\[(?:fire|shoot)(?::\s*([\d.]+))?\]/gi)) {
        const secs = num(m[1], 2);
        try {
          if (window.Gun.getAimMode && window.Gun.getAimMode() !== 'ai' && window.Gun.setAimMode) {
            window.Gun.setAimMode('ai');
            chips.push('🤖 took-aim');
          }
          window.Gun.aiFire(secs); chips.push(`🔫 fire ${secs}s`);
        } catch (e) {}
      }
      // [cease] only counts when the same thought has no fire tag
      // (models occasionally write "[fire:2] [cease]" — the gun obeyed both).
      if (/\[cease\]/i.test(reply) && !/\[(?:fire|shoot)/i.test(reply)) {
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
  // No confirmation step: an order is an order, calm targets or not.
  function orderAttack(text) {
    askCount += 1;
    lastAskAt = performance.now();
    setAttackOrder(true, 'ordered'); // latch: keep shooting at new spawns too
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
        `Obey MASTER'S CURRENT WISH below — it is the master's intent, translated from their chat; pursue it when it is safe to do so (if it says attack, [aim:nearest]+[fire]; if it says stop/come, [cease]+[stop]). ` +
        `KEEP DISTANCE (built-in reflex, not a decision): stay 170-500px from anything ALIVE. Closer than 170px → [move:dx,dy:secs] away along (dx,dy) negated. Farther than 500px → walk closer with [move]. Do this every think, even mid-fight. ` +
        `SELF-PRESERVATION FIRST: anything hostile within ~250px is a bite threat — if HP is 4 or less, or stamina is low/exhausted, FLEE FIRST: [run:dx,dy:secs] away (negate the threat's dx,dy) and only turn to fight ([aim:nearest]+[fire]) once at 400px+. ` +
        `Running needs stamina — check it before committing to a long chase or flight. ` +
        `Calm critters → HOLD / WAIT: [cease]. Watch them, do NOT fire on your own initiative — waiting is the job. ` +
        `If you recently FOUND a pack for master (see Recent events), stay near it and keep waiting — shadowing, not shooting. ` +
        `A hunt/attack wish STAYS in force only while FRESH (master asked under a minute ago — check when the wish was set): every critter in range is a valid target. ` +
        `A STALE wish (several minutes old) against calm critters → HOLD and wait for a fresh order, do not fire. ` +
        `Critters have RARITY with coin value (common / uncommon-green / RARE-blue / EPIC-purple / LEGENDARY-gold — the snapshot lists it). Rare+ finds are announced to master already; still WAIT for orders before firing calm ones, however shiny. ` +
        `A FRESH standing order overrides HOLD: comply while grumbling. ` +
        `ANNOYANCE LEVEL: ${annoyance()} — ${annoyanceFlavor(annoyance())}\n` +
        `${memoText()}\n` +
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
      // in range + model still won't emit a fire tag -> she caves; we execute
      // the grumbling compliance for her so nagging always ends in shots fired.
      let caved = false;
      if (order && !/\[(?:fire|shoot)/i.test(reply)) {
        const okTarget = window.Gun && window.Gun.aiAimNearest ? window.Gun.aiAimNearest(3) : false;
        if (okTarget) {
          if (window.Gun.getAimMode && window.Gun.getAimMode() !== 'ai' && window.Gun.setAimMode) {
            window.Gun.setAimMode('ai'); // floor must actually shoot
          }
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

  // called every frame from main.js — decides WHEN to think.
  // NOTE: chat walk orders + keepDistance + combatDrive run regardless of AUTO;
  // the maid takes over controlling the character by default.
  function tick(dt) {
    syncHudThrottle(dt);
    keepDistance(dt);  // built-in reflex — runs every frame, no LLM needed
    combatDrive(dt);   // hunting latch — keeps the trigger held between thinks
    stroll(dt);        // "go somewhere" — she never just stands when ordered to move
    searchWatch(dt);   // searching paid off? look, announce, follow
    followTick(dt);    // shadow the found pack at ~280px
    if (!auto() && !attackOrder) return;
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

  // ---- stroll: never stand still when master said to move ---------------------
  // Chat orders like "find some critters" or "go somewhere" may lack a
  // direction. Instead of ignoring them, she picks a direction herself and
  // walks it, re-choosing every leg until told to stop. Cleared by [stop] or
  // a chat "stop".
  let strollDir = null;   // { x, y }
  let strollAcc = 0;
  function beginStroll() {
    if (strollDir) return;
    searchDone = false; // a new search — allowed to find again
    pickStrollDir();
    try { pushEvent('wandering off to carry out master\'s wish'); } catch (e) {}
  }
  function pickStrollDir() {
    const a = Math.random() * Math.PI * 2;
    strollDir = { x: Math.cos(a), y: Math.sin(a) };
    strollAcc = 0;
    try { window.Input.order(strollDir.x, strollDir.y, 2.0); } catch (e) {} // move at once
  }
  function stopStroll() { strollDir = null; }
  function stroll(dt) {
    if (!strollDir) return;
    if ((window.Health && window.Health.dead) || (window.EditMode && window.EditMode.active)) return;
    if (window.Stamina && !window.Stamina.canMove()) { window.Input.stopWalk(); return; } // tired → rest
    strollAcc += dt;
    if (strollAcc < 2.2) return; // one leg ~2.2s
    strollAcc = 0;
    // slight course change each leg — looks like searching, not a rail line
    const turn = (Math.random() - 0.5) * 1.6;
    const cos = Math.cos(turn), sin = Math.sin(turn);
    const nx = strollDir.x * cos - strollDir.y * sin;
    const ny = strollDir.x * sin + strollDir.y * cos;
    strollDir = { x: nx, y: ny };
    try { window.Input.order(strollDir.x, strollDir.y, 2.0); } catch (e) {}
    // search loop: if the field is empty for ~40s she gives up and waits
    try {
      const p = window.Situation.snapshot();
      if (!p.enemies || p.enemies.total === 0) {
        strollGiveUp += 2.2;
        if (strollGiveUp > 40) { stopStroll(); showThought('*nothing out here… heading back.*', ['🛑 gave up'], 0); }
      } else strollGiveUp = 0;
    } catch (e) {}
  }
  let strollGiveUp = 0;

  // ---- found-and-follow: searching must END in something -----------------------
  // While she's strolling on a "find ..." wish (or the memo is a live search
  // wish) and a critter enters her 500px circle: stop wandering, LOOK at it
  // (camera pans over for ~2.5s), tell master what she found, then shadow it
  // at ~170-280px instead of fleeing. Announced once per search; follow ends
  // when the pack is lost (>500px for 6s), master says stop, or she faints.
  let searchDone = false;   // this search already paid off
  let following = false;    // shadowing a found pack right now
  let followLostAcc = 0;    // seconds since the pack left her circle
  let followAcc = 0;        // approach-order throttle
  let pendingSay = null;    // found-line waiting for a free chat box
  let pendingSayAcc = 0, pendingSayTries = 0;
  const FOLLOW_DIST = 280;  // shadow at this range (keep-distance owns <170)
  const OBSERVE_DIST = 340; // observing a calm pack: stand off, watch, wait for orders
  const RANK = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };
  const RING_WORD = { uncommon: 'green', rare: 'blue', epic: 'purple', legendary: 'gold' };
  let lastRareNote = -1e9;  // opportunistic rare callouts, at most every ~90s
  // priciest critter in view (the one she points at)
  function bestPrize(en) {
    let best = null;
    try {
      for (const e of (en && en.list) || []) {
        if (!best || (e.price || 0) > (best.price || 0)) best = e;
      }
    } catch (e) {}
    return best || (en && en.nearest) || null;
  }
  function packValue(en) {
    try { return (en.list || []).reduce((s, e) => s + ((e.price | 0) || 0), 0); } catch (e) { return 0; }
  }
  // her feeling about hunting THIS pack — appetite scales with shininess
  function huntingFeeling(best) {
    const r = (best && best.rarity) || 'common';
    if (r === 'legendary') return `A LEGENDARY, shining gold — ${best.price} coins!! I'm trying VERY hard to behave, master.`;
    if (r === 'epic') return `An EPIC, shining purple — ${best.price} coins easy… please say I can keep the change.`;
    if (r === 'rare') return `Ooh — a blue-banded RARE, worth about ${best.price} coins! My tail's twitching…`;
    if (r === 'uncommon') return `Some nice green-banded ones in there — pocket money, about ${best.price} coins for the best.`;
    return `Just commons, a coin or two each. Honestly not worth the bullets…`;
  }
  function dirWord(dx, dy) {
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (ax < 1e-6 && ay < 1e-6) return 'right here';
    const h = dx > 0 ? 'east' : 'west', v = dy > 0 ? 'south' : 'north';
    if (ax > ay * 2.2) return h;
    if (ay > ax * 2.2) return v;
    return `${v}-${h}`;
  }
  function distWord(d) {
    if (d < 200) return 'right here';
    if (d < 350) return 'just ahead';
    return 'over there';
  }
  function searchingNow() {
    if (strollDir) return true;
    try { return /find|search/i.test(memo.text); } catch (e) { return false; }
  }
  function searchWatch(dt) {
    // retry a blocked found-line (chat was busy) a few times
    if (pendingSay) {
      pendingSayAcc += dt;
      if (pendingSayAcc > 2 && pendingSayTries < 3) {
        pendingSayAcc = 0; pendingSayTries += 1;
        try { if (window.Chat && window.Chat.say && window.Chat.say(pendingSay)) pendingSay = null; } catch (e) {}
      } else if (pendingSayTries >= 3) pendingSay = null;
    }
    if (following) return;
    if ((window.Health && window.Health.dead) || (window.EditMode && window.EditMode.active)) return;
    try {
      const p = window.Situation && window.Situation.snapshot ? window.Situation.snapshot() : null;
      if (!p || !p.enemies || !p.enemies.nearest || p.enemies.nearest.dist > 500) return;
      if (!searchingNow()) {
        // opportunistic: a RARE+ wandering into view gets announced + observed
        // even with no search order — she talks first, never shoots first.
        // (NOT gated by searchDone — old searches must not mute new shinies.)
        const best = bestPrize(p.enemies);
        const rank = RANK[(best && best.rarity) || 'common'] || 0;
        if (rank >= 2 && performance.now() - lastRareNote > 90000) {
          lastRareNote = performance.now();
          foundIt(p.enemies, true);
        }
        return;
      }
      if (searchDone) return;
      foundIt(p.enemies, false);
    } catch (e) {}
  }
  function foundIt(en, opportunistic) {
    searchDone = true;
    stopStroll();
    following = true;
    followLostAcc = 0;
    const n = en.nearest;
    const dir = dirWord(n.dx, n.dy);
    const best = bestPrize(en) || n;
    const bDir = best && best.dx !== undefined ? dirWord(best.dx, best.dy) : dir;
    const freshOrder = performance.now() - lastAskAt < 45000;
    const feeling = huntingFeeling(best);
    const stance = en.hostile > 0
      ? `Careful, master — ${en.hostile === en.total ? 'they all look' : 'some look'} angry!`
      : (attackOrder && freshOrder)
        ? `Engaging as ordered!`
        : `I'll hold here and watch — say the word, master.`;
    const line = `*gasps, pointing ${bDir}* Found ${en.total === 1 ? 'it' : `them — ${en.total} critters`} ${distWord(n.dist)}, to the ${dir}! ` +
      `${feeling} ${stance}`;
    try { pushEvent(`found ${en.total} critter(s) ${dir} — best ${best.rarity} (~${packValue(en)} coins)`); } catch (e) {}
    try { if (window.__maidCamera && window.__maidCamera.lookAt) window.__maidCamera.lookAt(best.x || n.x, best.y || n.y, 2.5); } catch (e) {}
    let said = false;
    try { said = window.Chat && window.Chat.say ? window.Chat.say(line) : false; } catch (e) { said = false; }
    if (!said) { pendingSay = line; pendingSayAcc = 0; pendingSayTries = 0; }
    showThought(`*found ${en.total === 1 ? 'it' : `all ${en.total} of them`} — best is ${best.rarity}*`, ['🔎 found', `💰 ~${packValue(en)}`, '👀 waiting orders'], 0);
  }
  function followTick(dt) {
    if (!following) return;
    if ((window.Health && window.Health.dead) || (window.EditMode && window.EditMode.active)) { stopFollow(); return; }
    try {
      const p = window.Situation && window.Situation.snapshot ? window.Situation.snapshot() : null;
      const n = p && p.enemies && p.enemies.nearest;
      if (!n || n.dist > 500) {
        followLostAcc += dt; // pack left her circle — grace period, then give up
        if (followLostAcc > 6) {
          stopFollow();
          showThought('*…lost them in the grass. Sorry, master.*', ['👋 lost'], 0);
          try { pushEvent('lost the pack she was following'); } catch (e) {}
        }
        return;
      }
      followLostAcc = 0;
      if (window.Stamina && !window.Stamina.canMove()) return; // tired — hold position
      // OBSERVE: calm pack + no fresh kill order → stand off at 340px and
      // wait for instruction. Hunting (order/hostiles) closes to 280px.
      const observing = !attackOrder && !(p.enemies && p.enemies.hostile > 0);
      const want = observing ? OBSERVE_DIST : FOLLOW_DIST;
      if (n.dist > want) {
        followAcc += dt; // approach in short legs so keep-distance can interject
        if (followAcc < 0.4) return;
        followAcc = 0;
        const len = Math.hypot(n.dx, n.dy) || 1;
        window.Input.order(n.dx / len, n.dy / len, 0.7);
      }
    } catch (e) {}
  }
  function stopFollow() { following = false; followLostAcc = 0; }

  // ---- built-in keep-distance reflex -----------------------------------------
  // Not an LLM decision: if anything alive is closer than SAFE_MIN she backs
  // away every frame (shoots on the move — the gun doesn't care). Flee still
  // overrides this when the brain decides to run. Does nothing in edit mode,
  // while fainted, or when she's exhausted (Stamina blocks movement anyway).
  const SAFE_MAX = 500;   // drift closer beyond this (stays inside sense range)
  const ENGAGE_MAX = 500; // hard sense/engage cap — nothing beyond this exists for her
  let kdAcc = 0;
  function keepDistance(dt) {
    if ((window.Health && window.Health.dead) || (window.EditMode && window.EditMode.active)) return;
    // reflex is HERS: only while she owns the gun (AI aim) — in mouse mode
    // your keyboard stays the only thing that moves her.
    try { if (!window.Gun || window.Gun.getAimMode() !== 'ai') return; } catch (e) { return; }
    if (window.Stamina && !window.Stamina.canMove()) return; // catching breath
    kdAcc += dt;
    if (kdAcc < 0.4) return; // re-order 2.5x/sec — plenty for a walk
    kdAcc = 0;
    try {
      const p = window.Situation && window.Situation.snapshot ? window.Situation.snapshot() : null;
      if (!p) return;
      const n = window.Enemies && window.Enemies.nearest ? window.Enemies.nearest(p.px, p.py, 500) : null;
      if (!n) return;
      const dx = n.dx, dy = n.dy;
      if (n.dist < SAFE_MIN) {
        // too close — slide directly away, faster than the critter
        const len = Math.hypot(dx, dy) || 1;
        window.Input.order(-dx / len, -dy / len, 0.9);
      } else if (n.dist > SAFE_MAX && n.dist < ENGAGE_MAX) {
        // too far to matter — drift a bit closer so the gun stays in range
        const len = Math.hypot(dx, dy) || 1;
        window.Input.order(dx / len * 0.7, dy / len * 0.7, 0.8);
      }
    } catch (e) { /* reflexes fail silently */ }
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

  return { init, tick, thinkNow: () => think(true), orderAttack, syncButtons, note, resetMemory, setMemo, get thinking() { return thinking; } };
})();
