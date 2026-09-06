# Dev Log — Maid Cozy Game

Chronological record of what was built and why. Newest entries at the top.

## 2026-09-06 — Slim tracer + grazers never an ask (no "Say the word")
- **Yes, it was the trail.** `spark.png` is 512×512 — the tracer glow shed every
  frame at 0.05 scale was a ~26px additive blob, dwarfing the 11px slug. Trail
  is now a 0.02 wisp (~10px), dimmer, gone in 0.09s. M5 pins it.
- **The leftover ask is dead.** "Holding fire, watching — Say the word" survived
  the no-ask patch in softer form; that was the "still waiting for my command".
  Calm-critter finds now read "just grazers, master. Leaving them be." in both
  fallback and voice prompt ("never ask, never wait on master for grazers").
  Grazers are decided, never a question. J7 pins no-ask. 29/29 green.

## 2026-09-06 — Smaller, faster slugs (ranges kept)
- Rifle 0.3 → **0.18** slug at **1800px/s** (was 1400); shotgun 0.32 → **0.2** at
  **1500px/s** (was 1100). Lifetimes shortened to match, so reach stays ~846 /
  ~390px — her brain's range math untouched. W21/W22 pin it. 29/29 green.

## 2026-09-06 — Equipment panel + pump shotgun (2nd gun, live swap)
- **🔫 panel (I key or button).** Big iron closet, left side: every weapon row
  with its sprite, blurb, and live numbers; EQUIP swaps instantly — even
  mid-fight, the gun in her hands changes next frame. Store damage upgrades
  ride each row separately (shotgun keeps its own +1s).
- **Pump Shotgun:** 2 dmg × 6 pellets in a 0.26rad fan, 1.5s cd, ~385px reach,
  heavy recoil + harder camera kick, `shotgun_real.wav` + pump-rack every 6th
  shot. Rifle untouched (4 dmg needle, 0.85s, ~840px, clip-ping every 8th).
  Snapshot, think combat card, and describe() all name the ACTIVE gun.
- Guards: W15-W20 (row/sound/range/swap/describe), hequip Q1-Q11 (panel lists,
  tags, click-swap, bad clicks, I key). 29/29 green (new harness).

## 2026-09-06 — Gilt country: golden packs outnumber critters 70/30, spawner stocked
- Spawns flipped from 55/45 to **30% critters / 70% giltboars**, tick 6s → **4s**,
  concurrent packs 2 → **3**. The field stays stocked with her main quarry;
  loners untouched. W7/W8 pin it. 28/28 green.

## 2026-09-06 — Shiny-bool voice + pixel bubble (no more "golden/blue/coins-each")
- **The voice can't name what it can't see.** Found/switch facts no longer carry
  tier, color, or price — code computes a `shiny` boolean and that is ALL the
  model gets (rare+ → "shiny!", else plain). "Golden one", "blue one", "~18
  coins each", "red ring", "better prize" all cut from prompts AND fallbacks:
  giltboars are just NAMED ("Found giltboars — taking them!"), hunters plainly
  hunters. The no-counts guard lost its price exemption, so any stray "12
  coins" in a found line now fails back to the clean template. Species +
  direction + shiny is the whole vocabulary.
- **Bubble: small white oval, Press Start 2P** (bundled in
  `assets/fonts/`, @font-face in index.html), 20px dark text centered, 1.8s.
  M4 pins oval + font + size. 28/28 green.

## 2026-09-06 — Follow lives in kill + trip bubble (no trip talk)
- **Find = know, not stick.** `foundIt` no longer shadows on every find. FOLLOW
  now lives in the KILL action only (`killTrack` = hostile self-defense, fresh
  order/hunt posture, or gilt free-fire): she pins the pack identity and holds
  it until wiped — pursuit, 10s grace, no target swaps — so nothing slips away
  mid-fight. A find with no kill behind it gets the camera pan (beat) and lets
  go: grazers pan in silence; a calm hunter with no orders is named, then
  released (60s cooldown, walk-away, search re-armed for OTHER groups). Idle
  still observes; heel still holds. Answers your question directly: yes — a
  hostile group auto-attacks AND follows until everything in it dies.
