# Dev Log — Maid Cozy Game

Chronological record of what was built and why. Newest entries at the bottom.

---

## 2026-09-05 — Live2D maid companion (pixi-live2d5 + Cubism 5) with drag/wheel placement tool

**Goal:** show the Cubism 5 Maid model as an upper-body companion on top of the grassland game, with a dev tool to move/resize it and persist the placement.

### Done
- **Adopted `pixi-live2d5`** (omniwaifu fork — the PixiJS v8 + Cubism 5 branch of pixi-live2d-display). The previously vendored `live2d-cubism.min.js` was an older UMD engine that never worked with v8's renderer; it has been removed.
- **Built the fork from source** (no npm release, no GitHub releases): `git clone --recursive` (pulls the CubismWebFramework submodule), extracted `Core/live2dcubismcore.js` + `.d.ts` from the local `CubismSdkForWeb-5-r.5.zip` into `core/` (the step `bun run setup` would normally do — no bun on this machine, plain `npm install --ignore-scripts` + `node scripts/build.js` worked). Produced `dist/cubism5.min.js` (UMD → `PIXI.live2d`), copied to `vendor/`.
- **Shaders:** Cubism R5 fetches 13 GLSL files at render time from `/cubism5/shaders/` — copied from the SDK zip to `cubism5/shaders/` at the project root so both `http://` and `maid://` resolve it. Added `.json/.moc3/.frag/.vert` MIME types to `electron-main.js`.
- **Model check:** `Maid.moc3` header byte is `05` (true Cubism 5 moc) — ideal for this fork. Model has physics + EyeBlink groups, no motions (idle sway comes from physics).
- **Wiring:** `index.html` loads pixi → `live2dcubismcore.min.js` → `cubism5.min.js` → `js/live2d.js` (new) before `main.js`. `Live2DModel.registerTicker(PIXI.Ticker)` + `autoUpdate: true` drive physics/blink; `autoHitTest/autoFocus` off.
- **Upper-body framing:** anchor `(0.5, 0)` (top-center = the head), scale computed from the model's measured natural height so **zoom 1.0 = model is 2× screen height** — head + torso fill the frame, legs run below the edge. Resolution-independent: same fractions work at any window size.
- **Placement tool:** drag the maid to move, mouse wheel over her to resize (5% steps, clamped 0.1–2). Writes into live settings → `Settings.refreshControls()` keeps the P-panel sliders in sync → `Settings.saveSoon()` debounced-save to localStorage. Required Pixi v8 event plumbing: `stage.eventMode='static'` + `stage.hitArea=app.screen` before children hit-test. Wheel is scoped to model bounds via `getBounds().containsPoint`, canvas coords converted from DOM pointer coords through the letterbox scale.
- **Persisted settings:** `l2dOn/l2dZoom/l2dx/l2dy` join the dev-panel settings; position tuned live (zoom 1, x 0.8, y 0.12) and baked into `config.js` defaults. User's tuned speed 300 / idleFps 8 / runFps 6 / scale 2.5 also baked in.
- Settings remain a JSON blob in `localStorage` (`maid-test-settings`); README documents the Live2D stack + tool.

### Technical notes worth keeping
- The UMD build of pixi-live2d5 attaches to `PIXI.live2d` but does **not** auto-register a render pipe under v8 like the old lib claimed — instead it uses `renderPipeId = "customRender"` and registers its WebGL context system via `extensions.add` at import time. Loading order (pixi → core → plugin) is the only requirement.
- `Live2DModel.from()` needs `window.Live2DCubismCore` present (checked at import); the Core from the SDK zip is byte-identical to what the fork's setup script downloads (sha-verified archive).
- Pixi v8: children are only hit-tested when the **stage** is `eventMode='static'` with a hitArea — setting it on the child alone does nothing.
- `model.height` at scale 1 gives the natural model height in px; measure it right after load (before any scaling) and cache it.

---

## 2026-09-04 — Electron desktop wrapper, offline assets, scene scaling, audio UI placement

**Goal:** make the game a standalone desktop app (no browser tab), fix port conflict with llama.cpp, and anchor UI to the play screen.

