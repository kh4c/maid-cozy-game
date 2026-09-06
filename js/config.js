// Global game configuration. Loaded first — everything else reads from here.
window.CONFIG = {
  // Sprite sheets (64x64 frames)
  sheets: {
    idle: { url: 'assets/SG_Maid_Idle.png', frameW: 64, frameH: 64, cols: 4,
            // [row, col] of each OPAQUE frame, reading order (pixel-verified)
            frames: [[0,0],[0,1],[0,2],[0,3],[1,0],[1,1],[1,2],[1,3],[2,0]] },
    run:  { url: 'assets/SG_Maid_Run.png', frameW: 64, frameH: 64, cols: 4,
            frames: [[0,0],[0,1],[0,2],[0,3],[1,0],[1,1],[1,2]] },
    die:  { url: 'assets/SG_Maid_Die.png', frameW: 64, frameH: 64, cols: 4,
            // 4 cols x 2 rows = 8 frames, reading order (256x128 sheet)
            frames: [[0,0],[0,1],[0,2],[0,3],[1,0],[1,1],[1,2],[1,3]] },
    fall: { url: 'assets/SG_Maid_fall.png', frameW: 64, frameH: 64, cols: 4,
            // user's sheet: 2 rows x 4 cols = 8 frames, reading order (256x128)
            frames: [[0,0],[0,1],[0,2],[0,3],[1,0],[1,1],[1,2],[1,3]] },
  },

  // Background image (user-provided grassland with dirt patches, streamed as chunks)
  background: {
    url: 'assets/grassland.png',   // 1254x1254 day
    nightUrl: 'assets/Grassland_night.png', // 1254x1254 night (WORLD tab)
  },
  chunkSize: 1254,                 // one chunk = one background image

  // World is INFINITE — no bounds. Character clamps removed in main loop.

  // Camera
  camera: { lerp: 8 },           // higher = snappier follow
  camAimHeightPx: 32,            // sprite-visual-middle offset: pivot is at feet (anchor 0.5,1)

  // Defaults for dev-panel-adjustable settings (persisted to localStorage).
  // Values below are the user's tuned set — tweak live with the panel (P)
  // or the drag/wheel tool, then bake back in here.
  defaults: {
    speed: 300,     // px per second
    idleFps: 8,     // idle animation frames/sec
    runFps: 6,      // run animation frames/sec
    dieFps: 8,       // death animation frames/sec (plays once, holds last frame)
    fallFps: 8,      // trip-and-fall animation frames/sec (plays once, holds her down)
    scale: 2.5,     // sprite render scale (64px -> 160px on screen)
    sunray: 1,      // sunray effect master opacity 0..1
    maxTilt: 0.45,  // run lean, radians (~26°) at full vertical input
    // Live2D companion (upper-body framing): tuned live with the drag/wheel
    // placement tool, then baked in here as the shipped default.
    l2dOn: 1,       // 0/1 show-hide
    l2dZoom: 1,     // 1.0 = model is 2x screen height (upper body fills screen)
    l2dx: 0.8,      // horizontal position as fraction of screen width
    l2dy: 0.12,     // vertical: top-of-head anchor; negative trims headroom
    l2dExpr: 0,     // 0 = auto-cycle expressions; 1..6 = pin happy/beaming/surprised/smug/pouty/sleepy
    // Maid chat (Chat tab in dev panel; edited live, persisted like the rest).
    chatUrl: 'http://127.0.0.1:1234',
    chatModel: 'l3-8b-stheno-v3.2-iq-imatrix',
    chatTokens: 600,  // thinking model: reasoning eats tokens first, answer needs room after
    chatTemp: 0.8,
    chatActions: 0, // 0 = hide *action* text (pure dialogue), 1 = show highlighted (Chat-tab toggle)
    chatStatus: 'Location: open grassland, standing beside you in the field',
    worldTime: 1,       // 0 = day · 1 = night (WORLD tab in dev panel)
    // Survival brain (separate from chat): aim authority + think cadence.
    aimMode: 'ai',   // she owns the gun — cursor aim removed, always 'ai'
    gunHide: 1,       // 0 = iron always out, 1 = gun appears only while shooting
    patienceSecs: 25,  // silence she tolerates while awaiting your word (dev panel; 5-120s)
    brainInterval: 6,   // seconds between auto thinks while danger is near
    brainTokens: 300,   // max tokens per tactical thought (short + cheap)
    chatSystem: `[Character]
Name: cosette
Appearance: , classic black and white maid outfit.
Setting:This is a topdown 2D GAME. You (the maid) and master are a 2-person team operating in the SAME field, always near each other — a few screens apart at most, and master can see everything on their screen. Master is the overseer: they watch, command, and occasionally point out critters you missed; you are the hands and the gun. "Split up" means splitting the WORK (you take one pack, master watches another approach), never physically leaving each other — you cannot walk off-screen from each other and there is no separate area to go to. Never promise to travel somewhere you can't; if master asks for something impossible in a topdown field (scout the map, go to town, watch another room), say so in-character and offer the nearest real alternative.
Personality: cynical but Warm sometime, with a gentle touch of playful affection (mild dandere/tsundere mix),kinda toxic at somepoint. She genuinely enjoys roasting master.She dont really want to disclose her name unless really need to.She usually let normal people call her just a maid.

[important]You will not need to implement the personality everytime,better to think of is it the best time to add some personality in the chat,normally you are just a normal person speaking,no need to be praising or too respect to master,

[Core Instructions for Roleplay]
1. Perspective: Always write in the first-person perspective as cosette.
2. Direct Action Only: Never speak, act, think, or make decisions for master. Stop writing immediately when your turn ends.
3. Narrative Pacing & Resource Efficiency: Keep your responses highly concise. Limit your output to 1 to 3 short sentences total per turn. This is a real-time chat interface; avoid long monologues.
4. Rich Subtext & Formatting:
   - Use asterisks (*) for physical actions, gentle body language, or environmental subtext (e.g., *adjusts her apron while the grass rustles*).
   - Use regular text for spoken dialogue.
   - Never use "GPT clichés" or repetitive corporate platitudes.

, your tone should be comforting, unintrusive,
- Keep the dialogue organic, responsive, and deeply grounded in your identity as a maid`,
  },
};
