
  // ---------------------------------------------------------------- enemies
  function pathPos(o, t, out) {
    let x, y;
    switch (o.pat) {
      case 'dive': x = o.x0 + Math.sin(t * 2.2) * 12 * o.dir; y = -16 + 118 * t; break;
      case 'vee': x = o.x0; y = -16 + 108 * t; break;
      case 'swoop': { const ym = H * 0.58; x = o.x0 + o.dir * 75 * (1 - Math.cos(t * 0.95)); y = -16 + (ym + 16) * Math.sin(t * 0.95); break; }
      case 'side': x = o.dir > 0 ? -16 + 118 * t : W + 16 - 118 * t; y = o.y0 + Math.sin(t * 3) * 22 + 14 * t; break;
      case 'loop': {
        const v = 135, yc = H * 0.34, R = 32, t1 = (yc + 16) / v, w = 3.4, t2 = t1 + TAU / w;
        if (t < t1) { x = o.x0; y = -16 + v * t; }
        else if (t < t2) { const th = (t - t1) * w, cx = o.x0 + o.dir * R; x = cx - o.dir * R * Math.cos(th); y = yc + R * Math.sin(th); }
        else { x = o.x0; y = yc + v * (t - t2); }
        break;
      }
      case 'arc': x = o.dir > 0 ? -16 + 95 * t : W + 16 - 95 * t; y = -16 + 170 * t - 28 * t * t; break;
      case 'rear': x = o.x0 + o.dir * 12 * t; y = H + 16 - 165 * t; break;
      case 'escort': x = o.x0 + o.dir * 45 * Math.sin(t * 1.6); y = o.y0 + 125 * t; break;
      case 'hold': x = o.x0; y = o.y0; break;
      case 'bomber': x = o.x0 + o.dir * 9 * t + Math.sin(t * 0.9) * 8; y = -22 + 40 * t; break;
      case 'launch': x = o.x0 + o.dir * 30 * t * t; y = o.y0 + 70 * t + 30 * t * t; break;
      default: x = o.x0; y = -16 + 100 * t;
    }
    out[0] = x; out[1] = y; return out;
  }
  const P0 = [0, 0], P1 = [0, 0];
  let ebAlt = ALT.MID;   // the height the current shooter fires from, so its tracers are drawn there
  function aimedShot(x, y, spread, n, speed, kind) {
    const p = player; if (!p || p.dead) return;
    const base = Math.atan2(p.y - y, p.x - x), sp = speed || bspeed();
    for (let i = 0; i < n; i++) { const a = base + (i - (n - 1) / 2) * spread; eb.push({ x, y, alt: ebAlt, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, k: kind || 0 }); }
  }
  function ring(x, y, n, speed, off) {
    for (let i = 0; i < n; i++) { const a = off + i / n * TAU; eb.push({ x, y, alt: ebAlt, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, k: 0 }); }
  }
  function warnAt(x, y, r, delay, dmg) { warns.push({ id: gid++, x, y, r, t: 0, dur: delay, dmg }); A.sfx('whistle'); }
  function updateEnemies(dt) {
    const p = player;
    for (const e of enemies) {
      if (e.dead) continue;
      e.t += dt; if (e.flash > 0) e.flash -= dt; if (e.muzzle > 0) e.muzzle -= dt;
      if (e.t < 0) continue;
      if (e.kami) { // kamikaze: lock on and dive at the player
        if (e.x === -100) { e.x = e.o.x0; e.y = -16; }
        const a = Math.atan2(p.y - e.y, p.x - e.x); e.va = e.va === undefined ? Math.PI / 2 : e.va;
        let da = ((a - e.va + Math.PI * 3) % TAU) - Math.PI; e.va += clamp(da, -1.6 * dt, 1.6 * dt);
        const sp = 120 + e.t * 30; e.x += Math.cos(e.va) * sp * dt; e.y += Math.sin(e.va) * sp * dt; e.ang = e.va + Math.PI / 2;
        e.bank = clamp(da * 2, -1, 1);
      } else {
        pathPos(e.o, e.t, P0); pathPos(e.o, e.t + 0.02, P1);
        const na = Math.atan2(P1[1] - P0[1], P1[0] - P0[0]) + Math.PI / 2;
        let da = ((na - e.ang + Math.PI * 3) % TAU) - Math.PI;
        e.bank += (clamp(da / dt * 0.25, -1, 1) - e.bank) * Math.min(1, dt * 6);
        e.x = P0[0]; e.y = P0[1]; e.ang = na;
      }
      if (e.t > 0.6 && (e.x < -40 || e.x > W + 40 || e.y < -50 || e.y > H + 50)) {
        e.dead = true; e.escaped = true; const g = groups.get(e.group); if (g) g.gone++; continue;
      }
      if (e.hp < e.maxhp * 0.5 && Math.random() < dt * 8) parts.push({ k: 'smoke', x: e.x, y: e.y, vx: 0, vy: -10, life: 0.8, max: 0.8, s: e.type === 'bomber' ? 7 : 4, alt: 40, va: 0 });
      if (e.canFire && !p.dead && e.y > HUD_H + 4 && e.y < Math.min(p.y - 40, H * 0.72) && e.x > 4 && e.x < W - 4 && phase !== 'clear' && phase !== 'briefing') {
        e.fireCd -= dt;
        if (e.fireCd <= 0) {
          e.muzzle = 0.06;
          ebAlt = altOf(e);
          if (e.type === 'bomber') { aimedShot(e.x, e.y + 10, 0.28, 3); e.fireCd = rand(2, 2.8) / firem(); }
          else { aimedShot(e.x, e.y + 6, 0, 1); e.fireCd = rand(1.8, 3.4) / firem(); }
        }
      }
    }
  }
  function damageEnemy(e, dmg) {
    e.hp -= dmg; e.flash = 0.06;
    if (e.hp <= 0 && !e.dead) killEnemy(e);
  }
  function killEnemy(e, noScore) {
    e.dead = true;
    // A kill should land. One sprite and a soft thud read as the aircraft simply stopping
    // existing: this is a flash, a secondary a frame later, burning wreckage thrown out, a
    // smoke puff left hanging, and a kick on the camera.
    const big = e.type === 'bomber' || e.type === 'heavy';
    const sz = big ? 30 : 18, ea = altOf(e);
    explosion(e.x, e.y, sz, 0, 0, ea);
    explosion(e.x + rand(-6, 6), e.y + rand(-6, 6), sz * 0.55, 0.08, 0, ea);
    if (big) explosion(e.x + rand(-9, 9), e.y + rand(-9, 9), sz * 0.45, 0.2, 0, ea);
    for (let i = 0; i < (big ? 11 : 7); i++) {
      const a = rand(TAU), sp = rand(45, 115);
      parts.push({ k: 'debris', x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.7, 1.4), max: 1.4, s: rand(1.2, 2.8), alt: ea, va: rand(-45, 8), rot: rand(TAU), spin: rand(-15, 15) });
    }
    for (let i = 0; i < (big ? 9 : 6); i++) {
      const a = rand(TAU), sp = rand(22, 65);
      parts.push({ k: 'flame', x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.18, 0.42), max: 0.42, s: rand(4, 9), alt: ea, va: rand(0, 12) });
    }
    parts.push({ k: 'blacksmoke', x: e.x, y: e.y, vx: rand(-3, 3), vy: -6, life: 1.4, max: 1.4, s: big ? 17 : 11, alt: ea, va: 9 });
    shake = Math.max(shake, big ? 4.5 : 2.2);
    A.sfx(big ? 'bigplaneboom' : 'planeboom');
    if (!noScore) { addScore(e.score, e.x, e.y); merit(e.merit || 5); }
    const g = groups.get(e.group);
    if (g) {
      g.killed++;
      if (g.red && g.killed === g.total) { dropPow(e.x, e.y); popup(e.x, e.y - 12, 'BONUS', '#ffd34a', 7); addScore(1000, undefined, undefined, false); merit(15); }
    }
    if (e.type === 'bomber') maybeDrop(e.x, e.y, 0.8);
    else if (!g || !g.red) maybeDrop(e.x, e.y, 0.045);
  }

  // ---------------------------------------------------------------- hulks (ships, PT boats, bosses)
  function turretPos(h, t, out) {
    // parts follow the hull's list (roll) slightly for the visuals; logic uses the flat offsets
    out[0] = h.x + t.ox; out[1] = h.y + t.oy; return out;
  }
  const TP = [0, 0];
  function hullFrac(h) { return h.hp / h.maxhp; }
  function setBossPhase(h) {
    const f = hullFrac(h), ph = f > 0.66 ? 1 : f > 0.33 ? 2 : 3;
    if (ph > h.bphase) {
      h.bphase = ph; h.atkT = 1.5; h.atk2T = 2.5; h.atk3T = 1;
      for (const t of h.turrets) if (t.kind === 'bridge') t.armored = false;
      // The phase change announces itself four ways already - the popup, the shake, the warning
      // horn and the P-number on the boss bar. A voice line on top of that told you nothing you
      // could not see, and it arrived over the corner you were reading the pattern in.
      popup(h.x, Math.max(HUD_H + 30, h.y), 'PHASE ' + ph, '#ff9c8a', 10); shake = Math.max(shake, 6); A.sfx('warning');
      for (let i = 0; i < 4; i++) explosion(h.x + rand(-h.w * 0.35, h.w * 0.35), h.y + rand(-h.h * 0.4, h.h * 0.4), rand(14, 22), i * 0.12, h.kind === 'ship' ? 0 : 0, h.kind === 'ship' ? 4 : 40);
    }
  }
  function updateHulks(dt) {
    const p = player;
    for (const h of hulks) {
      h.t += dt; if (h.flash > 0) h.flash -= dt;
      const dmgF = 1 - hullFrac(h);
      if (h.dead) {
        h.deadT += dt;
        if (!(h.isBoss && h.kind === 'ship')) h.y += (h.kind === 'ship' ? SCROLL : SCROLL * 1.6) * dt;
        h.list += (h.kind === 'ship' ? 0.12 : 0.5) * dt;
        if (Math.random() < dt * 14) parts.push({ k: 'blacksmoke', x: h.x + rand(-h.w / 3, h.w / 3), y: h.y + rand(-h.h / 3, h.h / 3), vx: rand(-4, 4), vy: SCROLL - rand(8, 16), life: 1.6, max: 1.6, s: rand(10, 18), alt: h.kind === 'ship' ? 4 : 30, va: 10 });
        // she burns all the way down, with the fire dying back as the deck goes under
        const burn = Math.max(0, 1 - h.deadT / 3.2);
        if (burn > 0 && Math.random() < dt * 22 * burn) parts.push({ k: 'flame', x: h.x + rand(-h.w / 2.6, h.w / 2.6), y: h.y + rand(-h.h / 2.4, h.h / 2.4), vx: rand(-4, 4), vy: SCROLL - rand(2, 10), life: rand(0.3, 0.6), max: 0.6, s: rand(5, 10) * (h.isBoss ? 1.5 : 1), alt: (h.kind === 'ship' ? 5 : 32) + rand(0, 4), va: rand(6, 18) });
        if (burn > 0.45 && Math.random() < dt * 2.2) explosion(h.x + rand(-h.w / 2.5, h.w / 2.5), h.y + rand(-h.h / 2.5, h.h / 2.5), rand(10, 18), 0, SCROLL, h.kind === 'ship' ? 5 : 32);
        if (h.kind === 'ship' && Math.random() < dt * 6) splashAt(h.x + rand(-h.w / 2, h.w / 2), h.y + rand(-h.h / 2, h.h / 2), h.w * 0.5);
        continue;
      }
      // progressive damage: listing, smoke, fires
      if (h.kind === 'ship') h.list += ((dmgF > 0.3 ? dmgF * 0.09 : 0) - h.list) * Math.min(1, dt);
      if (dmgF > 0.35 && Math.random() < dt * (dmgF * 14)) parts.push({ k: dmgF > 0.65 ? 'blacksmoke' : 'smoke', x: h.x + rand(-h.w / 3, h.w / 3), y: h.y + rand(-h.h / 3, h.h / 3), vx: rand(-3, 3), vy: (h.kind === 'ship' ? h.vy : 0) - 10, life: 1.3, max: 1.3, s: rand(6, 12) * (h.isBoss ? 1.5 : 1), alt: h.kind === 'ship' ? 6 : 38, va: 12 });
      if (dmgF > 0.6 && Math.random() < dt * 10) parts.push({ k: 'flame', x: h.x + rand(-h.w / 3, h.w / 3), y: h.y + rand(-h.h / 3, h.h / 3), vx: 0, vy: h.kind === 'ship' ? h.vy : 0, life: 0.4, max: 0.4, s: rand(4, 7), alt: h.kind === 'ship' ? 5 : 40, va: 6 });
      if (h.isBoss) {
        setBossPhase(h);
        if (h.kind === 'ship') {
          const holdY = HUD_H + h.h * 0.42;
          if (!h.arrived) { h.y += h.vy * dt; if (h.y >= holdY) { h.y = holdY; h.arrived = true; h.t0 = h.t; } }
          else { h.x = W / 2 + Math.sin((h.t - h.t0) * 0.35) * (h.type === 'carrier' ? 26 : 34); }
        } else {
          const holdY = HUD_H + 64;
          let eng = 0; for (const t of h.turrets) if (t.kind === 'engine' && !t.dead) eng++;
          h.speedF = 0.45 + 0.55 * eng / 4;
          if (!h.arrived) { h.y += h.vy * dt; if (h.y >= holdY) { h.arrived = true; h.t0 = h.t; h.tt = 0; } }
          else { h.tt += dt * h.speedF; h.x = W / 2 + Math.sin(h.tt * 0.55) * 58; h.y = holdY + Math.sin(h.tt * 0.8) * 14 + (h.bphase === 3 ? Math.sin(h.t * 2.3) * 6 : 0); }
          h.spin = Math.cos(h.tt * 0.55) * 0.35;
        }
      } else {
        h.y += h.vy * dt; h.x += h.vx * dt;
        if (h.pt && p && !p.dead) h.vx += (clamp(p.x - h.x, -1, 1) * 30 - h.vx) * Math.min(1, dt);
        if (h.y - h.h / 2 > H + 10) { h.gone = true; h.dead = true; h.deadT = 99; continue; }
        // The spawner picked a lane with water in it, but a map scrolls and a long approach can
        // still end at a headland. While a ship is still above the field nobody has seen it yet,
        // so one that is about to arrive aground simply never arrives.
        if (h.kind === 'ship' && !h.isBoss && h.y + h.h / 2 < HUD_H && overLand(h.x, h.y)) { h.gone = true; h.dead = true; h.deadT = 99; continue; }
      }
      // wake
      if (h.kind === 'ship') {
        h.wakeT -= dt;
        if (h.wakeT <= 0) {
          h.wakeT = h.isBoss ? 0.035 : 0.06;
          const sp = h.isBoss && h.arrived ? 1.6 : h.pt ? 2 : 1;
          for (const s of [-1, 1]) {
            parts.push({ k: 'foam', x: h.x + s * h.w * 0.32, y: h.y - h.h * 0.44, vx: s * 16 * sp, vy: SCROLL, life: 1.3, max: 1.3, s: rand(2.5, 4), alt: 0 });
            parts.push({ k: 'foam', x: h.x + s * h.w * 0.5, y: h.y - h.h * 0.2 + rand(0, h.h * 0.6), vx: s * 7 * sp, vy: SCROLL, life: 1.2, max: 1.2, s: rand(2, 3.5), alt: 0 });
          }
          parts.push({ k: 'foam', x: h.x + rand(-h.w * 0.3, h.w * 0.3), y: h.y + h.h * 0.5, vx: rand(-4, 4), vy: SCROLL + 4 * sp, life: 2.4, max: 2.4, s: rand(3.5, 6) * (h.isBoss ? 1.6 : 1), alt: 0 });
        }
      }
      const onScreen = h.y + h.h / 2 > HUD_H && h.y - h.h / 2 < H;
      const canAct = !p.dead && onScreen && phase !== 'clear' && phase !== 'briefing' && (!h.isBoss || h.arrived || h.type === 'bossBomber');
      let alive = 0, key = 0;
      for (const t of h.turrets) {
        if (t.flash > 0) t.flash -= dt;
        if (t.muzzle > 0) t.muzzle -= dt;
        if (t.dead) {
          if (Math.random() < dt * (t.kind === 'engine' ? 18 : 4)) { turretPos(h, t, TP); parts.push({ k: t.kind === 'engine' ? 'blacksmoke' : 'smoke', x: TP[0], y: TP[1], vx: rand(-3, 3), vy: (h.kind === 'ship' ? (h.isBoss && h.arrived ? 0 : h.vy) : 30) - 10, life: 1.2, max: 1.2, s: rand(6, 11), alt: h.kind === 'ship' ? 6 : 40, va: 6 }); }
          continue;
        }
        alive++;
        if (t.kind === 'main' || t.kind === 'engine' || t.kind === 'elevator') key++;
        turretPos(h, t, TP); const tx = TP[0], ty = TP[1];
        if (t.kind === 'bridge' || t.kind === 'engine') continue;
        if (t.kind === 'elevator') {
          t.cd -= dt;
          if (canAct && t.cd <= 0 && ty > HUD_H) { // launch fighters off the deck
            t.cd = (h.bphase === 3 ? 4 : 6) / firem();
            const g = newGroup(2, false); t.lift = 1;
            for (const s of [-1, 1]) { const e = spawnZero({ pat: 'launch', dir: s, x0: tx, y0: ty, delay: s > 0 ? 0.35 : 0 }, false, g); e.canFire = true; e.launched = true; }
          }
          continue;
        }
        const target = Math.atan2(p.y - ty, p.x - tx) + Math.PI / 2;
        let da = ((target - t.ang + Math.PI * 3) % TAU) - Math.PI;
        t.ang += clamp(da, -2.2 * dt, 2.2 * dt);
        if (canAct && ty > HUD_H + 4 && ty < H - 40) {
          t.cd -= dt;
          if (t.cd <= 0 && Math.abs(da) < 0.5) {
            const r = t.big ? 9 : 6, bx = tx + Math.sin(t.ang) * r, by = ty - Math.cos(t.ang) * r;
            t.muzzle = 0.08;
            ebAlt = altOf(h);
            // Half the rounds, on a beat. A turret that fires every 3.0 seconds is a turret you
            // can count; one that fires every 2.6 to 3.4 is weather. The spreads are wider too -
            // a two-round fan at 0.16 radians is a needle aimed at where you were, and the only
            // way past it is to already have moved. Opened up, it is a gap you can fly into.
            if (t.kind === 'main') {
              if (h.isBoss) { warnAt(p.x + rand(-10, 10), p.y + rand(-10, 10), 22, 1.15, 14); aimedShot(bx, by, 0.3, 1); t.cd = 3.0 / firem(); }
              else { aimedShot(bx, by, 0.3, 1); t.cd = 2.6 / firem(); }
            } else if (t.kind === 'tail') { aimedShot(bx, by, 0.22, 2, bspeed() * 1.05); t.cd = 1.8 / firem(); }
            else if (t.kind === 'dorsal') { aimedShot(bx, by, 0.34, 1); t.cd = 2.0 / firem(); }
            else { aimedShot(bx, by, 0, 1); t.cd = 2.2 / firem(); }
          }
        }
      }
      h.turretsAlive = alive; h.keyAlive = key;
      if (h.isBoss && canAct && phase === 'boss') bossAttacks(h, dt);
    }
    sweep(hulks, (h) => h.dead && h.deadT > (h.kind === 'ship' ? 4.5 : 2.6));
  }
  function bossAttacks(h, dt) {
    h.atkT -= dt; h.atk2T -= dt; h.atk3T -= dt; h.atk4T = (h.atk4T || 0) - dt;
    const ph = h.bphase, f = firem();
    if (h.type === 'bossShip') {
      if (ph >= 2 && h.atkT <= 0) { ring(h.x, h.y - 18, 5 + Math.min(4, D()), 72, h.ringOff = (h.ringOff || 0) + 0.4); h.atkT = (ph === 3 ? 2.4 : 4) / f; }
      if (ph >= 2 && h.atk2T <= 0) { for (const s of [-1, 1]) spawnPT(clamp(h.x + s * (h.w * 0.5 + 18), 14, W - 14), h.y - h.h * 0.2); h.atk2T = 7.5; }
      if (h.atk3T <= 0) { aimedShot(h.x, h.y - 30, 0.26, ph === 3 ? 4 : 3, bspeed() * 0.9); h.atk3T = (ph === 3 ? 2.6 : 4.2) / f; }
      // the extra phase-three ring is on the clock as well, not on a dice roll
      if (ph === 3 && h.atk4T <= 0) { ring(h.x, h.y, 4, 60, (h.ringOff || 0) + 0.8); h.atk4T = 2.0 / f; }
    } else if (h.type === 'bossBomber') {
      if (!h.arrived) return;
      if (h.atkT <= 0) { ring(h.x, h.y, 6 + Math.min(4, D()), 70, h.ringOff = (h.ringOff || 0) + 0.45); h.atkT = (ph === 3 ? 2.6 : 3.4) / f; }
      if (h.atk2T <= 0) {
        if (ph === 1) { const g = newGroup(2, false); for (const s of [-1, 1]) spawnZero({ pat: 'escort', dir: s, x0: clamp(h.x + s * 40, 20, W - 20), y0: h.y + 10, delay: 0 }, false, g); h.atk2T = 7; }
        else if (ph === 2) { // carpet of flak, telegraphed across the screen
          const y = clamp(player.y + rand(-30, 10), HUD_H + 40, H - 30), dir = Math.random() < 0.5 ? -1 : 1;
          for (let i = 0; i < 6; i++) warnAt(dir > 0 ? 25 + i * 44 : W - 25 - i * 44, y + rand(-8, 8), 20, 1.0 + i * 0.16, 12);
          h.atk2T = 6;
        } else { const g = newGroup(3, false); for (let i = 0; i < 3; i++) { const e = spawnZero({ pat: 'dive', dir: 1, x0: rand(30, W - 30), y0: 0, delay: i * 0.4 }, false, g); e.kami = true; e.canFire = false; } h.atk2T = 5.5; }
      }
      // the spiral keeps both arms - the shape is the whole point of it - and halves its rate
      if (ph === 3) { h.spiral = (h.spiral || 0) + dt; if (h.atk3T <= 0) { const a = h.spiral * 2.2; for (const o of [0, Math.PI]) eb.push({ x: h.x, y: h.y + 10, alt: altOf(h), vx: Math.cos(a + o) * 80, vy: Math.sin(a + o) * 80, k: 0 }); h.atk3T = 0.28 / Math.sqrt(f); } }
    } else if (h.type === 'carrier') {
      if (ph >= 2 && h.atkT <= 0) { ring(h.x, h.y, 5 + Math.min(4, D()), 70, h.ringOff = (h.ringOff || 0) + 0.42); h.atkT = (ph === 3 ? 2.4 : 3.8) / f; }
      if (ph >= 2 && h.atk2T <= 0) { waveBombers(clamp(h.x, 60, W - 60)); h.atk2T = 9; }
      if (h.atk3T <= 0) { aimedShot(h.x + h.w * 0.3, h.y, 0.3, ph === 3 ? 3 : 2); h.atk3T = (ph === 3 ? 2.0 : 3.2) / f; }
      if (ph === 3 && h.atk4T <= 0) { const a = h.t * 2.4; for (let i = 0; i < 3; i++) eb.push({ x: h.x, y: h.y, alt: altOf(h), vx: Math.cos(a + i * 2.09) * 75, vy: Math.sin(a + i * 2.09) * 75, k: 0 }); h.atk4T = 1.6 / f; }
    }
  }
  function hitHulk(h, x, y) {
    const dx = Math.abs(x - h.x), dy = y - h.y;
    if (h.kind === 'ship') return dx < Math.max(5, h.w * 0.45) && Math.abs(dy) < h.h * 0.47;
    return (dx < h.w * 0.48 && Math.abs(dy + 10) < 10) || (dx < 8 && Math.abs(dy) < h.h * 0.48) || (dx < 27 && Math.abs(dy - 36) < 7);
  }
  function damageHulk(h, dmg) {
    if (h.isBoss && h.keyAlive > 0 && h.bphase === 1) dmg *= 0.5;
    h.hp -= dmg; h.flash = 0.05;
    if (h.hp <= 0) killHulk(h);
  }
  function damagePart(h, t, dmg) {
    if (t.dead) return;
    if (t.armored) { t.flash = 0.04; sparksAt(h.x + t.ox, h.y + t.oy, 1, '#ccc', h.kind === 'ship' ? 6 : 40); return; }
    t.hp -= dmg; t.flash = 0.06;
    if (t.hp <= 0) killTurret(h, t);
  }
  function killTurret(h, t) {
    t.dead = true;
    turretPos(h, t, TP);
    const sea = h.kind === 'ship';
    explosion(TP[0], TP[1], t.big || t.kind === 'bridge' || t.kind === 'elevator' ? 18 : 11, 0, sea && !h.arrived ? h.vy : 0, sea ? 6 : 40); A.sfx('boom');
    const pts = { bridge: 3000, elevator: 2000, engine: 1500, main: 600, tail: 800 }[t.kind] || 300;
    addScore(pts, TP[0], TP[1]); merit(h.isBoss ? (t.kind === 'aa' || t.kind === 'dorsal' ? 12 : 50) : 10);
    if (h.isBoss && (t.kind === 'bridge' || t.kind === 'engine' || t.kind === 'elevator')) {
      h.hp -= h.maxhp * (t.kind === 'bridge' ? 0.15 : 0.06); shake = Math.max(shake, 5);
      popup(TP[0], TP[1] - 12, t.kind === 'bridge' ? 'BRIDGE DESTROYED' : t.kind === 'engine' ? 'ENGINE OUT' : 'ELEVATOR WRECKED', '#ffd34a', 7);
      if (h.hp <= 0) killHulk(h);
    }
  }
  function killHulk(h) {
    if (h.dead) return;
    h.dead = true; h.deadT = 0; h.hp = 0;
    for (const t of h.turrets) t.dead = true;
    const n = h.isBoss ? 18 : Math.max(3, Math.round(h.h / 14));
    const sea = h.kind === 'ship';
    const vy = sea && !h.isBoss ? SCROLL : 0, alt = sea ? 5 : 40;
    // the magazine goes first: one fireball the size of the hull, a blast ring on the water,
    // then the hull tears itself apart along its length
    explosion(h.x, h.y, Math.min(48, h.h * 0.5) * (h.isBoss ? 1.4 : 1), 0, vy, alt);
    if (sea) {
      fx.push({ id: gid++, x: h.x, y: h.y, t: 0, dur: 0.5 + h.h * 0.004, s: h.h * 0.75, vy: SCROLL, rot: rand(TAU), spin: 0, alt: 1, ground: true });
      for (let i = 0; i < Math.min(9, n); i++) splashAt(h.x + rand(-h.w * 0.6, h.w * 0.6), h.y + rand(-h.h * 0.45, h.h * 0.45), rand(12, 20));
    }
    for (let i = 0; i < n; i++) explosion(h.x + rand(-h.w * 0.4, h.w * 0.4), h.y + rand(-h.h * 0.45, h.h * 0.45), rand(14, 26) * (h.isBoss ? 1.4 : 1), i * (h.isBoss ? 0.13 : 0.09), vy, alt);
    // burning fuel thrown clear of the hull, and pieces of the ship with it
    for (let i = 0; i < Math.min(18, n * 2); i++) {
      const a = rand(TAU), sp = rand(25, 75);
      parts.push({ k: 'flame', x: h.x + rand(-h.w * 0.4, h.w * 0.4), y: h.y + rand(-h.h * 0.4, h.h * 0.4), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6 + vy, life: rand(0.35, 0.8), max: 0.8, s: rand(5, 11), alt: alt + 1, va: rand(4, 16) });
    }
    for (let i = 0; i < Math.min(14, n + 4); i++) {
      const a = rand(TAU), sp = rand(30, 90);
      parts.push({ k: 'debris', x: h.x + rand(-h.w * 0.4, h.w * 0.4), y: h.y + rand(-h.h * 0.4, h.h * 0.4), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + vy, life: rand(0.9, 1.6), max: 1.6, s: rand(1.4, 3.2), alt: alt + rand(4, 22), va: rand(-10, 40), rot: rand(TAU), spin: rand(-12, 12) });
    }
    if (h.isBoss) { flashT = Math.max(flashT, 0.3); for (let i = 0; i < 4; i++) nukes.push({ x: h.x + rand(-h.w / 3, h.w / 3), y: h.y + rand(-h.h / 3, h.h / 3), t: -i * 0.45, R: 40, rot: rand(TAU), small: true, alt: sea ? 0 : 30 }); }
    shake = Math.max(shake, h.isBoss ? 14 : 5);
    A.sfx(h.isBoss || h.type === 'battleship' ? 'bigboom' : 'boom');
    addScore(h.score, h.x, h.y); merit(h.merit || 20);
    if (h.drop) maybeDrop(h.x, h.y, h.drop);
    if (h.isBoss) bossDefeated(h);
  }
  function bossDefeated(h) {
    boss = null; phase = 'clear'; phaseT = 0; clearJingle = false;
    eb.length = 0; warns.length = 0;
    for (const e of enemies) if (!e.dead && e.t >= 0) killEnemy(e);
    for (const x of hulks) if (!x.dead && x.pt) killHulk(x);
    clearBonus = Math.round(player.armor) * 100;      // what you brought home, at the old rate
    addScore(clearBonus);
    merit(150); if (stageHits === 0) { merit(200); popup(W / 2, H * 0.5, 'NO-DAMAGE BONUS +200 MERIT', '#9fe07a', 7); }
    A.music(null); A.sting('clear');
    radio('clear');
  }
