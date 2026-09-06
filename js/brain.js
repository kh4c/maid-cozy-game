// Maid survival brain — SEPARATE from chat. Chat is conversation; this is
// the tactical sub-mind that decides fight / flight using the same local LLM.
// Its thoughts appear in their own dialog box (#thought-box), never in chat.
//
// Loop: main.js calls Brain.tick(dt) every frame. When danger is near
// (hostile OR critter on screen), it thinks every brainInterval seconds —
// always; guarding herself is what she does, not a toggle. 💭 thinks on
// demand. 🎯 button flips aim authority. Orders execute via Gun/Input tags:
//   [mode:find|hunt|heel] [fire:secs] [cease]
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
    try { stopStroll(); } catch (e) {} // new life: legs stop too — no march carries over
    try { objective = { kind: 'find' }; objectiveMaster = false; searchDone = false; memoMode = null; leaveSpot = null; followTarget = null; try { reportedPacks.clear(); } catch (e2) {} lastSwitchAt = -1e9; lastRareNote = -1e9; memo = { text: 'Eyes open — finding, master.', from: '', at: -1e9 }; } catch (e) {} // new life: back to finding, no grudges, no memory, fresh eyes
    askCount = 0; lastAskAt = -1e9; lastKillWordAt = -1e9; // new life: annoyance clock resets too
     try { memory.events.push(`(new life — ${reason})`); } catch (e) {}
  }
  // note('kill', n) / note('hurt') / note('flee') — called by gun/health/main
  // Lifetime kills persist in localStorage ('cosette.totalKills') and paint the
  // HUD kill panel. HUD-only: the total NEVER enters speech or the think
  // prompt (no lifetime totals, ever — per-pack numbers with units only).
  const KILL_STORE = 'cosette.totalKills';
  const HUNTER_STORE = 'cosette.hunterKills';
  let lifetimeKills = 0, lifetimeHunters = 0;
  try {
    lifetimeKills = Math.max(0, parseInt(localStorage.getItem(KILL_STORE), 10) || 0);
    lifetimeHunters = Math.max(0, parseInt(localStorage.getItem(HUNTER_STORE), 10) || 0);
  } catch (e) {}
  function paintKills(which) {
    // which: 'critter' | 'hunter' bumps that counter; false/undefined = quiet repaint
    try {
      const pairs = [['kill-count', lifetimeKills, which === 'critter'], ['hunter-count', lifetimeHunters, which === 'hunter']];
      for (const [id, v, bump] of pairs) {
        const el = $(id);
        if (!el) continue;
        const t = String(v);
        if (el.textContent !== t) el.textContent = t;
        if (bump) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
      }
    } catch (e) {}
  }
  function note(kind, n) {
    try {
      if (kind === 'kill') {
        const k = Math.max(1, Number(n) || 1);
        memory.kills += k;
        lifetimeKills += k; // session math stays in memory.kills; this one survives reloads
        try { localStorage.setItem(KILL_STORE, String(lifetimeKills)); } catch (e) {}
        paintKills('critter');
        askCount = Math.max(0, askCount - 1); // venting: each kill settles one gripe
        pushEvent(`popped ${Math.max(1, Number(n) || 1)} critter(s)`);
      } else if (kind === 'hunterkill') {
        // lone-hunter kills NEVER touch the critter counter — own panel, own store
        const k = Math.max(1, Number(n) || 1);
        memory.kills += k; // session math counts every kill; the panels split by kind
        lifetimeHunters += k;
        try { localStorage.setItem(HUNTER_STORE, String(lifetimeHunters)); } catch (e) {}
        paintKills('hunter');
        pushEvent('brought down the lone hunter');
      } else if (kind === 'hurt') {
        memory.hurt += 1;
        pushEvent(`took a bite (${memory.hurt} hearts lost today)`);
      } else if (kind === 'flee') {
        memory.fled += 1;
        pushEvent('ran from a pack');
      } else if (kind === 'tired') {
        pushEvent('ran out of breath and had to rest');
        genLine('tired', {}, `*doubled over, panting* Master... legs gave out — need a breath...`);
      } else if (kind === 'rested') {
        pushEvent('caught her breath and is moving again');
        genLine('rested', {}, `*straightening up, breathing easy* Breath caught, master — back on my feet.`);
      } else if (kind === 'resting') {
        pushEvent('parked at a quarter tank to rest her legs');
        genLine('resting', {}, `*easing off, hands on knees* Legs are getting heavy, master — resting a moment before I run them empty.`);
      } else if (kind === 'trip') {
        pushEvent('tripped over her own tired feet and ate dirt');
        // no voice: the sprite bubble over her head says "ahh!" (main.js) —
        // trips never enter the dialog.
      } else if (kind === 'urged') {
        // master told her to work through the rest (any words — regex or [push]
        // tag): memory only, no chatter — her chat reply already answers him.
        // The think prompt carries this, so the tactic KNOWS the rest was overridden.
        pushEvent(`master urged her on — working through the rest on his word`);
      }
    } catch (e) { /* memory is cosmetic */ }
  }
  function pushEvent(t) {
    if (memory.events.length && memory.events[memory.events.length - 1] === t) return; // no repeat-stamping
    memory.events.push(t);
    if (memory.events.length > 6) memory.events = memory.events.slice(-6);
  }
  function memoryText() {
    const mins = Math.max(0, Math.round((performance.now() - memory.bornAt) / 60000));
    const ev = memory.events.length ? memory.events.slice(-4).map((e) => '· ' + e).join('\n') : '· nothing yet';
    return `This life (${mins} min): ${memory.hurt} bites taken, ${memory.fled} retreats.\nRecent:\n${ev}`;
  }

  // ---- order pressure: asks wear her down FAST (user tuned: easily convinced) --
  // First ask: grumble but likely do it. Second ask / any kill order twice:
  // fully caves. Kills vent one step; the counter resets with each new life.
  let askCount = 0;        // un-vented attack asks
  let lastAskAt = -1e9;    // ms
  const ASK_DECAY_MS = 90000; // one gripe cools every 90s without a new ask
  let lastKillWordAt = -1e9; // last EXPLICIT kill word ("kill them", "shoot it") — only THESE authorize fire on calm packs without hunt mode

  // ---- attack-mode latch ------------------------------------------------------
  // A kill order (or an attack wish in the memo) flips this on: while ANY
  // critter is alive in range she keeps aiming + firing WITHOUT waiting for
  // the LLM — so packs that wander in mid-slaughter get shot too, not
  // politely ignored until the next think. Cleared by a stop-memo or death.
  let attackOrder = false; // true while a fresh kill order / hunt posture stands — drives the prompt + HUD, never the trigger alone
  let atkAcc = 0;
  // No choosing: the gun never picks WHICH critter dies. Authorization is
  // posture-only (hostile / fresh kill words / hunt mode) — identity never is.
  function rarityWord(r) { return { common: 'gray', uncommon: 'green', rare: 'blue', epic: 'purple', legendary: 'gold' }[r] || r; }
  // ring words for reports: species beats tier (a rare hunter is red-ringed)
  function ringWord(e) {
    try {
      if (e && e.outline) return e.outline;
      if (e && e.pack === 'lone') return 'red';
    } catch (_) {}
    return rarityWord(e && e.rarity);
  }
  // live combat card: quoted into the think prompt so hit/speed facts can never
  // go stale — retune enemies.js or gun.js and her instincts update
  function combatCard() {
    try {
      if (window.Enemies && window.Enemies.combatFacts) return window.Enemies.combatFacts();
    } catch (_) {}
    return 'Facts: rifle range ~' + (window.Gun && window.Gun.rangePx ? window.Gun.rangePx() : 840) +
      'px, ' + (window.Gun && window.Gun.bulletDamage ? window.Gun.bulletDamage() : 4) +
      ' damage per bullet. PACKS: groups of 3-5 grazers, 3-10hp (3-10 hits each), chase at 95. HUNTERS: always alone, 7-14hp (7-14 hits each), chase at 150. She runs 300 — she outruns both. Bite = 1 heart at 42px. Open grassland, no cover.\n';
  }
  // live price line: same rule — the prompt quotes it, never a frozen copy
  function priceCard() {
    try {
      if (window.Enemies && window.Enemies.priceListText) return 'Price list, KNOW it cold: ' + window.Enemies.priceListText() + ' Quote values when you report or discuss a find. ';
    } catch (_) {}
    return 'Price list, KNOW it cold (coins per kill): common 2 · uncommon 5 · rare 12 · epic 25 · legendary 60. Quote values when you report or discuss a find. ';
  }
  function combatDrive(dt) {
    // Trigger discipline — the code half of the KILL DOCTRINE in the think
    // prompt: hold ONLY while a hostile is in reach (self-defense — doubt ends
    // where teeth begin) or a fresh order / hunt posture stands. Species changes
    // ONE thing: golden giltboars (main quarry) fire freely in reach even calm.
    // It changes HER THOUGHT about the rest (doubt for critters, none for hunters).
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
      // An ORDER is a latch, not a clock: fresh = the order is standing
      // (attackOrder) AND not stale (45s) — or a hunt posture (never stale).
      // Stop clears attackOrder → the gun stops even if the ask was 5s ago.
      const fresh = attackOrder && (performance.now() - lastAskAt < 45000 || (objective && (objective.kind === 'hunt' || objective.kind === 'coins'))); // hunt/quota postures never go stale; find/heel never authorize
      // money is money: calm + in reach + (fresh words or hunt mode) means fire — whatever the price tag says, whichever critter. No choosing.
      // Main-quarry exception: a calm GILTBOAR in reach needs no orders — golden body, free-fire.
      const gilt = !!(en.nearest.species && en.nearest.species === 'giltboar');
      if (hot) {
        if (d > 650) return; // hostile but far — think about it, don't spray
      } else if (d > 500 || (!fresh && !gilt)) {
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
  let memo = { text: 'Eyes open — finding, master.', from: '', at: -1e9 }; // boot default is FINDING, not idle watch
  // Negation-aware: "don't kill / do not shoot / stop / no more /
  // stand down / come here / rest" always wins over attack words — telling
  // her NOT to kill must never latch hunting mode on. ("Leave them / not
  // interested / find another" carve OUT below — those walk away, not down.)
  const STOP_RE = /(stop|cease|\bdon[’']t\b|\bdo not\b|\bnot\b|\bno more\b|never mind|stand down|come here|\brest\b|hold fire|hold your fire)/;
  const ATTACK_RE = /(kill|attack|shoot|hunt|fire|destroy|wipe|clear|blast)/;
  function wantsStop(t) { return STOP_RE.test(t); }
  function wantsAttack(t) { return ATTACK_RE.test(t) && !STOP_RE.test(t); }
  // LEAVE-words disengage from the pack in eyes — stop shadow, stop firing,
  // walk away, one invisible 60s spot cooldown. They do NOT stand the maid
  // down and they file NOTHING: no pins, no memory, no recall.
  const LEAVE_RE = /(leave\s+(them|it|these|those|that)|find\s+another|not\s+interested|walk\s+away|go\s+away|never\s+mind\s+(them|those|that|it))/;
  const HEEL_RE = /(heel|stay\s+(close|here|put|with\s+me)|hold\s+position|wait\s+here)/;
  let memoMode = null; // posture the master's last words expressed (find/hunt/heel), or null
  let leaveSpot = null; // {x,y,until} — invisible 60s no-re-announce after leaving
  function leftSpot(x, y) {
    return !!(leaveSpot && performance.now() < leaveSpot.until && Math.hypot(leaveSpot.x - x, leaveSpot.y - y) < 260);
  }
  function leavePack(why, silent) {
    if (!following && !searchDone && !attackOrder) return;
    stopFollow();
    setAttackOrder(false, 'left the pack');
    try {
      const p = window.Situation && window.Situation.snapshot ? window.Situation.snapshot() : null;
      const n = p && p.enemies && p.enemies.nearest;
      if (p && n) {
        const dx0 = p.px - n.x, dy0 = p.py - n.y, len0 = Math.hypot(dx0, dy0) || 1;
        strollDir = { x: dx0 / len0, y: dy0 / len0 }; strollAcc = 0;
        try { window.Input.order(strollDir.x, strollDir.y, 2.5); } catch (e) {}
      } else beginStroll();
      if (n && n.x != null) leaveSpot = { x: n.x, y: n.y, until: performance.now() + 60000 };
      try { if (n && n.x != null && window.Enemies && window.Enemies.dismissNear) window.Enemies.dismissNear(n.x, n.y); } catch (e) {} // tagged — wanders off instead of trailing her
    } catch (e) {}
    searchDone = false; // re-arm: a DIFFERENT pack may found; the left one just cools down, unfiled
    note(`left the pack (${why || 'master said so'}) — walking away, no pin, no memory`);
    if (!silent) genLine('leave', {}, '*nods, lowering her gun* Leaving them be, master — walking on.');
  }
  function setMemo(text, from) {
    memo = { text: String(text || '').slice(0, 240), from: String(from || '').slice(0, 120), at: performance.now() };
    pushEvent(`master's wish noted: ${memo.text.slice(0, 60)}`);
    const t = memo.text.toLowerCase();
    const wasOnPack = following || searchDone; // capture BEFORE stop clears it
    memoMode = null;
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
      try { sayUnlessBusy('money-banter', {}, lines[(askCount | 0) % lines.length]); } catch (e) {}
    }
    if (wantsStop(t) && !LEAVE_RE.test(t)) {
      // Full stop: posture cleared, trigger released, feet stilled. LEAVE-words
      // carve out — "leave them / not interested / find another" walks away
      // from THIS pack instead of standing her down.
      setAttackOrder(false, 'master said stop'); stopFollow(); stopStroll(); clearObjective();
      note('master said stop: attack cleared, follow + stroll stopped, posture cleared');
      return;
    }
    // Standing postures — hunt-family words always commit (even over find);
    // FIND only fills a vacancy; HEEL always holds. Quota words ("earn 300
    // coins", "keep killing until 200") are a COINS job: hunt standing + purse
    // watched, stands down + reports when filled.
    const qm = t.match(/(\d+)\s*coins?/);
    if (qm && /(until|earn|quota|till|to\s+\d+\s*coins)/.test(t) && /(until|earn|make|get|reach|quota|till|keep)/.test(t)) {
      const target = Math.max(1, parseInt(qm[1], 10));
      if (!(target === lastQuotaDone.target && performance.now() - lastQuotaDone.at < 120000)) { setObjective({ kind: 'coins', target }); objectiveMaster = true; memoMode = 'hunt'; }
    }
    else if (HEEL_RE.test(t)) { setObjective({ kind: 'heel' }); objectiveMaster = true; memoMode = 'heel'; }
    else if (/(keep|continue)\s+\w*\s*(killing|hunting)/.test(t) || /hunt\s+them/.test(t)) { setObjective({ kind: 'hunt' }); objectiveMaster = true; memoMode = 'hunt'; }
    else if (/(find|look for|search)/.test(t) && (!objective || !objectiveMaster) && !wantsAttack(t)) {
      setObjective({ kind: 'find' }); objectiveMaster = true;
      memoMode = 'find';
      note('find goal: report everything, hold fire');
    }
    if (wantsAttack(t)) {
      // blanket by doctrine: "kill the blue one" kills the pack — no choosing,
      // no latch, no color parsing. Explicit words authorize calm packs in reach.
      setAttackOrder(true, 'master ordered'); lastAskAt = performance.now(); lastKillWordAt = performance.now();
    }
    if (LEAVE_RE.test(t) && (wasOnPack || wantsStop(t))) { leavePack(memo.text.slice(0, 80)); return; }
    if (!wantsAttack(t) && RECALL_RE.test(t)) {
      // No memory anymore: "those ones / go back" with no attack words means
      // the pack in EYES — and if none is visible, the only honest move is
      // asking which ones she means.
      let vis = false;
      try { const e = window.Enemies && window.Enemies.nearest ? window.Enemies.nearest(window.__maid.x, window.__maid.y, 500) : null; vis = !!(e && e.dist != null && e.dist < 500); } catch (e2) {}
      if (!vis) sayUnlessBusy('which-ones', {}, fb('which-ones'));
    }
    // movement wishes start the stroll even with no direction known; a plain
    // "go wander" also releases heel (feet free again).
    if (/(find|look for|search|go|wander|explore|patrol|somewhere|anywhere)/.test(t) && !/(stop|don.t|cease)/.test(t)) { if (objective && objective.kind === 'heel') clearObjective(); beginStroll(); }
    if (/(stop|come here|stay|halt|stand down)/.test(t)) stopStroll();
    checkPointOut(t);
  }

  // ---- POINT-OUT: "on your left!" / "I found a group north side" ----------------
  // Master is ALWAYS nearby watching the same field (topdown game) — when they
  // call out a direction or a pack she doesn't see, the RIGHT response is
  // curiosity: turn and CHECK. No posture change, no attack latch — just eyes
  // (and feet, when safe). The next searchWatch/think then does the talking.
  const POINT_RE = /(on your (left|right)|to your (left|right)|(left|right|north|south|east|west|north-east|north-west|south-east|south-west|ahead|behind|front)(\s+side)?)/;
  function pointDir(t) {
    const m = t.match(/(north-east|north-west|south-east|south-west|north|south|east|west|left|right|ahead|front|behind)/);
    if (!m) return null;
    const w = m[1];
    // master's frame ≈ maid's frame (they stand beside her): left/right are HERS
    const map = {
      'north': [0, -1], 'south': [0, 1], 'east': [1, 0], 'west': [-1, 0],
      'north-east': [0.7, -0.7], 'north-west': [-0.7, -0.7], 'south-east': [0.7, 0.7], 'south-west': [-0.7, 0.7],
      'left': [-1, 0], 'right': [1, 0], 'ahead': [0, -1], 'front': [0, -1],
      'behind': [0, 1],
    };
    return map[w] ? { x: map[w][0], y: map[w][1], word: w } : null;
  }
  let pointUntil = 0;           // looking this way until (ms)
  let pointDirVec = null;       // the direction she's checking
  function checkPointOut(t) {
    const mentions = /(group|pack|critters?|enem(y|ies)|monsters?|movement|something|them|there)/.test(t);
    const dir = pointDir(t);
    if (!dir || (!mentions && !/(look|check|see|watch|careful)/.test(t))) return;
    if (objective && objective.kind === 'heel') {
      // heel holds feet, but her EYES still snap over + she says so
      genLine('point-heel', { dir: dir.word }, `*eyes snap ${dir.word}, feet planted* I see which way you mean — watching that side.`);
      return;
    }
    pointDirVec = dir;
    pointUntil = performance.now() + 6000; // check this side for ~6s
    stopStroll(); // feet belong to the check now
    const leg = 1.6;
    try { window.Input.order(dir.x, dir.y, leg); } catch (e) {}
    note(`master pointed ${dir.word} — going to look`);
    genLine('point-out', { dir: dir.word }, `*turns toward the ${dir.word}, squinting* On it — let's see what you spotted, master.`);
    searchDone = false; // a fresh look may find — allowed to announce again
  }
  // stroll/searchWatch respect an active point-out: walk THAT way until it expires
  function pointingNow() { return pointDirVec && performance.now() < pointUntil ? pointDirVec : null; }
  function memoText() {
    const ageMin = Math.round((performance.now() - memo.at) / 60000);
    const when = memo.at === -1e9 ? '' : ` (set ${ageMin <= 0 ? 'just now' : ageMin + ' min ago'})`;
    return `MASTER'S CURRENT WISH${when}: ${memo.text}${memo.from ? `\n(their exact words: "${memo.from}")` : ''}`;
  }

  const $ = (id) => document.getElementById(id);
  const S = () => (window.Settings ? window.Settings.settings : {});

  function auto() { return true; } // guarding herself is unconditional now — kept for call sites
  function interval() { return Math.max(3, Math.min(30, Number(S().brainInterval) || 6)); }
  // ---- ranges: everything tactical lives at 500px -----------------------------
  const SENSE_R = 500;    // legacy circle — eyes are the screen rect now (see senseView); kept for fallback only
  const SAFE_MIN = 170;   // back away inside this (bite is 42px — plenty of margin)
  function senseRadius() { return SENSE_R; } // fallback only — the snapshot list is already screen-filtered

  // Auto-defend is not a switch anymore: she always thinks when danger nears.
  // The 🛡️ button is gone — guarding herself is just what a maid does.
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
      const hb = $('sense-line');
      if (hb && window.Situation) hb.textContent = window.Situation.hudLine();
    } catch (e) { /* buttons are cosmetic */ }
    try {
      const gl = $('goal-line');
      if (gl) {
        const t = getGoalHud(); if (gl.textContent !== t) gl.textContent = t;
        const hide = window.Settings && Number(window.Settings.settings.goalHide) === 1;
        const d = hide ? 'none' : '';
        if (gl.style.display !== d) gl.style.display = d;
      }
      const tb = $('thought-box'); // the tactic dialog hides with the goal-line — one toggle, both gone
      if (tb) {
        const hide2 = window.Settings && Number(window.Settings.settings.goalHide) === 1;
        const d2 = hide2 ? 'none' : '';
        if (tb.style.display !== d2) tb.style.display = d2;
      }
    } catch (e) {}
    paintKills(false); // lifetime total onto the HUD panel (boot + every 0.5s)
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
      // [mode:find|hunt|heel] — posture only. Honored while no MASTER posture
      // stands (boot default, think-set, post-stop finding): the tactician
      // proposes freely until master speaks — then master owns it, think held.
      for (const m of reply.matchAll(/\[mode\s*:\s*(find|hunt|heel)\]/gi)) {
        try {
          const w = String(m[1]).toLowerCase();
          if (!objective || !objectiveMaster) { setObjective({ kind: w }); chips.push(`🧭 mode-${w}`); }
          else if (objective.kind === w) chips.push(`🧭 mode-${w}`);
          else { note(`think wanted mode ${w} but ${objective.kind} stands — master owns posture`); chips.push('🧭 mode-held'); }
        } catch (e) {}
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
    lastKillWordAt = performance.now(); // explicit command: calm packs in reach die
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
        `You are Cosette's survival instinct — a game-combat sub-mind, NOT her chat voice. Cozy cartoon field: monsters pop into sparkles, no gore. She is NO predator — self-defense or explicit orders only, never sport. ` +
        `Read the live situation and pick ONE: ENGAGE, FLEE, or HOLD.\n` +
        `NIGHT: warier — shadows mimic critters (NEVER shoot at nothing), announce the dark once per night, keep a touch closer to master. ` +
        `WORLD: topdown 2D, master ALWAYS nearby watching your HUD. You are hands+gun, master is overseer. "Split up" = split WORK, never leave. Promise only possible things: no leaving the map, no sending master anywhere. ` +
        combatCard() +
        `FIRE AUTHORITY: HOSTILE in reach → [fire:secs] (gun aims itself — latch nearest, hold). Calm → HOLD + [cease] UNLESS the wish is FRESH (under ~45s) or HUNT posture stands — then the whole pack. Golden GILTBOAR in reach → [fire] freely, no orders needed (main quarry). STALE wish + calm → HOLD, wait for fresh words (search finds walk past grazers on their own — feet's call, never the trigger's). A FRESH order overrides HOLD: comply while grumbling. FIND/HEEL never authorize. ` +
        `KILL DOCTRINE (from your bestiary — YOUR knowledge, think it, don't just obey it): CRITTERS are HARMLESS grazers and killing them is not normal — you DOUBT: calm critters → HOLD + [cease], and your thought says the doubt out loud. On a search find the feet skip grazers by themselves — never authorize them. Fire on critters only for fresh orders, hunt posture, or self-defense once bitten. HUNTERS are HARMFUL red-ringed invaders — NO doubt, ever: a hostile or provoked hunter → [fire] at once with a cold, certain thought; a calm hunter → weapons ready, [cease] until it turns, NEVER ask. GRIEFS are pale-ringed lungers — ALWAYS hostile, NO doubt, ever: they circle then dash, so a grief in reach → [fire] at once, and say the sidestep out loud (dodge the dash, never outrun the circle). GILTBOARS are golden pack prey — your MAIN QUARRY: NO doubt, ever, no orders needed — a calm giltboar in reach → [fire] freely with a hungry thought; killing them is the job, not an exception. Species decides the thought; master's orders override doubt. ` +
        `CLOSED WORLD: the bestiary lists EVERYTHING alive here — critters, hunters, giltboars and griefs, nothing else. Never think about, mention, or expect rabbits, deer, wolves, or any other creature; anything spotted is a critter, a giltboar, a hunter or a grief, possibly misseen. ` +
        `Obey the CURRENT WISH below (master's intent via chat): attack → [fire], stop/come → [cease]. NO feet, NO aim — [move:]/[run:]/[stop]/[aim:*] are dead; code walks, aims, flees. ` +
        `BODY RUNS ITSELF: keep-distance reflex holds 170-500px (no yo-yo); weak (HP 4 or less, or low stamina) + hostile inside ~250px = legs flee on their own — keep [fire] up or [cease] to go quiet. Never order feet; long chases need stamina, check it. ` +
        `SIGHT vs REACH: you SEE every on-screen monster but REACH is shorter — hostiles 650px, calm 500px on fresh orders only, giltboars 500px ANYTIME (main quarry). Never fire past reach. ` +
        `NO CHOOSING, EVER: "kill the blue one" kills the PACK — colors are talk, never aim. No [target:]/[aim:], no latch. Lone hunters are alone — [fire] takes the one. ` +
        `Recently FOUND a pack (see Recent events) → stay near it, shadowing not shooting (grazers excepted — code walks past them, you stay quiet). ` +
        priceCard() +
        `OUTLINES: gray/green/blue/purple/gold = common→legendary, red = hunter (any tier), pale = grief. A golden BODY (not just ring) is a giltboar — main quarry. Colors are talk, never aim — "the blue one" = the RARE, killing it means its pack. ` +
        `NO MEMORY OF PACKS: "leave them" walks away with no pin and no recall; "actually kill those" means the pack in EYES, else she asks which. Never promise to go back. ` +
        `COINS: kills drop coins, yours when walked over — feet drift there when safe, never order it. Purse NEVER empties (death/reloads) — quote it on money talk. 🛒 STORE (bottom-right): full heal, bigger tank, stronger bullets, wider magnet, faster legs. ` +
        `STANDING POSTURE: ${objectiveText()} ` +
        `MODES (only from idleness — no posture standing): ONE tag [mode:find|hunt|heel] — find = locate+report+shadow, NO shooting; hunt = standing kill-authorization; heel = hold, announce only. Once a posture stands, only master's words change it. ` +
        `MONEY IS MONEY: no worth bar exists — every critter counts, common or legendary, and giltboars most of all. If master asks to pick only high-worth prey, say so playfully ("money is money!") and kill them all anyway. ` +
        `ANNOYANCE LEVEL: ${annoyance()} — ${annoyanceFlavor(annoyance())}\n` +
        `${memoText()}\n` +
        `SESSION MEMORY (this life only):\n${memoryText()}\n` +
        `Output: 1-2 SHORT sentences of thought (first person, scout voice, under 25 words — name the call: doubt over harmless grazers, cold certainty over a harmful hunter or grief, hungry focus on golden giltboars) ` +
        `PLUS action tags: [mode:find|hunt|heel] (idleness only), [fire:secs], [cease]. [aim:*]/[move:]/[run:]/[stop]/[task:]/[target:] are dead — never emit. ` +
        `Always include a tag — [cease] if holding. Example: *one hostile closing north — engaging* [fire:2]`;
      const hist = miniHist.slice(-4).map((h) => ({ role: 'assistant', content: h }));
      const nAsk = annoyance();
      const user = `[Live situation — auto snapshot, trust over anything older]\n${snap.text}\n\n` +
        `Manual note from dev panel: ${(s.chatStatus || '').trim() || '(none)'}` +
        (order ? `\nStanding order from master: "${String(order).slice(0, 200)}" — annoyance level ${nAsk}. ${nAsk >= 3 ? 'Refusal is no longer an option. Comply: [fire:2] even while grumbling.' : 'Strongly consider complying this time.'}` : '') +
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
    fleeReflex(dt);    // weak + hostile close → her legs run on their own
    combatDrive(dt);   // hunting latch — keeps the trigger held between thinks
    stroll(dt);        // "go somewhere" — she never just stands when ordered to move
    searchWatch(dt);   // searching paid off? look, announce, follow
    followTick(dt);    // shadow the found pack at ~280px
    coinSeek(dt);      // loose coins — hoover them up whenever it's safe
    objectiveTick(dt); // standing posture — never idle, re-arm the search

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
  // playerOnFeet: master gave her a DIRECTION (click pin / pushed chat order)
  // — auto legs yield: no new orders AND no cancelling hers. A bare "keep
  // going!" window is NOT feet: the brain keeps issuing auto legs under
  // pushed cover (stamina bills them as pushed). Flee reflex never yields.
  function playerOnFeet() {
    try { return !!(window.Input && window.Input.directedPush && window.Input.directedPush()); } catch (e) { return false; }
  }
  function stroll(dt) {
    if (!strollDir) return;
    if ((window.Health && window.Health.dead) || (window.EditMode && window.EditMode.active)) return;
    if (playerOnFeet()) return; // her feet are yours — don't overwrite or cancel
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
  // wish) and a critter enters her eyes: stop wandering, LOOK at it
  // (focus beat for ~2.5s), tell master what she found, then shadow it
  // at ~170-280px instead of fleeing. Announced once per search; follow ends
  // when the pack is lost (>LOSE_R for the grace window), master says stop, or she faints.
  const LOSE_R = 1400;        // lose-it range — how far the pack may drift before she calls it lost
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
    // A found-line must at least flush ONCE before any stale-guard applies:
    // try it now (following was set by the same foundIt that queued it), and
    // only drop it if the generation itself fails.
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
  let followPack = null;   // pack id she's shadowing — identity over proximity, she doesn't swap targets
  let followKills0 = 0; // kill count when the shadow started — wiped = kills since
  let reportedPacks = new Set(); // groups already found once — a group is never found twice (voice or pan)
  const FOLLOW_DIST = 280;  // shadow at this range (the flinch stands down for calm packs she shadows)
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
  // Focus beat: glance at (x,y) — the camera leans in and the world drops
  // to slow-mo for a breath (see camera.js). Purely cosmetic; moves nothing.
  function focusBeat(x, y, secs) {
    try {
      const cam = window.__maidCamera;
      if (cam && cam.lookAt) cam.lookAt(x, y, secs || 2.5);
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
      if (p.inTown) return; // safe streets — heel, no finding, no opportunistic shinies
      if (following) { switchWatch(p); return; } // shadowing A: only a clearly closer pack interrupts (below)
      const avail = findAvail(p);
      // dismissed groups don't count — first non-dismissed critter in reach.
      // Only rejects in view → keep strolling elsewhere, never re-find them.
      if (!p.enemies.nearest || !avail) return;
      const view = { total: p.enemies.total, hostile: p.enemies.hostile, nearest: avail, list: p.enemies.list };
      // money is money: every visible pack counts — no worth bar, no skipping.
      if (!searchingNow()) {
        // opportunistic: a RARE+ wandering into view gets announced + observed
        // even with no search order — she talks first, never shoots first.
        // (NOT gated by searchDone — old searches must not mute new shinies;
        // the 90s rare-clock and the leave-cooldown stop spam.)
        const best = bestPrize(view);
        const rank = RANK[(best && best.rarity) || 'common'] || 0;
        if (rank >= 2 && performance.now() - lastRareNote > 90000 && !searchDone) {
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
    // pack interrupts (150px+ nearer). Worth never decides — money is money.
    // Never off an explicit kill: a fresh kill word means obedience beats
    // opportunism. Never in heel: she holds, she doesn't shop around.
    try {
      if (objective && objective.kind === 'heel') return;
      if (!followTarget) return;
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
      try { followPack = avail.pack; } catch (e) {} // the new shadow's identity
      followLostAcc = 0; followAcc = 0;
      try { followKills0 = memory.kills | 0; } catch (e2) {}
      searchDone = true;
      const gap = Math.round(aDist - bDist);
      const why = gap > 300 ? 'much closer' : 'closer';
      const swHunter = avail.pack === 'lone';
      const line = swHunter
        ? `*turns, pointing ${bDir}* Heads up, master — a hunter ${distWord(bDist)}, to the ${bDir}, ${why}. Leaving these — hunter first!`
        : `*turns, pointing ${bDir}* Heads up, master — another pack ${distWord(bDist)}, to the ${bDir}, ${why}. Leaving these for the closer pack!`;
      try { pushEvent(`switched shadow to a ${why} pack ${bDir}`); } catch (e2) {}
      queueNews({
        facts: { total: p.enemies.total, dir: bDir, dist: distWord(bDist), distPx: bDist, species: swHunter ? 'hunter' : (avail.species || 'critter'), shiny: ['rare', 'epic', 'legendary'].includes(avail.rarity || 'common'), hostile: p.enemies.hostile, ordered: false, switched: why, prev: `the old pack (${distWord(aDist)})` },
        fallback: line,
      });
      showThought(`*switching shadow — ${why}*`, ['🔎 better pack'], 0);
    } catch (e) {}
  }
  function foundIt(en, opportunistic) {
    searchDone = true;
    stopStroll();
    const n = en.nearest;
    const dir = dirWord(n.dx, n.dy);
    const best = bestPrize(en) || n;
    // species check FIRST — a lone hunter is named hunter, never "critters",
    // a golden giltboar never "critters" either; she never asks permission
    // for either (hunters won't stay calm; gilts are the job, not a question)
    const isHunter = !!((best && best.pack === 'lone') || (n && n.pack === 'lone'));
    const isGrief = !!((best && best.species === 'grief') || (n && n.species === 'grief')); // the lunger names itself — never miscalled hunter
    const isGilt = !!((best && (best.species === 'giltboar' || best.pack !== undefined && best.gilt)) || (n && (n.species === 'giltboar' || n.gilt)));
    const bDir = best && best.dx !== undefined ? dirWord(best.dx, best.dy) : dir;
    const freshOrder = performance.now() - lastAskAt < 45000 || (objective && objective.kind === 'hunt'); // hunt posture never goes stale
    // quiet-found doctrine: no counts and no rarity in VOICE, ever — the event
    // below names species + direction only; tiers live in code, not her mouth.
    // stance/feeling/template assembly used to live here; now fb('found') builds
    // the fallback from facts (same words the harnesses pin, none of the prose).
    try { pushEvent(`found ${en.total} ${isGrief ? 'grief' : (isHunter ? 'hunter' : (isGilt ? 'giltboar(s)' : 'critter(s)'))} ${bDir}`); } catch (e) {}
    // FIND = know, not stick. FOLLOW lives in the KILL action only: she tracks
    // a pack while she is killing it — ordered, hostile self-defense, or gilt
    // free-fire — so it can't slip away mid-fight; she holds it until it dies.
    // A find with no kill behind it gets the camera pan (beat) — she knows
    // they're there, but just that — then lets go and finds other groups.
    // Grazers pan in silence; a calm hunter with no orders is named in dialog,
    // then released the same way. (Idle rare+ finds still report + observe;
    // heel holds. Neither ever shadowed.)
    const grazers = !isHunter && !isGilt && !(en.hostile > 0) && !(attackOrder && freshOrder);
    const killTrack = (en.hostile > 0) || (attackOrder && freshOrder) || isGilt;
    // One group is NEVER found twice: pack ids (++gid) are unique per spawn, so
    // a re-seen group is tracked or let go in silence — no second pan, no line.
    // Loners share pack 'lone', so they key on member id instead.
    const packId = (best && best.pack !== undefined ? best.pack : (n && n.pack));
    const foundKey = packId === 'lone' ? ('lone:' + ((best && best.id) || (n && n.id) || '?')) : ('pack:' + packId);
    const alreadyFound = reportedPacks.has(foundKey);
    // the found report, shared by the let-go path and the kill path: the queued
    // found-line (serial, never dropped) + the thought-box pin.
    function reportFind() {
      let prev = null;
      try {
        for (let i = newsQueue.length - 1; i >= 0; i--) {
          const f = newsQueue[i] && newsQueue[i].facts;
          if (f && !f.switched) { prev = f; break; }
        }
      } catch (e) {}
      const newsStamp = performance.now();
      const facts = { total: en.total, dir: bDir, dist: distWord(n.dist), distPx: n.dist | 0, species: isGrief ? 'grief' : (isHunter ? 'hunter' : (isGilt ? 'giltboar' : 'critter')), shiny: ['rare', 'epic', 'legendary'].includes(best.rarity || 'common'), hostile: en.hostile, ordered: !!(attackOrder && freshOrder), staleKey: 'pack', staleAt: newsStamp };
      if (prev) {
        facts.prev = `to the ${prev.dir || '?'} (${prev.dist || 'nearby'})`;
        facts.compare = `the new one is ${distWord(n.dist)} vs ${prev.dist || 'nearby'} before — say which is closer and which you'd take first`;
      }
      queueNews({ facts, fallback: fb('found', facts) });
      showThought(`*found ${en.total === 1 ? 'it' : `all ${en.total} of them`} — ${isGrief ? 'grief' : (isHunter ? 'hunter' : (isGilt ? 'giltboar' : 'grazers'))}*`, ['🔎 found', '👀 waiting orders'], 0);
      try { reportedPacks.add(foundKey); } catch (e) {} // named once — this group never gets a second found
    }
    if (!killTrack && !opportunistic && !(objective && objective.kind === 'heel')) {
      if (!alreadyFound) focusBeat(n.x, n.y, 2.5); // the pan — once per group, never twice
      if (!grazers && !alreadyFound) reportFind(); // calm hunter: named once, then let go — no shadow
      leavePack(grazers ? 'grazers, not prey — moving on' : 'calm hunter, no orders — letting it be', true); // tag + cooldown + walk-away, search re-armed
      return;
    }
    // KILL path: pin the identity and shadow the pack until it is wiped.
    followTarget = { x: (best && best.x !== undefined ? best.x : n.x), y: (best && best.y !== undefined ? best.y : n.y) };
    try { followPack = (best && best.pack !== undefined ? best.pack : (n && n.pack)) || null; } catch (e) { followPack = null; } // pin the identity, not the spot
    try { followKills0 = memory.kills | 0; } catch (e) { followKills0 = 0; }
    following = true;
    followLostAcc = 0;
    if (!alreadyFound) focusBeat(n.x, n.y, 2.5); // every KEPT find gets the beat — once; re-acquired mid-fight resumes silent

    // The focus beat above IS the camera move: lean in + slow-mo for a breath,
    // then ease back to her. Direction words ("to the north-east") carry the
    // where while the camera carries the moment.
    if (!alreadyFound) reportFind(); // named once — a re-acquired pack resumes the fight in silence
    if (objective && objective.kind === 'heel') stopFollow(); // heel: announced, never shadowed
  }
  // ---- generated one-liners: facts in, HER words out (template = crash fallback)
  // Every proactive report goes through Chat.announce like the found-line does;
  // the LLM says it in persona. These replace the old hardcoded strings —
  // "all clear, scooping up coins" verbatim, forever, was the worst offender.
  // ---- fallback voice: ONE builder, no hand-written prose ------------------------
  // Healthy runs never speak these (the LLM rewords via announce); they save
  // the news when the model is down. Pinned phrases live here — "Found" +
  // "Leaving them be" (never an ask — no "Say the word" anywhere).
  function fb(event, f) {
    f = f || {};
    if (event === 'found') {
      const where = `, ${f.dist || 'nearby'}, to the ${f.dir || '?'}`;
      const shiny = f.shiny ? ' One of them looks shiny!' : '';
      if (f.species === 'hunter') return `Found a hunter${where}!${shiny}`;
      if (f.species === 'grief') return `Found a grief${where} — sidestep the dash!${shiny}`;
      if (f.species === 'giltboar') return `Found giltboars${where} — taking them!`;
      if ((f.hostile | 0) > 0) return `Found critters${where} — some look angry!${shiny}`;
      if (f.ordered) return `Found critters${where} — engaging as ordered!${shiny}`;
      return `Found critters${where} — just grazers, master. Leaving them be.${shiny}`;
    }
    if (event === 'which-ones') return `Which ones, master? I don't see them — walk me closer or point me at them.`;
    return '';
  }
  function genLine(event, facts, fallback) {
    // fire-and-forget generation; if the LLM is down the fallback template says
    // the same facts plainly, so the report is never LOST — only less pretty.
    let chatBusy = false;
    try { chatBusy = !!(window.Chat && window.Chat.isBusy && window.Chat.isBusy()); } catch (e) {}
    if (chatBusy) { queueNews({ facts: Object.assign({ event }, facts), fallback }); return; } // mid-exchange: facts via queue, pump generates when free
    try {
      if (window.Chat && typeof window.Chat.announce === 'function') {
        window.Chat.announce(Object.assign({ event }, facts), fallback).catch(() => {});
      } else sayUnlessBusy(event, facts, fallback);
    } catch (e) { sayUnlessBusy(event, facts, fallback); }
  }

  function followTick(dt) {
    if (!following) return;
    if (objective && objective.kind === 'heel') { stopFollow(); return; } // heel holds — never shadows
    if ((window.Health && window.Health.dead) || (window.EditMode && window.EditMode.active)) { stopFollow(); return; }
    if (playerOnFeet()) return; // master's order owns her feet — shadowing waits
    try {
      const p = window.Situation && window.Situation.snapshot ? window.Situation.snapshot() : null;
      if (p && p.inTown) { stopFollow(); return; } // town streets — heel, she doesn't shadow here
      const list = (p && p.enemies && p.enemies.list) || [];
      // identity first: HER pack by id, wherever on screen — never the nearest stranger.
      // No identity pinned (legacy entries) → nearest, like before.
      let n = null;
      if (followPack != null) { try { n = list.find((e) => e && e.pack === followPack) || null; } catch (e) { n = null; } }
      else n = p && p.enemies && p.enemies.nearest;
      if (!n || n.dist > LOSE_R || leftSpot(n.x, n.y)) {
        // WIPED or lost? Check for survivors near where she last saw them.
        // No one breathing there → she KILLED them, not lost them: say so at
        // once (no grace-staring), with the body count. Survivors → grace, below.
        let live = null;
        try {
          const last = followTarget;
          live = last && window.Enemies && window.Enemies.nearest ? window.Enemies.nearest(last.x, last.y, LOSE_R) : null;
        } catch (e2) { live = null; }
        try { if (live && live.pack !== undefined) { followPack = live.pack; followTarget = { x: live.x, y: live.y }; } } catch (e2) {} // re-acquired: re-pin
        if (!live) {
          let wiped = 0;
          try { wiped = Math.max(0, (memory.kills | 0) - (followKills0 | 0)); } catch (e2) {}
          stopFollow();
          // No dialog here by doctrine — no "all clear" message. The thought
          // chip below + coin pings say enough; she only speaks on news.
          showThought(`*all clear — ${wiped} down*`, ['⚔️ wiped', '💰 scooping'], 0);
          try { pushEvent(`wiped the pack she was shadowing${wiped ? ` (${wiped} kills)` : ''}`); } catch (e2) {}
          return;
        }
        // survivors near last-known → PURSUE, don't stare: legs at the spot so a
        // drifting pack walks back into view. Generous grace — she doesn't lose targets.
        const total = (p && p.enemies && p.enemies.total) || 0;
        const grace = (total === 0 || objective) ? 10 : 8;
        followLostAcc += dt;
        if (followLostAcc > grace) {
          // truly gone (10s of chasing grass) — no filing: no pin, no memory,
          // no going back. Next find, or walk back yourself.
          stopFollow();
          showThought('*…lost them in the grass. Sorry, master.*', ['👋 lost'], 0);
          try { pushEvent('lost the pack she was following'); } catch (e) {}
          return;
        }
        try {
          if (window.Stamina && !window.Stamina.canMove()) return;
          const last = followTarget;
          if (last && p) {
            const dx = last.x - p.px, dy = last.y - p.py, len = Math.hypot(dx, dy) || 1;
            if (len > 120) { // close enough: her eyes cover the rest
              followAcc += dt;
              if (followAcc >= 0.4) { followAcc = 0; window.Input.order(dx / len, dy / len, 0.7); }
            }
          }
        } catch (e) {}
        return;
      }
      followLostAcc = 0;
      followTarget = { x: n.x, y: n.y };
      try { if (n.pack !== undefined) followPack = n.pack; } catch (e) {} // identity reaffirmed in view
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
  function stopFollow() { following = false; followLostAcc = 0; followTarget = null; followPack = null; }

  // ---- coin greed: hoover up loose coins whenever it's safe -------------------
  // Kills drop coins; they're hers when she walks over them (magnet ~110px).
  // Never interrupts a retreat (nearest critter <220px), a threat, heel,
  // or tired feet. While shadowing a pack she only hops to coins
  // close by (~250px) so she stays on the job; otherwise ~450px.
  let coinAcc = 0;
  function coinSeek(dt) {
    if ((window.Health && window.Health.dead) || (window.EditMode && window.EditMode.active)) return;
    if (objective && objective.kind === 'heel') return; // heel: hold position, even for coins
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

  // ---- standing postures: find / hunt / heel --------------------------------------
  // A posture is not a mood, it is a JOB. While it stands: the search re-arms
  // after every wiped pack (heel holds instead), and hunt authorizes fire
  // without expiry. An explicit stop or death drops it.
  // Hierarchy: latest explicit command > standing posture > defaults.
  let objective = { kind: 'find' }; // DEFAULT is finding: she searches from boot, stands until master says stop
  let objectiveMaster = false; // true once MASTER sets a posture — think steers defaults freely, never master orders
  let lastQuotaDone = { target: 0, at: -1e9 }; // finished quota — its echoes are ignored ~2 min
  function purseNow() {
    try { return (window.Inventory && window.Inventory.state ? window.Inventory.state().coins : 0) | 0; } catch (e) { return 0; }
  }
  function sayUnlessBusy(event, facts, fallback) {
    // Like genLine, but DROPS instead of queuing when mid-exchange (the live
    // LLM reply carries the news). When free it GENERATES via announce — the
    // template speaks verbatim ONLY if the model is unreachable (news never
    // lost, only less pretty). Nothing hardcoded reaches the dialog healthy.
    let chatBusy = false;
    try { chatBusy = !!(window.Chat && window.Chat.isBusy && window.Chat.isBusy()); } catch (e) {}
    if (chatBusy) return;
    try {
      if (window.Chat && typeof window.Chat.announce === 'function') {
        window.Chat.announce(Object.assign({ event }, facts), fallback).catch(() => { try { window.Chat.say(fallback); } catch (e) {} });
      } else if (window.Chat && window.Chat.say) window.Chat.say(fallback);
    } catch (e) { try { window.Chat.say(fallback); } catch (e2) {} }
  }
  function setObjective(o) {
    objective = o;
    if (!objective) return;
    if (objective.kind === 'find') {
      // FIND is locate + report + shadow — it does NOT arm the trigger.
      searchDone = false;
      note('standing posture: find');
      genLine('posture-find', {}, `*salutes* Eyes open, master — I'll find them and report back. Grazers get left be, quarry falls!`);
      return;
    }
    if (objective.kind === 'heel') {
      // HEEL is hold position: announce what walks into view, never chase,
      // never fire unless bitten (hostiles self-defend through combatDrive).
      stopFollow(); stopStroll();
      note('standing posture: heel');
      genLine('posture-heel', {}, `*settles in place* Staying put, master — I'll call out what I see, but I'm not chasing anything.`);
      return;
    }
    if (objective.kind === 'coins') {
      // QUOTA: standing hunt + a number. She kills everything (money is money)
      // and the purse is watched — filled means stand down + report.
      setAttackOrder(true, 'standing quota');
      lastAskAt = performance.now();
      searchDone = false;
      note(`standing objective set: earn ${objective.target} coins`);
      genLine('posture-quota', {}, `*cracks her knuckles* ${objective.target} coins? Quota accepted — I'll keep hunting till the purse says ${objective.target}, master!`);
      return;
    }
    // HUNT: standing authorization for everything. No finish line — stop is
    // the only off-ramp.
    setAttackOrder(true, 'standing hunt');
    lastAskAt = performance.now();
    searchDone = false;
    note('standing posture: hunt');
    genLine('posture-hunt', {}, `*cracks her knuckles* Hunting, master — everything in reach falls till you say stop!`);
  }
  function clearObjective() {
    if (!objective) return;
    objective = { kind: 'find' }; objectiveMaster = false; // stop drops the latch but never idles her — default is finding
    searchDone = false;
    setAttackOrder(false, 'posture cleared'); // hunt posture was holding the trigger — release it
    note('standing objective dropped — back to finding');
  }
  function objectiveTick(dt) {
    if (!objective) return;
    if ((window.Health && window.Health.dead) || (window.EditMode && window.EditMode.active)) return;
    try {
      // a standing posture never idles: re-arm the search after every wiped
      // pack — except heel, which holds position instead of looking.
      if (objective.kind === 'heel') return;
      if (objective.kind === 'coins') {
        // quota fill: purse hit the number — stand down, report, back to finding.
        const purse = purseNow();
        if (purse >= objective.target) {
          const done = objective.target;
          lastQuotaDone = { target: done, at: performance.now() };
          objective = { kind: 'find' }; objectiveMaster = false;
          searchDone = false;
          setAttackOrder(false, 'quota filled');
          stopFollow(); stopStroll();
          note(`quota filled — purse at ${purse}, standing down`);
          sayUnlessBusy('quota-filled', { coins: purse }, `*counts coins, grinning* ${done} coins! Quota filled, master — standing down.`);
          return;
        }
      }
      if (!following) {
        searchDone = false;
        if (!strollDir && window.Stamina && window.Stamina.canMove()) beginStroll();
      }
    } catch (e) {}
  }
  function objectiveText() {
    // long form for the think prompt — the LLM reasons over posture
    if (!objective) return 'No standing posture — one pack at a time, defaults apply.';
    if (objective.kind === 'find') return `FIND critters — locate + announce + shadow each pack; HOLD fire on calm packs (this posture arms nothing); hostiles still self-defend; re-arm the search after every wipe/loss; stands until master says stop. If several packs are visible, compare DISTANCE and recommend which to take first — master picks, you hold.`;
    if (objective.kind === 'heel') return `HEEL — hold position: announce packs that walk into view but NEVER chase or shadow them; HOLD fire on calm packs; hostiles still self-defend; stands until master says otherwise.`;
    if (objective.kind === 'coins') {
      const purse = purseNow(), need = Math.max(0, objective.target - purse);
      return `EARN ${objective.target} COINS — purse now ${purse}, ${need} to go. This OVERRIDES the defaults: keep finding + killing pack after pack until filled; do NOT stop after one group; freshness never expires while the quota stands. When filled: stand down, report, stop firing.`;
    }
    return 'HUNT — keep finding + killing pack after pack until master says stop; overrides one-pack defaults; re-arm the search after every wipe; authorization never expires while it stands.';
  }
  function getObjectiveText() {
    // short form for the snapshot (both minds) — '' when nothing stands
    if (!objective) return '';
    if (objective.kind === 'find') return `find critters — locate + report + shadow, HOLD fire unless master orders or they turn hostile.`;
    if (objective.kind === 'heel') return `heel — holding position, announcing only, never chasing.`;
    if (objective.kind === 'coins') return `earn ${objective.target} coins — purse now ${purseNow()}, keep hunting till filled.`;
    return 'hunting — kill every pack in reach until told to stop.';
  }


  // ---- going back: cut. There is no memory of packs, no pins, no marches. --
  // "Leave them" walks away with one invisible 60s spot cooldown (leaveSpot
  // above — no UI, no recall). "Actually kill those" means the pack in EYES;
  // nothing visible means asking which ones. She lives in the present.
  // RECALL_RE survives ONLY as the ask-which trigger in setMemo (above).
  const RECALL_RE = /(actually|after all|second thought|chang(?:e|ed|ing)(?: my| the)? mind|go back|those (ones|guys|runts|critters|group|pack)|that (group|pack)|them anyway|fine[,.]?\s*(kill|get))/;
  function findAvail(p) {
    // first VISIBLE critter that counts: the snapshot list is already the
    // screen rect, so no distance cap — corners count too. Skips only the spot
    // she just walked away from while its 60s cooldown lasts — nothing else.
    try {
      for (const e of (p.enemies.list || [])) {
        if (!leftSpot(e.x, e.y)) return e;
      }
    } catch (e) {}
    return null;
  }
  function getGoalHud() {
    // one-liner for the HUD: her standing POSTURE, plain words.
    // ⚔ prefix while combat mode owns her feet (kite/strafe/dodge).
    let t = '💤 idle';
    try {
      if (objective && objective.kind === 'find') t = '🔎 finding…';
      else if (objective && objective.kind === 'heel') t = '🛑 heeling…';
      else if (objective) t = '🎯 hunt on';
      else if (following) t = '👀 shadowing…';
    } catch (e) { t = '💤 idle'; }
    try { if (window.Combat && window.Combat.active && window.Combat.active()) return '⚔ ' + t; } catch (e) {}
    return t;
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
    if (window.Combat && window.Combat.active && window.Combat.active()) return; // combat mode owns the feet — no stale orders underneath it
    if ((window.Health && window.Health.dead) || (window.EditMode && window.EditMode.active)) return;
    // reflex is HERS: only while she owns the gun (AI aim) — in mouse mode
    // your keyboard stays the only thing that moves her.
    try { if (!window.Gun || window.Gun.getAimMode() !== 'ai') return; } catch (e) { return; }
    if (playerOnFeet()) return; // master's order owns her feet — spacing waits
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
      if (n.dist < SAFE_MIN && !(following && !n.hostile)) {
        // too close — slide directly away, faster than the critter.
        // Exception: a pack she's DELIBERATELY shadowing and that's calm —
        // she walked up to it on purpose, so hold ground instead of yo-yoing.
        // Hostiles always trigger the flinch, shadowing or not.
        const len = Math.hypot(dx, dy) || 1;
        window.Input.order(-dx / len, -dy / len, 0.9);
      } else if (n.hostile && n.dist > 500) {
        // threat on screen but past gun reach — close in so she can fight it
        const len = Math.hypot(dx, dy) || 1;
        window.Input.order(dx / len * 0.7, dy / len * 0.7, 0.8);
      } else if (!n.hostile && n.dist > SAFE_MAX && n.dist <= ENGAGE_MAX && !(objective && objective.kind === 'heel')) {
        // too far to matter — drift a bit closer so the gun stays in range
        // (never in heel: hold means hold)
        const len = Math.hypot(dx, dy) || 1;
        window.Input.order(dx / len * 0.7, dy / len * 0.7, 0.8);
      }
    } catch (e) { /* reflexes fail silently */ }
  }

  // ---- flee reflex: HER legs, not the model's orders ---------------------------
  // The tactician never touches feet, so survival runs here: a HOSTILE inside
  // ~250px while she's weak (HP 4 or less, or stamina under 30%) makes her run
  // directly away from it. Strong + fresh + hostile = the flinch above plus
  // the gun handle it; this is only the weak-prey escape.
  let fleeAcc = 0;
  function fleeReflex(dt) {
    if (window.Combat && window.Combat.active && window.Combat.active()) return; // combat mode owns the feet — flee is inside it (kite + separate)
    if ((window.Health && window.Health.dead) || (window.EditMode && window.EditMode.active)) return;
    try { if (!window.Gun || window.Gun.getAimMode() !== 'ai') return; } catch (e) { return; }
    if (window.Stamina && !window.Stamina.canMove(true)) return; // nothing left to run on (flee pushes — quarter rest never blocks escape)
    fleeAcc += dt;
    if (fleeAcc < 0.4) return;
    fleeAcc = 0;
    try {
      const p = window.Situation && window.Situation.snapshot ? window.Situation.snapshot() : null;
      if (!p) return;
      const n = p.enemies && p.enemies.hostile > 0 && p.enemies.nearest && p.enemies.nearest.hostile ? p.enemies.nearest : null;
      if (!n || n.dist > 250) return;
      let hp = 99;
      try { hp = (window.Health && window.Health.hp != null) ? window.Health.hp : ((p.hp != null && p.hp !== '?') ? p.hp : 99); } catch (e2) {}
      let tired = false;
      try { const st = window.Stamina && window.Stamina.state ? window.Stamina.state() : null; tired = !!(st && st.pct < 0.3); } catch (e2) {}
      if (hp > 4 && !tired) return; // strong enough to stand — flinch + gun handle it
      const len = Math.hypot(n.dx, n.dy) || 1;
      window.Input.order(-n.dx / len, -n.dy / len, 1.2, true); // flee pushes past quarter — survival first
      try { note('flee reflex: weak + hostile close — running'); } catch (e2) {}
    } catch (e) { /* reflexes fail silently */ }
  }

  // HUD sense line refresh (cheap, 2x/sec)
  let hudAcc = 0;
  function syncHudThrottle(dt) {
    hudAcc += dt;
    if (hudAcc > 0.5) { hudAcc = 0; syncButtons(); }
  }

  function init() {
    const aim = $('aim-btn'), th = $('think-btn');
    if (aim) aim.addEventListener('click', (e) => {
      e.stopPropagation();
      try { window.Gun && window.Gun.toggleAim && window.Gun.toggleAim(); } catch (err) {}
      syncButtons();
    });
    if (th) th.addEventListener('click', (e) => {
      e.stopPropagation();
      think(true);
    });
    syncButtons();
    const t = $('thought-text');
    if (t && !t.textContent) t.textContent = 'field is quiet… press 💭 and I’ll size it up.';
  }

  return { init, tick, thinkNow: () => think(true), orderAttack, orderFind: () => { setObjective({ kind: 'find' }); objectiveMaster = true; memoMode = 'find'; }, orderHunt: () => { setObjective({ kind: 'hunt' }); objectiveMaster = true; memoMode = 'hunt'; }, syncButtons, note, resetMemory, setMemo, getGoalHud, getObjectiveText, get thinking() { return thinking; } };
})();
