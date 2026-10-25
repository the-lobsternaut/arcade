// Pure Tetris game logic (no DOM). SRS rotation, 7-bag, hold, lock delay, scoring.
export const COLS = 10;
export const VISIBLE_ROWS = 20;
export const HIDDEN_ROWS = 2;
export const ROWS = VISIBLE_ROWS + HIDDEN_ROWS;
export const TYPES = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];

export const COLORS = {
  I: 0x22e3f2, J: 0x3f6dff, L: 0xff9b2f, O: 0xffd83a,
  S: 0x3fe07b, T: 0xb25cff, Z: 0xff4a6a,
};

const SHAPES = {
  I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
  J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
  L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
  O: [[1, 1], [1, 1]],
  S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
  T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
  Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
};

function rotCW(m) {
  const n = m.length;
  return m.map((row, r) => row.map((_, c) => m[n - 1 - c][r]));
}

// CELLS[type][rot] = [[x, y], ...] relative to piece box origin (y down)
export const CELLS = {};
for (const t of TYPES) {
  let m = SHAPES[t];
  CELLS[t] = [];
  for (let r = 0; r < 4; r++) {
    const cells = [];
    m.forEach((row, y) => row.forEach((v, x) => { if (v) cells.push([x, y]); }));
    CELLS[t].push(cells);
    m = rotCW(m);
  }
}

// SRS kick data (x right, y UP as in the guideline). Keyed "from>to".
const KICKS_JLSTZ = {
  '0>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '1>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '1>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '2>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '2>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '3>2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '3>0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '0>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
};
const KICKS_I = {
  '0>1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '1>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '1>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  '2>1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '2>3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '3>2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '3>0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '0>3': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
};

export const LINE_SCORES = [0, 100, 300, 500, 800];
export const LOCK_DELAY = 0.5;
export const MAX_LOCK_RESETS = 15;
export const CLEAR_TIME = 0.3;

export function gravityInterval(level) {
  // Tetris guideline gravity: seconds per row
  const l = Math.min(level, 20);
  return Math.pow(0.8 - (l - 1) * 0.007, l - 1);
}

export class Game {
  constructor(events = {}, rng = Math.random) {
    this.ev = events;
    this.rng = rng;
    this.reset();
  }

  emit(name, ...args) { if (this.ev[name]) this.ev[name](...args); }

  reset() {
    this.board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    this.bag = [];
    this.queue = [];
    this.hold = null;
    this.canHold = true;
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.combo = -1;
    this.b2b = false;
    this.acc = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.lowestY = 0;
    this.clearing = null;
    this.over = false;
    this.paused = false;
    this.started = false;
    this.softDrop = false;
    this.piece = null;
    this.fillQueue();
  }

  start() {
    this.reset();
    this.started = true;
    this.spawn();
    this.emit('start');
  }

