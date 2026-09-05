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

  async function startBgm() {
    if (bgmSource) return;
    const buffer = await loadBgm('assets/Cozy1.mp3');
    bgmSource = ctx.createBufferSource();
    bgmSource.buffer = buffer;
    bgmSource.loop = true;
    bgmSource.connect(buses.bgm);
    bgmSource.start(0);
  }

  // ---- first-gesture start -----------------------------------------------------
  function onFirstGesture() {
    if (started) return;
    started = true;
    ctx.resume().then(() => startBgm()).catch(console.warn);
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

  return { init, playSfx, debug };

  function debug() {
    return {
      started,
      ctxState: ctx ? ctx.state : 'no-ctx',
      bgmPlaying: !!bgmSource,
      settings,
    };
  }
})();
