// Bootstrap: init Pixi app, build world, run the game loop. Classic script.
(async () => {
  function reportError(msg) {
    const el = document.getElementById('hud');
    el.innerHTML += `<br><span style="color:#ff6b6b">ERROR: ${msg}</span>`;
    console.error(msg);
  }
  window.addEventListener('error', (e) => reportError(e.message));

  const { Application, Container } = PIXI;
  const cfg = window.CONFIG;

  // ---- App -------------------------------------------------------------------
  const app = new Application();
  await app.init({ width: 1280, height: 720, backgroundColor: '#1a1730' });
  document.getElementById('stage-wrap').appendChild(app.canvas);
  // Fixed 16:9 scene: scale the canvas with CSS to fit any window (letterboxed).
  function fitCanvas() {
    const s = Math.min(window.innerWidth / 1280, window.innerHeight / 720);
    app.canvas.style.width = `${Math.floor(1280 * s)}px`;
    app.canvas.style.height = `${Math.floor(720 * s)}px`;
  }
  fitCanvas();
  window.addEventListener('resize', fitCanvas);

  // ---- World -------------------------------------------------------------------
  const world = new Container();
  app.stage.addChild(world);

  // ---- Background (infinite chunk stream) -----------------------------------------
  let background;
  try {
    background = await window.Tilemap.create();
    world.addChild(background.layer);
    document.getElementById('bg-status').textContent = 'bg ✓';
  } catch (err) {
    reportError('background failed: ' + err.message);
  }

  // ---- Character -----------------------------------------------------------------
  let character;
  try {
    const { idleFrames, runFrames } = await window.Assets.loadSheets();
    character = window.Entities.createCharacter(idleFrames, runFrames);
    character.applySettings();
    world.addChild(character.view);
  } catch (err) {
    reportError('character failed: ' + err.message);
    return;
  }

  // ---- Camera ---------------------------------------------------------------------
  const camera = window.Camera.create(world, app);
  camera.snap(character.view.x, character.view.y);

  // ---- Sunrays + dust motes (screen-space overlay, above character) -----------------
  let effects;
  try {
    effects = window.Effects.create(app);
    app.stage.addChild(effects.layer);
  } catch (err) {
    reportError('effects failed: ' + err.message);
  }

  // ---- Dev panel --------------------------------------------------------------------
  window.Settings.buildPanel((key) => { if (key === 'scale' || key.endsWith('Fps')) character.applySettings(); });
  character.applySettings();

  // ---- Sound manager (BGM + gear volume panel; starts on first gesture) --------------
  try {
    window.Sound.init();
  } catch (err) {
    reportError('audio failed: ' + err.message);
  }

  // ---- Game loop -----------------------------------------------------------------------
  let fpsAccum = 0, fpsCount = 0, fpsTimer = 0;
  const fpsEl = document.getElementById('fps');
  const chunkEl = document.getElementById('bg-status');

  app.ticker.add((ticker) => {
    // clamp dt: this pane throttles hard when unfocused — spikes teleport the character
    const dtSec = Math.min(ticker.deltaMS / 1000, 0.05);
    const s = window.Settings.settings;

    const a = window.Input.axis();
    const view = character.view;
    view.x += a.x * s.speed * dtSec;
    view.y += a.y * s.speed * dtSec;

    // INFINITE world: no bounds clamping — background chunks stream in around the camera
    character.update(a);
    camera.update(view.x, view.y, dtSec);

    if (background) {
      const n = background.update(view.x, view.y, app.screen.width, app.screen.height);
      chunkEl.textContent = `chunks ${n}`;
    }

    if (effects) effects.update(dtSec);

    // fps readout
    fpsAccum += dtSec; fpsCount++; fpsTimer += dtSec;
    if (fpsTimer >= 0.5) {
      fpsEl.textContent = `${Math.round(fpsCount / fpsAccum)} fps`;
      fpsAccum = 0; fpsCount = 0; fpsTimer = 0;
    }
  });

  console.log('Maid test ready — infinite world build');
})();
