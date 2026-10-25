/* Fork-Tailed Devil - game logic. Logical playfield: 270 wide, 420..585 tall (y down). Rendering: js/render3d.js (WebGL) with a Canvas-2D fallback here. */
window.SKY = window.SKY || {};
(function (S) {
  'use strict';
  const A = S.audio, SP = S.sprites;
  const W = 270, HUD_H = 36, SCROLL = 26, TAU = Math.PI * 2;
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
    fuel: ['fuel'], repair: ['repair'],
  };
  const POW_INFO = {
    spread: ['3W', 'Gun: 3-Way spread'], laser: ['L', 'Gun: piercing laser'], shotgun: ['S', 'Gun: shotgun, eats bullets'], auto: ['A', 'Gun: auto-fire, fast'], gunup: ['+', 'Gun level up'],
    cluster: ['C', 'Bomb: cluster bomblets'], napalm: ['F', 'Bomb: napalm fire carpet'], torpedo: ['T', 'Bomb: torpedo vs ships'], rapid: ['R', 'Bomb: rapid light bombs'], nuke: ['N', 'Bomb: N-bomb, 50x, 1/3 screen'],
    fuel: ['FUEL', 'Fuel refill'], repair: ['REP', 'Armor repair'],
  };
  // 50x base per-bullet damage (1), radius = 1/3 playfield width. Thirty seconds between shots: a
  // weapon that clears a third of the screen cannot also be your primary, so the reload is the
  // balance. Levels shave it down, they do not make it spammable.
  const NUKE = { dmg: 50, radius: W / 3, cd: 5, lvlCut: 0.1 };

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
    { id: 's1', br: 'SUPPORT', name: 'Drop Tanks', cost: 200, req: [], desc: '+30 max fuel.' },
    { id: 's2', br: 'SUPPORT', name: 'Lean Mixture', cost: 300, req: ['s1'], desc: 'Fuel drains 25% slower.' },
    { id: 's3', br: 'SUPPORT', name: 'Pickup Magnet', cost: 250, req: [], desc: 'Power-ups drift toward you.' },
    { id: 's4', br: 'SUPPORT', name: 'Loop Trim', cost: 300, req: ['s3'], desc: 'Loop costs less and recovers faster.' },
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