### Done
- **Electron main process** (`electron-main.js`): serves the whole project over a custom `maid://` protocol backed by disk — no TCP port at all, so it's immune to Windows loopback-port reservations (the original `listen EACCES: permission denied 127.0.0.1` crash) and works fully offline.
- **Electron 44 API fix:** `protocol.registerSchemesAsStandard` was removed in newer Electron; code now guards both `registerSchemesAsPrivileged` (new) and the old name, so it runs on any version. Scheme registered with `{ standard: true, supportFetchAPI: true, codeCache: true }` before app-ready so relative URLs + XHR/fetch behave like http.
- **Vendored PixiJS v8** into `vendor/pixi.min.js` (819 KB) — the page no longer depends on a CDN; browser and desktop both load the local file.
- **Port change:** dev server moved 8090 → **8095** (user uses 8090 for llama.cpp). Electron app needs no port at all.
- **Fixed 16:9 scene:** internal render locked at 1280×720; CSS scales the canvas to fit any window size (letterboxed), and `body` pins it to the top so the play screen always aligns on top. Resize listener keeps it fitted.
- **Gear icon relocated** into a new `#stage-wrap` container that wraps the canvas — the ⚙ button and audio panel are now positioned relative to the *play screen* (top-right corner of the grassland), not the browser window, so they track the scene at any window size.
- **README rewritten:** both run paths documented (`npm start` desktop / python server browser dev), controls table incl. gear icon, SoundManager architecture, Electron API note.

### How to run now
```bash
cd maid-test && npm install   # once
npm start                     # opens the game in its own window
```

---

## 2026-09-04 — SoundManager + BGM (earlier same day)

**Goal:** looping background music with a proper channel architecture for future voice/combat SFX, plus user-adjustable volume.

### Done
- **`js/audio.js` — SoundManager on Web Audio API:** one `AudioContext` → master GainNode → three buses (`bgm`, `voice`, `combat`), each its own GainNode. Future sounds route via `Sound.playSfx('channel', 'file.ogg')` with zero rewiring.
- **BGM:** `assets/Cozy1.mp3` (from `GameAsset/bgm/`) decoded and looped on the bgm bus. Starts on first keypress/click — browser autoplay policy blocks audio before any user gesture; this is expected behavior, not a bug.
- **Gear icon + volume panel** (`#gear-btn`, `#audio-panel`): Master / BGM / Voice / Combat sliders + mute-all checkbox; values persist in localStorage under `maid-audio-settings`.
- **GitHub:** project pushed to `github.com/kh4c/maid-cozy-game` (renamed from initial `maid-test`; GitHub slugs can't contain spaces).

---

## 2026-09-04 — Core game build (earlier same day)

**Goal:** chibi-maid character on an infinite grassland, smooth camera, cinematic light.

### Done
- **PixiJS v8 browser game**, split into modules (`js/*.js`), classic scripts, no build step.
- **Sprite sheets** (user-provided, in `assets/`): idle 256×192 → 9 opaque frames @ 64×64; run 256×128 → 7 opaque frames @ 64×64. Slicing counts only *opaque* cells — the sheet's last row has empty grid cells that must not be sliced (was a blink bug).
- **Character** (`js/entities.js`): root > [shadow, body(flip+tilt) > idle/run AnimatedSprites]. 8-way facing via horizontal flip + ~12° lean toward vertical movement; shadow is a sibling of the body so it stays flat on the ground. Idle/run state machine restarts from frame 0 only on state change.
- **Infinite map** (`js/tilemap.js`): streams 1254×1254 grassland chunks around the camera, destroys off-screen ones — memory stays flat at any distance. Background is the user's `grassland background.png`, no Kenney assets this project.
- **Camera** (`js/camera.js`): frame-rate-independent exponential lerp `t = 1 - e^(-k·dt)`, k=8, clamped dt (50 ms).
- **Cinematic overlay** (`js/effects.js`): sun glow top-left + drifting dust motes + faint warm grade. Light-shaft beams were added then **disabled** (`BEAMS_ON = false`) — user found them too intense and flickering; particles kept, rays off. Flag exists to re-enable later.
- **Dev panel** (hotkey `P`, hidden by default): speed / idleFps / runFps / scale / sunray sliders, persisted in localStorage (`maid-test-settings`).
- **Input:** WASD + arrows, diagonal normalized; movement 260 px/s baseline.

### Technical notes worth keeping
- PixiJS v8 `ticker.deltaTime` is **frame-units** (1 at 60 fps), not seconds — the loop converts with `deltaMS / 1000`.
- v8 texture slicing uses `baseTex.source` (TextureSource), not the old `.texture` chain.

---

## Asset provenance

| Asset | Source |
|-------|--------|
| `assets/SG_Maid_Idle.png`, `assets/SG_Maid_Run.png` | User-provided sprite sheets (`GameAsset/Maid/`) |
| `assets/grassland.png` | User-provided background (`GameAsset/grassland background.png`) |
| `assets/Cozy1.mp3` | User-provided BGM (`GameAsset/bgm/`) |
| `vendor/pixi.min.js` | PixiJS v8 UMD, vendored from CDN (offline) |

No procedurally generated assets — everything is a real downloaded/user file.
