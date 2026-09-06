// Hometown — a walk-to district in the same endless world, east of spawn.
// Safe streets: the spawner rests inside, packs wander off, she heels.
// Road + plaza + houses + a well, and 4 talkable townsfolk with scripted
// bubbles. Click an NPC: she walks over (if far) and they talk; Marta opens
// the shop, Wren mends. Classic script.
window.Town = (() => {
  const X = 3600, Y = 0;    // town square — follow the dirt road east from spawn
  const SAFE_R = 1000;      // inside: no spawns, packs dismissed, she heels
  const TALK_R = 80;        // a click landing this near an NPC talks, not walks
  const MEET_R = 380;       // maid must be this near to speak — else she walks over
  const BUBBLE_SECS = 6;    // talk bubbles linger, then fade

  const NPCS = [
    { id: 'marta', name: 'Marta', color: 0x2e8b8b, x: 230, y: 60, role: 'shop',
      greet: 'Well well — a maid, all the way out here? *wipes the counter* Coin spends the same, field or town. Have a browse!',
      lines: [
        'Thread, oil, buckles — a rifle like that eats care. My whole stock is on your 🛒 board.',
        'Critter pelts? The field pays you, I just sell. *grins, counts nothing*',
        'Your master quiet? Mine talked the ear off a mule. Enjoy the silence, dearie.' ] },
    { id: 'bram', name: 'Old Bram', color: 0x8b7355, x: -70, y: -140, role: null,
      greet: 'Hunters, girl. *taps his stick twice* Critters spook and scatter — pitiful things. But a red-ringed hunter WANTS blood. Doubt the first. Never the second.',
      lines: [
        'Thirty years these fields. The gray ones flee, the red ones hunt. Remember it.',
        'Legs give out, you rest. No shame — the grass has tripped better folk than you.',
        'Town is safe. Nothing with teeth comes past the gate. Mostly. *coughs*' ] },
    { id: 'pip', name: 'Pip', color: 0x9ab82e, x: 150, y: 210, role: null, wander: 130,
      greet: 'WHOA a real maid!! *drops his hoop* Did you REALLY shoot a hunter?! Tell me everything—',
      lines: [
        'I wanna hunt when I am big! Ma says no. Ma is always no. *kicks dirt*',
        'Raced a critter once. Lost. It was not even running. *sighs*',
        'If you see my hoop, it is NOT lost, it is exploring. Same as you!' ] },
    { id: 'wren', name: 'Sister Wren', color: 0x7fa8c9, x: -290, y: 170, role: 'heal',
      greet: 'Come, come — field-dust and all. *warm hands, flour on the cuffs* The chapel mends what the grass breaks. Free, always.',
      lines: [
        'Breathe in... there. Legs are legs again. The town looks after its own.',
        'Nine hearts you carry, same as any candle. Do not burn them all at once, child.',
        'Rest a moment? The road can wait. Roads are patient. I checked.' ] },
  ];

  let built = false, layer = null, t = 0;
  let npcs = [];        // runtime: { def, vx, vy, view, tag, bubble, bubbleBg, bubbleTx, bubbleT, met, lineIdx }
  let pendingTalk = null;
  let lastMaid = null; // cached from update() — tryTalk reads it between frames
  let townSeen = false;

  function isInTown(x, y) {
    const dx = Number(x) - X, dy = Number(y) - Y;
    return dx * dx + dy * dy <= SAFE_R * SAFE_R;
  }

  function describe() {
    return `Hometown: safe town far EAST at world (${X}, ${Y}) — follow the dirt road from spawn. No monsters inside; Marta sells (opens your 🛒), Wren mends wounds free, Bram knows the field, Pip is Pip.`;
  }

  // ---- look: all Pixi Graphics, code-drawn like the rest of the field --------
  function house(g, x, y, w, h, body, roof) {
    g.beginFill(body); g.drawRect(x - w / 2, y - h / 2, w, h); g.endFill();
    g.beginFill(roof);
    g.drawPolygon([x - w / 2 - 14, y - h / 2, x + w / 2 + 14, y - h / 2, x, y - h / 2 - 70]);
    g.endFill();
    g.beginFill(0x4a3520); g.drawRect(x - 16, y + h / 2 - 56, 32, 56); g.endFill(); // door
    g.beginFill(0xfff2b0); // lit windows
    g.drawRect(x - w / 2 + 14, y - 12, 26, 24); g.drawRect(x + w / 2 - 40, y - 12, 26, 24);
    g.endFill();
  }

  function figure(color) {
    const P = window.PIXI || PIXI;
    const c = new P.Container();
    const g = new P.Graphics();
    g.beginFill(color); // robe
    g.drawPolygon([-20, 20, 20, 20, 12, -38, -12, -38]);
    g.endFill();
    g.beginFill(0xe8b88a); g.drawCircle(0, -52, 14); g.endFill(); // head
    g.beginFill(color); g.drawCircle(0, -56, 17); g.endFill();    // hood...
    g.beginFill(0xe8b88a); g.drawCircle(0, -50, 10); g.endFill(); // ...with a face
    c.addChild(g);
    return c;
  }

  function text(str, size, fill) {
    const P = window.PIXI || PIXI;
    return new P.Text(str, { fontSize: size, fill: fill || '#fff6d8', stroke: '#1a1208', strokeThickness: 4, wordWrap: true, wordWrapWidth: 380 });
  }

  function init(world) {
    if (built) return;
    const P = window.PIXI || PIXI;
    layer = new P.Container();
    const g = new P.Graphics();
    // dirt road: spawn's doorstep to the gate
    g.beginFill(0x8a6f4d, 0.55); g.drawRect(150, -45, (X - 800) - 150, 90); g.endFill();
    // plaza
    g.beginFill(0x9a9a92, 0.5); g.drawCircle(X, Y, 380); g.endFill();
    layer.addChild(g);
    // houses (world coords)
    const gh = new P.Graphics();
    house(gh, X + 230, Y + 250, 220, 150, 0xc9b18a, 0x8a3b2e); // Marta's shop, big
    house(gh, X - 350, Y + 60, 150, 120, 0xbfae87, 0x5e4a35);
    house(gh, X - 120, Y + 330, 170, 130, 0xc4b393, 0x71452f);
    house(gh, X + 420, Y - 180, 150, 120, 0xb8a67f, 0x4f5e6b);
    house(gh, X - 40, Y - 360, 190, 140, 0xc9b18a, 0x8a3b2e);
    layer.addChild(gh);
    // well (Bram leans nearby)
    const w = new P.Graphics();
    w.beginFill(0x8d8d96); w.drawCircle(X - 70, Y - 40, 40); w.endFill();
    w.beginFill(0x141420); w.drawCircle(X - 70, Y - 40, 25); w.endFill();
    w.beginFill(0x5e4a35); w.drawRect(X - 96, Y - 120, 12, 84); w.drawRect(X - 56, Y - 120, 12, 84); w.endFill();
    w.beginFill(0x8a3b2e); w.drawPolygon([X - 106, Y - 118, X - 34, Y - 118, X - 70, Y - 162]); w.endFill();
    layer.addChild(w);
    // gate (west entrance) + signpost near spawn
    const gt = new P.Graphics();
    gt.beginFill(0x5e4a35);
    gt.drawRect(X - 812, Y - 110, 24, 220);
    gt.drawRect(X - 688, Y - 110, 24, 220);
    gt.drawRect(X - 824, Y - 140, 200, 30);
    gt.endFill();
    gt.beginFill(0x5e4a35); gt.drawRect(244, -20, 12, 130); gt.endFill();
    layer.addChild(gt);
    const gate = text('HOMETOWN', 30); gate.position.set(X - 800, Y - 190); layer.addChild(gate);
    const sign = text('hometown →', 22); sign.position.set(262, 60); layer.addChild(sign);
    // lamp posts around the plaza
    const lp = new P.Graphics();
    [[420, 180], [-420, 180], [420, -180], [-420, -180]].forEach(([ox, oy]) => {
      lp.beginFill(0x3a3a44); lp.drawRect(X + ox - 5, Y + oy - 90, 10, 90); lp.endFill();
      lp.beginFill(0xffd98a); lp.drawCircle(X + ox, Y + oy - 100, 12); lp.endFill();
    });
    layer.addChild(lp);
    // townsfolk
    npcs = NPCS.map((def) => {
      const view = figure(def.color);
      const vx = X + def.x, vy = Y + def.y;
      view.position.set(vx, vy);
      const tag = text(def.name, 20); tag.position.set(vx - 30, vy - 108); // nameplate
      const bubble = new P.Container();
      const bg = new P.Graphics();
      const tx = text('', 22, '#ffffff');
      tx.position.set(12, 8);
      bubble.addChild(bg); bubble.addChild(tx);
      bubble.visible = false;
      layer.addChild(view); layer.addChild(tag); layer.addChild(bubble);
      return { def, vx, vy, view, tag, bubble, bubbleBg: bg, bubbleTx: tx, bubbleT: 0, met: false, lineIdx: 0 };
    });
    world.addChild(layer);
    built = true;
  }

  // ---- talk -------------------------------------------------------------------
  function maidPos() {
    if (lastMaid) return lastMaid;
    try {
      const s = window.Situation && window.Situation.snapshot ? window.Situation.snapshot() : null;
      if (s) return { x: s.px, y: s.py };
    } catch (e) {}
    return null;
  }

  function showBubble(npc, line) {
    npc.bubbleTx.text = line;
    const w = Math.min(400, (npc.bubbleTx.width || 200) + 24);
    const h = 64;
    npc.bubbleBg.clear();
    npc.bubbleBg.beginFill(0x141420, 0.92);
    npc.bubbleBg.drawRoundedRect(0, 0, w, h, 12);
    npc.bubbleBg.endFill();
    npc.bubble.position.set(npc.vx - w / 2, npc.vy - 190);
    npc.bubble.visible = true;
    npc.bubbleT = BUBBLE_SECS;
  }

  function speak(npc) {
    const line = !npc.met ? npc.def.greet : npc.def.lines[npc.lineIdx % npc.def.lines.length];
    if (npc.met) npc.lineIdx++;
    npc.met = true;
    showBubble(npc, line);
    try {
      if (npc.def.role === 'shop' && window.Store && window.Store.setOpen) window.Store.setOpen(true); // Marta: the till opens itself
      if (npc.def.role === 'heal' && window.Health && window.Health.hp < window.Health.max) {
        window.Health.heal(99); // Wren: chapel rates (free)
        showBubble(npc, line + ' *her hands are warm; the aches close up*');
      }

    } catch (e) {}
    return line;
  }

  function talkTo(id) { // tests + later dialog UI
    const npc = npcs.find((n) => n.def.id === id);
    return npc ? speak(npc) : null;
  }

  // click landed at (wx, wy): near an NPC → talk (walk over first if far).
  // Returns true when the click was consumed (don't walk there blindly).
  function tryTalk(wx, wy) {
    if (!built) return false;
    let best = null, bd = TALK_R;
    for (const npc of npcs) {
      const d = Math.hypot(npc.vx - wx, npc.vy - wy);
      if (d < bd) { bd = d; best = npc; }
    }
    if (!best) return false;
    const m = maidPos();
    if (m && Math.hypot(best.vx - m.x, best.vy - m.y) <= MEET_R) speak(best);
    else {
      pendingTalk = best; // she'll speak on arrival
      try { window.Input && window.Input.clickTo && window.Input.clickTo(best.vx, best.vy); } catch (e) {}
    }
    return true;
  }

  function update(dt, mx, my) {
    if (!built) return;
    t += dt;
    lastMaid = { x: mx, y: my };
    if (!townSeen && isInTown(mx, my)) {
      townSeen = true; // first boots on the plaza — scripted wonder, no LLM
      try { window.Chat && window.Chat.say && window.Chat.say('*slows at the gate* ...a town? Master, look — roofs! People! *straightens her apron. Twice.*'); } catch (e) {}
    }
    for (const npc of npcs) {
      if (npc.def.wander) { // Pip never stands still
        npc.vx = X + npc.def.x + Math.cos(t * 0.45) * npc.def.wander;
        npc.vy = Y + npc.def.y + Math.sin(t * 0.7) * npc.def.wander * 0.5;
        npc.view.position.set(npc.vx, npc.vy);
        npc.tag.position.set(npc.vx - 30, npc.vy - 108);
        if (npc.bubble.visible) npc.bubble.position.set(npc.vx - 190, npc.vy - 190);
      }
      if (npc.bubbleT > 0) {
        npc.bubbleT -= dt;
        if (npc.bubbleT <= 0) npc.bubble.visible = false;
      }
    }
    if (pendingTalk) { // walked over on a click — speak on arrival
      const d = Math.hypot(pendingTalk.vx - mx, pendingTalk.vy - my);
      if (d <= 140) { speak(pendingTalk); pendingTalk = null; }
    }
  }

  function debugNpcs() { return npcs.map((n) => ({ id: n.def.id, met: n.met })); }

  return { init, update, tryTalk, talkTo, speak: talkTo, isInTown, describe, debugNpcs, X, Y, SAFE_R, TALK_R, MEET_R, get layer() { return layer; } };
})();
