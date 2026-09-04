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

  // Defaults for dev-panel-adjustable settings (persisted to localStorage)
  defaults: {
    speed: 140,     // px per second
    idleFps: 8,     // idle animation frames/sec
    runFps: 12,     // run animation frames/sec
    scale: 2,       // sprite render scale (64px -> 128px on screen)
    sunray: 1,      // sunray effect master opacity 0..1
  },
};
