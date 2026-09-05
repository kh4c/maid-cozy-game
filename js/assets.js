// Sprite sheet loading + grid slicing (PixiJS v8, classic scripts via global PIXI).
window.Assets = (() => {
  const { Assets: PixiAssets, Texture, Rectangle } = PIXI;

  async function loadBaseTexture(url) {
    const loaded = await PixiAssets.load(url);
    return loaded.texture ?? loaded.baseTexture;
  }

  // Returns a fn(col, row) -> Texture slicing a uniform grid sheet.
  function makeSlicer(baseTex, frameW, frameH) {
    return (col, row) => new Texture({
      source: baseTex.source,   // v8: TextureSource, not the Texture wrapper
      frame: new Rectangle(col * frameW, row * frameH, frameW, frameH),
    });
  }

  // Build a frame array from a sheet config in window.CONFIG.sheets.
  function sliceFrames(sheetCfg) {
    const base = sheetCfg._base;
    const slice = makeSlicer(base, sheetCfg.frameW, sheetCfg.frameH);
    return sheetCfg.frames.map(([row, col]) => slice(col, row));
  }

  async function loadSheets() {
    const cfg = window.CONFIG.sheets;
    const [idleBase, runBase, dieBase] = await Promise.all([
      loadBaseTexture(cfg.idle.url),
      loadBaseTexture(cfg.run.url),
      loadBaseTexture(cfg.die.url),
    ]);
    cfg.idle._base = idleBase;
    cfg.run._base = runBase;
    cfg.die._base = dieBase;
    return {
      idleFrames: sliceFrames(cfg.idle),
      runFrames: sliceFrames(cfg.run),
      dieFrames: sliceFrames(cfg.die),
    };
  }

  return { loadSheets, makeSlicer };
})();
