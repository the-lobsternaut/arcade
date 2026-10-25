// three.js renderer for the Tetris board: instanced beveled cubes, ghost, well, particles.
import * as THREE from 'three';
import { RoundedBoxGeometry } from '../vendor/RoundedBoxGeometry.js';
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';
import { COLS, ROWS, HIDDEN_ROWS, COLORS, CELLS } from './game.js';

const MAX_BLOCKS = COLS * ROWS + 8;
const MAX_PARTICLES = 420;
export const VIEWS = [
  { name: 'Front', yaw: 0, pitch: 0, zoom: 1, sway: 0 },
  { name: 'Angled', yaw: 0.26, pitch: 0.16, zoom: 1, sway: 1 },
  { name: 'Dramatic', yaw: -0.5, pitch: 0.3, zoom: 1, sway: 1 },
];
export const CAM_LIMITS = { yaw: Math.PI / 3, pitch: Math.PI / 4, zoomMin: 0.7, zoomMax: 1.8 };

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpV = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();
const WHITE = new THREE.Color(0xffffff);

export function cellToWorld(x, y, out = tmpV) {
  // board row y (0 = top hidden row) -> world; visible area centred at origin
  return out.set(x - (COLS - 1) / 2, (ROWS - 1 - y) - (ROWS - HIDDEN_ROWS - 1) / 2, 0);
}

export class Renderer3D {
  constructor(canvas, container) {
    this.canvas = canvas;
    this.container = container;
    const isMobile = matchMedia('(pointer: coarse)').matches;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 2 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200);
    this.viewIndex = 0;             // last chosen preset (-1 = custom)
    this.camGoal = { ...VIEWS[0] }; // where the camera is heading
    this.view = { ...VIEWS[0] };    // smoothed current camera
    this.shake = 0;
    this.time = 0;
    this.camTarget = new THREE.Vector3(0, 0, 0); // set by resize() to the centre of the fitted framing

    this.setupLights();
    this.setupWell();
    this.setupBlocks();
    this.setupParticles();

    this.rowOffset = new Float32Array(ROWS);
    this.pieceVis = { x: 0, y: 0, sid: -1 };
    this.flash = 0;
    this.lockPulse = new Map();

