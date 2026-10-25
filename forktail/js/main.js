/* Fork-Tailed Devil - layout (iOS-safe sizing), input, main loop. */
(function (S) {
  'use strict';
  const G = S.game, A = S.audio;
  const app = document.getElementById('app');
  const cv = document.getElementById('cv');
  const fieldEl = document.getElementById('field');
  const ctx = cv.getContext('2d', { alpha: true });
  const W = G.W;
  let LH = 480, cssW = 0, cssH = 0, spriteK = 0, resizeTimer = 0, assetsReady = false, curK = 2;

  // ---------------- viewport sizing: min(visualViewport.height, innerHeight), never 100vh/dvh/screen.height
  function syncViewport() {
    const vv = window.visualViewport, ih = window.innerHeight;
    const h = Math.floor(Math.min(ih, vv && vv.height > 0 ? vv.height : ih));
    if (h > 0) document.documentElement.style.setProperty('--app-h', h + 'px');
    layout();
  }
  function layout() {
    const cs = getComputedStyle(app);
    const aw = app.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const ah = app.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (aw <= 0 || ah <= 0) return;
    // Portrait playfield: logical width 270, height between 420 (≈2:3) and 585 (≈9:19.5) to fill tall phones.
    LH = Math.round(Math.min(585, Math.max(420, W * ah / aw)));
    let w = Math.min(aw, ah * W / LH), h = w * LH / W;
    w = Math.floor(w); h = Math.floor(Math.min(ah, h));
    cssW = w; cssH = h;
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    fieldEl.style.width = w + 'px'; fieldEl.style.height = h + 'px';
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    S.view = { w, h, dpr };
    cv.width = Math.max(1, Math.round(w * dpr)); cv.height = Math.max(1, Math.round(h * dpr));
    const K = cv.width / W; curK = K;
    LH = cv.height / K; // exact logical height for the rounded canvas
    if (assetsReady && Math.abs(K - spriteK) > 0.02) { spriteK = K; S.buildSprites(K); }
    ctx.imageSmoothingEnabled = true;
    G.setView(LH, K, ctx);
    if (S.r3d && S.r3d.ok) S.r3d.resize(w, h, dpr, LH);
  }
  S.relayout = layout;
  function scheduleLayout() { clearTimeout(resizeTimer); syncViewport(); resizeTimer = setTimeout(syncViewport, 180); }
  window.addEventListener('resize', scheduleLayout);
  window.addEventListener('orientationchange', () => { setTimeout(syncViewport, 120); setTimeout(syncViewport, 500); });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', scheduleLayout);
  window.addEventListener('pageshow', syncViewport);
  syncViewport();
  G.init();
  S.loadAssets((d, n) => G.setLoadProgress(n ? d / n : 1)).then(() => {
    assetsReady = true; spriteK = curK; S.buildSprites(curK); G.ready();
  });

  // ---------------- fullscreen
  const de = document.documentElement;
  const fsReq = de.requestFullscreen || de.webkitRequestFullscreen;
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
  const fsExit = document.exitFullscreen || document.webkitExitFullscreen;
  G.fsSupported = !!(fsReq && (document.fullscreenEnabled || document.webkitFullscreenEnabled));
  function toggleFullscreen() {
    if (!G.fsSupported) return;
    try {
      if (fsEl()) fsExit.call(document);
      else { const r = fsReq.call(de); if (r && r.catch) r.catch(() => {}); }
    } catch (e) {}
  }
  G.onToggleFullscreen = toggleFullscreen;
  document.addEventListener('fullscreenchange', scheduleLayout);
  document.addEventListener('webkitfullscreenchange', scheduleLayout);

  // ---------------- keyboard
  const keys = new Set();
  const MOVE = { ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r', ArrowUp: 'u', KeyW: 'u', ArrowDown: 'd', KeyS: 'd' };
  function axes() {
    let l = 0, r = 0, u = 0, d = 0;
    for (const k of keys) { const m = MOVE[k]; if (m === 'l') l = 1; else if (m === 'r') r = 1; else if (m === 'u') u = 1; else if (m === 'd') d = 1; }
    G.input.ax = r - l; G.input.ay = d - u;
    G.input.fire = keys.has('Space') || keys.has('KeyZ');
  }
  window.addEventListener('keydown', (e) => {
    const c = e.code;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    A.unlock();
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(c)) e.preventDefault();
    if (e.repeat) { if (MOVE[c] || c === 'Space' || c === 'KeyZ') return; }
    keys.add(c);
    const st = G.state();
    if (c === 'KeyM') { G.toggleMute(); return; }
    if (c === 'KeyB') { A.toggleMusic(); return; }
    if (S.ui && S.ui.open) return; // hangar / map / dossier panels take the keyboard
    if (c === 'KeyF') { toggleFullscreen(); return; }
    if (st === 'title' || st === 'gameover') {
      if (c === 'Enter' || c === 'Space' || c === 'KeyZ' || c === 'NumpadEnter') { if (G.start()) { keys.delete('Space'); keys.delete('KeyZ'); } }
    } else if (st === 'play') {
      if (c === 'KeyP' || c === 'Escape') G.togglePause();
      else if (G.isPaused() && c === 'Enter') G.setPaused(false);
      else if (!e.repeat && (c === 'KeyX' || c === 'ShiftLeft' || c === 'ShiftRight')) G.loop();
      else if (!e.repeat && (c === 'KeyQ' || c === 'Tab')) G.toggleMode();
    }
    axes();
  });
  window.addEventListener('keyup', (e) => { keys.delete(e.code); axes(); });
  window.addEventListener('blur', () => { keys.clear(); axes(); G.input.touching = false; dragId = null; if (G.state() === 'play') G.setPaused(true); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (G.state() === 'play') G.setPaused(true); G.saveNow(); if (S.saves) S.saves.autosave('background'); A.suspend(); }
    else { A.resume(); syncViewport(); }
  });

  // ---------------- pointer / touch: drag anywhere moves the plane relative to the finger
  const SENS = 1.25;
  let dragId = null, lastX = 0, lastY = 0;
  const pointers = new Set();
  function toLogical(e) {
    const r = cv.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * LH];
  }
  window.addEventListener('pagehide', () => { G.saveNow(); if (S.saves) S.saves.autosave('background'); });
  window.addEventListener('pointerdown', (e) => {
    A.unlock();
    if (e.target && e.target.closest && e.target.closest('#ui .panel, #ui .toast')) return; // DOM UI handles its own input
    if (e.pointerType === 'touch' || e.pointerType === 'pen') G.touchMode = true;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointers.add(e.pointerId);
    const [lx, ly] = toLogical(e);
    if (G.handleTap(lx, ly)) return;
    const st = G.state();
    if (st === 'play' && G.isPaused()) { G.setPaused(false); return; }
    if (st === 'title' || st === 'gameover') G.start();
    if (dragId !== null && dragId !== e.pointerId) { G.loop(); return; } // second finger = loop
    dragId = e.pointerId; lastX = e.clientX; lastY = e.clientY;
    if (G.state() === 'play') G.input.touching = true;
    e.preventDefault();
  }, { passive: false });
  window.addEventListener('pointermove', (e) => {
    if (e.pointerId !== dragId) return;
    const r = cv.getBoundingClientRect();
    const k = W / r.width;
    const mdx = e.clientX - lastX, mdy = e.clientY - lastY;
    if (G.state() === 'play' && !G.isPaused()) {
      G.input.dx += mdx * k * SENS;
      G.input.dy += mdy * k * SENS;
      G.input.touching = true;
    }
    lastX = e.clientX; lastY = e.clientY;
    e.preventDefault();
  }, { passive: false });
  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (e.pointerId === dragId) { dragId = null; G.input.touching = false; }
  }
  window.addEventListener('pointerup', endPointer);
  window.addEventListener('pointercancel', endPointer);
  // block scrolling, pinch-zoom, double-tap zoom, pull-to-refresh, callouts
  const stop = (e) => { if (e.cancelable) e.preventDefault(); };
  // The DOM overlay must keep native touch behaviour: preventDefault on touchend cancels the
  // synthesized click, which kills every DOM button on a touch device, and preventDefault on
  // touchmove stops the panels scrolling.
  // Ask the hit test, not a list of class names. #ui is click-through except where a control says
  // otherwise, so a touch only lands INSIDE it when it landed on something meant to be pressed -
  // which is exactly the question. A list gets this wrong the first time anything is renamed, and
  // it did: the radio card stopped being .toast, and the new-build banner never was in #ui at all,
  // so TAP TO UPDATE did nothing on a phone.
  const inUI = (e) => { const t = e.target; return !!(t && t.closest && t.closest('#ui, .update')); };
  document.addEventListener('touchmove', (e) => { if (!inUI(e)) stop(e); }, { passive: false });
  document.addEventListener('touchstart', (e) => { A.unlock(); if (!inUI(e) && e.touches.length > 1) stop(e); }, { passive: false });
  document.addEventListener('touchend', (e) => { A.unlock(); if (!inUI(e)) stop(e); }, { passive: false });
  document.addEventListener('gesturestart', stop, { passive: false });
  document.addEventListener('gesturechange', stop, { passive: false });
  document.addEventListener('dblclick', stop, { passive: false });
  document.addEventListener('contextmenu', stop);
  document.addEventListener('selectstart', stop);
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(pointer: fine)').matches) G.touchMode = true;

  // ---------------- main loop
  let last = performance.now();
  function frame(now) {
    let dt = (now - last) / 1000; last = now;
    if (dt > 0.05) dt = 0.05; if (dt < 0) dt = 0;
    if (dt > 1 / 45) { G.update(dt / 2); G.update(dt / 2); } else G.update(dt);
    if (S.r3d && S.r3d.ok) S.r3d.render(G.world(), dt);
    G.render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})(window.SKY);
