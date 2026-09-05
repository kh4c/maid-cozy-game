# Maid Cozy Game

A chibi-maid cozy grassland game built with **PixiJS v8** — no build step, plain classic scripts. Runs in a browser or as a standalone desktop app via **Electron**.

Walk a white-haired maid across an **infinite grassland** with smooth camera follow, 8-way facing tilt, a live dev panel, looping BGM + per-channel volume settings (gear icon), and a cinematic sun-glow + drifting dust-particle overlay.

She isn't a puppet — she's played by **two local-LLM minds**: a chat persona you talk to, and a tactical survival brain that senses the field, aims her gun, keeps her distance, and obeys your orders in-character. You oversee; she acts.

> Needs a local OpenAI-compatible server (LM Studio default `http://127.0.0.1:1234`) for chat + brain. Everything else runs offline.

## Run it — two ways

### A) Desktop app (Electron)
```bash
npm install        # once; installs electron into node_modules
npm start          # opens the game in its own window
```
The Electron main process (`electron-main.js`) serves the project over a custom `maid://` protocol straight from disk — **no port, no server**, so it works fully offline and can't collide with anything else on your machine.

### B) Browser (dev / hot-reload)
You need a local HTTP server (PixiJS loads assets over `fetch`, blocked on `file://`). From this folder:
```bash
python -m http.server 8095 --bind 127.0.0.1
# then open http://127.0.0.1:8095/
```

## Controls

| Key | Action |
|-----|--------|
| `WASD` / Arrows | Move (diagonal normalized) |
| `P` | Toggle dev panel |
| Chat box | Talk to her — move orders (`go left`, `find some critters`), attack orders (`attack them!`), `stop`. She replies in character AND acts |
| 💭 button | Her tactical brain thinks immediately (thought box, bottom-right) |
| 🛡️ AUTO button | Auto-think when danger nears (off = she only thinks on 💭) |
| 🎒 bag (bottom-right) | Open the coin inventory |
| ⚙ gear (top-right of scene) | Audio settings: Master/BGM/Voice/Combat sliders + mute |

Dev panel sliders (saved to `localStorage`, key `maid-test-settings`): **speed**, **idleFps**, **runFps**, **scale**, **sunray**, plus the Live2D placement keys **l2dOn / l2dZoom / l2dx / l2dy**.
Audio volumes persist under `localStorage` key `maid-audio-settings`.

## Live2D maid companion

A Cubism 5 Live2D model (`assets/live2d/Maid/`, moc3 v5) renders as a screen-space **upper-body companion**: scaled to 2× screen height so head + torso fill the frame and the legs fall below the edge.

