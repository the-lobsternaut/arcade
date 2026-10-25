/* Fork-Tailed Devil - DOM overlays: boss briefings, radio, hangar (tech/copilots/wingmen), campaign map, dossier, save/load.
   Characters are 3D (js/chars.js) rendered into one shared canvas that moves between panels; without WebGL a call-sign badge stands in. */
window.SKY = window.SKY || {};
(function (S) {
  'use strict';
  const G = S.game, A = S.audio, ST = S.story, LV = S.levels, SV = S.saves;
  const $ = (sel, el) => (el || document).querySelector(sel);
  const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // Drawing at random from a pool repeats sooner than it feels like it should - with forty-odd
  // lines you will usually hear one twice inside a dozen visits. Deal from a shuffled deck
  // instead and only reshuffle when it runs out, so a hangar visit is a line you have not had
  // yet. The deck is keyed off the array itself, so every pool gets its own.
  const lineBags = new WeakMap();
  function dealLine(a) {
    if (!a || !a.length) return '';
    if (a.length === 1) return a[0];
    let b = lineBags.get(a);
    if (!b) { b = { q: [], last: -1 }; lineBags.set(a, b); }
    if (!b.q.length) {
      b.q = a.map((_, i) => i);
      for (let i = b.q.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; const t = b.q[i]; b.q[i] = b.q[j]; b.q[j] = t; }
      // a fresh deck must not open on the line the old one closed with
      if (b.q.length > 1 && b.q[b.q.length - 1] === b.last) { const t = b.q[b.q.length - 1]; b.q[b.q.length - 1] = b.q[0]; b.q[0] = t; }
    }
    b.last = b.q.pop();
    return a[b.last];
  }
  const pick = dealLine;
  const ui = $('#ui');
  const UI = S.ui = { open: null };
  const CTRL = ST.CONTROLLER;

  // ---------------------------------------------------------------- character view
  // A character either has a portrait in the pack or does not appear. The monogram badge is gone:
  // a card built around three initials is a character you have never seen pretending to be one you
  // have, and that is how the ferry pilots, the copilots and the wingmen all ended up talking. What
  // they had to say that mattered is Halo's to say - she has the face and she has the radio.
  // hasFace is the gate, and every surface that puts words on the screen asks it before it builds
  // a card, so nothing is ever drawn around an empty box.
  const charBox = h('div', 'charview');
  const hasFace = (who) => !!(S.chars && S.chars.ok && S.chars.has && S.chars.has(who));
  function showChar(slot, who, look, opt) {
    if (!hasFace(who)) return false;
    if (charBox.parentNode !== slot) slot.appendChild(charBox);
    S.chars.attach(charBox); S.chars.show(who, look, opt || {});
    return true;
  }
  function charTalk(sec) { if (S.chars && S.chars.ok) S.chars.talk(sec); }
  function charExpr(e) { if (S.chars && S.chars.ok) S.chars.expr(e); }
  function hideChar() { if (S.chars && S.chars.ok) S.chars.hide(); if (charBox.parentNode) charBox.parentNode.removeChild(charBox); }

  // ---------------------------------------------------------------- layout helpers
  function field() { const r = $('#cv').getBoundingClientRect(), a = $('#app').getBoundingClientRect(); return { x: r.left - a.left, y: r.top - a.top, w: r.width, h: r.height, aw: a.width, ah: a.height }; }
  function flagBar(g) {
    // neutral color stripe for the dossier badge (national colors for Allies; plain gunmetal for Axis - no insignia)
    const C = { usa: ['#3a5aa8', '#e8e4dc', '#c83a3a'], uk: ['#2a3a7a', '#e8e4dc', '#c8323a'], ussr: ['#c8323a', '#c8323a', '#e0c040'], china: ['#2a3a8a', '#e8e4dc', '#c8323a'], france: ['#2a4a9a', '#e8e4dc', '#c8323a'],
      poland: ['#e8e4dc', '#c8323a'], canada: ['#c8323a', '#e8e4dc', '#c8323a'], australia: ['#2a3a7a', '#e8e4dc'], nz: ['#2a3a7a', '#c8323a'], india: ['#e88a30', '#e8e4dc', '#2a8a3a'], safrica: ['#e88a30', '#e8e4dc', '#2a5aa8'],
      nl: ['#c8323a', '#e8e4dc', '#2a4a9a'], norway: ['#c8323a', '#e8e4dc', '#2a3a7a'], belgium: ['#1a1a1a', '#e8c030', '#c8323a'], czech: ['#e8e4dc', '#c8323a', '#2a4a9a'], greece: ['#2a6ac0', '#e8e4dc'],
      yugo: ['#2a3a8a', '#e8e4dc', '#c8323a'], philippines: ['#2a3a9a', '#c8323a', '#e8e4dc'], brazil: ['#2a8a3a', '#e8c830', '#2a3a8a'], mexico: ['#2a8a3a', '#e8e4dc', '#c8323a'], ethiopia: ['#2a8a3a', '#e8c830', '#c8323a'],
      denmark: ['#c8323a', '#e8e4dc'], seri: ['#c8323a', '#e8e4dc', '#2a3a8a'], finland: ['#e8e4dc', '#3a5a9a'] };
    if (g.id === 'usa') return '<span class="flag usflag"></span>';
    const c = C[g.id] || ['#4a4e54', '#6a6e74', '#4a4e54'];
    return '<span class="flag">' + c.map((x) => '<i style="background:' + x + '"></i>').join('') + '</span>';
  }

  // ---------------------------------------------------------------- transmissions
  // Everything anyone says - a radio call, the objectives, a boss briefing - is this one card in
  // this one place: across the top of the field, the portrait a 2:3 box on the left and the text
  // beside it a little over half as tall, so the card is an L and the corner under the text stays
  // open onto the game. It used to be three shapes in four places, and a briefing put the enemy's
  // card against the bottom edge, which on a phone is under your thumb. One shape in one place
  // means you always know where to look and never lose the bottom of the field to a caption.
  function cardGeom(el) {
    const f = field();
    // Always the field's top left corner, just under the HUD. On a phone held upright the card is
    // exactly as wide as the field; turn the phone and the field becomes a narrow strip down the
    // middle with dead letterbox either side, so the card borrows the right-hand margin rather
    // than squeezing a face into eighty pixels. Same corner, same shape, more room when there is
    // room going spare.
    const w = Math.max(f.w, Math.min(360, f.aw - f.x - 8));
    const aw = Math.round(w * 0.30), ah = Math.round(aw * 1.5);
    // Flush to the right edge of the screen it is an open-ended strip; short of it, it needs a
    // right-hand edge of its own or it reads as cut off.
    el.classList.toggle('inset', f.x + w < f.aw - 2);
    el.style.left = f.x + 'px';
    el.style.top = (f.y + f.h * 0.085) + 'px';
    el.style.width = w + 'px';
    el.style.height = ah + 'px';
    const slot = $('.tslot', el), txt = $('.ttext', el);
    if (slot) slot.style.width = aw + 'px';
    if (txt) txt.style.height = Math.round(ah * 0.56) + 'px';
  }
  const toast = h('div', 'tcard radio hidden'); ui.appendChild(toast);
  toast.innerHTML = '<div class="tslot"></div><div class="ttext"><button class="tx" aria-label="Close">\u00d7</button><b></b><span></span></div>';
  $('.tx', toast).addEventListener('click', (e) => { e.stopPropagation(); hideToast(); });
  let toastT = 0, toastBusy = false;
  function radioToast(who, look, name, text, expr, sec) {
    if (UI.open || brief.active) return;
    // Nothing talks to you during a boss. A callout clears the sky, and clearing the sky in the
    // middle of a boss fight is either a free pass or a lost one - neither is the fight you were
    // having. It also puts a card over the corner you are trying to read the pattern in.
    const wd = G.world && G.world();
    if (wd && wd.phase === 'boss') return;
    if (!hasFace(who)) return;
    sec = sec || Math.min(7, 2.4 + text.length * 0.045);
    cardGeom(toast);
    toast.classList.remove('hidden'); toast.classList.add('show');
    $('.ttext > b', toast).textContent = name; $('.ttext > span', toast).textContent = text;
    showChar($('.tslot', toast), who, look, { expr: expr || 'neutral', framing: 'fit', animate: true });
    charTalk(Math.min(sec - 0.5, text.length * 0.05));
    A.sfx('radio'); toastBusy = true;
    if (G.holdPlay) G.holdPlay(true);
    clearTimeout(toastT); toastT = setTimeout(hideToast, sec * 1000);
  }
  function hideToast() { clearTimeout(toastT); toast.classList.remove('show'); toast.classList.add('hidden'); if (toastBusy && !brief.active && !UI.open) hideChar(); toastBusy = false; if (G.holdPlay) G.holdPlay(false); }
  const RADIO_EXPR = { lowfuel: 'worried', nofuel: 'worried', damage: 'worried', critical: 'worried', winglost: 'worried', clear: 'salute' };
  G.hooks.radio = function (kind) {
    // Only Halo talks to you in the air, and only about something you now have to do: the tanks,
    // the airframe, a side of the formation that just went empty, the target going down. The crew
    // used to chime in, and a timer used to put a line up every half minute whether anything had
    // happened or not - two voices and a metronome over the one corner you need to read.
    if (kind === 'winglost') {
      const w = G.debug.info().wing.find((q) => q.dead);
      const wm = w ? ST.WINGMEN[G.WINGMEN[w.slot].id] : null;
      // She reads the plot, so she names who went down rather than quoting a pilot you cannot see.
      const call = wm ? (/"([^"]+)"/.exec(wm.name) || [, wm.name])[1] : null;
      return radioToast('halo', CTRL.look, 'HALO', (call ? call + ' is down. ' : '') + pick(CTRL.lines.winglost), 'worried', 6);
    }
    const lines = CTRL.lines[kind]; if (!lines) return;
    radioToast('halo', CTRL.look, 'HALO - ' + CTRL.name, pick(lines), RADIO_EXPR[kind] || 'neutral');
  };
  G.hooks.stageStart = function () {
    const L = G.level(); if (!L) return;
    setTimeout(() => radioToast('halo', CTRL.look, 'HALO - Objectives: ' + L.name, L.obj, 'hip', 7), 2400);
  };
  G.hooks.autosave = (why) => { if (SV) SV.autosave(why); };

  // ---------------------------------------------------------------- boss briefing cards
  const brief = { active: false, seq: [], i: 0, card: null, t: 0, typer: 0, autoT: 0, done: null };
  function briefCard(item) {
    // The same card as a radio call, with a typed line and a timer bar on it.
    const card = h('div', 'tcard hidden ' + item.side + (item.who === 'halo' ? ' ctrl' : ''));
    card.innerHTML = '<div class="tslot"></div><div class="ttext"><b>' + (item.flag || '') + esc(item.name) + '</b>' +
      '<small>' + esc(item.sub) + '</small><span class="bline"></span><i class="btimer"></i></div>';
    return card;
  }
  function nextBrief() {
    clearInterval(brief.typer); clearTimeout(brief.autoT);
    if (brief.card) { const c = brief.card; c.classList.remove('show'); c.classList.add('hidden'); setTimeout(() => c.remove(), 300); brief.card = null; }
    if (brief.i >= brief.seq.length) { endBrief(); return; }
    const item = brief.seq[brief.i++];
    const card = briefCard(item); ui.appendChild(card); cardGeom(card); brief.card = card;
    requestAnimationFrame(() => { card.classList.remove('hidden'); card.classList.add('show'); });
    showChar($('.tslot', card), item.who, item.look, { expr: item.expr, framing: 'fit', animate: true });   // whole portrait, and let a clip run while she speaks
    A.sfx('static');
    const p = $('.bline', card), txt = item.text; let n = 0;
    brief.typer = setInterval(() => { n += 2; p.textContent = txt.slice(0, n); if (n >= txt.length) { clearInterval(brief.typer); } }, 28);
    charTalk(txt.length * 0.028 / 2 + 0.6);
    const dur = 2600 + txt.length * 42;
    const tm = $('.btimer', card); tm.style.transitionDuration = dur + 'ms'; requestAnimationFrame(() => requestAnimationFrame(() => tm.classList.add('run')));
    brief.autoT = setTimeout(nextBrief, dur);
  }
  function endBrief() { brief.active = false; ui.classList.remove('briefing'); hideChar(); const d = brief.done; brief.done = null; if (d) d(); }
  function startBrief(seq, done) {
    hideToast();
    brief.active = true; brief.seq = seq; brief.i = 0; brief.done = done; ui.classList.add('briefing');
    nextBrief();
  }
  UI.skipBrief = () => { if (brief.active) nextBrief(); };
  UI.briefActive = () => brief.active;
  ui.addEventListener('pointerdown', (e) => { if (brief.active && !e.target.closest('.panel')) { e.preventDefault(); e.stopPropagation(); nextBrief(); } });
  window.addEventListener('keydown', (e) => { if (brief.active && !e.repeat) { e.preventDefault(); e.stopImmediatePropagation(); nextBrief(); } }, true);
  G.hooks.bossBrief = function (type, level) {
    const run = G.run();
    // Pick only from the people who have a portrait. An unpainted character used to get a card
    // with her initials in it, which is how a ferry pilot nobody has drawn yet ended up being the
    // one to brief you. The pool opens up on its own as the art lands.
    const faced = (g) => hasFace(g.id);
    const ally = ST.pickGuest(level, run, 'ally', faced), axis = ST.pickGuest(level, run, 'axis', faced);
    const seq = [];
    for (const g of [ally, axis]) {
      if (!g) continue;
      if (run && run.met.indexOf(g.id) < 0) run.met.push(g.id);
      if (SV && SV.addDossier(g.id)) UI.newDossier = (UI.newDossier || 0) + 1;
      seq.push({ who: g.id, look: g.look, side: g.side === 'ally' ? 'ally' : 'axis', name: g.rank + ' ' + g.name, sub: g.country + ' - ' + g.role, flag: flagBar(g),
        text: g.side === 'ally' ? ST.pickTip(g, type) : pick(g.lines), expr: g.side === 'ally' ? (g.look.pose === 'salute' ? 'salute' : 'smile') : (g.look.expr || (g.look.pose === 'arms' ? 'arms' : 'hip')) });
    }
    const last = seq.length ? brief_lastGuest(ally, axis) : null;
    const jealous = last && last.side === 'ally';
    if (hasFace('halo')) seq.push({ who: 'halo', look: CTRL.look, side: 'ally', name: CTRL.name + ' "' + CTRL.callsign + '"', sub: CTRL.title, flag: '<span class="flag halo"><i></i></span>',
      text: last ? ST.controllerAfter(last) : pick(CTRL.lines.afterAxis), expr: jealous ? 'jealous' : 'fiery' });
    if (!seq.length) return false;        // nobody with a face to say it: straight on to the boss
    startBrief(seq, () => G.briefDone());
    return true;
  };
  function brief_lastGuest(ally, axis) { return axis || ally; }

  // ---------------------------------------------------------------- generic full-screen panel
  function panel(cls, title) {
    closePanel();
    const p = h('div', 'panel ' + cls);
    p.innerHTML = '<div class="ptop"><b>' + title + '</b><span class="pmerit"></span><span class="psync"></span></div><div class="pbody"></div>';
    ui.appendChild(p); UI.open = p; hideToast();
    requestAnimationFrame(() => p.classList.add('in'));
    return p;
  }
  function closePanel() { if (S.map3d && S.map3d.ok) S.map3d.detach(); if (UI.open) { UI.open.remove(); UI.open = null; } hideChar(); }
  UI.close = closePanel;
  function btn(label, cls, fn) { const b = h('button', 'btn ' + (cls || ''), label); b.addEventListener('click', (e) => { e.stopPropagation(); A.unlock(); A.sfx('click'); fn(e); }); return b; }
  function syncBadge(p) { const s = $('.psync', p); if (!s || !SV) return; s.textContent = SV.lastStatus || ''; s.className = 'psync ' + (SV.online ? 'on' : 'off'); }
  if (SV) SV.on(() => { if (UI.open) syncBadge(UI.open); });

  // ---------------------------------------------------------------- hangar
  let hangarTab = 'arm';
  // Both panels and the victory screen use the same markup - portrait top left, name and line
  // beside it - so a character is always in the same place however you got to them. Each returns
  // whether it actually spoke: no portrait, no card, and the caller says it another way.
  function say(p, who, look, name, text, expr, framing) {
    const box = $('.hsay', p); if (!box || !hasFace(who)) return false;
    $('.htext', box).textContent = text; $('.hname', box).textContent = name;
    // 'fit' shows the whole picture; 'bust' fills the box by cropping, and what it crops is the
    // top of the head. The slot is a 2:3 box now, so there is nothing to crop anyway.
    showChar($('.hslot', p), who, look, { expr: expr, framing: framing || 'fit', animate: true });
    charTalk(Math.min(5, text.length * 0.04));
    $('.hact', box).innerHTML = '';
    return true;
  }
  function sayCtrl(p, text, expr) { return say(p, 'halo', CTRL.look, 'HALO - ' + CTRL.name, text, expr || 'hip'); }
  function sayOther(p, who, look, name, text, expr) { return say(p, who, look, name, text, expr || 'smile'); }
  function openHangar() {
    const p = panel('hangar', 'HANGAR DECK');
    A.music('hangar');
    const body = $('.pbody', p);
    body.innerHTML = '<div class="hleft"><div class="hslot"></div><div class="hsay"><div class="hname"></div><div class="htext"></div><div class="hact"></div></div></div>' +
      '<div class="hright"><div class="tabs"></div><div class="tabbody"></div><div class="hbar"></div></div>';
    const tabs = $('.tabs', p);
    [['arm', 'ARMAMENT'], ['tech', 'TECH TREE'], ['copilots', 'COPILOTS'], ['wingmen', 'WINGMEN']].forEach(([id, label]) => {
      const t = btn(label, 'tab' + (hangarTab === id ? ' on' : ''), () => { hangarTab = id; renderHangar(p); [...tabs.children].forEach((c) => c.classList.toggle('on', c === t)); });
      t.dataset.tab = id; tabs.appendChild(t);
    });
    const bar = $('.hbar', p);
    bar.appendChild(btn('SAVE / LOAD', 'ghost', () => openSaves(true)));
    bar.appendChild(btn('DOSSIER', 'ghost', () => openDossier(true)));
    bar.appendChild(btn('LAUNCH', 'go', () => { closePanel(); G.hangarLaunch(); }));
    renderHangar(p);
    sayCtrl(p, pick(CTRL.lines.hangar), 'hip');
    if (UI.newDossier) { setTimeout(() => { if (UI.open === p) sayCtrl(p, 'New dossier entries: ' + UI.newDossier + '. You met some interesting women up there. Don\'t get ideas.', 'jealous'); UI.newDossier = 0; }, 3500); }
  }
  UI.openHangar = openHangar;
  function meritTxt(p) { const r = G.run(); $('.pmerit', p).innerHTML = 'MERIT <b>' + (r ? r.merit : 0) + '</b>'; syncBadge(p); }
  function renderHangar(p) {
    meritTxt(p);
    const tb = $('.tabbody', p); tb.innerHTML = ''; tb.scrollTop = 0;
    const run = G.run(), stats = G.stats();
    if (hangarTab === 'arm') {
      // pick what you fly with this stage. Tech sets the tier; this sets the type.
      const a = G.arm();
      const lo = h('div', 'loadout');
      lo.innerHTML = 'CARRYING <b>' + esc(G.GUNS[a.gun.type].name) + ' ' + 'I'.repeat(a.gun.lvl) +
        '</b> and <b>' + esc(G.BOMBS[a.bomb.type].name) + ' ' + 'I'.repeat(a.bomb.lvl) +
        '</b> &nbsp; tier comes from the tech tree';
      tb.appendChild(lo);
      const mk = (kind, types, cur, cap, lib) => {
        const col = h('div', 'branch');
        col.appendChild(h('h4', '', kind === 'gun' ? 'GUNS' : 'BOMBS'));
        for (const t of types) {
          const def = lib[t] || { name: t };
          const on = cur.type === t;
          const n = h('div', 'node arm' + (on ? ' bought' : ' avail'));
          n.innerHTML = '<b>' + esc(def.name || t) + '</b><small>' + (on ? 'EQUIPPED - TIER ' + 'I'.repeat(cap) : 'tap to equip') + '</small>';
          n.addEventListener('click', () => { if (G.setArm(kind, t)) renderHangar(p); });
          col.appendChild(n);
        }
        return col;
      };
      const tree = h('div', 'tree');
      tree.appendChild(mk('gun', G.GUN_TYPES, a.gun, a.gunCap || 1, G.GUNS));
      tree.appendChild(mk('bomb', G.BOMB_TYPES, a.bomb, a.bombCap || 1, G.BOMBS));
      tb.appendChild(tree);
    } else if (hangarTab === 'tech') {
      const lo = h('div', 'loadout');
      lo.innerHTML = 'GUNS <b>' + G.GUNS[run.gun.type].name + ' ' + 'I'.repeat(run.gun.lvl) + '</b> &nbsp; BOMBS <b>' + G.BOMBS[run.bomb.type].name + ' ' + 'I'.repeat(run.bomb.lvl) + '</b> &nbsp; ARMOR <b>' + stats.armorMax + '</b> &nbsp; FUEL <b>' + stats.fuelMax + '</b>';
      tb.appendChild(lo);
      const tree = h('div', 'tree');
      for (const br of ['ARMOR', 'GUNS', 'BOMBS', 'SUPPORT']) {
        const col = h('div', 'branch'); col.appendChild(h('h4', '', br));
        for (const t of G.TECH.filter((x) => x.br === br)) {
          const st = G.techState(t.id);
          const n = h('div', 'node ' + st + (t.req.length ? ' child' : ''));
          n.innerHTML = '<b>' + esc(t.name) + '</b><small>' + (st === 'owned' ? 'OWNED' : t.cost + ' M') + '</small>' + (t.req.length ? '<em>needs ' + t.req.map((r) => esc(G.TECH_BY[r].name)).join(' + ') + '</em>' : '');
          n.addEventListener('click', () => { A.sfx('click'); describeTech(p, t); });
          col.appendChild(n);
        }
        tree.appendChild(col);
      }
      tb.appendChild(tree);
      const pw = h('div', 'powlist', '<h4>POWER-UPS (permanent, level 1-3)</h4>');
      for (const fam of ['gun', 'bomb', 'fuel', 'repair']) for (const k of G.POW[fam]) {
        const it = h('span', 'pw ' + fam, esc(G.POW_INFO[k][0])); it.title = G.POW_INFO[k][1];
        it.addEventListener('click', () => { A.sfx('click'); sayCtrl(p, G.POW_INFO[k][1] + '. ' + POWTALK[fam], 'smile'); });
        pw.appendChild(it);
      }
      tb.appendChild(pw);
    } else if (hangarTab === 'copilots') {
      const grid = h('div', 'cards');
      for (const c of ST.COPILOTS) {
        const st = G.copilotState(c.id);
        const d = h('div', 'card ' + st);
        d.innerHTML = '<b>' + esc(c.name) + '</b><small>' + esc(c.nation) + ' - ' + esc(c.role) + '</small><p class="pro">+ ' + esc(c.pros) + '</p><p class="con">- ' + esc(c.cons) + '</p><i>' +
          (st === 'active' ? 'ON BOARD' : st === 'owned' ? 'AVAILABLE' : st === 'buyable' ? 'UNLOCK ' + c.unlock.cost + ' M' : 'LOCKED (fly ' + (c.unlock && c.unlock.played) + ' missions)') + '</i>';
        d.addEventListener('click', () => { A.sfx('click'); describeCopilot(p, c); });
        grid.appendChild(d);
      }
      tb.appendChild(grid);
    } else {
      const grid = h('div', 'cards');
      for (let i = 0; i < 2; i++) {
        const wid = G.WINGMEN[i].id, wm = ST.WINGMEN[wid], slotOk = i < stats.wingSlots, alive = run.wing[i];
        const d = h('div', 'card ' + (slotOk ? (alive ? 'owned' : 'lost') : 'locked'));
        d.innerHTML = '<b>' + esc(wm.name) + '</b><small>Wing slot ' + (i + 1) + '</small><p>' + (slotOk ? (alive ? 'Ready. Armor ' + Math.round(30 * stats.wingArmor) + ', guns at reduced strength, light bombs.' : 'Shot down. Replace for ' + G.WING_COST + ' Merit.') : 'Buy "Wingman Slot ' + (i ? 'II' : 'I') + '" in SUPPORT.') + '</p><i>' + (slotOk ? (alive ? 'IN FORMATION' : 'LOST') : 'NO SLOT') + '</i>';
        d.addEventListener('click', () => { A.sfx('click'); describeWing(p, i); });
        grid.appendChild(d);
      }
      tb.appendChild(grid);
    }
  }
  const POWTALK = { gun: 'Gun family, round brass medal. Shoot it to cycle the type; grab the same type again to level it up.', bomb: 'Bomb family, steel hexagon. Same deal: shoot to cycle, collect the same one to level it.', fuel: 'Yellow can. Fuel drains slowly, but it does drain.', repair: 'Green cross. Patches armor. Pretty important if you like being alive.' };
  function describeTech(p, t) {
    const st = G.techState(t.id), run = G.run();
    const armHint = (t.br === 'GUNS' || t.br === 'BOMBS') && st === 'owned' ? ' Pick which one you carry on the ARMAMENT tab.' : '';
    sayCtrl(p, t.name + ': ' + t.desc + (st === 'locked' ? ' ' + pick(CTRL.lines.locked) : st === 'owned' ? ' Already installed.' + armHint : ''), st === 'owned' ? 'smile' : 'hip');
    if (st === 'available') {
      const act = $('.hact', p);
      act.appendChild(btn('BUY ' + t.cost + ' M', run.merit >= t.cost ? 'go' : 'dis', () => {
        if (G.buyTech(t.id)) { renderHangar(p); sayCtrl(p, pick(CTRL.lines.buy), 'salute'); } else sayCtrl(p, pick(CTRL.lines.poor), 'jealous');
      }));
    }
  }
  function describeCopilot(p, c) {
    const st = G.copilotState(c.id), run = G.run();
    // Halo reads out the file. The copilot's own chime needs a face to come from, and when one
    // arrives this goes back to being him talking.
    if (!sayOther(p, c.id, c.look, c.name + ' - ' + c.role, c.bio + ' ' + pick(c.chime), c.look.pose === 'salute' ? 'salute' : 'smile'))
      sayCtrl(p, c.name + ', ' + c.role.toLowerCase() + '. ' + c.bio + ' ' + c.pros + ', but ' + c.cons + '.', 'hip');
    const act = $('.hact', p);
    if (st === 'owned') act.appendChild(btn('TAKE ON BOARD', 'go', () => { G.setCopilot(c.id); renderHangar(p); sayCtrl(p, pick(CTRL.lines.copilotPick), c.look.g === 'f' ? 'jealous' : 'smile'); }));
    else if (st === 'buyable') act.appendChild(btn('UNLOCK ' + c.unlock.cost + ' M', run.merit >= c.unlock.cost ? 'go' : 'dis', () => { if (G.setCopilot(c.id)) { renderHangar(p); sayCtrl(p, pick(CTRL.lines.copilotPick), c.look.g === 'f' ? 'jealous' : 'smile'); } else sayCtrl(p, pick(CTRL.lines.poor), 'jealous'); }));
    act.appendChild(btn('ASK HALO', 'ghost', () => sayCtrl(p, c.name + '. ' + c.pros + ', but ' + c.cons + '. ' + (c.look.g === 'f' ? 'And she\'d better keep her eyes on the instruments.' : 'Solid choice.'), c.look.g === 'f' ? 'jealous' : 'smile')));
  }
  function describeWing(p, i) {
    const stats = G.stats(), run = G.run(), wid = G.WINGMEN[i].id, wm = ST.WINGMEN[wid];
    if (i >= stats.wingSlots) return sayCtrl(p, 'No slot for a wingman yet. Buy Wingman Slot ' + (i ? 'II' : 'I') + ' in the SUPPORT branch.', 'hip');
    if (!sayOther(p, wid, wm.look, wm.name, run.wing[i] ? wm.join : 'Replacement pilot standing by. Same callsign, new airplane.', run.wing[i] ? 'salute' : 'worried'))
      sayCtrl(p, run.wing[i] ? wm.name + ' has slot ' + (i + 1) + ' and is on your wing.'
                             : wm.name + '\u2019s slot is empty. A replacement is standing by - same callsign, new airplane.',
              run.wing[i] ? 'salute' : 'worried');
    if (!run.wing[i]) $('.hact', p).appendChild(btn('REPLACE ' + G.WING_COST + ' M', run.merit >= G.WING_COST ? 'go' : 'dis', () => { if (G.replaceWing(i)) { renderHangar(p); sayCtrl(p, pick(CTRL.lines.wingbuy), 'smile'); } else sayCtrl(p, pick(CTRL.lines.poor), 'jealous'); }));
  }
  UI.hangarTab = (t) => { hangarTab = t; if (UI.open && UI.open.classList.contains('hangar')) { renderHangar(UI.open); [...$('.tabs', UI.open).children].forEach((c) => c.classList.toggle('on', c.dataset.tab === t)); } };
  UI.describe = (kind, id) => { const p = UI.open; if (!p) return; if (kind === 'tech') describeTech(p, G.TECH_BY[id]); else if (kind === 'copilot') describeCopilot(p, ST.copilot(id)); else describeWing(p, id); };
  G.hooks.hangar = () => { openHangar(); return true; };

  // ---------------------------------------------------------------- campaign map
  let mapSel = null;
  function openMap() {
    const p = panel('map', 'CAMPAIGN MAP');
    A.music('hangar');
    const body = $('.pbody', p);
    body.innerHTML = '<div class="mapview"><div class="maplegend"><span class="lg done">COMPLETED</span><span class="lg avail">AVAILABLE</span><span class="lg fog">UNDISCOVERED</span></div></div><div class="mapside"><div class="mprog"></div><div class="mdetail"></div><div class="mlist"></div><div class="mbar"></div></div>';
    $('.ptop', p).appendChild(btn('HANGAR', 'ghost ptopbtn', () => { closePanel(); openHangar(); }));
    const foot = h('div', 'mfoot'); p.appendChild(foot);
    const Ls = LV.list, run = G.run();
    const done = Ls.filter((l) => run.done[l.id]).length;
    $('.mprog', p).innerHTML = '<b>' + Math.round(done / Ls.length * 100) + '%</b> CAMPAIGN COMPLETE <small>' + done + ' / ' + Ls.length + ' battles</small><i style="width:' + (done / Ls.length * 100) + '%"></i>';
    const list = $('.mlist', p);
    Ls.forEach((l, i) => {
      const st = levelState(i);
      const it = h('div', 'mitem ' + st);
      it.innerHTML = st === 'fog' ? '<b>? UNDISCOVERED</b><small>' + (l.bonus ? 'Bonus theater' : 'Further operations') + '</small>' : '<b>' + esc(l.name) + '</b><small>' + esc(l.date) + (l.bonus ? ' - BONUS' : l.optional ? ' - OPTIONAL' : '') + '</small>' + (run.done[l.id] ? '<i class="medal ' + run.done[l.id].medal + '"></i>' : '');
      it.addEventListener('click', () => { A.sfx('click'); selectLevel(p, i, true); });
      list.appendChild(it);
    });
    const mv = $('.mapview', p);
    // the map owns its canvas and lends it to the panel, so the WebGL context outlives the panel
    // a tap on a pin does not move the camera - you can already see what you tapped
    if (S.map3d && S.map3d.ok) { S.map3d.mount(mv, { levels: Ls, state: levelState, run, onPick: (i) => { A.sfx('click'); selectLevel(p, i); } }); }
    else mv.classList.add('nomap');
    // Open on the next battle you can actually fly, and point the chart at it. Without the focus
    // the ring, the card and the FLY MISSION button were all on the next one while the chart was
    // still centred on the one you had just won - so the only pin on screen was the finished one,
    // and tapping it turned the button into REPLAY MISSION. On a phone the list is hidden and the
    // chart is the only way to choose, so the camera and the selection have to be the same thing.
    const next = Ls.findIndex((l, i) => levelState(i) === 'avail');
    selectLevel(p, mapSel !== null && levelState(mapSel) === 'avail' ? mapSel : next >= 0 ? next : mapSel !== null && levelState(mapSel) !== 'fog' ? mapSel : 0, 'snap');
    meritTxt(p);
  }
  UI.openMap = openMap;
  function levelState(i) { const l = LV.list[i], run = G.run(); if (run && run.done[l.id]) return 'done'; return G.levelAvailable(i) ? 'avail' : 'fog'; }
  function selectLevel(p, i, focus) {
    mapSel = i;
    const l = LV.list[i], st = levelState(i), run = G.run(), d = $('.mdetail', p);
    [...$('.mlist', p).children].forEach((c, k) => c.classList.toggle('sel', k === i));
    // focus 'snap' jumps the chart (opening it), true glides (picking from the list)
    if (S.map3d && S.map3d.ok) { if (focus) S.map3d.focus(i, focus === 'snap'); else S.map3d.select(i); }
    if (st === 'fog') { d.innerHTML = '<h3>UNDISCOVERED</h3><p>Reconnaissance has not reached this area yet. Win the battles before it to lift the fog.</p>'; mapFoot(p, i, false); return; }
    const bossN = l.bossName || ({ bossShip: 'Battleship', bossBomber: 'Heavy bomber', carrier: 'Carrier' })[l.boss];
    const rec = run.done[l.id];
    d.innerHTML = '<h3>' + esc(l.name) + '</h3><small>' + esc(l.date) + ' - ' + esc(l.loc) + '</small><p>' + esc(l.blurb) + '</p>' +
      '<p class="mmeta">BOSS <b>' + esc(bossN) + '</b> &nbsp; ' + esc(l.theme.tod.toUpperCase()) + ' / ' + esc(l.theme.weather.toUpperCase()) + ' &nbsp; THREAT ' + '&#9733;'.repeat(l.tier) + '</p>' +
      (rec ? '<p class="mrec"><i class="medal ' + rec.medal + '"></i> BEST ' + rec.score + ' - flying it again pays less Merit</p>' : '');
    mapFoot(p, i, true);
  }
  // Stepping through the battles. On a phone the list is hidden and the chart is the only way to
  // choose, which makes a pin you cannot see a battle you cannot reach - the arrows are that way
  // in. They skip the fogged entries, because there is nothing to pick on one, and they stop at
  // the ends instead of wrapping, so running out of arrow tells you where you are in the war.
  function stepLevel(from, dir) {
    for (let i = from + dir; i >= 0 && i < LV.list.length; i += dir) if (levelState(i) !== 'fog') return i;
    return -1;
  }
  function mapFoot(p, i, playable) {
    const foot = $('.mfoot', p); if (!foot) return;
    foot.innerHTML = '';
    const prev = stepLevel(i, -1), next = stepLevel(i, 1);
    // The triangle is drawn, not typed. U+25C0/U+25B6 are emoji on iOS: they come out as blue
    // system chevrons that ignore the button's colour, so a live arrow and a dead one looked
    // identical and both looked switched off.
    const arrow = (dir, to, name) => {
      const b = btn('', 'arrow ' + dir + (to < 0 ? ' dis' : ''), () => { if (to >= 0) selectLevel(p, to, true); });
      b.appendChild(h('i'));
      b.setAttribute('aria-label', name); return b;
    };
    foot.appendChild(arrow('prev', prev, 'Previous battle'));
    // One label whether you have flown it or not: it is the same mission either way, and a button
    // that says REPLAY reads like a lesser version of the thing rather than the thing.
    foot.appendChild(btn('PLAY MISSION', 'go' + (playable ? '' : ' dis'), () => { if (playable) { closePanel(); G.launchLevel(i); } }));
    foot.appendChild(arrow('next', next, 'Next battle'));
  }
  G.hooks.map = () => { openMap(); return true; };

  // ---------------------------------------------------------------- campaign complete
  function openVictory(st) {
    const p = panel('victory', 'CAMPAIGN COMPLETE');
    A.music('hangar');
    const body = $('.pbody', p);
    body.innerHTML = '<div class="hleft"><div class="hslot"></div><div class="hsay"><div class="hname"></div><div class="htext"></div><div class="hact"></div></div></div>' +
      '<div class="vmain">' +
        '<h2 class="vhead">THE PACIFIC IS OURS</h2>' +
        '<p class="vsub">' + esc(st.won) + ' of ' + esc(st.total) + ' battles flown &middot; ' + esc(st.played) + ' sorties</p>' +
        '<div class="vgrid">' +
          '<div class="vstat"><b>' + esc(st.score.toLocaleString()) + '</b><span>CAMPAIGN SCORE</span></div>' +
          '<div class="vstat"><b>' + esc(st.merit) + '</b><span>MERIT UNSPENT</span></div>' +
          '<div class="vstat"><b>' + esc(st.tally.gold) + '</b><span>GOLD</span></div>' +
          '<div class="vstat"><b>' + esc(st.tally.silver) + '</b><span>SILVER</span></div>' +
          '<div class="vstat"><b>' + esc(st.tally.bronze) + '</b><span>BRONZE</span></div>' +
        '</div>' +
        '<div class="vmedals"></div>' +
        (st.bonusLeft ? '<p class="vbonus">' + esc(st.bonusLeft) + ' bonus theater' + (st.bonusLeft > 1 ? 's' : '') + ' still open. The war is over; the flying is not.</p>'
                      : '<p class="vbonus">Every theater flown, including the bonus runs. Nothing left to prove.</p>') +
        '<div class="vbar"></div>' +
      '</div>';
    // medal ribbon, one per battle won
    const med = $('.vmedals', p), Ls = LV.list, run = G.run();
    Ls.forEach((l) => {
      const d = run.done && run.done[l.id]; if (!d) return;
      const w = h('span', 'vmed ' + d.medal); w.title = l.name + ' - ' + d.score;
      med.appendChild(w);
    });
    const bar = $('.vbar', p);
    bar.appendChild(btn('CONTINUE', 'go', () => { closePanel(); G.toHangar(); }));
    bar.appendChild(btn('NEW CAMPAIGN', 'ghost', () => { closePanel(); G.newGame(); }));
    const line = st.bonusLeft
      ? 'That is the last of the main line. Every bird came home because you flew it. There are still bonus runs on the board if you want them.'
      : 'Every battle on the board, flown and won. Whatever they put up next, you have already beaten it. Nice flying.';
    if (!sayCtrl(p, line, 'smile')) $('.hleft', p).remove();
    meritTxt(p);
  }
  UI.openVictory = openVictory;
  G.hooks.victory = (st) => { openVictory(st); return true; };

  // ---------------------------------------------------------------- dossier
  function openDossier(back) {
    const p = panel('dossier', 'DOSSIER');
    const met = SV ? SV.dossier() : [];
    // An unmet card is a "???" you can still fill in. An unpainted one never becomes anything, so
    // it is not on the board at all and the count is out of the people who can actually turn up.
    const roster = ST.GUESTS.filter((g) => hasFace(g.id));
    $('.pmerit', p).innerHTML = roster.filter((g) => met.indexOf(g.id) >= 0).length + ' / ' + roster.length + ' MET';
    const body = $('.pbody', p);
    body.innerHTML = '<div class="dleft"><div class="hslot"></div><div class="hsay"><div class="hname"></div><div class="htext"></div><div class="hact"></div></div></div><div class="dgrid"></div>';
    const grid = $('.dgrid', p);
    for (const g of roster) {
      const ok = met.indexOf(g.id) >= 0;
      const c = h('div', 'dcard ' + (ok ? g.side : 'locked'));
      c.innerHTML = ok ? flagBar(g) + '<b>' + esc(g.country) + '</b><small>' + esc(g.rank + ' ' + g.name) + '</small>' : '<b>???</b><small>Meet her in a boss briefing</small>';
      if (ok) c.addEventListener('click', () => { A.sfx('click'); sayOther(p, g.id, g.look, g.rank + ' ' + g.name + ' - ' + g.country, g.note + ' "' + g.lines[0] + '"', g.side === 'ally' ? 'smile' : 'arms'); });
      grid.appendChild(c);
    }
    const bar = h('div', 'hbar'); body.appendChild(bar);
    bar.appendChild(btn('BACK', 'ghost', () => { closePanel(); if (back) openHangar(); }));
    sayCtrl(p, 'Everyone you\'ve met on the radio. Tap one for her file. Purely professional, of course.', 'jealous');
  }
  UI.openDossier = openDossier;
  G.hooks.dossier = () => openDossier(false);

  // ---------------------------------------------------------------- save / load
  function openSaves(back) {
    const p = panel('saves', 'SAVE / LOAD');
    const body = $('.pbody', p);
    body.innerHTML = '<div class="sv"><label>Server slot <input class="slot" maxlength="32" autocomplete="off" spellcheck="false"></label><div class="srow"></div><div class="slist"></div><h4>FILE</h4><div class="frow"></div><p class="smsg"></p><div class="hbar"></div></div>';
    const inp = $('.slot', p); inp.value = SV.slot;
    const msg = (t, bad) => { const m = $('.smsg', p); m.textContent = t; m.className = 'smsg ' + (bad ? 'bad' : 'ok'); };
    const slot = () => { if (!SV.setSlot(inp.value)) { msg('Slot names: letters, digits, - and _, up to 32.', true); return null; } return SV.slot; };
    const row = $('.srow', p);
    row.appendChild(btn('SAVE TO SERVER', 'go', () => { const s = slot(); if (!s) return; G.saveNow(); SV.probe().then(() => SV.pushServer(s)).then((ok) => msg(ok ? 'Saved to server slot "' + s + '".' : 'Offline, saved locally.', !ok)).then(refresh); }));
    row.appendChild(btn('LOAD FROM SERVER', '', () => { const s = slot(); if (!s) return; SV.loadServer(s).then(() => { msg('Loaded "' + s + '".'); afterLoad(); }, (e) => msg(e.message || String(e), true)); }));
    const fr = $('.frow', p);
    fr.appendChild(btn('EXPORT FILE', '', () => { G.saveNow(); msg('Exported ' + SV.exportFile()); }));
    const fi = h('input'); fi.type = 'file'; fi.accept = '.json,application/json'; fi.style.display = 'none'; p.appendChild(fi);
    fi.addEventListener('change', () => { SV.importFile(fi.files[0]).then(() => { msg('Imported.'); afterLoad(); }, (e) => msg('Import failed: ' + e.message, true)); fi.value = ''; });
    fr.appendChild(btn('IMPORT FILE', '', () => fi.click()));
    const bar = $('.hbar', p);
    bar.appendChild(btn('BACK', 'ghost', () => { closePanel(); if (back && G.run()) openHangar(); }));
    function refresh() {
      const l = $('.slist', p); l.innerHTML = '<small>checking server...</small>';
      SV.listSlots().then((o) => {
        l.innerHTML = o.slots.length ? '' : '<small>No server saves yet.</small>';
        for (const s of o.slots) { const it = h('div', 'sitem', '<b>' + esc(s.slot) + '</b><small>' + esc(new Date(s.savedAt || s.mtime).toLocaleString()) + '</small>'); it.addEventListener('click', () => { inp.value = s.slot; }); l.appendChild(it); }
        SV.online = true; syncBadge(p);
      }, () => { l.innerHTML = '<small>Server not reachable: saves stay in this browser. Run server.py to sync.</small>'; SV.online = false; syncBadge(p); });
    }
    function afterLoad() { if (G.state() === 'hangar' || G.state() === 'map') { closePanel(); G.continueGame(); } }
    refresh(); syncBadge(p);
  }
  UI.openSaves = openSaves;
  G.hooks.savepanel = () => openSaves(false);

  // ---------------------------------------------------------------- title / misc
  const syncChip = h('div', 'syncchip hidden'); ui.appendChild(syncChip);
  let chipT = 0;
  // Off the bottom edge and out of the way. A panel already reports sync in its own header, and
  // in the air there is nowhere for it to go that is not the HUD or someone's face - so it only
  // ever shows on the title screen, which is the one place it has room and the one place you
  // might be waiting to hear it.
  if (SV) SV.on((m, kind) => {
    if (UI.open || G.state() === 'play') { syncChip.classList.add('hidden'); return; }
    syncChip.textContent = m; syncChip.className = 'syncchip ' + kind;
    clearTimeout(chipT); chipT = setTimeout(() => syncChip.classList.add('hidden'), 2600);
  });
  G.hooks.title = function () {
    closePanel();
    if (!SV) return;
    SV.checkNewer().then((o) => {
      if (!o || G.state() !== 'title') return;
      const p = panel('prompt', 'SERVER SAVE FOUND');
      $('.pbody', p).innerHTML = '<p>A newer save is on the server (slot "' + esc(SV.slot) + '", ' + esc(new Date(o.savedAt).toLocaleString()) + ', Merit ' + (o.run ? o.run.merit : 0) + '). Load it?</p><div class="hbar"></div>';
      const bar = $('.hbar', p);
      bar.appendChild(btn('KEEP LOCAL', 'ghost', closePanel));
      bar.appendChild(btn('LOAD SERVER SAVE', 'go', () => { try { SV.apply(o); } catch (e) { return; } closePanel(); }));
    });
  };
  G.hooks.gameover = () => { hideToast(); };
  // one geometry, so a rotate or a keyboard just re-measures whichever card is up
  window.addEventListener('resize', () => { if (brief.card) cardGeom(brief.card); if (toastBusy) cardGeom(toast); });
})(window.SKY);
