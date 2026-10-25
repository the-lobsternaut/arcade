
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
  let gid = 1, scrollY = 0, shake = 0, flashT = 0, lastBlast = null, blastCount = 0, loadP = 0, nextIsland = 0, nextCloud = 0, nextHigh = 4, lowBeep = 0, powSpawned = 0, playT = 0, radioCd = {};
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
    const s = { speed: 155, gunDmg: 1, fireRate: 1, bombRadius: 1, bombReload: 1, armorMax: 100, dmgTaken: 1, fuelMax: 100, fuelDrain: 1, magnet: 0, loopCost: 5, loopCd: 0.6,
      powLuck: 1, regen: 0, fireSuppress: false, gunCap: 1, bombCap: 1, wingSlots: 0, wingArmor: 1, wingDmg: 1, nukeYield: 1, nukeReload: 1, quad: false, ebSpeed: 1 };
    if (has('a1')) s.armorMax += 25; if (has('a2')) s.armorMax += 25; if (has('a3')) s.dmgTaken *= 0.85; if (has('a4')) s.regen += 0.5; if (has('a5')) s.fireSuppress = true;
    if (has('g1')) s.gunCap = 2; if (has('g2')) s.gunCap = 3; if (has('g3')) s.fireRate *= 1.15; if (has('g4')) s.gunDmg *= 1.2; if (has('g5')) s.quad = true;
    if (has('b1')) s.bombCap = 2; if (has('b2')) s.bombCap = 3; if (has('b3')) s.bombReload *= 0.8; if (has('b4')) s.bombRadius *= 1.2; if (has('b5')) { s.nukeYield = 1.15; s.nukeReload = 0.8; }
    if (has('s1')) s.fuelMax += 30; if (has('s2')) s.fuelDrain *= 0.75; if (has('s3')) s.magnet = 38; if (has('s4')) { s.loopCost = 3; s.loopCd = 0.25; }
    if (has('s5')) s.wingSlots = 1; if (has('s6')) s.wingSlots = 2; if (has('s7')) s.wingArmor = 1.5;
    const cp = STORY().copilot ? STORY().copilot(run ? run.copilot : null) : null;
    if (cp && cp.mods) {
      const m = cp.mods;
      for (const k in m) {
        if (k === 'fireSuppress') s.fireSuppress = s.fireSuppress || m[k];
        else if (k === 'armorMax' || k === 'fuelMax' || k === 'magnet' || k === 'regen' || k === 'loopCost') s[k] += m[k];
        else if (k === 'loopCd') s.loopCd *= m[k];
        else s[k] *= m[k];
      }
    }
    s.armorMax = Math.round(s.armorMax); s.fuelMax = Math.round(s.fuelMax); s.loopCost = Math.max(2, s.loopCost);
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
    return { x: W / 2, y: H - 70, fuel: ST.fuelMax, armor: ST.armorMax, mode: 'guns', fireCd: 0, bombCd: 0, loopT: 0, loopCd: 0, inv: 1.2, dead: false, deadT: 0, bank: 0, side: 0, flash: 0, stall: 0, burnT: 0, hitT: 0, bombFlash: 0 };
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
  function merit(n) { if (run) run.merit += Math.round(n); }
  function popup(x, y, txt, col, s) { popups.push({ x, y, txt, t: 0, col: col || '#fff', s: s || 8 }); }
