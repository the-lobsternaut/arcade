
  // ---------------------------------------------------------------- spawning
  function newGroup(n, red) { const id = gid++; groups.set(id, { total: n, killed: 0, gone: 0, red }); return id; }
  function waveFighters(red) {
    const d = D();
    const pats = ['dive', 'swoop', 'vee', 'side', 'loop', 'arc', 'swoop'];
    if (d >= 1) pats.push('rear', 'vee');
    const pat = red ? pick(['swoop', 'side', 'loop', 'arc', 'vee']) : pick(pats);
    const n = red ? 5 : clamp(3 + ((Math.random() * 3) | 0) + Math.min(2, (d / 2) | 0), 3, 7);
    let dir = Math.random() < 0.5 ? -1 : 1;
    let x0 = rand(50, W - 50);
    if (pat === 'swoop') x0 = dir > 0 ? rand(20, 90) : rand(W - 90, W - 20);
    if (pat === 'loop') dir = x0 < W / 2 ? 1 : -1;
    const y0 = rand(HUD_H + 30, H * 0.36);
    const g = newGroup(n, red);
    for (let i = 0; i < n; i++) {
      const o = { pat, dir, x0, y0, delay: i * 0.3 };
      const c = i - (n - 1) / 2;
      if (pat === 'vee') { o.x0 = clamp(W / 2 + (x0 - W / 2) * 0.4 + c * 19, 14, W - 14); o.delay = Math.abs(c) * 0.22; }
      else if (pat === 'dive') { o.x0 = clamp(x0 + c * 22, 14, W - 14); o.delay = i * 0.12; }
      else if (pat === 'rear') { o.x0 = clamp(x0 + c * 18, 14, W - 14); o.delay = i * 0.2; }
      spawnZero(o, red, g);
    }
  }
  function spawnZero(o, red, g) {
    const e = {
      id: gid++, type: 'zero', spr: red ? 'zeroRed' : 'zero', o, t: -o.delay, x: -100, y: -100, ang: Math.PI, hp: (red ? 1.5 : 1) * hpm(), maxhp: (red ? 1.5 : 1) * hpm(), r: 9,
      score: red ? 200 : 100, merit: red ? 8 : 5, group: g, flash: 0, dead: false, fireCd: rand(0.8, 2.6) / firem(), bank: 0, alt: bandFor('zero'),
      canFire: o.pat !== 'rear' && Math.random() < 0.42 + 0.08 * D(),
    };
    enemies.push(e); return e;
  }
  function waveBombers(px) {
    const n = D() >= 2 ? 2 + (Math.random() < 0.4 ? 1 : 0) : (Math.random() < 0.5 ? 1 : 2);
    const g = newGroup(n, false);
    for (let i = 0; i < n; i++) {
      const o = { pat: 'bomber', dir: Math.random() < 0.5 ? -1 : 1, x0: px !== undefined ? clamp(px + (i - (n - 1) / 2) * 50, 30, W - 30) : n === 1 ? rand(60, W - 60) : 40 + (W - 80) * (i / (n - 1)), delay: i * 0.6 };
      enemies.push({ alt: bandFor('bomber'), id: gid++, type: 'bomber', spr: 'bomber', o, t: -o.delay, x: -100, y: -100, ang: Math.PI, hp: 13 * hpm(), maxhp: 13 * hpm(), r: 19, score: 500, merit: 20, group: g, flash: 0, dead: false, fireCd: rand(1, 2), canFire: true, bank: 0 });
    }
  }
  const MS = (k, fb) => (META[k] ? { w: META[k].w, h: META[k].h, turrets: META[k].turrets || fb.turrets } : fb);
  const SHIPS = {
    destroyer: Object.assign(MS('destroyer', { w: 13, h: 92, turrets: [[0, -31, 0], [0, 33, 0]] }), { hp: 18, speed: 7, score: 1200, merit: 40, drop: 0.9 }),
    battleship: Object.assign(MS('battleship', { w: 30, h: 150, turrets: [[0, -50, 1], [0, -38, 1], [0, 24, 1]] }), { hp: 48, speed: 5, score: 4000, merit: 80, drop: 1 }),
    ptboat: { w: 6.5, h: 42, hp: 5, speed: -26, score: 400, merit: 12, drop: 0.25, turrets: [[0, -8, 0]] },
    bossShip: Object.assign(MS('bossShip', { w: 68, h: 262, turrets: [[-10, -84, 1], [10, -84, 1], [-15, 45, 1], [15, 45, 1]] }), { hp: 260, speed: 0, score: 20000, merit: 400, drop: 0 }),
    bossBomber: { w: META.heavy ? META.heavy.w : 150, h: META.heavy ? META.heavy.h : 106, hp: 240, speed: 0, score: 25000, merit: 400, drop: 0, turrets: [] },
    carrier: { w: META.carrier ? META.carrier.w : 65, h: META.carrier ? META.carrier.h : 270, hp: 280, speed: 0, score: 30000, merit: 450, drop: 0, turrets: [] },
  };
  function mkPart(ox, oy, kind, hpBase, extra) {
    const m = hpm();
    const R = { main: 7, aa: 5, bridge: 10, engine: 7, tail: 6, dorsal: 5, elevator: 12 }[kind] || 6;
    return Object.assign({ ox, oy, kind, big: kind === 'main' ? 1 : 0, hp: hpBase * m, max: hpBase * m, ang: Math.PI, cd: rand(1, 2.6), dead: false, flash: 0, muzzle: 0, r: R, armored: kind === 'bridge' }, extra || {});
  }
  function makeHulk(type, x, y, kind) {
    const def = SHIPS[type], m = hpm();
    const h = {
      id: gid++, kind, type, spr: type, x, y, w: def.w, h: def.h, vx: 0, vy: SCROLL - def.speed, hp: def.hp * m, maxhp: def.hp * m, score: def.score, merit: def.merit, drop: def.drop,
      flash: 0, dead: false, deadT: 0, t: 0, wakeT: 0, isBoss: false, atkT: 2, atk2T: 5, atk3T: 3, arrived: false, list: 0, bphase: 1, spin: 0, alt: bandFor(type),
      turrets: def.turrets.map(([ox, oy, big]) => mkPart(ox, oy, big ? 'main' : 'aa', big ? 8 : 4.5)),
    };
    hulks.push(h); return h;
  }
  function waveShips() {
    const r = Math.random();
    if (r < 0.45) {
      const bx = rand(60, W - 60);
      makeHulk('battleship', bx, -SHIPS.battleship.h / 2 - 6, 'ship');
      if (Math.random() < 0.6) makeHulk('destroyer', bx < W / 2 ? bx + rand(55, 90) : bx - rand(55, 90), -60 - rand(30, 90), 'ship');
    } else if (r < 0.8 || D() < 1) {
      makeHulk('destroyer', rand(26, W / 2 - 25), -45, 'ship');
      makeHulk('destroyer', rand(W / 2 + 25, W - 26), -45 - rand(30, 110), 'ship');
    } else { for (let i = 0; i < 3; i++) spawnPT(rand(30, W - 30), -30 - i * 40); }
  }
  function spawnPT(x, y) { const h = makeHulk('ptboat', x, y, 'ship'); h.vx = 0; h.pt = true; return h; }
  function spawnBoss() {
    const type = bossTypeFor(stage);
    if (type === 'bossShip') {
      boss = makeHulk('bossShip', W / 2, -SHIPS.bossShip.h / 2 - 10, 'ship'); boss.vy = SCROLL + 34;
      boss.turrets = SHIPS.bossShip.turrets.map(([ox, oy, big]) => mkPart(ox, oy, big ? 'main' : 'aa', big ? 14 : 5));
      boss.turrets.push(mkPart(0, -48, 'bridge', 40));
    } else if (type === 'bossBomber') {
      boss = makeHulk('bossBomber', W / 2, -60, 'air'); boss.vy = 48;
      boss.turrets = [mkPart(-33, -20, 'engine', 16), mkPart(-18, -20, 'engine', 16), mkPart(18, -20, 'engine', 16), mkPart(33, -20, 'engine', 16),
        mkPart(0, -35, 'dorsal', 7), mkPart(0, -9, 'dorsal', 7), mkPart(0, 48, 'tail', 9), mkPart(-51, -10, 'aa', 5), mkPart(51, -10, 'aa', 5)];
    } else {
      const c = SHIPS.carrier;
      boss = makeHulk('carrier', W / 2, -c.h / 2 - 10, 'ship'); boss.vy = SCROLL + 34;
      boss.turrets = [mkPart(0, -c.h * 0.24, 'elevator', 22), mkPart(0, c.h * 0.27, 'elevator', 22), mkPart(c.w * 0.3, -c.h * 0.03, 'bridge', 40)];
      for (const s of [-1, 1]) for (const fy of [-0.36, -0.15, 0.08, 0.3]) boss.turrets.push(mkPart(s * c.w * 0.4, fy * c.h, 'aa', 5));
    }
    boss.isBoss = true; boss.bphase = 1;
    A.music('boss' + (((stage - 1) % 2) + 1));
  }
  function dropPow(x, y, fam) {
    if (!fam) {
      // weapon power-ups are gone: armament is chosen in the hangar. Only fuel and repair drop.
      const p = player, fuelNeed = p ? 1 - p.fuel / ST.fuelMax : 0, armNeed = p ? 1 - p.armor / ST.armorMax : 0;
      const wg = { fuel: 0.5 + fuelNeed * 0.6, repair: 0.5 + armNeed * 0.6 };
      let tot = 0; for (const k in wg) tot += wg[k];
      let r = Math.random() * tot; fam = 'fuel';
      for (const k in wg) { r -= wg[k]; if (r <= 0) { fam = k; break; } }
    }
    pickups.push({ id: gid++, fam, x: clamp(x, 14, W - 14), y: Math.max(y, HUD_H + 14), vy: -24, t: 0, ti: 0, cd: 0 });
    powSpawned++; POWTRACK.drops++; POWTRACK.since = 0;
  }
  function maybeDrop(x, y, p) { if (POWTRACK.since < 7) return; if (Math.random() < p * (ST ? ST.powLuck : 1)) dropPow(x, y); }
