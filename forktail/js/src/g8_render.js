
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
      base(); const s = SP.ebullet; if (s) for (const b of eb) ctx.drawImage(s.c, b.x - 4.4, b.y - 4.4, 8.8, 8.8);
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
    text('1P', 3, 7.5, 6, BRASS, 'left', 800, false);
    text(String(score).padStart(7, '0'), 12, 7.8, 8, PAPER, 'left', 700, false, MONO);
    text('HI', 58, 7.5, 6, BRASS, 'left', 800, false);
    text(String(Math.max(hiscore, score)).padStart(7, '0'), 67, 7.8, 8, PAPER, 'left', 700, false, MONO);
    text('MERIT', 113, 7.5, 5.4, BRASS, 'left', 800, false);
    text(String(run ? run.merit : 0), 133, 7.8, 7.2, '#bfe39a', 'left', 700, false, MONO);
    const L = curLevel();
    text(L ? L.short || L.name : 'STAGE ' + stage, W - 63, 7.5, 5.6, BRASS, 'right', 800, false);
    const p = player; if (!p) return;
    const ff = p.fuel / ST.fuelMax, af = p.armor / ST.armorMax;
    const lowF = ff < 0.22 && ((time * 4) | 0) % 2 === 0, lowA = af < 0.2 && ((time * 4) | 0) % 2 === 1;
    text('FUEL', 3, 18, 5.2, lowF ? '#ff5a4a' : BRASS, 'left', 800, false);
    bar(19, 15.5, 84, 5, ff, ff > 0.5 ? '#e8c14a' : ff > 0.25 ? '#e89a3a' : '#e2482f', lowF);
    text(String(Math.ceil(p.fuel)), 106, 18.2, 5.6, PAPER, 'left', 700, false, MONO);
    text('ARMOR', 124, 18, 5.2, lowA ? '#ff5a4a' : BRASS, 'left', 800, false);
    bar(146, 15.5, 84, 5, af, af > 0.7 ? '#7fcf5a' : af > 0.45 ? '#c7d24a' : af > 0.2 ? '#e8902a' : '#e2482f', lowA);
    text(String(Math.ceil(p.armor)), 233, 18.2, 5.6, PAPER, 'left', 700, false, MONO);
    // weapon modes
    const gm = p.mode === 'guns', gn = GUNS[run.gun.type], bm = BOMBS[run.bomb.type];
    const y = 25.5;
    ctx.fillStyle = gm ? 'rgba(255,224,102,0.22)' : 'rgba(255,255,255,0.05)'; ctx.fillRect(2, y - 2.6, 64, 8.2);
    ctx.fillStyle = !gm ? 'rgba(255,176,74,0.22)' : 'rgba(255,255,255,0.05)'; ctx.fillRect(68, y - 2.6, 72, 8.2);
    if (gm) { ctx.strokeStyle = '#ffe066'; ctx.lineWidth = 0.6; ctx.strokeRect(2, y - 2.6, 64, 8.2); } else { ctx.strokeStyle = '#ffb04a'; ctx.lineWidth = 0.6; ctx.strokeRect(68, y - 2.6, 72, 8.2); }
    text('GUNS', 4.5, y + 1.5, 5.4, gm ? '#ffe066' : '#8b8778', 'left', 800, false);
    text(gn.name + ' ' + 'I'.repeat(run.gun.lvl), 23, y + 1.5, 5.4, gm ? gn.col : '#8b8778', 'left', 800, false);
    text('BOMBS', 70.5, y + 1.5, 5.4, !gm ? '#ffb04a' : '#8b8778', 'left', 800, false);
    const bcd = bombCooldown(run.bomb.type, run.bomb.lvl);
    // A 30-second reload is too long to read off a 72-pixel bar, so a long one counts itself down.
    const bwait = p.bombCd > 0 && bcd > 4;
    text(bwait ? bm.name + ' ' + Math.ceil(p.bombCd) + 's' : bm.name + ' ' + 'I'.repeat(run.bomb.lvl), 93, y + 1.5, 5.4, bwait ? '#8b8778' : !gm ? bm.col : '#8b8778', 'left', 800, false);
    if (p.bombCd > 0) { ctx.fillStyle = gm ? 'rgba(255,176,74,0.35)' : 'rgba(255,176,74,0.7)'; ctx.fillRect(68, y + 5, 72 * (1 - clamp(p.bombCd / bcd, 0, 1)), 0.8); }
    // wingmen armor
    let wx = 146;
    for (const w of wing) { text('W' + (w.slot + 1), wx, y + 1.5, 5, w.dead ? '#7a4a44' : '#9fd8ff', 'left', 800, false); if (!w.dead) bar(wx + 9, y - 0.2, 22, 3.6, w.armor / w.max, '#7fbcd8'); else text('DOWN', wx + 9, y + 1.5, 4.6, '#c85a4a', 'left', 800, false); wx += 36; }
    text(p.loopT > 0 ? 'LOOP!' : p.loopCd > 0 ? 'LOOP..' : 'LOOP', W - 3, y + 1.5, 5.2, p.loopT > 0 ? '#9fd8ff' : (p.fuel > ST.loopCost + 1 && p.loopCd <= 0 ? '#c9c2ad' : '#5c5c5c'), 'right', 800, false);
    if (boss && !boss.dead && phase === 'boss') {
      const w2 = W - 80, f = boss.hp / boss.maxhp;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(39, HUD_H + 3, w2 + 2, 5);
      ctx.fillStyle = boss.bphase === 3 ? '#ff4a2a' : '#c8352b'; ctx.fillRect(40, HUD_H + 4, w2 * f, 3);
      ctx.fillStyle = '#f1ead6'; ctx.fillRect(40 + w2 * 0.33, HUD_H + 3, 0.7, 5); ctx.fillRect(40 + w2 * 0.66, HUD_H + 3, 0.7, 5);
      text('P' + boss.bphase, 36, HUD_H + 5.6, 5.2, '#ff9c8a', 'right', 800, true);
    }
  }
  function roundBtn(x, y, r, ok, label, glyph) {
    ctx.globalAlpha = ok ? 0.85 : 0.4;
    ctx.fillStyle = 'rgba(20,24,28,0.55)'; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(217,184,96,0.85)'; ctx.lineWidth = 1; ctx.stroke();
    glyph(); text(label, x, y + 7, 4.4, PAPER, 'center', 800, false);
    ctx.globalAlpha = 1;
  }
  function drawTouchButtons() {
    if (!G.touchMode || state !== 'play' || paused || phase === 'briefing') return;
    hudT();
    const p = player;
    let [x, y, r] = loopBtn();
    roundBtn(x, y, r, p && !p.dead && p.loopT <= 0 && p.loopCd <= 0 && p.fuel > ST.loopCost + 1, 'LOOP', () => {
      ctx.strokeStyle = PAPER; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, y - 2, 4.8, -Math.PI * 0.15, Math.PI * 1.45); ctx.stroke();
      const a = Math.PI * 1.45, ax = x + Math.cos(a) * 4.8, ay = y - 2 + Math.sin(a) * 4.8;
      ctx.fillStyle = PAPER; ctx.beginPath(); ctx.moveTo(ax + 2.4, ay - 0.6); ctx.lineTo(ax - 0.4, ay - 2.4); ctx.lineTo(ax - 0.6, ay + 1.5); ctx.closePath(); ctx.fill();
    });
    [x, y, r] = modeBtn();
    const gm = p && p.mode === 'guns';
    roundBtn(x, y, r, true, gm ? 'GUNS' : 'BOMBS', () => {
      ctx.fillStyle = gm ? '#ffe066' : '#ffb04a';
      if (gm) { for (const dx of [-2.4, 0, 2.4]) ctx.fillRect(x + dx - 0.6, y - 6, 1.2, 6); }
      else { ctx.beginPath(); ctx.ellipse(x, y - 2.5, 2.4, 4, 0, 0, TAU); ctx.fill(); ctx.fillRect(x - 2.6, y + 0.6, 5.2, 1); }
    });
  }
  function dim(a) { hudT(); ctx.fillStyle = `rgba(4,8,14,${a})`; ctx.fillRect(0, 0, W, H); }
  function blink(rate) { return ((time * (rate || 2.2)) | 0) % 2 === 0; }
  function menuBtn(r, label, hot) {
    const [x, y, w, h] = r; plate(x, y, w, h, 3);
    if (hot) { ctx.strokeStyle = 'rgba(245,215,122,0.9)'; ctx.lineWidth = 0.9; ctx.stroke(); }
    text(label, x + w / 2, y + h / 2 + 0.4, 8, hot ? '#f5d77a' : PAPER, 'center', 800, false);
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

  function drawTitle() {
    hudT();
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(3,8,16,0.78)'); g.addColorStop(0.45, 'rgba(3,8,16,0.15)'); g.addColorStop(1, 'rgba(3,8,16,0.78)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const cy = Math.max(66, H * 0.17);
    ctx.save();
    // wordmark is auto-fitted so a long name never runs off the 270-wide playfield
    devilMark(W / 2, cy - 42, 23);
    const TW = 'FORK-TAILED', tmax = W - 36;
    let tsz = 60;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    do { ctx.font = 'italic 900 ' + tsz + 'px "Arial Black", "Helvetica Neue", Arial, sans-serif'; tsz -= 1; }
    while (tsz > 12 && ctx.measureText(TW).width > tmax);
    const lg = ctx.createLinearGradient(0, cy - 32, 0, cy + 32);
    lg.addColorStop(0, '#fff3cf'); lg.addColorStop(0.35, '#e6c36e'); lg.addColorStop(0.5, '#a9772e'); lg.addColorStop(0.62, '#e0b85e'); lg.addColorStop(1, '#6e4a17');
    ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 4;
    ctx.lineWidth = 5; ctx.strokeStyle = '#1a1206'; ctx.lineJoin = 'round'; ctx.strokeText(TW, W / 2, cy);
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = lg; ctx.fillText(TW, W / 2, cy);
    ctx.lineWidth = 0.8; ctx.strokeStyle = 'rgba(255,244,210,0.8)'; ctx.strokeText(TW, W / 2, cy);
    ctx.restore();
    hudT();
    const bg = ctx.createLinearGradient(0, cy + 32, 0, cy + 50); bg.addColorStop(0, '#5a6233'); bg.addColorStop(1, '#343a1c');
    ctx.fillStyle = bg; ctx.fillRect(30, cy + 33, W - 60, 17);
    ctx.fillStyle = 'rgba(217,184,96,0.85)'; ctx.fillRect(30, cy + 33, W - 60, 0.7); ctx.fillRect(30, cy + 49.3, W - 60, 0.7);
    text('D E V I L', W / 2, cy + 41.8, 11, PAPER, 'center', 800, true);
    text('P-38 LIGHTNING  -  1941-1945 CAMPAIGN', W / 2, cy + 60, 6, '#cfd6e0', 'center', 700, true);
    { // flight model + test mode, made obvious: these were too small to find before
      const bw = 150, bx = W / 2 - bw / 2, by0 = cy + 70, bh = 20;
      TITLE_BTN.mode = [bx, by0, bw, bh];
      modeSwitch(bx, by0, bw, bh);
      text('VIEW - TAP TO SWITCH', W / 2, by0 - 5, 5, '#8d94a2', 'center', 700, true);
      text(mode3d ? 'CHASE CAMERA - SAME CONTROLS' : 'CLASSIC TOP-DOWN', W / 2, by0 + bh + 7, 5, '#cfd6e0', 'center', 700, true);
      // test mode
      const tw = 150, tx = W / 2 - tw / 2, ty = by0 + bh + 14;
      TITLE_BTN.test = [tx, ty, tw, 13];
      const on = G.testUnlock && G.testUnlock();
      ctx.fillStyle = on ? 'rgba(120,200,120,0.22)' : 'rgba(8,12,18,0.6)';
      ctx.fillRect(tx, ty, tw, 13);
      ctx.strokeStyle = on ? 'rgba(140,220,140,0.7)' : 'rgba(150,150,170,0.4)'; ctx.lineWidth = 0.6; ctx.strokeRect(tx, ty, tw, 13);
      text(on ? 'TEST MODE ON - ALL TECH UNLOCKED' : 'TEST MODE OFF - NORMAL PROGRESSION', W / 2, ty + 7, 5.2, on ? '#aef0ae' : '#9aa0b0', 'center', 800, true);
    }
    const by = Math.max(cy + 150, H * 0.5);
    const save = G.hasSave();
    TITLE_BTN.cont = save ? [W / 2 - 60, by, 120, 17] : null;
    TITLE_BTN.neu = [W / 2 - 60, by + (save ? 21 : 0), 120, 17];
    TITLE_BTN.dossier = [W / 2 - 60, by + (save ? 42 : 21), 58, 14];
    TITLE_BTN.save = [W / 2 + 2, by + (save ? 42 : 21), 58, 14];
    if (save) menuBtn(TITLE_BTN.cont, 'CONTINUE  -  HANGAR', blink(1.6));
    menuBtn(TITLE_BTN.neu, 'NEW CAMPAIGN', !save && blink(1.6));
    menuBtn(TITLE_BTN.dossier, 'DOSSIER', false); menuBtn(TITLE_BTN.save, 'SAVE / LOAD', false);
    const ty = by + (save ? 66 : 45);
    text('HI-SCORE  ' + String(hiscore).padStart(7, '0'), W / 2, ty, 7, PAPER, 'center', 700, true);
    const lines = G.touchMode
      ? ['DRAG TO FLY - FIRE IS AUTOMATIC WHILE TOUCHING', 'MODE BUTTON: GUNS <-> BOMBS   LOOP: EVADE', 'ARM IN THE HANGAR  -  WATCH FUEL AND ARMOR']
      : ['ARROWS/WASD MOVE   SPACE/Z FIRE   Q/TAB GUNS<->BOMBS', 'X/SHIFT LOOP   P PAUSE   M SOUND   B MUSIC   F FULLSCREEN', 'ARM IN THE HANGAR  -  WATCH FUEL AND ARMOR'];
    const ly = Math.min(H - 36, ty + 22);
    lines.forEach((l, i) => text(l, W / 2, ly + i * 9, 5.4, i === 2 ? '#f3b49a' : '#d8dde6', 'center', 700, true));
    text('ORIGINAL FAN TRIBUTE - NOT AFFILIATED WITH CAPCOM', W / 2, H - 8, 4.6, 'rgba(210,214,224,0.6)', 'center', 600, false);
  }
  function drawLoading() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const c = ctx.canvas;
    const g = ctx.createLinearGradient(0, 0, 0, c.height); g.addColorStop(0, '#07131f'); g.addColorStop(1, '#0b2f52');
    ctx.fillStyle = g; ctx.fillRect(0, 0, c.width, c.height);
    hudT();
    devilMark(W / 2, H * 0.4 - 38, 20, '#e6c36e', 0.9);
    ctx.font = 'italic 900 30px "Arial Black", Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#d9b860'; ctx.fillText('FORK-TAILED', W / 2, H * 0.4);
    text('D E V I L', W / 2, H * 0.4 + 24, 12, PAPER, 'center', 800, false);
    const bw = 160, bx = (W - bw) / 2, by = H * 0.4 + 52;
    ctx.fillStyle = '#05080c'; ctx.fillRect(bx - 1, by - 1, bw + 2, 7);
    ctx.strokeStyle = 'rgba(217,184,96,0.7)'; ctx.lineWidth = 0.6; ctx.strokeRect(bx - 1, by - 1, bw + 2, 7);
    ctx.fillStyle = '#d9b860'; ctx.fillRect(bx, by, bw * loadP, 5);
    text('LOADING ' + Math.round(loadP * 100) + '%', W / 2, by + 15, 6.5, '#c9c2ad', 'center', 700, false);
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
      text('FUEL+ARMOR BONUS  ' + clearBonus, W / 2, H * 0.36 + 20, 8, PAPER, 'center', 700);
      text('MERIT  ' + (run ? run.merit : 0) + '  -  TO THE HANGAR', W / 2, H * 0.36 + 33, 7, '#9fe07a', 'center', 700);
    }
    if (p && !p.dead && p.fuel < ST.fuelMax * 0.2 && blink(3)) text(p.stall > 0 ? 'ENGINE STALL - FIND FUEL!' : 'LOW FUEL!', W / 2, H - 46, 8.5, '#ff5a4a', 'center', 800);
    else if (p && !p.dead && p.armor < ST.armorMax * 0.2 && blink(3)) text('HEAVY DAMAGE!', W / 2, H - 46, 8.5, '#ff7a4a', 'center', 800);
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
