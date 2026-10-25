import { Game, COLORS, CELLS, ROWS } from './game.js';
import { Renderer3D } from './render3d.js';

const $ = (id) => document.getElementById(id);
const HS_KEY = 'tetris3d.highscore';
const SOUND_KEY = 'tetris3d.sound';

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

let best = parseInt(store.get(HS_KEY, '0'), 10) || 0;
let soundOn = store.get(SOUND_KEY, '1') === '1';

// ---------------- audio (tiny WebAudio synth) ----------------
let actx = null;
function audio() {
  if (!soundOn) return null;
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    actx = new AC();
  }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
function tone(freq, dur = 0.08, type = 'square', vol = 0.06, slide = 0) {
  const a = audio(); if (!a) return;
  const t = a.currentTime;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
const sfx = {
  move: () => tone(220, 0.03, 'square', 0.025),
  rotate: () => tone(440, 0.05, 'triangle', 0.05, 120),
  lock: () => tone(120, 0.08, 'sine', 0.09, -40),
  drop: () => tone(160, 0.12, 'sawtooth', 0.06, -100),
  hold: () => tone(520, 0.08, 'triangle', 0.05, -200),
  clear: (n) => { const base = [0, 523, 587, 659, 784][n]; [0, 1, 2].forEach((i) => setTimeout(() => tone(base * (1 + i * 0.25), 0.12, 'triangle', 0.07), i * 60)); },
  level: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.12, 'square', 0.04), i * 80)),
  over: () => [392, 330, 262, 196].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'sawtooth', 0.05), i * 160)),
};

// ---------------- viewport height (iOS standalone / toolbars) ----------------
function syncViewportHeight() {
  // Size the layout to what is actually visible; never taller than innerHeight.
  const vv = window.visualViewport;
  const ih = window.innerHeight;
  const h = Math.floor(Math.min(ih, vv && vv.height > 0 ? vv.height : ih));
  if (h > 0) document.documentElement.style.setProperty('--app-h', `${h}px`);
}
syncViewportHeight();
window.addEventListener('resize', syncViewportHeight);
window.addEventListener('orientationchange', () => setTimeout(syncViewportHeight, 250));
window.visualViewport?.addEventListener('resize', syncViewportHeight);
window.addEventListener('pageshow', syncViewportHeight);

// ---------------- game + renderer ----------------
const stage = $('stage');
let r3d;
try {
  r3d = new Renderer3D($('gl'), stage);
} catch (e) {
  console.error(e);
  $('ovTitle').textContent = 'WebGL needed';
  $('ovText').textContent = 'Your browser could not start WebGL, which this 3D Tetris requires.';
  $('ovBtn').style.display = 'none';
  throw e;
}
window.__r3d = r3d; // camera state for debugging/tests (always starts head-on)

const game = new Game({
  move: () => sfx.move(),
  rotate: () => sfx.rotate(),
  hold: () => { sfx.hold(); drawHold(); },
  spawn: () => drawNext(),
  lock: (cells) => { r3d.lockFx(cells); sfx.lock(); },
  harddrop: (dist, cells) => { r3d.hardDropFx(cells, game.piece.type, dist); sfx.drop(); },
  clear: (rows, info) => {
    const n = rows.length;
    sfx.clear(n);
    const names = ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'TETRIS!'];
    const glow = ['', '#45d6ff', '#3fe07b', '#ffd83a', '#ff5ad8'][n];
    let sub = `+${info.points}`;
    if (info.b2b) sub = 'BACK-TO-BACK ' + sub;
    if (info.combo > 0) sub += ` · COMBO ×${info.combo}`;
    popup(names[n], sub, glow);
    if (n === 4) r3d.addShake(0.4);
  },
  rowsremoved: (removed) => r3d.burstRows(removed),
  levelup: (lvl) => { sfx.level(); setTimeout(() => popup(`LEVEL ${lvl}`, 'SPEED UP', '#b25cff'), 500); },
  gameover: (score) => onGameOver(score),
});
window.__tetris = game; // handy for debugging/tests