- **Trip = white-oval "ahh!" bubble, no prompt.** The trip voice prompt is
  deleted (chat EV + brain genLine both gone — trips never enter the dialog).
  Every face-plant pops a white-oval sprite bubble printing "ahh!" over her
  head for 1.8s, alongside the shake + hurt grunt. Htapp M3/M7, J5 (skip still
  pans), J6 (calm hunter named + let go, zero approach legs) pin it. 28/28.
- **Face-plant lands (superseded above).** Tripping kicked the camera (0.55 shake)
  and briefly yelped through a `trip` voice prompt — both replaced: the shake
  stays, the voice is now the white-oval "ahh!" bubble, prompt deleted.
- **Tiers live in code, never in her mouth.** Found lines, think events, thought
  box, and snapshot entries name species + direction only — no more "blue rare".
  A rare+ pack earns at most the word "shiny", with explicit no-tiers/colors/
  bounties instructions. Her bestiary knowledge (OUTLINES, price list, doctrine)
  stays — it names no live pack, so it can't leak into chat.
- Guards: T3 (event names species), G3 (no tier words), M6 (shiny, names nothing).
  28/28 green.

## 2026-09-06 — Silent skip: grazers get no line and no camera, just the walk
- **No "found what", no investigation.** A search find of calm critters now moves
  on in full silence — no Found line, no focus beat, no thought-box flicker.
  Only the feet speak: tag the pack (wanders off), 60s spot cooldown (no
  re-find), walk-away legs, search re-armed for the next group.
- The skip returns before the beat/voice/shadow setup, so quarry finds keep all
  three (J1/P1 prove the gilt beat + line). Idle rare+ still reports + observes;
  heel still announces + holds; hunt/orders/hostiles untouched.
- Guards: find-path harnesses assert silence now; shadow/switch/pan/beat guards
  run on gilt fixtures; L (sticky pursuit) too. 28/28 green.

## 2026-09-06 — Skip grazers: search finds move on, never shadow critters
- **Camera pans, she sees grazers, she keeps walking.** A search find of calm
  critters (no fresh order) now says "Found critters — not our prey, moving on."
  once, tags the pack so it wanders off, and the search continues. No shadow,
  no wait, no second farewell if you also say "leave them".
- **Shadows are for quarry now.** Hunters, giltboars, ordered packs, hostiles,
  and idle rare+ encounters still report + shadow (hfound J7 proves the last
  live shadow + its "Leaving them be"). Heel still announces and holds.
- Think prompt taught the same: feet skip grazers on their own, never authorize
  them; all doctrine pins kept verbatim. hshadow/hswitch now run on gilt
  fixtures. 28/28 green.

## 2026-09-06 — No-ask critters: she holds and waits, never questions
- **Fuse deleted.** Calm critters → "Found critters — holding fire, watching,
  master. Say the word." No question, no meter, no foot-tap, no expiry-decision.
  She shadows until ordered, told to leave, or the pack moves on.
- **Removed:** js/patience.js, its script tag + dialog bar + CSS, the dev slider,
  all hear/refill calls, patienceTick, chat's impatient/decided prompts.
  Hunters and giltboars already never asked; now nothing does.
- Guards: hfilter K rewritten (silence never decides/nags/tags/fires, shadow stays
  live), hpatience retired with its source. 28/28 green.

## 2026-09-06 — Giltboar: golden main-quarry prey, fewer critters
- **Third species.** Golden packs of 3-4 (your Monster/creature-sheet 7 as
  assets/giltboar.png — swap the file to reskin), fixed 18c / 8hp, no tier roll,
  bolder than critters (stand more than they bolt). Same pack code path, gilded params.
- **Critters lowered.** Spawner tick still every 6s but rolls 55% critter / 45% gilt
  (was: critters every tick). Loners untouched.
- **Main-quarry doctrine.** NO doubt, no orders, no patience-ask: calm giltboar in
  reach → free-fire in code AND think, hungry thought, "Found giltboars — golden!
  Taking them!", always named in voice. Doctrine/closed-world/outlines/money lines
  updated; book has 3 rows; snapshot names non-critter species.
- Guards: hworld 6, hbestiary 15, hdoctrine 10 (D9 free-fire proof), hprompt 42. 29/29 green.

## 2026-09-06 — Hometown: a walk-to district with talkable NPCs
- **Same world, east on foot.** Town square at (3600, 0) in the endless grassland —
  dirt road from spawn, signpost, gate arch, plaza, 5 houses, a well, lamp posts.
  No scene system, no loading: chunks stream there like anywhere else.
