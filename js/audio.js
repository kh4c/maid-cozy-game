// SoundManager — Web Audio API bus architecture.
//   master Gain -> buses: bgm / voice / combat (each its own GainNode).
// BGM loops on the bgm bus; future SFX route to a named bus via playSfx().
// Autoplay policy: context starts suspended; first keypress/click resumes it
// and starts the BGM. Volumes persist in localStorage ('maid-audio-settings').
window.Sound = (() => {
  const STORE_KEY = 'maid-audio-settings';
  const DEFAULTS = { master: 0.8, bgm: 0.6, voice: 0.9, combat: 0.9, muted: false };

  let ctx = null;          // AudioContext (created suspended)
  let masterGain = null;
  const buses = {};       // name -> GainNode
  let bgmSource = null;   // looping BufferSource for the current track
  let bgmName = 'cozy';   // BASE mood: 'cozy' | 'night' — this loop never stops for combat, only ducks
  let bgmToken = 0;       // races between slow decodes and fast mood flips
  let bgmPending = null;  // base mood currently being decoded — repeat calls wait
  let battleSource = null; // BATTLE layer: stacked on top while hot, gone when calm
  let battlePending = false;
  let inBattle = false;
  const BASE_DUCK = 0.25; // base loop level under battle — still playing, never replayed
  const BGM_URLS = { cozy: 'assets/Cozy1.mp3', battle: 'assets/battle1.mp3', night: 'assets/Cozy1_night.mp3' };
  const bgmCache = {};    // mood -> AudioBuffer (switching never re-decodes)
  let started = false;    // first user gesture handled

  let settings = load();

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return { ...DEFAULTS };
      const p = JSON.parse(raw);
      return {
        master: clamp01(p.master ?? DEFAULTS.master),
        bgm: clamp01(p.bgm ?? DEFAULTS.bgm),
        voice: clamp01(p.voice ?? DEFAULTS.voice),
        combat: clamp01(p.combat ?? DEFAULTS.combat),
        muted: !!p.muted,
      };
    } catch { return { ...DEFAULTS }; }
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch {}
  }

  const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

  // ---- graph ---------------------------------------------------------------
  function buildGraph() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ctx.createGain();
    masterGain.connect(ctx.destination);
    for (const name of ['bgm', 'voice', 'combat']) {
      const g = ctx.createGain();
      g.connect(masterGain);
      buses[name] = g;
    }
    applyVolumes();
  }

  function applyVolumes() {
    if (!ctx) return;
    masterGain.gain.value = settings.muted ? 0 : settings.master;
    for (const name of ['bgm', 'voice', 'combat']) buses[name].gain.value = settings[name];
  }

  // ---- BGM -------------------------------------------------------------------
  async function loadBgm(url) {
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    return ctx.decodeAudioData(buf); // decoding needs no user gesture
  }

  const BGM_XF = 2.0; // crossfade seconds — moods melt, never cut
  function startTrack(buffer) {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(g);
    g.connect(buses.bgm);
    src.start(0);
    g.gain.setTargetAtTime(1.0, ctx.currentTime, BGM_XF / 3); // ~2s swell
    src._gain = g;
    return src;
  }

  function fadeStop(src) {
    if (!src) return;
    try {
      const g = src._gain;
      if (g) {
        g.gain.cancelScheduledValues(ctx.currentTime);
        g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.6); // duck out ~1.5s
      }
      setTimeout(() => {
        try { src.stop(); } catch (e) {}
        try { src._gain && src._gain.disconnect(); } catch (e) {}
      }, 2500);
    } catch (e) { try { src.stop(); } catch (e2) {} }
  }

  async function startBgm() {
    if (bgmSource) return;
    try { if (bgmName === 'cozy' && window.Settings && Number(window.Settings.settings.worldTime) === 1) bgmName = 'night'; } catch (e) {} // boot at night, start at night
    const buffer = await loadBgm(BGM_URLS[bgmName] || BGM_URLS.cozy);
    bgmCache[bgmName] = buffer;
    bgmSource = startTrack(buffer); // swells in like a switch
  }

  // Combat music, STACKED not switched: the base loop (cozy/night) keeps
  // playing underneath at BASE_DUCK while the battle loop rides on top — so
  // when calm returns the song resumes mid-phrase instead of replaying.
  // Same bus/slider, no-op on repeat, stale decodes guarded.
  async function setBgmMood(mood) {
    if (!ctx || (mood !== 'cozy' && mood !== 'battle' && mood !== 'night')) return;
    if (mood === 'battle') {
      if (inBattle && (battleSource || battlePending)) return; // already stacked
      inBattle = true;
      battlePending = true;
      try { if (bgmSource && bgmSource._gain) bgmSource._gain.gain.setTargetAtTime(BASE_DUCK, ctx.currentTime, 0.4); } catch (e) {} // base ducks, keeps her place
      try {
        let buffer = bgmCache.battle;
        if (!buffer) {
          buffer = await loadBgm(BGM_URLS.battle);
          bgmCache.battle = buffer;
        }
        if (!inBattle) { battlePending = false; return; } // calmed mid-decode — stay quiet
        if (!battleSource) battleSource = startTrack(buffer);
        try { battleSource._gain.gain.setTargetAtTime(1.0, ctx.currentTime, BGM_XF / 3); } catch (e) {}
      } catch (e) { console.warn('BGM battle layer failed', e); }
      finally { battlePending = false; }
      return;
    }
    // calm: drop the battle layer, base swells back mid-song — no replay, ever.
    inBattle = false;
    const b = battleSource; battleSource = null;
    if (b) {
      try { b._gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.4); } catch (e) {}
      setTimeout(() => { try { b.stop(); } catch (e) {} try { b._gain && b._gain.disconnect(); } catch (e) {} }, 2000);
    }
    try { if (bgmSource && bgmSource._gain) bgmSource._gain.gain.setTargetAtTime(1.0, ctx.currentTime, BGM_XF / 3); } catch (e) {}
    if (mood === bgmName && (bgmSource || bgmPending)) return;
    // same mood playing OR already decoding it -> do nothing (the game loop
    // calls this every frame; without the pending guard it would stack a
    // fresh 5MB fetch+decode per frame and tank combat fps)
    if (mood === bgmName && (bgmSource || bgmPending)) return;
    bgmName = mood;
    bgmPending = mood;
    const my = ++bgmToken;
    const old = bgmSource;
    bgmSource = null;
    fadeStop(old);
    try {
      let buffer = bgmCache[mood];
      if (!buffer) {
        buffer = await loadBgm(BGM_URLS[mood]);
        bgmCache[mood] = buffer;
      }
      if (my !== bgmToken) return; // flipped again mid-decode — old already fading, nobody starts
      bgmSource = startTrack(buffer);
    } catch (e) { console.warn('BGM switch failed', e); }
    finally { if (bgmPending === mood) bgmPending = null; }
  }

  // Decode the off-moods in the background after first gesture, so the
  // first real switch mid-fight (or at dusk) has zero decode hitch.
  function warmBgmCache() {
    if (!ctx) return;
    for (const m of ['battle', 'night']) {
      if (bgmCache[m]) continue;
      loadBgm(BGM_URLS[m]).then((b) => { bgmCache[m] = b; }).catch(() => {});
    }
  }

  // ---- first-gesture start -----------------------------------------------------
  function onFirstGesture() {
    if (started) return;
    started = true;
    ctx.resume().then(() => { startBgm(); warmBgmCache(); }).catch(console.warn);
  }

  // ---- UI: gear button + volume panel ------------------------------------------
  let panel, sliders = {}, muteBox;

  function buildUI() {
    const btn = document.getElementById('gear-btn');
    panel = document.getElementById('audio-panel');
    if (!btn || !panel) return;

    for (const name of ['master', 'bgm', 'voice', 'combat']) {
      const s = document.getElementById(`vol-${name}`);
      sliders[name] = s;
      s.value = Math.round(settings[name] * 100);
      s.addEventListener('input', () => {
        settings[name] = clamp01(s.value / 100);
        if (settings.muted && name === 'master' && settings.master > 0) {
          settings.muted = false; if (muteBox) muteBox.checked = false;
        }
        applyVolumes(); save();
      });
    }
    muteBox = document.getElementById('audio-mute');
    muteBox.checked = settings.muted;
    muteBox.addEventListener('change', () => {
      settings.muted = muteBox.checked;
      applyVolumes(); save();
    });

    btn.addEventListener('click', (e) => {
      // edit mode owns the button while active (drag = move) — don't open the panel
      if (window.EditMode && window.EditMode.active) { e.stopPropagation(); return; }
      e.stopPropagation();
      panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
    });
  }

  // ---- public API ---------------------------------------------------------------
  function init() {
    buildGraph();
    buildUI();
    window.addEventListener('keydown', onFirstGesture);
    window.addEventListener('pointerdown', onFirstGesture);
  }

  // Future SFX: Sound.playSfx('combat', 'hit') — loads assets/sfx/combat_hit.ogg,
  // plays it once through the named bus. Buffers are cached (hits come fast),
  // opts.rate bends pitch (randomize per hit), opts.volume scales loudness.
  const sfxCache = {}; // url -> AudioBuffer
  async function playSfx(busName, file, opts) {
    if (!ctx || !buses[busName]) return;
    const o = opts || {};
    const url = `assets/sfx/${file}`;
    try {
      let buf = sfxCache[url];
      if (!buf) {
        const res = await fetch(url);
        buf = await ctx.decodeAudioData(await res.arrayBuffer());
        sfxCache[url] = buf;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = o.rate || 1;
      let out = buses[busName];
      if (o.volume !== undefined) {
        const g = ctx.createGain();
        g.gain.value = Math.max(0, Math.min(1.5, o.volume));
        g.connect(out);
        out = g;
      }
      src.connect(out);
      src.start(0);
    } catch (e) { console.warn(`SFX failed: ${url}`, e); }
  }

  return { init, playSfx, setBgmMood, debug };

  function debug() {
    return {
      started,
      ctxState: ctx ? ctx.state : 'no-ctx',
      bgmPlaying: !!bgmSource,
      settings,
    };
  }
})();
