/* Fork-Tailed Devil - sprite loading + pre-scaling.
   Photographic-style art lives in assets/*.webp (generated, cut out and trimmed offline; see assets/CREDITS.md).
   Everything is pre-scaled once per resolution into offscreen canvases so the frame loop only does drawImage. */
window.SKY = window.SKY || {};
(function (S) {
  'use strict';
  const SP = {};
  S.sprites = SP;
  const META = window.SKY_META || {};
  const IMG = {};
  const TAU = Math.PI * 2;
  let scale = 2;
  const FILTER_OK = typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype;

  // ---------------- loading
  function list() {
    const out = [];
    for (const k in META) {
      const v = META[k];
      if (Array.isArray(v)) v.forEach((e, i) => out.push([k + i, e.src]));
      else if (v && v.src) out.push([k, v.src]);
    }
    return out;
  }
  S.loadAssets = function (onProgress) {
    const items = list();
    let done = 0, failed = [];
    onProgress && onProgress(0, items.length);
    return Promise.all(items.map(([key, src]) => new Promise((resolve) => {
      const im = new Image();
      im.decoding = 'async';
      im.onload = () => {
        const fin = () => { IMG[key] = im; done++; onProgress && onProgress(done, items.length); resolve(); };
        if (im.decode) im.decode().then(fin, fin); else fin();
      };
      im.onerror = () => { failed.push(src); done++; onProgress && onProgress(done, items.length); resolve(); };
      im.src = src;
    }))).then(() => { S.assetErrors = failed; if (failed.length) console.warn('Missing assets: ' + failed.join(', ')); return failed; });
  };

  // ---------------- helpers
  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function scaled(img, w, h) {
    // high-quality downscale (progressive halving) to an exact pixel size
    let src = img, sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height;
    while (sw / 2 >= w * 1.15 && sh / 2 >= h * 1.15) {
      const c = canvas(Math.ceil(sw / 2), Math.ceil(sh / 2)), g = c.getContext('2d');
      g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, c.width, c.height);
      src = c; sw = c.width; sh = c.height;
    }
    const c = canvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h))), g = c.getContext('2d');
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }
  function fromImg(key, lw, lh) {
    const im = IMG[key];
    if (!im) return placeholder(lw, lh);
    return { c: scaled(im, lw * scale, lh * scale), w: lw, h: lh };
  }
  // Your own aircraft has to be findable at a glance against a sunlit sea, and it was the one thing
  // on screen with no edge of its own. Ring it: the silhouette stamped eight ways round a small
  // circle, filled black, with the aircraft laid back over the top.
  function outlined(sp, px) {
    if (!sp || !sp.c) return sp;
    const r = Math.max(1, Math.round(px * scale));
    const c = canvas(sp.c.width + r * 2, sp.c.height + r * 2), g = c.getContext('2d');
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      g.drawImage(sp.c, r + Math.cos(a) * r, r + Math.sin(a) * r);
    }
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'source-over';
    g.drawImage(sp.c, r, r);
    // the logical size grows with the border so the art inside keeps its scale
    return { c, w: sp.w + r * 2 / scale, h: sp.h + r * 2 / scale };
  }
  function placeholder(w, h) { return mk(w, h, (g) => { g.fillStyle = 'rgba(120,120,120,0.6)'; g.fillRect(0, 0, w, h); }); }
  function mk(w, h, fn) {
    const c = canvas(Math.max(1, Math.ceil(w * scale)), Math.max(1, Math.ceil(h * scale)));
    const g = c.getContext('2d');
    g.scale(c.width / w, c.height / h);
    g.lineJoin = 'round'; g.lineCap = 'round';
    fn(g, w, h);
    return { c, w, h };
  }
  function tint(sp, color, blur) {
    const c = canvas(sp.c.width, sp.c.height), g = c.getContext('2d');
    g.drawImage(sp.c, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color; g.fillRect(0, 0, c.width, c.height);
    if (blur) { // soft shadow: blurred once at build time (never per frame)
      const c2 = canvas(c.width, c.height), g2 = c2.getContext('2d');
      if (FILTER_OK) { g2.filter = `blur(${blur}px)`; g2.drawImage(c, 0, 0); }
      else { // fallback for browsers without ctx.filter: stack offset copies
        const r = Math.max(1, Math.round(blur)), n = 8; g2.globalAlpha = 1 / 3;
        g2.drawImage(c, 0, 0);
        for (let i = 0; i < n; i++) { const a = i / n * TAU; g2.drawImage(c, Math.cos(a) * r, Math.sin(a) * r); }
      }
      return { c: c2, w: sp.w, h: sp.h };
    }
    return { c, w: sp.w, h: sp.h };
  }
  function radial(size, stops) {
    return mk(size, size, (g) => {
      const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      for (const [o, c] of stops) gr.addColorStop(o, c);
      g.fillStyle = gr; g.fillRect(0, 0, size, size);
    });
  }
  function ell(g, x, y, rx, ry) { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); }

  // power-up medallions: GUN family = round brass medal (blue core), BOMB family = hexagon (red/orange core),
  // REPAIR = white roundel with green cross. [core, dark, label, text color, family]
  const POW_STYLE = {
    spread: ['#3a7fd8', '#0f2a55', '3W', '#fff', 'gun'], laser: ['#1ab6cd', '#08434f', 'L', '#fff', 'gun'], shotgun: ['#3a6ac8', '#10245a', 'S', '#fff', 'gun'],
    auto: ['#3a8ae0', '#0c2a5a', 'A', '#fff', 'gun'], gunup: ['#5aa0f0', '#103060', '+', '#fff', 'gun'],
    cluster: ['#e0682a', '#5e2006', 'C', '#fff', 'bomb'], napalm: ['#e8401a', '#601006', 'F', '#fff', 'bomb'], torpedo: ['#d0502a', '#501a08', 'T', '#fff', 'bomb'],
    rapid: ['#e0782a', '#5a2a06', 'R', '#fff', 'bomb'], nuke: ['#f2c21b', '#6b4a00', 'N', '#111', 'bomb'],
    repair: ['#f4f4ee', '#9aa0a0', '+', '#1e9a3a', 'repair'],
  };
  S.POW_STYLE = POW_STYLE;

  S.buildSprites = function (k) {
    scale = Math.max(1, Math.min(4, k));
    SP.scale = scale;
    const M = META;
    SP.player = outlined(fromImg('player', M.player.w, M.player.h), 1.1);
    SP.zero = fromImg('zero', M.zero.w, M.zero.h);
    SP.zeroRed = fromImg('zero_red', M.zero_red.w, M.zero_red.h);
    SP.bomber = fromImg('bomber', M.bomber.w, M.bomber.h);
    SP.bossBomber = fromImg('heavy', M.heavy.w, M.heavy.h);
    const sb = Math.max(0.6, scale * 0.7);
    for (const n of ['player', 'zero', 'zeroRed', 'bomber', 'bossBomber']) {
      SP[n + '_sh'] = tint(SP[n], '#000', sb);
      SP[n + '_w'] = tint(SP[n], '#fff');
    }
    SP.destroyer = fromImg('destroyer', M.destroyer.w, M.destroyer.h);
    SP.battleship = fromImg('battleship', M.battleship.w, M.battleship.h);
    SP.bossShip = fromImg('bossShip', M.bossShip.w, M.bossShip.h);
    for (const n of ['destroyer', 'battleship', 'bossShip']) { SP[n + '_w'] = tint(SP[n], '#fff'); SP[n + '_sh'] = tint(SP[n], '#000', sb * 1.5); }
    SP.turretBig = fromImg('turretBig', M.turretBig.w, M.turretBig.h);
    SP.turretSmall = fromImg('turretSmall', M.turretSmall.w, M.turretSmall.h);
    SP.turretBig_w = tint(SP.turretBig, '#fff'); SP.turretSmall_w = tint(SP.turretSmall, '#fff');
    SP.turretBig_sh = tint(SP.turretBig, '#000', sb); SP.turretSmall_sh = tint(SP.turretSmall, '#000', sb);
    SP.islands = M.islands.map((e, i) => fromImg('islands' + i, e.w, e.h));
    SP.clouds = M.clouds.map((e, i) => fromImg('clouds' + i, e.w, e.h));
    SP.cloudsSh = SP.clouds.map((c) => tint(c, '#02101e', sb * 3));
    SP.ocean = fromImg('ocean', M.ocean.w, M.ocean.h);
    if (M.logo) SP.logo = fromImg('logo', M.logo.w, M.logo.h);
    SP.fireball = fromImg('fireball', 64, 64 * M.fireball.h);
    SP.smoke = fromImg('smoke', 40, 40 * M.smoke.h);
    { const g = SP.smoke.c.getContext('2d'); g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(28,24,22,0.55)'; g.fillRect(0, 0, SP.smoke.c.width, SP.smoke.c.height); }
    SP.splash = fromImg('splash', 44, 44 * M.splash.h);
    SP.nukeImg = fromImg('nuke', 130, 130 * M.nuke.h);
    SP.glow = radial(32, [[0, 'rgba(255,250,235,1)'], [0.2, 'rgba(255,220,140,0.9)'], [0.5, 'rgba(255,130,40,0.4)'], [1, 'rgba(255,60,0,0)']]);
    SP.flare = radial(32, [[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,250,230,0.7)'], [1, 'rgba(255,240,200,0)']]);
    SP.foam = radial(12, [[0, 'rgba(255,255,255,0.8)'], [0.5, 'rgba(235,245,255,0.38)'], [1, 'rgba(230,240,255,0)']]);
    SP.ebullet = mk(10, 10, (g) => {
      const gr = g.createRadialGradient(5, 5, 0, 5, 5, 5);
      // violet, not the amber your own guns use - and rimmed, so it survives the glitter on the sea
      gr.addColorStop(0, '#fff0ff'); gr.addColorStop(0.3, '#ff72e4'); gr.addColorStop(0.55, 'rgba(222,24,160,0.9)'); gr.addColorStop(1, 'rgba(70,0,56,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 10, 10);
      g.strokeStyle = 'rgba(26,0,22,0.7)'; g.lineWidth = 0.7; ell(g, 5, 5, 2.6, 2.6); g.stroke();
    });
    SP.pbullet = mk(3, 13, (g) => {
      const gr = g.createLinearGradient(0, 0, 0, 13); gr.addColorStop(0, '#fffef2'); gr.addColorStop(0.3, '#ffe27a'); gr.addColorStop(1, 'rgba(255,150,20,0)');
      g.fillStyle = gr; g.fillRect(0.5, 0, 2, 13);
      g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(1.1, 0.3, 0.8, 4);
    });
    SP.laser = mk(5, 24, (g) => {
      const gr = g.createLinearGradient(0, 0, 5, 0); gr.addColorStop(0, 'rgba(40,200,255,0)'); gr.addColorStop(0.5, '#eaffff'); gr.addColorStop(1, 'rgba(40,200,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 5, 24);
      g.fillStyle = 'rgba(80,220,255,0.5)'; g.fillRect(0.8, 0, 3.4, 24);
      g.fillStyle = '#fff'; g.fillRect(2, 0, 1, 24);
    });
    SP.pellet = radial(7, [[0, '#fff'], [0.4, '#ffd27a'], [0.75, 'rgba(255,120,20,0.7)'], [1, 'rgba(255,80,0,0)']]);
    SP.bomb = mk(6, 13, (g) => { // small streamlined bomb, nose up
      const gr = g.createLinearGradient(1.5, 0, 4.5, 0); gr.addColorStop(0, '#3b3f2c'); gr.addColorStop(0.5, '#9aa37a'); gr.addColorStop(1, '#3b3f2c');
      g.fillStyle = '#2a2d22'; g.beginPath(); g.moveTo(3, 8.5); g.lineTo(5.8, 12.6); g.lineTo(0.2, 12.6); g.closePath(); g.fill();
      g.fillStyle = gr; ell(g, 3, 5.4, 1.7, 5); g.fill();
      g.fillStyle = '#f2c21b'; g.fillRect(1.4, 3.2, 3.2, 0.9);
      g.fillStyle = 'rgba(255,255,255,0.35)'; ell(g, 2.4, 3, 0.4, 1.6); g.fill();
    });
    SP.pow = {};
    const hex = (g, x, y, r) => { g.beginPath(); for (let i = 0; i < 6; i++) { const a = i * TAU / 6 + Math.PI / 6; g[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * r, y + Math.sin(a) * r); } g.closePath(); };
    const rr = (g, x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
    for (const t in POW_STYLE) {
      const [c, d, label, tc, fam] = POW_STYLE[t];
      SP.pow[t] = mk(22, 22, (g) => {
        g.fillStyle = 'rgba(0,0,0,0.35)';
        const shape = (r) => fam === 'bomb' ? hex(g, 11, 11, r) : ell(g, 11, 11, r, r);
        g.save(); g.translate(0.6, 0.8); shape(9.6); g.fill(); g.restore();
        // rim
        const rim = g.createLinearGradient(0, 2, 0, 20);
        if (fam === 'gun') { rim.addColorStop(0, '#fff0b8'); rim.addColorStop(0.5, '#c8962e'); rim.addColorStop(1, '#6a4a10'); }
        else if (fam === 'bomb') { rim.addColorStop(0, '#e8e8e8'); rim.addColorStop(0.5, '#8a8e94'); rim.addColorStop(1, '#3a3e44'); }
        else { rim.addColorStop(0, '#ffffff'); rim.addColorStop(1, '#7a8a80'); }
        g.fillStyle = rim; shape(9.6); g.fill();
        const gr = g.createRadialGradient(8.4, 7.6, 0.5, 11, 11, 8);
        gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.2, c); gr.addColorStop(1, d);
        g.fillStyle = gr; shape(7.4); g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 0.5; g.stroke();
        if (fam === 'repair') { g.fillStyle = tc; g.fillRect(9.3, 5.6, 3.4, 10.8); g.fillRect(5.6, 9.3, 10.8, 3.4); }
        else {
          g.font = `900 ${label.length > 3 ? 4.6 : label.length > 1 ? 6.4 : 8.6}px "Arial Black", Arial, Helvetica, sans-serif`;
          g.textAlign = 'center'; g.textBaseline = 'middle';
          g.lineWidth = 1.3; g.strokeStyle = tc === '#111' || tc === '#1a1200' ? 'rgba(255,240,170,0.7)' : 'rgba(0,0,0,0.55)'; g.strokeText(label, 11, 11.6);
          g.fillStyle = tc; g.fillText(label, 11, 11.6);
        }
        const hl = g.createLinearGradient(0, 3, 0, 12); hl.addColorStop(0, 'rgba(255,255,255,0.35)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = hl; ell(g, 11, 7.5, 5.5, 3.4); g.fill();
      });
    }
    SP.carrier = fromImg('carrier', M.carrier ? M.carrier.w : 65, M.carrier ? M.carrier.h : 270);
    SP.carrier_w = tint(SP.carrier, '#fff');
  };
})(window.SKY);