- **Safe streets.** Spawner rests inside 1000px, packs that follow her in get the
  dismiss tag (wander off, never trail), and the brain heels (no finding/shadowing).
  Both minds read it: snapshot carries `inTown` + a Town line, and always knows the
  road east otherwise — "where is town?" has an answer.
- **Four townsfolk, scripted bubbles.** Marta (shop — clicking her opens your 🛒),
  Old Bram (field lore: doubt critters, never hunters), Pip (wandering kid),
  Sister Wren (heals free when hurt). Greet once, then rotating lines, 6s bubbles.
  Click an NPC: she walks over if far, speaks on arrival; empty clicks walk as before.
- New htown (20 checks). Suite 29/29 green.

## 2026-09-06 — Words-not-pixels, prompt diet, face-the-enemy, plant-feet
- **Tactic sees words, not pixels.** Snapshot enemy entries are direction + close/far
  bands tied to the trigger (hostile 650 / calm 500) — no px, hp, or prices per entry.
  Code keeps the numbers; the model doesn't. New hsight guard.
- **Prompt diet + a real bug.** Think sys 6687 → 4468 chars (−33%), zero rules lost; new
  hprompt pins all 40 must-survive phrases under a 6000 budget. The diet caught a
  pre-existing unary-plus (`+ combatCard() +`) that had been sending `NaN` instead of
  the weapon/price cards — she was thinking without her rifle facts. Fixed + NaN assert;
  the fallback now reads live gun numbers, never a frozen copy.
- **Face the enemy (two halves).** The gun always rotated, but she stayed frontal. Now:
  Live2D head-turn + eye-glance toward the target's side while latched (overlay can't
  spin — `FACE_SIGN` flips it if the rig mirrors), AND the world sprite flips to the
  gun's side (`aimSide()` → attack-face override in `character.update`), movement flip
  otherwise. Art faces right at +scale. New hface (8) + hsprite (9).
- **Stop and shoot.** Trigger latched → feet plant (movement zeroed in main.js, brain
  untouched). Consequence, as ordered: flee and coin-scooping only happen when she's not
  firing — `[cease]` to run.
- **Purse-balance-only.** `packValue()` deleted; all three `~X coins` amounts cut from
  Recent events + thought chips. The tactic sees `Coins: N in her purse`, nothing else.
  Rare+ voice price quotes stay (chat, not tactic). brain.js 1253 → 1251 — shrinks.
- Tests: hprompt (40), hface, hsprite, hplant (6). 25/25 suites green.