  fillQueue() {
    while (this.queue.length < 7) {
      if (!this.bag.length) {
        this.bag = TYPES.slice();
        for (let i = this.bag.length - 1; i > 0; i--) {
          const j = Math.floor(this.rng() * (i + 1));
          [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
        }
      }
      this.queue.push(this.bag.pop());
    }
  }

  cellsOf(p = this.piece) {
    return CELLS[p.type][p.rot].map(([x, y]) => [x + p.x, y + p.y]);
  }

  fits(type, rot, px, py) {
    for (const [x, y] of CELLS[type][rot]) {
      const bx = x + px, by = y + py;
      if (bx < 0 || bx >= COLS || by >= ROWS) return false;
      if (by >= 0 && this.board[by][bx]) return false;
    }
    return true;
  }

  spawn(type) {
    if (!type) { type = this.queue.shift(); this.fillQueue(); }
    const x = type === 'O' ? 4 : 3;
    this.piece = { type, rot: 0, x, y: 0 };
    this._spawnId = (this._spawnId || 0) + 1;
    this.acc = 0; this.lockTimer = 0; this.lockResets = 0;
    if (!this.fits(type, 0, x, 0)) {
      this.gameOver();
      return false;
    }
    if (this.fits(type, 0, x, 1)) this.piece.y = 1; // guideline: drop one row immediately
    this.lowestY = this.piece.y;
    this.emit('spawn', this.piece);
    return true;
  }

  gameOver() {
    this.over = true;
    this.emit('gameover', this.score);
  }

  get active() { return this.started && !this.paused && !this.over && !this.clearing && this.piece; }

  grounded() { return !this.fits(this.piece.type, this.piece.rot, this.piece.x, this.piece.y + 1); }

  onSuccessfulAction() {
    if (this.piece.y > this.lowestY) { this.lowestY = this.piece.y; this.lockResets = 0; }
    if (this.grounded() && this.lockResets < MAX_LOCK_RESETS) { this.lockTimer = 0; this.lockResets++; }
  }

  move(dx) {
    if (!this.active) return false;
    const p = this.piece;
    if (this.fits(p.type, p.rot, p.x + dx, p.y)) {
      p.x += dx; this.onSuccessfulAction(); this.emit('move'); return true;
    }
    return false;
  }

  stepDown(manual) {
    const p = this.piece;
    if (this.fits(p.type, p.rot, p.x, p.y + 1)) {
      p.y++;
      if (manual) this.score += 1;
      if (p.y > this.lowestY) { this.lowestY = p.y; this.lockResets = 0; this.lockTimer = 0; }
      return true;
    }
    return false;
  }

  softDropStep() { if (this.active) { const ok = this.stepDown(true); if (ok) this.acc = 0; return ok; } return false; }

  rotate(dir) {
    if (!this.active) return false;
    const p = this.piece;
    if (p.type === 'O') return false;
    const to = (p.rot + dir + 4) % 4;
    const kicks = (p.type === 'I' ? KICKS_I : KICKS_JLSTZ)[`${p.rot}>${to}`];
    for (const [kx, ky] of kicks) {
      if (this.fits(p.type, to, p.x + kx, p.y - ky)) {
        p.x += kx; p.y -= ky; p.rot = to;
        this.onSuccessfulAction();
        this.emit('rotate');
        return true;
      }
    }
    return false;
  }

  ghostY() {
    const p = this.piece;
    let y = p.y;
    while (this.fits(p.type, p.rot, p.x, y + 1)) y++;
    return y;
  }

  hardDrop() {
    if (!this.active) return;
    const p = this.piece;
    const startY = p.y;
    p.y = this.ghostY();
    const dist = p.y - startY;
    this.score += 2 * dist;
    this.emit('harddrop', dist, this.cellsOf());
    this.lock();
  }

  holdPiece() {
    if (!this.active || !this.canHold) return;
    const cur = this.piece.type;
    const held = this.hold;
    this.hold = cur;
    this.canHold = false;
    this.emit('hold');
    this.spawn(held || undefined);
  }

  lock() {
    const cells = this.cellsOf();
    const type = this.piece.type;
    let allHidden = true;
    for (const [x, y] of cells) {
      if (y >= 0) this.board[y][x] = type;
      if (y >= HIDDEN_ROWS) allHidden = false;
    }
    this.piece = null;
    this.canHold = true;
    this.emit('lock', cells, type);
    if (allHidden) { this.gameOver(); return; }

    const full = [];
    for (let y = 0; y < ROWS; y++) if (this.board[y].every(Boolean)) full.push(y);
    if (full.length) {
      const n = full.length;
      let pts = LINE_SCORES[n] * this.level;
      const isTetris = n === 4;
      if (isTetris && this.b2b) pts = Math.floor(pts * 1.5);
      this.b2b = isTetris;
      this.combo++;
      if (this.combo > 0) pts += 50 * this.combo * this.level;
      this.score += pts;
      const prevLevel = this.level;
      this.lines += n;
      this.level = 1 + Math.floor(this.lines / 10);
      this.clearing = { rows: full, t: CLEAR_TIME };
      this.emit('clear', full, { points: pts, combo: this.combo, b2b: isTetris && pts > LINE_SCORES[4] * prevLevel });
      if (this.level !== prevLevel) this.emit('levelup', this.level);
    } else {
      this.combo = -1;
      this.spawn();
    }
  }

  finishClear() {
    const rows = this.clearing.rows;
    const removed = rows.map(y => ({ y, cells: this.board[y].slice() }));
    const set = new Set(rows);
    const kept = this.board.filter((_, y) => !set.has(y));
    while (kept.length < ROWS) kept.unshift(Array(COLS).fill(null));
    this.board = kept;
    this.clearing = null;
    this.emit('rowsremoved', removed);
    this.spawn();
  }

  update(dt) {
    if (!this.started || this.paused || this.over) return;
    if (this.clearing) {
      this.clearing.t -= dt;
      if (this.clearing.t <= 0) this.finishClear();
      return;
    }
    if (!this.piece) return;
    let interval = gravityInterval(this.level);
    if (this.softDrop) interval = Math.min(interval, Math.max(interval / 20, 0.03));
    this.acc += dt;
    while (this.acc >= interval) {
      this.acc -= interval;
      if (!this.stepDown(this.softDrop)) { this.acc = 0; break; }
    }
    if (this.grounded()) {
      this.lockTimer += dt;
      if (this.lockTimer >= LOCK_DELAY) this.lock();
    } else {
      this.lockTimer = 0;
    }
  }
}
