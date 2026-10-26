
  // ---------------------------------------------------------------- bombs, blasts, bullets, pickups, collisions
  function blast(x, y, R, dmg, air, ground) {
    const R2 = R * R; let hits = 0;
    if (air) for (const e of enemies) { if (e.dead || e.t < 0) continue; if (d2(x, y, e.x, e.y) <= (R + e.r * 0.5) * (R + e.r * 0.5)) { hits++; damageEnemy(e, dmg); } }
    for (const h of hulks) {
      if (h.dead) continue;
      const isSea = h.kind === 'ship';
      if ((isSea && !ground) || (!isSea && !air)) continue;
      for (const t of h.turrets) { if (t.dead) continue; turretPos(h, t, TP); if (d2(x, y, TP[0], TP[1]) <= R2) { hits++; damagePart(h, t, dmg); } }
      if (h.dead) continue;
      const hw = isSea ? h.w * 0.45 : h.w * 0.48, hh = h.h * 0.47;
      const cx = clamp(x, h.x - hw, h.x + hw), cy = clamp(y, h.y - hh, h.y + hh);
      if (d2(x, y, cx, cy) <= R2) { hits++; damageHulk(h, dmg); }
    }
    return hits;
  }
  function detonateNuke(x, y, R, dmg) {
    const hits = blast(x, y, R, dmg, true, true);
    const cleared = eb.length; eb.length = 0; // every enemy bullet on screen is vaporised
    nukes.push({ x, y, t: 0, R, rot: rand(TAU), alt: 0 });
    for (let i = 0; i < 10; i++) { const a = rand(TAU), r = rand(0.2, 0.9) * R; parts.push({ k: 'blacksmoke', x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, vx: Math.cos(a) * 14, vy: Math.sin(a) * 14 - 4, life: rand(1.6, 2.6), max: 2.6, s: rand(26, 42), alt: 6, va: 14 }); }
    for (let i = 0; i < 14; i++) { const a = i / 14 * TAU; parts.push({ k: 'splash', x: x + Math.cos(a) * R * 0.85, y: y + Math.sin(a) * R * 0.85, vx: Math.cos(a) * 40, vy: Math.sin(a) * 40, life: 1.1, max: 1.1, s: rand(16, 24), rot: rand(TAU), alt: 0 }); }
    flashT = Math.max(flashT, 0.4); shake = Math.max(shake, 16);
    A.sfx('nuke'); A.haptic(45);   // the one blast that earns a long one
    blastCount++;
    lastBlast = { x: +x.toFixed(1), y: +y.toFixed(1), r: +R.toFixed(1), dmg, hits, cleared, n: blastCount };
  }
  function detonateBomb(b, x, y) {
    b.done = true; b.life = 0;
    const sp = bombSpec(b.btype, b.lvl);
    if (b.btype === 'nuke') return detonateNuke(x, y, sp.R, b.dmg);
    const R = b.owner ? 14 : sp.R;
    blast(x, y, R, b.dmg, false, true);
    fx.push({ id: gid++, x, y, t: 0, dur: 0.55 + R * 0.012, s: R * 1.1, vy: SCROLL, rot: rand(TAU), spin: rand(-1, 1), alt: 1, ground: true });
    splashAt(x, y, R * 1.1, 2); shake = Math.max(shake, 2.5); A.sfx('bombhit'); A.haptic(22);
    if (b.btype === 'cluster') {
      for (let i = 0; i < sp.n; i++) {
        const a = i / sp.n * TAU + rand(-0.2, 0.2), r = rand(16, 30) * ST.bombRadius;
        const bx = x + Math.cos(a) * r, by = y + Math.sin(a) * r;
        warns.push({ id: gid++, x: bx, y: by, r: 10 * ST.bombRadius, t: 0, dur: 0.18 + i * 0.04, dmg: 0, friendly: true, bdmg: 5 + 2 * (b.lvl - 1) });
      }
    } else if (b.btype === 'napalm') zones.push({ id: gid++, x, y: y - sp.zh * 0.3, w: sp.zw, h: sp.zh, t: 0, dur: sp.zt, dps: sp.dps });
  }
  function airburst(b, x, y) {
    b.done = true; b.life = 0;
    const R = 12, dmg = b.btype === 'nuke' ? 0 : 2 + (b.lvl - 1);
    if (b.btype === 'nuke') return detonateNuke(x, y, bombSpec('nuke', b.lvl).R, b.dmg);
    blast(x, y, R, dmg, true, false);
    fx.push({ id: gid++, x, y, t: 0, dur: 0.4, s: 10, vy: 0, rot: rand(TAU), spin: 0, alt: 40, airburst: true });
    A.sfx('boom');
  }
  // A bullet travels further in one frame than an aircraft is wide: 430 units a second is over 7
  // units a frame at 60fps and twice that on a phone that drops one, against a fighter nine units
  // across. Testing only where the bullet ENDED the frame let whole bursts pass straight through a
  // target the player was aiming dead at - which is what "the guns do not kill air targets" was.
  // Test the segment it actually swept.
  function swept(b, x, y, r) {
    const ax = b.px === undefined ? b.x : b.px, ay = b.py === undefined ? b.y : b.py;
    const dx = b.x - ax, dy = b.y - ay, L2 = dx * dx + dy * dy;
    let u = L2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / L2 : 0;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    return d2(ax + dx * u, ay + dy * u, x, y) < r * r;
  }
  function updateBullets(dt) {
    for (const b of pb) {
      b.px = b.x; b.py = b.y;
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (b.kind === 'bomb' && b.max) b.alt = Math.max(ALT.SEA, b.alt * (b.life / b.max));   // drawn falling to the water
      if (b.kind === 'bomb' && !b.done && (b.life <= 0 || b.y < HUD_H + 4)) detonateBomb(b, b.x, Math.max(b.y, HUD_H + 4));
      if (b.kind === 'torp') { if (b.armT > 0) { b.armT -= dt; if (b.armT <= 0) splashAt(b.x, b.y, 6); } else if (Math.random() < dt * 30) parts.push({ k: 'foam', x: b.x, y: b.y + 3, vx: 0, vy: SCROLL, life: 1.0, max: 1.0, s: 2, alt: 0 }); }
    }
    sweep(pb, (b) => b.life <= 0 || b.y < -24 || b.x < -10 || b.x > W + 10);
    for (const b of eb) { b.x += b.vx * dt; b.y += b.vy * dt; }
    sweep(eb, (b) => b.y < -10 || b.y > H + 10 || b.x < -10 || b.x > W + 10);
    // telegraphed hazards (flak shells, cluster bomblets)
    for (const w of warns) {
      w.t += dt;
      if (w.t >= w.dur && !w.fired) {
        w.fired = true;
        if (w.friendly) { blast(w.x, w.y, w.r, w.bdmg, false, true); fx.push({ id: gid++, x: w.x, y: w.y, t: 0, dur: 0.5, s: w.r * 1.2, vy: SCROLL, rot: rand(TAU), spin: 0, alt: 1, ground: true }); A.sfx('bombhit'); }
        else {
          fx.push({ id: gid++, x: w.x, y: w.y, t: 0, dur: 0.55, s: w.r * 1.1, vy: 0, rot: rand(TAU), spin: 0, alt: 40, airburst: true }); A.sfx('flak');
          const p = player;
          if (p && !p.dead && p.loopT <= 0 && d2(w.x, w.y, p.x, p.y) < w.r * w.r) hurt(w.dmg);
          for (const m of wing) if (!m.dead && d2(w.x, w.y, m.x, m.y) < w.r * w.r) hurtWing(m, w.dmg * 0.7);
        }
      }
    }
    sweep(warns, (w) => w.fired && w.t > w.dur + 0.05);
    for (const z of zones) {
      z.t += dt; z.y += SCROLL * dt;
      if (Math.random() < dt * 14) parts.push({ k: 'flame', x: z.x + rand(-z.w / 2, z.w / 2), y: z.y + rand(-z.h / 2, z.h / 2), vx: 0, vy: SCROLL, life: 0.5, max: 0.5, s: rand(5, 9), alt: 1, va: 8 });
      if (Math.random() < dt * 5) parts.push({ k: 'blacksmoke', x: z.x + rand(-z.w / 2, z.w / 2), y: z.y + rand(-z.h / 2, z.h / 2), vx: 0, vy: SCROLL - 6, life: 1.2, max: 1.2, s: rand(8, 12), alt: 3, va: 12 });
      for (const h of hulks) {
        if (h.dead || h.kind !== 'ship') continue;
        if (Math.abs(h.x - z.x) < z.w / 2 + h.w * 0.4 && Math.abs(h.y - z.y) < z.h / 2 + h.h * 0.45) {
          damageHulk(h, z.dps * dt * 0.6);
          for (const t of h.turrets) if (!t.dead && Math.abs(h.x + t.ox - z.x) < z.w / 2 && Math.abs(h.y + t.oy - z.y) < z.h / 2) damagePart(h, t, z.dps * dt);
        }
      }
    }
    sweep(zones, (z) => z.t > z.dur);
  }
  function updatePickups(dt) {
    const p = player;
    for (const k of pickups) {
      k.t += dt; k.cd -= dt;
      k.vy += (30 - k.vy) * Math.min(1, dt * 1.4);
      k.y += k.vy * dt; k.x = clamp(k.x + Math.sin(k.t * 1.8) * 18 * dt, 12, W - 12);
      if (ST.magnet > 0 && p && !p.dead && d2(k.x, k.y, p.x, p.y) < (ST.magnet + 30) * (ST.magnet + 30)) { const a = Math.atan2(p.y - k.y, p.x - k.x); k.x += Math.cos(a) * 90 * dt; k.y += Math.sin(a) * 90 * dt; }
      if (k.y < HUD_H + 12) { k.y = HUD_H + 12; k.vy = Math.max(k.vy, 0); }
    }
    sweep(pickups, (k) => k.y > H + 20 || k.taken);
  }
  function collect(k) {
    const p = player, type = POW[k.fam][k.ti];
    k.taken = true; merit(3);
    if (type === 'repair') {
      const patch = 35 * ST.repairGain, gain = Math.min(patch, ST.armorMax - p.armor);
      p.armor = Math.min(ST.armorMax, p.armor + patch);
      popup(p.x, p.y - 18, gain > 0 ? 'REPAIR +' + Math.round(gain) : '+500', '#9fe07a', 9); A.sfx('repair'); addScore(500);
      for (const w of wing) if (!w.dead) w.armor = Math.min(w.max, w.armor + 12);
    } else if (k.fam === 'gun') {
      const g = run.gun;
      if (type === 'gunup' || type === g.type) g.lvl = Math.min(ST.gunCap, g.lvl + 1); else g.type = type;
      p.mode = 'guns';
      popup(p.x, p.y - 18, GUNS[g.type].name + ' LV' + g.lvl + (g.lvl >= ST.gunCap && ST.gunCap < 3 ? ' (MAX)' : ''), GUNS[g.type].col, 8); A.sfx('power'); addScore(300);
    } else {
      const b = run.bomb;
      if (type === b.type) b.lvl = Math.min(ST.bombCap, b.lvl + 1); else b.type = type;
      p.mode = 'bombs';
      popup(p.x, p.y - 18, BOMBS[b.type].name + ' LV' + b.lvl, BOMBS[b.type].col, 8); A.sfx('power'); addScore(300);
    }
    hook('pickup', type);
  }
  function collide() {
    const p = player;
    for (const b of pb) {
      if (b.life <= 0) continue;
      let hit = false;
      if (b.kind === 'bomb') {
        if (b.done) continue;
        // bombs are for ground and sea targets: they pass straight through aircraft
        for (const h of hulks) {
          if (h.dead || h.kind === 'air' || h.y + h.h / 2 < HUD_H || h.y - h.h / 2 > H) continue;
          if (hitHulk(h, b.x, b.y)) { detonateBomb(b, b.x, b.y); break; }
        }
        continue;
      }
      if (b.kind === 'torp') {
        if (b.armT > 0) continue;
        for (const h of hulks) {
          if (h.dead || h.kind !== 'ship') continue;
          if (hitHulk(h, b.x, b.y)) { damageHulk(h, b.dmg); for (const t of h.turrets) if (!t.dead && d2(b.x, b.y, h.x + t.ox, h.y + t.oy) < 400) damagePart(h, t, b.dmg * 0.5); explosion(b.x, b.y, 18, 0, SCROLL, 2); splashAt(b.x, b.y, 22, 3); A.sfx('bombhit'); b.life = 0; break; }
        }
        continue;
      }
      for (const k of pickups) {
        if (k.taken) continue;
        if (swept(b, k.x, k.y, 10)) {
          if (k.cd <= 0 && POW[k.fam].length > 1) {
            k.ti = (k.ti + 1) % POW[k.fam].length; k.cd = 0.2; k.vy = Math.min(k.vy, 0) - 14; A.sfx('cycle');
            sparksAt(k.x, k.y, 3, '#fff');
            if (!b.pierce) { hit = true; break; }
          }
        }
      }
      if (hit) { b.life = 0; continue; }
      for (const e of enemies) {
        if (e.dead || e.t < 0) continue;
        if (swept(b, e.x, e.y, e.r)) {
          if (b.pierce) { if (b.hits.indexOf(e) >= 0) continue; b.hits.push(e); }
          damageEnemy(e, b.dmg); sparksAt(b.x, b.y, 2, '#ffe9a0');
          if (!b.pierce) { hit = true; break; }
        }
      }
      if (hit) { b.life = 0; continue; }
      for (let i = hulks.length - 1; i >= 0; i--) {
        const h = hulks[i];
        if (h.dead || h.y + h.h / 2 < HUD_H || h.y - h.h / 2 > H) continue;
        if (b.pierce && b.hits.indexOf(h) >= 0) continue;
        let struck = false;
        for (const t of h.turrets) {
          if (t.dead || t.kind === 'elevator') continue;
          turretPos(h, t, TP); const r = t.r;
          if (swept(b, TP[0], TP[1], r)) { damagePart(h, t, b.dmg * (t.kind === 'bridge' ? 0.5 : 1)); struck = true; break; }
        }
        if (!struck && hitHulk(h, b.x, b.y)) {
          // Rifle calibre against belt armour: it marks the paint. Bombs and torpedoes are what
          // open a hull, and that is the point of carrying them - guns are for the aircraft and
          // for stripping a ship's turrets, which take their hits in full above.
          damageHulk(h, b.dmg * (h.kind === 'ship' ? (h.isBoss ? 0.022 : 0.045) : 1)); struck = true;
        }
        if (struck) {
          sparksAt(b.x, b.y, 2, '#ffe9a0', h.kind === 'ship' ? 6 : 40);
          if (b.pierce) b.hits.push(h); else { hit = true; break; }
        }
      }
      if (hit) b.life = 0;
      if (b.kind === 'pellet') {
        for (const e of eb) if (!e.gone && swept(b, e.x, e.y, 11)) { e.gone = true; addScore(10); }
      }
    }
    sweep(eb, (e) => e.gone);
    // elevators can also be wrecked by bomb blasts only: handled in blast() through damagePart
    if (!p.dead) {
      const vulnerable = p.loopT <= 0;
      // The rounds are twice the size they were, so they take up twice the space - a shell you
      // can see and fly around has to be a shell that is actually there.
      for (const e of eb) {
        if (vulnerable && d2(e.x, e.y, p.x, p.y) < 81) { if (hurt(7)) { e.gone = true; continue; } }
        for (const w of wing) if (!w.dead && d2(e.x, e.y, w.x, w.y) < 64) { if (hurtWing(w, 7)) e.gone = true; }
      }
      sweep(eb, (e) => e.gone);
      for (const e of enemies) {
        if (e.dead || e.t < 0) continue;
        const r = e.r * 0.65 + 7;
        if (vulnerable && d2(e.x, e.y, p.x, p.y) < r * r && p.inv <= 0) { hurt(e.type === 'bomber' ? 18 : e.kami ? 16 : 12); killEnemy(e); continue; }
        for (const w of wing) if (!w.dead && d2(e.x, e.y, w.x, w.y) < r * r) { hurtWing(w, 14); killEnemy(e); break; }
      }
      for (const k of pickups) if (!k.taken && d2(k.x, k.y, p.x, p.y) < 15 * 15) collect(k);
    }
    sweep(enemies, (e) => e.dead);
  }
  function updateFx(dt) {
    for (const q of parts) {
      q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt; if (q.va) q.alt += q.va * dt;
      if (q.k === 'spark' || q.k === 'debris') { q.vx *= 0.92; q.vy *= 0.92; if (q.k === 'debris') { q.va -= 60 * dt; q.rot += q.spin * dt; if (q.alt < 0) { q.life = 0; splashAt(q.x, q.y, 4); } } }
    }
    sweep(parts, (q) => q.life <= 0);
    if (parts.length > 700) parts.splice(0, parts.length - 700);
    for (const f of fx) { f.t += dt; f.y += f.vy * dt; if (f.t >= 0 && !f.sounded && f.t < 0.1 && f.s > 12 && f.dur && !f.ground) { f.sounded = true; if (Math.random() < 0.5) A.sfx('boom'); } }
    sweep(fx, (f) => f.t > f.dur);
    for (const nk of nukes) { nk.t += dt; nk.y += SCROLL * dt * 0.5; }
    sweep(nukes, (nk) => nk.t > (nk.small ? 1.6 : 4.5));
    if (flashT > 0) flashT -= dt;
    for (const q of popups) { q.t += dt; q.y -= 18 * dt; }
    sweep(popups, (q) => q.t > 0.9);
  }
  function updateScenery(dt) {
    scrollY += SCROLL * dt;
    for (const i of islands) i.y += SCROLL * dt;
    sweep(islands, (i) => i.y > H + 110);
    nextIsland -= dt;
    // A level with a real coastline has its scenery already; dropping random islands on top of
    // Pearl Harbor is how you get an atoll in the middle of the East Loch.
    const L = curLevel(), dens = L && L.map ? 0 : (L && L.theme ? (L.theme.islands === undefined ? 1 : L.theme.islands) : 1);
    if (nextIsland <= 0) { nextIsland = rand(8, 15) / Math.max(0.2, dens); if (dens > 0) { const v = (Math.random() * nIslands()) | 0; islands.push({ v, x: rand(0, W), y: -70, f: Math.random() < 0.5, id: gid++, rot: rand(TAU) }); } }
    for (const c of clouds) c.y += c.sp * dt;
    sweep(clouds, (c) => c.y > H + 140);
    nextCloud -= dt; nextHigh -= dt;
    const cl = L && L.theme && L.theme.clouds !== undefined ? L.theme.clouds : 1;
    if (nextCloud <= 0) { nextCloud = rand(2.5, 5.5) / Math.max(0.3, cl); clouds.push(mkCloud(false)); }
    if (nextHigh <= 0) { nextHigh = rand(7, 14) / Math.max(0.3, cl); clouds.push(mkCloud(true, -170)); }
  }
