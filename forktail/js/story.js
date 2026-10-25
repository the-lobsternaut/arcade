/* Fork-Tailed Devil - story data: mission controller, briefing roster (33 nations), copilots, wingmen, campaign levels.
   Plain data tables: add a nation by appending to GUESTS, a level by appending to LEVELS (see README "Extending the story"). */
window.SKY = window.SKY || {};
(function (S) {
  'use strict';
  // ---- character looks (consumed by js/chars.js). Parts come from the Quaternius modular packs in assets/chars.
  // g: 'f'|'m'; body/legs/feet/head: part sets; hair: long|waves|bob|bun|pony|victory|braid|short|none; c1 top, c2 trim, c3 bottoms
  // The tables are in assets/pack.bin, not here - avatars, clips and dialog all travel in the one
  // file. js/boot.js has it loaded before this script runs, so these are plain reads.
  const D = (S.pack && S.pack.json('dialog')) || {};
  const CONTROLLER = D.CONTROLLER || { lines: {} }, GUESTS = D.GUESTS || [], COPILOTS = D.COPILOTS || [],
        WINGMEN = D.WINGMEN || {}, SKIN = D.SKIN || {}, THEATER = D.THEATER || {}, LEVELS = D.LEVELS || [];
  const GUEST_BY = {}; GUESTS.forEach((g) => { GUEST_BY[g.id] = g; });
  const CP_BY = {}; COPILOTS.forEach((c) => { CP_BY[c.id] = c; });

  // `ok` is an optional gate the caller supplies - the UI passes "has a portrait", because a
  // character with no art cannot be put on screen and should not be picked to brief you.
  function pickGuest(level, run, side, ok) {
    const met = (run && run.met) || [];
    const want = (g) => (side === 'ally' ? g.side === 'ally' : g.side !== 'ally') && (!ok || ok(g));
    const th = level ? THEATER[level.id] || 'pacific' : 'pacific';
    const tied = (level ? level.nations : []).map((id) => GUEST_BY[id]).filter((g) => g && want(g));
    const fresh = tied.filter((g) => met.indexOf(g.id) < 0);
    if (fresh.length) return fresh[(Math.random() * fresh.length) | 0];
    const pool = GUESTS.filter((g) => want(g) && met.indexOf(g.id) < 0);
    const src = pool.length ? pool : (tied.length ? tied : GUESTS.filter(want));
    if (!src.length) return null;
    let tot = 0; const w = src.map((g) => { const v = g.th.indexOf(th) >= 0 ? 3 : 1; tot += v; return v; });
    let r = Math.random() * tot;
    for (let i = 0; i < src.length; i++) { r -= w[i]; if (r <= 0) return src[i]; }
    return src[0];
  }
  // Drawing at random from a pool repeats sooner than it feels like it should - with forty-odd
  // lines you will usually hear one twice inside a dozen visits. Deal from a shuffled deck
  // instead and only reshuffle when it runs out, so a hangar visit is a line you have not had
  // yet. The deck is keyed off the array itself, so every pool gets its own.
  const storyBags = new WeakMap();
  function dealStoryLine(a) {
    if (!a || !a.length) return '';
    if (a.length === 1) return a[0];
    let b = storyBags.get(a);
    if (!b) { b = { q: [], last: -1 }; storyBags.set(a, b); }
    if (!b.q.length) {
      b.q = a.map((_, i) => i);
      for (let i = b.q.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; const t = b.q[i]; b.q[i] = b.q[j]; b.q[j] = t; }
      // a fresh deck must not open on the line the old one closed with
      if (b.q.length > 1 && b.q[b.q.length - 1] === b.last) { const t = b.q[b.q.length - 1]; b.q[b.q.length - 1] = b.q[0]; b.q[0] = t; }
    }
    b.last = b.q.pop();
    return a[b.last];
  }
  const pickLine = dealStoryLine;
  // boss-aware tips: prefer lines about this boss, then generic lines, never lines about a different boss
  const BOSS_KEYS = { bossShip: /battleship|bridge|turret|shell|hull|broadside/i, bossBomber: /bomber|engine|tail|bay|outboard|gunner/i, carrier: /carrier|elevator|lift|deck|flight deck/i };
  function pickTip(guest, bossType) {
    const lines = guest.lines || [];
    const k = BOSS_KEYS[bossType];
    const others = Object.keys(BOSS_KEYS).filter((t) => t !== bossType).map((t) => BOSS_KEYS[t]);
    const mine = k ? lines.filter((l) => k.test(l)) : [];
    if (mine.length) return pickLine(mine);
    const generic = lines.filter((l) => !others.some((r) => r.test(l)));
    return pickLine(generic.length ? generic : lines);
  }
  function controllerAfter(guest) {
    const base = guest.side === 'ally' ? CONTROLLER.lines.afterAlly : CONTROLLER.lines.afterAxis;
    return Math.random() < 0.55 && guest.q ? guest.q + ' ' + pickLine(base) : pickLine(base);
  }

  S.story = { CONTROLLER, GUESTS, GUEST_BY, COPILOTS, WINGMEN, SKIN, pickGuest, pickLine, pickTip, controllerAfter, THEATER,
    copilot: (id) => CP_BY[id] || null, guest: (id) => GUEST_BY[id] || null };
  S.levels = { list: LEVELS, byId: (id) => LEVELS.find((l) => l.id === id) || null, index: (id) => LEVELS.findIndex((l) => l.id === id) };
})(window.SKY);
