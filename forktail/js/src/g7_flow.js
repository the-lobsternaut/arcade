
  // ---------------------------------------------------------------- update
  G.update = function (dt) {
    time += dt; stateT += dt;
    if (paused || state === 'loading' || state === 'hangar' || state === 'map') { if (state === 'hangar' || state === 'map') updateScenery(dt * 0.3); return; }
    if (phase === 'briefing') { briefWait += dt; if (briefWait > 40) G.briefDone(); dt *= 0.0; }
    if (hold) dt = 0;   // a transmission is up: the war waits
    updateScenery(dt);
    if (shake > 0) shake = Math.max(0, shake - dt * 18);
    if (state === 'play' || state === 'gameover') {
      if (state === 'play') {
        phaseT += dt; playT += dt; POWTRACK.t += dt; POWTRACK.since += dt;
        if (POWTRACK.since > 12.5 && player && !player.dead && (phase === 'stage' || phase === 'boss')) dropPow(rand(40, W - 40), HUD_H + 24); // supply drop
        if (phase === 'intro') { if (phaseT > 2.3) { phase = 'stage'; phaseT = 0; } }
        else if (phase === 'stage') {
          stageT += dt;
          while (evIdx < events.length && events[evIdx].t <= stageT) runEvent(events[evIdx++].ev);
          if (stageT >= stageLen && evIdx >= events.length) { phase = 'warning'; phaseT = 0; A.music(null); A.sfx('warning'); }
          chatterT -= dt; if (chatterT <= 0) { chatterT = rand(22, 34); radio('chatter'); }
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
  // Held for a transmission. Being shot at while someone is talking to you means you read none of
  // it, so the fighters go home, their rounds go with them, and nothing moves again until she has
  // finished. A boss stays - it is the level - but frozen, so the screen is safe to read either way.
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
  const BTN = { pause: [W - 30, 2, 13, 11], mute: [W - 15, 2, 13, 11], music: [W - 45, 2, 13, 11], fs: [W - 60, 2, 13, 11] };
  const TITLE_BTN = { cont: null, neu: null, dossier: null, save: null };
  const PAUSE_BTN = { mode: null };   // the same 2D/3D switch, reachable mid-mission
  function inRect(x, y, r, pad) { return r && x >= r[0] - pad && x <= r[0] + r[2] + pad && y >= r[1] - pad && y <= r[1] + r[3] + pad; }
  function loopBtn() { return [W - 22, H - 24, 13]; }
  function modeBtn() { return [W - 52, H - 24, 13]; }
  G.handleTap = function (x, y) {
    if (inRect(x, y, BTN.mute, 3)) { A.toggleMute(); return true; }
    if (inRect(x, y, BTN.music, 3)) { A.toggleMusic(); return true; }
    if (state === 'play' && inRect(x, y, BTN.pause, 3)) { G.togglePause(); return true; }
    if (state === 'play' && paused && inRect(x, y, PAUSE_BTN.mode, 3)) { G.setMode3d(x > (PAUSE_BTN.mode[0] + PAUSE_BTN.mode[2] / 2)); A.sfx('click'); return true; }
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