// ---------------- HUD ----------------
const hud = { score: $('score'), best: $('best'), level: $('level'), lines: $('lines') };
const last = { score: -1, best: -1, level: -1, lines: -1 };
const compactFmt = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
function setStat(k, v) {
  if (last[k] === v) return;
  const el = hud[k];
  const narrow = window.innerWidth < 440 && matchMedia('(orientation: portrait)').matches;
  const limit = window.innerWidth < 380 ? 10000 : 100000; // keep the compact phone HUD from overflowing
  el.textContent = narrow && v >= limit ? compactFmt.format(v) : v.toLocaleString();
  el.title = v.toLocaleString();
  if (last[k] !== -1 && k !== 'score') { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
  last[k] = v;
}
function updateHud() {
  setStat('score', game.score);
  setStat('best', Math.max(best, game.score));
  setStat('level', game.level);
  setStat('lines', game.lines);
}

function popup(text, sub, glow) {
  const el = document.createElement('div');
  el.className = 'popup';
  el.style.setProperty('--glow', glow);
  el.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`;
  $('popups').appendChild(el);
  setTimeout(() => el.remove(), 1200);
}

// 2D previews with beveled blocks
function hex(c) { return '#' + c.toString(16).padStart(6, '0'); }
function shade(c, f) {
  let r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  if (f > 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; } else { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
function fitCanvas(cv) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(cv.clientWidth * dpr)), h = Math.max(1, Math.round(cv.clientHeight * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  return cv.getContext('2d');
}
function drawBlock(ctx, x, y, s, color, alpha = 1) {
  ctx.globalAlpha = alpha;
  const r = s * 0.18;
  const grad = ctx.createLinearGradient(x, y, x + s, y + s);
  grad.addColorStop(0, shade(color, 0.35));
  grad.addColorStop(1, shade(color, -0.25));
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.roundRect(x + s * 0.04, y + s * 0.04, s * 0.92, s * 0.92, r); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.beginPath(); ctx.roundRect(x + s * 0.16, y + s * 0.12, s * 0.68, s * 0.18, r * 0.6); ctx.fill();
  ctx.globalAlpha = 1;
}
function drawPiece(ctx, type, cx, cy, s, alpha) {
  const cells = CELLS[type][0];
  let minX = 9, maxX = -9, minY = 9, maxY = -9;
  for (const [x, y] of cells) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const w = (maxX - minX + 1) * s, h = (maxY - minY + 1) * s;
  for (const [x, y] of cells) drawBlock(ctx, cx - w / 2 + (x - minX) * s, cy - h / 2 + (y - minY) * s, s, COLORS[type], alpha);
}
function drawHold() {
  const cv = $('holdCanvas'); const ctx = fitCanvas(cv);
  ctx.clearRect(0, 0, cv.width, cv.height);
  if (!game.hold) return;
  const s = Math.min(cv.width / 4.6, cv.height / 2.6);
  drawPiece(ctx, game.hold, cv.width / 2, cv.height / 2, s, game.canHold ? 1 : 0.35);
}
function drawNext() {
  const cv = $('nextCanvas'); const ctx = fitCanvas(cv);
  ctx.clearRect(0, 0, cv.width, cv.height);
  const horizontal = cv.width > cv.height;
  const n = horizontal ? 3 : 5;
  const slot = (horizontal ? cv.width : cv.height) / n;
  const s = horizontal ? Math.min(slot / 4.6, cv.height / 2.6) : Math.min(cv.width / 4.8, slot / 2.7);
  for (let i = 0; i < n; i++) {
    const t = game.queue[i];
    if (!t) continue;
    const sc = i === 0 ? s : s * 0.82;
    const c = slot * i + slot / 2;
    if (horizontal) drawPiece(ctx, t, c, cv.height / 2, sc, i === 0 ? 1 : 0.85);
    else drawPiece(ctx, t, cv.width / 2, c, sc, i === 0 ? 1 : 0.85);
  }
}
new ResizeObserver(() => { drawHold(); drawNext(); }).observe($('nextCanvas'));
new ResizeObserver(() => drawHold()).observe($('holdCanvas'));

// ---------------- overlay / flow ----------------
const overlay = $('overlay');
function showOverlay(title, text, score, btn) {
  $('ovTitle').textContent = title;
  $('ovText').textContent = text;
  const sc = $('ovScore');
  sc.textContent = '';
  for (const line of [].concat(score || [])) { const sp = document.createElement('span'); sp.textContent = line; sc.appendChild(sp); }
  $('ovTitle').classList.toggle('long', title.length > 7);
  $('ovBtn').textContent = btn;
  overlay.classList.add('show');
}
function hideOverlay() { overlay.classList.remove('show'); }

function startGame() {
  audio();
  game.start();
  hideOverlay();
  drawHold(); drawNext(); updateHud();
  $('pauseBtn').textContent = '❚❚';
}
function togglePause(force) {
  if (!game.started || game.over) return;
  game.paused = force !== undefined ? force : !game.paused;
  game.softDrop = false;
  held.left = held.right = held.down = false;
  if (game.paused) showOverlay('PAUSED', 'Take a breather.', `Score ${game.score.toLocaleString()}`, 'Resume');
  else hideOverlay();
  $('pauseBtn').textContent = game.paused ? '▶' : '❚❚';
}
function onGameOver(score) {
  sfx.over();
  const isBest = score > best;
  if (isBest) { best = score; store.set(HS_KEY, String(best)); }
  setTimeout(() => {
    showOverlay('GAME OVER', isBest && score > 0 ? '★ New high score! ★' : `Best: ${best.toLocaleString()}`,
      [`Score ${score.toLocaleString()}`, `Level ${game.level} · ${game.lines} lines`], 'Play again');
  }, 600);
  r3d.addShake(0.6);
}
$('ovBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  if (game.paused) togglePause(false); else startGame();
});
$('pauseBtn').addEventListener('click', () => togglePause());
$('viewBtn').addEventListener('click', () => toggleCamPanel());
$('soundBtn').addEventListener('click', () => toggleSound());
$('holdBtn').addEventListener('click', () => game.holdPiece());
function cycleView() {
  const name = r3d.cycleView();
  popup(name.toUpperCase(), 'CAMERA', '#45d6ff');
  updateCamPanel();
}
// ---------------- camera controls ----------------
const camPanel = $('camPanel');
const ORBIT_STEP = THREE_DEG(10), PITCH_STEP = THREE_DEG(7.5), ZOOM_STEP = 1.12;
function THREE_DEG(d) { return d * Math.PI / 180; }
function updateCamPanel() {
  camPanel.querySelectorAll('[data-cam^="preset"]').forEach((b) => b.classList.toggle('active', Number(b.dataset.cam.slice(6)) === r3d.viewIndex));
  $('viewBtn').classList.toggle('on', !camPanel.hidden);
}
function toggleCamPanel(force) {
  camPanel.hidden = force !== undefined ? !force : !camPanel.hidden;
  updateCamPanel();
}
function camAction(a) {
  switch (a) {
    case 'left': r3d.orbit(-ORBIT_STEP, 0); break;
    case 'right': r3d.orbit(ORBIT_STEP, 0); break;
    case 'up': r3d.orbit(0, PITCH_STEP); break;
    case 'down': r3d.orbit(0, -PITCH_STEP); break;
    case 'zoomin': r3d.zoomBy(ZOOM_STEP); break;
    case 'zoomout': r3d.zoomBy(1 / ZOOM_STEP); break;
    case 'reset': r3d.resetView(); break;
    case 'close': toggleCamPanel(false); return;
    default: if (a.startsWith('preset')) r3d.setPreset(Number(a.slice(6)));
  }
  updateCamPanel();
}
const REPEATABLE = new Set(['left', 'right', 'up', 'down', 'zoomin', 'zoomout']);
camPanel.querySelectorAll('.cbtn').forEach((btn) => {
  const a = btn.dataset.cam;
  let t1 = 0, t2 = 0;
  const stop = () => { clearTimeout(t1); clearInterval(t2); btn.classList.remove('pressed'); };
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    btn.classList.add('pressed');
    camAction(a);
    if (REPEATABLE.has(a)) t1 = setTimeout(() => { t2 = setInterval(() => camAction(a), 90); }, 320);
  });
  btn.addEventListener('pointerup', stop);
  btn.addEventListener('pointerleave', stop);
  btn.addEventListener('pointercancel', stop);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
});
camPanel.addEventListener('pointerdown', (e) => e.stopPropagation());
updateCamPanel();
function toggleSound() {
  soundOn = !soundOn;
  store.set(SOUND_KEY, soundOn ? '1' : '0');
  $('soundBtn').classList.toggle('off', !soundOn);
}
$('soundBtn').classList.toggle('off', !soundOn);
document.addEventListener('visibilitychange', () => { if (document.hidden && game.started && !game.over) togglePause(true); });
window.addEventListener('blur', () => { held.left = held.right = held.down = false; game.softDrop = false; });

// ---------------- full screen ----------------
const A2HS_KEY = 'tetris3d.a2hsDismissed';
const docEl = document.documentElement;
const fsTarget = document.getElementById('app');
const isStandalone = () => matchMedia('(display-mode: fullscreen)').matches || matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const fsSupported = !!((docEl.requestFullscreen && document.fullscreenEnabled) || (docEl.webkitRequestFullscreen && document.webkitFullscreenEnabled));
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
async function enterFullscreen() {
  try {
    if (fsTarget.requestFullscreen) await fsTarget.requestFullscreen({ navigationUI: 'hide' });
    else if (fsTarget.webkitRequestFullscreen) fsTarget.webkitRequestFullscreen();
  } catch (e) { /* user agent refused; ignore */ }
  try { if (screen.orientation && screen.orientation.lock && matchMedia('(pointer: coarse)').matches) await screen.orientation.lock('portrait'); } catch (e) { /* unsupported; ignore */ }
}
async function exitFullscreen() {
  try {
    if (document.exitFullscreen) await document.exitFullscreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  } catch (e) { /* ignore */ }
  try { screen.orientation?.unlock?.(); } catch (e) { /* ignore */ }
}
function toggleFullscreen() {
  if (!fsSupported || isStandalone()) return;
  if (fsElement()) exitFullscreen(); else enterFullscreen();
}
const fsBtn = $('fsBtn');
function updateFsUi() {
  const show = fsSupported && !isStandalone();
  fsBtn.hidden = !show;
  document.querySelectorAll('.fs-key').forEach((el) => { el.hidden = !show; });
  fsBtn.classList.toggle('on', !!fsElement());
  fsBtn.title = fsElement() ? 'Exit full screen (F)' : 'Full screen (F)';
}
fsBtn.addEventListener('click', () => toggleFullscreen());
document.addEventListener('fullscreenchange', updateFsUi);
document.addEventListener('webkitfullscreenchange', updateFsUi);
updateFsUi();
// iPhone Safari has no Fullscreen API: suggest Add to Home Screen once
(function a2hsHint() {
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPod/.test(ua) || (/iPad/.test(ua)) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!isIOS || fsSupported || isStandalone() || store.get(A2HS_KEY, '') === '1') return;
  const el = $('a2hs');
  el.hidden = false;
  const dismiss = () => { el.hidden = true; store.set(A2HS_KEY, '1'); };
  $('a2hsClose').addEventListener('click', dismiss);
  setTimeout(() => { if (!el.hidden) el.hidden = true; }, 15000); // auto-hide this session; shows again next visit until dismissed
})();
window.__fs = { fsSupported, isStandalone: isStandalone() };

// ---------------- input: keyboard ----------------
const DAS = 0.16, ARR = 0.045;
const held = { left: false, right: false, down: false };
const das = { dir: 0, t: 0, arr: 0 };
function pressDir(dir) {
  das.dir = dir; das.t = 0; das.arr = 0;
  game.move(dir);
}
function releaseDir(dir) {
  if (das.dir === dir) {
    das.dir = held.left && dir === 1 ? -1 : held.right && dir === -1 ? 1 : 0;
    das.t = 0; das.arr = 0;
  }
}
const KEYMAP = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowDown: 'down', ArrowUp: 'cw', KeyX: 'cw', KeyZ: 'ccw',
  ControlLeft: 'ccw', ControlRight: 'ccw', Space: 'drop', KeyC: 'hold', ShiftLeft: 'hold', ShiftRight: 'hold',
  KeyP: 'pause', Escape: 'pause', Enter: 'enter', KeyV: 'view', KeyM: 'sound', KeyF: 'fullscreen',
  KeyJ: 'cam:left', KeyL: 'cam:right', KeyI: 'cam:up', KeyK: 'cam:down',
  Equal: 'cam:zoomin', NumpadAdd: 'cam:zoomin', Minus: 'cam:zoomout', NumpadSubtract: 'cam:zoomout',
  KeyR: 'cam:reset', Digit0: 'cam:reset', Numpad0: 'cam:reset',
};
function actionDown(act) {
  if (act.startsWith('cam:')) { camAction(act.slice(4)); return; }
  switch (act) {
    case 'left': if (!held.left) { held.left = true; pressDir(-1); } break;
    case 'right': if (!held.right) { held.right = true; pressDir(1); } break;
    case 'down': held.down = true; game.softDrop = true; break;
    case 'cw': game.rotate(1); break;
    case 'ccw': game.rotate(-1); break;
    case 'drop': game.hardDrop(); break;
    case 'hold': game.holdPiece(); break;
    case 'pause': togglePause(); break;
    case 'view': cycleView(); break;
    case 'sound': toggleSound(); break;
    case 'fullscreen': toggleFullscreen(); break;
    case 'enter':
      if (!game.started || game.over) startGame(); else if (game.paused) togglePause(false);
      break;
  }
}
function actionUp(act) {
  if (act === 'left') { held.left = false; releaseDir(-1); }
  if (act === 'right') { held.right = false; releaseDir(1); }
  if (act === 'down') { held.down = false; game.softDrop = false; }
}
window.addEventListener('keydown', (e) => {
  const act = KEYMAP[e.code];
  if (!act) return;
  if (e.metaKey || (e.ctrlKey && act.startsWith('cam:'))) return; // leave browser shortcuts (Ctrl +/-/0, Cmd+R) alone
  e.preventDefault();
  if (e.repeat && !act.startsWith('cam:')) return;
  actionDown(act);
});
window.addEventListener('keyup', (e) => {
  const act = KEYMAP[e.code];
  if (act) { e.preventDefault(); actionUp(act); }
});

// ---------------- input: touch buttons ----------------
document.querySelectorAll('.tbtn').forEach((btn) => {
  const act = btn.dataset.act;
  const down = (e) => {
    e.preventDefault();
    btn.setPointerCapture?.(e.pointerId);
    btn.classList.add('pressed');
    if (navigator.vibrate) navigator.vibrate(8);
    actionDown(act);
  };
  const up = (e) => { e.preventDefault(); btn.classList.remove('pressed'); actionUp(act); };
  btn.addEventListener('pointerdown', down);
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointercancel', up);
  btn.addEventListener('lostpointercapture', () => { btn.classList.remove('pressed'); actionUp(act); });
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
});

// ---------------- input: swipe gestures on the board ----------------
let sw = null;            // one-finger gameplay swipe
const touches = new Map(); // active touch pointers for two-finger camera
let pinch = null;          // two-finger camera gesture state
let mouseOrbit = null;     // desktop orbit drag
const ORBIT_PER_PX = Math.PI / 600;

function twoFingerState() {
  const [a, b] = [...touches.values()];
  return { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
}
stage.addEventListener('pointerdown', (e) => {
  if (e.target.closest('#camPanel')) return;
  if (e.pointerType === 'mouse') {
    if (e.button === 2 || e.button === 1 || (e.button === 0 && e.altKey)) {
      e.preventDefault();
      mouseOrbit = { id: e.pointerId, x: e.clientX, y: e.clientY };
      stage.setPointerCapture?.(e.pointerId);
    }
    return;
  }
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  stage.setPointerCapture?.(e.pointerId);
  if (touches.size === 2) {
    sw = null; // second finger: this is a camera gesture, not gameplay
    pinch = twoFingerState();
    return;
  }
  if (touches.size > 2 || overlay.classList.contains('show')) return;
  sw = { id: e.pointerId, x0: e.clientX, y0: e.clientY, lx: e.clientX, ly: e.clientY, t0: performance.now(), moved: false, soft: 0, hist: [] };
});
stage.addEventListener('pointermove', (e) => {
  if (mouseOrbit && e.pointerId === mouseOrbit.id) {
    r3d.orbit(-(e.clientX - mouseOrbit.x) * ORBIT_PER_PX, (e.clientY - mouseOrbit.y) * ORBIT_PER_PX);
    mouseOrbit.x = e.clientX; mouseOrbit.y = e.clientY;
    updateCamPanel();
    return;
  }
  if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && touches.size === 2) {
    const st = twoFingerState();
    r3d.orbit(-(st.mx - pinch.mx) * ORBIT_PER_PX * 1.4, (st.my - pinch.my) * ORBIT_PER_PX * 1.4);
    r3d.zoomBy(st.dist / pinch.dist);
    pinch = st;
    updateCamPanel();
    return;
  }
  if (!sw || e.pointerId !== sw.id) return;
  const cell = Math.max(18, stage.clientWidth / 13);
  const now = performance.now();
  sw.hist.push({ y: e.clientY, t: now });
  while (sw.hist.length > 6) sw.hist.shift();
  let dx = e.clientX - sw.lx;
  while (Math.abs(dx) >= cell) {
    const d = Math.sign(dx);
    game.move(d);
    sw.lx += d * cell; dx -= d * cell; sw.moved = true;
  }
  let dy = e.clientY - sw.ly;
  if (dy >= cell * 0.9 && Math.abs(e.clientX - sw.x0) < cell * 1.5 + Math.abs(e.clientY - sw.y0) * 0.6) {
    while (dy >= cell * 0.9) { game.softDropStep(); sw.ly += cell * 0.9; dy -= cell * 0.9; sw.soft++; }
    sw.moved = true;
  }
});
function endSwipe(e) {
  if (!sw || e.pointerId !== sw.id) return;
  const dt = performance.now() - sw.t0;
  const dx = e.clientX - sw.x0, dy = e.clientY - sw.y0;
  const h = sw.hist;
  const vy = h.length >= 2 ? (h[h.length - 1].y - h[0].y) / Math.max(1, h[h.length - 1].t - h[0].t) : dy / Math.max(1, dt);
  if (!sw.moved && Math.abs(dx) < 12 && Math.abs(dy) < 12 && dt < 300) {
    game.rotate(1);
  } else if (dy > 50 && vy > 0.9 && Math.abs(dy) > Math.abs(dx)) {
    game.hardDrop();
  } else if (dy < -50 && Math.abs(dy) > Math.abs(dx) * 1.3 && dt < 400) {
    game.holdPiece();
  }
  sw = null;
}
function endPointer(e, cancelled) {
  if (mouseOrbit && e.pointerId === mouseOrbit.id) { mouseOrbit = null; return; }
  if (!cancelled) endSwipe(e); else if (sw && sw.id === e.pointerId) sw = null;
  touches.delete(e.pointerId);
  if (touches.size < 2) pinch = null;
}
stage.addEventListener('pointerup', (e) => endPointer(e, false));
stage.addEventListener('pointercancel', (e) => endPointer(e, true));
stage.addEventListener('lostpointercapture', (e) => { if (touches.has(e.pointerId)) endPointer(e, true); });
stage.addEventListener('contextmenu', (e) => e.preventDefault());
stage.addEventListener('wheel', (e) => {
  e.preventDefault();
  let dy = e.deltaY;
  if (e.deltaMode === 1) dy *= 16; else if (e.deltaMode === 2) dy *= 400;
  const k = e.ctrlKey ? 0.01 : 0.0015; // ctrlKey = trackpad pinch
  r3d.zoomBy(Math.exp(-dy * k));
  updateCamPanel();
}, { passive: false });
overlay.addEventListener('click', (e) => {
  if (e.target.closest('button')) return;
  if (matchMedia('(pointer: coarse)').matches) {
    if (game.paused) togglePause(false); else if (!game.started || game.over) startGame();
  }
});
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
  const now = Date.now();
  if (now - lastTouchEnd < 350 && !e.target.closest('#a2hs')) e.preventDefault();
  lastTouchEnd = now;
}, { passive: false });
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1 || !e.target.closest('.keys')) e.preventDefault(); }, { passive: false });

// ---------------- main loop ----------------
let lastT = performance.now();
let holdState = null, queueState = '';
function frame(now) {
  const dt = Math.max(0, Math.min(0.1, (now - lastT) / 1000)); // rAF timestamps can precede lastT
  lastT = now;

  if (game.active && das.dir !== 0) {
    das.t += dt;
    if (das.t >= DAS) {
      das.arr += dt;
      while (das.arr >= ARR) { das.arr -= ARR; if (!game.move(das.dir)) { das.arr = 0; break; } }
    }
  }
  game.update(dt);

  const hs = game.hold + ':' + game.canHold;
  if (hs !== holdState) { holdState = hs; drawHold(); }
  const qs = game.queue.slice(0, 5).join('');
  if (qs !== queueState) { queueState = qs; drawNext(); }
  updateHud();

  r3d.render(game, dt);
  requestAnimationFrame(frame);
}
showOverlay('TETRIS', 'Stack. Clear. Repeat.', best ? `Best ${best.toLocaleString()}` : '', 'Play');
updateHud();
requestAnimationFrame(frame);
