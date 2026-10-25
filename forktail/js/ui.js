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

  // ---------------------------------------------------------------- character view (3D; no-WebGL fallback is a plain call-sign badge, no static portraits)
  const charBox = h('div', 'charview');
  const charBadge = h('div', 'charbadge'); charBox.appendChild(charBadge);
  let charWho = null;
  function showChar(slot, who, look, opt) {
    opt = opt || {};
    if (charBox.parentNode !== slot) slot.appendChild(charBox);
    charWho = who;
    const C = S.chars;
    if (C && C.ok && C.has && C.has(who)) { charBadge.style.display = 'none'; C.attach(charBox); C.show(who, look, opt); }
    else {
      const g = who === 'halo' ? null : ST.guest(who) || ST.copilot(who) || ST.WINGMEN[who];
      const nm = who === 'halo' ? 'HALO' : g ? (g.name || g.call || who) : who;
      charBadge.style.display = ''; charBadge.textContent = nm.split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase();
      charBadge.style.background = 'radial-gradient(circle at 50% 35%, ' + ((look && look.c2) || '#4a4e54') + ', ' + ((look && look.c1) || '#1a1e24') + ')';
    }
  }
  function charTalk(sec) { if (S.chars && S.chars.ok) S.chars.talk(sec); }
  function charExpr(e) { if (S.chars && S.chars.ok) S.chars.expr(e); }
  function hideChar() { if (S.chars && S.chars.ok) S.chars.hide(); if (charBox.parentNode) charBox.parentNode.removeChild(charBox); charWho = null; }

  // ---------------------------------------------------------------- layout helpers
  function field() { const r = $('#cv').getBoundingClientRect(), a = $('#app').getBoundingClientRect(); return { x: r.left - a.left, y: r.top - a.top, w: r.width, h: r.height, aw: a.width, ah: a.height }; }
  function landscape() { const f = field(); return f.aw - f.w >= 2 * 230; }
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

  // ---------------------------------------------------------------- radio toasts (in-flight)
  // A radio call is someone talking to you, so you should be able to see who. The old strip ran the
  // full width of the field with a 58px disc of a face in it, which at arm's length on a phone was
  // a thumbnail of a thumbnail. It is now a card in the upper left - 40% of the width, a third of
  // the height - with the portrait taking everything the text does not, and an X to send it away
  // early. Every call comes from the same corner so you always know where to look.
  const toast = h('div', 'toast hidden'); ui.appendChild(toast);
  toast.innerHTML = '<button class="tx" aria-label="Close">\u00d7</button><div class="tslot"></div><div class="ttext"><b></b><span></span></div>';
  $('.tx', toast).addEventListener('click', (e) => { e.stopPropagation(); hideToast(); });
  let toastT = 0, toastBusy = false;
  function radioToast(who, look, name, text, expr, sec) {
    if (UI.open || brief.active) return;
    sec = sec || Math.min(7, 2.4 + text.length * 0.045);
    const f = field();
    toast.style.left = f.x + 'px';           // flush to the edge: it slides in from off screen
    toast.style.top = (f.y + f.h * 0.085 + 4) + 'px';
    toast.style.width = Math.round(f.w * 0.60) + 'px';
    toast.style.height = Math.round(f.h * 0.333) + 'px';
    toast.classList.remove('hidden'); toast.classList.add('show');
    $('b', toast).textContent = name; $('span', toast).textContent = text;
    showChar($('.tslot', toast), who, look, { expr: expr || 'neutral', framing: 'fit', animate: true });
    charTalk(Math.min(sec - 0.5, text.length * 0.05));
    A.sfx('radio'); toastBusy = true;
    if (G.holdPlay) G.holdPlay(true);
    clearTimeout(toastT); toastT = setTimeout(hideToast, sec * 1000);
  }
  function hideToast() { clearTimeout(toastT); toast.classList.remove('show'); toast.classList.add('hidden'); if (toastBusy && !brief.active && !UI.open) hideChar(); toastBusy = false; if (G.holdPlay) G.holdPlay(false); }
  const RADIO_EXPR = { lowfuel: 'worried', nofuel: 'worried', damage: 'worried', critical: 'worried', winglost: 'worried', clear: 'salute', chatter: 'smile', bossPhase: 'fiery' };
  G.hooks.radio = function (kind) {
    const run = G.run();
    if (kind === 'chatter' && run && Math.random() < 0.5) { const cp = ST.copilot(run.copilot); if (cp) return radioToast(cp.id, cp.look, cp.name + ' (copilot)', pick(cp.chime), 'smile'); }
    if (kind === 'winglost') { const w = G.debug.info().wing.find((q) => q.dead); const wm = w ? ST.WINGMEN[G.WINGMEN[w.slot].id] : null; return radioToast('halo', CTRL.look, 'HALO', (wm ? wm.down + ' ' : '') + pick(CTRL.lines.winglost), 'worried', 6); }
    const lines = CTRL.lines[kind]; if (!lines) return;
    radioToast('halo', CTRL.look, 'HALO - ' + CTRL.name, pick(lines), RADIO_EXPR[kind] || 'neutral');
  };
  G.hooks.bossPhase = function (n) { radioToast('halo', CTRL.look, 'HALO', CTRL.lines.bossPhase[Math.min(2, n - 1)] || CTRL.lines.bossPhase[0], 'fiery', 3.2); };
  G.hooks.stageStart = function () {
    const L = G.level(); if (!L) return;
    setTimeout(() => radioToast('halo', CTRL.look, 'HALO - Objectives: ' + L.name, L.obj, 'hip', 7), 2400);
  };
  G.hooks.autosave = (why) => { if (SV) SV.autosave(why); };

  // ---------------------------------------------------------------- boss briefing cards
  const brief = { active: false, seq: [], i: 0, card: null, t: 0, typer: 0, autoT: 0, done: null };
  function briefCard(item) {
    const card = h('div', 'brief ' + item.side + (item.who === 'halo' ? ' ctrl' : ''));
    card.innerHTML = '<div class="bslot"></div><div class="btext"><div class="bhead">' + (item.flag || '') + '<div><b>' + esc(item.name) + '</b><small>' + esc(item.sub) + '</small></div></div>' +
      '<p class="bline"></p><div class="bfoot"><span>' + (item.side === 'axis' ? 'ENEMY TRANSMISSION' : item.who === 'halo' ? 'HALO CONTROL' : 'ALLIED LIAISON') + '</span><span>TAP TO CONTINUE</span></div><i class="btimer"></i></div>';
    return card;
  }
  function placeCard(card, item) {
    const f = field(), land = landscape();
    card.classList.toggle('side', land);
    if (land) {
      const sw = Math.min(360, (f.aw - f.w) / 2 - 16);
      card.style.width = sw + 'px'; card.style.top = (f.y + f.h * 0.3) + 'px';
      card.style.left = item.who === 'halo' ? (f.x + f.w + 10) + 'px' : (f.x - sw - 10) + 'px';
    } else {
      card.style.width = (f.w - 12) + 'px'; card.style.left = (f.x + 6) + 'px';
      if (item.who === 'halo') card.style.top = (f.y + f.h * 0.1) + 'px';
      else { card.style.top = ''; card.style.bottom = (f.ah - (f.y + f.h) + f.h * 0.14) + 'px'; }
    }
  }
  function nextBrief() {
    clearInterval(brief.typer); clearTimeout(brief.autoT);
    if (brief.card) { const c = brief.card; c.classList.add('out'); setTimeout(() => c.remove(), 260); brief.card = null; }
    if (brief.i >= brief.seq.length) { endBrief(); return; }
    const item = brief.seq[brief.i++];
    const card = briefCard(item); ui.appendChild(card); placeCard(card, item); brief.card = card;
    requestAnimationFrame(() => card.classList.add('in'));
    showChar($('.bslot', card), item.who, item.look, { expr: item.expr, framing: 'fit', animate: true });   // whole portrait, and let a clip run while she speaks
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
    const ally = ST.pickGuest(level, run, 'ally'), axis = ST.pickGuest(level, run, 'axis');
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
    seq.push({ who: 'halo', look: CTRL.look, side: 'ally', name: CTRL.name + ' "' + CTRL.callsign + '"', sub: CTRL.title, flag: '<span class="flag halo"><i></i></span>',
      text: last ? ST.controllerAfter(last) : pick(CTRL.lines.afterAxis), expr: jealous ? 'jealous' : 'fiery' });
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
  function sayCtrl(p, text, expr) {
    const box = $('.hsay', p); if (!box) return;
    $('.htext', box).textContent = text; $('.hname', box).textContent = 'HALO - ' + CTRL.name;
    showChar($('.hslot', p), 'halo', CTRL.look, { expr: expr || 'hip', framing: 'bust', animate: true }); charTalk(Math.min(5, text.length * 0.04));
    $('.hact', box).innerHTML = '';
  }
  function sayOther(p, who, look, name, text, expr) {
    const box = $('.hsay', p);
    $('.htext', box).textContent = text; $('.hname', box).textContent = name;
    showChar($('.hslot', p), who, look, { expr: expr || 'smile', framing: 'bust', animate: true }); charTalk(Math.min(5, text.length * 0.04));
    $('.hact', box).innerHTML = '';
  }
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
    sayOther(p, c.id, c.look, c.name + ' - ' + c.role, c.bio + ' ' + pick(c.chime), c.look.pose === 'salute' ? 'salute' : 'smile');
    const act = $('.hact', p);
    if (st === 'owned') act.appendChild(btn('TAKE ON BOARD', 'go', () => { G.setCopilot(c.id); renderHangar(p); sayCtrl(p, pick(CTRL.lines.copilotPick), c.look.g === 'f' ? 'jealous' : 'smile'); }));
    else if (st === 'buyable') act.appendChild(btn('UNLOCK ' + c.unlock.cost + ' M', run.merit >= c.unlock.cost ? 'go' : 'dis', () => { if (G.setCopilot(c.id)) { renderHangar(p); sayCtrl(p, pick(CTRL.lines.copilotPick), c.look.g === 'f' ? 'jealous' : 'smile'); } else sayCtrl(p, pick(CTRL.lines.poor), 'jealous'); }));
    act.appendChild(btn('ASK HALO', 'ghost', () => sayCtrl(p, c.name + '. ' + c.pros + ', but ' + c.cons + '. ' + (c.look.g === 'f' ? 'And she\'d better keep her eyes on the instruments.' : 'Solid choice.'), c.look.g === 'f' ? 'jealous' : 'smile')));
  }
  function describeWing(p, i) {
    const stats = G.stats(), run = G.run(), wid = G.WINGMEN[i].id, wm = ST.WINGMEN[wid];
    if (i >= stats.wingSlots) return sayCtrl(p, 'No slot for a wingman yet. Buy Wingman Slot ' + (i ? 'II' : 'I') + ' in the SUPPORT branch.', 'hip');
    sayOther(p, wid, wm.look, wm.name, run.wing[i] ? wm.join : 'Replacement pilot standing by. Same callsign, new airplane.', run.wing[i] ? 'salute' : 'worried');
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
      it.addEventListener('click', () => { A.sfx('click'); selectLevel(p, i); if (S.map3d && S.map3d.ok) S.map3d.focus(i); });
      list.appendChild(it);
    });
    const mv = $('.mapview', p);
    // the map owns its canvas and lends it to the panel, so the WebGL context outlives the panel
    if (S.map3d && S.map3d.ok) { S.map3d.mount(mv, { levels: Ls, state: levelState, run, onPick: (i) => { A.sfx('click'); selectLevel(p, i); } }); }
    else mv.classList.add('nomap');
    const next = Ls.findIndex((l, i) => levelState(i) === 'avail');
    selectLevel(p, mapSel !== null && levelState(mapSel) === 'avail' ? mapSel : next >= 0 ? next : mapSel !== null && levelState(mapSel) !== 'fog' ? mapSel : 0);
    meritTxt(p);
  }
  UI.openMap = openMap;
  function levelState(i) { const l = LV.list[i], run = G.run(); if (run && run.done[l.id]) return 'done'; return G.levelAvailable(i) ? 'avail' : 'fog'; }
  function selectLevel(p, i) {
    mapSel = i;
    const l = LV.list[i], st = levelState(i), run = G.run(), d = $('.mdetail', p);
    [...$('.mlist', p).children].forEach((c, k) => c.classList.toggle('sel', k === i));
    if (S.map3d && S.map3d.ok) S.map3d.select(i);
    if (st === 'fog') { d.innerHTML = '<h3>UNDISCOVERED</h3><p>Reconnaissance has not reached this area yet. Win the battles before it to lift the fog.</p>'; const f0 = $('.mfoot', p); if (f0) f0.innerHTML = ''; return; }
    const bossN = l.bossName || ({ bossShip: 'Battleship', bossBomber: 'Heavy bomber', carrier: 'Carrier' })[l.boss];
    const rec = run.done[l.id];
    d.innerHTML = '<h3>' + esc(l.name) + '</h3><small>' + esc(l.date) + ' - ' + esc(l.loc) + '</small><p>' + esc(l.blurb) + '</p>' +
      '<p class="mmeta">BOSS <b>' + esc(bossN) + '</b> &nbsp; ' + esc(l.theme.tod.toUpperCase()) + ' / ' + esc(l.theme.weather.toUpperCase()) + ' &nbsp; THREAT ' + '&#9733;'.repeat(l.tier) + '</p>' +
      (rec ? '<p class="mrec"><i class="medal ' + rec.medal + '"></i> BEST ' + rec.score + ' - replay pays Merit</p>' : '');
    const foot = $('.mfoot', p);
    if (foot) { foot.innerHTML = ''; foot.appendChild(btn(rec ? 'REPLAY MISSION' : 'FLY MISSION', 'go', () => { closePanel(); G.launchLevel(i); })); }
  }
  G.hooks.map = () => { openMap(); return true; };

  // ---------------------------------------------------------------- campaign complete
  function openVictory(st) {
    const p = panel('victory', 'CAMPAIGN COMPLETE');
    A.music('hangar');
    const body = $('.pbody', p);
    body.innerHTML = '<div class="vleft"><div class="vslot"></div></div>' +
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
    showChar($('.vslot', p), 'halo', CTRL.look, { expr: 'smile', framing: 'bust', animate: true });
    charTalk(Math.min(6, line.length * 0.04));
    const say = h('div', 'vsay'); say.innerHTML = '<b>HALO - ' + esc(CTRL.name) + '</b><p>' + esc(line) + '</p>';
    $('.vleft', p).appendChild(say);
    meritTxt(p);
  }
  UI.openVictory = openVictory;
  G.hooks.victory = (st) => { openVictory(st); return true; };

  // ---------------------------------------------------------------- dossier
  function openDossier(back) {
    const p = panel('dossier', 'DOSSIER');
    const met = SV ? SV.dossier() : [];
    $('.pmerit', p).innerHTML = met.length + ' / ' + ST.GUESTS.length + ' MET';
    const body = $('.pbody', p);
    body.innerHTML = '<div class="dleft"><div class="hslot"></div><div class="hsay"><div class="hname"></div><div class="htext"></div><div class="hact"></div></div></div><div class="dgrid"></div>';
    const grid = $('.dgrid', p);
    for (const g of ST.GUESTS) {
      const ok = met.indexOf(g.id) >= 0;
      const c = h('div', 'dcard ' + (ok ? g.side : 'locked'));
      c.innerHTML = ok ? flagBar(g) + '<b>' + esc(g.country) + '</b><small>' + esc(g.rank + ' ' + g.name) + '</small>' : '<b>???</b><small>Meet her in a boss briefing</small>';
      if (ok) c.addEventListener('click', () => { A.sfx('click'); sayOther(p, g.id, g.look, g.rank + ' ' + g.name + ' - ' + g.country, g.note + ' "' + g.lines[0] + '"', g.side === 'ally' ? 'smile' : 'arms'); });
      grid.appendChild(c);
    }
    const bar = h('div', 'hbar'); body.appendChild(bar);
    bar.appendChild(btn('BACK', 'ghost', () => { closePanel(); if (back) openHangar(); }));
    $('.hname', p).textContent = 'HALO'; $('.htext', p).textContent = 'Everyone you\'ve met on the radio. Tap one for her file. Purely professional, of course.';
    showChar($('.hslot', p), 'halo', CTRL.look, { expr: 'jealous', framing: 'bust', animate: true });
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
  if (SV) SV.on((m, kind) => { syncChip.textContent = m; syncChip.className = 'syncchip ' + kind; clearTimeout(chipT); chipT = setTimeout(() => syncChip.classList.add('hidden'), 2600); });
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
  window.addEventListener('resize', () => { if (brief.card) placeCard(brief.card, brief.seq[brief.i - 1]); });
})(window.SKY);
