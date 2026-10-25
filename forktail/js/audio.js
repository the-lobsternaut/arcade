/* Fork-Tailed Devil - sound effects synthesized with WebAudio; music = pre-rendered loops in assets/music/*.m4a (see tools/music/). */
window.SKY = window.SKY || {};
(function (S) {
  'use strict';
  const A = { muted: false, musicOff: false };
  try { A.muted = localStorage.getItem('sky1943.muted') === '1'; A.musicOff = localStorage.getItem('sky1943.musicOff') === '1'; } catch (e) {}
  S.audio = A;
  let ctx = null, master = null, sfxG = null, musG = null, noise = null;
  const last = {};
  const mtof = (n) => 440 * Math.pow(2, (n - 69) / 12);

  A.unlock = function () {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = A.muted ? 0 : 0.9;
        const comp = ctx.createDynamicsCompressor();
        master.connect(comp); comp.connect(ctx.destination);
        sfxG = ctx.createGain(); sfxG.gain.value = 0.55; sfxG.connect(master);
        musG = ctx.createGain(); musG.gain.value = A.musicOff ? 0 : MUSIC_VOL; musG.connect(master);
        const len = ctx.sampleRate | 0;
        noise = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        // iOS: play a silent buffer inside the gesture to fully unlock
        const s = ctx.createBufferSource(); s.buffer = ctx.createBuffer(1, 1, 22050); s.connect(ctx.destination); s.start(0);
        if (want) { const w = want; want = null; cur = null; A.music(w); }
      }
      if (ctx.state !== 'running') ctx.resume();
    } catch (e) { /* audio unavailable */ }
  };
  A.suspend = function () { try { if (ctx && ctx.state === 'running') ctx.suspend(); } catch (e) {} };
  A.resume = function () { try { if (ctx && ctx.state !== 'running') ctx.resume(); } catch (e) {} };
  A.setMuted = function (m) {
    A.muted = !!m;
    try { localStorage.setItem('sky1943.muted', A.muted ? '1' : '0'); } catch (e) {}
    if (master) master.gain.setTargetAtTime(A.muted ? 0 : 0.9, ctx.currentTime, 0.02);
  };
  A.toggleMute = function () { A.setMuted(!A.muted); return A.muted; };
  A.setMusicOff = function (m) {
    A.musicOff = !!m;
    try { localStorage.setItem('sky1943.musicOff', A.musicOff ? '1' : '0'); } catch (e) {}
    if (musG) musG.gain.setTargetAtTime(A.musicOff ? 0 : MUSIC_VOL, ctx.currentTime, 0.05);
    if (!A.musicOff && want) { const w = want; want = null; cur = null; A.music(w); }
  };
  A.toggleMusic = function () { A.setMusicOff(!A.musicOff); return A.musicOff; };
  // Haptics. navigator.vibrate is the only web API for this, and iOS Safari does not implement it,
  // so on an iPhone these calls do nothing at all - the code is here because it costs nothing and
  // works everywhere that does. Throttled: a nuke spawns a dozen blasts in two frames and nobody
  // wants their phone to buzz twelve times.
  let lastBuzz = 0;
  A.haptic = function (ms) {
    if (A.muted || !navigator.vibrate) return;
    const now = performance.now();
    if (now - lastBuzz < 70) return;
    lastBuzz = now;
    try { navigator.vibrate(Math.max(8, Math.min(45, ms | 0))); } catch (e) {}
  };
  A.applySettings = function (o) { if (!o) return; if ('muted' in o) A.setMuted(o.muted); if ('musicOff' in o) A.setMusicOff(o.musicOff); };
  A.settings = () => ({ muted: A.muted, musicOff: A.musicOff });

  function tone(f0, f1, dur, type, vol, when, dest) {
    const t = ctx.currentTime + (when || 0);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || sfxG);
    o.start(t); o.stop(t + dur + 0.03);
  }
  function nz(dur, vol, f0, f1, ftype, when) {
    const t = ctx.currentTime + (when || 0);
    const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true;
    const fl = ctx.createBiquadFilter(); fl.type = ftype || 'lowpass';
    fl.frequency.setValueAtTime(f0, t); fl.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(g); g.connect(sfxG);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.03);
  }
  const THROTTLE = { radio: 0.4, static: 0.3, sputter: 0.5, flak: 0.06, bombhit: 0.05, whistle: 0.1, nuke: 0.2, drop: 0.2, shot: 0.07, laser: 0.06, auto: 0.06, shotgun: 0.1, boom: 0.045, planeboom: 0.04, bigplaneboom: 0.05, tick: 0.05, cycle: 0.08, hurt: 0.15 };
  const SFX = {
    shot() { tone(1150, 520, 0.05, 'square', 0.045); },
    auto() { tone(1300, 650, 0.04, 'square', 0.035); },
    laser() { tone(1900, 760, 0.07, 'sawtooth', 0.035); },
    shotgun() { nz(0.13, 0.28, 3200, 500, 'bandpass'); tone(300, 120, 0.08, 'square', 0.05); },
    tick() { nz(0.04, 0.08, 4000, 2000, 'highpass'); },
    boom() { nz(0.42, 0.55, 2400, 140); tone(150, 40, 0.3, 'sine', 0.35); },
    // shooting an aircraft down: a hard crack off the top, the body of the blast under it,
    // and a low thump with a debris tail so the kill lands instead of just stopping
    planeboom() {
      nz(0.055, 0.95, 7000, 1900, 'highpass');
      nz(0.5, 0.8, 2800, 110);
      tone(195, 34, 0.4, 'sine', 0.6);
      tone(98, 27, 0.62, 'triangle', 0.32, 0.02);
      nz(0.46, 0.2, 760, 120, 'lowpass', 0.11);
    },
    bigplaneboom() {   // bombers and heavies: same shape, more of everything, longer tail
      nz(0.075, 1.0, 8200, 1600, 'highpass');
      nz(0.95, 0.95, 2300, 60);
      tone(145, 25, 0.8, 'sine', 0.8);
      tone(72, 21, 1.05, 'triangle', 0.5, 0.03);
      nz(0.85, 0.3, 520, 70, 'lowpass', 0.17);
    },
    bigboom() { nz(1.4, 0.9, 1800, 50); tone(90, 28, 1.1, 'sine', 0.6); nz(0.6, 0.4, 5000, 300, 'lowpass', 0.15); },
    hurt() { tone(320, 90, 0.26, 'sawtooth', 0.22); nz(0.16, 0.3, 3000, 400); },
    power() { [72, 76, 79, 84, 88].forEach((n, i) => tone(mtof(n), 0, 0.09, 'square', 0.1, i * 0.055)); },
    energy() { [67, 72, 76, 79, 84].forEach((n, i) => tone(mtof(n), 0, 0.1, 'triangle', 0.22, i * 0.06)); },
    cycle() { tone(900, 1350, 0.05, 'triangle', 0.16); },
    loop() { tone(240, 820, 0.4, 'sine', 0.2); tone(820, 260, 0.45, 'sine', 0.14, 0.4); nz(0.8, 0.12, 500, 2200, 'bandpass'); },
    denied() { tone(200, 150, 0.12, 'square', 0.08); },
    warning() { for (let i = 0; i < 4; i++) { tone(440, 880, 0.3, 'square', 0.1, i * 0.62); tone(880, 440, 0.3, 'square', 0.1, i * 0.62 + 0.31); } },
    low() { tone(1250, 1250, 0.07, 'square', 0.05); },
    start() { [64, 69, 72, 76, 81].forEach((n, i) => tone(mtof(n), 0, 0.12, 'square', 0.09, i * 0.08)); },
    clear() { [69, 72, 76, 81, 79, 81, 84, 88].forEach((n, i) => tone(mtof(n), 0, i === 7 ? 0.6 : 0.14, 'square', 0.09, i * 0.13)); },
    gameover() { [69, 65, 62, 57, 50].forEach((n, i) => tone(mtof(n), 0, 0.32, 'triangle', 0.25, i * 0.28)); },
    drop() { tone(700, 300, 0.12, 'triangle', 0.08); },
    nuke() { tone(70, 22, 1.8, 'sine', 0.9); tone(46, 20, 2.2, 'triangle', 0.5); nz(2.4, 1.0, 900, 35, 'lowpass'); nz(0.35, 0.6, 6000, 400, 'lowpass'); nz(1.6, 0.35, 260, 40, 'lowpass', 0.25); },
    click() { tone(1400, 1100, 0.03, 'triangle', 0.08); },
    buy() { [76, 83, 88].forEach((n, i) => tone(mtof(n), 0, 0.12, 'triangle', 0.16, i * 0.07)); nz(0.08, 0.1, 6000, 3000, 'highpass'); },
    mode() { tone(500, 900, 0.06, 'square', 0.07); nz(0.06, 0.18, 2500, 900, 'bandpass', 0.03); },
    bombhit() { nz(0.55, 0.6, 1600, 80); tone(110, 32, 0.45, 'sine', 0.45); },
    whistle() { tone(1900, 600, 0.55, 'sine', 0.05); },
    flak() { nz(0.22, 0.35, 2600, 300, 'bandpass'); tone(180, 60, 0.15, 'sine', 0.2); },
    sputter() { for (let i = 0; i < 5; i++) { nz(0.05, 0.22, 700, 200, 'lowpass', i * 0.11 + Math.random() * 0.04); } tone(90, 50, 0.5, 'sawtooth', 0.06); },
    repair() { [67, 71, 74, 79].forEach((n, i) => tone(mtof(n), 0, 0.08, 'triangle', 0.18, i * 0.05)); nz(0.12, 0.12, 5000, 1500, 'highpass'); },
    radio() { nz(0.09, 0.16, 3200, 1800, 'bandpass'); tone(1600, 1600, 0.04, 'square', 0.03, 0.08); },
    static() { nz(0.35, 0.22, 4200, 900, 'bandpass'); tone(1200, 900, 0.05, 'square', 0.03, 0.3); },
    pause() { tone(660, 660, 0.06, 'triangle', 0.12); tone(990, 990, 0.08, 'triangle', 0.12, 0.07); },
  };
  A.sfx = function (name) {
    if (!ctx || A.muted || ctx.state !== 'running') return;
    const now = ctx.currentTime, min = THROTTLE[name] || 0.03;
    if (last[name] !== undefined && now - last[name] < min) return;
    last[name] = now;
    try { SFX[name] && SFX[name](); } catch (e) {}
  };

  // ---------------- music: streamed AAC loops with seamless looping + crossfades ----------------
  // tracks + loop points come from assets/music/tracks.js (written by tools/music/render.py)
  const MUSIC_VOL = 0.42;
  const TR = window.SKY_TRACKS || {};
  const ALIAS = { stage1: 'stage1', stage2: 'stage2', stage3: 'stage3', boss1: 'boss1', boss2: 'boss2', boss3: 'boss1', title: 'title', hangar: 'hangar' };
  const bufs = {}, loading = {};
  let cur = null, want = null, curSrc = null, curGain = null;
  function load(name) {
    if (bufs[name]) return Promise.resolve(bufs[name]);
    if (loading[name]) return loading[name];
    const t = TR[name]; if (!t || !ctx) return Promise.reject(new Error('no track ' + name));
    loading[name] = fetch(t.src).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .then((ab) => new Promise((res, rej) => { const p = ctx.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); }))
      .then((b) => { bufs[name] = b; A.loaded[name] = { dur: b.duration, rate: b.sampleRate }; return b; });
    loading[name].catch(() => { delete loading[name]; });
    return loading[name];
  }
  A.loaded = {};
  A.tracks = TR;
  // Music is off for now - the tracks and the plumbing are all still here, so turning it back on
  // is deleting this line. Nothing downstream has to know; every call site still calls music().
  const MUSIC_DISABLED = true;
  A.music = function (name) {
    if (MUSIC_DISABLED) return;
    if (name && ALIAS[name]) name = ALIAS[name];
    if (name === cur && curSrc) return;
    want = name;
    if (!ctx || ctx.state === 'closed') return; // starts at unlock
    fadeOut(name ? 1.2 : 0.6);
    cur = name;
    if (!name || A.musicOff) { if (!name) want = null; return; }
    load(name).then((b) => {
      if (cur !== name) return;
      const t = TR[name], s = ctx.createBufferSource(), g = ctx.createGain();
      s.buffer = b; s.loop = true; s.loopStart = t.loopStart || 0; s.loopEnd = t.loopEnd || b.duration;
      g.gain.setValueAtTime(0.0001, ctx.currentTime); g.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 1.2);
      s.connect(g); g.connect(musG); s.start(ctx.currentTime + 0.02, 0);
      curSrc = s; curGain = g; A.playing = name;
    }).catch(() => {});
  };
  function fadeOut(sec) {
    if (!curSrc) return;
    const s = curSrc, g = curGain, t = ctx.currentTime;
    g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), t); g.gain.exponentialRampToValueAtTime(0.0001, t + sec);
    s.stop(t + sec + 0.05); curSrc = null; curGain = null; A.playing = null;
  }
  // one-shot stingers (clear / game over): duck the loop, play the sting
  A.sting = function (name) {
    if (!ctx || A.musicOff || A.muted) return;
    const key = 'sting_' + name;
    load(key).then((b) => {
      const s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = b; g.gain.value = 1;
      s.connect(g); g.connect(musG); s.start(ctx.currentTime + 0.02);
    }).catch(() => {});
  };
  A.preload = function (names) { if (!ctx) return; (names || ['title', 'stage1', 'hangar']).forEach((n) => load(n).catch(() => {})); };
})(window.SKY);
