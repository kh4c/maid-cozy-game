# Dev Log — Maid Cozy Game

Chronological record of what was built and why. Newest entries at the bottom.

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
