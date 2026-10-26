/* Fork-Tailed Devil - game logic. Logical playfield: 270 wide, 420..585 tall (y down). Rendering: js/render3d.js (WebGL) with a Canvas-2D fallback here. */
window.SKY = window.SKY || {};
(function (S) {
  'use strict';
  const A = S.audio, SP = S.sprites;
  const W = 270, HUD_H = 46, SCROLL = 26, TAU = Math.PI * 2;
  // ---- altitude is a rendering property, not a game axis. Aircraft fly in the air, anything
  // that floats sits on the water, and that is all it ever decides: which height the renderer
  // draws a thing at, and where its shadow falls. 3D mode is a camera change. It does not gate
  // guns, cost you a dimension of aiming, or ask you to fly a tape - the two modes play
  // identically, so the same skill transfers both ways and the picture never disagrees with the
  // hit boxes.
  const ALT = { SEA: 0, MID: 40 };
  const BOMB_FALL = 0.55;  // bomb fall time
  const AIRBORNE = { zero: 1, zero_red: 1, bomber: 1, heavy: 1, bossBomber: 1 };
  let mode3d = false;
  let testUnlock = false;   // test mode: everything unlocked from the start
  const altOf = (o) => (o && o.alt !== undefined ? o.alt : ALT.MID);
  const bandFor = (type) => (AIRBORNE[type] ? ALT.MID : ALT.SEA);
  const STAGE_NAMES = ['CORAL SEA', 'MIDWAY ATOLL', 'SANTA CRUZ', 'SOLOMON STRAIT', 'PHILIPPINE SEA', 'LEYTE GULF', 'OKINAWA'];
  const BOSS_ORDER = ['bossShip', 'bossBomber', 'carrier'];
  const META = window.SKY_META || {};

  // ---------------------------------------------------------------- weapons
  const GUNS = {
    normal: { name: 'MG', label: 'MG', col: '#ffe066' }, spread: { name: '3-WAY', label: '3W', col: '#7cc0ff' }, laser: { name: 'LASER', label: 'L', col: '#6ff4ff' },
    shotgun: { name: 'SHOTGUN', label: 'S', col: '#ffab5a' }, auto: { name: 'AUTO', label: 'A', col: '#86ff92' },
  };
  const BOMBS = {
    std: { name: 'BOMB', label: 'B', col: '#e8d7b0' }, cluster: { name: 'CLUSTER', label: 'C', col: '#ffb04a' }, napalm: { name: 'NAPALM', label: 'F', col: '#ff6a2a' },
    torpedo: { name: 'TORPEDO', label: 'T', col: '#8fe0ff' }, rapid: { name: 'RAPID', label: 'R', col: '#f6e36a' }, nuke: { name: 'N-BOMB', label: 'N', col: '#ffd23a' },
  };
  const POW = { // shooting a medallion cycles within its family
    gun: ['spread', 'laser', 'shotgun', 'auto', 'gunup'],
    bomb: ['cluster', 'napalm', 'torpedo', 'rapid', 'nuke'],
    repair: ['repair'],
  };
  const POW_INFO = {
    spread: ['3W', 'Gun: 3-Way spread'], laser: ['L', 'Gun: piercing laser'], shotgun: ['S', 'Gun: shotgun, eats bullets'], auto: ['A', 'Gun: auto-fire, fast'], gunup: ['+', 'Gun level up'],
    cluster: ['C', 'Bomb: cluster bomblets'], napalm: ['F', 'Bomb: napalm fire carpet'], torpedo: ['T', 'Bomb: torpedo vs ships'], rapid: ['R', 'Bomb: rapid light bombs'], nuke: ['N', 'Bomb: N-bomb, 50x, 1/3 screen'],
    repair: ['REP', 'Armor repair'],
  };
  // 250x base per-bullet damage (1), radius = 1/3 playfield width. It is meant to settle a boss:
  // the heaviest hull in the campaign is a tier-5 carrier at about 480, so two of these end it and
  // three end anything. The reload is the only thing holding it back. Levels shave that down.
  const NUKE = { dmg: 250, radius: W / 3, cd: 5, lvlCut: 0.1 };

  // ---------------------------------------------------------------- tech tree (prerequisites + costs, in MERIT)
  const TECH = [
    { id: 'a1', br: 'ARMOR', name: 'Armor Plate I', cost: 200, req: [], desc: '+25 max armor.' },
    { id: 'a2', br: 'ARMOR', name: 'Armor Plate II', cost: 450, req: ['a1'], desc: '+25 more max armor.' },
    { id: 'a3', br: 'ARMOR', name: 'Self-Sealing Skin', cost: 350, req: ['a1'], desc: 'Take 15% less damage.' },
    { id: 'a4', br: 'ARMOR', name: 'Field Repair Kit', cost: 500, req: ['a3'], desc: 'Slowly self-repair up to 60% armor.' },
    { id: 'a5', br: 'ARMOR', name: 'Fire Suppression', cost: 400, req: ['a3'], desc: 'Engine fires no longer eat armor; no wobble.' },
    { id: 'g1', br: 'GUNS', name: 'Gun Tier II', cost: 250, req: [], desc: 'Guns can reach level 2.' },
    { id: 'g2', br: 'GUNS', name: 'Gun Tier III', cost: 600, req: ['g1'], desc: 'Guns can reach level 3.' },
    { id: 'g3', br: 'GUNS', name: 'High-Speed Feed', cost: 300, req: ['g1'], desc: '+15% gun fire rate.' },
    { id: 'g4', br: 'GUNS', name: 'AP Rounds', cost: 400, req: ['g1'], desc: '+20% gun damage.' },
    { id: 'g5', br: 'GUNS', name: 'Quad .50s', cost: 500, req: ['g3'], desc: 'Base machine guns gain an extra stream.' },
    { id: 'b1', br: 'BOMBS', name: 'Bomb Tier II', cost: 250, req: [], desc: 'Bombs can reach level 2.' },
    { id: 'b2', br: 'BOMBS', name: 'Bomb Tier III', cost: 600, req: ['b1'], desc: 'Bombs can reach level 3.' },
    { id: 'b3', br: 'BOMBS', name: 'Fast Racks', cost: 300, req: ['b1'], desc: '20% faster bomb reload.' },
    { id: 'b4', br: 'BOMBS', name: 'Heavy Charge', cost: 350, req: ['b1'], desc: '+20% blast radius.' },
    { id: 'b5', br: 'BOMBS', name: 'N-Yield', cost: 700, req: ['b2', 'b4'], desc: 'N-bomb: +15% radius, 20% faster reload.' },
    { id: 's1', br: 'SUPPORT', name: 'Salvage Crew', cost: 200, req: [], desc: '+20% Merit from every kill.' },
    { id: 's2', br: 'SUPPORT', name: 'Field Mechanics', cost: 300, req: ['s1'], desc: 'REPAIR kits patch 50% more armor.' },
    { id: 's3', br: 'SUPPORT', name: 'Pickup Magnet', cost: 250, req: [], desc: 'Power-ups drift toward you.' },
    { id: 's4', br: 'SUPPORT', name: 'Loop Trim', cost: 300, req: ['s3'], desc: 'Loop recovers more than twice as fast.' },
    { id: 's5', br: 'SUPPORT', name: 'Wingman Slot I', cost: 400, req: [], desc: 'Fly with one wingman.' },
    { id: 's6', br: 'SUPPORT', name: 'Wingman Slot II', cost: 700, req: ['s5'], desc: 'Fly with two wingmen.' },
    { id: 's7', br: 'SUPPORT', name: 'Wingman Armor', cost: 350, req: ['s5'], desc: 'Wingmen are 50% tougher.' },
  ];
  const TECH_BY = {}; TECH.forEach((t) => { TECH_BY[t.id] = t; });
  const WING_COST = 250;
  const WINGMEN = [
    { id: 'hayes', name: 'Lt. Sam "Boomer" Hayes', look: 'w_hayes' },
    { id: 'alvarez', name: 'Ens. Rosa "Kit" Alvarez', look: 'w_alvarez' },
  ];

  const rand = (a, b) => (b === undefined ? Math.random() * (a === undefined ? 1 : a) : a + Math.random() * (b - a));
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const pick = (a) => a[(Math.random() * a.length) | 0];
  const d2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
  function sweep(arr, dead) { let j = 0; for (let i = 0; i < arr.length; i++) if (!dead(arr[i])) arr[j++] = arr[i]; arr.length = j; }
  const STORY = () => S.story || { COPILOTS: [], copilot: () => null };

  let H = 480, K = 2, ctx = null, OX = 0, OY = 0;
  let state = 'loading', paused = false, hold = false, time = 0, stateT = 0, slow = 1;
  let stage = 1, stageT = 0, stageLen = 60, phase = 'intro', phaseT = 0, events = [], evIdx = 0, clearJingle = false, clearBonus = 0, stageHits = 0, briefWait = 0;
  let score = 0, hiscore = 0, newRecord = false;
  try { hiscore = parseInt(localStorage.getItem('sky1943.hi') || '0', 10) || 0; } catch (e) {}
  try { hiscore = parseInt(localStorage.getItem('sky1943.hi') || '0', 10) || 0; } catch (e) {}
  let player = null, boss = null, run = null, ST = null;
  const nukes = [], pb = [], eb = [], enemies = [], hulks = [], pickups = [], parts = [], fx = [], popups = [], islands = [], clouds = [], warns = [], zones = [], wing = [], groups = new Map();
  let missionStart = null, abortArmUntil = 0;
  let gid = 1, scrollY = 0, shake = 0, flashT = 0, lastBlast = null, blastCount = 0, loadP = 0, nextIsland = 0, nextCloud = 0, nextHigh = 4, powSpawned = 0, playT = 0, radioCd = {};
  const POWTRACK = { drops: 0, t: 0, since: 0 }; // POW pacing: random drops need a 7 s gap, a supply drop guarantees one every ~12.5 s

  const G = S.game = {
    W, HUD_H, GUNS, BOMBS, POW, POW_INFO, TECH, TECH_BY, NUKE, WINGMEN, WING_COST, BOSS_ORDER, STAGE_NAMES,
    input: { ax: 0, ay: 0, fire: false, touching: false, dx: 0, dy: 0, loop: false, mode: false },
    touchMode: false, fsSupported: false, onToggleFullscreen: null, hooks: {}, r3d: null,
  };
  function hook(name, a, b) { const f = G.hooks[name]; if (f) { try { return f(a, b); } catch (e) { console.error(e); } } return undefined; }
  function radio(kind, extra) { if ((radioCd[kind] || 0) > time) return; radioCd[kind] = time + 8; hook('radio', kind, extra); }

  // ---------------------------------------------------------------- run (persists across stages, saved at the hangar)
  function newRun() {
    return { stage: 1, score: 0, merit: 0, won: false, tech: [], copilot: 'ramos', unlocked: ['ramos', 'brooks', 'nowak'], wing: [true, true], gun: { type: 'normal', lvl: 1 }, bomb: { type: 'std', lvl: 1 }, briefs: 0, version: 3, level: 0, done: {}, played: 0, met: [] };
  }
  const has = (id) => run && run.tech.indexOf(id) >= 0;
  function computeStats() {
    const s = { speed: 155, gunDmg: 1, fireRate: 1, bombRadius: 1, bombReload: 1, armorMax: 100, dmgTaken: 1, magnet: 0, loopCd: 0.6,
      powLuck: 1, regen: 0, fireSuppress: false, gunCap: 1, bombCap: 1, wingSlots: 0, wingArmor: 1, wingDmg: 1, nukeYield: 1, nukeReload: 1, quad: false, ebSpeed: 1,
      meritMul: 1, repairGain: 1 };
    if (has('a1')) s.armorMax += 25; if (has('a2')) s.armorMax += 25; if (has('a3')) s.dmgTaken *= 0.85; if (has('a4')) s.regen += 0.5; if (has('a5')) s.fireSuppress = true;
    if (has('g1')) s.gunCap = 2; if (has('g2')) s.gunCap = 3; if (has('g3')) s.fireRate *= 1.15; if (has('g4')) s.gunDmg *= 1.2; if (has('g5')) s.quad = true;
    if (has('b1')) s.bombCap = 2; if (has('b2')) s.bombCap = 3; if (has('b3')) s.bombReload *= 0.8; if (has('b4')) s.bombRadius *= 1.2; if (has('b5')) { s.nukeYield = 1.15; s.nukeReload = 0.8; }
    if (has('s1')) s.meritMul *= 1.2; if (has('s2')) s.repairGain *= 1.5; if (has('s3')) s.magnet = 38; if (has('s4')) s.loopCd = 0.25;
    if (has('s5')) s.wingSlots = 1; if (has('s6')) s.wingSlots = 2; if (has('s7')) s.wingArmor = 1.5;
    const cp = STORY().copilot ? STORY().copilot(run ? run.copilot : null) : null;
    if (cp && cp.mods) {
      const m = cp.mods;
      for (const k in m) {
        if (k === 'fireSuppress') s.fireSuppress = s.fireSuppress || m[k];
        else if (!(k in s)) continue;                 // a mod for a stat that no longer exists
        else if (k === 'armorMax' || k === 'magnet' || k === 'regen') s[k] += m[k];
        else if (k === 'loopCd') s.loopCd *= m[k];
        else s[k] *= m[k];
      }
    }
    s.armorMax = Math.round(s.armorMax);
    return s;
  }
  G.computeStats = (r) => { const o = run; if (r) run = r; const s = computeStats(); run = o; return s; };
  function saveRun() { try { if (run) localStorage.setItem('sky1943.run', JSON.stringify(run)); } catch (e) {} }
  function loadRun() { try { const r = JSON.parse(localStorage.getItem('sky1943.run') || 'null'); return r && r.version === 3 ? r : null; } catch (e) { return null; } }
  function clearSave() { try { localStorage.removeItem('sky1943.run'); } catch (e) {} }
  G.hasSave = () => !!loadRun();
  G.savedStage = () => { const r = loadRun(); return r ? r.stage : 0; };

  // ---------------------------------------------------------------- setup
  G.setView = function (h, k, c) {
    H = h; K = k; ctx = c;
    if (player) { player.x = clamp(player.x, 12, W - 12); player.y = clamp(player.y, HUD_H + 18, H - 16); }
  };
  G.getH = () => H;
  function nIslands() { return META.islands ? META.islands.length : 3; }
  function seedScenery() {
    islands.length = clouds.length = 0;
    // a level with a real coastline brings its own scenery
    const Lv = curLevel();
    if (!(Lv && Lv.map)) for (let i = 0; i < 2; i++) islands.push({ v: (Math.random() * nIslands()) | 0, x: rand(20, W - 20), y: rand(60, H - 60), f: Math.random() < 0.5, id: gid++ });
    for (let i = 0; i < 3; i++) clouds.push(mkCloud(false, rand(0, H)));
    clouds.push(mkCloud(true, rand(0, H * 0.6)));
  }
  function mkCloud(high, y) {
    return { v: (Math.random() * 4) | 0, x: rand(-20, W + 20), y: y === undefined ? -110 : y, sp: SCROLL * (high ? rand(2.6, 3.3) : rand(1.35, 1.8)), a: high ? rand(0.2, 0.3) : rand(0.55, 0.8), s: high ? rand(1.3, 1.7) : rand(0.6, 1.05), high, f: Math.random() < 0.5, id: gid++, rot: rand(TAU) };
  }
  G.init = function () { A.music('title'); };

  // ---------------------------------------------------------------- flow
  function D() { return stage - 1; }
  const hpm = () => 1 + 0.18 * D();
  const firem = () => 1 + 0.2 * Math.min(D(), 8);
  const bspeed = () => Math.min(172, 98 + 9 * D()) * (ST ? ST.ebSpeed : 1);

  function makePlayer() {
    return { x: W / 2, y: H - 70, armor: ST.armorMax, mode: 'guns', fireCd: 0, bombCd: 0, loopT: 0, loopCd: 0, inv: 1.2, dead: false, deadT: 0, bank: 0, side: 0, flash: 0, burnT: 0, hitT: 0, bombFlash: 0 };
  }
  function beginStage(r) {
    run = r; stage = run.stage; score = run.score; ST = computeStats();
    // what you launched with: abort puts it all back, so a stage cannot be farmed halfway
    missionStart = { score: run.score, merit: run.merit };
    player = makePlayer();
    clearAll(); startStage();
    state = 'play'; stateT = 0; paused = false; hold = false; slow = 1;
    A.sfx('start'); A.music('stage' + (((stage - 1) % 3) + 1));
    saveRun();
    hook('stageStart', stage, bossTypeFor(stage));
  }
  function continueGame() { const r = loadRun(); if (!r) return G.newGame(); newRecord = false; run = r; stage = r.stage; score = r.score; G.grantAll && G.grantAll(); ST = computeStats(); enterHangar(true); }
  function clearAll() {
    nukes.length = 0; flashT = 0; warns.length = 0; zones.length = 0;
    pb.length = eb.length = enemies.length = hulks.length = pickups.length = fx.length = popups.length = parts.length = 0;
    groups.clear(); boss = null; spawnWing();
  }
  function spawnWing() {
    wing.length = 0;
    if (!run || !ST) return;
    for (let i = 0; i < ST.wingSlots; i++) {
      if (!run.wing[i]) continue;
      const max = 30 * ST.wingArmor, s = i === 0 ? -1 : 1;
      wing.push({ slot: i, ox: s * 30, oy: 18, x: W / 2 + s * 30, y: H - 52, armor: max, max, dead: false, deadT: 0, fireCd: rand(0.2), bombCd: 1, bank: 0, flash: 0, inv: 1.5, name: WINGMEN[i].name, id: gid++ });
    }
  }
  function bossTypeFor(n) { const L = curLevel(); return L && L.boss ? L.boss : BOSS_ORDER[(n - 1) % BOSS_ORDER.length]; }
  function startStage() {
    buildStage(stage); stageT = 0; evIdx = 0; phase = 'intro'; phaseT = 0; boss = null; clearJingle = false; stageHits = 0;
  }
  function buildStage(n) {
    events = [];
    const Lv = curLevel(), mix = Object.assign({ fighters: 1, ships: 0.35, bombers: 0.3, pt: 0, kami: 0 }, Lv && Lv.mix ? Lv.mix : {});
    const L = 56 + Math.min(n, 6) * 4;
    const gap = Math.max(1.15, 2.6 - 0.22 * (n - 1)) / (mix.pace || 1);
    let t = 1.2, k = 0, lastShip = -9;
    const kinds = ['fighters', 'ships', 'bombers', 'pt', 'kami'];
    while (t < L) {
      let ev;
      if (k % 4 === 1) ev = 'red';            // red formations every 4th wave (each drops a POW when wiped out)
      else {
        let tot = 0; for (const q of kinds) tot += mix[q] || 0;
        let r = Math.random() * tot; ev = 'fighters';
        for (const q of kinds) { r -= mix[q] || 0; if (r <= 0) { ev = q; break; } }
        if ((ev === 'ships' || ev === 'pt') && k - lastShip < 2) ev = 'fighters';
      }
      if (ev === 'ships' || ev === 'pt') lastShip = k;
      events.push({ t, ev });
      if (n >= 3 && ev === 'fighters' && Math.random() < 0.15 + 0.06 * n) events.push({ t: t + 0.7, ev: 'fighters' });
      t += gap * rand(0.8, 1.25) + (ev === 'ships' ? 1.4 : 0);
      k++;
    }
    events.sort((a, b) => a.t - b.t);
    stageLen = L + 2;
  }
  function runEvent(ev) {
    if (ev === 'fighters') waveFighters(false);
    else if (ev === 'red') waveFighters(true);
    else if (ev === 'ships') waveShips();
    else if (ev === 'bombers') waveBombers();
    else if (ev === 'pt') { for (let i = 0; i < 3; i++) spawnPT(rand(30, W - 30), -30 - i * 40); }
    else if (ev === 'kami') { const g = newGroup(3, false); for (let i = 0; i < 3; i++) { const e = spawnZero({ pat: 'dive', dir: 1, x0: rand(30, W - 30), y0: 0, delay: i * 0.5 }, false, g); e.kami = true; e.canFire = false; e.score = 150; } }
  }
  function gameOver() {
    state = 'gameover'; stateT = 0;
    if (score > hiscore) { hiscore = score; newRecord = true; try { localStorage.setItem('sky1943.hi', String(hiscore)); } catch (e) {} }
    clearSave();
    A.music(null); A.sfx('gameover'); A.sting('gameover');
    hook('gameover', score);
  }
  function addScore(n, x, y, show) {
    score += n;
    if (show !== false && x !== undefined) popups.push({ x, y, txt: String(n), t: 0, col: '#fff', s: 7 });
  }
  function merit(n) { if (run) run.merit += Math.round(n * (ST ? ST.meritMul : 1)); }
  function popup(x, y, txt, col, s) { popups.push({ x, y, txt, t: 0, col: col || '#fff', s: s || 8 }); }

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
  // ---- where a ship may be put
  // Nothing stops a hull steaming over an island: to the game a coastline is a picture, drawn by
  // the renderer, and the only thing that ever knows about it is the spawner. So the spawner is
  // where it has to be settled. A lane needs water under the hull now AND water all the way along
  // the track it will take before it leaves the field - the map slides past, so a ship crosses a
  // few hundred units of it on the way through, and an island that is clear at spawn is not clear
  // thirty seconds later. It also needs to be a lane nobody is already in.
  const LANE_STEP = 22, LANE_REACH = 150;
  function overLand(x, y) { const R3 = S.r3d; return !!(R3 && R3.landAt && R3.landAt(curLevel(), x, y, scrollY, H)); }
  function waterLane(x, y, def) {
    const R3 = S.r3d; if (!R3 || !R3.landAt) return true;     // no terrain, no land to avoid
    const half = def.w / 2 + 5;
    // A ship advances through the map at its own speed while the field scrolls past underneath, so
    // how far it gets is its speed times how long it has on screen. Negative speed (a PT boat runs
    // with the scroll) just means it travels the other way through the map.
    // Capped, because a whole crossing is several hundred units and some of these maps are mostly
    // island - demand a clear lane that long and Pearl Harbor has nowhere to put a destroyer at
    // all. This covers the approach you actually watch; anything that still ends up ashore is
    // caught on the way in, off the top of the field, where nobody sees it go.
    const onField = (H + def.h) / Math.max(5, SCROLL - def.speed);
    const reach = clamp(def.speed * onField, -LANE_REACH, LANE_REACH);
    const n = Math.max(1, Math.ceil(Math.abs(reach) / LANE_STEP));
    for (let k = 0; k <= n; k++) {
      const d = reach * (k / n);
      for (const ox of [-half, 0, half]) if (overLand(x + ox, y - d)) return false;
    }
    return true;
  }
  function laneClear(x, y, def) {
    for (const h of hulks) {
      if (h.dead) continue;
      if (Math.abs(h.x - x) < (h.w + def.w) / 2 + 10 && Math.abs(h.y - y) < (h.h + def.h) / 2 + 18) return false;
    }
    return true;
  }
  // Returns null when there is nowhere to put it. An empty sea is a better answer than a destroyer
  // parked on a hill or inside another destroyer.
  function placeShip(type, y, lo, hi, pt) {
    const def = SHIPS[type], half = def.w / 2 + 4;
    lo = Math.max(lo, half); hi = Math.min(hi, W - half);
    if (hi <= lo) return null;
    for (let i = 0; i < 16; i++) {
      const x = rand(lo, hi);
      if (waterLane(x, y, def) && laneClear(x, y, def)) {
        const h = makeHulk(type, x, y, 'ship');
        if (pt) { h.vx = 0; h.pt = true; }
        return h;
      }
    }
    return null;
  }
  function waveShips() {
    const r = Math.random();
    if (r < 0.45) {
      const b = placeShip('battleship', -SHIPS.battleship.h / 2 - 6, 60, W - 60);
      if (b && Math.random() < 0.6) {
        const y = -60 - rand(30, 90);
        if (b.x < W / 2) placeShip('destroyer', y, b.x + 55, b.x + 90); else placeShip('destroyer', y, b.x - 90, b.x - 55);
      }
    } else if (r < 0.8 || D() < 1) {
      placeShip('destroyer', -45, 26, W / 2 - 25);
      placeShip('destroyer', -45 - rand(30, 110), W / 2 + 25, W - 26);
    } else { for (let i = 0; i < 3; i++) spawnPT(rand(30, W - 30), -30 - i * 40); }
  }
  function spawnPT(x, y) {
    // the caller suggests an x; the lane search keeps it near there and off the rocks
    return placeShip('ptboat', y, x - 45, x + 45, true);
  }
  // The boss belongs in the middle of the field, so it starts there and steps outward only as far
  // as it has to for a hull-width of water.
  function bossX(type) {
    const def = SHIPS[type];
    for (let d = 0; d <= W / 2; d += 14) for (const s of (d ? [-1, 1] : [0])) {
      const x = W / 2 + s * d;
      if (x > def.w / 2 + 4 && x < W - def.w / 2 - 4 && waterLane(x, -def.h / 2 - 10, def)) return x;
    }
    return W / 2;
  }
  function spawnBoss() {
    const type = bossTypeFor(stage);
    if (type === 'bossShip') {
      boss = makeHulk('bossShip', bossX('bossShip'), -SHIPS.bossShip.h / 2 - 10, 'ship'); boss.vy = SCROLL + 34;
      boss.turrets = SHIPS.bossShip.turrets.map(([ox, oy, big]) => mkPart(ox, oy, big ? 'main' : 'aa', big ? 14 : 5));
      boss.turrets.push(mkPart(0, -48, 'bridge', 40));
    } else if (type === 'bossBomber') {
      boss = makeHulk('bossBomber', W / 2, -60, 'air'); boss.vy = 48;
      boss.turrets = [mkPart(-33, -20, 'engine', 16), mkPart(-18, -20, 'engine', 16), mkPart(18, -20, 'engine', 16), mkPart(33, -20, 'engine', 16),
        mkPart(0, -35, 'dorsal', 7), mkPart(0, -9, 'dorsal', 7), mkPart(0, 48, 'tail', 9), mkPart(-51, -10, 'aa', 5), mkPart(51, -10, 'aa', 5)];
    } else {
      const c = SHIPS.carrier;
      boss = makeHulk('carrier', bossX('carrier'), -c.h / 2 - 10, 'ship'); boss.vy = SCROLL + 34;
      boss.turrets = [mkPart(0, -c.h * 0.24, 'elevator', 22), mkPart(0, c.h * 0.27, 'elevator', 22), mkPart(c.w * 0.3, -c.h * 0.03, 'bridge', 40)];
      for (const s of [-1, 1]) for (const fy of [-0.36, -0.15, 0.08, 0.3]) boss.turrets.push(mkPart(s * c.w * 0.4, fy * c.h, 'aa', 5));
    }
    boss.isBoss = true; boss.bphase = 1;
    A.music('boss' + (((stage - 1) % 2) + 1));
  }
  function dropPow(x, y, fam) {
    // weapon power-ups are gone: armament is chosen in the hangar, and so is everything else you
    // carry. Armor is the only thing a mission can hand you now, so REPAIR is the only drop.
    if (!fam) fam = 'repair';
    pickups.push({ id: gid++, fam, x: clamp(x, 14, W - 14), y: Math.max(y, HUD_H + 14), vy: -24, t: 0, ti: 0, cd: 0 });
    powSpawned++; POWTRACK.drops++; POWTRACK.since = 0;
  }
  function maybeDrop(x, y, p) { if (POWTRACK.since < 7) return; if (Math.random() < p * (ST ? ST.powLuck : 1)) dropPow(x, y); }

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

  // ---------------------------------------------------------------- update
  G.update = function (dt) {
    time += dt; stateT += dt;
    if (paused || state === 'loading' || state === 'hangar' || state === 'map') { if (state === 'hangar' || state === 'map') updateScenery(dt * 0.3); return; }
    if (phase === 'briefing') { briefWait += dt; if (briefWait > 40) G.briefDone(); dt *= 0.0; }
    updateScenery(dt);
    if (shake > 0) shake = Math.max(0, shake - dt * 18);
    if (state === 'play' || state === 'gameover') {
      if (state === 'play') {
        phaseT += dt; playT += dt; POWTRACK.t += dt; POWTRACK.since += dt;
        if (POWTRACK.since > 12.5 && player && !player.dead && (phase === 'stage' || phase === 'boss')) dropPow(rand(40, W - 40), HUD_H + 24); // supply drop
        if (phase === 'intro') { if (phaseT > 2.3) { phase = 'stage'; phaseT = 0; } }
        else if (phase === 'stage') {
          stageT += dt;
          // A callout does not stop you flying, it just clears the sky: the stage clock keeps
          // running but nothing new is launched, and anything already up leaves. Reading a
          // transmission should not cost you a wing. Nothing speaks on a timer any more, so every
          // callout is now something you did - took damage, ran the tanks down, lost a wingman.
          if (hold) { if (enemies.length) enemies.length = 0; if (eb.length) eb.length = 0; }
          else while (evIdx < events.length && events[evIdx].t <= stageT) runEvent(events[evIdx++].ev);
          if (stageT >= stageLen && evIdx >= events.length) { phase = 'warning'; phaseT = 0; A.music(null); A.sfx('warning'); }
        } else if (phase === 'warning') { if (phaseT > 2.4) { phase = 'briefing'; phaseT = 0; briefWait = 0; eb.length = 0; if (!hook('bossBrief', bossTypeFor(stage), curLevel())) G.briefDone(); } }
        else if (phase === 'clear') {
          if (phaseT > 1.6 && !clearJingle) { clearJingle = true; A.sfx('clear'); }
          if (phaseT > 5.2 && !player.dead) completeLevel();
        }
        if (phase !== 'briefing') updatePlayer(dt);
      }
      if (phase !== 'briefing') { updateEnemies(dt); updateHulks(dt); updateWing(dt); updateBullets(dt); updatePickups(dt); if (state === 'play') collide(); }
      updateFx(dt);
    } else updateFx(dt);
  };
  G.briefDone = function () { if (phase === 'briefing') { phase = 'boss'; phaseT = 0; spawnBoss(); } };

  // ---------------------------------------------------------------- campaign levels, hangar, save
  function curLevel() { return S.levels && run ? S.levels.list[run.level || 0] : null; }
  function completeLevel() {
    const L = curLevel();
    if (L) {
      const prev = run.done[L.id];
      const medal = stageHits === 0 ? 'gold' : player.armor > ST.armorMax * 0.5 ? 'silver' : 'bronze';
      if (!prev || score > prev.score) run.done[L.id] = { score, medal };
      if (prev) merit(-75); // replays pay a little less
    }
    run.score = score; run.played = (run.played || 0) + 1;
    // the campaign ends when every non-bonus battle has been won; bonus theaters stay open after
    if (!run.won && campaignWon()) { run.won = true; run.wonAt = Date.now(); return enterVictory(); }
    enterHangar(false);
  }
  function clearField() {
    pb.length = eb.length = enemies.length = hulks.length = pickups.length = warns.length = zones.length = 0;
    wing.length = 0; boss = null;
  }
  function campaignWon() {
    const Ls = S.levels ? S.levels.list : [];
    return Ls.length > 0 && Ls.every((l) => l.bonus || (run.done && run.done[l.id]));
  }
  G.campaignWon = campaignWon;
  function victoryStats() {
    const Ls = S.levels ? S.levels.list : [];
    const tally = { gold: 0, silver: 0, bronze: 0 };
    let won = 0, best = 0;
    for (const l of Ls) {
      const d = run.done && run.done[l.id];
      if (!d) continue;
      won++; best += d.score || 0;
      if (tally[d.medal] !== undefined) tally[d.medal]++;
    }
    const bonusLeft = Ls.filter((l) => l.bonus && !(run.done && run.done[l.id])).length;
    return { won, total: Ls.length, required: Ls.filter((l) => !l.bonus).length, tally, score: best,
      merit: run.merit, played: run.played, copilot: run.copilot, bonusLeft };
  }
  G.victoryStats = victoryStats;
  function enterVictory() {
    state = 'victory'; stateT = 0; paused = false; hold = false;
    clearField();
    ST = computeStats();
    saveRun(); hook('autosave', 'victory');
    A.music(null); A.sting && A.sting('clear');
    if (!hook('victory', victoryStats())) enterHangar(false);
  }
  G.toHangar = () => { enterHangar(false); };
  // Walk out of a mission at any time. It is abandoned, not flown: the score and the Merit go back
  // to what they were on the runway, the battle stays unwon, and you start it over when you come
  // back. Nothing is kept, so there is nothing to farm.
  G.abortMission = function () {
    if (state !== 'play') return false;
    if (run && missionStart) { run.score = missionStart.score; score = missionStart.score; run.merit = missionStart.merit; }
    abortArmUntil = 0;
    enterHangar(false);
    return true;
  };
  function enterHangar(resumed) {
    state = 'hangar'; stateT = 0; paused = false; hold = false;
    clearField();
    ST = computeStats();
    // keep the displayed tier honest: it always equals what the tech tree allows
    if (run && run.gun) run.gun.lvl = ST.gunCap || 1;
    if (run && run.bomb) run.bomb.lvl = ST.bombCap || 1;
    saveRun(); hook('autosave', 'hangar');
    A.music('hangar');
    if (!hook('hangar', resumed)) { /* no UI: go straight on */ G.hangarLaunch(); }
  }
  G.hangarLaunch = function () { // hangar -> campaign map
    state = 'map'; stateT = 0; saveRun();
    if (!hook('map')) G.launchLevel(nextLevelIdx());
  };
  function levelAvailable(i) {
    const Ls = S.levels ? S.levels.list : null; if (!Ls || !run) return i === 0;
    const L = Ls[i]; if (!L) return false;
    if (!L.after || !L.after.length) return true;
    return L.after.some((id) => run.done[id]);
  }
  function nextLevelIdx() {
    const Ls = S.levels ? S.levels.list : [];
    for (let i = 0; i < Ls.length; i++) if (!run.done[Ls[i].id] && levelAvailable(i)) return i;
    return 0;
  }
  G.levelAvailable = levelAvailable;
  // ---- armament: what you carry into the mission (the 2D/3D switch is a camera, not a model)
  G.GUN_TYPES = ['normal', 'spread', 'laser', 'shotgun', 'auto'];
  G.BOMB_TYPES = ['std', 'cluster', 'napalm', 'torpedo', 'rapid', 'nuke'];
  G.setArm = function (kind, type) {
    if (!run) return false;
    const list = kind === 'gun' ? G.GUN_TYPES : G.BOMB_TYPES;
    if (list.indexOf(type) < 0) return false;
    run[kind] = { type, lvl: (kind === 'gun' ? ST.gunCap : ST.bombCap) || 1 };
    saveRun(); A.sfx('buy');
    return true;
  };
  G.arm = () => ({ gun: run ? run.gun : null, bomb: run ? run.bomb : null, gunCap: ST.gunCap, bombCap: ST.bombCap });
  G.mode3d = () => mode3d;
  // test mode: every tech node, copilot and wingman slot available from the start
  G.testUnlock = () => testUnlock;
  G.setTestUnlock = function (on) {
    testUnlock = !!on;
    try { localStorage.setItem('sky1943.testUnlock', testUnlock ? '1' : '0'); } catch (e) {}
    if (run) { grantAll(); ST = computeStats(); saveRun(); }
    return testUnlock;
  };
  function grantAll() {
    if (!run || !testUnlock) return;
    run.merit = Math.max(run.merit, 9999);
    for (const t of TECH) if (run.tech.indexOf(t.id) < 0) run.tech.push(t.id);
    for (const c of (STORY().COPILOTS || [])) if (run.unlocked.indexOf(c.id) < 0) run.unlocked.push(c.id);
    run.wing = [true, true];
  }
  G.grantAll = grantAll;
  G.setMode3d = function (on) {
    mode3d = !!on;
    try { localStorage.setItem('sky1943.mode3d', mode3d ? '1' : '0'); } catch (e) {}
    return mode3d;
  };
  try {
    mode3d = localStorage.getItem('sky1943.mode3d') === '1';
    const tu = localStorage.getItem('sky1943.testUnlock');
    testUnlock = tu === null ? true : tu === '1';   // defaults on while the game is being tested
  } catch (e) { testUnlock = true; }

  G.launchLevel = function (i) {
    if (!run) run = newRun();
    // tech sets the tier, the hangar sets the type
    if (run.gun) run.gun.lvl = ST.gunCap || 1;
    if (run.bomb) run.bomb.lvl = ST.bombCap || 1;
    if (!levelAvailable(i)) return false;
    const L = S.levels ? S.levels.list[i] : null;
    run.level = i; run.stage = L ? L.tier : run.stage;
    beginStage(run); return true;
  };
  G.run = () => run;
  G.stats = () => ST || computeStats();
  G.level = () => curLevel();
  G.techState = function (id) {
    const t = TECH_BY[id]; if (!t || !run) return 'locked';
    if (has(id)) return 'owned';
    return t.req.every(has) ? 'available' : 'locked';
  };
  G.buyTech = function (id) {
    const t = TECH_BY[id]; if (!t || G.techState(id) !== 'available' || run.merit < t.cost) return false;
    run.merit -= t.cost; run.tech.push(id); ST = computeStats(); saveRun(); hook('autosave', 'buy'); A.sfx('buy'); return true;
  };
  G.copilotState = function (id) {
    const c = STORY().copilot(id); if (!c || !run) return 'locked';
    if (run.unlocked.indexOf(id) >= 0) return run.copilot === id ? 'active' : 'owned';
    if (c.unlock && c.unlock.played && (run.played || 0) < c.unlock.played) return 'locked';
    return 'buyable';
  };
  G.setCopilot = function (id) {
    const st = G.copilotState(id), c = STORY().copilot(id);
    if (st === 'buyable') { if (run.merit < c.unlock.cost) return false; run.merit -= c.unlock.cost; run.unlocked.push(id); A.sfx('buy'); }
    else if (st === 'locked') return false;
    run.copilot = id; ST = computeStats(); saveRun(); hook('autosave', 'copilot'); return true;
  };
  G.replaceWing = function (slot) {
    if (!run || slot >= ST.wingSlots || run.wing[slot] || run.merit < WING_COST) return false;
    run.merit -= WING_COST; run.wing[slot] = true; saveRun(); A.sfx('buy'); return true;
  };
  G.exportRun = () => run ? JSON.parse(JSON.stringify(run)) : loadRun();
  G.importRun = function (r) { if (!r || typeof r !== 'object') return false; run = r; saveRun(); return true; };
  G.newRun = newRun;
  G.saveNow = function () { if (state === 'play' && run) { run.score = score; } saveRun(); };

  // ---------------------------------------------------------------- controls API
  G.start = function () {
    if (state === 'title') { if (G.hasSave()) continueGame(); else G.newGame(); return true; }
    if (state === 'gameover' && stateT > 1.0) { state = 'title'; stateT = 0; A.music('title'); hook('title'); return true; }
    return false;
  };
  G.newGame = function () { newRecord = false; clearSave(); run = newRun(); grantAll(); ST = computeStats(); score = 0; state = 'map'; stateT = 0; A.music('hangar'); if (!hook('map')) G.launchLevel(0); };
  G.continueGame = continueGame;
  G.state = () => state;
  G.phase = () => phase;
  G.isPaused = () => paused;
  // Held for a transmission: the sky empties and stays empty until it clears. You keep flying -
  // only the opposition is suspended. A boss stays, because it is the level.
  G.holdPlay = function (v) {
    v = !!v;
    if (hold === v || state !== 'play') { if (!v) hold = false; return; }
    hold = v;
    if (!v) return;
    enemies.length = 0; eb.length = 0;
    G.input.fire = false; G.input.touching = false;
  };
  G.isHeld = () => hold;
  G.setPaused = function (v) {
    if (state !== 'play') { paused = false; return; }
    if (paused === !!v) return;
    paused = !!v; A.sfx('pause');
    if (paused) { G.input.touching = false; G.input.fire = false; G.saveNow(); }
  };
  G.togglePause = () => G.setPaused(!paused);
  G.toggleMute = () => A.toggleMute();
  const BTN = { pause: [W - 44, 2, 20, 17], mute: [W - 22, 2, 20, 17], music: [W - 66, 2, 20, 17], fs: [W - 88, 2, 20, 17] };
  const TITLE_BTN = { cont: null, neu: null, dossier: null, save: null };
  const PAUSE_BTN = { mode: null, abort: null };   // the same 2D/3D switch, reachable mid-mission
  G.abortArmed = () => abortArmUntil > Date.now();
  function inRect(x, y, r, pad) { return r && x >= r[0] - pad && x <= r[0] + r[2] + pad && y >= r[1] - pad && y <= r[1] + r[3] + pad; }
  // Both thumb buttons sit together under the middle of the field rather than tucked into the
  // right corner, and they are big enough to hit without looking down at them.
  const BTN_R = 25;
  function loopBtn() { return [W / 2 + 33, H - 36, BTN_R]; }
  function modeBtn() { return [W / 2 - 33, H - 36, BTN_R]; }
  G.handleTap = function (x, y) {
    if (inRect(x, y, BTN.mute, 3)) { A.toggleMute(); return true; }
    if (inRect(x, y, BTN.music, 3)) { A.toggleMusic(); return true; }
    if (state === 'play' && inRect(x, y, BTN.pause, 3)) { G.togglePause(); return true; }
    if (state === 'play' && paused && inRect(x, y, PAUSE_BTN.mode, 3)) { G.setMode3d(x > (PAUSE_BTN.mode[0] + PAUSE_BTN.mode[2] / 2)); A.sfx('click'); return true; }
    // two taps, because one stray thumb on a pause screen should not throw the sortie away
    if (state === 'play' && paused && inRect(x, y, PAUSE_BTN.abort, 3)) {
      A.sfx('click');
      if (G.abortArmed()) G.abortMission(); else abortArmUntil = Date.now() + 3000;
      return true;
    }
    if (G.fsSupported && !G.touchMode && inRect(x, y, BTN.fs, 3)) { G.onToggleFullscreen && G.onToggleFullscreen(); return true; }
    if (state === 'title') {
      if (inRect(x, y, TITLE_BTN.mode, 3)) { G.setMode3d(x > (TITLE_BTN.mode[0] + TITLE_BTN.mode[2] / 2)); A.sfx('click'); return true; }
      if (inRect(x, y, TITLE_BTN.test, 3)) { G.setTestUnlock(!G.testUnlock()); A.sfx('click'); return true; }
      if (inRect(x, y, TITLE_BTN.cont, 3)) { continueGame(); return true; }
      if (inRect(x, y, TITLE_BTN.neu, 3)) { G.newGame(); return true; }
      if (inRect(x, y, TITLE_BTN.dossier, 3)) { hook('dossier'); return true; }
      if (inRect(x, y, TITLE_BTN.save, 3)) { hook('savepanel'); return true; }
    }
    if (state === 'play' && !paused && G.touchMode) {
      let [lx, ly, lr] = loopBtn();
      if (d2(x, y, lx, ly) < (lr + 6) * (lr + 6)) { G.input.loop = true; return true; }
      [lx, ly, lr] = modeBtn();
      if (d2(x, y, lx, ly) < (lr + 5) * (lr + 5)) { G.input.mode = true; return true; }
    }
    return false;
  };
  G.loop = function () { if (state === 'play' && !paused) G.input.loop = true; };
  G.toggleMode = function () { if (state === 'play' && !paused) G.input.mode = true; };

  // ---------------------------------------------------------------- 2D rendering (HUD + overlays always; the world only when WebGL is unavailable)
  const FONT = '"Avenir Next Condensed", "Arial Narrow", "Roboto Condensed", "Helvetica Neue", Arial, sans-serif';
  const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  const BRASS = '#d9b860', PAPER = '#f1ead6';
  const HERO = 1.1;   // your own aircraft rides 10% larger than scale: it has to be findable
  function spr(s, x, y, a, sx, sy) {
    if (!s) return;
    const c = Math.cos(a || 0) * K, n = Math.sin(a || 0) * K;
    sx = sx === undefined ? 1 : sx; sy = sy === undefined ? sx : sy;
    ctx.setTransform(c * sx, n * sx, -n * sy, c * sy, x * K + OX, y * K + OY);
    ctx.drawImage(s.c, -s.w / 2, -s.h / 2, s.w, s.h);
  }
  function sprSize(s, x, y, w, h, a) {
    if (!s) return;
    const c = Math.cos(a || 0) * K, n = Math.sin(a || 0) * K;
    ctx.setTransform(c, n, -n, c, x * K + OX, y * K + OY);
    ctx.drawImage(s.c, -w / 2, -h / 2, w, h);
  }
  function base() { ctx.setTransform(K, 0, 0, K, OX, OY); }
  function hudT() { ctx.setTransform(K, 0, 0, K, 0, 0); }
  function text(str, x, y, size, col, align, weight, stroke, font) {
    ctx.font = `${weight || 700} ${size}px ${font || FONT}`;
    ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle';
    if (stroke !== false) { ctx.lineWidth = Math.max(1.4, size * 0.24); ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineJoin = 'round'; ctx.strokeText(str, x, y); }
    ctx.fillStyle = col || '#fff'; ctx.fillText(str, x, y);
  }
  const powType = (k) => POW[k.fam][k.ti];

  // ---- fallback world (Canvas 2D)
  function drawWorld2D() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b3a6a'; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    base();
    const T = SP.ocean; if (T) { const ts = T.w, off = scrollY % ts; for (let y = -ts + off; y < H + 1; y += ts) for (let x = 0; x < W; x += ts) ctx.drawImage(T.c, x, y, ts + 0.5, ts + 0.5); }
    for (const i of islands) spr(SP.islands && SP.islands[i.v % SP.islands.length], i.x, i.y, i.f ? Math.PI : 0, 1, 1);
    base();
    for (const q of parts) { if (q.k !== 'foam' || !SP.foam) continue; const u = q.life / q.max, sz = q.s * (1.9 - u); ctx.globalAlpha = u * 0.75; ctx.drawImage(SP.foam.c, q.x - sz, q.y - sz, sz * 2, sz * 2); }
    ctx.globalAlpha = 1;
    for (const z of zones) { base(); ctx.globalAlpha = 0.5 * (1 - z.t / z.dur); ctx.fillStyle = '#ff6a1a'; ctx.beginPath(); ctx.ellipse(z.x, z.y, z.w / 2, z.h / 2, 0, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; }
    const playing = state === 'play' || state === 'gameover';
    if (playing) for (const h of hulks) if (h.kind === 'ship') drawHulk2D(h);
    for (const c of clouds) if (!c.high) { ctx.globalAlpha = c.a; spr(SP.clouds && SP.clouds[c.v % SP.clouds.length], c.x, c.y, 0, c.f ? -c.s : c.s, c.s); }
    ctx.globalAlpha = 1;
    if (playing) {
      for (const h of hulks) if (h.kind === 'air') drawHulk2D(h);
      for (const k of pickups) spr(SP.pow && SP.pow[powType(k)], k.x, k.y, Math.sin(k.t * 2) * 0.15, 1);
      for (const e of enemies) if (e.t >= 0) { spr(SP[e.spr], e.x, e.y, e.ang); if (e.flash > 0) { ctx.globalAlpha = 0.6; spr(SP[e.spr + '_w'], e.x, e.y, e.ang); ctx.globalAlpha = 1; } }
      for (const w of wing) { ctx.globalAlpha = w.dead ? Math.max(0, 1 - w.deadT / 2.5) : 1; spr(SP.player, w.x, w.y, w.dead ? w.deadT * 2 : 0, 0.75 * (1 - Math.abs(w.bank) * 0.2), 0.75); ctx.globalAlpha = 1; }
      const p = player;
      if (p && !p.dead && !(p.inv > 0 && p.loopT <= 0 && ((time * 18) | 0) % 2 === 0)) {
        let sx = 1 - Math.abs(p.bank) * 0.2, sy = 1, sc = 1;
        if (p.loopT > 0) { const u = 1 - p.loopT / LOOP_TIME; sy = Math.cos(u * TAU); sc = 1 + Math.sin(u * Math.PI) * 0.45; }
        spr(SP.player, p.x, p.y, 0, sx * sc * HERO, sy * sc * HERO);
      }
      for (const b of pb) {
        if (b.kind === 'bomb') { spr(SP.bomb, b.x, b.y, 0, 1 - 0.4 * (1 - b.life / b.max)); continue; }
        if (b.kind === 'torp') { base(); ctx.fillStyle = 'rgba(220,240,255,0.8)'; ctx.fillRect(b.x - 0.7, b.y - 4, 1.4, 8); continue; }
        spr(b.kind === 'laser' ? SP.laser : b.kind === 'pellet' ? SP.pellet : SP.pbullet, b.x, b.y, Math.atan2(b.vy, b.vx) + Math.PI / 2);
      }
      base(); const s = SP.ebullet; if (s) for (const b of eb) ctx.drawImage(s.c, b.x - 8.8, b.y - 8.8, 17.6, 17.6);
    }
    for (const w of warns) { if (w.friendly) continue; base(); const u = w.t / w.dur; ctx.strokeStyle = `rgba(255,60,40,${0.4 + 0.5 * u})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(w.x, w.y, w.r * (1.4 - 0.4 * u), 0, TAU); ctx.stroke(); }
    for (const q of parts) {
      if (q.k === 'smoke' || q.k === 'blacksmoke') { const u = q.life / q.max, sz = q.s * (1.7 - u * 0.8); ctx.globalAlpha = Math.min(1, u * 1.4) * 0.6; sprSize(SP.smoke, q.x, q.y, sz, sz); }
      else if (q.k === 'splash') { const u = q.life / q.max; if (u <= 1) { ctx.globalAlpha = Math.min(1, u * 1.6) * 0.55; sprSize(SP.splash, q.x, q.y, q.s, q.s, q.rot); } }
    }
    for (const f of fx) { if (f.t < 0) continue; const u = f.t / f.dur, sz = f.s * (0.7 + Math.sqrt(u) * 1.25); ctx.globalAlpha = u < 0.6 ? 1 : Math.max(0, 1 - (u - 0.6) / 0.4); sprSize(SP.fireball, f.x, f.y, sz * 1.6, sz * 1.6, f.rot + f.spin * u); }
    for (const nk of nukes) { if (nk.t < 0) continue; const g = Math.min(1, nk.t / 0.3); ctx.globalAlpha = Math.max(0, 1 - nk.t / 3); sprSize(SP.nukeImg, nk.x, nk.y, nk.R * 2 * g, nk.R * 2 * g, nk.rot); if (nk.t < 0.7) { base(); ctx.globalAlpha = 1 - nk.t / 0.7; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(nk.x, nk.y, nk.R * (0.3 + nk.t), 0, TAU); ctx.stroke(); } }
    ctx.globalAlpha = 1;
    for (const c of clouds) if (c.high) { ctx.globalAlpha = c.a; spr(SP.clouds && SP.clouds[c.v % SP.clouds.length], c.x, c.y, 0, c.f ? -c.s : c.s, c.s); }
    ctx.globalAlpha = 1;
  }
  function drawHulk2D(h) {
    const S2 = SP[h.spr] || (h.pt ? SP.destroyer : null);
    const sc = h.pt ? 0.45 : 1;
    ctx.globalAlpha = h.dead ? Math.max(0, 1 - h.deadT / 4) : 1;
    spr(S2, h.x, h.y, h.list * 0.5 + (h.spin || 0) * 0.2, sc);
    if (h.flash > 0) { ctx.globalAlpha = 0.35; spr(SP[h.spr + '_w'], h.x, h.y, 0, sc); }
    ctx.globalAlpha = 1;
    if (h.dead) return;
    for (const t of h.turrets) {
      if (t.dead || t.kind === 'engine' || t.kind === 'elevator' || t.kind === 'bridge') continue;
      spr(t.big ? SP.turretBig : SP.turretSmall, h.x + t.ox, h.y + t.oy, t.ang);
    }
  }

  // ---- HUD
  function plate(x, y, w, h, r) {
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
    const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, 'rgba(58,64,70,0.85)'); g.addColorStop(1, 'rgba(22,26,30,0.85)');
    ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = 'rgba(214,180,100,0.55)'; ctx.lineWidth = 0.5; ctx.stroke();
  }
  function icon(kind, r, on) {
    const [x, y, w, h] = r;
    plate(x, y, w, h, 2);
    ctx.fillStyle = '#efe6cf'; ctx.strokeStyle = '#efe6cf';
    const cx = x + w / 2, cy = y + h / 2;
    // the marks below are drawn for the 13-wide plate these used to be; scale the whole face
    // about its centre instead of respacing every line of them
    const k = w / 13;
    ctx.save(); ctx.translate(cx, cy); ctx.scale(k, k); ctx.translate(-cx, -cy);
    if (kind === 'pause') {
      if (on) { ctx.beginPath(); ctx.moveTo(cx - 2, cy - 3); ctx.lineTo(cx + 3, cy); ctx.lineTo(cx - 2, cy + 3); ctx.closePath(); ctx.fill(); }
      else { ctx.fillRect(cx - 2.6, cy - 3, 1.8, 6); ctx.fillRect(cx + 0.8, cy - 3, 1.8, 6); }
    } else if (kind === 'mute') {
      ctx.beginPath(); ctx.moveTo(cx - 4, cy - 1.4); ctx.lineTo(cx - 2.4, cy - 1.4); ctx.lineTo(cx, cy - 3.4); ctx.lineTo(cx, cy + 3.4); ctx.lineTo(cx - 2.4, cy + 1.4); ctx.lineTo(cx - 4, cy + 1.4); ctx.closePath(); ctx.fill();
      ctx.lineWidth = 0.8;
      if (on) { ctx.strokeStyle = '#ff7a6a'; ctx.beginPath(); ctx.moveTo(cx + 1.4, cy - 2); ctx.lineTo(cx + 4.4, cy + 2); ctx.moveTo(cx + 4.4, cy - 2); ctx.lineTo(cx + 1.4, cy + 2); ctx.stroke(); }
      else { ctx.beginPath(); ctx.arc(cx + 0.5, cy, 2.2, -0.9, 0.9); ctx.stroke(); ctx.beginPath(); ctx.arc(cx + 0.5, cy, 3.8, -0.9, 0.9); ctx.stroke(); }
    } else if (kind === 'music') {
      ctx.lineWidth = 0.8; ctx.beginPath(); ctx.ellipse(cx - 2, cy + 2.4, 1.5, 1.1, -0.4, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.ellipse(cx + 2.4, cy + 1.6, 1.5, 1.1, -0.4, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx - 0.6, cy + 2.4); ctx.lineTo(cx - 0.6, cy - 3); ctx.lineTo(cx + 3.8, cy - 3.8); ctx.lineTo(cx + 3.8, cy + 1.6); ctx.stroke();
      if (on) { ctx.strokeStyle = '#ff7a6a'; ctx.beginPath(); ctx.moveTo(cx - 4, cy - 4); ctx.lineTo(cx + 4.5, cy + 4); ctx.stroke(); }
    } else if (kind === 'fs') {
      ctx.lineWidth = 0.9; ctx.beginPath();
      for (const [sx2, sy2] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { ctx.moveTo(cx + sx2 * 3.6, cy + sy2 * 1.4); ctx.lineTo(cx + sx2 * 3.6, cy + sy2 * 3.2); ctx.lineTo(cx + sx2 * 1.6, cy + sy2 * 3.2); }
      ctx.stroke();
    }
    ctx.restore();
  }
  function drawButtons() {
    hudT();
    icon('mute', BTN.mute, A.muted);
    icon('music', BTN.music, A.musicOff);
    if (state === 'play') icon('pause', BTN.pause, paused);
    if (G.fsSupported && !G.touchMode) icon('fs', BTN.fs, false);
  }
  function bar(x, y, w, h, frac, col, flashOn) {
    ctx.fillStyle = '#05070a'; ctx.fillRect(x - 0.8, y - 0.8, w + 1.6, h + 1.6);
    ctx.strokeStyle = 'rgba(217,184,96,0.6)'; ctx.lineWidth = 0.5; ctx.strokeRect(x - 0.8, y - 0.8, w + 1.6, h + 1.6);
    const c = flashOn ? '#ff3b30' : col;
    ctx.fillStyle = c; ctx.fillRect(x, y, w * clamp(frac, 0, 1), h);
    const eg = ctx.createLinearGradient(0, y, 0, y + h); eg.addColorStop(0, 'rgba(255,255,255,0.3)'); eg.addColorStop(0.45, 'rgba(255,255,255,0)'); eg.addColorStop(1, 'rgba(0,0,0,0.4)');
    ctx.fillStyle = eg; ctx.fillRect(x, y, w * clamp(frac, 0, 1), h);
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; for (let i = 1; i < 10; i++) ctx.fillRect(x + w * i / 10, y, 0.4, h);
  }
  function drawHUD() {
    hudT();
    const g = ctx.createLinearGradient(0, 0, 0, HUD_H);
    g.addColorStop(0, 'rgba(14,17,20,0.9)'); g.addColorStop(1, 'rgba(26,30,34,0.74)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, HUD_H);
    ctx.fillStyle = 'rgba(217,184,96,0.55)'; ctx.fillRect(0, HUD_H - 0.7, W, 0.7);
    // Three rows of eight things was a cockpit, not a readout. What is left is what you can act
    // on while you are being shot at: how much score you have, how much aeroplane you have, and
    // what is under your thumb. The hi-score belongs to the title and the game-over screens, and
    // Merit is spent in the hangar, where it is shown in letters you can read.
    text(String(score).padStart(7, '0'), 3, 10.5, 13, PAPER, 'left', 700, false, MONO);
    const L = curLevel();
    text(L ? L.short || L.name : 'STAGE ' + stage, W - 92, 10.5, 7.6, BRASS, 'right', 800, false);
    const p = player; if (!p) return;
    const af = p.armor / ST.armorMax;
    const lowA = af < 0.2 && ((time * 4) | 0) % 2 === 1;
    text('ARMOR', 3, 27.5, 8, lowA ? '#ff5a4a' : BRASS, 'left', 800, false);
    bar(33, 23, 168, 9, af, af > 0.7 ? '#7fcf5a' : af > 0.45 ? '#c7d24a' : af > 0.2 ? '#e8902a' : '#e2482f', lowA);
    text(String(Math.ceil(p.armor)), 205, 27.8, 9, PAPER, 'left', 700, false, MONO);
    // wingmen ride on the armor row now that it is the only bar up here
    let wx = 226;
    for (const w of wing) { text('W' + (w.slot + 1), wx, 27.8, 6.6, w.dead ? '#7a4a44' : '#9fd8ff', 'left', 800, false); if (!w.dead) bar(wx + 11, 24.2, 9, 6, w.armor / w.max, '#7fbcd8'); wx += 23; }
    // weapon modes
    const gm = p.mode === 'guns', gn = GUNS[run.gun.type], bm = BOMBS[run.bomb.type];
    const y = 39.5, ch = 12;
    ctx.fillStyle = gm ? 'rgba(255,224,102,0.22)' : 'rgba(255,255,255,0.05)'; ctx.fillRect(2, y - ch / 2, 120, ch);
    ctx.fillStyle = !gm ? 'rgba(255,176,74,0.22)' : 'rgba(255,255,255,0.05)'; ctx.fillRect(126, y - ch / 2, 142, ch);
    ctx.strokeStyle = gm ? '#ffe066' : '#ffb04a'; ctx.lineWidth = 0.7;
    if (gm) ctx.strokeRect(2, y - ch / 2, 120, ch); else ctx.strokeRect(126, y - ch / 2, 142, ch);
    text('GUNS', 5, y + 0.4, 7.4, gm ? '#ffe066' : '#8b8778', 'left', 800, false);
    text(gn.name + ' ' + 'I'.repeat(run.gun.lvl), 33, y + 0.4, 7.4, gm ? gn.col : '#8b8778', 'left', 800, false);
    text('BOMBS', 129, y + 0.4, 7.4, !gm ? '#ffb04a' : '#8b8778', 'left', 800, false);
    const bcd = bombCooldown(run.bomb.type, run.bomb.lvl);
    // A 30-second reload is too long to read off a bar, so a long one counts itself down.
    const bwait = p.bombCd > 0 && bcd > 4;
    text(bwait ? bm.name + ' ' + Math.ceil(p.bombCd) + 's' : bm.name + ' ' + 'I'.repeat(run.bomb.lvl), 166, y + 0.4, 7.4, bwait ? '#8b8778' : !gm ? bm.col : '#8b8778', 'left', 800, false);
    if (p.bombCd > 0) { ctx.fillStyle = gm ? 'rgba(255,176,74,0.35)' : 'rgba(255,176,74,0.7)'; ctx.fillRect(126, y + ch / 2 - 1.2, 142 * (1 - clamp(p.bombCd / bcd, 0, 1)), 1.2); }
    if (boss && !boss.dead && phase === 'boss') {
      const w2 = W - 80, f = boss.hp / boss.maxhp;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(39, HUD_H + 3, w2 + 2, 5);
      ctx.fillStyle = boss.bphase === 3 ? '#ff4a2a' : '#c8352b'; ctx.fillRect(40, HUD_H + 4, w2 * f, 3);
      ctx.fillStyle = '#f1ead6'; ctx.fillRect(40 + w2 * 0.33, HUD_H + 3, 0.7, 5); ctx.fillRect(40 + w2 * 0.66, HUD_H + 3, 0.7, 5);
      text('P' + boss.bphase, 36, HUD_H + 5.6, 5.2, '#ff9c8a', 'right', 800, true);
    }
  }
  // `fill` is a 0..1 level that floods the face with brass from the bottom up - a reload you can
  // watch rather than a number you have to read.
  function roundBtn(x, y, r, ok, label, glyph, fill) {
    ctx.globalAlpha = ok ? 0.85 : 0.4;
    ctx.fillStyle = 'rgba(20,24,28,0.55)'; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    if (fill > 0) {
      ctx.save(); ctx.clip();
      ctx.fillStyle = 'rgba(217,184,96,' + (0.22 + 0.5 * fill).toFixed(3) + ')';
      ctx.fillRect(x - r, y + r - 2 * r * fill, r * 2, 2 * r * fill);
      ctx.restore();
    }
    ctx.strokeStyle = 'rgba(217,184,96,0.85)'; ctx.lineWidth = r / 13; ctx.stroke();
    // The glyphs are drawn for a 13-unit button, so scale the whole face about its centre rather
    // than rewriting every arc and rectangle in it - resize the button and the mark follows.
    const k = r / 13;
    ctx.save(); ctx.translate(x, y); ctx.scale(k, k); ctx.translate(-x, -y);
    glyph();
    ctx.restore();
    text(label, x, y + 7 * k, 4.4 * k, PAPER, 'center', 800, false);
    ctx.globalAlpha = 1;
  }
  function drawTouchButtons() {
    if (!G.touchMode || state !== 'play' || paused || phase === 'briefing') return;
    hudT();
    const p = player;
    let [x, y, r] = loopBtn();
    roundBtn(x, y, r, p && !p.dead && p.loopT <= 0 && p.loopCd <= 0, 'LOOP', () => {
      ctx.strokeStyle = PAPER; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, y - 2, 4.8, -Math.PI * 0.15, Math.PI * 1.45); ctx.stroke();
      const a = Math.PI * 1.45, ax = x + Math.cos(a) * 4.8, ay = y - 2 + Math.sin(a) * 4.8;
      ctx.fillStyle = PAPER; ctx.beginPath(); ctx.moveTo(ax + 2.4, ay - 0.6); ctx.lineTo(ax - 0.4, ay - 2.4); ctx.lineTo(ax - 0.6, ay + 1.5); ctx.closePath(); ctx.fill();
    });
    [x, y, r] = modeBtn();
    const gm = p && p.mode === 'guns';
    const bcd = p ? bombCooldown(run.bomb.type, run.bomb.lvl) : 1;
    const reloading = p && !gm && p.bombCd > 0;
    roundBtn(x, y, r, true, reloading ? 'RELOAD' : gm ? 'GUNS' : 'BOMBS', () => {
      ctx.fillStyle = gm ? '#ffe066' : '#ffb04a';
      if (gm) { for (const dx of [-2.4, 0, 2.4]) ctx.fillRect(x + dx - 0.6, y - 6, 1.2, 6); }
      else { ctx.beginPath(); ctx.ellipse(x, y - 2.5, 2.4, 4, 0, 0, TAU); ctx.fill(); ctx.fillRect(x - 2.6, y + 0.6, 5.2, 1); }
    }, reloading ? 1 - clamp(p.bombCd / bcd, 0, 1) : 0);
  }
  function dim(a) { hudT(); ctx.fillStyle = `rgba(4,8,14,${a})`; ctx.fillRect(0, 0, W, H); }
  function blink(rate) { return ((time * (rate || 2.2)) | 0) % 2 === 0; }
  function menuBtn(r, label, hot) {
    const [x, y, w, h] = r; plate(x, y, w, h, 3);
    if (hot) { ctx.strokeStyle = 'rgba(245,215,122,0.9)'; ctx.lineWidth = 0.9; ctx.stroke(); }
    text(label, x + w / 2, y + h / 2 + 0.4, Math.min(10.5, h * 0.52), hot ? '#f5d77a' : PAPER, 'center', 800, false);
  }

  // USAAF national insignia (the "star and bar", adopted 28 June 1943): white star on an
  // Insignia Blue disc with a white bar each side. This is the aircraft marking the P-38 wore.
  // The name is what the Luftwaffe called a P-38: der Gabelschwanz-Teufel, the fork-tailed devil.
  // So the mark is the joke in one shape - a devil's tail sweeping up into a barb, and the barb is
  // a twin-boom empennage, two fins with the tailplane across them. Drawn rather than stored, so it
  // is sharp at any size and costs nothing to ship.
  const TAIL_C = [[14, 97], [38, 86], [26, 62], [54, 32]];
  function devilMark(cx, cy, r, col, alpha) {
    const S = r / 50, P = (x, y) => [cx + (x - 50) * S, cy + (y - 50) * S];
    const bez = (t) => { const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
      return [a * TAIL_C[0][0] + b * TAIL_C[1][0] + c * TAIL_C[2][0] + d * TAIL_C[3][0],
              a * TAIL_C[0][1] + b * TAIL_C[1][1] + c * TAIL_C[2][1] + d * TAIL_C[3][1]]; };
    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.fillStyle = col || '#e6c36e';
    // the tail: the centreline offset either side by a width that tapers to the barb
    const wid = (t) => 12 * (1 - t) * (1 - t) + 3.4 * (1 - t) + 2.4;
    const Lp = [], Rp = [];
    for (let i = 0; i <= 44; i++) {
      const t = i / 44, pt = bez(t), p2 = bez(Math.min(1, t + 0.01)), p0 = bez(Math.max(0, t - 0.01));
      let dx = p2[0] - p0[0], dy = p2[1] - p0[1];
      const m = Math.hypot(dx, dy) || 1; dx /= m; dy /= m;
      const w = wid(t) / 2;
      Lp.push(P(pt[0] - dy * w, pt[1] + dx * w)); Rp.push(P(pt[0] + dy * w, pt[1] - dx * w));
    }
    ctx.beginPath(); ctx.moveTo(Lp[0][0], Lp[0][1]);
    for (const q of Lp) ctx.lineTo(q[0], q[1]);
    for (let i = Rp.length - 1; i >= 0; i--) ctx.lineTo(Rp[i][0], Rp[i][1]);
    ctx.closePath(); ctx.fill();
    // the barb, in a frame aligned to where the tail is pointing so it reads as attached
    const tip = bez(1), prev = bez(0.96);
    const ang = Math.atan2(tip[1] - prev[1], tip[0] - prev[0]);
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const Q = (u, v) => P(tip[0] + u * ca - v * sa, tip[1] + u * sa + v * ca);
    const poly = (pts) => { ctx.beginPath(); const a0 = Q(pts[0][0], pts[0][1]); ctx.moveTo(a0[0], a0[1]);
      for (let i = 1; i < pts.length; i++) { const a = Q(pts[i][0], pts[i][1]); ctx.lineTo(a[0], a[1]); }
      ctx.closePath(); ctx.fill(); };
    const SL = 32, A = 0.58, ex = Math.cos(A) * SL, ey = Math.sin(A) * SL;
    const fin = (s) => poly([[-2, s * 3.2], [ex * 0.46, s * (ey * 0.46 + 3.8)], [ex, s * ey],
                             [ex * 0.72, s * (ey * 0.72 - 2.2)], [1, s * 0.2]]);
    fin(1); fin(-1);
    const bx = ex * 0.47, by = ey * 0.47;
    poly([[bx - 2.2, -by - 1.1], [bx + 2.2, -by - 1.1], [bx + 2.2, by + 1.1], [bx - 2.2, by + 1.1]]);
    ctx.restore();
  }
  G.devilMark = devilMark;

  function roundel(cx, cy, r, alpha) {
    const BLUE = '#12325e', WHITE = '#f2f0e6', EDGE = '#0a1b36';
    const barH = r * 0.74, barL = r * 1.18, barX = r * 0.86;
    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    const body = () => {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.rect(cx - barX - barL, cy - barH / 2, barL + barX, barH);
      ctx.rect(cx + barX, cy - barH / 2, barL, barH);
    };
    ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = r * 0.5; ctx.shadowOffsetY = r * 0.14;
    ctx.fillStyle = BLUE; body(); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = WHITE;
    ctx.fillRect(cx - barX - barL, cy - barH / 2, barL + barX, barH);
    ctx.fillRect(cx + barX, cy - barH / 2, barL, barH);
    ctx.fillStyle = BLUE; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
    // five-pointed star, one point up
    ctx.fillStyle = WHITE; ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 ? r * 0.37 : r * 0.92, a = -Math.PI / 2 + i * Math.PI / 5;
      ctx[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = EDGE; ctx.lineWidth = Math.max(0.6, r * 0.09); ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
    ctx.strokeRect(cx - barX - barL, cy - barH / 2, barL + barX, barH);
    ctx.strokeRect(cx + barX, cy - barH / 2, barL, barH);
    ctx.restore();
  }

  // The wordmark is a painted asset now. It is still drawn through the game's own units so it
  // lands in the same place at every size, and the typeset version stays as the fallback for the
  // moment before the art has loaded - or if it never does.
  function wordmark(top) {
    const lg = SP && SP.logo;
    if (lg && lg.c) {
      const w = Math.min(W - 16, 252), h = w * (lg.h / lg.w);
      ctx.drawImage(lg.c, W / 2 - w / 2, top, w, h);
      return top + h;
    }
    devilMark(W / 2, top + 10, 20);
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let tsz = 60; const TW = 'FORK-TAILED', tmax = W - 36;
    do { ctx.font = 'italic 900 ' + tsz + 'px "Arial Black", "Helvetica Neue", Arial, sans-serif'; tsz -= 1; }
    while (tsz > 12 && ctx.measureText(TW).width > tmax);
    const cy = top + 50;
    ctx.lineWidth = 5; ctx.strokeStyle = '#1a1206'; ctx.lineJoin = 'round'; ctx.strokeText(TW, W / 2, cy);
    ctx.fillStyle = '#d9b860'; ctx.fillText(TW, W / 2, cy);
    ctx.restore();
    text('D E V I L', W / 2, cy + 20, 12, PAPER, 'center', 800, false);
    return cy + 30;
  }
  function drawTitle() {
    hudT();
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(3,8,16,0.78)'); g.addColorStop(0.45, 'rgba(3,8,16,0.15)'); g.addColorStop(1, 'rgba(3,8,16,0.78)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const cy = wordmark(Math.max(40, H * 0.1));
    text('P-38 LIGHTNING  -  1941-1945 CAMPAIGN', W / 2, cy + 9, 7, '#cfd6e0', 'center', 700, true);
    { // flight model + test mode, made obvious: these were too small to find before
      const bw = 184, bx = W / 2 - bw / 2, by0 = cy + 26, bh = 26;
      TITLE_BTN.mode = [bx, by0, bw, bh];
      modeSwitch(bx, by0, bw, bh);
      text('VIEW - TAP TO SWITCH', W / 2, by0 - 6, 6, '#8d94a2', 'center', 700, true);
      text(mode3d ? 'CHASE CAMERA - SAME CONTROLS' : 'CLASSIC TOP-DOWN', W / 2, by0 + bh + 9, 6, '#cfd6e0', 'center', 700, true);
      // test mode
      const tw = 184, tx = W / 2 - tw / 2, ty0 = by0 + bh + 18, th = 18;
      TITLE_BTN.test = [tx, ty0, tw, th];
      const on = G.testUnlock && G.testUnlock();
      ctx.fillStyle = on ? 'rgba(120,200,120,0.22)' : 'rgba(8,12,18,0.6)';
      ctx.fillRect(tx, ty0, tw, th);
      ctx.strokeStyle = on ? 'rgba(140,220,140,0.7)' : 'rgba(150,150,170,0.4)'; ctx.lineWidth = 0.7; ctx.strokeRect(tx, ty0, tw, th);
      text(on ? 'TEST MODE ON - ALL TECH UNLOCKED' : 'TEST MODE OFF - NORMAL PROGRESSION', W / 2, ty0 + th / 2 + 0.4, 6.4, on ? '#aef0ae' : '#9aa0b0', 'center', 800, true);
    }
    const by = Math.max(cy + 118, H * 0.5);
    const save = G.hasSave();
    TITLE_BTN.cont = save ? [W / 2 - 88, by, 176, 26] : null;
    TITLE_BTN.neu = [W / 2 - 88, by + (save ? 31 : 0), 176, 26];
    TITLE_BTN.dossier = [W / 2 - 88, by + (save ? 62 : 31), 86, 22];
    TITLE_BTN.save = [W / 2 + 2, by + (save ? 62 : 31), 86, 22];
    if (save) menuBtn(TITLE_BTN.cont, 'CONTINUE  -  HANGAR', blink(1.6));
    menuBtn(TITLE_BTN.neu, 'NEW CAMPAIGN', !save && blink(1.6));
    menuBtn(TITLE_BTN.dossier, 'DOSSIER', false); menuBtn(TITLE_BTN.save, 'SAVE / LOAD', false);
    const ty = by + (save ? 96 : 65);
    text('HI-SCORE  ' + String(hiscore).padStart(7, '0'), W / 2, ty, 8.5, PAPER, 'center', 700, true);
    const lines = G.touchMode
      ? ['DRAG TO FLY - FIRE IS AUTOMATIC WHILE TOUCHING', 'MODE BUTTON: GUNS <-> BOMBS   LOOP: EVADE', 'ARM IN THE HANGAR  -  WATCH YOUR ARMOR']
      : ['ARROWS/WASD MOVE   SPACE/Z FIRE   Q/TAB GUNS<->BOMBS', 'X/SHIFT LOOP   P PAUSE   M SOUND   B MUSIC   F FULLSCREEN', 'ARM IN THE HANGAR  -  WATCH YOUR ARMOR'];
    const ly = Math.min(H - 40, ty + 26);
    lines.forEach((l, i) => text(l, W / 2, ly + i * 10.5, 6.2, i === 2 ? '#f3b49a' : '#d8dde6', 'center', 700, true));
    text('ORIGINAL FAN TRIBUTE - NOT AFFILIATED WITH CAPCOM', W / 2, H - 8, 5, 'rgba(210,214,224,0.6)', 'center', 600, false);
  }
  function drawLoading() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const c = ctx.canvas;
    const g = ctx.createLinearGradient(0, 0, 0, c.height); g.addColorStop(0, '#07131f'); g.addColorStop(1, '#0b2f52');
    ctx.fillStyle = g; ctx.fillRect(0, 0, c.width, c.height);
    hudT();
    const under = wordmark(H * 0.3);
    const bw = 190, bx = (W - bw) / 2, by = under + 18;
    ctx.fillStyle = '#05080c'; ctx.fillRect(bx - 1.2, by - 1.2, bw + 2.4, 9.4);
    ctx.strokeStyle = 'rgba(217,184,96,0.7)'; ctx.lineWidth = 0.7; ctx.strokeRect(bx - 1.2, by - 1.2, bw + 2.4, 9.4);
    ctx.fillStyle = '#d9b860'; ctx.fillRect(bx, by, bw * loadP, 7);
    text('LOADING ' + Math.round(loadP * 100) + '%', W / 2, by + 20, 8, '#c9c2ad', 'center', 700, false);
  }
  function drawBanners() {
    hudT();
    const p = player, L = curLevel();
    if (phase === 'intro') {
      const a = Math.max(0, Math.min(1, phaseT * 3, (2.3 - phaseT) * 3));
      ctx.globalAlpha = a;
      text(L ? L.name.toUpperCase() : 'STAGE ' + stage, W / 2, H * 0.36, 15, '#f5d77a', 'center', 800);
      text(L ? L.date + '  -  ' + L.loc : STAGE_NAMES[(stage - 1) % STAGE_NAMES.length], W / 2, H * 0.36 + 17, 7.5, '#dfe7f2', 'center', 700);
      ctx.globalAlpha = 1;
    } else if (phase === 'warning') {
      if (blink(4)) { ctx.fillStyle = 'rgba(160,0,0,0.28)'; ctx.fillRect(0, H * 0.36, W, 40); text('WARNING', W / 2, H * 0.36 + 14, 20, '#ff4a3a', 'center', 800); }
      const bt = bossTypeFor(stage);
      text(L && L.bossName ? L.bossName.toUpperCase() + ' APPROACHING' : bt === 'bossBomber' ? 'HEAVY BOMBER APPROACHING' : bt === 'carrier' ? 'ENEMY CARRIER APPROACHING' : 'ENEMY BATTLESHIP APPROACHING', W / 2, H * 0.36 + 32, 7, '#ffd8d0', 'center', 700);
    } else if (phase === 'clear' && phaseT > 1.4) {
      text('MISSION COMPLETE', W / 2, H * 0.36, 16, '#f5d77a', 'center', 800);
      text('ARMOR BONUS  ' + clearBonus, W / 2, H * 0.36 + 20, 9, PAPER, 'center', 700);
      text('MERIT  ' + (run ? run.merit : 0) + '  -  TO THE HANGAR', W / 2, H * 0.36 + 34, 8, '#9fe07a', 'center', 700);
    }
    if (p && !p.dead && p.armor < ST.armorMax * 0.2 && blink(3)) text('HEAVY DAMAGE!', W / 2, H - 52, 11, '#ff7a4a', 'center', 800);
  }
  function drawPopups() {
    hudT();
    for (const q of popups) { ctx.globalAlpha = Math.min(1, (0.9 - q.t) * 3); text(q.txt, q.x + OX / K, q.y + OY / K, q.s, q.col, 'center', 800); }
    ctx.globalAlpha = 1;
  }
  function drawPause() {
    dim(0.55);
    text('PAUSED', W / 2, H * 0.36, 20, PAPER, 'center', 800);
    text(G.touchMode ? 'TAP OUTSIDE TO RESUME' : 'P / ESC OR CLICK TO RESUME', W / 2, H * 0.36 + 20, 7, '#cfd6e0', 'center', 700);
    const bw = 150, bx = W / 2 - bw / 2, by = H * 0.36 + 36, bh = 20;
    PAUSE_BTN.mode = [bx, by, bw, bh];
    modeSwitch(bx, by, bw, bh);
    text('VIEW', W / 2, by - 5, 5, '#8d94a2', 'center', 700, true);
    text(mode3d ? 'CHASE CAMERA - SAME CONTROLS' : 'CLASSIC TOP-DOWN', W / 2, by + bh + 7, 5, '#cfd6e0', 'center', 700, true);
    const armed = G.abortArmed(), aw = 150, ax = W / 2 - aw / 2, ay = by + bh + 20, ah = 20;
    PAUSE_BTN.abort = [ax, ay, aw, ah];
    plate(ax, ay, aw, ah, 3);
    if (armed) { ctx.strokeStyle = 'rgba(226,72,47,0.9)'; ctx.lineWidth = 0.9; ctx.stroke(); }
    text(armed ? 'TAP AGAIN TO ABORT' : 'ABORT  -  BACK TO HANGAR', W / 2, ay + ah / 2 + 0.4, 6.6, armed ? '#ff9c86' : PAPER, 'center', 800, true);
    text('THE MISSION STARTS OVER', W / 2, ay + ah + 7, 5, '#8d94a2', 'center', 700, true);
  }
  // the 2D/3D switch: drawn identically on the title and the pause screen
  function modeSwitch(bx, by, bw, bh) {
    const half = bw / 2;
    ctx.fillStyle = 'rgba(8,12,18,0.78)'; ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = 'rgba(217,184,96,0.75)'; ctx.lineWidth = 0.8; ctx.strokeRect(bx, by, bw, bh);
    ctx.fillStyle = mode3d ? 'rgba(217,184,96,0.16)' : '#d9b860';
    ctx.fillRect(bx + 1.5, by + 1.5, half - 2, bh - 3);
    ctx.fillStyle = mode3d ? '#d9b860' : 'rgba(217,184,96,0.16)';
    ctx.fillRect(bx + half + 0.5, by + 1.5, half - 2, bh - 3);
    text('2D', bx + half / 2, by + bh / 2 + 0.4, 8.5, mode3d ? '#cfd6e0' : '#1a1206', 'center', 900, false);
    text('3D', bx + half + half / 2, by + bh / 2 + 0.4, 8.5, mode3d ? '#1a1206' : '#cfd6e0', 'center', 900, false);
  }
  function drawGameOver() {
    dim(Math.min(0.6, stateT));
    text('SHOT DOWN', W / 2, H * 0.36, 22, '#e2482f', 'center', 800);
    text('SCORE  ' + score, W / 2, H * 0.36 + 26, 9, PAPER, 'center', 700);
    if (newRecord) { if (blink(3)) text('NEW HIGH SCORE!', W / 2, H * 0.36 + 42, 9, '#f5d77a', 'center', 800); }
    else text('HI-SCORE  ' + hiscore, W / 2, H * 0.36 + 42, 7.5, BRASS, 'center', 700);
    text('THE CAMPAIGN IS OVER - THE DOSSIER IS KEPT', W / 2, H * 0.36 + 56, 6, '#cfd6e0', 'center', 700);
    if (stateT > 1.0 && blink(1.8)) text(G.touchMode ? 'TAP TO CONTINUE' : 'PRESS ENTER OR TAP', W / 2, H * 0.36 + 76, 8.5, '#f5d77a', 'center', 800);
  }

  G.setLoadProgress = (p) => { loadP = p; };
  G.ready = () => { if (state === 'loading') { state = 'title'; stateT = 0; seedScenery(); hook('title'); } };
  G.render = function () {
    if (!ctx) return;
    if (state === 'loading' || !SP.player) { drawLoading(); ctx.setTransform(1, 0, 0, 1, 0, 0); return; }
    OX = shake > 0 ? rand(-shake, shake) * K * 0.5 : 0; OY = shake > 0 ? rand(-shake, shake) * K * 0.5 : 0;
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    if (G.r3d && G.r3d.ok) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height); }
    else drawWorld2D();
    const playing = state === 'play' || state === 'gameover';
    if (flashT > 0) { hudT(); ctx.fillStyle = `rgba(255,250,235,${Math.min(0.85, flashT / 0.4 * 0.8).toFixed(3)})`; ctx.fillRect(0, 0, W, H); }
    if (playing) { drawPopups(); drawBanners(); drawHUD(); drawTouchButtons(); }
    if (state === 'title') drawTitle();
    if (state === 'gameover') drawGameOver();
    if (paused) drawPause();
    if (state !== 'hangar' && state !== 'map') drawButtons();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  };

  // world snapshot for the 3D renderer (no allocation: same object every frame)
  const WORLD = { W, SCROLL, player: null, wing, enemies, hulks, pb, eb, pickups, parts, fx, nukes, islands, clouds, warns, zones, scrollY: 0, shake: 0, flashT: 0, time: 0, state: '', phase: '', H: 480, stage: 1, level: null, boss: null, paused: false, powType, LOOP_TIME };
  G.world = function () {
    WORLD.player = player; WORLD.scrollY = scrollY; WORLD.shake = shake; WORLD.flashT = flashT; WORLD.time = time; WORLD.state = state; WORLD.phase = phase; WORLD.H = H; WORLD.stage = stage; WORLD.level = curLevel(); WORLD.boss = boss; WORLD.paused = paused; WORLD.run = run;
    return WORLD;
  };

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