Stack: **[pixi-live2d5](https://github.com/omniwaifu/pixi-live2d5)** (PixiJS v8 + Cubism 5 fork) — built from source with npm into `vendor/cubism5.min.js` (UMD, exposes `PIXI.live2d`). Cubism runtime is `vendor/live2dcubismcore.min.js` from the local `CubismSdkForWeb-5-r.5` SDK. R5 fetches 13 GLSL shader files at render time from `cubism5/shaders/` at the project root.

**Placement tool** — drag the maid to move her, scroll the mouse wheel over her to resize. Edits write into the live settings, sync the dev-panel sliders, and **auto-save** to localStorage (debounced 400 ms). Tune it once and the browser remembers; `js/config.js` `defaults` holds the shipped position.

## Features

- **Maid autonomy (two local-LLM minds)** — a chat persona (dialog box) + a tactical survival brain (💭 thought box, own history). The brain gets a live snapshot every think: position, HP, gun state, enemies within 500px, stamina. It fights, flees, or holds; chat intent flows into it as a standing memo. Per-life memory (kills/bites/flees) resets on death.
- **She owns the gun** — M1 hover gun is always AI-aimed (no cursor aim, no click-to-fire). Built-in keep-distance reflex (backs off inside 170px, closes past 500px). Hunting latch fires hostiles on sight, calm critters only on fresh (<45s) orders; `stop` / `don't kill` stands her down instantly.
- **Search, find, follow** — "find some critters" sends her strolling; on contact the camera pans to the pack, she announces it in chat, then shadows it at ~280px.
- **Stamina** — bar under the hearts; exhaustion locks all movement until she catches her breath.
- **Coin inventory** — critters drop Kenney gold coins (magnet pickup); 🎒 bag opens a 20-slot grid. Resets each life.
- **Infinite map** — background streams 1254×1254 chunks around the camera; off-screen chunks are destroyed, so memory stays flat no matter how far you walk.
- **Smooth camera** — frame-rate-independent exponential lerp (`t = 1 - e^(-k·dt)`), k=8, deadzone box + idle sway + momentary `lookAt` focus points.
- **8-way facing** — horizontal flip + ~12° lean toward vertical movement; shadow stays flat on the ground (sibling of the body, not a child).
- **Idle / run state machine** — restarts from frame 0 only on state change.
- **Cinematic overlay** — sun glow top-left + drifting dust motes + faint warm grade. Light-shaft beams are disabled (`BEAMS_ON = false` in `js/effects.js`) due to flicker; flip the flag to re-enable.
- **SoundManager** (Web Audio) — master → `bgm` / `voice` / `combat` buses, each its own GainNode. BGM loops on the bgm bus; future SFX route via `Sound.playSfx('combat', 'file.ogg')`. BGM starts on first keypress/click (browser autoplay policy).
- **Fixed 16:9 scene** — internal render at 1280×720, CSS-scaled to fit any window (letterboxed + pinned to top); gear icon is anchored to the play screen, not the window.

## Structure

| Path | Purpose |
|------|---------|
| `index.html` | Entry point; loads local PixiJS v8 UMD + all modules in order |
| `electron-main.js` | Electron main process: serves project via `maid://` protocol, opens the window |
| `package.json` | npm metadata + `start` script (Electron) |
| `vendor/pixi.min.js` | Vendored PixiJS v8 UMD (offline; no CDN dependency) |
| `css/style.css` | Styling incl. dev panel + audio settings UI |
| `js/config.js` | Constants: sheet layouts, camera params, background URL |
| `js/settings.js` | localStorage load/save + dev panel UI (P key) |
| `js/assets.js` | Sheet loading + grid slicing (`baseTex.source` for v8 TextureSource) |
| `js/input.js` | Keyboard → movement axis; P routes to settings |
| `js/tilemap.js` | Infinite background chunk streaming |
| `js/entities.js` | Character: root > [shadow, body(flip+tilt) > idle/run anims] |
| `js/camera.js` | Smooth clamped exponential-lerp follow + deadzone/sway + `lookAt` focus |
| `js/chat.js` | Local-LLM chat persona: dialog box, walk tags, intent memos, `say()` for unprompted lines |
| `js/situation.js` | Live auto-snapshot (pos/HP/gun/enemies/stamina) feeding chat + brain |
| `js/brain.js` | Survival brain: auto-think loop, thought box, hunting latch, keep-distance, stroll, found-and-follow |
| `js/gun.js` | M1 hover gun: always AI aim, recoil/flash/tracers, coin drops on kills |
| `js/enemies.js` | Critter packs: mill at spawn, retaliate when shot, 500px sense queries |
| `js/health.js` | 9 hearts, faint lock, hooks into brain/stamina/inventory |
| `js/stamina.js` | 100pt movement tank, exhaustion lock, rest recovery |
| `js/inventory.js` | Coin drops, magnet pickup, 🎒 bag + slot-grid panel |
| `js/effects.js` | Sun glow + dust particles (beams disabled) |
| `js/audio.js` | SoundManager: Web Audio buses, BGM loop, gear UI |
| `js/live2d.js` | Live2D companion: pixi-live2d5 init, upper-body framing, drag/wheel placement tool |
| `cubism5/shaders/` | 13 GLSL shaders the Cubism R5 framework fetches at render time |
| `js/main.js` | Bootstrap: init app, wire modules, game loop |
| `assets/` | Sprite sheets + grassland background + Cozy1.mp3 (BGM) |

## Notes

- PixiJS v8's `ticker.deltaTime` is **frame-units** (1 at 60fps), not seconds — the loop uses `deltaMS / 1000`, clamped to 50ms.
- Idle sheet: 256×192, 9 opaque frames @ 64×64. Run sheet: 256×128, 7 opaque frames @ 64×64.
- Electron ≥ 41 renamed `protocol.registerSchemesAsStandard` → `registerSchemesAsPrivileged`; `electron-main.js` guards both so it runs on old or new Electron.
