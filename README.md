# Maid Test

A chibi-maid browser game built with **PixiJS v8** — no build step, plain classic scripts.

Walk a white-haired maid across an **infinite grassland** with smooth camera follow, 8-way facing tilt, a live dev panel, and a cinematic sun-glow + drifting dust-particle overlay.

## Run it

You need a local HTTP server (PixiJS loads assets over `fetch`, which is blocked on `file://`). From this folder:

```bash
python -m http.server 8090 --bind 127.0.0.1
# then open http://127.0.0.1:8090/
```

## Controls

| Key | Action |
|-----|--------|
| `WASD` / Arrows | Move (diagonal normalized) |
| `P` | Toggle dev panel |

Dev panel sliders (saved to `localStorage`, key `maid-test-settings`): **speed**, **idleFps**, **runFps**, **scale**, **sunray**.

## Features

- **Infinite map** — background streams 1254×1254 chunks around the camera; off-screen chunks are destroyed, so memory stays flat no matter how far you walk.
- **Smooth camera** — frame-rate-independent exponential lerp (`t = 1 - e^(-k·dt)`), k=8.
- **8-way facing** — horizontal flip + ~12° lean toward vertical movement; shadow stays flat on the ground (sibling of the body, not a child).
- **Idle / run state machine** — restarts from frame 0 only on state change.
- **Cinematic overlay** — sun glow top-left + 22 drifting dust motes + faint warm grade. Light-shaft beams are disabled (`BEAMS_ON = false` in `js/effects.js`) due to flicker; flip the flag to re-enable.

## Structure

| Path | Purpose |
|------|---------|
| `index.html` | Entry point; loads PixiJS v8 UMD from CDN + all modules in order |
| `css/style.css` | Styling incl. dev panel |
| `js/config.js` | Constants: sheet layouts, camera params, background URL |
| `js/settings.js` | localStorage load/save + dev panel UI (P key) |
| `js/assets.js` | Sheet loading + grid slicing (`baseTex.source` for v8 TextureSource) |
| `js/input.js` | Keyboard → movement axis; P routes to settings |
| `js/tilemap.js` | Infinite background chunk streaming |
| `js/entities.js` | Character: root > [shadow, body(flip+tilt) > idle/run anims] |
| `js/camera.js` | Smooth clamped exponential-lerp follow |
| `js/effects.js` | Sun glow + dust particles (beams disabled) |
| `js/main.js` | Bootstrap: init app, wire modules, game loop |
| `assets/` | Sprite sheets + grassland background |

## Notes

- PixiJS v8's `ticker.deltaTime` is **frame-units** (1 at 60fps), not seconds — the loop uses `deltaMS / 1000`, clamped to 50ms.
- Idle sheet: 256×192, 9 opaque frames @ 64×64. Run sheet: 256×128, 7 opaque frames @ 64×64.