## 2026-09-06 — Phase-1 rebuild: posture + trigger doctrine, auto-defend unconditional
- **The narrowed contract is live.** Think's whole vocabulary: `[mode:find|hunt|heel]`
  (only from idleness — a standing posture ignores think's mode votes), `[fire:secs]`,
  `[cease]`. Task executor (circle/patrol/goto/quota/follow-pack), `[aim:*]`, `[target:]`,
  `[move:]/[run:]` think-tags, surgical color latching, known-pack memory, recall marches,
  quota objectives (counting, purse-watching, milestones, finish stand-down) — all deleted.
  "Earn 300 coins" parses as plain hunt: no counting, no finish line, stop is the only off-ramp.
- **Trigger doctrine (combatDrive):** hostile in reach → fire, no orders needed. Calm + fresh
  kill words or hunt posture → fire the whole pack (money is money). Calm + unauthorized →
  hold + found-line asks "want them dead?". Stop → `setAttackOrder(false)` + clearObjective
  releases the trigger instantly (order is a LATCH, not a clock — freshness also requires
  attackOrder, so stop can't be out-lived by a 5s-old ask).
- **Auto-defend cut as a switch:** the 🛡️ button is gone; she always thinks when danger nears.
  Guarding herself is what a maid does, not a toggle. `autoDefend` config key deleted.
- **Flee reflex is code now:** weak (HP ≤ 4 or stamina < 30%) + hostile inside 250px → legs
  run on their own (1.2s away-legs every 0.4s check). Strong + hostile = flinch + gun handle it.
- **News-queue hygiene:** a new life resets searchDone/lastRareNote (fresh eyes); resetMemory
  also clears the annoyance clock. Found-lines flush once even though foundIt also set
  `following` (queue is serial, announce is async — harness drains microtasks).
- Tests: new hposture (mode-from-idle, mode-held-under-posture, hostile-fires-unordered,
  stop-ceases, flee weak/tired, stands strong); hfilter rewritten (money-is-money, hunt-posture
  never stale, leave-no-memory, quota-words=hunt, HUD posture-only); hfound rewritten (heel
  announces-but-never-shadows, leave walks away, "go back" asks which). 10/10 suites green.

## 2026-09-06 — The shadow holds (no more approach-flinch yo-yo)
- **The awkward dance explained:** followTick walked her in with 210px legs while keepDistance
  independently shoved her out of anything inside 170px — approach, overshoot, flinch back,
  repeat. Now the flinch stands down while she's deliberately shadowing a CALM pack (she
  walked up on purpose — hold ground). Hostile shadows still flinch, and unshadowed
  bump-ins still flinch. Think-prompt KEEP DISTANCE carries the same exception.
- **Stickier track:** the shadow drops at 900px now (was 700, matching the recall anchor),
  so a wandering pack doesn't end the follow the moment it steps out.
- Tests: new hshadow (holds at 120px calm, flinches at 120px hostile, still closing at
  750px). 10/10 suites green.

## 2026-09-06 — Pan returns (off-screen only) + no more pixel-talk
- **Pan is back, but conditional.** `camera.viewRect()` + brain `panIfOffscreen()`: on-screen
  finds never move the camera (direction words carry them); recall marches glance 2.5s at the
  remembered den, which can sit ~900px away in memory rather than eyes. foundIt carries the
  same guard as a safety net. Rationale for the old removal stands: rect-eyes == the fixed
  1280×720 canvas, so search-finds are on-screen by construction — only memory-finds can be
  somewhere you're not looking.
- **"near 300px" fixed.** The leak was the chat model blending snapshot numbers into speech.
  Three plugs: switch/compare/fallback templates speak words only ("much closer", "the old
  pack (over there)", no `(~320px)` asides); new send-time Voice rule (distances in plain
  words, purse quoted exactly); distWord gained a 4th band ("a way off" past 600px). Coin
  appraisals ("about 12 coins") stay — knowing prices is fine, filtering by them is gone; the
  last filter-flavored template ("not worth the bullets…") now reads "pocket change, but
  money is money."
- Tests: new hpan (8 checks: no-pan on-screen, pan-to-den on recall, words-not-pixels far
  find). 9/9 suites green.

## 2026-09-06 — Money-is-money: the worth filter is gone
- **No more bars, no more min-N.** `huntMin`, skip-pins, `[too cheap]`, mid-follow abandon,
  recall-exemptions, task `min` args, the think-prompt HUNT FILTER — all deleted. Now it's find
  or kill: FIND locates + reports + shadows (never fires first), HUNT/QUOTA/kill-words fire on
  EVERYTHING in reach, common or legendary.
- **Worth-picking gets an answer.** "only worth 5+", "most valuable", "skip the cheap ones" →
  she says one of three money-is-money lines ("Money is money, master — … We kill them ALL.")
  and kills them all anyway. Stop-words in the same breath suppress the banter (stop wins).
  Both minds taught: think-prompt MONEY rule + chat send-time Worth rule (never promise to skip,
  never emit a min number into task=/intent=).
- **Kept, untouched:** rarity labels + outlines + price list + appraisal flavor (she still KNOWS
  worth, she just never ACTS on it), surgical color targets, dismiss/recall memory, wiped-vs-
  lost, hostiles-always-exempt. Shadow-switching is distance-only now (richer-but-farther no
  longer interrupts).
- Tests: hfilter rewritten (answer + kill-all + dismiss/recall + discipline), hdefault L2/L4/L5
  + new L7 stop-beats-banter, hswitch N2 (no-switch-rich), hfound J4 (dismiss→recall), hmin2
  DELETED. 8/8 suites green.

## 2026-09-06 — FIND goal + news queue + smarter second finds
- **FIND is a goal now.** The verb picks the goal: "find / look for / search" = FIND (locate +
  announce + shadow, trigger stays OFF — hostiles still self-defend); "hunt" = HUNT (kill +
  min-5 default); "earn N" = QUOTA. "find some critter worth 5" = FIND with a bar (small-fry
  skipped, 5c announced, still no fire); bare find reports everything. Goal HUD reads
  `🔎 finding…` vs `🎯 hunt on`. Think-model told: under FIND, compare packs and recommend —
  master picks, she holds. (Last turn's hunt-default moves to HUNT where thrift belongs.)
- **News queue replaces the 3-try found-line.** Every dialog announcement queues
  (`{text}` or `{facts,fallback}`, cap 4, newest wins) and a pump speaks them serially whenever
  the dialog is free (not busy, not mid-typewriter via new `Chat.isSpeaking`, not dead) — even
  mid-shadow. Nothing is silently dropped anymore; delayed finds are announced as delayed
  ("spotted 30s ago — may have moved").
- **Second pack while shadowing.** `switchWatch`: a clearly better prize (closer by 150px+ or
  worth 2x+ and not farther, max 1 switch/20s) moves the shadow + announces why ("300px closer
  — leaving these for the better prize"); a still-waiting earlier find rides along as comparison
  ("which is closer, which you'd take first"). Never off a surgical latch or a fresh kill word —
  obedience beats opportunism. (N-suite 7/7, M3 comparison/switch/age, L-suite rewritten 15/15;
  all 6 legacy suites untouched-green.)

## 2026-09-06 — Generated found-lines + default hunt min-5
- **Found-line is generated now, not templated.** `Chat.announce(facts, template)`: the CHAT voice
  receives the facts (count, dir, dist, best color/rarity/value, hostile?, ordered?) plus the live
  snapshot and announces in 1-2 sentences in her own voice — must quote figures exactly (grounding
  rule rides along). Template survives as the safety net (model down/busy/dead → news still
  arrives via pendingSay retry). Tags stripped defensively. (M-suite: generated speaks, fallback
  speaks, 4/4.)
- **Plain "find some critters" = hunt min-5 + hunt ON.** setMemo find-words (no quota/objective/min)
  → `huntMin = 5` + objective hunt (goal HUD reads `🎯 hunt on · min 5+`); bare `hunt` task same
  default. "find anything/commons/whatever" lifts the bar to 0; explicit quota/min never stomped.
- **Trigger split: objectives don't spend ammo, kill words do.** `lastKillWordAt` (explicit "kill/
  shoot/take-down-X" only) now gates the under-bar exemption in combatDrive + follow-abandon;
  setObjective freshness still authorizes REACH but a standing hunt no longer machine-guns 2c
  commons by accident. (L-suite 13/13: skip, hold fire, engage 5c, bar-lift, quota-keeps-2c, bare-
  hunt-5, fresh-word-fires.)
- Legacy updated to the new default: E1/H/J1/J5 packs now qualifying 5c uncommons; E2 raises the
  bar to min-12 (same abandon/recall arc).

---

## 2026-09-06 — Surgical color targets: "kill the blue one" kills ONLY the blue

Model decides, code executes. Every visible critter now has a stable id
(`p3c1`) + outline COLOR in the snapshot (`gray=common, green=uncommon,
blue=RARE, purple=EPIC, gold=LEGENDARY`) — the model points by color, rarity,
or [id], never by list order. "Kill the blue one" sets a surgical latch:
combatDrive aims ONLY the blue (re-aimed 4x/sec at its live position) under
the same REACH + thrift rules, sitting ABOVE the blanket hostile branch — so
when the shot alerts the pack, the greens still live. Two subtler kills inside:
(1) the surgical word carries surgical-ONLY fire authorization (`attackScope`),
so after "Blue down, the rest live" no leftover blanket order mows the greens
(quota standing → it resumes blanket instead); (2) a color match IS an attack
order by itself ("take down" was never in ATTACK_RE). No target color in view →
cease + honest report (down vs never-there) + latch cleared. Think-model gets
[aim:<color|rarity|id>], [target:<...>] / [target:clear]; [aim:nearest] steers
to the target while latched. Stop/quota-fill/death/blanket-order clear it. Chat
intent must PRESERVE color words into the memo (it is instructed to).
Ballistics honesty: bullets splash ~44px, packmates hold ~64px apart — a
shoulder-to-shoulder neighbor can catch sparks; she warns if so.
Harness `htarget.js`: 17/17; all 5 legacy suites still green.

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
