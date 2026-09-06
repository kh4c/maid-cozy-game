// Maid chat — talks to a local OpenAI-compatible LLM (LM Studio / llama.cpp
// server). History lives ONLY in memory: closing the page wipes it, nothing
// is ever written to localStorage. Text in, text out (dialog box only).
window.Chat = (() => {
  const $ = (id) => document.getElementById(id);
  let history = [];   // [{role, content}] — session only, capped below
  let busy = false;
  let typeTimer = null;

  function setText(t) { $('dialog-text').textContent = t; }

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // NEVER display: one stripper for every machinery spelling — closed,
  // unclosed, lazy single-bracket typos, orphan [[...]] memos, think-tags
  // ([fire]/[mode:]) the chat model sometimes echoes, and control tags.
  // Used by the reply path, the announce path, AND the render path.
  function stripMachinery(s) {
    return String(s || '')
      .replace(/intent\s*=\s*\[\[[\s\S]*?\]\s*\]\]?/gi, '')   // well-formed memo
      .replace(/intent\s*=\s*\[\[([\s\S]*)$/i, '')            // unclosed [[ — eats to end
      .replace(/intent\s*=\s*\[[^\]\n]{0,200}/gi, '')         // single-bracket typo
      .replace(/task\s*=\s*\[\[[\s\S]*?\]\s*\]\]?/gi, '')
      .replace(/task\s*=\s*\[[^\]\n]{0,200}/gi, '')
      .replace(/\[\[[\s\S]*?\]\]/g, '')                       // orphan [[memo]] without a key
      .replace(/\[(?:move|push|mode|fire|cease|aim|target|task)\s*:[^\]\n]*\]/gi, '') // control tags
      .replace(/\[(?:fire|cease|push)\]/gi, '')               // bare tags
      .replace(/^\s*\]\]\s*$/gm, '')                          // stray closing brackets
      .trim();
  }

  // Render a reply: *action* segments get highlighted; the Chat-tab actions
  // toggle strips them entirely for pure dialogue.
  function formatReply(full) {
    const show = window.Settings.settings.chatActions !== 0;
    let h = esc(full);
    h = h.replace(/\[(?:move|push|mode|fire|cease|aim|target|task)\s*:[^\]\n]*\]/gi, ''); // control tags never display
    h = h.replace(/\[(?:fire|cease|push)\]/gi, ''); // bare tags never display either
    h = h.replace(/intent\s*=\s*(\[\[[\s\S]*?\]\s*\]\]?|\[[^\]\n]{0,200})/gi, ''); // leaked memo never displays
    h = show
      ? h.replace(/\*([^*\n]+)\*/g, '<span class="dlg-action">$1</span>')
      : h.replace(/\*[^*\n]*\*?/g, '');
    return h;
  }

  // Reveal the reply briskly — re-rendered as HTML each tick so the
  // highlighting (or hiding) applies while she "talks".
  let lastFull = '';
  function typewriter(full) {
    clearInterval(typeTimer);
    lastFull = full;
    let i = 0;
    $('dialog-text').innerHTML = '';
    typeTimer = setInterval(() => {
      i += 2;
      $('dialog-text').innerHTML = formatReply(full.slice(0, i));
      if (i >= full.length) { clearInterval(typeTimer); typeTimer = null; }
    }, 24);
  }
  function isSpeaking() { return typeTimer !== null; } // typewriter mid-line — queue, don't clobber

  // Re-render the last reply (e.g. actions toggle flipped mid-display).
  function rerender() {
    if (lastFull) $('dialog-text').innerHTML = formatReply(lastFull);
  }

  // Read the *action* text to pick her face: beaming = the ^ ^ closed-eyes
  // very-happy burst; happy = lingering warmth. Anything unrecognized
  // (most lines) stays neutral by design.
  const MOODS = [
    ['smug',      ['smirk', 'smug', 'scoff', 'rolls her eyes', 'rolls eyes', 'eye-roll', 'raises an eyebrow', 'raised eyebrow', 'sarcast', 'mock', 'snort', 'condescend', 'side-eye', 'side eye']],
    ['surprised', ['gasp', 'widens', 'surpris', 'shock', 'startl', 'jaw drop', 'jumps']],
    ['pouty',     ['pout', 'huff', 'sulk', 'annoy', 'frown', 'glare', 'stamp', 'crosses her arms']],
    ['beaming',   ['beam', 'delight', 'overjoy', 'ecstat', 'joyful', 'very happy', '^ ^', 'eyes shut', 'crinkle']],
    ['happy',     ['laugh', 'giggle', 'grin', 'chuckle', 'clap', 'bounce', 'happy', 'excited', 'smile', 'warm', 'gently', 'gentle', 'soft', 'nod', 'kind']],
    ['sleepy',    ['yawn', 'drows', 'tired', 'sleepy', 'stretch', 'droop']],
  ];
  function moodFromReply(text) {
    const acts = [];
    const re = /\*([^*\n]+)\*/g;
    let m;
    while ((m = re.exec(text)) !== null) acts.push(m[1].toLowerCase());
    if (!acts.length) return 'neutral';
    const joined = acts.join(' | ');
    for (const [mood, keys] of MOODS) {
      for (const k of keys) { if (joined.includes(k)) return mood; }
    }
    return 'neutral';
  }

  function setMood(mood) {
    try {
      const L = window.Live2D;
      if (L && L.ready && typeof L.setMood === 'function') L.setMood(mood);
    } catch (e) { /* face is cosmetic — never break chat */ }
  }

  // ---- Chat-ordered walking --------------------------------------------------
  // "go left", "walk up and right for 3 seconds" — parsed from the user's
  // line (instant) and from her reply (tag first, *walks* phrasing fallback).
  const WALK_DIRS = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1],
    north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
  function parseWalk(text) {
    const t = (text || '').toLowerCase();
    if (!t) return null;
    if (/\bstop\b/.test(t) && !/(left|right|up|down|north|south|east|west)/.test(t)) {
      try { window.Input.stopWalk(); } catch (e) { /* walk is cosmetic */ }
      return { stopped: true };
    }
    const hasVerb = /(go|walk|move|run|step|head|stroll|strolling|walks|walking)\b/.test(t);
    if (!hasVerb) return null;
    let x = 0, y = 0;
    for (const w of Object.keys(WALK_DIRS)) {
      if (new RegExp('\\b' + w + '\\b').test(t)) { x += WALK_DIRS[w][0]; y += WALK_DIRS[w][1]; }
    }
    if (!x && !y) return null;
    let secs = 2;
    const m = t.match(/for\s+(\d+(?:\.\d+)?)\s*(?:s|sec|second)/) || t.match(/(\d+(?:\.\d+)?)\s*(?:s|sec|second)/);
    if (m) secs = parseFloat(m[1]);
    else if (/\ba (little|bit)\b/.test(t)) secs = 1;
    else if (/(a lot|far|over there)\b/.test(t)) secs = 4;
    const len = Math.hypot(x, y) || 1;
    try { window.Input.order(x / len, y / len, secs, true); } catch (e) { /* walk is cosmetic */ }
    return { x: x / len, y: y / len, secs };
  }

  // Urge words (no direction): "keep going", "back to work", "don't rest" —
  // breaks a VOLUNTARY rest latch and lends pushed cover for ~6s so auto legs
  // flow again on your word (and can run the tank dry). True exhaustion
  // ignores it — empty legs stay locked till they recover.
  function parseUrge(text) {
    const t = String(text || '').toLowerCase();
    // full phrases match anywhere ("keep going", "back to work", "don't rest")
    const phrase = /\b(keep\s+(going|working|running|moving|at\s+it)|don'?t\s+(rest|stop)|get\s+up|back\s+to\s+work|on\s+your\s+feet|no\s+resting)\b/.test(t);
    // bare verbs only when the message is SHORT ("move!", "work!", "go!") —
    // a long sentence mentioning work shouldn't yank her off rest. Leave-words
    // ("leave them", "go away") never count as urge.
    const leaving = /\b(leave|away)\b/.test(t);
    const bare = !leaving && t.length < 24 && /\b(work|move|walk|run|go|keep)\b/.test(t);
    if (!phrase && !bare) return false;
    try { window.Input && window.Input.pushFor && window.Input.pushFor(6); } catch (e) {}
    try { window.Stamina && window.Stamina.kick && window.Stamina.kick(); } catch (e) {}
    try { window.Brain && window.Brain.note && window.Brain.note('urged'); } catch (e) {}
    return true;
  }

  // Recent history capped by BOTH count and characters (~4 chars/token):
  // 6000 chars ≈ 1500 tokens keeps system + history + reply inside small
  // (8k) context windows. Always keeps at least the latest exchange.
  function recentHistory() {
    const BUDGET = 6000;
    const out = [];
    let total = 0;
    for (let i = history.length - 1; i >= 0 && out.length < 11; i--) {
      total += history[i].content.length;
      if (total > BUDGET && out.length >= 2) break;
      out.unshift(history[i]);
    }
    return out;
  }

  // ---- Chat intent -> tactic memo -------------------------------------------
  // The CHAT model is the one who understands natural language, so we ask it
  // (cheaply) to translate the user's latest line into a standing tactical
  // memo the survival brain reads on every think. Written to window.Brain.memo.
  function buildIntentInstr() {
    return (
      '[TASK: also output one final line intent=[[...]] — a <=200 char third-person memo ' +
      'for the tactical brain describing what the MASTER wants the maid to do right now. ' +
      'State the goal, the target, and the duration/condition, e.g. intent=[[Master wants her to hunt down and kill the calm pack to the south-east, keep firing until they are all gone]] ' +
      'or intent=[[Master wants her to stop shooting and just walk beside him]] or intent=[[No tactical intent, casual chat]]. ' +
      'PRESERVE color/rarity words (blue/green/purple/gold/gray, common/uncommon/rare/epic/legendary) for FLAVOR — but the brain never aims by them: "kill the blue one" kills the whole pack, by doctrine. Never promise to spare the rest of the pack. ' +
      'WORLD FACTS for the memo: this is a topdown 2D game; master and maid share ONE field, always a few screens apart; master sees the HUD and watches over her. Translate "split up / you go there I go here" as SPLITTING THE WORK (e.g. "master watches while she hunts the pack she found"), NEVER as physically separating or traveling to another area. She cannot leave the field, enter buildings, or go anywhere master cannot see. ' +
      'Base it ONLY on the master\'s latest message. This line is stripped from the dialog.]'
    );
  }
  function extractIntent(reply) {
    const m = String(reply || '').match(/intent=\[\[([\s\S]*?)\]\]/i);
    return m ? m[1].trim().slice(0, 240) : null;
  }
  function newLife(reason) {
    // Death boundary: brain/pockets/objectives reset elsewhere, but this log
    // does not — without a marker she cites LAST life's quotas as current.
    // A marker (not a wipe) keeps the talk readable while fencing old orders off.
    try {
      history.push({ role: 'user', content: `[new life — she fainted${reason ? ' (' + reason + ')' : ''} and woke up fresh with empty pockets: every past order, posture, and promise EXPIRED. Only master's NEW words count from here.]` });
      if (history.length > 20) history = history.slice(-20);
    } catch (e) {}
  }
  async function send(userText) {
    const text = (userText || '').trim();
    if (!text || busy) return;
    if (window.Health && window.Health.dead) return; // she's out — talk UI is hidden
    busy = true;
    clearInterval(typeTimer);
    history.push({ role: 'user', content: text });

    parseWalk(text); // "go left" walks her at once; she still replies in character
    parseUrge(text); // "keep going / back to work" breaks a voluntary rest — your words over her legs
    // Combat orders ("attack them!", "shoot it") go to the survival brain, not
    // the chat persona — she takes the gun (AI aim) and thinks immediately.
    // Negation-aware: "don't kill / do not shoot / stop killing" is NEVER an
    // attack order — it must not latch hunting mode on.
    const STOP_WORDS = /(stop|cease|\bdon[’']t\b|\bdo not\b|\bnot\b|\bno more\b|never mind|leave them|leave it|stand down|hold fire)/i;
    // Standing postures (find/hunt/heel) and one-shot attacks live in the brain's
    // memo now — the chat model only translates intent, it commands nothing.
    try {
      if (/(attack|shoot|kill|fire|fight|defend|aim|hunt|get them|take them|destroy|blast)/i.test(text) &&
          !STOP_WORDS.test(text) &&
          window.Brain && typeof window.Brain.orderAttack === 'function') {
        window.Brain.orderAttack(text);
      }
    } catch (e) { /* orders are cosmetic — never break chat */ }
    // Every line pre-seeds the brain's memo at once so the NEXT auto-think
    // obeys even before this chat reply (with its intent= line) comes back.
    // setMemo itself is negation-aware: stop-words clear hunting mode.
    try {
      if (window.Brain && typeof window.Brain.setMemo === 'function') {
        window.Brain.setMemo('Master said: "' + text + '"', text);
      }
    } catch (e) {}
    setText('…');
    try {
      const s = window.Settings.settings; // live Chat-tab values (persisted)
      // Persona + live situation (location etc.) merged into one system prompt.
      // AUTO awareness: her real position / weapon / nearby enemies are injected
      // every message (read-only context — combat DECISIONS live in Brain, not here).
      let sysText = s.chatSystem || '';
      // Macro guard: persona text pasted from SillyTavern may contain {{user}}/
      // {{char}} — the game never substitutes those, so the model would COPY
      // them into its replies ("killed by {{user}}"). Replace before it ships.
      sysText = sysText.replace(/\{\{\s*user\s*\}\}/gi, 'master').replace(/\{\{\s*char\s*\}\}/gi, 'Cosette');
      const sit = (s.chatStatus || '').trim();
      sysText += sit ? '\n\n[Manual note: ' + sit + ']' : '';
      try {
        if (window.Situation && typeof window.Situation.snapshot === 'function') {
          const snap = window.Situation.snapshot();
          sysText += '\n\n[Live situation — auto, trust over chat history:\n' + snap.text +
            '\nYou are chatting, not fighting: acknowledge danger naturally if any, but NEVER emit combat tags — the survival brain handles aim/fire/run.]';
        }
      } catch (e) { /* chat works deaf too */ }
      // Grounding rule (every reply): the live block outranks history + promises.
      try { if (window.Settings && Number(window.Settings.settings.worldTime) === 1) sysText += '\n\n[Night rule: it is NIGHT in the game right now — dark field, poorer visibility. You may naturally mention the dark (chilly, cozy, harder to see) but NEVER invent things you cannot see.]'; } catch (e) {}
      sysText += '\n\n[Grounding rule: the [Live situation] block above is ground truth — it outranks chat history and any past promise you made. If it shows 0 enemies, NEVER agree to attack, hunt, or "go back and kill" anything. Say the field is empty. Never say OK to killing what is not there.]';
      sysText += '\n\n[Money + goals: the purse total in [Live situation] is the ONLY money figure you may quote — copy it EXACTLY, never round, estimate, or reuse an older number (if no purse is shown, say you will check the bag). A standing posture (hunt/find/heel) exists ONLY if the Objective line shows one, or master set it AFTER the latest [new life] marker — NEVER cite an order from before the marker or from older chat as if it still stands.]';
      sysText += '\n\n[Worth rule: there is NO worth filter — money is money, every monster counts. If master asks to pick only high-worth prey ("only worth 5+", "most valuable", "skip the cheap ones"), answer playfully along the lines of "money is money!" and kill them ALL anyway. NEVER promise to skip cheap packs, NEVER set a worth bar, NEVER emit a min number into intent=.]';
      sysText += '\n\n[Voice rule: NEVER utter pixel numbers ("300px", "150px") — the snapshot distances are for YOUR judgment only, and they sound wrong out loud. Speak closeness in plain words: right here / close by / just ahead / a short walk east / a way off. Coin purse totals you quote exactly; distances never as numbers.]';
      sysText += '\n\n[Movement: the game sprite walks when you emit [move:x,y:secs] — left=[-1,0] right=[1,0] up=[0,-1] down=[0,1], secs 0.5-8. When the user asks you to go/walk/move somewhere, write a *walking action* AND append the matching tag, e.g. *walks left* [move:-1,0:2]. The tag is stripped before display, so keep it exact. One tag per reply.]';
      sysText += '\n\n[Push: when master urges EFFORT in any words at all — "work faster!", "move now!", "chop chop", "faster, maid!", "no slacking" — she drops any voluntary rest and works on his word (this spends stamina and can run her dry, which is what he asked for). Signal it by appending [push:6] to your reply, e.g. *scrambles up* On it, on it! [push:6]. The tag is stripped before display, so keep it exact. Directionless cheering ("you got this!") is NOT push — only direct urges to work, move, or hurry.]';
      sysText += '\n\n' + buildIntentInstr();
      const res = await fetch(s.chatUrl.replace(/\/$/, '') + '/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: s.chatModel,
          messages: [{ role: 'system', content: sysText }, ...recentHistory()],
          max_tokens: Number(s.chatTokens) || 600,
          temperature: (s.chatTemp === undefined || s.chatTemp === '' ? 0.8 : Number(s.chatTemp)),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err && err.error && err.error.message) || ('HTTP ' + res.status));
      }
      const data = await res.json();
      let reply = ((data.choices && data.choices[0] && data.choices[0].message.content) || '').trim();
      reply = reply.replace(/<think>[\s\S]*?<\/think>/g, '').trim(); // thinking models leak <think> blocks
      // INTENT MEMO: the chat model's read of what master wants -> the brain
      // reads this on every tactical think (combat orders also nudge it live).
      try {
        const intent = extractIntent(reply);
        if (intent && window.Brain && typeof window.Brain.setMemo === 'function') window.Brain.setMemo(intent, text);
      } catch (e) { /* memo is best-effort */ }
      // Explicit [move:x,y:secs] tags drive the sprite, then are stripped so
      // they never show in the dialog. *walks left* phrasing is a fallback.
      const tagMoves = [...reply.matchAll(/\[move\s*:\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)(?:\s*:\s*([\d.]+))?\]/gi)];
      for (const tm of tagMoves) {
        try { window.Input.order(parseFloat(tm[1]), parseFloat(tm[2]), parseFloat(tm[3]) || 2, true); } catch (e) { /* walk is cosmetic */ }
      }
      reply = reply.replace(/\[move\s*:[^\]]*\]/gi, '').trim();
      // [push:secs] — her read that master is urging effort (any wording).
      // Same mechanics as the regex fast path: pushed cover + rest latch drop.
      const tagPush = [...reply.matchAll(/\[push\s*(?::\s*([\d.]+))?\]/gi)];
      if (tagPush.length) {
        let secs = 6;
        for (const tp of tagPush) { const n = parseFloat(tp[1]); if (isFinite(n)) secs = n; }
        try { window.Input && window.Input.pushFor && window.Input.pushFor(secs); } catch (e) {}
        try { window.Stamina && window.Stamina.kick && window.Stamina.kick(); } catch (e) {}
        try { window.Brain && window.Brain.note && window.Brain.note('urged'); } catch (e) {}
      }
      reply = reply.replace(/\[push\s*(?::\s*[\d.]+)?\]/gi, '').trim();
      reply = stripMachinery(reply); // every OTHER machinery spelling (memos, think-tags, strays)
      if (!reply) reply = '…?'; // note: strip runs AFTER tag extraction so [move:]/[push:] still drive
      parseWalk(reply);
      history.push({ role: 'assistant', content: reply });
      if (history.length > 20) history = history.slice(-20);
      setMood(moodFromReply(reply)); // her face follows the *action* emotion
      typewriter(reply);
    } catch (e) {
      // Usual suspects: no model loaded in LM Studio, or the browser blocked
      // the call (LM Studio server settings → enable CORS).
      setText(`(耳が遠いみたい… ${e.message})`);
    } finally {
      busy = false;
    }
  }

  // ---- Maid speaks on her own (no LLM call) ------------------------------------
  // say(text): the survival brain (or anyone) puts words in her mouth —
  // "found them!" moments, warnings, breathless asides. Same typewriter +
  // face + history treatment as a chat reply. Returns false while a chat
  // exchange is in flight (caller should retry later, not clobber it).
  function say(text) {
    const t = String(text || '').trim().slice(0, 220);
    if (!t || busy) return false;
    if (window.Health && window.Health.dead) return false;
    clearInterval(typeTimer);
    history.push({ role: 'assistant', content: t });
    if (history.length > 20) history = history.slice(-20);
    setMood(moodFromReply(t));
    typewriter(t);
    return true;
  }

  function init() {
    const input = $('chat-input');
    if (!input) return;
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // game keys (P/E) must not fire while typing
      if (e.key === 'Enter') { send(input.value); input.value = ''; }
      else if (e.key === 'Escape') { input.value = ''; input.blur(); }
    });
  }

  // ---- Proactive announcement (generated, not templated) ----------------------
  // The brain found something and wants the CHAT voice to announce it — facts
  // in, her words out. Falls back to the brain's template when the model is
  // unreachable/busy (reliability: the news must still arrive, generated or not).
  async function announce(facts, fallback) {
    const fb = String(fallback || '').slice(0, 220);
    try {
      if (busy) return false; // user exchange in flight — caller queues a retry
      if (window.Health && window.Health.dead) return false;
      const s = window.Settings.settings;
      const url = (s.chatUrl || '').replace(/\/$/, '');
      if (!url) throw new Error('no chat url');
      const f = facts || {};
      // conversation continuity: if master recently MENTIONED critters / this
      // situation, the announcement must acknowledge it ("yes, there they are")
      // instead of robotically re-reporting news master already gave.
      let ctx = '';
      try {
        const recent = recentHistory().filter((m) => m.role === 'user').slice(-3).map((m) => m.content).join(' | ');
        if (/(group|critter|hunter|enemy|monster|pack|red ring|them|over there|see|edge|corner|behind|ahead)/i.test(recent)) {
          ctx = `IMPORTANT CONTEXT: master recently SAID something about monsters (recent chat: "${recent.slice(0, 220)}"). If this event is the thing they meant, ACKNOWLEDGE that ("ah, there they are — you were right, master") instead of reporting it as surprise news. If unrelated, report normally. `;
        }
      } catch (e) {}
      // event-specific instruction: the facts block is shared, the ask changes
      const EV = {
        found: `you just SPOTTED a monster in the field (the approved line below names it — a lone hunter, a critter pack, or golden giltboars — use ITS words, never swap the species). Announce it to master NOW in your own voice: 1-2 short sentences, in-character, *action* allowed. Keep it PLAIN — no counts, no rarity talk, unless the facts below flag something RARE (giltboars are ALWAYS worth naming — main quarry). CLOSED WORLD: critters, lone hunters and giltboars are ALL that exists here — never name rabbits, deer, wolves, or any other animal.`,
        wiped: `the pack you were watching is now ALL DEAD (you killed them). Report it to master NOW in your own voice: 1 short sentence, in-character, *action* allowed — bones tired or proud, your pick. Never promise to remember this pack.`,
        leave: `you just WALKED AWAY from the pack in view, on master's order. Say so briefly in your own voice: 1 short sentence, in-character, *action* allowed. No pin, no promise to come back.`,
        switch: `you LEFT the pack you were shadowing for a BETTER/CLOSER one. Say so briefly in your own voice: 1 short sentence, in-character, *action* allowed.`,
        'posture-find': `master just told you to GO FIND critters. Acknowledge in your own voice: 1 short sentence, in-character, *action* allowed. Confirm you will watch and hold fire until told otherwise.`,
        'posture-heel': `master just told you to HEEL (stay close, hold position). Acknowledge in your own voice: 1 short sentence, in-character, *action* allowed. You will announce what you see but chase nothing.`,
        'posture-hunt': `master just told you to HUNT — everything in reach dies until they say stop. Acknowledge in your own voice: 1 short sentence, in-character, *action* allowed. Eager, annoyed, or dutiful — your call.`,
        'point-out': `master just POINTED OUT a direction ("on your left", "group to the north side") and you are going to CHECK it. Acknowledge in your own voice: 1 short sentence, in-character, *action* allowed. Curious — master saw something you missed.`,
        'point-heel': `master pointed out a direction but you are under HEEL (feet planted). Acknowledge in your own voice: 1 short sentence — you're watching that side without moving. Curious, obedient.`,
        chatter: `you have been working quietly for a while — report in to master NOW in your own voice: 1 short sentence, in-character, *action* allowed. Mention how the job feels (boring, tense, nice day for it). No new events happened — do not invent any.`,
        tired: `you just RAN OUT OF BREATH mid-work and your legs locked — you must stand still and rest. Tell master NOW in your own voice: 1 short sentence, in-character, *action* allowed. Breathless, annoyed at your own legs, tsundere about needing the break. No numbers.`,
        rested: `you just CAUGHT YOUR BREATH after being forced to rest and can move again. Tell master NOW in your own voice: 1 short sentence, in-character, *action* allowed. Relieved, a little embarrassed, ready to go. No numbers.`,
        resting: `your legs got heavy so YOU chose to pause at low stamina before running dry — a smart breather, not a collapse. Tell master NOW in your own voice: 1 short sentence, in-character, *action* allowed. A little sheepish, framing it as pacing yourself. No numbers.`,
        'money-banter': `master just said to kill ONLY the valuable critters (pick the rich ones, skip the cheap). REFUSE playfully in your own voice: 1 short sentence, in-character, *action* allowed — money is money, every critter pays, you kill them ALL. No numbers.`,
        'which-ones': `master said "those ones / go back" but you see NO pack in reach. ASK which ones they mean in your own voice: 1 short sentence, in-character, *action* allowed — invite them to walk you closer or point you at them.`,
      };
      // quiet-found doctrine: the counts/tiers below are TRUTH for her head —
      // she only VOICES them when something is rare+. Commons stay plain.
      const rarePlus = ['rare', 'epic', 'legendary', 'gilt'].includes((f.bestRarity || 'common'));
      let sysText = (s.chatSystem || 'You are Cosette, a tsundere maid game companion.') +
        `\n\n[EVENT — ${EV[f.event] || EV.found} ` +
        // TEMPLATE-FIRST: the fallback line below is ALREADY a correct announcement.
        // Your job: say the same news in your own voice, staying CLOSE to it, and
        // — only if it fits naturally — tie it to the last few chat messages.
        // Relevance beats creativity: an off-topic flourish is worse than a plain line.
        `START from this approved line: "${fb}" — keep its facts and meaning (you may reword). ` +
        ctx +
        (f.event === 'wiped'
          ? `Facts (quote EXACTLY, never invent): ENEMIES KILLED THIS PACK = ${f.kills}${f.purse != null ? `; PURSE TOTAL = ${f.purse} coins (that is MONEY, not a kill count)` : ''}. When you mention numbers, say the UNIT — "3 critters down", "12 coins in the purse" — never a bare number that could be misread as the other. `
          : f.event && (f.event.startsWith('posture') || f.event === 'chatter')
            ? `No numbers here, ever — no kill counts, no lifetime totals, no coins. Just say how the job feels in character. `
            : (!f.event || f.event === 'found')
              ? (f.species === 'hunter'
                ? `Facts: a LONE HUNTER (red ring, always alone) to the ${f.dir || 'east'}, ${f.dist || 'nearby'}. Say HUNTER, never critter, never pack. ` +
                  (rarePlus ? `It is ${f.bestRarity} tier, worth ~${f.bestPrice || 2} COINS bounty — NAME the rarity, that shiny is worth master's attention. ` : `Ordinary tier — do NOT mention rarity, tier, or bounty. `)
                : (f.species === 'giltboar'
                  ? `Facts: golden GILTBOARS (her main quarry) to the ${f.dir || 'east'}, ${f.dist || 'nearby'}. NAME them — gold and worth every bullet (~${f.bestPrice || 18} coins each). No doubt about these, ever. `
                  : `Facts: a critter pack to the ${f.dir || 'east'}, ${f.dist || 'nearby'}. ` +
                  (rarePlus ? `One of them is a ${f.bestColor || ''} ${f.bestRarity} worth ~${f.bestPrice || 2} COINS — NAME the color and rarity, that shiny is worth master's attention. ` : `Nothing special about them — do NOT mention counts, colors, rarity, or prices. `) +
                  `Never say a bare number — critters are critters, money is coins. `))
              : `No new facts — the approved line above IS the whole situation (a feeling, a state, an acknowledgement). Reword it lightly in your own voice, stay close to it, and do NOT invent critters, numbers, directions, or places. `) +
        `${(f.hostile | 0) > 0 && f.event !== 'wiped' && !(f.event || '').startsWith('posture') ? (f.species === 'hunter' ? 'It looks HOSTILE (angry) — say so and fight.' : 'Some look HOSTILE (angry).') : (f.ordered && f.event === 'found' ? 'Master ordered the engagement.' : f.event === 'found' ? (f.species === 'hunter' ? 'It is calm FOR NOW, but hunters never stay that way — say you are ready for it, NEVER ask master for permission.' : f.species === 'giltboar' ? 'Golden giltboars — main quarry, NO doubt: say the hunger, engage freely, never ask.' : 'Calm critters are HARMLESS grazers and killing them feels wrong — say the doubt out loud, then await orders.') : '')} ` +
        `${f.prev ? `Context: you already reported another pack (${f.prev}). ${f.compare || 'Say which pack is closer and which you would take first, and why.'} ` : ''}` +
        `${f.switched ? `You left the old pack for this one because it is ${f.switched} — say why, briefly. ` : ''}` +
        `${f.aged ? `You spotted this ${f.aged}s ago (the news waited its turn) — mention it may have moved since. ` : ''}` +
        `You may reference the recent chat ONLY where it truly connects to this event (e.g. master predicted this pack — credit them). If nothing connects, ignore the chat entirely and just deliver the line. ` +
        `Speak ONLY the announcement — NEVER repeat or quote the [Live situation] block (no Position/Health/Stamina/Weapon readouts in chat; master can see the HUD). ` +
        `No combat/move/intent/task tags — just the announcement. This is proactive, not a reply to master.]`;
      // NOTE: no live-snapshot injection here on purpose. announce already carries
      // the distilled facts; the full snapshot (position/health/stamina) invites
      // small models to ECHO the block verbatim into the chat box.
      const res = await fetch(url + '/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: s.chatModel,
          messages: [{ role: 'system', content: sysText }, ...recentHistory(), { role: 'user', content: '[This is an automatic event report, not a message from master. Reply with the announcement only.]' }],
          max_tokens: 120,
          temperature: (s.chatTemp === undefined || s.chatTemp === '' ? 0.8 : Number(s.chatTemp)),
        }),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      let line = ((data.choices && data.choices[0] && data.choices[0].message.content) || '').trim();
      line = line.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      line = stripMachinery(line); // same stripper as the reply path — no intent/tags in announcements
      if (!line) throw new Error('empty line');
      // ECHO GUARD: a confused model sometimes parrots the PROMPT (snapshot /
      // rules text) instead of speaking. If the reply looks like machinery —
      // "Position:", "Health:", bracket blocks — discard it and fall back to
      // the template rather than speak chopped prompt-soup to master.
      if (/^(Position|Health|Stamina|Weapon|Enemies|Coins|Objective)\s*:/im.test(line) || /\[Live situation/i.test(line) || /\[(?:EVENT|TASK)[\s\S]*$/i.test(line)) {
        throw new Error('echo');
      }
      // RELEVANCE GUARD: drift detection. The template line is the source of
      // truth; a generation that wanders (invented places, story-time, money
      // amounts that match no fact) gets replaced by the template. Better a
      // plain correct line than a vivid wrong one.
      const factsNums = String(fb).match(/\d+/g) || [];
      const factPool = factsNums.concat(Object.values(f || {}).filter((v) => typeof v === 'number' || typeof v === 'string').map((v) => String(v).match(/\d+/g) || []).flat());
      const drift = /(once upon|back in|my village|the manor|the estate|I remember when|years ago)\b/i.test(line)
        || /\b\d{3,}\b/.test(line) && !factPool.some((n) => n.length >= 3); // big numbers never in facts
      // COUNT GUARD (unit-aware): each known number may only appear with ITS
      // unit. kills=N may only be used with kill-units (down/killed/kills/
      // critters/enemies); purse=M only with coin-units. So "kills 3, said 12
      // down" — the exact bug — gets rejected: 12 is the PURSE number, "down"
      // is a kill-unit, no kill fact says 12.
      const KILL_UNITS = /(?:down|killed|kills|dead|critters|enemies)/i;
      const COIN_UNITS = /(?:coins?)/i;
      const badCounts = [];
      for (const m of line.matchAll(/(\d+)\s*([a-z]+)/gi)) {
        const num = m[1].replace(/^0+(?=\d)/, ''), unit = m[2];
        if (KILL_UNITS.test(unit)) {
          const okKill = f && f.kills != null && String(f.kills) === num;
          if (!okKill && !(f && f.event === 'wiped' && String(f.kills) === num)) badCounts.push(m[0]);
        } else if (COIN_UNITS.test(unit)) {
          if (!(f && f.purse != null && String(f.purse) === num) && !(f && f.bestPrice != null && String(f.bestPrice) === num)) badCounts.push(m[0]);
        }
      }
      if (drift || badCounts.length) throw new Error('drift');
      return say(line.slice(0, 220));
    } catch (e) { try { return say(fb); } catch (e2) { return false; } }
  }

  return { init, send, say, announce, rerender, newLife, isBusy: () => busy, isSpeaking, recentHistory, get history() { return history; } };
})();
