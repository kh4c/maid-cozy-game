# Dev Log — Maid Cozy Game

Chronological record of what was built and why. Newest entries at the top.

---

## 2026-09-06 — Found-system vs new-system: 3 real contradictions fixed (feet ownership)

Audit of the founding found-and-follow layer against goals/tasks/filter/click-move:

1. **FOUND camera pan REMOVED.** `foundIt` used to yank the camera to the pack
for 2.5s. With rect-eyes the found pack is on-screen by construction, so the
pan only shoved OTHER visible packs out of the rect (phantom "lost" verdicts)
and yanked the click-to-move surface mid-click. Direction words ("to the
north-east") carry the where now. `camera.lookAt` stays exported, unused.
2. **Movement tasks own the feet.** A wander-in pack no longer FOUND-hijacks an
active circle/patrol/goto (approach orders fought the performance every 0.5s;
goto could never arrive). `searchWatch` returns early under a movement task —
reflexes (trigger/keep-distance) still guard her, the snapshot still lists
every pack for the think-model, skip-memory still pins cheap packs. Setting a
movement task also drops a live shadow; clearing one re-arms the search.
3. **Recall wins feet.** "Actually kill those" now clears an active movement
task when the march arms (latest explicit command wins feet); quota/hunt
objectives stand untouched.
NOT contradictions (verified, left alone): quota trigger-freshness (`|| !!objective`,
F-test pins filter > quota), click-pin vs follow orders (axis merge already
prioritizes the pin), wiped-vs-lost verdict.
Harness `hfound.js`: 14/14 (J1 pan-gone, J2 no-hijack, J3 reflex-fire, J4
recall-clears-task, J5 task-preempts-shadow); all legacy suites still green.

## 2026-09-06 — Screen-rect eyes (no more circle lies) + click-to-move replaces WASD

**Rect eyes:** the old 750px SEE circle lied both ways — it missed screen corners
yet covered off-screen bands above/below, so the maid ignored visible corner
foes and reacted to things the player couldn't see. New rule: what YOU see is
what SHE sees. `Enemies.senseView/nearestView(mx,my,cx,cy,640,360)` filters by
the 1280x720 view rect around the camera center (dist still measured from the
maid for REACH rules). `findAvail` dropped its 650px cap (screen list IS the
cap — corners count), think-cadence `near` = anything listed. Memory stays
circular on purpose: recall marches and lost-pack checks need to re-find packs
that wander off-screen. Verified: old circle saw corner+band+right (3/3),
rect sees only the corner one.

**Click-to-move:** WASD deleted. Left-click the canvas drops a world pin; she
walks to it (arrival 14px or 4s leash, whichever first). While the pin is live
her feet are yours — AI movement yields; when it lapses with no new click and
a goal/task needs motion, the brain's orders flow again. Faint/edit guards:
dead or editing clicks pin nothing. HUD now reads "click to move".
Harness `hpercept.js`: 15/15 (rect 5 + handoff 10).

## 2026-09-06 — Overall goal vs current task: hunt filter (min worth), no more tactic-vs-filter fights

**Problem:** "we are low on ammo — only prey worth 5+, toward our 300 quota" needed TWO ideas at once (overall goal + current filter), and the new filter fought the old tactics three ways: (1) a standing quota keeps `combatDrive` fresh forever → the gun kept shredding the 2-coin commons the filter just rejected; (2) a recalled-then-exempt pack got instantly re-abandoned on arrival; (3) the filter outlived the hunt task that set it.
**Fix (`js/brain.js`, `js/chat.js`):**
- `task=[[quota 300 min 5]]` — the quota verb carries its own bar; `hunt min 5` coexists with a standing quota objective (goal vs task split: objective survives task replacement).
- Trigger obeys the bar: calm small-fry under it get `aiCease` even on a standing quota; only a FRESH explicit kill order (<45s) or hostility spends ammo.
- Recalled packs are `followExempt` — master's "go back THERE" outranks the bar until she leaves; arrival no longer re-abandons.
- Filter lifecycle: rides with the hunt task (movement verbs lift it, stop/death clears); quota-starved skips say the quota still stands.
- Harness `hfilter.js`: 23/23 (skip+pin, rare passes, recall re-engages, dismiss beats recall, mid-follow abandon, exemption holds, trigger holds/spends, quota-min parse).

## 2026-09-05 (evening) — Maid autonomy: survival brain, stamina, coins, found-and-follow

**Goal:** stop driving the maid yourself — she senses the field (position, weapon, nearby enemies, stamina), fights or flees on her own judgment via the local LLM, and obeys chat orders in-character. You oversee; she acts.

### Done
- **Situation awareness** (`js/situation.js`, new): every LLM call gets a live auto-snapshot — her position, HP, gun state (mode/firing), nearest enemies (distance/direction/hostile/HP, capped at **500px**), stamina. Chat is read-only context; combat decisions live in the brain.
- **Survival brain** (`js/brain.js`, new): a tactical sub-mind separate from chat with its own LLM loop + history and its own **💭 thought box** (bottom-right, never overlapping chat). Thinks on cadence when hostiles near, on demand via 💭, or not at all when the field is quiet. Acts through shared tags: `[aim]` / `[fire]` / `[cease]` / `[run]` / `[move]` / `[stop]`. **🛡️ AUTO** toggles auto-think.
- **She owns the gun now** (`js/gun.js`): aim is always AI — cursor aim and click-to-fire are gone (root-cause fix: `config.js` defaulted `aimMode` back to `'mouse'` on every load, silently re-enabling mouse mode). With no fresh order she tracks the nearest critter in her circle herself, else holds her last aim — the gun never snaps to the cursor.
- **Keep-distance reflex** (built-in, not an LLM decision): backs off inside 170px, drifts closer past 500px, shoots on the move; pauses while exhausted.
- **"Find critters" actually finds** (`searchWatch`/`followTick`): a vague order starts an immediate **stroll** (random direction, gentle course changes, gives up after ~40s of empty field). When a critter enters her circle she stops, the **camera pans to it (~2.5s via `Camera.lookAt`)**, she **announces it in chat** ("Found them — 4 critters just ahead, to the south-east!…"), then **shadows the pack at ~280px** instead of fleeing. Loses them → apologizes. One find per search; "stop" ends it.
- **Fire discipline:** the hunting latch auto-fires **hostiles always, calm critters only while the order is fresh (45s)** — a stale "kill them" no longer mows down every new pack. Brain prompt matches (fresh overrides HOLD, stale waits). A short-lived confirm-once system for calm kills was built, then **removed per playtest** — an order is an order.
- **"Stop" actually stops:** "don't kill / do not shoot / stop / leave them" is negation-aware in both chat and brain — telling her NOT to kill can no longer latch hunting mode ON (it did: "don't kill" matched the attack regex). Clearing attack mode also releases the trigger instantly.
- **Stamina** (`js/stamina.js` + `css/stamina.css`, new): 100pt tank under the hearts (green→amber→pulsing cyan). Movement drains; empty locks ALL movement (WASD, chat walks, brain runs) until she catches her breath (~45pt). Exhaustion pings the brain log + a sleepy face.
- **Coin inventory** (`js/inventory.js`, new): critters drop 1–2 Kenney gold coins (`tile_0093`, real asset + `handleCoins.ogg` pickup sfx). Coins pop out, magnet in at 110px, **🎒 bag button** (bottom-right, count badge) opens a 20-slot grid panel. Resets on respawn, like her memory.
- **Chat drives tactics:** every chat line pre-seeds the brain's standing memo instantly (plus a `intent=[[…]]` memo extracted from the chat reply); attack verbs forward as orders with an annoyance counter (repeated asks cave faster, kills vent it); per-life memory (kills/bites/flees/events) resets on death.
- **Critter tuning:** packs mill at spawn, never hostile on proximity — they trail only when shot or when you walk within 120px; sense/engage hard-capped at 500px everywhere (queries, snapshot, latch, reflex, gun fallback) so nothing off-screen gets shot.

### Technical notes worth keeping
- Two-LLM design (chat persona vs tactical brain) with different prompts/histories, sharing one local endpoint — intent flows chat→memo→brain, never the reverse.
- `Chat.say()` lets code put words in her mouth (found-it lines) with full typewriter/face/history treatment; it refuses while a chat exchange is in flight (retry-then-drop) so it never clobbers the user.
- Camera `lookAt` blends the deadzone follow-point 55% toward a world spot with an expiry — cosmetic only, character movement untouched.
- Negation must be checked BEFORE attack words in every intent regex, with `\b` boundaries (`another` ≠ `not` — harness-verified with 10 phrases).

---

## 2026-09-05 (later) — Combat pass: M1 companion gun, retaliation AI, BGM crossfade, camera deadzone + sway

**Goal:** real combat feel — shoot critters with a Brotato-style hover gun, monsters that only fight back when attacked, smooth music transitions, and a camera that doesn't glue to the character.

### Done
- **M1 Garand companion gun** (`js/gun.js`, new): `Weapon/m1.png` hovers beside the maid (bob + recoil rig, pivot at the grip), aims at the mouse (css→world conversion through the camera offset), fires on click/hold (0.16s auto-fire). Juice: recoil kick-back + muzzle tilt, additive Kenney `muzzle_03` flash (random size/mirror), `m1gunshot.wav` + high `swing.ogg` snap layered per shot, camera pop. Bullets (`m1_Projectile.png`, small) fly 950px/s, shed an additive glow **tracer trail**, splash-hit critters via `Enemies.damageAt()`, burst Kenney `circle_01` sparks on connect, layered `impactGeneric_light` hit sounds + bigger burst/low thud/shake on kills. Clicks on HUD/chat never fire (`e.target !== canvas` guard); gun disabled in edit mode + while fainted.
- **Enemy retune** (`js/enemies.js`): critters 2× → **2.75×** with bigger shadows, pack separation radius 26 → **64px** (they used to stack into a blob). **Hit flicker**: any non-lethal hit sets `flashT = 0.18` → red tint + rapid alpha blink, then restores. New `damageAt(x, y, radius, dmg)` returns `{hits, kills, deaths[]}` so gun.js layers its own juice; melee `playerAttack` shares the flicker.
- **Retaliation AI (finished)**: packs are **never hostile on proximity** — inside interest range the pack anchor trails the player at ~300px (passive follow); hostility starts only when the player damages the pack (`alerted`), braves charge + bite, cowards bolt. Alert cools when the player leaves alone or while she's fainted. `Space`/`J` melee swing kept (whoosh + thump + shake).
- **BGM crossfade + lag fix** (`js/audio.js`): `setBgmMood()` no longer hard-cuts — new track swells in (~2s) while the old ducks out (~1.5s), overlapping on the same `bgm` bus. Combat lag root cause: the per-frame mood call started a fresh 5MB fetch+decode **every frame** while the battle track was still decoding; fixed with a `bgmPending` single-in-flight guard + `warmBgmCache()` pre-decodes both tracks after the first user gesture.
- **Camera deadzone + sway** (`js/camera.js`): deadzone box = **18% × 22%** of screen. She walks freely inside it (no tracking); crossing an edge drifts the camera just until she's back on the rim. Inside the box the camera **sways** — two layered sine drifts (~3px H / ~2.5px V, different periods), fading in/out with the zone so it never fights tracking. Sway is stripped each frame before the clamp math so it can't walk her out of the box.
- **Dialog/chat overlap fix** (`css/style.css`): dialog box now stacks via `bottom: calc(1.5% + 58px)` above the input instead of a % guess — no overlap at any text length.

### Technical notes worth keeping
- Web Audio: parallel `decodeAudioData` calls are the real fps killer — guard *decoding*, not just playing. Warm the cache on first gesture (autoplay policy blocks audio before it anyway).
- Sway-into-lerp pattern: any additive camera offset must be removed before computing the deadzone clamp, or it feeds back into itself.
- Kenney particle PNGs are black-background → `blendMode: 'add'` turns them into free glows (muzzle flash, tracer, sparks) with no processing.
- Pixi v8 `AnimatedSprite.tint`/`alpha` are the cheap hit-flash — no shader needed.
- Dev-log bug of the day: `dt is not defined` — the camera param is `dtSec`; killed the whole loop until fixed.

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
| `assets/SG_Maid_Idle.png`, `assets/SG_Maid_Run.png`, `assets/SG_Maid_Die.png` | User-provided sprite sheets (`GameAsset/Maid/`) |
| `assets/grassland.png` | User-provided background (`GameAsset/grassland background.png`) |
| `assets/Cozy1.mp3`, `assets/battle1.mp3` | User-provided BGM (`GameAsset/BGM/`) |
| `assets/m1.png`, `assets/bullet.png`, `assets/sfx/gunshot.wav` | User-provided weapon art/audio (`GameAsset/Weapon/` — `m1.png`, `m1_Projectile.png`, `m1gunshot.wav`) |
| `assets/muzzle.png`, `assets/spark.png` | Kenney Particle Pack (black-bg PNGs, additive-blended) |
| `assets/sfx/hit_0-3.ogg` | Kenney Impact Sounds (`impactGeneric_light_*`, `impactPlate_light_000`) |
| `assets/sfx/hurt_0-4.ogg`, `assets/sfx/die.ogg` | Kenney Impact Sounds (punch/soft impacts) |
| `assets/sfx/swing.ogg` | Kenney RPG Audio (`knifeSlice.ogg`) |
| `assets/heart_full.png`, `assets/heart_empty.png` | Kenney Board-Game Icons (`suit_hearts.png`, tinted) |
| `assets/enemy.png` | User-provided critter sheet (`GameAsset/Monster/creature-sheet (1).png`) |
| `vendor/pixi.min.js` | PixiJS v8 UMD, vendored from CDN (offline) |

No procedurally generated assets — everything is a real downloaded/user file.
