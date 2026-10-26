
  // ---------------------------------------------------------------- effects (alt = altitude layer for the 3D renderer: 0 sea .. 40 aircraft)
  function explosion(x, y, s, delay, vy, alt) {
    alt = alt !== undefined ? alt : (vy > 0 ? 3 : 40);
    fx.push({ id: gid++, x, y, t: -(delay || 0), dur: 0.55 + s * 0.014, s, vy: vy || 0, rot: rand(TAU), spin: rand(-1, 1), alt });
    if (!delay) {
      A.haptic(5 + s * 0.6);   // bigger blast, longer buzz
      const n = Math.min(14, 4 + (s / 2) | 0);
      for (let i = 0; i < n; i++) {
        const a = rand(TAU), sp = rand(30, 50 + s * 4);
        parts.push({ k: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + (vy || 0), life: rand(0.25, 0.6), max: 0.6, s: rand(0.8, 1.6), alt, va: rand(-10, 30) });
      }
      for (let i = 0; i < Math.min(5, s / 5); i++) parts.push({ k: 'smoke', x: x + rand(-s / 3, s / 3), y: y + rand(-s / 3, s / 3), vx: rand(-6, 6), vy: (vy || 0) - rand(4, 12), life: rand(0.8, 1.4), max: 1.4, s: s * rand(0.6, 1), alt, va: 8 });
      if (alt > 20 && s > 12) for (let i = 0; i < 4; i++) parts.push({ k: 'debris', x, y, vx: rand(-40, 40), vy: rand(-40, 40), life: rand(0.8, 1.4), max: 1.4, s: rand(1, 2.2), alt, va: rand(-30, 5), rot: rand(TAU), spin: rand(-12, 12) });
    }
  }
  function sparksAt(x, y, n, col, alt) {
    for (let i = 0; i < n; i++) { const a = rand(TAU), sp = rand(30, 90); parts.push({ k: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.1, 0.25), max: 0.25, s: 0.9, col, alt: alt === undefined ? 40 : alt, va: 0 }); }
  }
  function splashAt(x, y, s, n) { for (let i = 0; i < (n || 1); i++) parts.push({ k: 'splash', x: x + rand(-s / 3, s / 3), y: y + rand(-s / 3, s / 3), vx: 0, vy: SCROLL, life: rand(0.7, 1.1) + i * 0.12, max: 1.2 + i * 0.12, s: s * rand(0.7, 1.1), rot: rand(TAU), alt: 0 }); }

  // ---------------------------------------------------------------- player weapons
  function shot(x, y, a, sp, dmg, kind, life, owner) {
    pb.push({ id: gid++, x, y, vx: Math.sin(a) * sp, vy: -Math.cos(a) * sp, dmg, kind, life: life || 1.4, pierce: kind === 'laser', hits: kind === 'laser' ? [] : null, owner: owner || 0, born: time, alt: player ? altOf(player) : ALT.MID });
  }
  function fireGuns(p) {
    const g = run.gun, L = g.lvl, dm = ST.gunDmg, fr = ST.fireRate;
    if (g.type === 'normal') {
      const n = 1 + L + (ST.quad ? 1 : 0);
      for (let i = 0; i < n; i++) shot(p.x + (i - (n - 1) / 2) * 4.2, p.y - 12, 0, 430, 1 * dm, 'b');
      p.fireCd = 0.11 / fr; A.sfx('shot');
    } else if (g.type === 'spread') {
      const n = 3 + 2 * (L - 1);
      shot(p.x - 2.5, p.y - 12, 0, 430, dm, 'b'); shot(p.x + 2.5, p.y - 12, 0, 430, dm, 'b');
      for (let i = 1; i <= (n - 1) / 2; i++) { shot(p.x - 3 - i * 2, p.y - 9, -0.17 * i, 420, dm, 'b'); shot(p.x + 3 + i * 2, p.y - 9, 0.17 * i, 420, dm, 'b'); }
      p.fireCd = 0.12 / fr; A.sfx('shot');
    } else if (g.type === 'laser') {
      const dmg = (1.15 + 0.35 * (L - 1)) * dm;
      if (L >= 3) { shot(p.x - 5, p.y - 16, 0, 600, dmg, 'laser'); shot(p.x + 5, p.y - 16, 0, 600, dmg, 'laser'); } else shot(p.x, p.y - 18, 0, 600, dmg, 'laser');
      p.fireCd = 0.06 / fr; A.sfx('laser');
    } else if (g.type === 'shotgun') {
      const n = 7 + 2 * (L - 1);
      for (let i = 0; i < n; i++) { const c = i - (n - 1) / 2; shot(p.x + c * 2, p.y - 10, c * 0.15 + rand(-0.03, 0.03), rand(330, 400), 1.5 * dm, 'pellet', 0.34 + 0.04 * (L - 1)); }
      p.fireCd = 0.26 / fr; A.sfx('shotgun');
    } else if (g.type === 'auto') {
      p.side = -p.side || 1;
      shot(p.x + p.side * 4, p.y - 12, rand(-0.02, 0.02), 470, 0.9 * dm, 'b'); shot(p.x - p.side * 2, p.y - 13, 0, 470, 0.9 * dm, 'b');
      if (L >= 3) shot(p.x, p.y - 14, 0, 480, 0.9 * dm, 'b');
      p.fireCd = (0.065 - 0.009 * (L - 1)) / fr; A.sfx('auto');
    }
    p.flash = 0.05;
  }
  function bombSpec(type, L) {
    const br = ST.bombRadius;
    switch (type) {
      case 'cluster': return { R: 12 * br, dmg: 6 + 2 * (L - 1), cd: 0.75, n: 4 + 2 * L };
      case 'napalm': return { R: 14 * br, dmg: 6, cd: 0.9, zw: (18 + 4 * L) * br, zh: (50 + 15 * L) * br, zt: 2.5 + 0.5 * L, dps: 10 + 3 * (L - 1) };
      case 'torpedo': return { R: 9, dmg: 28 + 8 * (L - 1), cd: 1.0, n: L };
      case 'rapid': return { R: 13 * br, dmg: 6 + 2 * (L - 1), cd: 0.28 - 0.04 * (L - 1) };
      case 'nuke': return { R: NUKE.radius * ST.nukeYield, dmg: NUKE.dmg, cd: NUKE.cd * (1 - NUKE.lvlCut * (L - 1)) * ST.nukeReload };
      default: return { R: (18 + 3 * (L - 1)) * br, dmg: 10 + 4 * (L - 1), cd: 0.6 };
    }
  }
  // The nuke carries its own reload stat, so the generic bomb-reload tech does not stack on top:
  // both at once brought a 30-second weapon back in 15. One source of truth, because the HUD bar
  // and the actual cooldown must never disagree.
  function bombCooldown(type, L) { return bombSpec(type, L).cd * (type === 'nuke' ? 1 : ST.bombReload); }
  function dropBomb(x, y, type, L, owner, dmgMul) {
    const sp = bombSpec(type, L);
    if (type === 'torpedo') {
      for (let i = 0; i < sp.n; i++) { const c = i - (sp.n - 1) / 2; pb.push({ id: gid++, x: x + c * 8, y: y - 6, vx: c * 6, vy: -150, kind: 'torp', alt: ALT.SEA, dmg: sp.dmg * (dmgMul || 1), life: 3, armT: 0.25, owner: owner || 0, hits: null }); }
      return sp.cd;
    }
    const fall = BOMB_FALL;
    pb.push({ id: gid++, x, y: y - 10, vx: 0, vy: -170, kind: 'bomb', btype: type, lvl: L, dmg: sp.dmg * (dmgMul || 1), life: fall, max: fall, done: false, owner: owner || 0, hits: null, alt: ALT.MID });
    return sp.cd;
  }
  function fireBombs(p) {
    const b = run.bomb;
    dropBomb(p.x, p.y, b.type, b.lvl, 0); p.bombCd = bombCooldown(b.type, b.lvl);
    A.sfx(b.type === 'nuke' ? 'drop' : 'bombdrop'); p.bombFlash = 0.12;
  }
  function hurt(amount, src) {
    const p = player;
    if (!p || p.dead || p.loopT > 0 || p.inv > 0) return false;
    const a = amount * ST.dmgTaken;
    const before = p.armor / ST.armorMax;
    p.armor -= a; p.inv = 1.0; p.hitT = 0.25; shake = Math.max(shake, 4); stageHits++;
    A.sfx('hurt'); sparksAt(p.x, p.y, 10, '#fff');
    popup(p.x, p.y - 16, '-' + Math.round(a), '#ff6a6a', 7);
    const after = p.armor / ST.armorMax;
    if (before >= 0.45 && after < 0.45) { radio('damage'); A.sfx('sputter'); }
    if (before >= 0.2 && after < 0.2) radio('critical');
    if (p.armor <= 0) killPlayer();
    return true;
  }
  function killPlayer() {
    const p = player; if (p.dead) return;
    p.armor = Math.max(0, p.armor); p.dead = true; p.deadT = 0;
    explosion(p.x, p.y, 34); explosion(p.x - 8, p.y + 4, 20, 0.15); explosion(p.x + 9, p.y - 5, 22, 0.3);
    shake = 10; A.sfx('bigboom'); A.music(null);
  }
  function damageStage(frac) { return frac < 0.2 ? 3 : frac < 0.45 ? 2 : frac < 0.7 ? 1 : 0; }
  function updatePlayer(dt) {
    const p = player, inp = G.input;
    if (p.dead) { p.deadT += dt; inp.dx = inp.dy = 0; inp.loop = false; if (p.deadT > 2.6) gameOver(); return; }
    const ox = p.x;
    const af = p.armor / ST.armorMax, ds = damageStage(af);
    p.dmg = ds;
    let wob = 0;
    if (ds >= 3 && !ST.fireSuppress) wob = Math.sin(time * 7.3) * 9 * dt + Math.sin(time * 3.1) * 5 * dt;
    const sp = ST.speed;
    p.x += inp.ax * sp * dt + inp.dx + wob; p.y += inp.ay * sp * dt + inp.dy; inp.dx = inp.dy = 0;
    p.x = clamp(p.x, 12, W - 12); p.y = clamp(p.y, HUD_H + 18, H - 16);
    const mv = (p.x - ox) / Math.max(dt, 1e-3);
    p.bank += (clamp(mv / 140, -1, 1) - p.bank) * Math.min(1, dt * 9);
    if (p.inv > 0) p.inv -= dt;
    if (p.flash > 0) p.flash -= dt;
    if (p.hitT > 0) p.hitT -= dt;
    if (p.bombFlash > 0) p.bombFlash -= dt;
    if (p.loopCd > 0) p.loopCd -= dt;
    if (p.loopT > 0) { p.loopT -= dt; if (p.loopT <= 0) { p.loopT = 0; p.inv = Math.max(p.inv, 0.25); p.loopCd = ST.loopCd; } }
    if (inp.loop) {
      inp.loop = false;
      // the loop is free; the only thing between you and the next one is the recovery
      if (p.loopT <= 0 && p.loopCd <= 0) { p.loopT = LOOP_TIME; A.sfx('loop'); popup(p.x, p.y + 20, 'LOOP', '#9fd8ff', 8); }
    }
    // The mode button does the obvious thing with the bomb still reloading: it reloads it. Tapping
    // a dead bomb and being handed the machine guns instead was the wrong answer to the only
    // question you are asking at that moment. Once the rack is full the button goes back to being
    // the weapon switch.
    if (inp.mode) {
      inp.mode = false;
      if (p.mode === 'bombs' && p.bombCd > 0) {
        p.bombCd = 0; A.sfx('repair'); popup(p.x, p.y + 22, 'RELOADED', '#ffb04a', 9);
      } else {
        p.mode = p.mode === 'guns' ? 'bombs' : 'guns'; A.sfx('mode');
        popup(p.x, p.y + 22, p.mode === 'guns' ? 'GUNS' : 'BOMBS', p.mode === 'guns' ? '#ffe066' : '#ffb04a', 9);
      }
    }
    // armor: optional self-repair; an engine fire slowly eats armor (never below 1) unless suppressed
    if (ST.regen > 0 && af < 0.6) p.armor = Math.min(ST.armorMax * 0.6, p.armor + ST.regen * dt);
    if (ds >= 3 && !ST.fireSuppress) p.armor = Math.max(1, p.armor - 0.35 * dt);
    p.fireCd -= dt; p.bombCd -= dt;
    const want = inp.fire || inp.touching;
    if (p.loopT <= 0) {
      if (p.mode === 'guns') { if ((want || run.gun.type === 'auto') && p.fireCd <= 0) fireGuns(p); }
      else if (want && p.bombCd <= 0) fireBombs(p);
    }
    // trailing smoke / fire from a damaged engine
    if (ds >= 2 && Math.random() < dt * (ds >= 3 ? 26 : 12)) {
      const ex = p.x + (p.engSide || (p.engSide = Math.random() < 0.5 ? -8.4 : 8.4)), ey = p.y - 4;
      parts.push({ k: ds >= 3 ? 'blacksmoke' : 'smoke', x: ex, y: ey + 4, vx: rand(-3, 3), vy: rand(30, 45), life: 0.9, max: 0.9, s: ds >= 3 ? 6 : 4, alt: 40, va: 0 });
      if (ds >= 3 && Math.random() < 0.6) parts.push({ k: 'flame', x: ex, y: ey + 2, vx: 0, vy: 40, life: 0.25, max: 0.25, s: 3.2, alt: 41, va: 0 });
    }
  }
  const LOOP_TIME = 1.15;

  // ---------------------------------------------------------------- wingmen
  function updateWing(dt) {
    const p = player;
    for (const w of wing) {
      if (w.dead) { w.deadT += dt; w.y += 30 * dt; w.x += w.bank * 20 * dt; if (Math.random() < dt * 20) parts.push({ k: 'blacksmoke', x: w.x, y: w.y, vx: 0, vy: 20, life: 1, max: 1, s: 5, alt: 40 - w.deadT * 14, va: 0 }); continue; }
      if (w.inv > 0) w.inv -= dt; if (w.flash > 0) w.flash -= dt;
      const tx = clamp((p.dead ? W / 2 : p.x) + w.ox + Math.sin(time * 0.9 + w.slot * 2) * 4, 12, W - 12), ty = clamp((p.dead ? H - 70 : p.y) + w.oy + Math.cos(time * 1.1 + w.slot) * 3, HUD_H + 20, H - 12);
      const ox = w.x;
      w.x += (tx - w.x) * Math.min(1, dt * 3.2); w.y += (ty - w.y) * Math.min(1, dt * 3.2);
      w.bank += (clamp((w.x - ox) / Math.max(dt, 1e-3) / 120, -1, 1) - w.bank) * Math.min(1, dt * 8);
      w.dmg = damageStage(w.armor / w.max);
      if (w.dmg >= 2 && Math.random() < dt * 10) parts.push({ k: w.dmg >= 3 ? 'blacksmoke' : 'smoke', x: w.x + 4, y: w.y + 4, vx: 0, vy: 35, life: 0.8, max: 0.8, s: 3.5, alt: 40, va: 0 });
      if (state !== 'play' || p.dead || phase === 'clear' || phase === 'briefing') continue;
      w.fireCd -= dt; w.bombCd -= dt;
      const firing = G.input.fire || G.input.touching || run.gun.type === 'auto';
      if (p.mode === 'guns' && firing && w.fireCd <= 0) { shot(w.x - 2, w.y - 9, 0, 420, 0.6 * ST.wingDmg, 'b', 1.4, 1); shot(w.x + 2, w.y - 9, 0, 420, 0.6 * ST.wingDmg, 'b', 1.4, 1); w.fireCd = 0.2; }
      if (p.mode === 'bombs' && firing && w.bombCd <= 0) { dropBomb(w.x, w.y, 'std', 1, 1, 0.6 * ST.wingDmg); w.bombCd = 1.5; }
    }
    sweep(wing, (w) => w.dead && w.deadT > 2.5);
  }
  function hurtWing(w, amount) {
    if (w.dead || w.inv > 0) return false;
    w.armor -= amount; w.inv = 0.6; w.flash = 0.08; sparksAt(w.x, w.y, 5, '#fff');
    if (w.armor <= 0) {
      w.dead = true; w.deadT = 0; run.wing[w.slot] = false;
      explosion(w.x, w.y, 18); A.sfx('boom'); A.sfx('radio');
      popup(w.x, w.y - 14, 'WINGMAN DOWN', '#ff8a7a', 7);
      radio('winglost', w.name);
    }
    return true;
  }
