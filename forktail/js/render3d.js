/* Fork-Tailed Devil - three.js renderer. Game logic stays 2D (x right, y down, logical width 270);
   every entity is placed by casting its screen position through a tilted perspective camera onto its altitude plane,
   then scaled by view depth, so on-screen positions and sizes match the 2D game exactly while lighting, shadows
   and parallax are fully 3D. No per-frame allocations: pooled meshes, instanced particles, preallocated scratch. */
import * as THREE from './vendor/three.webgpu.min.js';
import { SkyMesh } from './vendor/SkyMesh.js';
import { mapFor } from './terrain.js';
import { Fn, attribute, uniform, texture, vec2, vec3, vec4, float, uv, positionGeometry, positionWorld, materialColor,
         mix, sin, cos, floor, fract, smoothstep, step, dot, normalize, normalMap, normalView, positionViewDirection } from './vendor/three.tsl.min.js';

const TAU = Math.PI * 2;
// Two camera rigs. 2D is the near-vertical plan view a top-down shooter wants. 3D drops the
// camera back and tilts it toward the horizon, so the sea recedes, the aircraft bank in real
// perspective and the world gets depth. That is the whole of the difference: the camera moves,
// the game does not. TILT is measured off vertical.
//
// Every entity is placed by casting its screen position through the camera onto its own altitude
// plane, which lands it exactly where the 2D logic thinks it is, at any tilt - so the picture
// and the hit boxes agree in both rigs and the controls feel identical.
const CAM = {
  flat: { hc: 600, tilt: 14 * Math.PI / 180, fov: 34 },
  chase: { hc: 430, tilt: 42 * Math.PI / 180, fov: 42 },
};
let HC = CAM.flat.hc, TILT = CAM.flat.tilt, FOV = CAM.flat.fov;
let camK = 0;            // 0 = flat, 1 = chase; eased so the switch is a pull-back, not a cut
const ALT_K = 2.75;      // game altitude units -> world units (aircraft fly at game alt 40 = world 110)
const AIR = 40 * ALT_K, LOWCLOUD = 58, HIGHCLOUD = 330, WARN_ALT = 96, POW_ALT = 100;
// game-altitude -> world height. Entities without an `alt` (2D mode) sit on the old fixed plane.
const altW = (o) => (o && o.alt !== undefined ? o.alt : 40) * ALT_K;

