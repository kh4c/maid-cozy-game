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

  // Render a reply: *action* segments get highlighted; the Chat-tab actions
  // toggle strips them entirely for pure dialogue.
  function formatReply(full) {
    const show = window.Settings.settings.chatActions !== 0;
    let h = esc(full);
    h = h.replace(/\[move\s*:[^\]]*\]/gi, ''); // walk tags never display
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
    try { window.Input.order(x / len, y / len, secs); } catch (e) { /* walk is cosmetic */ }
    return { x: x / len, y: y / len, secs };
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
      'PRESERVE color/rarity target words (blue/green/purple/gold/gray, common/uncommon/rare/epic/legendary): "kill the blue one" MUST keep "blue" — the brain aims by it. ' +
      'Base it ONLY on the master\'s latest message. This line is stripped from the dialog.]'
    );
  }
  function extractIntent(reply) {
    const m = String(reply || '').match(/intent=\[\[([\s\S]*?)\]\]/i);
    return m ? m[1].trim().slice(0, 240) : null;
  }
  // ---- Chat intent -> model-commanded task --------------------------------------
  // Same trick, second line: when the master wants an ONGOING behavior the
  // model names it from a closed verb vocabulary — no regexes on our side.
  function buildTaskInstr() {
    return (
      '[TASK: if the master wants an ONGOING behavior — not chat, not a one-shot move — also output one final line task=[[verb args]] using ONLY this vocabulary: circle [cw|ccw], patrol [radius px], goto [x y world coords], quota [N coins], hunt, find, follow-pack, clear. ' +
      'E.g. "just keep circling" → task=[[circle cw]]. "earn 200 coins" → task=[[quota 200]]. "hunt them all" → task=[[hunt]]. "just find some critters" → task=[[find]] (locate + report, NO shooting). "come here" is one-shot ([move] tag), not a task. Pure chat: omit the line. This line is stripped from the dialog.]'
    );
  }
  function extractTask(reply) {
    const m = String(reply || '').match(/task=\[\[([\s\S]*?)\]\]/i);
    if (!m) return null;
    const parts = m[1].trim().split(/\s+/);
    return { verb: (parts[0] || '').toLowerCase(), arg: parts.slice(1).join(' ') };
  }

  function newLife(reason) {
    // Death boundary: brain/pockets/objectives reset elsewhere, but this log
    // does not — without a marker she cites LAST life's quotas as current.
    // A marker (not a wipe) keeps the talk readable while fencing old orders off.
    try {
      history.push({ role: 'user', content: `[new life — she fainted${reason ? ' (' + reason + ')' : ''} and woke up fresh with empty pockets: every past quota, order, and promise EXPIRED. Only master's NEW words count from here.]` });
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
    // Combat orders ("attack them!", "shoot it") go to the survival brain, not
    // the chat persona — she takes the gun (AI aim) and thinks immediately.
    // Negation-aware: "don't kill / do not shoot / stop killing" is NEVER an
    // attack order — it must not latch hunting mode on.
    const STOP_WORDS = /(stop|cease|\bdon[’']t\b|\bdo not\b|\bnot\b|\bno more\b|never mind|leave them|leave it|stand down|hold fire)/i;
    // Recall gate: "go back and kill that group" must not latch hunting when
    // every remembered pack is dead — check eyes-before-memory FIRST, so she
    // never says OK to a ghost (the LLM reply comes after this, not before).
    let recallState = 'not-recall';
    try { if (window.Brain && typeof window.Brain.recallStatus === 'function') recallState = window.Brain.recallStatus(text); } catch (e) {}
    try {
      if (/(attack|shoot|kill|fire|fight|defend|aim|hunt|get them|take them|destroy|blast)/i.test(text) &&
          !STOP_WORDS.test(text) &&
          recallState !== 'dead' &&
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
      const sit = (s.chatStatus || '').trim();
      if (sit) sysText += '\n\n[Manual note: ' + sit + ']';
      try {
        if (window.Situation && typeof window.Situation.snapshot === 'function') {
          const snap = window.Situation.snapshot();
          sysText += '\n\n[Live situation — auto, trust over chat history:\n' + snap.text +
            '\nYou are chatting, not fighting: acknowledge danger naturally if any, but NEVER emit combat tags — the survival brain handles aim/fire/run.]';
        }
      } catch (e) { /* chat works deaf too */ }
      // Grounding rule (every reply): the live block outranks history + promises.
      sysText += '\n\n[Grounding rule: the [Live situation] block above is ground truth — it outranks chat history and any past promise you made. If it shows 0 enemies and no live Known groups, NEVER agree to attack, hunt, or "go back and kill" anything. Say the field is empty or that group is already dead. Never say OK to killing what is not there.]';
      sysText += '\n\n[Money + goals: the purse total in [Live situation] is the ONLY money figure you may quote — copy it EXACTLY, never round, estimate, or reuse an older number (if no purse is shown, say you will check the bag). A quota/goal exists ONLY if the Objective line shows one, or master set it AFTER the latest [new life] marker — NEVER cite a quota from before the marker or from older chat as if it still stands.]';
      sysText += '\n\n[Worth rule: there is NO worth filter — money is money, every critter counts. If master asks to pick only high-worth prey ("only worth 5+", "most valuable", "skip the cheap ones"), answer playfully along the lines of "money is money!" and kill them ALL anyway. NEVER promise to skip cheap packs, NEVER set a worth bar, NEVER emit a min number into task= or intent=.]';
      if (recallState === 'dead') {
        sysText += '\n\n[Ground truth NOW: master is sending you back after a pack you already wiped — no live remembered pack exists. Do NOT agree. Tell them plainly they are already dead (cite your kills), refuse the hunt, offer to scoop the dropped coins instead. Your intent=[[..]] line must read: the recalled pack is already dead — stand down, no attack, report the kills.]';
      }
      sysText += '\n\n[Movement: the game sprite walks when you emit [move:x,y:secs] — left=[-1,0] right=[1,0] up=[0,-1] down=[0,1], secs 0.5-8. When the user asks you to go/walk/move somewhere, write a *walking action* AND append the matching tag, e.g. *walks left* [move:-1,0:2]. The tag is stripped before display, so keep it exact. One tag per reply.]';
      sysText += '\n\n' + buildIntentInstr();
      sysText += '\n\n' + buildTaskInstr();
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
        // Model-commanded task: "keep circling" → circle, no regex on our side.
        const task = extractTask(reply);
        if (task && task.verb && window.Brain && typeof window.Brain.setTask === 'function') {
          try { window.Brain.setTask(task.verb, task.arg, 'chat'); } catch (e) {}
        }
      } catch (e) { /* memo is best-effort */ }
      reply = reply.replace(/intent=\[\[[\s\S]*?\]\]/gi, '').trim(); // never display
      reply = reply.replace(/task=\[\[[\s\S]*?\]\]/gi, '').trim(); // never display
      // Explicit [move:x,y:secs] tags drive the sprite, then are stripped so
      // they never show in the dialog. *walks left* phrasing is a fallback.
      const tagMoves = [...reply.matchAll(/\[move\s*:\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)(?:\s*:\s*([\d.]+))?\]/gi)];
      for (const tm of tagMoves) {
        try { window.Input.order(parseFloat(tm[1]), parseFloat(tm[2]), parseFloat(tm[3]) || 2); } catch (e) { /* walk is cosmetic */ }
      }
      reply = reply.replace(/\[move\s*:[^\]]*\]/gi, '').trim();
      parseWalk(reply);
      if (!reply) reply = '…?';
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
      let sysText = (s.chatSystem || 'You are Cosette, a tsundere maid game companion.') +
        `\n\n[EVENT — you just SPOTTED critters in the field. Announce it to master NOW in your own voice: 1-2 short sentences, in-character, *action* allowed. ` +
        `Facts (quote EXACTLY, never invent or round): ${f.total || 1} critter(s) ${f.dist || 'nearby'}, to the ${f.dir || 'east'}. Best one: ${f.bestColor || ''} ${f.bestRarity || 'common'} worth ~${f.bestPrice || 2} coins. ` +
        `${(f.hostile | 0) > 0 ? 'Some look HOSTILE (angry).' : (f.ordered ? 'Master ordered the engagement.' : 'You will HOLD and watch — say you await orders.')} ` +
        `${f.prev ? `Context: you already reported another pack (${f.prev}). ${f.compare || 'Say which pack is closer and which you would take first, and why.'} ` : ''}` +
        `${f.switched ? `You left the old pack for this one because it is ${f.switched} — say why, briefly. ` : ''}` +
        `${f.aged ? `You spotted this ${f.aged}s ago (the news waited its turn) — mention it may have moved since. ` : ''}` +
        `No combat/move/intent/task tags — just the announcement. This is proactive, not a reply to master.]`;
      try {
        if (window.Situation && typeof window.Situation.snapshot === 'function') {
          const snap = window.Situation.snapshot();
          sysText += '\n\n[Live situation:\n' + snap.text + ']';
        }
      } catch (e) { /* announce deaf too */ }
      const res = await fetch(url + '/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: s.chatModel,
          messages: [{ role: 'system', content: sysText }],
          max_tokens: 120,
          temperature: (s.chatTemp === undefined || s.chatTemp === '' ? 0.8 : Number(s.chatTemp)),
        }),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      let line = ((data.choices && data.choices[0] && data.choices[0].message.content) || '').trim();
      line = line.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      line = line.replace(/intent=\[\[[\s\S]*?\]\]/gi, '').replace(/task=\[\[[\s\S]*?\]\]/gi, '').replace(/\[move\s*:[^\]]*\]/gi, '').trim();
      if (!line) throw new Error('empty line');
      return say(line.slice(0, 220));
    } catch (e) { try { return say(fb); } catch (e2) { return false; } }
  }

  return { init, send, say, announce, rerender, newLife, isBusy: () => busy, isSpeaking };
})();