    this.resize();
    new ResizeObserver(() => this.resize()).observe(container);
  }

  setupLights() {
    const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x1a1030, 0.55);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(7, 14, 16);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -9; key.shadow.camera.right = 9;
    key.shadow.camera.top = 13; key.shadow.camera.bottom = -13;
    key.shadow.camera.near = 1; key.shadow.camera.far = 50;
    key.shadow.bias = -0.0008;
    key.shadow.normalBias = 0.02;
    this.scene.add(key);
    const rim = new THREE.PointLight(0x5ad1ff, 30, 40, 2);
    rim.position.set(-8, 8, 6);
    this.scene.add(rim);
    const rim2 = new THREE.PointLight(0xff4fd8, 22, 40, 2);
    rim2.position.set(8, -9, 6);
    this.scene.add(rim2);
    this.flashLight = new THREE.PointLight(0xffffff, 0, 30, 2);
    this.flashLight.position.set(0, 0, 5);
    this.scene.add(this.flashLight);
  }

  setupWell() {
    const g = new THREE.Group();
    const W = COLS, H = ROWS - HIDDEN_ROWS;
    // back panel
    const backMat = new THREE.MeshStandardMaterial({ color: 0x0d1024, roughness: 0.85, metalness: 0.1 });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(W, H), backMat);
    back.position.set(0, 0, -0.52);
    back.receiveShadow = true;
    g.add(back);
    // grid lines
    const pts = [];
    for (let x = 1; x < W; x++) pts.push(x - W / 2, -H / 2, 0, x - W / 2, H / 2, 0);
    for (let y = 1; y < H; y++) pts.push(-W / 2, y - H / 2, 0, W / 2, y - H / 2, 0);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const grid = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x3a4a8a, transparent: true, opacity: 0.28 }));
    grid.position.z = -0.5;
    g.add(grid);
    // frame
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1c2140, roughness: 0.3, metalness: 0.75 });
    const t = 0.45, d = 1.3;
    const side = new RoundedBoxGeometry(t, H + t, d, 3, 0.12);
    const left = new THREE.Mesh(side, frameMat); left.position.set(-W / 2 - t / 2, -t / 2, -0.05);
    const right = new THREE.Mesh(side, frameMat); right.position.set(W / 2 + t / 2, -t / 2, -0.05);
    const bottom = new THREE.Mesh(new RoundedBoxGeometry(W + 2 * t, t, d, 3, 0.12), frameMat);
    bottom.position.set(0, -H / 2 - t / 2, -0.05);
    for (const m of [left, right, bottom]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
    // neon edge strips
    const neon = new THREE.MeshBasicMaterial({ color: 0x45d6ff, toneMapped: false });
    const neon2 = new THREE.MeshBasicMaterial({ color: 0xff5ad8, toneMapped: false });
    const sg = new THREE.BoxGeometry(0.05, H + t, 0.05);
    const sl = new THREE.Mesh(sg, neon); sl.position.set(-W / 2 - 0.03, -t / 2, d / 2 - 0.05);
    const sr = new THREE.Mesh(sg, neon2); sr.position.set(W / 2 + 0.03, -t / 2, d / 2 - 0.05);
    const sb = new THREE.Mesh(new THREE.BoxGeometry(W + 0.1, 0.05, 0.05), neon);
    sb.position.set(0, -H / 2 - 0.03, d / 2 - 0.05);
    g.add(sl, sr, sb);
    this.neonMats = [neon, neon2];
    // danger line at top
    const top = new THREE.Mesh(new THREE.BoxGeometry(W, 0.03, 0.03), new THREE.MeshBasicMaterial({ color: 0xff3355, transparent: true, opacity: 0.35, toneMapped: false }));
    top.position.set(0, H / 2, 0.5);
    g.add(top);
    this.dangerLine = top;
    this.well = g;
    this.scene.add(g);
  }

  setupBlocks() {
    this.blockGeo = new RoundedBoxGeometry(0.94, 0.94, 0.94, 3, 0.14);
    this.blockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.28, metalness: 0.08, emissive: 0x000000 });
    this.blocks = new THREE.InstancedMesh(this.blockGeo, this.blockMat, MAX_BLOCKS);
    this.blocks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.blocks.castShadow = true;
    this.blocks.receiveShadow = true;
    this.blocks.frustumCulled = false;
    this.blocks.setColorAt(0, WHITE);
    this.scene.add(this.blocks);

    this.ghostMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.2, roughness: 0.2, metalness: 0, depthWrite: false, emissive: 0xffffff, emissiveIntensity: 0.12 });
    this.ghost = new THREE.InstancedMesh(this.blockGeo, this.ghostMat, 4);
    this.ghost.frustumCulled = false;
    this.scene.add(this.ghost);
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(0.92, 0.92, 0.92));
    this.ghostEdgeMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 });
    this.ghostEdges = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.LineSegments(edges, this.ghostEdgeMat);
      this.ghostEdges.push(l); this.scene.add(l);
    }
  }

  setupParticles() {
    this.partGeo = new RoundedBoxGeometry(0.9, 0.9, 0.9, 2, 0.12);
    this.partMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.1, emissive: 0x222222 });
    this.parts = new THREE.InstancedMesh(this.partGeo, this.partMat, MAX_PARTICLES);
    this.parts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.parts.frustumCulled = false;
    this.parts.count = 0;
    this.parts.setColorAt(0, WHITE);
    this.scene.add(this.parts);
    this.particles = [];
  }

  // ---- camera controls ----
  clampGoal() {
    const g = this.camGoal, L = CAM_LIMITS;
    g.yaw = Math.max(-L.yaw, Math.min(L.yaw, g.yaw));
    g.pitch = Math.max(-L.pitch, Math.min(L.pitch, g.pitch));
    g.zoom = Math.max(L.zoomMin, Math.min(L.zoomMax, g.zoom));
  }
  setPreset(i) {
    this.viewIndex = ((i % VIEWS.length) + VIEWS.length) % VIEWS.length;
    this.camGoal = { ...VIEWS[this.viewIndex] };
    return VIEWS[this.viewIndex].name;
  }
  cycleView() { return this.setPreset(this.viewIndex < 0 ? 0 : this.viewIndex + 1); }
  resetView() { return this.setPreset(0); }
  orbit(dYaw, dPitch) {
    this.camGoal.yaw += dYaw; this.camGoal.pitch += dPitch; this.camGoal.sway = 0;
    this.viewIndex = -1; this.clampGoal();
  }
  zoomBy(f) {
    this.camGoal.zoom /= f; this.viewIndex = -1; this.clampGoal();
  }
  getCamera() {
    return { goal: { ...this.camGoal }, current: { yaw: this.view.yaw, pitch: this.view.pitch, zoom: this.view.zoom }, preset: this.viewIndex >= 0 ? VIEWS[this.viewIndex].name : 'Custom' };
  }

  resize() {
    const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // Fit the well tightly (head-on) to whichever canvas dimension limits, accounting for perspective:
    // the nearest geometry (front of the frame, z = FRONT_Z) is what would clip first.
    const H = ROWS - HIDDEN_ROWS, FRAME = 0.45;
    const xHalf = COLS / 2 + FRAME + 0.02;          // outer edge of side rails
    const yBot = -H / 2 - FRAME - 0.02;             // outer edge of bottom rail
    const yTop = H / 2 + 1.05;                      // room for a freshly spawned piece poking above the well
    const FRONT_Z = 0.62;
    const cy = (yTop + yBot) / 2;
    this.camTarget.set(0, cy, 0);
    const t = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const ta = t * this.camera.aspect;
    const pad = 4; // px of breathing room at the limiting edge
    const mx = Math.max(0.5, 1 - (2 * pad) / w), my = Math.max(0.5, 1 - (2 * pad) / h);
    this.fit = { t, ta, mx, my, corners: [] };
    for (const x of [-xHalf, xHalf]) for (const y of [yBot, yTop]) for (const z of [-0.7, FRONT_Z]) this.fit.corners.push([x, y - cy, z]);
    this.camDist = this.fitDistance(0, 0); // head-on fitted distance (zoom 1)
    // expose the on-screen size/offset of the well (head-on, z = 0 plane) so HTML overlays can fit inside it
    const visH = 2 * this.camDist * t, visW = visH * this.camera.aspect;
    const pxPerUnitX = w / visW, pxPerUnitY = h / visH;
    this.container.style.setProperty('--board-w', `${Math.round(pxPerUnitX * (COLS + 0.9))}px`);
    this.container.style.setProperty('--board-h', `${Math.round(pxPerUnitY * (H + 0.45))}px`);
    this.container.style.setProperty('--board-dy', `${Math.round(pxPerUnitY * (cy - (-FRAME / 2)))}px`);
  }

  // Smallest camera distance at which the whole well (incl. spawn headroom) fits the canvas when the
  // camera orbits the target by (yaw, pitch). Exact for a perspective camera looking at the target.
  fitDistance(yaw, pitch) {
    const { ta, t, mx, my, corners } = this.fit;
    const cp = Math.cos(pitch), sp = Math.sin(pitch), cyw = Math.cos(yaw), syw = Math.sin(yaw);
    const fx = syw * cp, fy = sp, fz = cyw * cp;          // unit vector target -> camera
    const rx = cyw, rz = -syw;                            // camera right (up x f, normalised; ry = 0)
    const ux = -sp * syw, uy = cp, uz = -sp * cyw;        // camera up (f x r)
    let d = 0;
    for (const [x, y, z] of corners) {
      const depth = x * fx + y * fy + z * fz;            // distance of the point toward the camera
      const xc = Math.abs(x * rx + z * rz), yc = Math.abs(x * ux + y * uy + z * uz);
      d = Math.max(d, depth + xc / (ta * mx), depth + yc / (t * my));
    }
    return d;
  }

  // ---- effects ----
  addShake(a) { this.shake = Math.min(1.2, this.shake + a); }

  spawnParticle(pos, color, vel, scale, life) {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push({
      p: pos.clone(), v: vel, color: new THREE.Color(color), s: scale, life, max: life,
      rot: new THREE.Euler(Math.random() * 3, Math.random() * 3, 0),
      av: new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14),
    });
  }

  burstRows(removed) {
    const n = removed.length;
    for (const { y, cells } of removed) {
      cells.forEach((type, x) => {
        if (!type) return;
        const c = COLORS[type];
        const base = cellToWorld(x, y, new THREE.Vector3());
        const dir = x - (COLS - 1) / 2;
        // main cube flies toward camera and sideways
        this.spawnParticle(base, c, new THREE.Vector3(dir * (1.2 + Math.random()) + (Math.random() - 0.5) * 3, 4 + Math.random() * 6 + n, 6 + Math.random() * 8), 1, 1.1 + Math.random() * 0.5);
        // shards
        for (let k = 0; k < 2; k++) {
          this.spawnParticle(base, k ? 0xffffff : c, new THREE.Vector3((Math.random() - 0.5) * 16, Math.random() * 12, Math.random() * 10), 0.28 + Math.random() * 0.2, 0.6 + Math.random() * 0.6);
        }
      });
    }
    this.flash = Math.min(1.5, 0.5 + n * 0.25);
    this.addShake(0.15 + n * 0.12);
    // rows above drop: animate offset
    const rows = removed.map(r => r.y).sort((a, b) => a - b);
    const newOffset = new Float32Array(ROWS);
    // after removal, a row that is now at index i was previously at i - k where k = number of removed rows below it
    let removedBelow = 0;
    const map = [];
    for (let y = ROWS - 1; y >= 0; y--) {
      if (rows.includes(y)) { removedBelow++; continue; }
      map.push([y, removedBelow]);
    }
    for (const [oldY, k] of map) {
      const newY = oldY + k;
      if (newY < ROWS) newOffset[newY] = k; // visually starts k rows higher
    }
    for (let i = 0; i < ROWS; i++) this.rowOffset[i] = Math.max(this.rowOffset[i], newOffset[i]);
  }

  hardDropFx(cells, type, dist) {
    this.addShake(0.08 + Math.min(dist, 20) * 0.012);
    const c = COLORS[type];
    for (const [x, y] of cells) {
      const base = cellToWorld(x, y, new THREE.Vector3());
      base.y -= 0.45;
      for (let k = 0; k < 2; k++) {
        this.spawnParticle(base, c, new THREE.Vector3((Math.random() - 0.5) * 5, Math.random() * 3, Math.random() * 3), 0.12 + Math.random() * 0.1, 0.35 + Math.random() * 0.25);
      }
    }
  }

  lockFx(cells) {
    for (const [x, y] of cells) this.lockPulse.set(y * COLS + x, 1);
  }

  // ---- per-frame ----
  render(game, dt) {
    this.time += dt;
    const blocks = this.blocks;
    let i = 0;
    const clearRows = game.clearing ? new Set(game.clearing.rows) : null;
    const clearT = game.clearing ? 1 - game.clearing.t / 0.3 : 0;

    for (let r = 0; r < ROWS; r++) {
      this.rowOffset[r] *= Math.exp(-dt * 16);
      if (this.rowOffset[r] < 0.002) this.rowOffset[r] = 0;
    }

    for (let y = 0; y < ROWS; y++) {
      const row = game.board[y];
      const clearing = clearRows && clearRows.has(y);
      for (let x = 0; x < COLS; x++) {
        const t = row[x];
        if (!t) continue;
        cellToWorld(x, y, tmpV);
        tmpV.y += this.rowOffset[y];
        let s = 1;
        tmpC.setHex(COLORS[t]);
        const key = y * COLS + x;
        const lp = this.lockPulse.get(key);
        if (lp) {
          tmpC.lerp(WHITE, lp * 0.45);
          const nl = lp - dt * 5;
          if (nl <= 0) this.lockPulse.delete(key); else this.lockPulse.set(key, nl);
        }
        if (clearing) {
          const wave = Math.max(0, Math.min(1, clearT * 2.2 - Math.abs(x - 4.5) * 0.12));
          tmpC.lerp(WHITE, 0.4 + wave * 0.6);
          s = 1 + wave * 0.18;
          tmpV.z += wave * 0.4;
        }
        tmpQ.identity();
        tmpS.set(s, s, s);
        tmpM.compose(tmpV, tmpQ, tmpS);
        blocks.setMatrixAt(i, tmpM);
        blocks.setColorAt(i, tmpC);
        i++;
      }
    }

    // active piece & ghost
    let ghostVisible = false;
    if (game.piece && !game.over) {
      const p = game.piece;
      if (this.pieceVis.sid !== game._spawnId) { this.pieceVis.sid = game._spawnId; this.pieceVis.x = p.x; this.pieceVis.y = p.y; }
      const k = 1 - Math.exp(-dt * 28);
      this.pieceVis.x += (p.x - this.pieceVis.x) * k;
      this.pieceVis.y += (p.y - this.pieceVis.y) * k;
      if (Math.abs(p.x - this.pieceVis.x) > 3 || Math.abs(p.y - this.pieceVis.y) > 4) { this.pieceVis.x = p.x; this.pieceVis.y = p.y; }
      const ox = this.pieceVis.x - p.x, oy = this.pieceVis.y - p.y;
      const lockGlow = game.grounded() ? Math.min(1, game.lockTimer / 0.5) : 0;
      tmpC.setHex(COLORS[p.type]);
      const pulse = 0.08 + 0.06 * Math.sin(this.time * 6);
      tmpC.lerp(WHITE, pulse + lockGlow * 0.3);
      for (const [cx, cy] of CELLS[p.type][p.rot]) {
        cellToWorld(cx + p.x + ox, cy + p.y + oy, tmpV);
        tmpV.z = 0.06;
        tmpQ.identity(); tmpS.set(1, 1, 1);
        tmpM.compose(tmpV, tmpQ, tmpS);
        blocks.setMatrixAt(i, tmpM);
        blocks.setColorAt(i, tmpC);
        i++;
      }
      // ghost
      const gy = game.ghostY();
      if (gy !== p.y) {
        ghostVisible = true;
        this.ghostMat.color.setHex(COLORS[p.type]);
        this.ghostMat.emissive.setHex(COLORS[p.type]);
        this.ghostEdgeMat.color.setHex(COLORS[p.type]);
        CELLS[p.type][p.rot].forEach(([cx, cy], j) => {
          cellToWorld(cx + p.x, cy + gy, tmpV);
          tmpQ.identity(); tmpS.set(0.96, 0.96, 0.96);
          tmpM.compose(tmpV, tmpQ, tmpS);
          this.ghost.setMatrixAt(j, tmpM);
          this.ghostEdges[j].position.copy(tmpV);
        });
        this.ghost.instanceMatrix.needsUpdate = true;
      }
    }
    this.ghost.visible = ghostVisible;
    for (const e of this.ghostEdges) e.visible = ghostVisible;

    blocks.count = i;
    blocks.instanceMatrix.needsUpdate = true;
    if (blocks.instanceColor) blocks.instanceColor.needsUpdate = true;

    // particles
    const parts = this.parts;
    let n = 0;
    const alive = [];
    for (const pt of this.particles) {
      pt.life -= dt;
      if (pt.life <= 0) continue;
      pt.v.y -= 26 * dt;
      pt.v.multiplyScalar(Math.exp(-dt * 0.6));
      pt.p.addScaledVector(pt.v, dt);
      pt.rot.x += pt.av.x * dt; pt.rot.y += pt.av.y * dt; pt.rot.z += pt.av.z * dt;
      const f = pt.life / pt.max;
      const s = pt.s * Math.min(1, f * 2.2);
      tmpQ.setFromEuler(pt.rot);
      tmpS.set(s, s, s);
      tmpM.compose(pt.p, tmpQ, tmpS);
      parts.setMatrixAt(n, tmpM);
      tmpC.copy(pt.color).lerp(WHITE, (1 - f) * 0.3);
      parts.setColorAt(n, tmpC);
      n++;
      alive.push(pt);
    }
    this.particles = alive;
    parts.count = n;
    parts.instanceMatrix.needsUpdate = true;
    if (parts.instanceColor) parts.instanceColor.needsUpdate = true;

    // flash
    this.flash = Math.max(0, this.flash - dt * 3);
    this.flashLight.intensity = this.flash * 60;
    const neonBoost = 1 + this.flash * 1.5;
    this.neonMats[0].color.setRGB(0.27 * neonBoost, 0.84 * neonBoost, 1 * neonBoost);
    this.neonMats[1].color.setRGB(1 * neonBoost, 0.35 * neonBoost, 0.85 * neonBoost);

    // danger line pulses when stack is high
    let topRow = ROWS;
    for (let y = 0; y < ROWS; y++) if (game.board[y].some(Boolean)) { topRow = y; break; }
    const danger = topRow < HIDDEN_ROWS + 5 ? 1 : 0;
    this.dangerLine.material.opacity = 0.25 + danger * (0.4 + 0.3 * Math.sin(this.time * 8));

    // camera
    const target = this.camGoal;
    const kv = 1 - Math.exp(-dt * 7);
    this.view.yaw += (target.yaw - this.view.yaw) * kv;
    this.view.pitch += (target.pitch - this.view.pitch) * kv;
    this.view.zoom += (target.zoom - this.view.zoom) * kv;
    this.view.sway += (target.sway - this.view.sway) * kv;
    const sw = this.view.sway;
    const yaw = this.view.yaw + Math.sin(this.time * 0.35) * 0.045 * sw;
    const pitch = this.view.pitch + Math.sin(this.time * 0.27 + 1) * 0.022 * sw;
    const d = this.fitDistance(yaw, pitch) * this.view.zoom; // zoom is relative to the fitted framing at this angle
    this.shake = Math.max(0, this.shake - dt * 2.5);
    const sh = this.shake * this.shake;
    this.camera.position.set(
      this.camTarget.x + Math.sin(yaw) * Math.cos(pitch) * d + (Math.random() - 0.5) * sh * 0.6,
      this.camTarget.y + Math.sin(pitch) * d + (Math.random() - 0.5) * sh * 0.6,
      this.camTarget.z + Math.cos(yaw) * Math.cos(pitch) * d
    );
    this.camera.lookAt(this.camTarget);
    this.renderer.render(this.scene, this.camera);
  }
}