export function createRenderer(canvas, S) {
  const META = window.SKY_META3D || {};
  const G = S.game, GW = G.W;
  const qs = new URLSearchParams(location.search);
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance', forceWebGL: qs.get('r') === 'webgl' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 0.5, 20, 4000);
  const R = { ok: true, loaded: false, quality: 3, errors: [], frames: 0, inited: false, backend: 'pending' };
  // WebGPURenderer initialises asynchronously. createRenderer() stays synchronous for boot3d.js:
  // R.render() simply no-ops until the device is up, then the deferred environment build is replayed.
  let pendingEnv = null;
  renderer.init().then(() => {
    R.inited = true;
    R.backend = renderer.backend && renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2';
    if (pendingEnv) { const a = pendingEnv; pendingEnv = null; buildEnv(a[0], a[1], a[2], a[3]); }
  }).catch((e) => { R.ok = false; R.errors.push('init: ' + e.message); console.warn('WebGPU/WebGL2 init failed', e); });

  // ---------------------------------------------------------------- camera mapping
  let lastCamK = 0;
  const CB = { cx: 0, cy: HC, cz: 0, fx: 0, fy: 0, fz: 0, rx: 0, ry: 0, rz: 0, ux: 0, uy: 0, uz: 0, tx: 0.2, ty: 0.3, H: 480 };
  const P = new THREE.Vector3();
  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), tmpS = new THREE.Vector3(), tmpV = new THREE.Vector3();
  function setupCamera(aspect, H) {
    const e2 = camK * camK * (3 - 2 * camK);   // smoothstep between the two rigs
    HC = CAM.flat.hc + (CAM.chase.hc - CAM.flat.hc) * e2;
    TILT = CAM.flat.tilt + (CAM.chase.tilt - CAM.flat.tilt) * e2;
    FOV = CAM.flat.fov + (CAM.chase.fov - CAM.flat.fov) * e2;
    CB.cy = HC;   // ray() traces from CB: leave this behind and every entity is placed for a camera that is not there
    camera.aspect = aspect; camera.fov = FOV; camera.updateProjectionMatrix();
    camera.position.set(0, HC, 0); camera.up.set(0, 0, -1);
    camera.lookAt(0, 0, -HC * Math.tan(TILT));
    camera.updateMatrixWorld(true);
    const e = camera.matrixWorld.elements;
    CB.rx = e[0]; CB.ry = e[1]; CB.rz = e[2]; CB.ux = e[4]; CB.uy = e[5]; CB.uz = e[6]; CB.fx = -e[8]; CB.fy = -e[9]; CB.fz = -e[10];
    CB.ty = Math.tan(FOV * Math.PI / 360); CB.tx = CB.ty * aspect; CB.H = H;
  }
  // Screen-space game point -> world point. Writes P, returns view depth.
  // Casts the game's screen position through the camera onto the plane y = alt, so the entity
  // lands on exactly the pixel the 2D game puts it on, whatever the tilt and whatever its
  // height. Height then shows up where it belongs - in the lighting, and in where the shadow
  // falls on the water - and never in where the thing is on screen.
  function ray(gx, gy, alt) {
    const nx = gx / GW * 2 - 1, ny = 1 - gy / CB.H * 2;
    const dx = CB.fx + nx * CB.tx * CB.rx + ny * CB.ty * CB.ux, dy = CB.fy + nx * CB.tx * CB.ry + ny * CB.ty * CB.uy, dz = CB.fz + nx * CB.tx * CB.rz + ny * CB.ty * CB.uz;
    const t = (alt - CB.cy) / dy;
    P.set(CB.cx + dx * t, alt, CB.cz + dz * t);
    return t;
  }
  const sc = (t) => 2 * t * CB.tx / GW; // world units per game unit at depth t

  // ---------------------------------------------------------------- lights + environment
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
  const sc0 = sun.shadow.camera; sc0.near = 10; sc0.far = 2200; sc0.left = -330; sc0.right = 330; sc0.top = 420; sc0.bottom = -420;
  scene.add(sun); scene.add(sun.target);
  const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x1a3550, 0.6); scene.add(hemi);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const sky = new SkyMesh(); sky.scale.setScalar(5000);
  const skyScene = new THREE.Scene(); skyScene.add(sky);
  let envRT = null;
  const sunDir = new THREE.Vector3();
  const shR = new THREE.Vector3(), shU = new THREE.Vector3(), shQ = new THREE.Vector3(), WUP = new THREE.Vector3(0, 1, 0);
  // Fit the shadow box to the ground the camera can actually see, plus the height aircraft fly
  // at, measured in the light's own frame. Sizing it from the camera's reach instead made it
  // 2300 units tall in the chase rig; across a 2048 map that is more than a world unit per
  // texel, and a P-38's shadow came out as a handful of black squares.
  function fitShadow(H) {
    shR.crossVectors(WUP, sunDir); if (shR.lengthSq() < 1e-6) shR.set(1, 0, 0);
    shR.normalize(); shU.crossVectors(sunDir, shR);
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (let i = 0; i < 8; i++) {
      ray((i & 1) ? GW : 0, (i & 2) ? H : 0, (i & 4) ? AIR : 0);
      shQ.copy(P).sub(sun.target.position);
      const x = shQ.dot(shR), y = shQ.dot(shU);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const q = 8, pad = 60;   // quantised so the texel grid stops swimming as the box breathes
    sc0.left = Math.floor((x0 - pad) / q) * q; sc0.right = Math.ceil((x1 + pad) / q) * q;
    sc0.bottom = Math.floor((y0 - pad) / q) * q; sc0.top = Math.ceil((y1 + pad) / q) * q;
    sc0.updateProjectionMatrix();
    R.shW = sc0.right - sc0.left; R.shH = sc0.top - sc0.bottom;   // world units across the shadow map, for checking texel size
  }
  function buildEnv(elev, azim, turb, ray2) {
    if (!R.inited) { pendingEnv = [elev, azim, turb, ray2]; return; } // PMREM needs a live device
    sky.turbidity.value = turb; sky.rayleigh.value = ray2; sky.mieCoefficient.value = 0.005; sky.mieDirectionalG.value = 0.8;
    const phi = THREE.MathUtils.degToRad(90 - Math.max(elev, 2)), th = THREE.MathUtils.degToRad(azim);
    tmpV.setFromSphericalCoords(1, phi, th); sky.sunPosition.value.copy(tmpV);
    if (envRT) envRT.dispose();
    envRT = pmrem.fromScene(skyScene, 0, 1, 10000);
    scene.environment = envRT.texture;
  }
  const LIGHTS = [];
  for (let i = 0; i < 3; i++) { const l = new THREE.PointLight(0xffa860, 0, 0, 2); l.castShadow = false; scene.add(l); LIGHTS.push(l); }

  // ---------------------------------------------------------------- textures
  const texLoader = new THREE.TextureLoader();
  const pending = [];
  function tex(url, srgb, rep) {
    const t = texLoader.load(url, undefined, undefined, () => R.errors.push(url));
    if (srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8; // WebGPU guarantees 16; WebGL2 fallback clamps internally
    if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    pending.push(t);
    return t;
  }
  function imgLoad(url) { return new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => { R.errors.push(url); res(null); }; im.src = url; }); }

  // ---------------------------------------------------------------- relief meshes (albedo photo + heightmap)
  function decodeHM(m) { const b = atob(m.hm), a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
  function relief(name, under) {
    const m = META[name]; if (!m) return null;
    const hm = decodeHM(m), gw = m.gw, gh = m.gh, n = gw * gh, two = under > 0 ? 2 : 1;
    const pos = new Float32Array(n * 3 * two), uv = new Float32Array(n * 2 * two);
    for (let s = 0; s < two; s++) for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      const k = j * gw + i, o = s * n + k, hh = hm[k] / 255 * m.hmax;
      pos[o * 3] = (i / (gw - 1) - 0.5) * m.w; pos[o * 3 + 1] = s ? -hh * under : hh; pos[o * 3 + 2] = (j / (gh - 1) - 0.5) * m.h;
      uv[o * 2] = i / (gw - 1); uv[o * 2 + 1] = 1 - j / (gh - 1);
    }
    const idx = [];
    for (let s = 0; s < two; s++) for (let j = 0; j < gh - 1; j++) for (let i = 0; i < gw - 1; i++) {
      const a = s * n + j * gw + i, b = a + 1, c = a + gw, d = c + 1;
      if (hm[j * gw + i] + hm[j * gw + i + 1] + hm[(j + 1) * gw + i] + hm[(j + 1) * gw + i + 1] === 0 && under >= 0) { /* keep flat cells: alpha decides */ }
      if (!s) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(n * two > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    g.computeVertexNormals(); g.computeBoundingSphere();
    g.userData = { w: m.w, h: m.h, hmax: m.hmax, hm, gw, gh };
    return g;
  }
  function heightAt(g, lx, lz) { // sample relief height (game units) at local x,z
    const u = g.userData; if (!u.hm) return 0;
    const i = Math.round((lx / u.w + 0.5) * (u.gw - 1)), j = Math.round((lz / u.h + 0.5) * (u.gh - 1));
    if (i < 0 || j < 0 || i >= u.gw || j >= u.gh) return 0;
    return u.hm[j * u.gw + i] / 255 * u.hmax;
  }
  // battle damage: procedural scorch + holes, per-object uniforms (uploaded in onBeforeRender)
  // ---- damage overlay (scorch + bullet holes + hit flash), ported to TSL node materials.
  // WebGPU batches uniform writes per material, so each damaged mesh gets its OWN material clone
  // with its own uniform nodes instead of the old shared-material + onBeforeRender mutation.
  const h21 = Fn(([q]) => {
    const pp = fract(q.mul(vec2(123.34, 456.21))).toVar();
    pp.addAssign(dot(pp, pp.add(vec2(45.32, 45.32))));
    return fract(pp.x.mul(pp.y));
  });
  const vn = Fn(([q]) => {
    const i = floor(q), f = fract(q).toVar();
    f.assign(f.mul(f).mul(float(3).sub(f.mul(2))));
    return mix(mix(h21(i), h21(i.add(vec2(1, 0))), f.x), mix(h21(i.add(vec2(0, 1))), h21(i.add(vec2(1, 1))), f.x), f.y);
  });
  function damageNodes(mat, kind) {
    const U = { uDmg: { value: 0 }, uFlash: { value: 0 }, uSeed: { value: 0 } };
    const uDmg = uniform(0), uFlash = uniform(0), uSeed = uniform(0);
    U.uDmg = uDmg; U.uFlash = uFlash; U.uSeed = uSeed; // same {value} shape bindDamage() expects
    mat.userData.U = U;
    const scale = kind === 'ship' ? vec2(6.0, 30.0) : vec2(14.0, 12.0);
    const base = mat.map ? texture(mat.map) : vec4(1, 1, 1, 1);
    const tinted = base.rgb.mul(materialColor);
    const q = uv().mul(scale).add(uSeed);
    const n = vn(q).mul(0.65).add(vn(q.mul(2.7)).mul(0.35));
    const scorch = smoothstep(float(1).sub(uDmg.mul(0.9)), float(1.05).sub(uDmg.mul(0.75)), n);
    const hole = step(float(0.985).sub(uDmg.mul(0.09)), vn(uv().mul(vec2(40.0, 36.0)).add(uSeed.mul(3.1))));
    const holeK = mix(float(1), float(0.05), hole.mul(step(0.25, uDmg)));
    // alpha MUST go through opacityNode - NodeMaterial ignores the alpha channel of
    // colorNode, so alphaTest would never discard the cut-out background.
    mat.colorNode = tinted.mul(float(1).sub(scorch.mul(0.78))).mul(holeK).add(vec3(1.0, 0.85, 0.6).mul(uFlash).mul(0.35));
    mat.opacityNode = base.a;
    mat.castShadowNode = cutoutShadow(base.a);
    return mat;
  }
  function damageMat(params, kind) {
    const mat = new THREE.MeshStandardNodeMaterial(params);
    mat.userData.kind = kind;
    return damageNodes(mat, kind);
  }
  // fresh material (own uniform nodes) for one mesh; tint is optional
  // NOTE: MeshStandardNodeMaterial.clone() does NOT copy `map` (or the other classic
  // texture slots), so they are reassigned explicitly - without this every cloned body
  // renders untextured.
  function dmgClone(src, tint) {
    const mat = src.clone();
    for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap']) if (src[k]) mat[k] = src[k];
    mat.alphaTest = src.alphaTest; mat.transparent = src.transparent; mat.side = src.side;
    mat.roughness = src.roughness; mat.metalness = src.metalness; mat.envMapIntensity = src.envMapIntensity;
    mat.userData = { kind: src.userData.kind };
    mat.color.copy(src.color); if (tint) mat.color.set(tint);
    return damageNodes(mat, src.userData.kind);
  }
  function bindDamage(mesh) {
    mesh.onBeforeRender = function () { const U = this.material.userData.U; if (!U) return; U.uDmg.value = this.userData.dmg || 0; U.uFlash.value = this.userData.flash || 0; U.uSeed.value = this.userData.seed || 0; };
  }
  // Shadow silhouettes for alpha cut-outs.
  // The shadow pass builds its own material and copies only `alphaTest` and `alphaMap` across -
  // not `map`, and not `opacityNode`. Every model here is a flat quad whose shape lives entirely
  // in its texture alpha, so without an alpha source the shadow pass sees opacity 1 everywhere
  // and each caster drops its whole rectangle: every shadow came out a black box.
  // `castShadowNode` is the hook the shadow pass does read (it becomes that material's colorNode),
  // so feeding it a hard 0/1 alpha gives back the real silhouette. The step() keeps it binary so
  // the material's own alphaTest can stay wherever the visible pass wants it.
  const cutoutShadow = (alpha) => vec4(0, 0, 0, step(0.5, alpha));

  // ---------------------------------------------------------------- models
  const MODELS = {};
  const AIRCRAFT = { player: 0.55, zero: 0.6, zero_red: 0.6, bomber: 0.6, heavy: 0.55 };
  const PROPS = { player: [[-8.4, -15.2, 2.4], [8.4, -15.2, 2.4]], zero: [[0, -9.6, 2.4]], zero_red: [[0, -10.6, 2.4]], bomber: [[-7.8, -20.5, 3.2], [7.8, -20.5, 3.2]], heavy: [[-33, -36, 4.2], [-18, -36, 4.2], [18, -36, 4.2], [33, -36, 4.2]] };
  function buildModels() {
    for (const k in META) {
      const m = META[k]; if (k.startsWith('island')) continue;
      const air = AIRCRAFT[k] !== undefined;
      const geo = relief(k, air ? AIRCRAFT[k] : 0);
      const map = tex(m.tex);
      const mat = damageMat({ map, alphaTest: 0.5, roughness: air ? 0.42 : 0.62, metalness: air ? 0.45 : 0.25, envMapIntensity: 1.0, side: THREE.FrontSide }, air ? 'air' : 'ship');
      MODELS[k] = { geo, map, mat, air, m };
    }
    for (let i = 0; i < 3; i++) {
      const k = 'island' + i, m = META[k]; if (!m) continue;
      const geo = relief(k, 0), map = tex(m.tex);
      const mat = new THREE.MeshStandardNodeMaterial({ map, color: 0xd8d8d8, transparent: true, alphaTest: 0.03, roughness: 0.95, metalness: 0, envMapIntensity: 0.35, depthWrite: true });
      mat.castShadowNode = cutoutShadow(texture(map).a);
      MODELS[k] = { geo, map, mat, m };
    }
  }
  buildModels();

  // ---------------------------------------------------------------- ocean
  // Generated by tools/mkwater.py from periodic value noise, so it tiles exactly. The old
  // photographic normal map did not wrap - its edge step was ~1.8x a normal neighbour step, and
  // a discontinuity that runs dead straight along every tile boundary reads as a grid however the
  // octaves are rotated. Rotating them only changed the angle of the grid.
  const waterN = tex('assets/tex/waternormals.png', false, true);
  const OCEAN_SIZE = 12000, TILE = 70;   // TILE is world units per wave tile: it sets wave size, OCEAN_SIZE only sets reach
  const oceanColN = uniform(new THREE.Color(0x0b3a5e));
  waterN.repeat.set(OCEAN_SIZE / TILE, OCEAN_SIZE / TILE);
  const oceanU = { uOff1: uniform(new THREE.Vector2()), uOff2: uniform(new THREE.Vector2()), uFoam: uniform(0.25), uSpec: uniform(0.3), uNScale: uniform(0.55) };
  const oceanMat = new THREE.MeshStandardNodeMaterial({ color: 0x0b3a5e, roughness: 0.3, metalness: 0.0, envMapIntensity: 1.15 });
  {
    // Three scrolling octaves of the same normal map, blended, with a foam term on the crests.
    // Each octave is rotated as well as rescaled: sampling all three on the same axes made every
    // tile edge land on the same horizontal lines, and the sea came out as a corrugated grid of
    // seams. Rotating by a swizzle is free, and incommensurate scales keep the repeats from ever
    // lining up again. No octave dominates, so no single tile grid shows through.
    const nUv = uv().mul(OCEAN_SIZE / TILE);
    // rotate a uv about the origin: the octaves have to sit at genuinely oblique angles to each
    // other. Transposing with a .yx swizzle looks like a rotation but it is 90 degrees, which maps
    // a square tiling straight back onto itself - two octaves then share one axis-aligned grid and
    // their seams stack into the visible squares.
    const rot2 = (v, a) => { const c = Math.cos(a), s2 = Math.sin(a); return vec2(v.x.mul(c).sub(v.y.mul(s2)), v.x.mul(s2).add(v.y.mul(c))); };
    // proper octaves: amplitude falls as the frequency rises, so the sea reads as a broad swell
    // carrying chop and ripple. Three similar mid frequencies at equal weight just weave into a
    // regular quilt, which looks like fabric rather than water.
    const s1 = texture(waterN, rot2(nUv, 0.37).mul(0.45).add(oceanU.uOff1.mul(0.45))).xyz.mul(2).sub(1);
    const s2 = texture(waterN, rot2(nUv, 1.11).add(oceanU.uOff2)).xyz.mul(2).sub(1);
    const s3 = texture(waterN, rot2(nUv, 2.30).mul(2.6).sub(oceanU.uOff1.mul(1.6))).xyz.mul(2).sub(1);
    const sum = s1.mul(0.8).add(s2.mul(0.5).add(s3.mul(0.28)));
    const mapN = normalize(sum);
    oceanMat.normalNode = normalMap(mapN.mul(0.5).add(0.5), vec2(oceanU.uNScale, oceanU.uNScale));
    // foam off the raw sum, not the normalised vector - normalising makes every pixel a crest
    const crest = smoothstep(0.5, 0.95, sum.xy.length()).mul(oceanU.uFoam);
    const lit = float(0.82).add(mapN.z.clamp(0, 1).mul(0.3)).sub(0.12);
    oceanMat.colorNode = vec4(mix(oceanColN.mul(lit), vec3(0.8, 0.86, 0.9), crest.mul(0.8)), 1.0);
  }
  const oceanGeo = new THREE.PlaneGeometry(OCEAN_SIZE, OCEAN_SIZE, 1, 1); oceanGeo.rotateX(-Math.PI / 2);
  oceanMat.depthWrite = false; // drawn first, below everything else
  const ocean = new THREE.Mesh(oceanGeo, oceanMat); ocean.position.y = 0; ocean.renderOrder = -10; scene.add(ocean);
  ocean.receiveShadow = true;

  // ---------------------------------------------------------------- particle atlas (4 x 2 cells of 128 px)
  // 0 smoke, 1 fireball, 2 glow, 3 flare, 4 foam, 5 splash, 6 ring, 7 tracer
  const atlasC = document.createElement('canvas'); atlasC.width = 512; atlasC.height = 256;
  const atlas = new THREE.CanvasTexture(atlasC); atlas.colorSpace = THREE.SRGBColorSpace;
  function drawAtlas(imgs) {
    const g = atlasC.getContext('2d'); g.clearRect(0, 0, 512, 256);
    const cell = (i) => [(i % 4) * 128, ((i / 4) | 0) * 128];
    const rad = (i, stops) => { const [x, y] = cell(i); const gr = g.createRadialGradient(x + 64, y + 64, 0, x + 64, y + 64, 62); for (const [o, c] of stops) gr.addColorStop(o, c); g.fillStyle = gr; g.fillRect(x, y, 128, 128); };
    const img = (i, im, fb) => { const [x, y] = cell(i); if (im) g.drawImage(im, x + 2, y + 2, 124, 124); else fb(); };
    img(0, imgs.smoke, () => rad(0, [[0, 'rgba(200,200,200,0.9)'], [1, 'rgba(200,200,200,0)']]));
    img(1, imgs.fireball, () => rad(1, [[0, '#fff8e0'], [0.4, '#ffa040'], [1, 'rgba(255,60,0,0)']]));
    rad(2, [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.55)'], [0.6, 'rgba(255,255,255,0.12)'], [1, 'rgba(255,255,255,0)']]);
    rad(3, [[0, 'rgba(255,255,255,1)'], [0.12, 'rgba(255,255,255,0.9)'], [0.35, 'rgba(255,255,255,0.25)'], [1, 'rgba(255,255,255,0)']]);
    { const [x, y] = cell(3); g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillRect(x + 4, y + 62, 120, 4); g.fillRect(x + 62, y + 4, 4, 120); }
    // foam: noisy soft blob
    { const [x, y] = cell(4); for (let k = 0; k < 90; k++) { const a = Math.random() * TAU, r = Math.random() * 44, s = 6 + Math.random() * 14; const gr = g.createRadialGradient(x + 64 + Math.cos(a) * r, y + 64 + Math.sin(a) * r, 0, x + 64 + Math.cos(a) * r, y + 64 + Math.sin(a) * r, s); gr.addColorStop(0, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(x, y, 128, 128); } }
    img(5, imgs.splash, () => rad(5, [[0, 'rgba(255,255,255,0.9)'], [1, 'rgba(255,255,255,0)']]));
    { const [x, y] = cell(6); g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 7; g.beginPath(); g.arc(x + 64, y + 64, 55, 0, TAU); g.stroke(); g.lineWidth = 16; g.strokeStyle = 'rgba(255,255,255,0.25)'; g.stroke(); }
    // The tracer needs its tail faded out, which takes a destination-in pass. That composite is
    // not confined to the rectangle it fills: it erases the destination EVERYWHERE the source is
    // transparent, so masking this tile in place wiped the other seven - smoke, fireball, glow,
    // flare, foam, splash and ring all went blank, and the only particle left in the game was the
    // player's own tracer. Mask it on its own tile and blit the result in.
    { const [x, y] = cell(7), c7 = document.createElement('canvas'); c7.width = c7.height = 128;
      const h = c7.getContext('2d');
      const gr = h.createLinearGradient(40, 0, 88, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      h.fillStyle = gr; h.fillRect(40, 4, 48, 120);
      const g2 = h.createLinearGradient(0, 0, 0, 128); g2.addColorStop(0, 'rgba(0,0,0,0)'); g2.addColorStop(0.15, 'rgba(0,0,0,1)'); g2.addColorStop(1, 'rgba(0,0,0,1)');
      h.globalCompositeOperation = 'destination-in'; h.fillStyle = g2; h.fillRect(0, 0, 128, 128);
      g.drawImage(c7, x, y); }
    atlas.needsUpdate = true;
  }
  drawAtlas({});
  Promise.all(['assets/smoke.webp', 'assets/fireball.webp', 'assets/splash.webp'].map(imgLoad)).then(([smoke, fireball, splash]) => drawAtlas({ smoke, fireball, splash }));

  const HERO = 1.1;   // matches the 2D renderer: the player's aircraft is drawn oversize
  // ---------------------------------------------------------------- explosion atlas (6 x 5 of 192 px)
  // A fireball is a cloud of burning lumps, and what makes it read as a solid object rather than a
  // decal is that the lumps occlude each other and are lit from one side. So each of these is built
  // from twenty-odd puffs scattered through a sphere, sorted back to front, each one shaded with
  // its highlight pushed toward the light - near puffs cover far puffs, and the eye reads depth.
  // Hot in the middle cooling outward, soot around the rim where it has stopped burning.
  // Thirty of them, so the same blast never comes up twice in a row; one spinning picture was
  // always going to look like one spinning picture.
  const BOOM_N = 30, BOOM_COLS = 6, BOOM_ROWS = 5, BOOM_CELL = 192;
  const boomC = document.createElement('canvas');
  boomC.width = BOOM_COLS * BOOM_CELL; boomC.height = BOOM_ROWS * BOOM_CELL;
  const boomTex = new THREE.CanvasTexture(boomC);
  (function drawBooms() {
    const g = boomC.getContext('2d');
    // temperature -> colour, white hot through to cold soot
    const RAMP = [[0.00, 36, 24, 20], [0.22, 150, 44, 12], [0.46, 255, 118, 28], [0.72, 255, 198, 88], [1.00, 255, 250, 232]];
    function hot(k) {
      k = k < 0 ? 0 : k > 1 ? 1 : k;
      for (let i = 1; i < RAMP.length; i++) {
        if (k <= RAMP[i][0]) {
          const a = RAMP[i - 1], b = RAMP[i], f = (k - a[0]) / (b[0] - a[0]);
          return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f];
        }
      }
      return RAMP[RAMP.length - 1].slice(1);
    }
    for (let n = 0; n < BOOM_N; n++) {
      // deterministic per cell, so a given blast looks the same every run
      let seed = n * 9781 + 12345;
      const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      const ox = (n % BOOM_COLS) * BOOM_CELL, oy = ((n / BOOM_COLS) | 0) * BOOM_CELL;
      const C = BOOM_CELL / 2, R = BOOM_CELL * 0.43;
      g.save();
      g.beginPath(); g.rect(ox, oy, BOOM_CELL, BOOM_CELL); g.clip();
      g.translate(ox, oy);
      // puffs scattered through a squashed sphere, back to front
      const puffs = [];
      const count = 30 + ((rnd() * 14) | 0);
      for (let i = 0; i < count; i++) {
        const th = rnd() * TAU, ph = Math.acos(2 * rnd() - 1);
        const rr = Math.pow(rnd(), 0.5) * R;
        puffs.push({
          x: Math.sin(ph) * Math.cos(th) * rr,
          y: Math.cos(ph) * rr * 0.86,
          z: Math.sin(ph) * Math.sin(th) * rr,
          r: R * (0.13 + rnd() * rnd() * 0.26),
          soot: rr > R * 0.58 && rnd() < 0.6,
        });
      }
      puffs.sort((a, b) => a.z - b.z);
      const LX = -0.42, LY = -0.5;               // light from the upper left
      for (const q of puffs) {
        const d = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z) / R;
        const depth = (q.z / R) * 0.5 + 0.5;      // nearer puffs catch more light
        const k = Math.max(0, 1 - d * 1.15) * (0.55 + depth * 0.65);
        const cx = C + q.x, cy = C + q.y;
        const hx = cx + LX * q.r * 0.55, hy = cy + LY * q.r * 0.55;
        const gr = g.createRadialGradient(hx, hy, q.r * 0.06, cx, cy, q.r);
        const rgba = (c, a) => 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a.toFixed(3) + ')';
        if (q.soot) {
          const sh = 0.5 + depth * 0.5;
          g.globalCompositeOperation = 'source-over';
          gr.addColorStop(0, rgba([62 * sh, 50 * sh, 44 * sh], 0.95));
          gr.addColorStop(0.46, rgba([38 * sh, 30 * sh, 27 * sh], 0.88));
          gr.addColorStop(0.8, 'rgba(20,16,15,0.42)');
          gr.addColorStop(1, 'rgba(14,11,10,0)');
        } else {
          // Hold the body bright and fall off late: a soft gradient all the way out is what turned
          // a crowd of lumps into one smear.
          // Opacity matters as much as colour: these are alpha-blended over whatever is behind
          // them, and a sunlit sea coming through a half-transparent fireball is what turns fire
          // into a pale smudge. Keep the body nearly solid, and hold the colour back from white -
          // 'lighter' accumulates, and a dozen overlapping puffs will clip to white on their own.
          const c0 = hot(Math.min(1, k * 1.05)), c1 = hot(k * 0.72), c2 = hot(k * 0.42), c3 = hot(k * 0.2);
          g.globalCompositeOperation = 'lighter';
          gr.addColorStop(0, rgba(c0, 0.78 + k * 0.22));
          gr.addColorStop(0.44, rgba(c1, 0.6 + k * 0.3));
          gr.addColorStop(0.76, rgba(c2, 0.3 + k * 0.22));
          gr.addColorStop(0.94, rgba(c3, 0.06));
          gr.addColorStop(1, rgba(c3, 0));
        }
        g.fillStyle = gr;
        g.beginPath(); g.arc(cx, cy, q.r, 0, TAU); g.fill();
        // terminator: the side facing away from the light goes dark, which is most of what makes a
        // flat disc look like a ball
        if (!q.soot) {
          g.globalCompositeOperation = 'source-over';
          const sx2 = cx - LX * q.r * 0.75, sy2 = cy - LY * q.r * 0.75;
          const sg = g.createRadialGradient(sx2, sy2, q.r * 0.05, sx2, sy2, q.r * 1.02);
          sg.addColorStop(0, 'rgba(26,14,10,' + (0.3 * (1 - depth) + 0.08).toFixed(3) + ')');
          sg.addColorStop(0.7, 'rgba(26,14,10,0.05)');
          sg.addColorStop(1, 'rgba(26,14,10,0)');
          g.fillStyle = sg; g.beginPath(); g.arc(cx, cy, q.r, 0, TAU); g.fill();
        }
      }
      // the core, so the middle always reads as the hottest part of it
      g.globalCompositeOperation = 'lighter';
      const core = g.createRadialGradient(C + LX * 6, C + LY * 6, 0, C, C, R * 0.72);
      core.addColorStop(0, 'rgba(255,246,214,0.7)');
      core.addColorStop(0.35, 'rgba(255,186,84,0.4)');
      core.addColorStop(1, 'rgba(255,96,24,0)');
      g.fillStyle = core; g.beginPath(); g.arc(C, C, R * 0.72, 0, TAU); g.fill();
      g.restore();
      g.globalCompositeOperation = 'source-over';
    }
    boomTex.needsUpdate = true;
  })();

  const camRight = new THREE.Vector3(), camUp = new THREE.Vector3();
  function pool(cap, add, flat, order, tex, cols, rows) {
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index; g.setAttribute('position', base.getAttribute('position'));
    const A = { pos: new Float32Array(cap * 3), size: new Float32Array(cap * 2), rot: new Float32Array(cap), col: new Float32Array(cap * 4), tex: new Float32Array(cap) };
    const at = { iPos: new THREE.InstancedBufferAttribute(A.pos, 3), iSize: new THREE.InstancedBufferAttribute(A.size, 2), iRot: new THREE.InstancedBufferAttribute(A.rot, 1), iCol: new THREE.InstancedBufferAttribute(A.col, 4), iTex: new THREE.InstancedBufferAttribute(A.tex, 1) };
    for (const k in at) { at[k].setUsage(THREE.DynamicDrawUsage); g.setAttribute(k, at[k]); }
    g.instanceCount = 0;
    // instanced camera-facing billboards, in TSL. uRight/uUp alias the live camera-basis vectors.
    const uFlatN = uniform(flat ? 1 : 0), uLightN = uniform(1);
    const uRightN = uniform(camRight), uUpN = uniform(camUp);
    const iPos = attribute('iPos', 'vec3'), iSize = attribute('iSize', 'vec2'),
          iRot = attribute('iRot', 'float'), iCol = attribute('iCol', 'vec4'), iTex = attribute('iTex', 'float');
    const q = positionGeometry.xy;
    const cs = cos(iRot), sn = sin(iRot);
    const rr = vec2(q.x.mul(cs).sub(q.y.mul(sn)), q.x.mul(sn).add(q.y.mul(cs))).mul(iSize);
    const Rv = mix(uRightN, vec3(1, 0, 0), uFlatN), Uv2 = mix(uUpN, vec3(0, 0, -1), uFlatN);
    const COLS = cols || 4, ROWS = rows || 2;
    const fx = iTex.mod(COLS), fy = iTex.div(COLS).floor();
    const cellUv = vec2(fx.add(q.x).add(0.5).mul(1 / COLS), float(ROWS - 1).sub(fy).add(q.y).add(0.5).mul(1 / ROWS));
    const t = texture(tex || atlas, cellUv);
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: true,
      blending: add ? THREE.CustomBlending : THREE.NormalBlending, fog: !add });
    mat.positionNode = iPos.add(Rv.mul(rr.x)).add(Uv2.mul(rr.y));
    if (add) {
      mat.colorNode = t.rgb.mul(iCol.rgb).mul(t.a).mul(iCol.a);
      mat.opacityNode = float(1);
      mat.blendSrc = THREE.OneFactor; mat.blendDst = THREE.OneFactor; mat.blendEquation = THREE.AddEquation;
    } else {
      mat.colorNode = t.rgb.mul(iCol.rgb).mul(uLightN);
      mat.opacityNode = t.a.mul(iCol.a);
    }
    const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.renderOrder = order; scene.add(mesh);
    const pl = { cap, n: 0, A, at, g, mesh, mat, uLight: uLightN };
    pl.push = function (x, y, z, sx, sy, rot, r, gg, b, a, tx) {
      if (this.n >= this.cap) return;
      const i = this.n++, A2 = this.A;
      A2.pos[i * 3] = x; A2.pos[i * 3 + 1] = y; A2.pos[i * 3 + 2] = z; A2.size[i * 2] = sx; A2.size[i * 2 + 1] = sy; A2.rot[i] = rot;
      A2.col[i * 4] = r; A2.col[i * 4 + 1] = gg; A2.col[i * 4 + 2] = b; A2.col[i * 4 + 3] = a; A2.tex[i] = tx;
    };
    pl.flush = function () { this.g.instanceCount = this.n; for (const k in this.at) { this.at[k].needsUpdate = true; this.at[k].addUpdateRange ? (this.at[k].clearUpdateRanges(), this.at[k].addUpdateRange(0, this.n * this.at[k].itemSize)) : 0; } };
    return pl;
  }
  const FLAT = pool(900, false, true, 2), SMOKE = pool(1100, false, false, 6), ADD = pool(1800, true, false, 8), ADDFLAT = pool(300, true, true, 3);
  // Normal blending, not additive: these have soot in them, and soot that cannot occlude anything
  // is soot you never see. Drawn at 7 so the additive heat and flash still go over the top.
  const BOOM = pool(400, false, false, 7, boomTex, BOOM_COLS, BOOM_ROWS);
  // game point -> particle; size in game units
  function sprite(pl, gx, gy, altW, sizeG, aspect, rot, r, g, b, a, tx) {
    const t = ray(gx, gy, altW), s = sc(t) * sizeG;
    pl.push(P.x, P.y, P.z, s, s * (aspect || 1), rot, r, g, b, a, tx);
  }

  // ---------------------------------------------------------------- mesh pools
  function meshPool(make) { const arr = []; let n = 0; return { get() { let m = arr[n]; if (!m) { m = make(); arr.push(m); scene.add(m); } m.visible = true; n++; return m; }, reset() { n = 0; }, end() { for (let i = n; i < arr.length; i++) arr[i].visible = false; }, arr }; }
  function propMesh(r) {
    const g = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 20), new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }));
    const blades = new THREE.Mesh(new THREE.BoxGeometry(r * 2, r * 0.16, 0.15), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6, metalness: 0.4 }));
    g.add(disc); g.add(blades); g.userData.blades = blades;
    return g;
  }
  function aircraftMesh(type, tint) {
    const M = MODELS[type]; if (!M) return new THREE.Group();
    let mat = M.mat;
    mat = dmgClone(M.mat, tint);
    const body = new THREE.Mesh(M.geo, mat); body.castShadow = true; bindDamage(body);
    const root = new THREE.Group(), tiltG = new THREE.Group(); root.add(tiltG); tiltG.add(body);
    // Only the hero gets an edge - wingmen share this model with a tint, and outlining the whole
    // flight would put the line back to meaning nothing.
    if (type === 'player' && !tint && M.mat.map) {
      // The aeroplane is a quad and its shape is entirely in the texture alpha - the same thing
      // that made every shadow a black box until castShadowNode was fed a cutout. An outline has
      // to read that alpha too: a dark copy of the quad, grown in its own plane and drawn first,
      // shows only where it sticks out past the aircraft covering it. Give it a plain colour
      // instead and you are drawing the rectangle, which is exactly the box that came back.
      const em = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: M.mat.side });
      em.colorNode = vec3(0.02, 0.028, 0.05);
      em.opacityNode = step(0.42, texture(M.mat.map).a);
      const edge = new THREE.Mesh(M.geo, em);
      edge.scale.set(1.07, 1, 1.07);
      edge.renderOrder = -1; tiltG.add(edge);
    }
    const props = [];
    for (const [x, z, r] of PROPS[type] || []) { const p = propMesh(r); p.position.set(x, heightAt(M.geo, x, z + 2) * 0.7, z); tiltG.add(p); props.push(p); }
    root.userData = { body, tiltG, props, type };
    return root;
  }
  const POOLS = {}, SHIPPOOL = { pools: {} };
  function airPool(type, tint) { const k = type + (tint || ''); return POOLS[k] || (POOLS[k] = meshPool(() => aircraftMesh(type, tint))); }
  function shipMesh(type) {
    const M = MODELS[type === 'ptboat' ? 'destroyer' : type]; const root = new THREE.Group(); if (!M) return root;
    const body = new THREE.Mesh(M.geo, dmgClone(M.mat)); body.castShadow = true; body.receiveShadow = true; bindDamage(body);
    const listG = new THREE.Group(); root.add(listG); listG.add(body);
    root.userData = { body, listG, turrets: [], type, geo: M.geo, elev: [] };
    return root;
  }
  const turretPools = { big: meshPool(() => { const M = MODELS.turretBig, m = new THREE.Mesh(M.geo, dmgClone(M.mat)); m.castShadow = true; scene.remove(m); return m; }), small: meshPool(() => { const M = MODELS.turretSmall, m = new THREE.Mesh(M.geo, dmgClone(M.mat)); m.castShadow = true; scene.remove(m); return m; }) };
  const elevMat = new THREE.MeshStandardMaterial({ color: 0x5a5448, roughness: 0.8 }), elevDead = new THREE.MeshStandardMaterial({ color: 0x15110e, roughness: 1, emissive: 0x401000, emissiveIntensity: 0.6 });
  const elevGeo = new THREE.BoxGeometry(1, 0.6, 1);
  // ---------------------------------------------------------------- real coastlines
  // A map is polygons in playfield coordinates. Triangulate once there, then map the vertices
  // through the camera every frame: the coast lands exactly where the gameplay says it does, at
  // any tilt, and a ship moored off a point stays off that point.
  //
  // Two things have to be true for it to read as land rather than as a hole cut in the sea.
  //
  // One: the picture has to be pinned to the ground, not to the screen. Every vertex carries the
  // playfield coordinate it came from, and the aerial texture is sampled by that - so a field is
  // the same field as it scrolls past, and flying over the island moves you over the island
  // instead of wiping a stencil across a stationary pattern.
  //
  // Two: the ground has to have a height. The land is a real surface here, lifted by a height
  // field keyed to distance from its own shoreline, so the shore is flat, the interior rises, and
  // the sun shades the slopes it actually falls on. Relief is what makes a near-vertical view read
  // as terrain - it is why a relief map is hillshaded and a political map is not.
  //
  // What makes the edge read is almost entirely the water: white surf, a band of sand, turquoise
  // shallows shelving into deep water. So each coast is four rings under the land, each one the
  // same polygon pushed outward along its vertex normals.
  //
  // The game already ships photographs of islands from the air. The middle of one of them is
  // exactly the ground texture this wants - real vegetation, real cleared land, real colour
  // relationships - so take a square out of the centre (well inside the alpha edge) and
  // mirror-tile it so the joins do not show. Nothing hand-painted gets close.
  // Mirror-tiling a crop makes the joins vanish and replaces them with something worse: a
  // kaleidoscope motif repeating on a grid, which the eye finds instantly. This wraps the crop
  // instead. Shift it half a tile along one axis and cross-fade the two with a ramp that is zero
  // at both edges, and the tile's two edges end up sampling the same pixels - seamless, with no
  // symmetry anywhere in it. Once along x, once along y.
  function wrapAxis(src, N, horiz) {
    const base = document.createElement('canvas'); base.width = base.height = N;
    const bg = base.getContext('2d'), h = N / 2;
    if (horiz) { bg.drawImage(src, h, 0, h, N, 0, 0, h, N); bg.drawImage(src, 0, 0, h, N, h, 0, h, N); }
    else { bg.drawImage(src, 0, h, N, h, 0, 0, N, h); bg.drawImage(src, 0, 0, N, h, 0, h, N, h); }
    const top = document.createElement('canvas'); top.width = top.height = N;
    const tg = top.getContext('2d');
    tg.drawImage(src, 0, 0);
    tg.globalCompositeOperation = 'destination-in';
    const grad = horiz ? tg.createLinearGradient(0, 0, N, 0) : tg.createLinearGradient(0, 0, 0, N);
    grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(0.5, 'rgba(0,0,0,1)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
    tg.fillStyle = grad; tg.fillRect(0, 0, N, N);
    bg.drawImage(top, 0, 0);
    return base;
  }
  // The game already ships photographs of islands from the air. The middle of one is exactly the
  // ground texture this wants - real vegetation, real cleared land, real colour relationships - so
  // take as large a square as stays clear of the alpha edge (a small crop blown up is what turns
  // vegetation into brush strokes) and wrap it.
  function groundTile(url, fallback) {
    const N = 512;
    const c = document.createElement('canvas'); c.width = c.height = N;
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    const g = c.getContext('2d');
    g.fillStyle = fallback; g.fillRect(0, 0, N, N);              // until the photo lands
    imgLoad(url).then((im) => {
      if (!im) return;
      const side = Math.min(im.width, im.height) * 0.46;
      const sx = (im.width - side) / 2, sy = (im.height - side) / 2;
      const crop = document.createElement('canvas'); crop.width = crop.height = N;
      crop.getContext('2d').drawImage(im, sx, sy, side, side, 0, 0, N, N);
      g.drawImage(wrapAxis(wrapAxis(crop, N, true), N, false), 0, 0);
      t.needsUpdate = true;
    });
    return t;
  }
  const groundA = groundTile('assets/island3.webp', '#2d3a20');
  const groundB = groundTile('assets/island1.webp', '#30381d');
  // Even a seamless tile still repeats. Sample two different islands three times between them, at
  // scales and rotations sharing no common multiple, and average: no one sample's grid survives
  // the other two. Averaging costs contrast, so put it back afterwards rather than letting one
  // sample dominate - a dominant sample brings its own repeat back with it. All of it is sampled
  // in playfield coordinates, so the ground belongs to the land and not to the screen, and high
  // ground is drier than the valleys, so tint it by elevation as well.
  function groundMat(scale, lo, hi) {
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.96, metalness: 0, fog: false });
    const w = attribute('mapxy', 'vec2').mul(scale);
    const rot = (v, a, k) => { const c = Math.cos(a) * k, s2 = Math.sin(a) * k;
      return vec2(v.x.mul(c).sub(v.y.mul(s2)), v.x.mul(s2).add(v.y.mul(c))); };
    const c1 = texture(groundA, rot(w, 0.0, 1.0)).rgb;
    const c2 = texture(groundB, rot(w, 1.19, 0.413)).rgb;
    const c3 = texture(groundA, rot(w, 2.41, 1.77)).rgb;
    const avg = mix(mix(c1, c2, 0.5), c3, 0.33);
    // around the photograph's own mean, and in the linear values texture() hands back - this
    // ground sits near 0.05 linear, so pivoting at mid-grey would drive all of it to black
    const punch = avg.sub(vec3(0.055, 0.055, 0.055)).mul(1.3).add(vec3(0.055, 0.055, 0.055));
    const up = smoothstep(0.1, 0.78, attribute('elev', 'float'));
    m.colorNode = punch.mul(mix(vec3(lo[0], lo[1], lo[2]), vec3(hi[0], hi[1], hi[2]), up));
    return m;
  }
  const landMat = groundMat(0.0125, [1.12, 1.02, 0.66], [0.70, 0.86, 0.56]);
  const isleMat = groundMat(0.0240, [1.10, 1.08, 0.86], [1.00, 1.02, 0.90]);
  const deepMat = new THREE.MeshBasicNodeMaterial({ color: 0x3f7f96, transparent: true, opacity: 0.34, depthWrite: false });
  const shelfMat = new THREE.MeshBasicNodeMaterial({ color: 0x6fb9ba, transparent: true, opacity: 0.46, depthWrite: false });
  const surfMat = new THREE.MeshBasicNodeMaterial({ color: 0xdceee8, transparent: true, opacity: 0.62, depthWrite: false });
  const sandMat = new THREE.MeshBasicNodeMaterial({ color: 0xd9cb9f, transparent: true, opacity: 0.9, depthWrite: false });

  // Push a polygon outward along each vertex's angle bisector. Good enough for a coast: the
  // offsets are small next to the features, so the concave bits (the lochs) do not fold over.
  function offsetPoly(poly, d) {
    const n = poly.length, out = [];
    for (let i = 0; i < n; i++) {
      const p = poly[i], a = poly[(i - 1 + n) % n], b = poly[(i + 1) % n];
      let n1x = p[1] - a[1], n1y = a[0] - p[0];
      let n2x = b[1] - p[1], n2y = p[0] - b[0];
      const m1 = Math.hypot(n1x, n1y) || 1, m2 = Math.hypot(n2x, n2y) || 1;
      n1x /= m1; n1y /= m1; n2x /= m2; n2y /= m2;
      let vx = n1x + n2x, vy = n1y + n2y;
      const m = Math.hypot(vx, vy) || 1;
      out.push([p[0] + (vx / m) * d, p[1] + (vy / m) * d]);
    }
    return out;
  }
  // ---- the height field -------------------------------------------------------------
  // Elevation is distance from this landmass's own shoreline, ramped over `rise` units and then
  // rolling with fractal noise: a flat beach, ground climbing behind it, ridges and valleys
  // inland. Heights are game altitude units, the same ones the aircraft fly in, so a ridge is
  // honestly a fraction of your height above it.
  //
  // `exag` is vertical exaggeration, and it applies to the shading only, never to the shape. Every
  // relief map ever printed does this: at the scale a map is read, true slopes are too gentle to
  // see, so the hillshade is computed from a surface several times taller than the real one while
  // the heights stay honest. Here it also means the terrain can read as mountainous without ever
  // climbing far enough to swallow an aircraft.
  const RELIEF = { land: { h: 15, rise: 30, freq: 0.016, step: 12, exag: 3.2 },
                   isle: { h: 1.4, rise: 9, freq: 0.05, step: 9, exag: 3.2 } };
  const WPG = 1.14;      // world units per playfield unit across the field; near enough for lighting
  function vhash(xi, yi) { const s = Math.sin(xi * 127.1 + yi * 311.7) * 43758.5453; return s - Math.floor(s); }
  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = vhash(xi, yi), b = vhash(xi + 1, yi), c = vhash(xi, yi + 1), d = vhash(xi + 1, yi + 1);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  }
  // three octaves, no more: the finest one has to stay coarser than the vertex spacing below,
  // or the "hills" are only the sampling error of a field nobody can see
  function fbm(x, y) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < 3; i++) { s += a * vnoise(x * f, y * f); a *= 0.5; f *= 2; } return s / 0.875; }
  // Nearest point on the ring, and with it the direction the distance grows in - which is the
  // gradient of the coastal ramp, so the slope near a shore falls out of the same search.
  const NP = { d: 0, gx: 0, gy: 0 };
  function nearPoly(poly, x, y) {
    let best = Infinity, bx = 0, by = 0;
    for (let i = 0, n = poly.length; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
      let t = L ? ((x - a[0]) * dx + (y - a[1]) * dy) / L : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = a[0] + dx * t, py = a[1] + dy * t;
      const d = (px - x) * (px - x) + (py - y) * (py - y);
      if (d < best) { best = d; bx = px; by = py; }
    }
    NP.d = Math.sqrt(best);
    if (NP.d > 1e-6) { NP.gx = (x - bx) / NP.d; NP.gy = (y - by) / NP.d; } else { NP.gx = NP.gy = 0; }
    return NP;
  }
  const sstep = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
  const dsstep = (u) => (u <= 0 || u >= 1 ? 0 : 6 * u * (1 - u));
  // height and its two slopes at once. The noise contributes through its own finite difference,
  // the shore ramp through the distance gradient above, so this costs one search and three noise
  // lookups instead of three searches.
  const RL = { h: 0, hx: 0, hy: 0 };
  function reliefAt(poly, rel, x, y) {
    nearPoly(poly, x, y);
    const u = NP.d / rel.rise, R = sstep(u), dR = dsstep(u) / rel.rise;
    const f = rel.freq, e = 2.0;
    const n0 = fbm(x * f, y * f), N = 0.26 + 0.74 * n0 * n0;
    const n1 = fbm((x + e) * f, y * f), n2 = fbm(x * f, (y + e) * f);
    const Nx = (0.26 + 0.74 * n1 * n1 - N) / e, Ny = (0.26 + 0.74 * n2 * n2 - N) / e;
    RL.h = rel.h * R * N;
    RL.hx = rel.h * (dR * NP.gx * N + R * Nx);
    RL.hy = rel.h * (dR * NP.gy * N + R * Ny);
    return RL;
  }

  // Earcut gives a triangulation whose every vertex sits on the shoreline, which is a flat sheet
  // however good the height field is: there is nothing in the interior to lift. So refine it until
  // no edge is longer than `target`, which is the spacing the relief needs to be sampled at.
  //
  // Uniform splitting would spend its whole budget on the dense coastline and still leave the
  // inland triangles hundreds of units across - and a height field sampled coarser than its own
  // features turns into spikes, not hills. This splits edges, not triangles: an edge too long gets
  // a midpoint, and a triangle is then rebuilt from however many of its edges were split (red-green
  // refinement). Midpoints are keyed by edge, so the two triangles sharing one agree about it and
  // no crack can open. Boundary midpoints are collinear, so the coast is untouched.
  function refine(pts, tris, target, maxIter, budget) {
    const t2 = target * target;
    const key = (i, j) => (i < j ? i + ',' + j : j + ',' + i);
    // the budget is checked as midpoints are made, not only between passes: one pass of a large
    // map can triple the mesh, and a check at the top of the loop finds out far too late
    for (let it = 0; it < maxIter && pts.length < budget; it++) {
      const mid = new Map();
      for (let k = 0; k < tris.length; k += 3)
        for (let e = 0; e < 3; e++) {
          const i = tris[k + e], j = tris[k + (e + 1) % 3];
          const dx = pts[i][0] - pts[j][0], dy = pts[i][1] - pts[j][1];
          if (dx * dx + dy * dy <= t2) continue;
          const kk = key(i, j);
          if (!mid.has(kk) && pts.length < budget) { mid.set(kk, pts.length); pts.push([(pts[i][0] + pts[j][0]) / 2, (pts[i][1] + pts[j][1]) / 2]); }
        }
      if (!mid.size) break;
      const out = [];
      for (let k = 0; k < tris.length; k += 3) {
        const a = tris[k], b = tris[k + 1], c = tris[k + 2];
        const ab = mid.get(key(a, b)), bc = mid.get(key(b, c)), ca = mid.get(key(c, a));
        const n = (ab === undefined ? 0 : 1) + (bc === undefined ? 0 : 1) + (ca === undefined ? 0 : 1);
        if (n === 0) out.push(a, b, c);
        else if (n === 3) out.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
        else if (n === 1) {
          if (ab !== undefined) out.push(a, ab, c, ab, b, c);
          else if (bc !== undefined) out.push(b, bc, a, bc, c, a);
          else out.push(c, ca, b, ca, a, b);
        } else if (ab === undefined) out.push(c, ca, bc, ca, a, b, ca, b, bc);
        else if (bc === undefined) out.push(a, ab, ca, ab, b, c, ab, c, ca);
        else out.push(b, bc, ab, bc, c, a, bc, a, ab);
      }
      tris = out;
    }
    return tris;
  }

  // A piece is one filled ring. `rel` lifts it into terrain; without it the piece is water and
  // stays flat. Positions are rewritten every frame, so the buffer starts empty and the map
  // coordinate each vertex came from is what is actually kept.
  function buildPiece(poly, mat, order, rel) {
    let pts = poly.map((q) => [q[0], q[1]]);
    let tris = THREE.ShapeUtils.triangulateShape(pts.map((q) => new THREE.Vector2(q[0], q[1])), []).flat();
    if (rel) tris = refine(pts, tris, rel.step, 8, 16000);
    const n = pts.length;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setIndex(tris);
    const mx = new Float32Array(n), my = new Float32Array(n);
    for (let i = 0; i < n; i++) { mx[i] = pts[i][0]; my[i] = pts[i][1]; }
    // Normals are baked here and never touched again. The surface's shape in playfield coordinates
    // does not change - only where the camera puts it - so recomputing normals every frame would
    // be thousands of cross products a frame to arrive back at these numbers. Playfield +x is world
    // +x and playfield +y is world -z, which is the whole of the rotation.
    const nrm = new Float32Array(n * 3);
    let el = null;
    if (rel) {
      el = new Float32Array(n);
      const up = new Float32Array(n);
      const k = (ALT_K / WPG) * rel.exag;
      for (let i = 0; i < n; i++) {
        const r = reliefAt(poly, rel, mx[i], my[i]);
        el[i] = r.h * ALT_K;
        up[i] = r.h / rel.h;
        const ax = -r.hx * k, az = r.hy * k, L = Math.hypot(ax, 1, az);
        nrm[i * 3] = ax / L; nrm[i * 3 + 1] = 1 / L; nrm[i * 3 + 2] = az / L;
      }
      const a = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) { a[i * 2] = mx[i]; a[i * 2 + 1] = my[i]; }
      g.setAttribute('mapxy', new THREE.BufferAttribute(a, 2));
      g.setAttribute('elev', new THREE.BufferAttribute(up, 1));
    } else {
      for (let i = 0; i < n; i++) nrm[i * 3 + 1] = 1;         // water: flat, and unlit anyway
    }
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    const m = new THREE.Mesh(g, mat);
    m.frustumCulled = false; m.receiveShadow = true; m.castShadow = !!rel; m.renderOrder = order;
    let y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < n; i++) { if (my[i] < y0) y0 = my[i]; if (my[i] > y1) y1 = my[i]; }
    m.userData = { mx, my, el, lift: 0, y0, y1 };
    scene.add(m); m.visible = false;
    return m;
  }
  // A coast is four rings, widest first: the shelf shelving out of deep water, turquoise shallows,
  // a line of surf, and the land itself sitting on top of all of them.
  const COAST = [
    { d: 6.0, mat: () => deepMat, order: -9, y: 0.12 },
    { d: 3.2, mat: () => shelfMat, order: -8, y: 0.18 },
    { d: 1.5, mat: () => surfMat, order: -7, y: 0.24 },
    { d: 0.7, mat: () => sandMat, order: -6, y: 0.30 },
  ];
  function buildCoast(poly, landM, baseOrder, rel) {
    const pieces = [];
    for (const c of COAST) {
      const m = buildPiece(offsetPoly(poly, c.d), c.mat(), baseOrder + c.order, null);
      m.userData.lift = c.y;
      pieces.push(m);
    }
    const land = buildPiece(poly, landM, baseOrder, rel);
    land.userData.lift = 0.36;
    pieces.push(land);
    return pieces;
  }
  // ---- where the ground actually is
  // Everything that lies ON the land - a blast ring, a scorch mark, a fire carpet, the red circle
  // warning you where a shell is about to land - used to be drawn half a unit above y=0, which was
  // right while the land was a flat sheet. Spray, wake and splash are not in that list: those are
  // water, and the water is still at zero. The land has relief now and rises well above that, so those
  // decals were being drawn inside the hill and you never saw them: a nuke over Oahu was a column
  // of smoke with no flash and no shockwave under it.
  // Asking the polygons for a height per sprite per frame would be a nearest-point search over the
  // whole coastline every time, so the relief each map already bakes per vertex is splatted once
  // into a coarse grid and read back from there. The refinement guarantees vertices closer together
  // than a cell, so taking the highest vertex in each cell gives a surface that sits a touch proud
  // of the real one - which is the right way to be wrong for something meant to lie on top of it.
  const HCELL = 10;
  function buildHeightGrid(t) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, any = false;
    for (const m of t.pieces) {
      const d = m.userData; if (!d.el) continue;
      any = true;
      for (let i = 0; i < d.mx.length; i++) {
        if (d.mx[i] < x0) x0 = d.mx[i]; if (d.mx[i] > x1) x1 = d.mx[i];
        if (d.my[i] < y0) y0 = d.my[i]; if (d.my[i] > y1) y1 = d.my[i];
      }
    }
    if (!any) return null;
    const gw = Math.max(1, Math.ceil((x1 - x0) / HCELL) + 1), gh = Math.max(1, Math.ceil((y1 - y0) / HCELL) + 1);
    const a = new Float32Array(gw * gh);
    // Where the land IS, as opposed to how high it is: a shore cell is barely above the water and
    // would read as sea on height alone. Every cell a land triangle touches is marked, which
    // rounds the coast outward by up to a cell - the right way to be wrong for something that
    // decides where a ship is allowed to sail.
    const land = new Uint8Array(gw * gh);
    for (const m of t.pieces) {
      const d = m.userData; if (!d.el) continue;
      for (let i = 0; i < d.mx.length; i++) {
        const gx = Math.round((d.mx[i] - x0) / HCELL), gy = Math.round((d.my[i] - y0) / HCELL);
        const k = gy * gw + gx, v = d.lift + d.el[i];
        if (v > a[k]) a[k] = v;
      }
      const idx = m.geometry.index ? m.geometry.index.array : null;
      if (!idx) continue;
      for (let i = 0; i < idx.length; i += 3) {
        const A = idx[i], B = idx[i + 1], C = idx[i + 2];
        const ax = d.mx[A], bx = d.mx[B], cx = d.mx[C], ay = d.my[A], by = d.my[B], cy = d.my[C];
        const c0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - x0) / HCELL));
        const c1 = Math.min(gw - 1, Math.ceil((Math.max(ax, bx, cx) - x0) / HCELL));
        const r0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - y0) / HCELL));
        const r1 = Math.min(gh - 1, Math.ceil((Math.max(ay, by, cy) - y0) / HCELL));
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) land[r * gw + c] = 1;
      }
    }
    return { x0, y0, gw, gh, a, land };
  }
  let curHG = null, curOff = 0, curH = 0;
  // gx, gy are field coordinates - the same ones every sprite is placed with.
  function groundY(gx, gy) {
    const g = curHG; if (!g) return 0;
    const fx = (gx - g.x0) / HCELL, fy = ((curOff + curH - gy) - g.y0) / HCELL;
    if (fx < 0 || fy < 0 || fx > g.gw - 1 || fy > g.gh - 1) return 0;
    const ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy;
    const jx = Math.min(ix + 1, g.gw - 1), jy = Math.min(iy + 1, g.gh - 1);
    const a = g.a, r0 = iy * g.gw, r1 = jy * g.gw;
    return (a[r0 + ix] * (1 - tx) + a[r0 + jx] * tx) * (1 - ty) + (a[r1 + ix] * (1 - tx) + a[r1 + jx] * tx) * ty;
  }
  // Is this playfield point land on the map being drawn? Asked by the spawner, which has no idea
  // the land exists otherwise - to the game a coastline is a picture, and nothing stops a
  // destroyer steaming over a hill except not putting it there in the first place.
  // Takes the scroll rather than reading the last frame's: the spawner runs in the update, which
  // is not the draw, and a lane test that quietly used a stale offset would be a ship on a hill
  // every time the two drifted apart.
  R.landAt = function (level, gx, gy, scrollY, H) {
    const t = level ? terrainFor(level.id) : null;
    const g = t && t.hg; if (!g || !g.land) return false;
    const my = (scrollY - t.map.at) + H - gy;
    const cx = Math.round((gx - g.x0) / HCELL), cy = Math.round((my - g.y0) / HCELL);
    if (cx < 0 || cy < 0 || cx >= g.gw || cy >= g.gh) return false;
    return g.land[cy * g.gw + cx] === 1;
  };
  const terrainCache = {};
  function terrainFor(id) {
    if (terrainCache[id] !== undefined) return terrainCache[id];
    const M = mapFor(id);
    if (!M) return (terrainCache[id] = null);
    const t = { map: M, pieces: [] };
    const rl = M.relief || RELIEF.land, ri = M.isleRelief || RELIEF.isle;
    for (const poly of M.land || []) t.pieces = t.pieces.concat(buildCoast(poly, landMat, 0, rl));
    for (const poly of M.isles || []) t.pieces = t.pieces.concat(buildCoast(poly, isleMat, 10, ri));
    t.hg = buildHeightGrid(t);
    return (terrainCache[id] = t);
  }
  function drawTerrain(w) {
    const L = w.level;
    const t = L ? terrainFor(L.id) : null;
    for (const k in terrainCache) {
      const o = terrainCache[k];
      if (o && o !== t) for (const m of o.pieces) m.visible = false;
    }
    if (!t) { curHG = null; return; }
    // the map slides down the field as the stage scrolls, the same way everything else does
    const off = w.scrollY - t.map.at;
    curHG = t.hg; curOff = off; curH = w.H;
    drawWrecks(t.map, off, w);
    for (const m of t.pieces) {
      const d = m.userData, mx = d.mx, my = d.my, el = d.el, lift = d.lift;
      // Decide from the piece's own extent before touching a vertex: a map is tens of thousands of
      // points and it is off the field for most of a stage. The test is against the span, not
      // against individual corners, because a piece larger than the screen has every corner off it
      // and still covers the view. Playfield y runs north; the field scrolls south.
      m.visible = off - d.y0 + w.H > -400 && off - d.y1 + w.H < w.H + 400;
      if (!m.visible) continue;
      const pos = m.geometry.attributes.position.array;
      for (let i = 0; i < mx.length; i++) {
        ray(mx[i], off - my[i] + w.H, 0);
        pos[i * 3] = P.x; pos[i * 3 + 1] = lift + (el ? el[i] : 0); pos[i * 3 + 2] = P.z;
      }
      m.geometry.attributes.position.needsUpdate = true;
    }
  }
  // Ships burning at their moorings. They are not targets - they are yours, and they were hit
  // before you got airborne. A dark hull, fire at the waterline and a smoke column leaning with
  // the wind, so the harbour is already a casualty when you arrive over it.
  function drawWrecks(M, off, w) {
    if (!M.wrecks) return;
    const time = w.time;
    for (let i = 0; i < M.wrecks.length; i++) {
      const k = M.wrecks[i];
      const gy = off - k.y + w.H;
      if (gy < -120 || gy > w.H + 120) continue;
      const seed = i * 2.7;
      sprite(SMOKE, k.x, gy, 1.0, 26 * k.s, 0.42, k.a, 0.18, 0.17, 0.16, 0.95, 0);     // the hull
      sprite(ADD, k.x, gy, 2.5, 13 * k.s, 1, 0, 1.0, 0.52, 0.16, 0.5 + Math.sin(time * 7 + seed) * 0.18, 1);
      // the column: older puffs higher, wider and greyer, drifting downwind
      for (let j = 0; j < 7; j++) {
        const u = (time * 0.22 + j / 7 + seed) % 1;
        const rise = u * 120, wob = Math.sin(time * 0.7 + j * 1.7 + seed) * 7;
        sprite(SMOKE, k.x + wob + u * 16, gy - u * 7, 3 + rise, (16 + u * 42) * k.s, 1,
               u * 3 + seed, 0.26 - u * 0.08, 0.25 - u * 0.08, 0.24 - u * 0.07, (1 - u) * 0.8, 0);
      }
      if (litN < 3 && i === 1) lightAt(litN++, k.x, gy, 10, 2600, 0xff7a2e);
    }
  }
  R.terrainFor = terrainFor;

  // islands
  const islandPool = [0, 1, 2].map((i) => meshPool(() => { const M = MODELS['island' + i]; const m = new THREE.Mesh(M.geo, M.mat); m.receiveShadow = true; m.castShadow = true; m.renderOrder = -5; return m; }));
  // clouds: 3 stacked soft layers each, cast shadows
  const cloudTex = [1, 2, 3, 4].map((i) => tex('assets/cloud' + i + '.webp'));
  const cloudGeo = new THREE.PlaneGeometry(1, 1); cloudGeo.rotateX(-Math.PI / 2);
  const cloudMats = [];   // every live cloud material, so applyTheme() can retint them all
  function cloudMat(v) {
    const m = new THREE.MeshLambertNodeMaterial({ map: cloudTex[v], transparent: true, depthWrite: false, opacity: 0.8, emissive: 0xc8d4e0, emissiveIntensity: 0.4 });
    // alphaTest has to be non-zero for the shadow pass to test anything at all, but it must stay
    // low enough not to bite into the soft edge of the visible cloud. castShadowNode does the
    // actual shaping: 1 inside the cloud body, 0 outside.
    m.alphaTest = 0.01;
    m.castShadowNode = vec4(0, 0, 0, step(0.4, texture(cloudTex[v]).a));
    cloudMats.push(m);
    return m;
  }
  const cloudPools = cloudTex.map((t, v) => meshPool(() => {
    const g = new THREE.Group();
    for (let i = 0; i < 3; i++) { const m = new THREE.Mesh(cloudGeo, cloudMat(v)); m.castShadow = i === 0; m.renderOrder = 7 + i; g.add(m); }
    return g;
  }));
  // bombs / torpedoes / debris / pickups / rings
  const bombGeo = new THREE.CapsuleGeometry(0.9, 3.2, 3, 8); bombGeo.rotateX(Math.PI / 2);
  const bombMat = new THREE.MeshStandardMaterial({ color: 0x4a4e3a, roughness: 0.5, metalness: 0.6 });
  const bombPool = meshPool(() => { const m = new THREE.Mesh(bombGeo, bombMat); m.castShadow = true; return m; });
  const torpGeo = new THREE.CapsuleGeometry(0.6, 6, 3, 6); torpGeo.rotateX(Math.PI / 2);
  const torpPool = meshPool(() => new THREE.Mesh(torpGeo, new THREE.MeshStandardMaterial({ color: 0x2a2e30, roughness: 0.4, metalness: 0.7 })));
  const debris = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.35, 0.7), new THREE.MeshStandardMaterial({ color: 0x2c2a26, roughness: 0.8, metalness: 0.5 }), 240);
  debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage); debris.castShadow = true; debris.frustumCulled = false; debris.count = 0; scene.add(debris);
  const powTex = {};
  function powMaterial(type) {
    if (powTex[type]) return powTex[type];
    const sp = S.sprites.pow && S.sprites.pow[type];
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const cg = c.getContext('2d');   // must exist even when the sprite is missing
    if (sp) cg.drawImage(sp.c, 0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const top = new THREE.MeshStandardMaterial({ map: t, transparent: true, alphaTest: 0.3, roughness: 0.35, metalness: 0.55, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.35 });
    return (powTex[type] = top);
  }
  const rimMat = { gun: new THREE.MeshStandardMaterial({ color: 0xc8962e, roughness: 0.3, metalness: 0.9 }), bomb: new THREE.MeshStandardMaterial({ color: 0x8a8e94, roughness: 0.35, metalness: 0.9 }), fuel: new THREE.MeshStandardMaterial({ color: 0x8a6a10, roughness: 0.5, metalness: 0.4 }), repair: new THREE.MeshStandardMaterial({ color: 0xe8e8e0, roughness: 0.4, metalness: 0.3 }) };
  const coinGeo = { gun: new THREE.CylinderGeometry(9, 9, 2.2, 28), repair: new THREE.CylinderGeometry(9, 9, 2.2, 28), bomb: new THREE.CylinderGeometry(9.6, 9.6, 2.4, 6), fuel: new THREE.BoxGeometry(15, 2.6, 18) };
  const coinPool = {};
  function coin(fam, type) {
    const pk = coinPool[fam] || (coinPool[fam] = meshPool(() => { const m = new THREE.Mesh(coinGeo[fam], [rimMat[fam], rimMat[fam], rimMat[fam]]); m.castShadow = true; return m; }));
    const m = pk.get();
    if (fam === 'fuel') { if (m.material[2] !== powMaterial(type)) { m.material = [rimMat.fuel, rimMat.fuel, powMaterial(type), rimMat.fuel, rimMat.fuel, rimMat.fuel]; } }
    else if (m.material[1] !== powMaterial(type)) m.material = [rimMat[fam], powMaterial(type), rimMat[fam]];
    return m;
  }
  const ringGeo = new THREE.TorusGeometry(1, 0.06, 6, 64); ringGeo.rotateX(Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xfff0d0, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
  const ringPool = meshPool(() => { const m = new THREE.Mesh(ringGeo, ringMat.clone()); m.renderOrder = 9; return m; });
  // Nuke shock shell: an actual hemisphere of compressed air racing out from the blast, not a
  // decal painted over the screen. It is depth-tested, so a hulk standing in front of the blast
  // hides the near wall of the shell and an island behind it stays behind it. Alpha is weighted
  // to the limb - 1 - dot(n,v)^2, brightest where you are looking along the surface - which is
  // what makes a shell read as a shell instead of a filled bubble, and lets you see the sea and
  // the ships through the middle of it.
  const shockGeo = new THREE.SphereGeometry(1, 40, 18, 0, TAU, 0, Math.PI * 0.54);
  function shockMat() {
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const op = uniform(0.4), col = uniform(new THREE.Color(1, 0.82, 0.6));
    const f = dot(normalView, positionViewDirection), rim = float(1).sub(f.mul(f));
    mat.colorNode = col; mat.opacityNode = rim.mul(rim).mul(op);
    mat.userData = { op, col };
    return mat;
  }
  const shockPool = meshPool(() => { const m = new THREE.Mesh(shockGeo, shockMat()); m.renderOrder = 8; return m; });
  // cauliflower cap: lumpy displaced icosphere with darker crevices (vertex colours)
  const capGeo = (() => {
    const g = new THREE.IcosahedronGeometry(1, 5), pa = g.attributes.position, v = new THREE.Vector3(), cols = new Float32Array(pa.count * 3);
    const lump = (x, y, z) => Math.sin(x * 7.1 + y * 3.3) * Math.sin(y * 6.7 - z * 4.1) * Math.sin(z * 5.9 + x * 2.7) + 0.5 * Math.sin(x * 13.3 + z * 11.1) * Math.sin(y * 12.7);
    for (let i = 0; i < pa.count; i++) {
      v.fromBufferAttribute(pa, i); const n = lump(v.x, v.y, v.z), k = 1 + n * 0.16;
      v.multiplyScalar(k); v.y *= v.y < 0 ? 0.35 : 0.6; pa.setXYZ(i, v.x, v.y, v.z);
      const c = 0.62 + n * 0.3; cols[i * 3] = c; cols[i * 3 + 1] = c * 0.96; cols[i * 3 + 2] = c * 0.92;
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3)); g.computeVertexNormals(); return g;
  })();
  const stemGeo = new THREE.CylinderGeometry(0.5, 0.9, 1, 16, 1, true); stemGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(stemGeo.attributes.position.count * 3).fill(0.7), 3));
  const mushMat = () => new THREE.MeshStandardMaterial({ color: 0x9a8a7a, vertexColors: true, roughness: 1, metalness: 0, transparent: true, opacity: 0.9, emissive: 0xff6a20, emissiveIntensity: 1, depthWrite: false });
  const mushPool = meshPool(() => { const g = new THREE.Group(); const cap = new THREE.Mesh(capGeo, mushMat()), stem = new THREE.Mesh(stemGeo, mushMat()), skirt = new THREE.Mesh(capGeo, mushMat()); cap.castShadow = true; g.add(cap); g.add(stem); g.add(skirt); g.userData = { cap, stem, skirt }; return g; });

  // ---------------------------------------------------------------- themes
  let themeKey = '';
  const seaCol = new THREE.Color(), fogCol = new THREE.Color();
  const THEMES = {
    dawn: { elev: 14, azim: 160, sun: 0xffc08a, si: 2.4, hemi: [0xffd0b0, 0x2a3a50, 0.45], exp: 0.88, turb: 6, ray: 2.5 },
    day: { elev: 58, azim: 175, sun: 0xfff4e0, si: 2.7, hemi: [0xbfd8ff, 0x1a3550, 0.5], exp: 0.88, turb: 2.5, ray: 1.2 },
    dusk: { elev: 9, azim: 200, sun: 0xff9a5a, si: 2.1, hemi: [0xffa880, 0x302030, 0.42], exp: 0.9, turb: 8, ray: 3 },
    night: { elev: 40, azim: 170, sun: 0xa8c0ff, si: 1.1, hemi: [0x4a5a8a, 0x0a1020, 0.45], exp: 1.25, turb: 1, ray: 0.3 },
  };
  let curTheme = THEMES.day, weather = 'clear', isNight = false;
  function applyTheme(level) {
    const th = level && level.theme ? level.theme : { tod: 'day', weather: 'clear', sea: '#1d5f88' };
    const key = (level ? level.id : 'title') + th.tod + th.weather;
    if (key === themeKey) return; themeKey = key;
    const T = THEMES[th.tod] || THEMES.day; curTheme = T; weather = th.weather; isNight = th.tod === 'night';
    buildEnv(T.elev, T.azim, T.turb + (th.weather === 'haze' ? 4 : 0), T.ray);
    const phi = THREE.MathUtils.degToRad(90 - T.elev), az = THREE.MathUtils.degToRad(T.azim);
    sunDir.setFromSphericalCoords(1, phi, az); // azim 180 => sun toward -Z (top of screen): glints on the water
    sun.color.set(T.sun); sun.intensity = T.si * (th.weather === 'overcast' ? 0.55 : th.weather === 'storm' ? 0.4 : th.weather === 'haze' ? 0.8 : 1);
    hemi.color.set(T.hemi[0]); hemi.groundColor.set(T.hemi[1]); hemi.intensity = T.hemi[2] * (th.weather === 'storm' ? 0.8 : 1);
    seaCol.set(th.sea || '#1d5f88'); // deep, saturated Pacific blue: darken and push saturation of the level's sea colour
    { const hsl = {}; seaCol.getHSL(hsl); oceanColN.value.setHSL(hsl.h, Math.min(1, hsl.s * 1.35 + 0.12), hsl.l * (isNight ? 0.5 : 0.36)); }
    oceanMat.envMapIntensity = isNight ? 0.25 : th.weather === 'storm' ? 0.4 : 0.5;
    oceanU.uFoam.value = th.weather === 'storm' ? 0.65 : th.weather === 'overcast' ? 0.35 : 0.2;
    oceanU.uNScale.value = th.weather === 'storm' ? 1.4 : 0.95;
    renderer.toneMappingExposure = T.exp;
    const fogD = th.weather === 'haze' ? 0.00055 : th.weather === 'storm' ? 0.0007 : th.weather === 'overcast' ? 0.0003 : 0.00012;
    fogCol.set(isNight ? 0x05080f : th.weather === 'storm' ? 0x4a5560 : T.hemi[0]).lerp(seaCol, 0.3);
    scene.fog = new THREE.FogExp2(fogCol, fogD); scene.background = fogCol;
    const sl = isNight ? 0.35 : th.weather === 'storm' ? 0.7 : 1;
    for (const pl of [SMOKE, FLAT]) pl.uLight.value = sl;
    for (const m of cloudMats) { m.color.set(isNight ? 0x6a7690 : th.weather === 'storm' ? 0xa8b0b8 : 0xffffff); m.emissive.set(isNight ? 0x141a28 : th.weather === 'storm' ? 0x5a646e : 0xc8d4e0); }
  }
  applyTheme(null);

  // ---------------------------------------------------------------- quality management
  let dtAvg = 1 / 60, slowT = 0, fastT = 0, pr = 1;
  const view = { w: 1, h: 1, dpr: 1, H: 480 };
  function setQuality(q) {
    R.quality = q;
    pr = Math.min(view.dpr, [0.75, 1, 1.5, 2][q]);
    renderer.setPixelRatio(pr); renderer.setSize(view.w, view.h, false);
    const ms = q >= 3 ? 2048 : q === 2 ? 1536 : 1024;
    sun.castShadow = q >= 1;
    if (sun.shadow.mapSize.x !== ms) { sun.shadow.mapSize.set(ms, ms); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
    renderer.shadowMap.type = q >= 2 ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    if (renderer.shadowMap.needsUpdate !== undefined) renderer.shadowMap.needsUpdate = true;
  }
  R.resize = function (w, h, dpr, H) {
    view.w = w; view.h = h; view.dpr = Math.min(2, dpr || 1); view.H = H;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    setupCamera(w / h, H);
    setQuality(R.quality);
  };
  function qualityTick(dt) {
    dtAvg = dtAvg * 0.95 + dt * 0.05;
    if (dtAvg > 1 / 38) { slowT += dt; fastT = 0; } else if (dtAvg < 1 / 57) { fastT += dt; slowT = 0; } else { slowT = Math.max(0, slowT - dt); fastT = 0; }
    if (slowT > 2.5 && R.quality > 0) { setQuality(R.quality - 1); slowT = 0; dtAvg = 1 / 50; }
    if (fastT > 12 && R.quality < 3 && R.autoUp) { setQuality(R.quality + 1); fastT = 0; }
  }
  R.autoUp = true;
  R.setQuality = setQuality;

  // ---------------------------------------------------------------- per-frame helpers
  function placeObj(o, gx, gy, altW, scaleK) { const t = ray(gx, gy, altW); o.position.copy(P); const s = sc(t) * (scaleK || 1); o.scale.setScalar(s); return s; }
  // A hull is long, and the game's screen position maps to the world through a perspective camera,
  // so the mapping is not linear along its length. A battleship's 150 units are 127 world units
  // from bow to stern down there; dropped in rigidly at the scale of its own midpoint it comes out
  // about 104, roughly a fifth short, with each end that much inside where the game says it is.
  // Everything else on the water is cast point by point - its own wake, a splash, a blast ring -
  // so the bow wave broke ahead of the bow and the wake sat off the stern. Cast the two ends and
  // stretch the hull between them: the ends land where the game puts them, the beam and the
  // superstructure keep the midpoint's scale, and only the length gives. A hull well off to one
  // side has ends at different world x too, and then it leans along its own chord, which is what
  // a long thing pointing away from you does.
  const hullA = new THREE.Vector3(), hullB = new THREE.Vector3();
  function geoLen(g) {
    if (g.userData.zlen === undefined) { if (!g.boundingBox) g.computeBoundingBox(); g.userData.zlen = (g.boundingBox.max.z - g.boundingBox.min.z) || 1; }
    return g.userData.zlen;
  }
  function placeHull(o, gx, gy, len, altW, scaleK, gLen) {
    const half = len / 2;
    const ta = ray(gx, gy - half, altW); hullA.copy(P);
    const tb = ray(gx, gy + half, altW); hullB.copy(P);
    // Above the horizon the cast has no answer. A carrier is 270 units long and spawns clear of
    // the top of the field, so its bow end reaches past the horizon while the whole ship is still
    // off screen - cast it and the hull lands anywhere. Hold the old rigid placement for those
    // frames: wrong by the fifth it always was, and nobody is looking at it yet.
    if (!(ta > 0) || !(tb > 0)) { o.rotation.set(0, 0, 0); return placeObj(o, gx, gy, altW, scaleK); }
    const s = sc((ta + tb) / 2) * (scaleK || 1);
    o.position.set((hullA.x + hullB.x) / 2, (hullA.y + hullB.y) / 2, (hullA.z + hullB.z) / 2);
    o.rotation.set(0, Math.atan2(hullB.x - hullA.x, hullB.z - hullA.z), 0);
    o.scale.set(s, s, hullA.distanceTo(hullB) / gLen);
    return s;
  }
  function lightAt(i, gx, gy, altW, inten, col) { if (i >= LIGHTS.length) return; ray(gx, gy, altW + 12); const l = LIGHTS[i]; l.position.copy(P); l.intensity = inten; l.color.setHex(col || 0xffa860); }
  let litN = 0;
  let scrollAcc = 0, lastScroll = 0;
  const SPRITE_COL = { smoke: [0.62, 0.62, 0.62], blacksmoke: [0.16, 0.15, 0.14] };

  R.scene = scene; R.sun = sun; R.camera = camera;   // debug handles: cheap, and the only way to check a shadow box from the console
  R.render = function (w, dt) {
    if (!R.ok) return;
    const st = w.state;
    if (st === 'loading' || st === 'hangar' || st === 'map' || st === 'victory') return; // DOM panels cover the field; save the GPU
    R.frames++;
    qualityTick(dt);
    applyTheme(st === 'title' ? null : w.level);
    const want = G.mode3d && G.mode3d() ? 1 : 0;
    if (camK !== want) { const step = Math.min(1, dt / 0.7); camK += (want - camK) * (step * 3); if (Math.abs(want - camK) < 0.002) camK = want; }
    if (CB.H !== w.H || camK !== lastCamK) { lastCamK = camK; setupCamera(view.w / view.h, w.H); }
    const time = w.time;
    // camera shake (positions are computed from the steady camera, so the whole view shakes)
    const sh = w.shake;
    camera.position.set(sh > 0 ? (Math.random() - 0.5) * sh * 1.6 : 0, HC, sh > 0 ? (Math.random() - 0.5) * sh * 1.6 : 0);
    camRight.set(CB.rx, CB.ry, CB.rz); camUp.set(CB.ux, CB.uy, CB.uz);
    // sun + shadow frustum centred on the playfield
    ray(GW / 2, w.H / 2, 0);
    sun.target.position.copy(P); sun.position.copy(P).addScaledVector(sunDir, 1200); sun.target.updateMatrixWorld();
    fitShadow(w.H);
    // ocean scroll (sea moves down the screen at the scroll speed)
    const dS = w.scrollY - lastScroll; lastScroll = w.scrollY;
    if (dS > -50 && dS < 50) scrollAcc += dS;
    const tC = ray(GW / 2, w.H / 2, 0), s0 = sc(tC);
    oceanU.uOff1.value.set(time * 0.006, (scrollAcc * s0) / TILE + time * 0.012);
    oceanU.uOff2.value.set(-time * 0.009, (scrollAcc * s0) / TILE * 1.73 + time * 0.004);
    ocean.position.x = P.x; ocean.position.z = P.z;
    waterN.offset.set(-P.x / TILE, P.z / TILE);
    // flash (nuke) -> exposure bump
    renderer.toneMappingExposure = curTheme.exp * (1 + Math.min(2.5, w.flashT * 5));

    FLAT.n = SMOKE.n = ADD.n = ADDFLAT.n = BOOM.n = 0; litN = 0;
    for (const k in POOLS) POOLS[k].reset();
    for (const k in coinPool) coinPool[k].reset();
    for (const p of islandPool) p.reset();
    for (const p of cloudPools) p.reset(); bombPool.reset(); torpPool.reset(); ringPool.reset(); shockPool.reset(); mushPool.reset(); turretPools.big.reset(); turretPools.small.reset();
    const shipPool = SHIPPOOL;

    drawTerrain(w);

    // ---- islands
    for (const is of w.islands) { const v = is.v % 3; const m = islandPool[v].get(); placeObj(m, is.x, is.y, 0.5); m.rotation.set(0, is.f ? Math.PI : 0, 0); }
    // ---- clouds (low below aircraft, high above)
    for (const c of w.clouds) {
      const v = c.v % 4;
      const g = cloudPools[v].get(), alt = c.high ? HIGHCLOUD : LOWCLOUD;
      const t = ray(c.x, c.y, alt); g.position.copy(P);
      const s = sc(t);
      const baseW = 150 * c.s, baseH = 100 * c.s;
      for (let i = 0; i < 3; i++) {
        const m = g.children[i];
        m.material.opacity = c.a * (i === 0 ? 1 : 0.55);
        m.position.set((i - 1) * 4 * s, i * 7 * s, (i - 1) * 3 * s); m.rotation.set(0, (c.rot || 0) + i * 0.7, 0);
        const k = 1 - i * 0.16; m.scale.set(baseW * s * k * (c.f ? -1 : 1), 1, baseH * s * k);
      }
    }
    const playing = st === 'play' || st === 'gameover';
    if (playing) {
      // ---- ships + air hulks (bosses/bombers)
      for (const k in shipPool.pools) shipPool.pools[k].reset();
      for (const h of w.hulks) {
        if (h.kind === 'ship') drawShip(h, shipPool, time);
        else drawAirHulk(h, time);
      }
      for (const k in shipPool.pools) shipPool.pools[k].end();
      // ---- enemies
      // NOTE: fighters used to be drawn from an InstancedMesh. On the WebGPU backend only
      // instance 0 survived the alpha-tested node material - every other instance was discarded
      // whole - so a wave of seven showed one aircraft. WebGL2 drew them all, which is what hid
      // the bug. They now use the same pooled mesh as every other aircraft (there are never more
      // than a handful on screen), which also gives them damage and hit-flash shading.
      for (const e of w.enemies) {
        if (e.t < 0) continue;
        const type = e.spr === 'zeroRed' ? 'zero_red' : e.spr;
        const fighter = type === 'zero' || type === 'zero_red';
        const m = airPool(type).get();
        placeObj(m, e.x, e.y, altW(e) - (fighter ? (e.kami ? 10 : 0) : 8));
        m.rotation.set(0, -(e.ang || 0), 0); m.userData.tiltG.rotation.z = (e.bank || 0) * (fighter ? 0.6 : 0.5);
        spinProps(m, time);
        const bu = m.userData.body.userData;
        bu.dmg = 1 - e.hp / (e.maxhp || e.hp || 1); bu.flash = e.flash > 0 ? 0.7 : 0; bu.seed = (e.id || 0) % 17;
        if (fighter && e.hp < e.maxhp * 0.5 && Math.random() < 0.3) sprite(SMOKE, e.x, e.y, altW(e), 4, 1, Math.random() * TAU, 0.3, 0.3, 0.3, 0.6, 0);
      }
      // ---- wingmen
      for (const wm of w.wing) {
        const m = airPool('player', 0xb8c4d0).get();
        const alt = wm.dead ? Math.max(0, altW(wm) - wm.deadT * 45) : altW(wm);
        placeObj(m, wm.x, wm.y, alt, 0.75); m.rotation.set(0, 0, 0); m.userData.tiltG.rotation.set(wm.dead ? wm.deadT * 1.5 : 0, 0, wm.dead ? wm.deadT * 4 : wm.bank * 0.55);
        spinProps(m, time); m.userData.body.userData.dmg = 1 - wm.armor / wm.max; m.userData.body.userData.flash = wm.flash > 0 ? 0.6 : 0;
        if (wm.dead && alt <= 0) m.visible = false;
      }
      // ---- player
      const p = w.player;
      if (p && !(p.dead && p.deadT > 2.4)) {
        const blink = p.inv > 0 && p.loopT <= 0 && ((time * 18) | 0) % 2 === 0 && !p.dead;
        const m = airPool('player').get();
        let alt = altW(p), pitch = 0, roll = p.bank * 0.6;
        if (p.loopT > 0) { const u = 1 - p.loopT / w.LOOP_TIME; pitch = u * TAU; alt = altW(p) + Math.sin(u * Math.PI) * 60; }
        if (p.dead) { alt = Math.max(2, altW(p) - p.deadT * 50); roll = p.deadT * 5; pitch = p.deadT * 0.6; }
        const dmgStage = p.armor / (G.stats ? G.stats().armorMax : 100);
        placeObj(m, p.x, p.y, alt, HERO);   // 10% larger than life, so you can find yourself
        m.rotation.set(0, 0, 0); m.userData.tiltG.rotation.set(pitch, 0, roll + (dmgStage < 0.2 ? Math.sin(time * 9) * 0.08 : 0));
        spinProps(m, time, p.stall > 0 ? 0.2 : 1);
        const bu = m.userData.body.userData; bu.dmg = Math.max(0, 1 - dmgStage) * 0.95; bu.flash = p.flash > 0 ? 0.6 : 0; bu.seed = 3.7;
        m.visible = !blink;
      }
      // ---- bullets: glowing tracers + muzzle flashes
      for (const b of w.pb) {
        if (b.kind === 'bomb') {
          const m = bombPool.get(); const u = 1 - b.life / b.max; const alt = altW(b) * (1 - u) + 4;
          placeObj(m, b.x, b.y, alt); m.rotation.set(-0.5 - u * 0.8, 0, 0);
          continue;
        }
        if (b.kind === 'torp') { const m = torpPool.get(); placeObj(m, b.x, b.y, 0.4); m.rotation.set(0, Math.atan2(-b.vx, -b.vy) + 0, 0); m.rotation.y = -Math.atan2(b.vx, -b.vy); continue; }
        const ang = Math.atan2(b.vx, -b.vy);
        const ba = altW(b);
        // Every round gets a dark backing before its glow. These are additive sprites, and
        // additive over a bright sunlit sea just saturates toward white - the tracers were
        // washing out to faint grey dashes and reading as missing. The opaque core underneath
        // gives them an edge to sit against whatever is behind them.
        if (b.kind === 'laser') {
          sprite(SMOKE, b.x, b.y, ba, 3.4, 7.4, -ang, 0.02, 0.10, 0.14, 0.8, 7);
          sprite(ADD, b.x, b.y, ba, 3.2, 7, -ang, 0.35, 1.0, 1.1, 1, 7);
          sprite(ADD, b.x, b.y, ba, 6, 2.6, -ang, 0.1, 0.6, 0.8, 0.6, 2);
        } else if (b.kind === 'pellet') {
          sprite(SMOKE, b.x, b.y, ba, 2.6, 1.6, 0, 0.14, 0.06, 0.01, 0.8, 2);
          sprite(ADD, b.x, b.y, ba, 5.2, 1.2, 0, 1.0, 0.72, 0.3, 1, 2);
        } else {
          sprite(SMOKE, b.x, b.y, ba, 3.4, 6.2, -ang, 0.13, 0.07, 0.01, 0.85, 7);
          sprite(ADD, b.x, b.y, ba, 2.6, 6.0, -ang, 1.0, 0.88, 0.5, 1, 7);
          sprite(ADD, b.x, b.y, ba, 5.4, 2.3, -ang, 1.0, 0.62, 0.22, 0.5, 2);
        }
        if (b.born !== undefined && time - b.born < 0.045) sprite(ADD, b.x, b.y + 5, ba + 2, 7, 1, Math.random() * TAU, 1.0, 0.8, 0.45, 0.9, 3);
      }
      for (const b of w.eb) {
        const ea = altW(b) - 2;
        sprite(SMOKE, b.x, b.y, ea, 4.4, 1, 0, 0.16, 0.02, 0.01, 0.85, 2);   // same reason as above
        sprite(ADD, b.x, b.y, ea, 8.2, 1, 0, 1.0, 0.3, 0.1, 0.95, 2);
        sprite(ADD, b.x, b.y, ea, 3.4, 1, 0, 1.0, 0.95, 0.8, 1, 2);
      }
      // ---- pickups: 3D medallions
      for (const k of w.pickups) {
        const type = w.powType(k), m = coin(k.fam, type);
        placeObj(m, k.x, k.y, POW_ALT + Math.sin(k.t * 3) * 3);
        // pitched to face the camera: lying flat, the chase rig saw a medallion edge-on and all
        // you got was its gold rim - a disc or a brick with no markings on it.
        m.rotation.set(TILT - 0.25 + Math.sin(k.t * 2.2) * 0.18, Math.sin(k.t * 1.3) * 0.5, Math.cos(k.t * 2) * 0.15);
        sprite(ADD, k.x, k.y, POW_ALT - 1, 26, 1, 0, k.fam === 'bomb' ? 1 : 0.5, k.fam === 'bomb' ? 0.45 : 0.75, k.fam === 'gun' ? 1 : 0.3, 0.25 + 0.1 * Math.sin(k.t * 6), 2);
      }
      // ---- telegraphed impacts + napalm zones
      for (const wn of w.warns) {
        const u = wn.t / wn.dur;
        if (wn.friendly) { sprite(ADDFLAT, wn.x, wn.y, 2 + groundY(wn.x, wn.y), wn.r * 2, 1, 0, 1, 0.6, 0.2, 0.25 * u, 2); continue; }
        sprite(ADDFLAT, wn.x, wn.y, WARN_ALT, wn.r * 2 * (1.4 - 0.4 * u), 1, 0, 1.0, 0.12, 0.08, 0.45 + 0.5 * u * (0.6 + 0.4 * Math.sin(time * 30)), 6);
        sprite(ADDFLAT, wn.x, wn.y, WARN_ALT, wn.r * 2 * u, 1, 0, 1.0, 0.2, 0.1, 0.18, 2);
      }
      for (const z of w.zones) {
        const u = 1 - z.t / z.dur;
        sprite(ADDFLAT, z.x, z.y, 1.2 + groundY(z.x, z.y), Math.max(z.w, z.h) * 1.1, z.h / Math.max(z.w, z.h) * 1.2, 0, 1.0, 0.45, 0.1, 0.5 * u, 2);
        if (litN < 3 && u > 0.3) lightAt(litN++, z.x, z.y, 4, 9000 * u, 0xff7a30);
      }
    }
    // ---- particles
    for (const q of w.parts) {
      const u = q.life / q.max, altW = (q.alt || 0) * ALT_K;
      switch (q.k) {
        case 'smoke': case 'blacksmoke': {
          const c = SPRITE_COL[q.k], sz = q.s * (1.7 - u * 0.8);
          sprite(SMOKE, q.x, q.y, altW, sz, 1, q.rot || u * 2, c[0], c[1], c[2], Math.min(1, u * 1.4) * (q.k === 'smoke' ? 0.55 : 0.75), 0);
          break;
        }
        case 'flame': sprite(ADD, q.x, q.y, altW, q.s * (0.6 + u * 0.8), 1, u * 4, 1.0, 0.55 + u * 0.3, 0.2, u, 1); break;
        case 'spark': sprite(ADD, q.x, q.y, altW, q.s * 2.4, 1, 0, 1.0, 0.75, 0.4, u, 3); break;
        case 'splash': if (u <= 1) { sprite(SMOKE, q.x, q.y, altW + 2 + (1 - u) * 8, q.s, 1, q.rot || 0, 0.95, 0.97, 1.0, Math.min(1, u * 1.6) * 0.65, 5); sprite(FLAT, q.x, q.y, 0.3, q.s * (1.6 - u * 0.6), 1, q.rot || 0, 1, 1, 1, u * 0.35, 6); } break;
        case 'foam': sprite(FLAT, q.x, q.y, 0.25, q.s * (1.9 - u) * 2, 1, q.rot || 0, 1, 1, 1, u * 0.7, 4); break;
        case 'debris': break; // instanced boxes below
        default: sprite(SMOKE, q.x, q.y, altW, q.s, 1, 0, 0.6, 0.6, 0.6, u * 0.5, 0);
      }
    }
    let nd = 0;
    for (const q of w.parts) {
      if (q.k !== 'debris' || nd >= 240) continue;
      const t = ray(q.x, q.y, Math.max(0.5, (q.alt || 0) * ALT_K)), s = sc(t) * q.s * 1.6;
      tmpE.set((q.rot || 0) * 1.3, q.rot || 0, (q.rot || 0) * 0.7); tmpQ.setFromEuler(tmpE); tmpS.setScalar(s); tmpM.compose(P, tmpQ, tmpS); debris.setMatrixAt(nd++, tmpM);
    }
    debris.count = nd; debris.instanceMatrix.needsUpdate = true;
    // ---- explosions
    for (const f of w.fx) {
      if (f.t < 0) continue;
      const u = f.t / f.dur, altW = (f.alt === undefined ? 40 : f.alt) * ALT_K, sz = f.s * (0.7 + Math.sqrt(u) * 1.25);
      const a = u < 0.6 ? 1 : Math.max(0, 1 - (u - 0.6) / 0.4);
      // one of thirty pre-rendered fireballs, picked by the blast's own id so it is stable for the
      // life of the explosion, and barely turned - these have a shape, and spinning it gives the
      // game away. The flash behind it still does the work of the first few frames.
      sprite(BOOM, f.x, f.y, altW + 3, sz * 2.05, 1, f.rot * 0.25, 1.0, 0.95, 0.9, a, (f.id || 0) % 30);
      if (u < 0.5) sprite(ADD, f.x, f.y, altW + 4, sz * 1.2, 1, f.rot, 1.0, 0.72, 0.34, (0.5 - u) * 0.85, 1);   // heat through it
      if (u < 0.3) sprite(ADD, f.x, f.y, altW + 5, sz * 2.6, 1, 0, 1.0, 0.6, 0.25, (0.3 - u) * 1.5, 2);         // flash
      if (litN < 3 && u < 0.5 && f.s > 8) lightAt(litN++, f.x, f.y, altW, 22000 * (1 - u * 2) * Math.min(2, f.s / 16), 0xffa050);
      if (f.ground && u < 0.9) sprite(FLAT, f.x, f.y, 0.4 + groundY(f.x, f.y), sz * 2.2, 1, f.rot, 0.9, 0.95, 1, (1 - u) * 0.45, 4);
    }
    // ---- nukes: flash, 3D shockwave rings, mushroom cloud
    for (const nk of w.nukes) {
      if (nk.t < 0) continue;
      const tt = nk.t, R0 = nk.R, gY = groundY(nk.x, nk.y), altW = (nk.alt || 0) * ALT_K + gY;
      const g = Math.min(1, tt / 0.3);
      // fireball: white-hot core for a moment, then an orange/red ball that boils into smoke
      const hot = Math.max(0, 1 - tt / 0.35);
      sprite(ADD, nk.x, nk.y, altW + 6, R0 * 2.0 * g, 1, nk.rot, 1.0, 0.55 + hot * 0.4, 0.18 + hot * 0.6, Math.max(0, 0.95 - tt / 2.6), 1);
      sprite(ADD, nk.x, nk.y, altW + 7, R0 * 1.3 * g, 1, -nk.rot + tt, 1.0, 0.42, 0.1, Math.max(0, 0.8 - tt / 2.0), 1);
      if (tt < 0.5) sprite(ADD, nk.x, nk.y, altW + 10, R0 * 4 * (0.4 + tt), 1, 0, 1, 0.95, 0.85, (0.5 - tt) * 1.6, 3);
      // scorched, boiling sea + base surge on the water
      sprite(ADDFLAT, nk.x, nk.y, 0.6 + gY, R0 * 2 * Math.min(1.6, tt * 1.5), 1, 0, 1, 0.5, 0.2, Math.max(0, 0.6 - tt * 0.25), 6);
      if (tt > 0.15) sprite(FLAT, nk.x, nk.y, 0.5 + gY, R0 * (1.2 + tt * 0.9), 1, nk.rot, 0.92, 0.95, 1, Math.max(0, 0.5 - tt * 0.11), 4);
      // shock shell: a hemisphere thrown out ahead of the fireball, with the surface ring it
      // drags across the water under it. Two of them, the second a beat behind, so the blast has
      // a leading wall and a trailing one instead of one lonely hoop.
      {
        const t = ray(nk.x, nk.y, altW), s = sc(t);
        for (let r = 0; r < 2; r++) {
          const tr = tt - r * 0.19; if (tr < 0 || tr > 1.7) continue;
          const grow = 1 - Math.exp(-tr * 2.5);             // off hard, then coasting, like a real front
          const rad = R0 * s * (0.26 + grow * 1.6) * (r ? 0.78 : 1);
          const fade = Math.max(0, 1 - tr / (r ? 1.25 : 1.7));
          const dome = shockPool.get();
          dome.position.copy(P);
          dome.scale.set(rad, rad * (0.4 + grow * 0.45), rad);
          dome.material.userData.op.value = (r ? 0.26 : 0.46) * fade * fade;
          dome.material.userData.col.value.setRGB(1, 0.8 - tr * 0.2, 0.52 - tr * 0.24);
          const m = ringPool.get();                          // where the front meets the sea
          m.position.copy(P); m.position.y = altW + 1.5;
          m.scale.set(rad, rad * 0.35, rad);
          m.material.opacity = Math.max(0, 0.6 - tr * 0.34) * (r ? 0.45 : 1);
          m.material.color.setRGB(1, 0.82 - tr * 0.22, 0.56 - tr * 0.26);
        }
      }
      if (tt > 0.2 && tt < 2.4) sprite(SMOKE, nk.x, nk.y, altW + 70, R0 * (1.4 + (tt - 0.2) * 1.3), 1, nk.rot, 0.95, 0.96, 1, Math.max(0, 0.45 - (tt - 0.2) * 0.2), 6);
      // mushroom cloud: stem + cap rising, cooling from glowing orange to sooty grey
      if (!nk.small || R0 > 30) {
        const m = mushPool.get(); const t = ray(nk.x, nk.y, altW), s = sc(t) * R0;
        m.position.copy(P);
        const rise = Math.min(1, tt / 2.6), cool = Math.min(1, tt / 3.2), fade = tt > 3.6 ? Math.max(0, 1 - (tt - 3.6) / 0.9) : 1;
        const cap = m.userData.cap, stem = m.userData.stem, skirt = m.userData.skirt;
        const capH = s * (0.15 + rise * 0.95), capR = s * (0.18 + rise * 0.42);
        cap.position.set(0, capH, 0); cap.scale.setScalar(capR); cap.rotation.y = tt * 0.3;
        stem.position.set(0, capH * 0.5, 0); stem.scale.set(capR * 0.38, capH, capR * 0.38);
        skirt.position.set(0, s * 0.05, 0); skirt.scale.set(s * (0.2 + rise * 0.55), s * 0.1, s * (0.2 + rise * 0.55));
        for (const part of [cap, stem, skirt]) { part.material.opacity = 0.9 * fade; part.material.emissiveIntensity = Math.max(0, 1 - tt / 1.3) * 1.8; part.material.color.setRGB(0.2 + cool * 0.1, 0.18 + cool * 0.09, 0.17 + cool * 0.08); }
        if (litN < 3) lightAt(litN++, nk.x, nk.y, altW + 40, 90000 * Math.max(0, 1 - tt / 2), 0xff9050);
        // billowing soot over the cap, fire glowing through it early on
        const capAlt = altW + capH + capR * 0.7;
        for (let i = 0; i < 12; i++) {
          const a = i / 12 * TAU + tt * 0.35, rr = R0 * (i % 2 ? 0.42 : 0.22) * (0.4 + rise);
          const sh = 0.22 + cool * 0.2 + (i % 3) * 0.04;
          sprite(SMOKE, nk.x + Math.cos(a) * rr, nk.y + Math.sin(a) * rr * 0.7, capAlt + (i % 4) * 4, R0 * 0.62 * (0.45 + rise), 1, a * 2, sh + 0.04, sh, sh * 0.95, 0.75 * fade, 0);
          if (cool < 0.8 && i % 2 === 0) sprite(ADD, nk.x + Math.cos(a) * rr * 0.7, nk.y + Math.sin(a) * rr * 0.5, capAlt - 2, R0 * 0.4 * (0.5 + rise), 1, a, 1, 0.45, 0.12, (0.8 - cool) * 0.7 * fade, 1);
        }
      }
    }
    // ---- weather: rain streaks in storms
    if (weather === 'storm' && playing) for (let i = 0; i < 70; i++) { const x = (i * 97.3 + time * 13) % GW, y = ((i * 53.1) + time * 620) % w.H; sprite(ADD, x, y, 200 + (i % 5) * 40, 0.8, 18, 0.12, 0.5, 0.55, 0.6, 0.18, 7); }
    for (let i = litN; i < LIGHTS.length; i++) LIGHTS[i].intensity = 0;
    for (const k in POOLS) POOLS[k].end();
    for (const k in coinPool) coinPool[k].end();
    for (const p of islandPool) p.end();
    for (const p of cloudPools) p.end(); bombPool.end(); torpPool.end(); ringPool.end(); shockPool.end(); mushPool.end(); turretPools.big.end(); turretPools.small.end();
    if (!playing) { debris.count = 0; }
    FLAT.flush(); SMOKE.flush(); ADD.flush(); ADDFLAT.flush(); BOOM.flush();
    if (R.inited) renderer.render(scene, camera);
  };
  function spinProps(m, time, k) {
    const props = m.userData.props; if (!props) return;
    for (let i = 0; i < props.length; i++) { const p = props[i]; p.visible = true; p.userData.blades.rotation.z = time * 70 * (k === undefined ? 1 : k) + i * 1.3; }
  }
  function drawShip(h, shipPool, time) {
    const type = h.pt ? 'ptboat' : h.type;
    const pl = shipPool.pools[type] || (shipPool.pools[type] = meshPool(() => shipMesh(type)));
    const m = pl.get();
    const sink = h.dead ? h.deadT : 0;
    const s = placeHull(m, h.x, h.y, h.h, -sink * 5, h.pt ? 0.45 : 1, geoLen(m.userData.geo));
    const lg = m.userData.listG; lg.rotation.set(sink * 0.08, 0, (h.list || 0) * 0.6 + sink * 0.12);
    const body = m.userData.body; body.userData.dmg = 1 - Math.max(0, h.hp) / h.maxhp; body.userData.flash = h.flash > 0 ? 0.35 : 0; body.userData.seed = (h.id || 0) % 13;
    // turrets as children of the hull (rotate independently)
    const arr = m.userData.turrets; let ti = 0;
    if (!h.dead) for (const t of h.turrets) {
      if (t.kind === 'elevator') {
        let e = m.userData.elev[ti]; if (!e) { e = new THREE.Mesh(elevGeo, elevMat); e.receiveShadow = true; lg.add(e); m.userData.elev[ti] = e; }
        e.visible = true; e.material = t.dead ? elevDead : elevMat;
        const ew = h.w * 0.3, eh = h.h * 0.07; e.scale.set(ew, 1, eh); e.position.set(t.ox, heightAt(m.userData.geo, t.ox, t.oy) + (t.dead ? -0.2 : 0.35), t.oy); ti++;
        continue;
      }
      if (t.dead || t.kind === 'engine' || t.kind === 'bridge' || t.kind === 'tail' || t.kind === 'dorsal') continue;
      const big = !!t.big || t.kind === 'main';
      const tm = (big ? turretPools.big : turretPools.small).get();
      if (tm.parent !== lg) lg.add(tm);
      tm.position.set(t.ox, heightAt(m.userData.geo, t.ox, t.oy), t.oy);
      tm.rotation.set(0, -(t.ang || 0), 0);
      arr[ti] = tm; ti++;
    }
    for (let i = ti; i < m.userData.elev.length; i++) if (m.userData.elev[i]) m.userData.elev[i].visible = false;
    // night: running fires glow, muzzle flashes light the deck
    if (litN < 3 && h.isBoss && !h.dead && hullBurn(h)) lightAt(litN++, h.x, h.y, 10, 6000 + 3000 * Math.sin(time * 13), 0xff6a20);
    void s;
  }
  const hullBurn = (h) => h.hp < h.maxhp * 0.45;
  function drawAirHulk(h, time) {
    const type = h.spr === 'bossBomber' ? 'heavy' : h.spr || h.type;
    const m = airPool(type).get();
    const alt = h.dead ? Math.max(0, AIR - 12 - h.deadT * 28) : AIR - 12;
    placeObj(m, h.x, h.y, alt);
    m.rotation.set(0, Math.PI * 0 + (h.spin || 0) * 0.2, 0);
    m.userData.tiltG.rotation.set(h.dead ? h.deadT * 0.25 : 0, 0, (h.list || 0) * 0.5 + (h.bphase === 3 ? Math.sin(time * 2.3) * 0.06 : 0) + (h.dead ? h.deadT * 0.5 : 0));
    const bu = m.userData.body.userData; bu.dmg = 1 - Math.max(0, h.hp) / h.maxhp; bu.flash = h.flash > 0 ? 0.5 : 0; bu.seed = (h.id || 0) % 11;
    // props: engines that died stop spinning
    const props = m.userData.props; let ti = 0;
    for (let i = 0; i < props.length; i++) {
      const p = props[i]; let alive = !h.dead;
      if (h.turrets) { while (ti < h.turrets.length && h.turrets[ti].kind !== 'engine') ti++; const e = h.turrets[ti++]; if (e && e.dead) alive = false; }
      p.visible = true; p.userData.blades.rotation.z = alive ? time * 55 + i : p.userData.blades.rotation.z;
      p.children[0].visible = alive;
    }
  }
  R.stats = () => ({ backend: R.backend, calls: renderer.info.render.drawCalls ?? renderer.info.render.calls, tris: renderer.info.render.triangles, quality: R.quality, pixelRatio: pr, textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries, errors: R.errors.slice(), frames: R.frames });
  R.renderer = renderer; R.scene = scene; R.THREE = THREE;
  const params = new URLSearchParams(location.search);
  if (params.has('q')) { R.autoUp = false; R.quality = Math.max(0, Math.min(3, +params.get('q'))); }
  return R;
}
