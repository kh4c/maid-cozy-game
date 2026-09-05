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
    try { attackScope = 'blanket'; } catch (e) {}
    try { stopFollow(); } catch (e) {}
    try { known = []; recallTarget = null; objective = null; currentTask = null; taskState = {}; followTarget = null; target = null; lastSwitchAt = -1e9; } catch (e) {} // new life: old grudges expire
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
  let lastKillWordAt = -1e9; // last EXPLICIT kill word ("kill them", "shoot it", "kill the blue") — only THESE spend ammo under the hunt bar; standing objectives re-arming freshness does NOT

  // ---- attack-mode latch ------------------------------------------------------
  // A kill order (or an attack wish in the memo) flips this on: while ANY
  // critter is alive in range she keeps aiming + firing WITHOUT waiting for
  // the LLM — so packs that wander in mid-slaughter get shot too, not
  // politely ignored until the next think. Cleared by a stop-memo or death.
  let attackOrder = false;
  let atkAcc = 0;
  let attackScope = 'blanket'; // 'blanket' = any critter in reach dies; 'surgical' = ONLY the target latch authorizes fire
  // ---- surgical target: "kill the BLUE one" names ONE color, not the pack ----
  // The model decides (chat memo or [target:] tag), the code executes: only
  // that rarity/id dies, everything else lives — even after the pack goes
  // hostile from the shooting (the latch sits ABOVE the blanket hostile
  // branch). Cleared by stop, quota fill, a blanket order, or the moment no
  // target-color critter is left in view (reported honestly either way).
  let target = null; // { rarity|null, id|null, word, seen }
  const COLOR2RARITY = { blue: 'rare', green: 'uncommon', purple: 'epic', gold: 'legendary', yellow: 'legendary', gray: 'common', grey: 'common', common: 'common', uncommon: 'uncommon', rare: 'rare', epic: 'epic', legendary: 'legendary' };
  function rarityWord(r) { return { common: 'gray', uncommon: 'green', rare: 'blue', epic: 'purple', legendary: 'gold' }[r] || r; }
  function cleanColorWord(w) {
    let r = String(w || '').toLowerCase().replace(/s$/, '');
    if (r === 'legendarie') r = 'legendary';
    return r;
  }
  function parseTarget(t) {
    // "kill/shoot the blue one", "only the green ones", "take down the gold"
    const s = String(t || '').toLowerCase();
    if (wantsStop(s)) return false; // negations never latch ("don't shoot the blue")
    const m = s.match(/(kill|shoot|attack|fire\s+at|take\s+down|pop|destroy|wipe)(?:[^.!?]{0,40}?)\b(blues?|greens?|purples?|golds?|yellows?|grays?|greys?|commons?|uncommons?|rares?|epics?|legendarys?|legendaries)\b/) ||
      s.match(/(only|just)\s+the\s+(blues?|greens?|purples?|golds?|yellows?|grays?|greys?|commons?|uncommons?|rares?|epics?|legendarys?|legendaries)\b/);
    if (!m) return false;
    const word = cleanColorWord(m[2]);
    const rarity = COLOR2RARITY[word];
    if (!rarity) return false;
    target = { rarity, id: null, word, seen: false };
    // a color match IS an attack order — surgical-only authorization, so the
    // blanket never inherits it ("take down" isn't even in ATTACK_RE)
    setAttackOrder(true, 'surgical order');
    lastAskAt = performance.now();
    lastKillWordAt = performance.now(); // explicit word: spends under the bar
    attackScope = 'surgical';
    note(`surgical target: only the ${word} (${rarity}) — rest of the pack lives`);
    sayUnlessBusy(`*narrows her eyes, tracking* The ${word} one? She's mine, master — the rest can run.`);
    return true;
  }
  function resolveTargetRef(ref) {
    // color/rarity/id word → nearest matching LIVE entry, or null
    try {
      const p = window.Situation && window.Situation.snapshot ? window.Situation.snapshot() : null;
      const list = (p && p.enemies && p.enemies.list) || [];
      const r = cleanColorWord(ref);
      if (/^p\d+c\d+$/.test(r)) return list.find((e) => e && e.id === r) || null;
      const rar = COLOR2RARITY[r] || (/^(common|uncommon|rare|epic|legendary)$/.test(r) ? r : null);
      if (!rar) return null;
      let best = null;
      for (const e of list) { if (!e || e.rarity !== rar) continue; if (!best || e.dist < best.dist) best = e; }
      return best;
    } catch (e) { return null; }
  }
  function getTargetText() {
    if (!target) return '';
    return target.id ? `only [${target.id}] — everything else lives` : `only the ${target.word} (${target.rarity}) — rest of the pack lives`;
  }
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
      // SEE vs REACH: she sees the whole screen (rect — corners included) but shoots shorter —
      // hostiles up to 650px (self-defense, still on-screen), calm critters
      // only to 500px AND on a FRESH order (45s). A stale "kill them" from
      // minutes ago must not mow down new packs. Otherwise: hold fire, watch.
      const d = en.nearest.dist, hot = !!en.nearest.hostile;
      const fresh = performance.now() - lastAskAt < 45000 || !!objective; // a standing quota never goes stale
      if (target) {
        // SURGICAL: master named one color — only that rarity/id dies. Same
        // REACH rules as the blanket (hostiles 650, calm 500 + fresh/quota) — no
        // worth bar: money is money. Nothing matching in view → cease, drop the
        // latch, report honestly. Shooting the blue alerts the pack (survivors go
        // hostile) but the latch HOLDS — greens live anyway.
        const match = (e) => e && (target.id ? e.id === target.id : e.rarity === target.rarity);
        let best = null;
        try {
          for (const e of (en.list || [])) {
            if (!match(e)) continue;
            const dd = e.dist, hh = !!e.hostile;
            if (hh ? dd > 650 : (dd > 500 || !fresh)) continue;
            if (!best || dd < best.dist) best = e;
          }
        } catch (e) {}
        if (best) {
          target.seen = true;
          try { window.Gun && window.Gun.aiAimAt && window.Gun.aiAimAt(best.x, best.y, 1); } catch (e) {}
          try { const st = window.Gun.status(); if (!st.firing) window.Gun.aiFire(1); } catch (e) {}
          return;
        }
        if (!best) {
          try { window.Gun && window.Gun.aiCease && window.Gun.aiCease(); } catch (e) {}
          const w = target.word || rarityWord(target.rarity) || 'target';
          const line = target.seen
            ? `*lowers her gun, nodding* ${w[0].toUpperCase() + w.slice(1)} down, master — the rest live unless you say otherwise.`
            : `*squints around* I don't see any ${w} one in view, master — point me at them?`;
          target = null;
          // the surgical word authorized ONLY the target: no quota standing →
          // stand the gun down too, or the leftover blanket order mows the
          // greens she just promised live. Quota standing → it resumes blanket.
          if (objective) attackScope = 'blanket';
          else if (attackScope === 'surgical') setAttackOrder(false, 'surgical target down');
          sayUnlessBusy(line);
          return;
        }
        try { window.Gun && window.Gun.aiCease && window.Gun.aiCease(); } catch (e) {}
        return; // target visible but out of reach — hold, latch stays
      }
      // money is money: no worth bar on the blanket — calm + in reach + fresh
      // order/quota/hunt means fire, whatever the price tag says.
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
    // Surgical color target ("kill the blue one") — parsed with the standing
    // orders; stop/blanket handling below decides whether the latch survives.
    const gotTarget = parseTarget(t);
    // stop FIRST — negation beats attack words ("don't kill those" = stand down)
    if (wantsStop(t)) { setAttackOrder(false, 'master said stop'); stopFollow(); stopStroll(); clearObjective(); clearTask('master said stop'); target = null; }
    else if (wantsAttack(t) && (performance.now() > recallDeadUntil || !RECALL_RE.test(t)) && !quotaSatisfied(t)) { setAttackOrder(true, 'master ordered'); lastAskAt = performance.now(); lastKillWordAt = performance.now(); attackScope = gotTarget ? 'surgical' : 'blanket'; if (!gotTarget) target = null; } // memo wish counts as fresh intent — unless it recalls the dead or re-orders a filled quota; a blanket order drops any surgical latch
    // "not big enough, find another" while she's on a pack: dismiss THIS
    // group (ignored ~3 min) and walk AWAY to look elsewhere — she must
    // never re-find the same group. Falls through to normal handling below.
    if (DISMISS_RE.test(t) && wasOnPack) dismissCurrent(tagFor(t));
    // movement wishes start the stroll even with no direction known
    if (/(find|look for|search|go|wander|explore|patrol|somewhere|anywhere)/.test(t) && !/(stop|don.t|cease)/.test(t)) beginStroll();
    // MONEY IS MONEY: worth-picking ("only worth 5+", "most valuable", "skip the
    // cheap ones") gets an answer, not a filter — she says so and kills them all
    // anyway. No bar is ever set; find or kill, nothing in between. (Stop wins:
    // a stop-word in the same breath means stop, not banter.)
    const WORTH_RE = /(worth\s+(at least|more than|over|[0-9])|at least\s+[0-9]|most valuable|only.*(worth|valuable)|pick.*(valuable|rich|worth)|skip.*(cheap|small|poor))/;
    if (WORTH_RE.test(t) && !STOP_RE.test(t)) {
      const lines = [
        `*counts an imaginary coin, scoffing* Money is money, master — I'm not leaving coins on the ground for snobbery! We kill them ALL.`,
        `*snorts* Pick only the rich ones? Master, a coin is a coin! Small, big — they all die the same.`,
        `*waves a hand* Worth-schmorth! Every critter pays, master — leave the picking to the purse.`,
      ];
      try { sayUnlessBusy(lines[(askCount | 0) % lines.length]); } catch (e) {}
    }
    if (/(find|look for|search)/.test(t) && !objective && !wantsAttack(t)) {
      setObjective({ kind: 'find' });
      note('find goal: report everything, hold fire');
    }
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
  const SENSE_R = 500;    // legacy circle — eyes are the screen rect now (see senseView); kept for fallback only
  const SAFE_MIN = 170;   // back away inside this (bite is 42px — plenty of margin)
  function senseRadius() { return SENSE_R; } // fallback only — the snapshot list is already screen-filtered

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
      // [aim:nearest:secs] — steered by a surgical latch when one stands
      for (const m of reply.matchAll(/\[aim\s*:\s*nearest(?::\s*([\d.]+))?\]/gi)) {
        const secs = num(m[1], 3);
        let ok = false;
        try {
          if (target) {
            // latch owns the muzzle: nearest OF THE TARGET, never a protected green
            const b = resolveTargetRef(target.id || target.rarity);
            if (b && window.Gun.aiAimAt) { window.Gun.aiAimAt(b.x, b.y, secs); ok = true; chips.push(`🎯 track-${target.word || target.id}`); }
            else chips.push('🎯 no-target');
          } else if (window.Gun && window.Gun.aiAimNearest) {
            ok = window.Gun.aiAimNearest(secs);
            chips.push(ok ? '🎯 track-nearest' : '🎯 no-target');
          }
        } catch (e) { chips.push('🎯 no-target'); }
      }
      // [aim:<color|rarity|id>:secs] — transient surgical aim (one-shot point)
      for (const m of reply.matchAll(/\[aim\s*:\s*(blues?|greens?|purples?|golds?|yellows?|grays?|greys?|commons?|uncommons?|rares?|epics?|legendarys?|legendaries|p\d+c\d+)\s*(?::\s*([\d.]+))?\]/gi)) {
        try {
          const b = resolveTargetRef(m[1]);
          if (b && window.Gun.aiAimAt) { window.Gun.aiAimAt(b.x, b.y, num(m[2], 3)); chips.push(`🎯 aim-${String(m[1]).toLowerCase()}`); }
          else chips.push('🎯 no-target');
        } catch (e) {}
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
      // [target:<color|rarity|id>] — persistent surgical latch (combatDrive
      // obeys: only that color dies); [target:clear] drops to blanket fire
      for (const m of reply.matchAll(/\[target\s*:\s*([a-z0-9]+)\]/gi)) {
        try {
          const w = String(m[1]).toLowerCase();
          if (w === 'clear' || w === 'none' || w === 'off') {
            if (target) note('surgical target cleared by the think-model');
            target = null; chips.push('🎯 target-clear');
          } else {
            const r = cleanColorWord(w);
            if (/^p\d+c\d+$/.test(r)) { target = { rarity: null, id: r, word: r, seen: false }; note(`surgical target: only [${r}]`); chips.push(`🎯 target-${r}`); }
            else if (COLOR2RARITY[r]) { target = { rarity: COLOR2RARITY[r], id: null, word: r, seen: false }; note(`surgical target: only the ${r} (${COLOR2RARITY[r]})`); chips.push(`🎯 target-${r}`); }
          }
        } catch (e) {}
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
      .replace(/\[(?:aim|fire|shoot|cease|run|move|stop|task|target)[^\]]*\]/gi, '')
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
    lastKillWordAt = performance.now(); // explicit command: spends under the bar
    setAttackOrder(true, 'ordered'); // latch: keep shooting at new spawns too
    attackScope = 'blanket'; // explicit attack commands are pack-wide
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
        `SIGHT vs REACH: you SEE every on-screen critter (screen rect, corners included — all listed above) but your REACH is shorter — hostiles 650px, calm 500px and only on fresh orders. Never fire past reach. ` +
        `A named-color kill (Target line above, or master's "kill the blue one") is SURGICAL: track ONLY that color with [aim:<color|rarity|id>:secs] — never [aim:nearest] (nearest may be a protected green). The gun holds the latch itself; your tags just help aim, or [target:<color>] to set it / [target:clear] to release it. Bullets splash ~44px: a neighbor shoulder-to-shoulder may catch sparks — that is ballistics, not disobedience; warn master if it happens. No target color listed → [cease]. ` +
        `SELF-PRESERVATION FIRST: anything hostile within ~250px is a bite threat — if HP is 4 or less, or stamina is low/exhausted, FLEE FIRST: [run:dx,dy:secs] away (negate the threat's dx,dy) and only turn to fight ([aim:nearest]+[fire]) once at 400px+. ` +
        `Running needs stamina — check it before committing to a long chase or flight. ` +
        `Calm critters → HOLD / WAIT: [cease]. Watch them, do NOT fire on your own initiative — waiting is the job. ` +
        `If you recently FOUND a pack for master (see Recent events), stay near it and keep waiting — shadowing, not shooting. ` +
        `A hunt/attack wish STAYS in force only while FRESH (master asked under a minute ago — check when the wish was set): every critter in range is a valid target. ` +
        `A STALE wish (several minutes old) against calm critters → HOLD and wait for a fresh order, do not fire. ` +
        `Critters have RARITY with coin value (common / uncommon-green / RARE-blue / EPIC-purple / LEGENDARY-gold — the snapshot lists it). Rare+ finds are announced to master already; still WAIT for orders before firing calm ones, however shiny. ` +
        `Price list, KNOW it cold (coins per kill): common 2 · uncommon 5 · rare 12 · epic 25 · legendary 60. Quote values when you report or discuss a find. ` +
        `Critters are labeled [id] + outline COLOR in the Enemies list (gray=common, green=uncommon, blue=RARE, purple=EPIC, gold=LEGENDARY). "The blue one" = the RARE — aim by color, rarity, or [id], never by "the second one" (list order shifts as they move). ` +
        `A FRESH standing order overrides HOLD: comply while grumbling. ` +
        `KNOWN GROUPS: packs you walked away from are REMEMBERED with your opinion ("too small" / "not interested" / "saved for later" — listed in the snapshot). They stay ignored while dismissed, but if master says "actually kill those / go back / those ones", march straight back to the remembered spot and re-engage. If you arrive and the pack is gone, say so plainly. If a recall finds no live critters near the remembered spot, that pack is DEAD — say so, clear the memory, stand down, and never march to a ghost. ` +
        `COINS: kills drop coins and they are yours when you walk over them (magnet ~110px, scoop ~46px). Loose coins near you are listed in the snapshot — your feet already drift toward them when it's safe, but you may also order it. Your purse total is in the snapshot too — quote it whenever master asks about money or loot. ` +
        `STANDING OBJECTIVE (a quota, when set below): ${objectiveText()} ` +
        `TASKS (you drive the body, not scripts): for ONGOING behavior emit ONE tag [task:verb:arg] — verbs: circle[:cw|ccw] (walk in circles in place), patrol[:radius] (loop waypoints around here), goto:x,y (walk to world coords, done <80px), quota:N (earn N coins — every critter counts, money is money), hunt (standing hunt: kill every pack till stop), find (locate + report + shadow, NO shooting), follow-pack (shadow nearest pack), clear (drop the task). Latest task replaces the old; stop clears. Threats suspend circle/patrol/goto automatically — never micromanage that. ` +
        `CURRENT TASK: ${getTaskText()} ` +
        `MONEY IS MONEY: no worth bar exists — every critter counts, common or legendary. If master asks to pick only high-worth prey, say so playfully ("money is money!") and kill them all anyway. ` +
        `ANNOYANCE LEVEL: ${annoyance()} — ${annoyanceFlavor(annoyance())}\n` +
        `${memoText()}\n` +
        `SESSION MEMORY (this life only):\n${memoryText()}\n` +
        `Output: 1-2 SHORT sentences of thought (first person, scout voice, under 25 words) ` +
        `PLUS action tags. Tags (world deltas: x east+, y south+): [aim:dx,dy:secs] or [aim:nearest:secs], [aim:<color|rarity|id>:secs], [target:<color|rarity|id>], [target:clear], ` +
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
      near = !!(snap.enemies && snap.enemies.total > 0); // eyes = screen: anything listed is seen
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
  let newsQueue = []; // announcements the dialog missed: { text } or { facts, fallback }. Cap 4 — oldest drops, newest always wins.
  let newsBusy = false; // an announce() generation is in flight — pump waits, never overlaps
  function queueNews(item) {
    try { item.at = performance.now(); } catch (e) {}
    newsQueue.push(item);
    if (newsQueue.length > 4) newsQueue.shift();
  }
  function chatFree() {
    // dialog usable right now? busy exchange, mid-typewriter, dead, edit — all wait
    try {
      if (window.Health && window.Health.dead) return false;
      if (window.EditMode && window.EditMode.active) return false;
      if (window.Chat && window.Chat.isBusy && window.Chat.isBusy()) return false;
      if (window.Chat && window.Chat.isSpeaking && window.Chat.isSpeaking()) return false;
      return true;
    } catch (e) { return false; }
  }
  function newsPump() {
    // every tick: if news waits AND the dialog is free, deliver ONE (serial —
    // generations never overlap, typewriter never clobbers). Failures stay
    // queued: nothing is ever silently dropped, it just waits its turn.
    if (newsBusy || !newsQueue.length || !chatFree()) return;
    const item = newsQueue[0];
    const done = (ok) => { newsBusy = false; if (ok) newsQueue.shift(); };
    try {
      if (item.facts && window.Chat && typeof window.Chat.announce === 'function') {
        newsBusy = true;
        const ageS = Math.round((performance.now() - (item.at || performance.now())) / 1000);
        const facts = ageS > 8 ? Object.assign({}, item.facts, { aged: ageS }) : item.facts;
        window.Chat.announce(facts, item.fallback).then(done).catch(() => done(false));
      } else if (window.Chat && window.Chat.say) {
        let ok = false;
        try { ok = !!window.Chat.say(item.text || item.fallback); } catch (e) { ok = false; }
        if (ok) newsQueue.shift();
      } else newsQueue.shift(); // no chat surface at all — drop, don't wedge the queue
    } catch (e) { newsBusy = false; }
  }
  let followTarget = null; // last seen pos of the followed pack (recallable)
  let followKills0 = 0; // kill count when the shadow started — wiped = kills since
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
    return `Just commons, a coin or two each — pocket change, but money is money.`;
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
    if (d < 600) return 'over there';
    return 'a way off';
  }
  // Pan helper: glance at (x,y) ONLY when it's off the player's screen.
  // On-screen finds need no camera move (direction words carry them); recall
  // destinations can sit ~900px away in memory, not in eyes — show those.
  function panIfOffscreen(x, y, secs) {
    try {
      const cam = window.__maidCamera;
      const r = cam && cam.viewRect ? cam.viewRect() : null;
      if (!r) return false;
      if (Math.abs(x - r.x) < r.hw - 40 && Math.abs(y - r.y) < r.hh - 40) return false;
      if (cam.lookAt) cam.lookAt(x, y, secs || 2.5);
      return true;
    } catch (e) { return false; }
  }
  function searchingNow() {
    if (strollDir) return true;
    try { return /find|search/i.test(memo.text); } catch (e) { return false; }
  }
  function searchWatch(dt) {
    newsPump(); // queued announcements drain whenever the dialog is free — even mid-shadow
    if ((window.Health && window.Health.dead) || (window.EditMode && window.EditMode.active)) return;
    try {
      const p = window.Situation && window.Situation.snapshot ? window.Situation.snapshot() : null;
      if (!p || !p.enemies) return;
      if (recallTarget && performance.now() > recallTarget.until) recallTarget = null; // march expired
      if (following) { switchWatch(p); return; } // shadowing A: only a clearly better pack interrupts (below)
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
          if (!said) queueNews({ text: line });
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
      // money is money: every visible pack counts — no worth bar, no skipping.
      // FEET OWNERSHIP: a movement task (circle/patrol/goto) owns her feet —
      // a wander-in pack must NOT hijack it into a FOUND + shadow (approach
      // orders would fight the performance every 0.5s, goto could never
      // arrive). Reflexes (combatDrive/keep-distance) still guard her, the
      // snapshot still lists every visible pack for the think-model, and the
      // skip-memory above keeps pinning cheap packs. Order [task:clear] or a
      // kill to engage instead.
      if (movingTask()) return;
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
  let lastSwitchAt = -1e9; // anti-thrash: at most one shadow-switch per ~20s
  function switchWatch(p) {
    // Shadowing pack A while pack B walks into view: only a CLEARLY CLOSER
    // prize interrupts (150px+ nearer). Worth never decides — money is money.
    // Never off an explicit kill: a fresh kill word or a surgical latch means
    // obedience beats opportunism. A movement task owns the feet — never here.
    try {
      if (movingTask()) return;
      if (!followTarget) return;
      if (target) return; // surgical latch: master's color order, hands off
      if (attackOrder && performance.now() - lastKillWordAt < 45000) return; // fresh kill word: hands off
      if (performance.now() - lastSwitchAt < 20000) return;
      const avail = findAvail(p);
      if (!avail) return;
      const aDist = Math.hypot(followTarget.x - p.px, followTarget.y - p.py);
      const bDist = avail.dist | 0;
      if ((aDist - bDist) <= 150) return;
      lastSwitchAt = performance.now();
      const bDir = dirWord(avail.dx, avail.dy);
      const bVal = (avail.price) | 0;
      followTarget = { x: avail.x, y: avail.y };
      followLostAcc = 0; followAcc = 0;
      try { followKills0 = memory.kills | 0; } catch (e2) {}
      searchDone = true;
      const gap = Math.round(aDist - bDist);
      const why = gap > 300 ? 'much closer' : 'closer';
      const line = `*turns, pointing ${bDir}* Heads up, master — another pack ${distWord(bDist)}, to the ${bDir}, ${why}. Leaving these for the better prize!`;
      try { pushEvent(`switched shadow to a ${why} pack ${bDir}`); } catch (e2) {}
      queueNews({
        facts: { total: p.enemies.total, dir: bDir, dist: distWord(bDist), distPx: bDist, bestRarity: avail.rarity || 'common', bestColor: rarityWord(avail.rarity || 'common'), bestPrice: bVal, hostile: p.enemies.hostile, ordered: false, switched: why, prev: `the old pack (${distWord(aDist)})` },
        fallback: line,
      });
      showThought(`*switching shadow — ${why}*`, ['🔎 better pack', `💰 ~${packValue(p)}`], 0);
    } catch (e) {}
  }
  function foundIt(en, opportunistic) {
    searchDone = true;
    stopStroll();
    following = true;
    followLostAcc = 0;
    const n = en.nearest;
    panIfOffscreen(n.x, n.y, 2.5); // usually a no-op (finds are on-screen by construction) — fires for genuinely off-screen ones
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
    // NOTE: no camera pan here anymore. Rect-eyes mean the found pack is
    // on-screen by construction — panning would shove OTHER visible packs out
    // of the rect (phantom "lost") and yank the click-to-move surface.
    // Direction words ("to the north-east") carry the where.
    // Generated found-line goes through the NEWS QUEUE (serial, never dropped —
    // the pump speaks them one at a time whenever the dialog is free). If an
    // earlier find is still waiting its turn, carry it as comparison so she
    // reports which pack is closer and which she'd take first.
    let prev = null;
    try {
      for (let i = newsQueue.length - 1; i >= 0; i--) {
        const f = newsQueue[i] && newsQueue[i].facts;
        if (f && !f.switched) { prev = f; break; }
      }
    } catch (e) {}
    const facts = { total: en.total, dir: bDir, dist: distWord(n.dist), distPx: n.dist | 0, bestRarity: best.rarity || 'common', bestColor: rarityWord(best.rarity || 'common'), bestPrice: best.price || 2, hostile: en.hostile, ordered: !!(attackOrder && performance.now() - lastAskAt < 45000) };
    if (prev) {
      facts.prev = `${prev.total || 1} to the ${prev.dir || '?'} (${prev.dist || 'nearby'})`;
      facts.compare = `the new one is ${distWord(n.dist)} vs ${prev.dist || 'nearby'} before — say which is closer and which you'd take first`;
    }
    queueNews({ facts, fallback: line });
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
          if (!said) queueNews({ text: line });
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
              const tag = 'left behind';
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
  function stopFollow() { following = false; followLostAcc = 0; followTarget = null; }

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
  let objective = null; // { kind: 'coins', target } | { kind: 'hunt' } | { kind: 'find' }
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
    if (!said) queueNews({ text: line });
  }
  function setObjective(o) {
    objective = o;
    try { objective.milestone = 0; } catch (e) {} // progress chatter starts fresh
    if (!objective) return;
    if (objective.kind === 'find') {
      // FIND is locate + report + shadow — it does NOT arm the trigger.
      // (A standing kill order keeps its own lifecycle; stop still clears all.)
      searchDone = false;
      note('standing objective set: find');
      sayUnlessBusy(`*salutes* Eyes open, master — I'll find them and report back. No shooting till you say so!`);
      return;
    }
    setAttackOrder(true, 'standing objective');
    attackScope = 'blanket'; // quotas hunt the pack, not one color
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
      // "keep killing/hunting" = HUNT; bare "keep finding/searching" = FIND (no trigger)
      if (/(killing|hunting)/.test(t)) { if (!objective || objective.kind !== 'hunt') setObjective({ kind: 'hunt' }); }
      else if (!objective || objective.kind !== 'find') setObjective({ kind: 'find' });
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
          target = null; // any surgical latch dies with the quota
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
    if (objective.kind === 'find') return `FIND critters — locate + announce + shadow each pack; HOLD fire on calm packs (this goal arms nothing); hostiles still self-defend; re-arm the search after every wipe/loss; stands until master says stop. If several packs are visible, compare distance + best value and recommend which to take first — master picks, you hold.`;
    return 'KEEP FINDING + KILLING indefinitely until master says stop — overrides one-pack defaults; re-arm the search after every wipe; freshness never expires.';
  }
  function getObjectiveText() {
    // short form for the snapshot (both minds) — '' when nothing stands
    if (!objective) return '';
    if (objective.kind === 'coins') {
      const purse = purseNow(), need = Math.max(0, objective.target - purse);
      return `earn ${objective.target} coins (purse ${purse}, ${need} to go) — keep hunting pack after pack.`;
    }
    if (objective.kind === 'find') return `find critters — locate + report + shadow, HOLD fire unless master orders or they turn hostile.`;
    return 'keep finding + killing until told to stop.';
  }

  // ---- tasks: the MODEL drives the body, not regexes -----------------------------
  // Closed verb vocabulary the LLM may command via [task:verb:arg] (think tags)
  // or task=[[verb args]] (chat intent line). Latest task replaces the old;
  // stop clears. circle/patrol/goto steer the feet every 0.5s; quota/hunt/
  // follow-pack wire into the existing standing systems. Threats suspend the
  // movement verbs automatically — survival first, performance later.
  const TASK_DEFS = { circle: 1, patrol: 1, goto: 1, quota: 1, hunt: 1, find: 1, 'follow-pack': 1 };
  let currentTask = null; // { verb, arg, at, src }
  let taskState = {};     // per-task runtime (circle angle, patrol waypoints…)
  let taskAcc = 0;
  function setTask(verb, arg, src) {
    verb = String(verb || '').toLowerCase().trim();
    if (verb === 'clear') { clearTask('ordered'); return true; }
    if (!TASK_DEFS[verb]) { note(`unknown task verb "${verb}" — ignored`); return false; }
    currentTask = { verb, arg: String(arg || '').trim(), at: performance.now(), src: src || 'model' };
    taskState = {};
    // movement verbs take the feet: kill any older walk order — including an
    // active shadow. The task IS the latest command; the pack stays listed in
    // the snapshot so the think-model can still order an engagement.
    if (verb === 'circle' || verb === 'patrol' || verb === 'goto') { try { stopStroll(); } catch (e) {} try { stopFollow(); } catch (e) {} }
    if (verb === 'quota') {
      const n = parseInt(currentTask.arg, 10);
      if (n > 0) setObjective({ kind: 'coins', target: n });
      else { note('quota task without a number — ignored'); currentTask = null; return false; }
    }
    else if (verb === 'hunt') {
      // HUNT arms the trigger for everything — money is money, no min arg read
      if (!objective) setObjective({ kind: 'hunt' });
    }
    else if (verb === 'find') {
      // model-ordered FIND: locate + report, trigger stays OFF (same as memo finds)
      if (!objective) setObjective({ kind: 'find' });
    }
    else if (verb === 'follow-pack') { if (!following && !strollDir) { try { beginStroll(); } catch (e) {} } }
    note(`task: ${verb}${currentTask.arg ? ' ' + currentTask.arg : ''} (${currentTask.src})`);
    return true;
  }
  function clearTask(why) {
    if (!currentTask) return;
    currentTask = null; taskState = {};
    searchDone = false; // feet are free again — a visible pack may re-found
    note(`task cleared (${why || 'done'})`);
  }
  function movingTask() {
    // feet-owning performance verbs — while one stands, searchWatch must not
    // FOUND hijack it, and a recall march clears it (latest command wins feet)
    return !!(currentTask && /^(circle|patrol|goto)$/.test(currentTask.verb));
  }
  function getTaskText() {
    if (!currentTask) return 'none — body is hers minute to minute.';
    const age = Math.max(0, Math.round((performance.now() - currentTask.at) / 1000));
    const busy = movingTask() ? ' — feet are busy performing; visible packs will NOT auto-found (reflexes still guard her), order or clear to engage' : '';
    return `${currentTask.verb}${currentTask.arg ? ' ' + currentTask.arg : ''} (set ${age}s ago by ${currentTask.src})${busy}`;
  }
  function taskTick(dt) {
    if (!currentTask) return;
    if ((window.Health && window.Health.dead) || (window.EditMode && window.EditMode.active)) return;
    if (window.Stamina && !window.Stamina.canMove()) return;
    const v = currentTask.verb;
    if (v === 'quota' || v === 'hunt' || v === 'find') return; // objective system drives those
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
  // in line ahead of something important (queued news), never backlogs.
  let chatterAcc = 0;
  function chatterTick(dt) {
    chatterAcc += dt;
    if (chatterAcc < 55) return;
    chatterAcc = 0;
    if ((window.Health && window.Health.dead) || (window.EditMode && window.EditMode.active)) return;
    if (newsQueue.length || newsBusy) return; // something important waiting — don't cut in
    try {
      const p = window.Situation && window.Situation.snapshot ? window.Situation.snapshot() : null;
      if (!p) return;
      if (p.enemies && p.enemies.hostile > 0) return; // busy fighting — shoot, don't chat
      let line = null;
      if (objective && objective.kind === 'coins') line = `*counts on her fingers* ${purseNow()}/${objective.target} coins, master — still hunting!`;
      else if (objective && objective.kind === 'find') line = `*sniffing the air* Still searching, master — eyes open, no shot yet.`;
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
    // first VISIBLE critter that counts: the snapshot list is already the
    // screen rect, so no distance cap — corners count too. Excludes dismissed
    // packs, unless it's the recalled pack she's marching back to.
    try {
      for (const e of (p.enemies.list || [])) {
        if (!isDismissed(e.x, e.y) || nearRecall(e.x, e.y)) return e;
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
      if (!said) queueNews({ text: line });
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
        if (!said) queueNews({ text: line });
      }
      return;
    }
    recallTarget = { x: g.x, y: g.y, until: performance.now() + 90000, tag: g.tag };
    panIfOffscreen(g.x, g.y, 2.5); // the den can sit ~900px away in memory, not in eyes — glance at it while turning back
    stopFollow(); stopStroll(); searchDone = false;
    if (movingTask()) clearTask('recall march takes the feet'); // latest explicit command wins feet
    note(`recalling the [${g.tag}] group — marching back`);
    const line = `Those ${g.tag} ones? I remember where they den — turning back, master!`;
    let said = false;
    try { said = window.Chat && window.Chat.say ? window.Chat.say(line) : false; } catch (e) { said = false; }
    if (!said) queueNews({ text: line });
  }
  function getGoalHud() {
    // one-liner for the HUD: her OVERALL goal + CURRENT task, plain words.
    // Goal = standing objective (survives task swaps); task = latest verb.
    try {
      const bits = [];
      if (objective) {
        if (objective.kind === 'coins') bits.push(`🎯 ${purseNow()}/${objective.target}c`);
        else if (objective.kind === 'find') bits.push('🔎 finding…');
        else bits.push('🎯 hunt on');
      }
      if (currentTask) bits.push(`📋 ${currentTask.verb}${currentTask.arg ? ' ' + currentTask.arg : ''}`);
      if (target) bits.push(`🎯 ${target.word || target.id}`);
      if (!bits.length) return '💤 idle';
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
      // eyes = the screen rect (what you see is what she sees); circular fallback for tests
      let n = null;
      try {
        const vc = window.__maidCamera && window.__maidCamera.viewCenter ? window.__maidCamera.viewCenter() : null;
        if (window.Enemies && vc && window.Enemies.nearestView) n = window.Enemies.nearestView(p.px, p.py, vc.x, vc.y, 640, 360);
        else if (window.Enemies && window.Enemies.nearest) n = window.Enemies.nearest(p.px, p.py, 650);
      } catch (e) { n = null; }
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

  return { init, tick, thinkNow: () => think(true), orderAttack, syncButtons, note, resetMemory, setMemo, getKnownText, getGoalHud, getTargetText, recallStatus, getObjectiveText, setTask, clearTask, getTaskText, get thinking() { return thinking; } };
})();
