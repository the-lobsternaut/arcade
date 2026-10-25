/* Fork-Tailed Devil - character portraits.

   A portrait is one finished picture, or a short clip, and it comes out of assets/pack.bin. There
   is no procedural stand-in any more: a character either has art or gets the call-sign badge the
   UI falls back to, which is honest about what exists rather than drawing something worse.

   The engine adds what the art cannot: a slow breath, a parallax tilt, and for a clip, playback
   driven by whether she is actually saying anything. A talking clip left to loop mouths away at an
   empty room, so it runs while there is a line to deliver and parks on its first frame when there
   is not - which is why those clips are authored with the mouth shut on frame one. Screens where
   she is simply present rather than mid-sentence pass `animate`, and then it just runs.

   API: attach / show / expr / talk / hide / preload / has / info. */
const VW = 1024, VH = 1536;      // the space portraits are authored in; a 2:3 frame
const FACE_Y = 0.21;             // where the eyes sit as a fraction of height, unless art says otherwise

export function createChars(S) {
  const P = { ok: true, current: null, mode: 'pack' };
  const canvas = document.createElement('canvas');
  canvas.className = 'charcv';
  const ctx = canvas.getContext('2d');
  let host = null, raf = 0, visible = false, cur = null, framing = 'bust', always = false;
  let vw = 2, vh = 2, dpr = 1;

  const pack = S.pack;
  const manifest = (pack && pack.json('manifest')) || {};
  P.has = (id) => !!manifest[id];

  function entryOf(id) {
    const e = manifest[id];
    if (!e) return null;
    return Array.isArray(e) ? { face: 0, video: false } : { face: e.face || 0, video: !!e.video };
  }

  // ---------------------------------------------------------------- loading
  function loadImg(src) {
    return new Promise((res) => { const im = new Image(); im.decoding = 'async'; im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
  }
  // Muted and playsinline are not decoration: without both, iOS will not start a clip without a
  // tap, and a portrait nobody tapped would sit on frame one for good. Primed and parked on load
  // so the first frame is decoded before anyone speaks.
  function loadVid(src) {
    return new Promise((res) => {
      const v = document.createElement('video');
      v.muted = true; v.defaultMuted = true; v.loop = true; v.preload = 'auto'; v.playsInline = true;
      v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
      let done = false;
      const ok = () => {
        if (done) return; done = true;
        const park = () => { try { v.pause(); v.currentTime = 0; } catch (e) {} res(v); };
        const pr = v.play();
        if (pr && pr.then) pr.then(park).catch(park); else park();
      };
      v.oncanplay = ok;
      v.onerror = () => { if (!done) { done = true; res(null); } };
      setTimeout(() => { if (!done) { done = true; res(v.readyState >= 2 ? v : null); } }, 8000);
      v.src = src; v.load();
    });
  }

  function build(id) {
    const e = entryOf(id);
    if (!e || !pack) return Promise.resolve(null);
    const shell = (src) => ({ id, src, face: e.face, vid: !!(src && src.tagName === 'VIDEO'), t: Math.random() * 10, talkT: 0, expr: 'neutral' });
    const still = () => loadImg(pack.url('portrait/' + id)).then((im) => (im ? shell(im) : null));
    // the clip is the portrait when it plays; the still beside it is what a browser that will not
    // play it falls back to, so a missing codec costs the animation and nothing else
    if (e.video && pack.has('video/' + id)) return loadVid(pack.url('video/' + id)).then((v) => (v ? shell(v) : still()));
    return still();
  }

  // A portrait is a full-frame bitmap, so a handful of them is real memory on a phone. Keep the few
  // most recent; an evicted one hands its pixels back rather than waiting for the collector.
  const KEEP = 4;
  const cache = new Map();
  function touch(id, e) { cache.delete(id); cache.set(id, e); }
  function evict() {
    while (cache.size > KEEP) {
      const id = cache.keys().next().value, e = cache.get(id);
      if (id === P.current) { touch(id, e); continue; }
      cache.delete(id);
      const src = e && e.ch && e.ch.src;
      if (src && src.tagName === 'VIDEO') { try { src.pause(); src.removeAttribute('src'); src.load(); } catch (err) {} }
      if (e && e.ch) e.ch.src = null;
    }
  }
  function entry(id) {
    let e = cache.get(id);
    if (e) { touch(id, e); return e; }
    e = { p: build(id), ch: null };
    cache.set(id, e);
    e.p.then((ch) => { e.ch = ch; evict(); });
    return e;
  }

  // ---------------------------------------------------------------- canvas
  function resize() {
    if (!host) return;
    const r = host.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    vw = Math.max(2, Math.round(r.width)); vh = Math.max(2, Math.round(r.height));
    canvas.width = Math.round(vw * dpr); canvas.height = Math.round(vh * dpr);
  }

  function draw(dt) {
    const ch = cur;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!ch || !ch.src) return;
    ch.t += dt;
    if (ch.talkT > 0) ch.talkT = Math.max(0, ch.talkT - dt);

    if (ch.vid) {
      const v = ch.src;
      if (always || ch.talkT > 0) { if (v.paused) { const pr = v.play(); if (pr && pr.catch) pr.catch(() => {}); } }
      else if (!v.paused) { try { v.pause(); v.currentTime = 0; } catch (e) {} }
      if (v.readyState < 2) return;                 // nothing decoded yet: draw nothing, not a black box
    }

    const breath = Math.sin(ch.t * 1.5) * 0.004;
    const tiltX = Math.sin(ch.t * 0.55) * 7, tiltY = Math.cos(ch.t * 0.42) * 4;

    // 'head' crops to the face for a toast, 'fit' shows the whole picture, anything else fills the
    // box. A figure posed low in frame carries its own face anchor, since the default assumes she
    // is standing square with her eyes in the upper fifth.
    const headShot = framing === 'head', whole = framing === 'fit';
    const faceY = VH * (ch.face || FACE_Y);
    const scale = headShot ? (vh / VH) * 2.15 : whole ? Math.min(vw / VW, vh / VH) : Math.max(vw / VW, vh / VH) * 1.02;
    const ox = vw / 2 - (VW / 2) * scale;
    const oy = headShot ? vh * 0.5 - faceY * scale : whole ? vh / 2 - (VH / 2) * scale : vh - VH * scale * 0.995;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    ctx.translate(ox + tiltX * 0.15, oy + tiltY * 0.15);
    ctx.scale(scale, scale * (1 + breath));
    ctx.drawImage(ch.src, 0, 0, VW, VH);
    ctx.restore();
  }

  let last = 0;
  function tick(now) {
    if (!visible) { raf = 0; return; }
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
    draw(dt);
    raf = requestAnimationFrame(tick);
  }
  function start() { if (!raf && visible) { last = performance.now(); raf = requestAnimationFrame(tick); } }

  // ---------------------------------------------------------------- API
  P.attach = function (el) { host = el; if (canvas.parentNode !== el) el.appendChild(canvas); resize(); };
  P.show = function (id, look, opt) {
    opt = opt || {}; framing = opt.framing || 'bust'; always = !!opt.animate; visible = true; resize();
    const want = id; P.current = id;
    const go = (ch) => { if (P.current !== want) return; cur = ch; P.expr(opt.expr || 'neutral'); start(); };
    const e = entry(id);
    if (e.ch) return go(e.ch);
    e.p.then(go).catch((err) => console.warn('portrait failed', id, err));
  };
  P.expr = function (e) { if (cur) cur.expr = e || 'neutral'; };
  P.talk = function (sec) { if (cur) cur.talkT = Math.max(cur.talkT, sec || 2); };
  P.hide = function () {
    visible = false; if (raf) cancelAnimationFrame(raf); raf = 0;
    // the draw loop is what pauses a clip; stop the loop without this and she talks on off-screen
    if (cur && cur.vid && cur.src) { try { cur.src.pause(); } catch (e) {} }
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas); host = null;
  };
  P.preload = (ids) => Promise.all((ids || []).filter(P.has).map((i) => entry(i).p));
  P.info = () => ({ current: P.current, mode: 'pack', withArt: Object.keys(manifest),
                    cached: cache.size, visible, looping: !!raf, animate: always, framing,
                    curId: cur && cur.id, curT: cur && +cur.t.toFixed(1) });
  window.addEventListener('resize', resize);
  return P;
}
