
  // ---------------------------------------------------------------- debug / test hooks
  G.debug = {
    info: () => ({ state, paused, phase, stage, level: curLevel() ? curLevel().id : null, stageT: +stageT.toFixed(2), stageLen, score, hiscore, merit: run ? run.merit : 0,
      armor: player ? +player.armor.toFixed(1) : null, dmgStage: player ? damageStage(player.armor / ST.armorMax) : 0, mode: player && player.mode,
      gun: run && run.gun, bomb: run && run.bomb, loopT: player ? player.loopT : 0, enemies: enemies.length, hulks: hulks.length, wing: wing.map((w) => ({ slot: w.slot, armor: +w.armor.toFixed(1), dead: w.dead })),
      boss: boss ? { type: boss.type, hp: +boss.hp.toFixed(1), maxhp: boss.maxhp, phase: boss.bphase, parts: boss.turrets.filter((t) => !t.dead).map((t) => t.kind), arrived: boss.arrived, dead: boss.dead } : null,
      pickups: pickups.map((k) => powType(k)), pb: pb.length, eb: eb.length, parts: parts.length, H, player: player ? { x: +player.x.toFixed(1), y: +player.y.toFixed(1) } : null,
      stats: ST, pow: { drops: POWTRACK.drops, t: +POWTRACK.t.toFixed(1), every: POWTRACK.drops ? +(POWTRACK.t / POWTRACK.drops).toFixed(2) : null } }),
    skipToBoss() { if (state !== 'play') return; phase = 'stage'; evIdx = events.length; stageT = stageLen; enemies.length = 0; hulks.length = 0; },
    skipBrief() { G.briefDone(); },
    drop(type, dy) {
      if (!player) return;
      let fam = 'gun', ti = 0;
      for (const f in POW) { const i = POW[f].indexOf(type); if (i >= 0) { fam = f; ti = i; } }
      pickups.push({ id: gid++, fam, x: player.x, y: player.y - (dy === undefined ? 60 : dy), vy: 0, t: 0, ti, cd: 0 });
    },
    setWeapon(kind, type, lvl) { if (!run) return; run[kind] = { type, lvl: lvl || 1 }; },
    setMode(m) { if (player) player.mode = m; },
    setArmor(v) { if (player) player.armor = v; },
    spawn(ev) { runEvent(ev); },
    god(v) { if (player) player.inv = v ? 1e9 : 0; },
    nuke: () => ({ dmg: NUKE.dmg, radius: NUKE.radius, spec: bombSpec('nuke', run ? run.bomb.lvl : 1), W, last: lastBlast, count: blastCount, live: nukes.length }),
    detonateAt(x, y) { const sp = bombSpec('nuke', run ? run.bomb.lvl : 1); detonateNuke(x, y, sp.R, sp.dmg); },
    place(list) { // test helper: place zero fighters at fixed points (they hover)
      const g = newGroup(list.length, false);
      return list.map(([x, y]) => { const e = { id: gid++, type: 'zero', spr: 'zero', o: { pat: 'hold', x0: x, y0: y }, t: 0, x, y, ang: Math.PI, bank: 0, hp: 1e6, maxhp: 1e6, r: 9, score: 100, merit: 0, group: g, flash: 0, dead: false, fireCd: 99, canFire: false, test: true }; enemies.push(e); return e; });
    },
    placeShip(type, x, y) { const h = makeHulk(type, x, y, 'ship'); h.test = true; h.vy = 0; return { hp: h.hp }; },
    testHp: () => enemies.filter((e) => e.test).map((e) => ({ x: e.x, y: e.y, dmgTaken: +(1e6 - e.hp).toFixed(2) })),
    clearEnemies() { enemies.length = 0; hulks.length = 0; eb.length = 0; pickups.length = 0; pb.length = 0; boss = null; },
    time: () => time,
    grant(n) { if (!run) { run = newRun(); } run.merit += n; saveRun(); return run.merit; },
    gotoHangar(n) { if (!run) run = newRun(); if (n) run.merit += n; ST = computeStats(); score = run.score; enterHangar(false); },
    gotoMap() { if (!run) run = newRun(); ST = computeStats(); G.hangarLaunch(); },
    completeLevels(n) { if (!run) run = newRun(); const Ls = S.levels ? S.levels.list : []; for (let i = 0; i < Math.min(n, Ls.length); i++) run.done[Ls[i].id] = { score: 20000 + i * 3000, medal: ['gold', 'silver', 'bronze'][i % 3] }; saveRun(); },
    bossPhase(n) { if (!boss) return; const f = n === 2 ? 0.6 : n === 3 ? 0.3 : 1; boss.hp = boss.maxhp * f; setBossPhase(boss); },
    killBoss() { if (boss && !boss.dead) { for (const t of boss.turrets) t.dead = true; boss.hp = 0.01; damageHulk(boss, 1); } },
    damageBoss(frac) { if (boss) { boss.hp = Math.max(1, boss.hp - boss.maxhp * frac); setBossPhase(boss); } },
    wingHurt(slot, d) { const w = wing.find((q) => q.slot === slot); if (w) hurtWing(w, d); },
    powStats: () => ({ drops: POWTRACK.drops, t: POWTRACK.t, every: POWTRACK.drops ? POWTRACK.t / POWTRACK.drops : null }),
    resetPow() { POWTRACK.drops = 0; POWTRACK.t = 0; },
    setState(s) { state = s; },
  };
})(window.SKY);
