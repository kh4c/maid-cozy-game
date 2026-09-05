// Global game configuration. Loaded first — everything else reads from here.
window.CONFIG = {
  // Sprite sheets (64x64 frames)
  sheets: {
    idle: { url: 'assets/SG_Maid_Idle.png', frameW: 64, frameH: 64, cols: 4,
            // [row, col] of each OPAQUE frame, reading order (pixel-verified)
            frames: [[0,0],[0,1],[0,2],[0,3],[1,0],[1,1],[1,2],[1,3],[2,0]] },
    run:  { url: 'assets/SG_Maid_Run.png', frameW: 64, frameH: 64, cols: 4,
            frames: [[0,0],[0,1],[0,2],[0,3],[1,0],[1,1],[1,2]] },
  },

  // Background image (user-provided grassland with dirt patches, streamed as chunks)
  background: {
    url: 'assets/grassland.png',   // 1254x1254
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
    scale: 2.5,     // sprite render scale (64px -> 160px on screen)
    sunray: 1,      // sunray effect master opacity 0..1
    maxTilt: 0.45,  // run lean, radians (~26°) at full vertical input
    // Live2D companion (upper-body framing): tuned live with the drag/wheel
    // placement tool, then baked in here as the shipped default.
    l2dOn: 1,       // 0/1 show-hide
    l2dZoom: 1,     // 1.0 = model is 2x screen height (upper body fills screen)
    l2dx: 0.8,      // horizontal position as fraction of screen width
    l2dy: 0.12,     // vertical: top-of-head anchor; negative trims headroom
    l2dExpr: 0,     // 0 = auto-cycle expressions; 1..6 = pin a specific one
  },
};
