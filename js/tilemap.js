// Infinite background: streams 1254x1254 chunks around the camera.
// Chunks are added just before they enter view and destroyed once they
// leave it, so memory stays flat no matter how far you walk.
window.Tilemap = (() => {
  const { Sprite, Container } = PIXI;

  async function create() {
    const cfg = window.CONFIG;
    // cache-bust: python http.server sends no cache headers, browsers hold stale copies
    const tex = await PIXI.Assets.load(cfg.background.url + '?v=' + Date.now());
    const S = cfg.chunkSize;

    const layer = new Container();   // all chunk sprites live here (below the character)
    const chunks = new Map();        // "cx,cy" -> Sprite

    const key = (cx, cy) => cx + ',' + cy;

    function ensure(cx, cy) {
      const k = key(cx, cy);
      if (chunks.has(k)) return;
      const s = new Sprite(tex);
      s.position.set(cx * S, cy * S);
      chunks.set(k, s);
      layer.addChild(s);
    }

    function prune(minX, minY, maxX, maxY) {
      for (const [k, s] of chunks) {
        const [cx, cy] = k.split(',').map(Number);
        if (cx < minX || cx > maxX || cy < minY || cy > maxY) {
          s.destroy();          // frees the sprite; shared texture stays cached
          chunks.delete(k);
        }
      }
    }

    // focus = world point at screen center (the character). margin in chunks.
    function update(focusX, focusY, viewW, viewH, margin = 1) {
      const minX = Math.floor((focusX - viewW / 2) / S) - margin;
      const maxX = Math.floor((focusX + viewW / 2) / S) + margin;
      const minY = Math.floor((focusY - viewH / 2) / S) - margin;
      const maxY = Math.floor((focusY + viewH / 2) / S) + margin;
      for (let cy = minY; cy <= maxY; cy++)
        for (let cx = minX; cx <= maxX; cx++)
          ensure(cx, cy);
      // hysteresis: keep one extra ring so chunks don't thrash at boundaries
      prune(minX - 1, minY - 1, maxX + 1, maxY + 1);
      return chunks.size;
    }

    return { layer, update };
  }

  return { create };
})();
