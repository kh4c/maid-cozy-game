// Cinematic sunray overlay: additive light shafts + sun glow + drifting motes.
// Beams live in SCREEN space (attached above the world) — the sun doesn't move
// when the character walks. Gradient textures are generated once at runtime
// (pure VFX; no game-art assets involved).
window.Effects = (() => {
  const { Container, Sprite, Texture } = PIXI;

  // horizontal beam: soft across its height, fading at both ends
  function beamTexture() {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    const across = g.createLinearGradient(0, 0, 0, 64);
    across.addColorStop(0, 'rgba(255,240,190,0)');
    across.addColorStop(0.5, 'rgba(255,240,190,1)');
    across.addColorStop(1, 'rgba(255,240,190,0)');
    g.fillStyle = across;
    g.fillRect(0, 0, 256, 64);
    const along = g.createLinearGradient(0, 0, 256, 0);
    along.addColorStop(0, 'rgba(0,0,0,0)');
    along.addColorStop(0.2, 'rgba(0,0,0,1)');
    along.addColorStop(0.8, 'rgba(0,0,0,1)');
    along.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalCompositeOperation = 'destination-in';
    g.fillStyle = along;
    g.fillRect(0, 0, 256, 64);
    return Texture.from(c);
  }

  function radialTexture(size, inner, mid) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const r = size / 2;
    const rad = g.createRadialGradient(r, r, 0, r, r, r);
    rad.addColorStop(0, inner);
    rad.addColorStop(0.4, mid);
    rad.addColorStop(1, 'rgba(255,244,200,0)');
    g.fillStyle = rad;
    g.fillRect(0, 0, size, size);
    return Texture.from(c);
  }

  // directional sunlight shade: clear at the top-left source, dim to the
  // bottom-right falloff (normal blend — this one darkens, not glows).
  function shadeTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const d = g.createLinearGradient(0, 0, 256, 256);
    d.addColorStop(0, 'rgba(4,4,14,0)');
    d.addColorStop(0.55, 'rgba(4,4,14,0.06)');
    d.addColorStop(1, 'rgba(4,4,16,0.45)');
    g.fillStyle = d;
    g.fillRect(0, 0, 256, 256);
    return Texture.from(c);
  }

  function create(app) {
    const layer = new Container();
    // Beams back on per user request — breathing is slow/small and the wrap
    // margin (1000px) keeps long beams fully off-screen, so no flicker.
    const BEAMS_ON = true;

    // sun glow pinned near the top-left corner (sun sits just off-screen)
    const glow = new Sprite(radialTexture(256, 'rgba(255,244,200,0.9)', 'rgba(255,244,200,0.35)'));
    glow.anchor.set(0.5);
    glow.position.set(app.screen.width * 0.08, -app.screen.height * 0.06);
    glow.scale.set(2.4);
    glow.alpha = 0.3;
    glow.blendMode = 'add';
    layer.addChild(glow);

    // light shafts crossing the screen — slow breathing + wide wrap, no flicker.
    const beams = [];
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647; // deterministic
    if (BEAMS_ON) {
      const btex = beamTexture();
      // [cx, cy, length, thick, baseAlpha, rot, drift]
      const defs = [
        [0.18, 0.10, 1500, 200, 0.10, 0.55, 7],
        [0.40, 0.28, 1900, 120, 0.07, 0.50, 9],
        [0.66, 0.05, 1600, 260, 0.08, 0.60, 6],
        [0.26, 0.62, 1800, 90,  0.06, 0.47, 11],
        [0.58, 0.55, 2100, 150, 0.05, 0.56, 8],
        [0.84, 0.38, 1700, 70,  0.07, 0.51, 12],
      ];
      for (const [fx, fy, len, thick, a, rot] of defs) {
        const s = new Sprite(btex);
        s.anchor.set(0.5);
        s.position.set(app.screen.width * fx, app.screen.height * fy);
        s.scale.set(len / 256, thick / 64); // texture is 256x64; scale to target size (s.width/height would work too)
        s.rotation = rot;
        s.alpha = a;
        s.blendMode = 'add';
        beams.push({
          s, base: a,
          bx: s.x, by: s.y, // sway AROUND home — no wrapping, no teleport, no flicker, ever
          dirX: Math.cos(rot), dirY: Math.sin(rot),
          phase: rand() * Math.PI * 2,
          pulse: 0.3 + rand() * 0.5,        // rad/s of alpha flicker
          amp: 50 + rand() * 50,            // px of drift along the beam
          rate: 0.10 + rand() * 0.12,       // sway speed — barely moving
        });
        layer.addChild(s);
      }
    }

    // dust motes drifting along the rays
    const motes = [];
    const mtex = radialTexture(16, 'rgba(255,250,220,1)', 'rgba(255,250,220,0.4)');
    for (let i = 0; i < 22; i++) {
      const m = new Sprite(mtex);
      m.anchor.set(0.5);
      m.blendMode = 'add';
      m.alpha = 0.15 + rand() * 0.35;
      m.scale.set(0.25 + rand() * 0.6);
      m.position.set(rand() * app.screen.width, rand() * app.screen.height);
      motes.push({ s: m, spd: 14 + rand() * 26, wob: rand() * Math.PI * 2, rot: 0.5 });
      layer.addChild(m);
    }

    // very subtle warm grade over everything, plus the directional shade:
    // top-left stays sun-clear, bottom-right falls dim (both day-only).
    const grade = new Sprite(Texture.WHITE);
    grade.width = app.screen.width; grade.height = app.screen.height;
    grade.tint = 0xffe9b8;
    grade.alpha = 0.06;
    grade.blendMode = 'add';
    layer.addChild(grade);
    const shade = new Sprite(shadeTexture());
    shade.width = app.screen.width; shade.height = app.screen.height;
    layer.addChild(shade);

    let t = 0;
    function update(dtSec, dayF) {
      t += dtSec;
      const day = (typeof dayF === 'number') ? dayF : 1; // 1 = noon sun, 0 = night — the sun goes to bed, motes stay up
      layer.alpha = window.Settings.settings.sunray;
      const W = app.screen.width, H = app.screen.height;
      glow.alpha = 0.3 * day;
      shade.alpha = day; // the falloff is sunlight — gone by night

      for (const b of beams) {
        // gentle breathing: small amplitude, slow — a smooth sine, never a strobe
        b.s.alpha = b.base * day * (0.9 + 0.1 * Math.sin(t * b.pulse * 0.4 + b.phase));
        // slow sway around home along the beam axis — bounded, continuous,
        // nothing ever wraps or teleports, so there is nothing TO flicker.
        const sw = Math.sin(t * b.rate + b.phase);
        b.s.x = b.bx + b.dirX * sw * b.amp;
        b.s.y = b.by + b.dirY * sw * b.amp;
      }

      for (const mo of motes) {
        const s = mo.s;
        s.x += Math.cos(mo.rot) * mo.spd * dtSec + Math.sin(t * 0.8 + mo.wob) * 6 * dtSec;
        s.y += Math.sin(mo.rot) * mo.spd * dtSec;
        if (s.x > W + 20 || s.y > H + 20) { s.x = -10 + Math.random() * W * 0.5; s.y = Math.random() * H * 0.4; }
      }
    }

    return { layer, update };
  }

  return { create };
})();
