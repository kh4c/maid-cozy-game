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
    try { known = []; recallTarget = null; objective = null; currentTask = null; taskState = {}; huntMin = 0; followTarget = null; followExempt = false; } catch (e) {} // new life: old grudges expire
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
      if (!en || !en.nearest) return; // nothing in sight at all
      // SEE vs REACH: she sees the whole screen (~750px) but shoots shorter —
      // hostiles up to 650px (self-defense, still on-screen), calm critters
      // only to 500px AND on a FRESH order (45s). A stale "kill them" from
      // minutes ago must not mow down new packs. Otherwise: hold fire, watch.
      const d = en.nearest.dist, hot = !!en.nearest.hostile;
      const fresh = performance.now() - lastAskAt < 45000 || !!objective; // a standing quota never goes stale
      // hunt filter: a standing "worth at least N" bar. Calm small-fry under the
      // bar are beneath our bullets — hold fire even on a standing quota. Only a
      // FRESH explicit kill order (<45s) spends ammo on them deliberately.
      // Hostiles are always exempt: self-defense outranks thrift.
      if (!hot && huntMin > 0 && (en.nearest.price | 0) > 0 && (en.nearest.price | 0) < huntMin &&
          !(attackOrder && performance.now() - lastAskAt < 45000)) {
        try { window.Gun && window.Gun.aiCease && window.Gun.aiCease(); } catch (e) {}
        return;
      }
      if (hot) {
        if (d > 650) return; // hostile but far — think about it, don't spray
      } else if (d > 500 || !fresh) {
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
    const wasOnPack = following || searchDone; // capture BEFORE stop clears it
    // "actually kill those / go back" — march back. But a message that is
    // PRIMARILY a dismissal ("that group is too small, find another") must
    // not hijack itself into a recall of the same pack — dismiss wins those.
    if (RECALL_RE.test(t) && !(DISMISS_RE.test(t) && wasOnPack)) recallLast();
    // Standing orders ("keep killing until 200 coins") override the defaults —
    // parsed BEFORE stop, so an explicit stop still wins over everything.
    parseObjective(t);
    // stop FIRST — negation beats attack words ("don't kill those" = stand down)
    if (wantsStop(t)) { setAttackOrder(false, 'master said stop'); stopFollow(); stopStroll(); clearObjective(); clearTask('master said stop'); }
    else if (wantsAttack(t) && (performance.now() > recallDeadUntil || !RECALL_RE.test(t)) && !quotaSatisfied(t)) { setAttackOrder(true, 'master ordered'); lastAskAt = performance.now(); } // memo wish counts as fresh intent — unless it recalls the dead or re-orders a filled quota
    // "not big enough, find another" while she's on a pack: dismiss THIS
    // group (ignored ~3 min) and walk AWAY to look elsewhere — she must
    // never re-find the same group. Falls through to normal handling below.
    if (DISMISS_RE.test(t) && wasOnPack) dismissCurrent(tagFor(t));
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
    try {
      const gl = $('goal-line');
      if (gl) { const t = getGoalHud(); if (gl.textContent !== t) gl.textContent = t; }
    } catch (e) {}
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
      // [task:verb:arg] — ongoing behavior the model commands directly
      // (circle / patrol / goto / quota / hunt / follow-pack / clear)
      for (const m of reply.matchAll(/\[task\s*:\s*([a-z-]+)(?::\s*([^\]]+))?\]/gi)) {
        try { if (setTask(m[1], (m[2] || '').trim(), 'think')) chips.push(`📋 task ${(m[1] || '').toLowerCase()}`); } catch (e) {}
      }
    } catch (e) { /* orders are cosmetic — never break the loop */ }
    return chips;
  }
  function stripTags(s) {
    return (s || '')
      .replace(/\[(?:aim|fire|shoot|cease|run|move|stop|task)[^\]]*\]/gi, '')
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
        `SIGHT vs REACH: you SEE every on-screen critter (~750px, all listed above) but your REACH is shorter — hostiles 650px, calm 500px and only on fresh orders. Never fire past reach. ` +
        `SELF-PRESERVATION FIRST: anything hostile within ~250px is a bite threat — if HP is 4 or less, or stamina is low/exhausted, FLEE FIRST: [run:dx,dy:secs] away (negate the threat's dx,dy) and only turn to fight ([aim:nearest]+[fire]) once at 400px+. ` +
        `Running needs stamina — check it before committing to a long chase or flight. ` +
        `Calm critters → HOLD / WAIT: [cease]. Watch them, do NOT fire on your own initiative — waiting is the job. ` +
        `If you recently FOUND a pack for master (see Recent events), stay near it and keep waiting — shadowing, not shooting. ` +
        `A hunt/attack wish STAYS in force only while FRESH (master asked under a minute ago — check when the wish was set): every critter in range is a valid target. ` +
        `A STALE wish (several minutes old) against calm critters → HOLD and wait for a fresh order, do not fire. ` +
        `Critters have RARITY with coin value (common / uncommon-green / RARE-blue / EPIC-purple / LEGENDARY-gold — the snapshot lists it). Rare+ finds are announced to master already; still WAIT for orders before firing calm ones, however shiny. ` +
        `Price list, KNOW it cold (coins per kill): common 2 · uncommon 5 · rare 12 · epic 25 · legendary 60. Quote values when you report or discuss a find. ` +
        `A FRESH standing order overrides HOLD: comply while grumbling. ` +
        `KNOWN GROUPS: packs you walked away from are REMEMBERED with your opinion ("too small" / "not interested" / "saved for later" — listed in the snapshot). They stay ignored while dismissed, but if master says "actually kill those / go back / those ones", march straight back to the remembered spot and re-engage. If you arrive and the pack is gone, say so plainly. If a recall finds no live critters near the remembered spot, that pack is DEAD — say so, clear the memory, stand down, and never march to a ghost. ` +
        `COINS: kills drop coins and they are yours when you walk over them (magnet ~110px, scoop ~46px). Loose coins near you are listed in the snapshot — your feet already drift toward them when it's safe, but you may also order it. Your purse total is in the snapshot too — quote it whenever master asks about money or loot. ` +
        `STANDING OBJECTIVE (a quota, when set below): ${objectiveText()} ` +
        `TASKS (you drive the body, not scripts): for ONGOING behavior emit ONE tag [task:verb:arg] — verbs: circle[:cw|ccw] (walk in circles in place), patrol[:radius] (loop waypoints around here), goto:x,y (walk to world coords, done <80px), quota:N[:min M] (earn N coins; with min M only packs holding a critter worth M+ count — cheaper packs get pinned and skipped), hunt[:min N] (standing hunt; with min N, only packs holding a critter worth N+ coins — cheaper packs get pinned and skipped), follow-pack (shadow nearest pack), clear (drop the task). Latest task replaces the old; stop clears. Threats suspend circle/patrol/goto automatically — never micromanage that. ` +
        `CURRENT TASK: ${getTaskText()} ` +
        `HUNT FILTER: ${huntMin > 0 ? `only engage packs holding a critter worth ${huntMin}+ coins — cheaper packs are beneath our bullets: pin the spot, say so once, walk on.` : 'none.'} ` +
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
    coinSeek(dt);      // loose coins — hoover them up whenever it's safe
    objectiveTick(dt); // standing quota — never idle, never stale, finish it
    taskTick(dt);      // model-commanded task — circle/patrol/goto steering
    chatterTick(dt);   // long jobs report in — she thinks out loud
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
  let huntMin = 0; // hunt filter: only packs holding a critter worth >= this (0 = none)
  let followTarget = null; // last seen pos of the followed pack (recallable)
  let followKills0 = 0; // kill count when the shadow started — wiped = kills since
  let followExempt = false; // recalled pack: master's word outranks the filter until she leaves it
  let skipSayAt = -1e9; // throttle for the "beneath our bullets" line
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
      if (!p || !p.enemies) return;
      if (recallTarget && performance.now() > recallTarget.until) recallTarget = null; // march expired
      const avail = findAvail(p);
      if (recallTarget) {
        // marching BACK to a remembered pack — straight line, no wandering.
        // Its dismissal is lifted while the march lasts (see findAvail).
        // Packs wander while you're away: re-anchor the march on the pack's
        // LIVE position (nearest critter to the remembered spot, ~900px).
        try {
          const live = window.Enemies && window.Enemies.nearest
            ? window.Enemies.nearest(recallTarget.x, recallTarget.y, 900) : null;
          if (live) { recallTarget.x = live.x; recallTarget.y = live.y; }
        } catch (e) {}
        if (avail && nearRecall(avail.x, avail.y)) {
          const view = { total: p.enemies.total, hostile: p.enemies.hostile, nearest: avail, list: p.enemies.list };
          foundIt(view, false);
          recallTarget = null;
          followExempt = true; // marched back on master's word — the filter waits for THIS pack
          known = known.filter((k) => Math.hypot(k.x - avail.x, k.y - avail.y) > 300); // hunted now, not skipped
          return;
        }
        const dx = recallTarget.x - p.px, dy = recallTarget.y - p.py;
        const len = Math.hypot(dx, dy) || 1;
        if (len < 250) {
          // arrived — nobody here. The pack moved on.
          known = known.filter((k) => Math.hypot(k.x - recallTarget.x, k.y - recallTarget.y) > 300);
          const tag = recallTarget.tag; recallTarget = null;
          const line = `Hm... they've moved on, master. No sign of the ${tag} ones here.`;
          let said = false;
          try { said = window.Chat && window.Chat.say ? window.Chat.say(line) : false; } catch (e) { said = false; }
          if (!said) { pendingSay = line; pendingSayAcc = 0; pendingSayTries = 0; }
          note('marched back, but the pack had moved on');
          return;
        }
        if (window.Stamina && !window.Stamina.canMove()) return; // tired — hold
        try { window.Input && window.Input.order && window.Input.order(dx / len, dy / len, 1.0); } catch (e) {}
        return;
      }
      // dismissed groups don't count — first non-dismissed critter in reach.
      // Only rejects in view → keep strolling elsewhere, never re-find them.
      if (!p.enemies.nearest || !avail) return;
      const view = { total: p.enemies.total, hostile: p.enemies.hostile, nearest: avail, list: p.enemies.list };
      // hunt filter: a standing "worth at least N" bar. A pack whose BEST critter
      // is under the bar is beneath our bullets — pin the spot (recallable!) and walk on.
      if (huntMin > 0 && searchingNow()) {
        const best = bestPrize(view);
        const bestC = best ? (best.price | 0) : 0;
        if (!best || bestC < huntMin) { rememberSkip(avail, bestC); return; }
      }
      if (!searchingNow()) {
        // opportunistic: a RARE+ wandering into view gets announced + observed
        // even with no search order — she talks first, never shoots first.
        // (NOT gated by searchDone — old searches must not mute new shinies.)
        const best = bestPrize(view);
        const rank = RANK[(best && best.rarity) || 'common'] || 0;
        if (rank >= 2 && performance.now() - lastRareNote > 90000) {
          lastRareNote = performance.now();
          foundIt(view, true);
        }
        return;
      }
      if (searchDone) return;
      foundIt(view, false);
    } catch (e) {}
  }
  function foundIt(en, opportunistic) {
    searchDone = true;
    followExempt = false; // a fresh find earns no exemption — only a recall march does (set after)
    stopStroll();
    following = true;
    followLostAcc = 0;
    const n = en.nearest;
    const dir = dirWord(n.dx, n.dy);
    const best = bestPrize(en) || n;
    followTarget = { x: (best && best.x !== undefined ? best.x : n.x), y: (best && best.y !== undefined ? best.y : n.y) };
    try { followKills0 = memory.kills | 0; } catch (e) { followKills0 = 0; }
    const bDir = best && best.dx !== undefined ? dirWord(best.dx, best.dy) : dir;
    const freshOrder = performance.now() - lastAskAt < 45000;
    const feeling = huntingFeeling(best);
    const stance = en.hostile > 0
      ? `Careful, master — ${en.hostile === en.total ? 'they all look' : 'some look'} angry!`
      : (attackOrder && freshOrder)
        ? `Engaging as ordered!`
        : `I'll hold here and watch — say the word, master.`;
    const line = `*gasps, pointing ${bDir}* Found ${en.total === 1 ? 'it' : `them — ${en.total} critters`} ${distWord(n.dist)}, to the ${bDir}! ` +
      `${feeling} ${stance}`;
    try { pushEvent(`found ${en.total} critter(s) ${bDir} — best ${best.rarity} (~${packValue(en)} coins)`); } catch (e) {}
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
      if (!n || n.dist > 700 || isDismissed(n.x, n.y)) {
        // WIPED or lost? Check for survivors near where she last saw them.
        // No one breathing there → she KILLED them, not lost them: say so at
        // once (no grace-staring), with the body count. Survivors → grace, below.
        let live = null;
        try {
          const last = followTarget;
          live = last && window.Enemies && window.Enemies.nearest ? window.Enemies.nearest(last.x, last.y, 900) : null;
        } catch (e2) { live = null; }
        if (!live) {
          let wiped = 0;
          try { wiped = Math.max(0, (memory.kills | 0) - (followKills0 | 0)); } catch (e2) {}
          stopFollow();
          const line = wiped > 0
            ? `*wipes her brow, grinning* All clear, master — ${wiped} down! Coins on the ground, scooping up.`
            : `*looks around* All clear, master — nothing left standing.`;
          let said = false;
          try { said = window.Chat && window.Chat.say ? window.Chat.say(line) : false; } catch (e) { said = false; }
          if (!said) { pendingSay = line; pendingSayAcc = 0; pendingSayTries = 0; }
          showThought(`*all clear — ${wiped} down*`, ['⚔️ wiped', '💰 scooping'], 0);
          try { pushEvent(`wiped the pack she was shadowing${wiped ? ` (${wiped} kills)` : ''}`); } catch (e) {}
          return;
        }
        // pack gone — don't loiter: an empty field or a standing job means
        // move on fast (2s grace); otherwise the full 6s for stragglers.
        const total = (p && p.enemies && p.enemies.total) || 0;
        const grace = (total === 0 || objective || currentTask) ? 2 : 6;
        followLostAcc += dt;
        if (followLostAcc > grace) {
          // she shadowed them and lost them while they still LIVE — REMEMBER
          // the pack, so "actually, kill those" can march back to it.
          try {
            const last = followTarget;
            const live = last && window.Enemies && window.Enemies.nearest ? window.Enemies.nearest(last.x, last.y, 900) : null;
            if (live) {
              pruneKnown();
              const tag = huntMin > 0 ? 'too cheap' : 'left behind';
              if (!known.some((k) => Math.hypot(k.x - live.x, k.y - live.y) < 260 && (performance.now() - k.at) < 180000)) {
                known.push({ x: live.x, y: live.y, at: performance.now(), tag });
                if (known.length > 8) known.shift();
                note(`lost a living pack — remembered as [${tag}]`);
              }
            }
          } catch (e2) {}
          stopFollow();
          showThought('*…lost them in the grass. Sorry, master.*', ['👋 lost'], 0);
          try { pushEvent('lost the pack she was following'); } catch (e) {}
        }
        return;
      }
      followLostAcc = 0;
      followTarget = { x: n.x, y: n.y };
      if (window.Stamina && !window.Stamina.canMove()) return; // tired — hold position
      // hunt filter: this pack is beneath our bullets and no fresh kill order
      // says otherwise → abandon it (remembered, recallable), walk on.
      // A recalled pack is exempt: master sent her back HERE on purpose.
      if (huntMin > 0 && !followExempt && !(attackOrder && performance.now() - lastAskAt < 45000)) {
        let packBest = 0;
        try { for (const e of (p.enemies.list || [])) packBest = Math.max(packBest, e.price | 0); } catch (e2) {}
        if (packBest > 0 && packBest < huntMin) {
          try {
            pruneKnown();
            known.push({ x: n.x, y: n.y, at: performance.now(), tag: 'too cheap' });
            if (known.length > 8) known.shift();
          } catch (e2) {}
          note(`abandoned a [too cheap] pack (best ${packBest}c < ${huntMin}c bar) — spot remembered`);
          stopFollow();
          searchDone = false;
          return;
        }
      }
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
  function stopFollow() { following = false; followLostAcc = 0; followTarget = null; followExempt = false; }

  // ---- coin greed: hoover up loose coins whenever it's safe -------------------
  // Kills drop coins; they're hers when she walks over them (magnet ~110px).
  // Never interrupts a retreat (nearest critter <220px), a threat, a recall
  // march, or tired feet. While shadowing a pack she only hops to coins
  // close by (~250px) so she stays on the job; otherwise ~450px.
  let coinAcc = 0;
  function coinSeek(dt) {
    if ((window.Health && window.Health.dead) || (window.EditMode && window.EditMode.active)) return;
    if (recallTarget) return; // marching — eyes on the pack, not pennies
    if (window.Stamina && !window.Stamina.canMove()) return;
    coinAcc += dt;
    if (coinAcc < 0.5) return;
    coinAcc = 0;
    try {
      const p = window.Situation && window.Situation.snapshot ? window.Situation.snapshot() : null;
      if (!p) return;
      if (p.enemies && p.enemies.hostile > 0) return; // threat — no pocket money now
      const n = p && p.enemies && p.enemies.nearest;
      if (n && n.dist < 220) return; // too close — deal with the critter first
      if (!window.Inventory || !window.Inventory.dropsNear) return;
      const range = following ? 250 : 450;
      const found = window.Inventory.dropsNear(p.px, p.py, range);
      if (!found || !found.nearest) return;
      const c = found.nearest, len = c.dist || 1;
      window.Input.order(c.dx / len, c.dy / len, 0.8);
    } catch (e) { /* butterfingers fail silently */ }
  }

  // ---- standing objectives: quotas override the defaults ------------------------
  // "keep finding and killing until we earn 200 coins" is not a mood, it is a
  // JOB. While it stands: freshness never expires, the search re-arms after
  // every wiped pack, and the purse is checked actively. Completes itself at
  // target (stands down + reports); an explicit stop or death drops it.
  // Hierarchy: latest explicit command > standing objective > defaults.
  let objective = null; // { kind: 'coins', target } | { kind: 'hunt' }
  function purseNow() {
    try { return (window.Inventory && window.Inventory.state ? window.Inventory.state().coins : 0) | 0; } catch (e) { return 0; }
  }
  function sayUnlessBusy(line) {
    // mid-exchange the LLM reply carries the news; otherwise speak / queue.
    let chatBusy = false;
    try { chatBusy = !!(window.Chat && window.Chat.isBusy && window.Chat.isBusy()); } catch (e) {}
    if (chatBusy) return;
    let said = false;
    try { said = window.Chat && window.Chat.say ? window.Chat.say(line) : false; } catch (e) { said = false; }
    if (!said) { pendingSay = line; pendingSayAcc = 0; pendingSayTries = 0; }
  }
  function setObjective(o) {
    objective = o;
    try { objective.milestone = 0; } catch (e) {} // progress chatter starts fresh
    if (!objective) return;
    setAttackOrder(true, 'standing objective');
    lastAskAt = performance.now();
    searchDone = false;
    const line = objective.kind === 'coins'
      ? `*cracks her knuckles* ${objective.target} coins? Quota accepted — I'll keep hunting till the purse says ${objective.target}, master!`
      : `*cracks her knuckles* A standing hunt? I won't stop till you say so, master!`;
    note(`standing objective set: ${objective.kind === 'coins' ? 'earn ' + objective.target + ' coins' : 'hunt indefinitely'}`);
    sayUnlessBusy(line);
  }
  function clearObjective() {
    if (!objective) return;
    objective = null;
    note('standing objective dropped — master said stop');
  }
  function quotaSatisfied(t) {
    // a hunt-wish phrased as a quota ("keep hunting until 300 coins") must not
    // re-latch after the purse already covers it — this is how stale/late
    // intent echoes kept the slaughter going past the target.
    const m = String(t || '').toLowerCase().match(/(\d+)\s*coins?/);
    if (!m || !/(until|earn|quota|till)/.test(String(t || '').toLowerCase())) return false;
    return purseNow() >= parseInt(m[1], 10);
  }
  let lastQuotaDone = { target: 0, at: -1e9 }; // finished quota — its echoes are ignored ~2 min
  function parseObjective(t) {
    // "keep finding and killing until we earn 200 coins" / "hunt till 50 coins"
    const m = String(t || '').toLowerCase().match(/(\d+)\s*coins?/);
    if (m && /(until|earn|quota|till|to\s+\d+\s*coins)/.test(t) && /(until|earn|make|get|reach|quota|till|keep)/.test(t)) {
      const target = Math.max(1, parseInt(m[1], 10));
      if (target === lastQuotaDone.target && performance.now() - lastQuotaDone.at < 120000) return; // stale echo of the finished job — ignore
      if (!objective || objective.kind !== 'coins' || objective.target !== target) setObjective({ kind: 'coins', target });
      return;
    }
    // "change the goal to 200" — bare-number retarget while a quota stands
    const g = String(t || '').toLowerCase().match(/(goal|target|quota)[^\d]{0,20}(\d+)|change[^\d]{0,20}(\d+)\s*coins?/);
    if (g && objective && objective.kind === 'coins') {
      const target = Math.max(1, parseInt(g[2] || g[3], 10));
      if (target === lastQuotaDone.target && performance.now() - lastQuotaDone.at < 120000) return;
      if (objective.target !== target) setObjective({ kind: 'coins', target });
      return;
    }
    if (/(keep|continue)\s+\w*\s*(finding|killing|hunting|searching)/.test(t)) {
      if (!objective || objective.kind !== 'hunt') setObjective({ kind: 'hunt' });
    }
  }
  function objectiveTick(dt) {
    if (!objective) return;
    if ((window.Health && window.Health.dead) || (window.EditMode && window.EditMode.active)) return;
    try {
      if (objective.kind === 'coins') {
        const purse = purseNow();
        // progress chatter at 25/50/75% — she thinks out loud while working
        const marks = [0.25, 0.5, 0.75];
        const mi = objective.milestone | 0;
        if (mi < marks.length && purse >= objective.target * marks[mi]) {
          objective.milestone = mi + 1;
          sayUnlessBusy(`*wipes her brow, grinning* ${Math.round(marks[mi] * 100)}% there, master — ${purse}/${objective.target} coins!`);
        }
        if (purse >= objective.target) {
          const done = objective.target; objective = null;
          lastQuotaDone = { target: done, at: performance.now() };
          if (currentTask && currentTask.verb === 'quota') clearTask('quota filled');
          // neutralize the standing wish too — otherwise the old "keep killing"
          // memo keeps the think-model emitting [fire] after the job is done.
          memo = { text: 'Quota filled — standing down unless master orders otherwise.', from: '', at: performance.now() };
          setAttackOrder(false, 'quota filled');
          stopFollow(); stopStroll();
          note(`quota filled — purse at ${purse}, standing down`);
          sayUnlessBusy(`*counts coins, grinning* ${done} coins! Quota filled, master — standing down.`);
          return;
        }
      }
      // standing order never idles: re-arm the search after every wiped pack
      if (!following && !recallTarget) {
        searchDone = false;
        if (!strollDir && window.Stamina && window.Stamina.canMove()) beginStroll();
      }
    } catch (e) {}
  }
  function objectiveText() {
    // long form for the think prompt — the LLM reasons AND talks quota progress
    if (!objective) return 'No standing objective — one pack at a time, defaults apply.';
    if (objective.kind === 'coins') {
      const purse = purseNow(), need = Math.max(0, objective.target - purse);
      return `EARN ${objective.target} COINS — purse now ${purse}, ${need} to go. This OVERRIDES the defaults: keep finding + killing pack after pack until filled; do NOT stop after one group; freshness never expires while the quota stands. When filled: stand down, report, stop firing.`;
    }
    return 'KEEP FINDING + KILLING indefinitely until master says stop — overrides one-pack defaults; re-arm the search after every wipe; freshness never expires.';
  }
  function getObjectiveText() {
    // short form for the snapshot (both minds) — '' when nothing stands
    if (!objective) return '';
    if (objective.kind === 'coins') {
      const purse = purseNow(), need = Math.max(0, objective.target - purse);
      return `earn ${objective.target} coins (purse ${purse}, ${need} to go) — keep hunting pack after pack.`;
    }
    return 'keep finding + killing until told to stop.';
  }

  // ---- tasks: the MODEL drives the body, not regexes -----------------------------
  // Closed verb vocabulary the LLM may command via [task:verb:arg] (think tags)
  // or task=[[verb args]] (chat intent line). Latest task replaces the old;
  // stop clears. circle/patrol/goto steer the feet every 0.5s; quota/hunt/
  // follow-pack wire into the existing standing systems. Threats suspend the
  // movement verbs automatically — survival first, performance later.
  const TASK_DEFS = { circle: 1, patrol: 1, goto: 1, quota: 1, hunt: 1, 'follow-pack': 1 };
  let currentTask = null; // { verb, arg, at, src }
  let taskState = {};     // per-task runtime (circle angle, patrol waypoints…)
  let taskAcc = 0;
  function setTask(verb, arg, src) {
    verb = String(verb || '').toLowerCase().trim();
    if (verb === 'clear') { clearTask('ordered'); return true; }
    if (!TASK_DEFS[verb]) { note(`unknown task verb "${verb}" — ignored`); return false; }
    currentTask = { verb, arg: String(arg || '').trim(), at: performance.now(), src: src || 'model' };
    taskState = {};
    // movement verbs take the feet: kill any older walk order
    if (verb === 'circle' || verb === 'patrol' || verb === 'goto') { try { stopStroll(); } catch (e) {} }
    if (verb === 'quota') {
      const qm = String(currentTask.arg || '').match(/min(?:imum|price)?\s*(\d+)/);
      const qmin = qm ? Math.max(1, parseInt(qm[1], 10)) : 0;
      const n = parseInt(currentTask.arg, 10);
      if (n > 0) setObjective({ kind: 'coins', target: n });
      else { note('quota task without a number — ignored'); currentTask = null; huntMin = 0; return false; }
      huntMin = qmin;
      if (huntMin > 0) note(`quota filter: only packs with a critter worth ≥${huntMin}c count toward the ${n}c quota`);
    }
    else if (verb === 'hunt') {
      const mm = String(currentTask.arg || '').match(/min(?:imum|price)?\s*(\d+)/);
      huntMin = mm ? Math.max(1, parseInt(mm[1], 10)) : 0;
      if (huntMin > 0) note(`hunt filter: only packs with a critter worth ≥${huntMin}c (cheaper ones get noted and skipped)`);
      if (!objective) setObjective({ kind: 'hunt' });
    }
    else if (verb === 'follow-pack') { if (!following && !strollDir) { try { beginStroll(); } catch (e) {} } }
    else { if (huntMin > 0) note('hunt filter lifted — it rode with the hunt task'); huntMin = 0; }
    note(`task: ${verb}${currentTask.arg ? ' ' + currentTask.arg : ''} (${currentTask.src})`);
    return true;
  }
  function clearTask(why) {
    if (!currentTask) return;
    currentTask = null; taskState = {}; huntMin = 0;
    note(`task cleared (${why || 'done'})`);
  }
  function getTaskText() {
    if (!currentTask) return 'none — body is hers minute to minute.';
    const age = Math.max(0, Math.round((performance.now() - currentTask.at) / 1000));
    return `${currentTask.verb}${currentTask.arg ? ' ' + currentTask.arg : ''} (set ${age}s ago by ${currentTask.src})`;
  }
  function taskTick(dt) {
    if (!currentTask) return;
    if ((window.Health && window.Health.dead) || (window.EditMode && window.EditMode.active)) return;
    if (window.Stamina && !window.Stamina.canMove()) return;
    const v = currentTask.verb;
    if (v === 'quota' || v === 'hunt') return; // objective system drives those
    if (v === 'follow-pack') {
      // standing behavior like a quota: re-arm after every wipe
      if (!following && !recallTarget) {
        searchDone = false;
        if (!strollDir && window.Stamina.canMove()) { try { beginStroll(); } catch (e) {} }
      }
      return;
    }
    try {
      const p = window.Situation && window.Situation.snapshot ? window.Situation.snapshot() : null;
      if (!p) return;
      if (p.enemies && p.enemies.hostile > 0) return; // threats suspend performance
      const n = p.enemies && p.enemies.nearest;
      if (n && n.dist < 220) return; // too close — reflexes own the feet
      taskAcc += dt;
      if (taskAcc < 0.5) return;
      taskAcc = 0;
      if (v === 'circle') {
        const dir = /ccw|counter/.test(currentTask.arg) ? -1 : 1;
        taskState.a = (taskState.a || 0) + dir * 0.7;
        window.Input.order(Math.cos(taskState.a), Math.sin(taskState.a), 0.6);
      } else if (v === 'patrol') {
        if (!taskState.cx) { taskState.cx = p.px; taskState.cy = p.py; taskState.wi = 0; }
        const r = Math.max(120, parseInt(currentTask.arg, 10) || 300);
        const wps = [[1, 0], [0, 1], [-1, 0], [0, -1]].map(([x, y]) => [taskState.cx + x * r, taskState.cy + y * r]);
        const wp = wps[taskState.wi % 4];
        const dx = wp[0] - p.px, dy = wp[1] - p.py, len = Math.hypot(dx, dy) || 1;
        if (len < 80) { taskState.wi++; return; }
        window.Input.order(dx / len, dy / len, 0.6);
      } else if (v === 'goto') {
        const m = currentTask.arg.match(/(-?\d+)\s*[,\s]\s*(-?\d+)/);
        if (!m) { clearTask('bad coordinates'); return; }
        const dx = (+m[1]) - p.px, dy = (+m[2]) - p.py, len = Math.hypot(dx, dy) || 1;
        if (len < 80) {
          clearTask('arrived');
          sayUnlessBusy('*stops, looking around* Here, master — right where you pointed.');
          return;
        }
        window.Input.order(dx / len, dy / len, 0.6);
      }
    } catch (e) {}
  }

  // ---- chatter: she thinks out loud while working --------------------------------
  // Long jobs go quiet otherwise — every ~55s of active work she reports in:
  // quota tally, task status, the watch. Never interrupts a fight, never cuts
  // in line ahead of something important (pendingSay), never backlogs.
  let chatterAcc = 0;
  function chatterTick(dt) {
    chatterAcc += dt;
    if (chatterAcc < 55) return;
    chatterAcc = 0;
    if ((window.Health && window.Health.dead) || (window.EditMode && window.EditMode.active)) return;
    if (pendingSay) return; // something important waiting — don't cut in
    try {
      const p = window.Situation && window.Situation.snapshot ? window.Situation.snapshot() : null;
      if (!p) return;
      if (p.enemies && p.enemies.hostile > 0) return; // busy fighting — shoot, don't chat
      let line = null;
      if (objective && objective.kind === 'coins') line = `*counts on her fingers* ${purseNow()}/${objective.target} coins, master — still hunting!`;
      else if (objective) line = `*sniffing the air* Still on the hunt, master — ${memory.kills} down this life.`;
      else if (currentTask && currentTask.verb === 'circle') line = `*still spinning* Circling, master — say when you're dizzy!`;
      else if (currentTask && currentTask.verb === 'patrol') line = `*scanning the grass* Patrolling... all quiet so far.`;
      else if (currentTask && currentTask.verb === 'goto') line = `*marching* On my way, master!`;
      else if (following) line = `*crouched, watching* Still watching them... waiting on your word.`;
      else return;
      sayUnlessBusy(line);
    } catch (e) {}
  }

  // ---- known groups: dismissed packs are REMEMBERED, not forgotten -----------
  // "not interested / too small, find another" tags the pack with her opinion
  // and ignores it ~3 min — but the spot stays in memory ~5 min, so "actually,
  // kill those / go back / those ones" can march her back to it. Old entries
  // age out on their own; death clears everything (new life, fresh eyes).
  let known = []; // [{ x, y, at, tag }]
  let recallTarget = null; // { x, y, until, tag } — marching back to a remembered pack
  const RECALL_RE = /(actually|after all|second thought|chang(?:e|ed|ing)(?: my| the)? mind|go back|those (ones|guys|runts|critters|group|pack)|that (group|pack)|them anyway|fine[,.]?\s*(kill|get))/;
  const DISMISS_RE = /(another|other group|not big|too small|different|bigger|elsewhere|not (good|worth)|skip (this|these|them)|leave (them|it|these)|not interested|don't want|do not want)/;
  function pruneKnown() {
    const now = performance.now();
    known = known.filter((k) => now - k.at < 5 * 60 * 1000);
  }
  function isDismissed(x, y) {
    pruneKnown();
    const now = performance.now();
    return known.some((k) => (now - k.at) < 180000 && Math.hypot(k.x - x, k.y - y) < 260);
  }
  function nearRecall(x, y) {
    // the recalled pack's dismissal is lifted while the march lasts
    if (!recallTarget || performance.now() > recallTarget.until) return false;
    return Math.hypot(recallTarget.x - x, recallTarget.y - y) < 300;
  }
  function tagFor(text) {
    // her opinion of the pack, from master's words — stored with the memory
    const t = String(text || '').toLowerCase();
    if (/(not worth|too cheap|cheap|waste.*bullet|save.*ammo|low.*ammo)/.test(t)) return 'too cheap';
    if (/(not big|too small|small|runt|tiny|weak)/.test(t)) return 'too small';
    if (/(not interested|don't care|do not care|boring|meh|pass|don't want|do not want)/.test(t)) return 'not interested';
    if (/(later|save|keep them|spare)/.test(t)) return 'saved for later';
    return 'skipped';
  }
  function findAvail(p) {
    // first critter in reach that counts: not dismissed — unless it's the
    // recalled pack she's marching back to (dismissal lifted for that one)
    try {
      for (const e of (p.enemies.list || [])) {
        if (e.dist <= 650 && (!isDismissed(e.x, e.y) || nearRecall(e.x, e.y))) return e;
      }
    } catch (e) {}
    return null;
  }
  function dismissCurrent(tag) {
    try {
      const p = window.Situation && window.Situation.snapshot ? window.Situation.snapshot() : null;
      const n = p && p.enemies && p.enemies.nearest;
      const opinion = tag || 'too small';
      if (n) {
        pruneKnown();
        known.push({ x: n.x, y: n.y, at: performance.now(), tag: opinion });
        if (known.length > 8) known.shift();
      }
      stopFollow();
      searchDone = false; // re-arm: allowed to find a DIFFERENT group
      // walk AWAY from the rejects, then keep strolling elsewhere
      if (p && n) {
        let dx = p.px - n.x, dy = p.py - n.y;
        const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
        strollDir = { x: dx, y: dy }; strollAcc = 0;
        try { window.Input.order(dx, dy, 2.5); } catch (e) {}
      } else beginStroll();
      const line = `*turns up her nose* ${opinion === 'too small' ? 'These runts' : 'These ones'}? As you wish — leaving them behind. (But I'll remember where they den, master, in case you change your mind!)`;
      let said = false;
      try { said = window.Chat && window.Chat.say ? window.Chat.say(line) : false; } catch (e) { said = false; }
      if (!said) { pendingSay = line; pendingSayAcc = 0; pendingSayTries = 0; }
      try { pushEvent(`dismissed a [${opinion}] pack — looking elsewhere, spot remembered`); } catch (e) {}
    } catch (e) {}
  }
  let recallDeadUntil = -1e9; // a recall that found only corpses blocks re-latch ~2 min
  function liveMemory() {
    // freshest remembered pack that still has LIVE critters near its spot.
    // Eyes beat memory: a wiped pack is not a target, however fresh the grudge.
    pruneKnown();
    try {
      const sorted = known.slice().sort((a, b) => b.at - a.at);
      for (const g of sorted) {
        let live = null;
        try { live = window.Enemies && window.Enemies.nearest ? window.Enemies.nearest(g.x, g.y, 900) : null; } catch (e) {}
        if (live) return g;
      }
    } catch (e) {}
    return null;
  }
  function recallStatus(text) {
    // for chat.js: 'not-recall' | 'live' | 'dead' — so chat never orders
    // an attack on a ghost, and the persona knows before she opens her mouth.
    if (!RECALL_RE.test(String(text || '').toLowerCase())) return 'not-recall';
    return liveMemory() ? 'live' : 'dead';
  }
  function recallLast() {
    // master changed their mind — march back, but ONLY to the living.
    const g = liveMemory();
    if (!g) {
      // every group she met is dead (or long gone) — say so plainly, march
      // nowhere, and block the attack latch so "OK, killing them" can't follow.
      known = [];
      recallTarget = null;
      recallDeadUntil = performance.now() + 120000;
      note('master recalled a pack, but every group is dead — stood down');
      const line = `*lowers her gun, looking around* That group? Master... we already wiped them. Nothing left but grass and their coins.`;
      // say it herself ONLY if chat is idle — mid-exchange the grounded LLM
      // reply already refuses; don't parrot it twice via the retry queue.
      let chatBusy = false;
      try { chatBusy = !!(window.Chat && window.Chat.isBusy && window.Chat.isBusy()); } catch (e) {}
      if (!chatBusy) {
        let said = false;
        try { said = window.Chat && window.Chat.say ? window.Chat.say(line) : false; } catch (e) { said = false; }
        if (!said) { pendingSay = line; pendingSayAcc = 0; pendingSayTries = 0; }
      }
      return;
    }
    recallTarget = { x: g.x, y: g.y, until: performance.now() + 90000, tag: g.tag };
    stopFollow(); stopStroll(); searchDone = false;
    note(`recalling the [${g.tag}] group — marching back`);
    const line = `Those ${g.tag} ones? I remember where they den — turning back, master!`;
    let said = false;
    try { said = window.Chat && window.Chat.say ? window.Chat.say(line) : false; } catch (e) { said = false; }
    if (!said) { pendingSay = line; pendingSayAcc = 0; pendingSayTries = 0; }
  }
  // A skipped (too-cheap) pack gets a [too cheap] memory pin so "actually,
  // kill those" can march straight back to it. Chatter throttled to 60s.
  function rememberSkip(e, bestC) {
    try {
      pruneKnown();
      if (!known.some((k) => Math.hypot(k.x - e.x, k.y - e.y) < 260 && (performance.now() - k.at) < 180000)) {
        known.push({ x: e.x, y: e.y, at: performance.now(), tag: 'too cheap' });
        if (known.length > 8) known.shift();
      }
      note(`skipped a [too cheap] pack (best ${bestC}c < ${huntMin}c bar) — spot remembered`);
      if (searchingNow() && performance.now() - skipSayAt > 60000) {
        skipSayAt = performance.now();
        let skipLine = `*sniffs, unimpressed* Pocket change — best ${bestC} coins, beneath our bullets. Moving on.`;
        try { if (objective && objective.kind === 'coins') skipLine += ` (The ${objective.target}-coin quota still stands, master — nothing out here clears our bar.)`; } catch (e) {}
        sayUnlessBusy(skipLine);
      }
    } catch (err) {}
  }
  function getGoalHud() {
    // one-liner for the HUD: her OVERALL goal + CURRENT task, plain words.
    // Goal = standing objective (survives task swaps); task = latest verb.
    try {
      const bits = [];
      if (objective) {
        if (objective.kind === 'coins') bits.push(`🎯 ${purseNow()}/${objective.target}c`);
        else bits.push('🎯 hunt on');
      }
      if (currentTask) bits.push(`📋 ${currentTask.verb}${currentTask.arg ? ' ' + currentTask.arg : ''}`);
      else if (!objective) return '💤 idle';
      if (huntMin > 0 && !/min/.test(currentTask ? (currentTask.arg || '') : '')) bits.push(`min ${huntMin}+`);
      return bits.join(' · ') || '💤 idle';
    } catch (e) { return '💤 idle'; }
  }
  function getKnownText(px, py) {
    // one-liner for the snapshot so BOTH minds know the remembered packs
    pruneKnown();
    try {
      return known.map((k) => {
        const dx = k.x - px, dy = k.y - py;
        return `"${k.tag}" ~${Math.round(Math.hypot(dx, dy))}px ${dirWord(dx, dy)}`;
      }).join('; ');
    } catch (e) { return ''; }
  }

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
      const n = window.Enemies && window.Enemies.nearest ? window.Enemies.nearest(p.px, p.py, 650) : null;
      if (!n) return;
      const dx = n.dx, dy = n.dy;
      if (n.dist < SAFE_MIN) {
        // too close — slide directly away, faster than the critter
        const len = Math.hypot(dx, dy) || 1;
        window.Input.order(-dx / len, -dy / len, 0.9);
      } else if (n.hostile && n.dist > 500) {
        // threat on screen but past gun reach — close in so she can fight it
        const len = Math.hypot(dx, dy) || 1;
        window.Input.order(dx / len * 0.7, dy / len * 0.7, 0.8);
      } else if (!n.hostile && n.dist > SAFE_MAX && n.dist <= ENGAGE_MAX) {
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

  return { init, tick, thinkNow: () => think(true), orderAttack, syncButtons, note, resetMemory, setMemo, getKnownText, getGoalHud, recallStatus, getObjectiveText, setTask, clearTask, getTaskText, get thinking() { return thinking; } };
})();
