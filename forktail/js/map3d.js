/* Fork-Tailed Devil - WebGL campaign map: a lit 2.5D war-room table built from Natural Earth (public domain) land data.
   Completed battles get gold pins and flight arcs to what they unlocked, available ones pulse, undiscovered ones sit under drifting fog.
   Drag to pan, pinch / wheel to zoom, tap a pin to pick. API: mount(canvas, {levels, state(i), run, onPick}), select(i), focus(i). */
import * as THREE from './vendor/three.webgpu.min.js';
import { Fn, uniform, texture, vec2, vec3, vec4, float, uv, mix, smoothstep, step,
         fract, floor, abs, min, dot, sin } from './vendor/three.tsl.min.js';

// map texture covers lon -20..220 (Hawaii wrapped to 202), lat -45..65
const LON0 = -20, LON1 = 220, LAT0 = -45, LAT1 = 65;
const MW = 24, MH = MW * (LAT1 - LAT0) / (LON1 - LON0);
const COORD = { pearl: [21.35, -157.97], wake: [19.3, 166.6], darwin: [-12.46, 130.84], ceylon: [6.93, 79.85], coral: [-15.5, 155.5], midway: [28.2, -177.37],
  guadal: [-9.43, 160.0], bismarck: [-6.5, 148.5], rabaul: [-4.2, 152.2], philsea: [15.5, 137.5], leyte: [10.9, 125.6], iwo: [24.78, 141.32], okinawa: [26.33, 127.8],
  britain: [51.2, 0.8], malta: [35.9, 14.5], ploesti: [44.94, 26.02], biscay: [45.5, -5.5] };
const toXZ = (lat, lon) => { if (lon < LON0) lon += 360; return new THREE.Vector3((lon - LON0) / (LON1 - LON0) * MW - MW / 2, 0, (LAT1 - lat) / (LAT1 - LAT0) * MH - MH / 2); };

export function createMap(S) {
  const M = { ok: true };
  // The canvas is ours, not the panel's. The map used to take whatever <canvas> the freshly-built
  // panel handed it and tear down the old renderer to match, and that teardown threw before it
  // finished - so the second open left the panel half-built and every further one cost another
  // context. A phone runs out of those long before a desktop does.
  //
  // It is still ours, but it is no longer the same one all afternoon: a canvas that leaves the
  // document loses the surface its renderer presents to, so each visit gets a fresh one and the
  // renderer that goes with it, and the one before is disposed once the new one has drawn. See
  // M.mount for what that was costing, newSurface and retire for the order it has to happen in.
  let canvas = makeCanvas();
  let renderer = null, opts = null, raf = 0, ready = false, heightData = null;
  let rInit = false, lastTick = 0, lastDraw = 0, errs = 0, loopRevives = 0, wdT = 0, mountedAt = 0, mounted = false, visited = false;
  function makeCanvas() {
    const c = document.createElement('canvas');
    c.className = 'mapcv';
    c.addEventListener('pointerdown', onDown); c.addEventListener('pointermove', onMove);
    c.addEventListener('pointerup', onUp); c.addEventListener('pointercancel', onUp);
    c.addEventListener('wheel', onWheel, { passive: false });
    // preventDefault is what makes the loss recoverable rather than permanent
    c.addEventListener('webglcontextlost', (e) => { e.preventDefault(); rebuildRenderer('context lost'); });
    return c;
  }
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x1a140c, 24, 46);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  scene.add(new THREE.HemisphereLight(0xfff2dc, 0x2a2016, 1.3));
  const lamp = new THREE.DirectionalLight(0xffe6c0, 2.2); lamp.position.set(-6, 14, 6); scene.add(lamp);
  const lampSpot = new THREE.PointLight(0xffc880, 30, 30, 1.6); lampSpot.position.set(0, 7, 0); scene.add(lampSpot);
  // wooden table under the chart
  const wood = (() => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 256; const g = c.getContext('2d');
    g.fillStyle = '#3a2414'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 70; i++) { g.strokeStyle = 'rgba(' + (20 + Math.random() * 30 | 0) + ',' + (10 + Math.random() * 16 | 0) + ',4,' + (0.15 + Math.random() * 0.3) + ')'; g.lineWidth = 1 + Math.random() * 3; g.beginPath(); const y = Math.random() * 256; g.moveTo(0, y); g.bezierCurveTo(80, y + Math.random() * 20 - 10, 170, y + Math.random() * 20 - 10, 256, y); g.stroke(); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 4); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const table = new THREE.Mesh(new THREE.PlaneGeometry(80, 60), new THREE.MeshStandardMaterial({ map: wood, roughness: 0.7 }));
  table.rotation.x = -Math.PI / 2; table.position.y = -0.06; scene.add(table);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(MW + 0.5, 0.12, MH + 0.5), new THREE.MeshStandardMaterial({ color: 0x5a3a1c, roughness: 0.5, metalness: 0.1 }));
  frame.position.y = -0.07; scene.add(frame);

  // chart: displaced relief from the texture's alpha (land height); fog-of-war mask blended in the shader
  const geo = new THREE.PlaneGeometry(MW, MH, 240, 110); geo.rotateX(-Math.PI / 2);
  const fogC = document.createElement('canvas'); fogC.width = 512; fogC.height = 236;
  fogC.getContext('2d');   // the chart material samples this before paintFog() may have run
  const fogT = new THREE.CanvasTexture(fogC);
  const chartMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0.0, color: 0xffffff });
  const uTimeN = uniform(0);
  const U = { uTime: { set value(v) { uTimeN.value = v; }, get value() { return uTimeN.value; } } };
  // 1x1 stand-in so the node graph can be built before map_world.webp arrives; swapped on load
  const blankC = document.createElement('canvas'); blankC.width = blankC.height = 1;
  { const g = blankC.getContext('2d'); g.fillStyle = '#6a7a5a'; g.fillRect(0, 0, 1, 1); }
  const chartTex = new THREE.CanvasTexture(blankC); chartTex.colorSpace = THREE.SRGBColorSpace;
  const chartNode = texture(chartTex);
  {
    const h21 = Fn(([q]) => fract(sin(dot(q, vec2(127.1, 311.7))).mul(43758.5453)));
    const vn = Fn(([q]) => {
      const i = floor(q), f = fract(q).toVar();
      f.assign(f.mul(f).mul(float(3).sub(f.mul(2))));
      return mix(mix(h21(i), h21(i.add(vec2(1, 0))), f.x), mix(h21(i.add(vec2(0, 1))), h21(i.add(vec2(1, 1))), f.x), f.y);
    });
    const cuv = uv();
    const deg = vec2(cuv.x.mul(240).sub(20), cuv.y.mul(110).sub(45));
    const gl = abs(fract(deg.div(10).add(0.5)).sub(0.5)).mul(10);
    const line = float(1).sub(smoothstep(0, 0.09, min(gl.x, gl.y)));
    const lit = mix(chartNode.rgb, vec3(0.85, 0.76, 0.52), line.mul(0.22));   // graticule every 10 degrees
    const f = texture(fogT, cuv).a;
    const n = vn(cuv.mul(vec2(30.0, 14.0)).add(vec2(uTimeN.mul(0.05), uTimeN.mul(0.02)))).mul(0.6)
      .add(vn(cuv.mul(vec2(80.0, 37.0)).sub(uTimeN.mul(0.03))).mul(0.4));
    const fogA = smoothstep(0.25, 0.75, f.add(n.sub(0.5).mul(0.35)));
    const gray = dot(lit, vec3(0.3, 0.55, 0.15));
    const fogged = vec3(gray.mul(0.35).add(0.08), gray.mul(0.35).add(0.08), gray.mul(0.38).add(0.1)).add(n.mul(0.12));
    chartMat.colorNode = vec4(mix(lit, fogged, fogA.mul(0.85)), 1.0);
  }
  const chart = new THREE.Mesh(geo, chartMat); scene.add(chart);
  new THREE.TextureLoader().load(new URL('../assets/tex/map_world.webp', import.meta.url).href, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace; chartNode.value = tex; chartMat.needsUpdate = true;
    try { // relief from alpha
      const im = tex.image, c = document.createElement('canvas'); c.width = 481; c.height = 221; const g = c.getContext('2d'); g.drawImage(im, 0, 0, 481, 221);
      const d = g.getImageData(0, 0, 481, 221).data; heightData = d;
      const pa = geo.attributes.position, uv = geo.attributes.uv;
      for (let i = 0; i < pa.count; i++) { const x = Math.round(uv.getX(i) * 480), y = Math.round((1 - uv.getY(i)) * 220); pa.setY(i, d[(y * 481 + x) * 4 + 3] / 255 * 0.32); }
      pa.needsUpdate = true; geo.computeVertexNormals();
      for (const p of pins) p.root.position.y = groundAt(p.pos);
      rebuildArcs();
    } catch (e) { /* tainted / unsupported: flat chart */ }
    ready = true;
  });
  function groundAt(v) {
    if (!heightData) return 0;
    const x = Math.round(THREE.MathUtils.clamp((v.x + MW / 2) / MW, 0, 1) * 480), y = Math.round(THREE.MathUtils.clamp((v.z + MH / 2) / MH, 0, 1) * 220);
    return heightData[(y * 481 + x) * 4 + 3] / 255 * 0.32;
  }

  // ---- pins, labels, arcs
  const pinGroup = new THREE.Group(); scene.add(pinGroup);
  const arcGroup = new THREE.Group(); scene.add(arcGroup);
  let pins = [];
  const MAT = {
    done: new THREE.MeshStandardMaterial({ color: 0xe8c050, metalness: 0.85, roughness: 0.3, emissive: 0x3a2800 }),
    avail: new THREE.MeshStandardMaterial({ color: 0xf5d77a, metalness: 0.2, roughness: 0.4, emissive: 0xc08a20, emissiveIntensity: 0.6 }),
    fog: new THREE.MeshStandardMaterial({ color: 0x6a6e74, metalness: 0.4, roughness: 0.6 }),
    ring: new THREE.MeshBasicMaterial({ color: 0xffd870, transparent: true, opacity: 0.8, depthWrite: false }),
    sel: new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.9, depthWrite: false }),
    green: new THREE.MeshStandardMaterial({ color: 0x9fe07a, emissive: 0x2a5a1a, roughness: 0.5 }),
  };
  const medalCol = { gold: 0xf2c84a, silver: 0xd8dde4, bronze: 0xc0804a };
  // Labels are canvas textures, and every one is a shader compile and a texture upload. Pin names
  // barely change between visits, so build each one once and hand out fresh sprites around it.
  const labelCache = new Map(), labelMats = new Set();
  function label(text, sub, color) {
    const key = text + '|' + sub + '|' + color, hit = labelCache.get(key);
    if (hit) { const s2 = new THREE.Sprite(hit); s2.scale.set(1.9, 0.475, 1); s2.renderOrder = 5; return s2; }
    const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d');
    g.fillStyle = 'rgba(16,12,8,0.78)'; g.beginPath(); if (g.roundRect) g.roundRect(2, 6, 252, 52, 8); else g.rect(2, 6, 252, 52); g.fill();
    g.strokeStyle = color; g.lineWidth = 2; g.stroke();
    g.fillStyle = color; g.font = 'bold 24px "Courier New", monospace'; g.textAlign = 'center'; g.fillText(text, 128, 31);
    if (sub) { g.fillStyle = '#c9c2ad'; g.font = '16px "Courier New", monospace'; g.fillText(sub, 128, 50); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteNodeMaterial({ map: t, depthTest: false, transparent: true });
    labelCache.set(key, mat); labelMats.add(mat);
    const s = new THREE.Sprite(mat); s.scale.set(1.9, 0.475, 1); s.renderOrder = 5; return s;
  }
  // Pins are rebuilt on every visit. Without this the old geometry, materials and textures stayed
  // on the GPU for the life of the page - a few megabytes a visit, which a phone notices.
  const SHARED = new Set(Object.values(MAT));
  function disposeTree(root) {
    const geos = new Set(), mats = new Set();
    root.traverse((o) => { if (o.geometry) geos.add(o.geometry); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.add(m)); });
    // Guarded, because a dispose can throw and this one runs at the top of every mount. Three
    // keeps its per-material bookkeeping inside the renderer, so anything that was prepared by a
    // renderer which has since been replaced - see rebuildRenderer - has nothing to look up and
    // dies on the way out. A buffer left un-freed costs a few kilobytes; a throw here costs the
    // whole mount, and the chart would stay frozen on the frame before it.
    for (const g of geos) { try { g.dispose(); } catch (e) {} }
    for (const m of mats) { if (SHARED.has(m) || labelMats.has(m)) continue; try { if (m.map) m.map.dispose(); m.dispose(); } catch (e) {} }
  }
  function buildPins() {
    while (pinGroup.children.length) { const c = pinGroup.children[0]; pinGroup.remove(c); disposeTree(c); }
    pins = [];
    const ring = new THREE.RingGeometry(0.16, 0.22, 32); ring.rotateX(-Math.PI / 2);
    opts.levels.forEach((l, i) => {
      const st = opts.state(i), c = COORD[l.id] || [l.lat || 0, l.lon || 150];
      const pos = toXZ(c[0], c[1]);
      const root = new THREE.Group(); root.position.copy(pos); root.position.y = groundAt(pos);
      const mat = MAT[st] || MAT.fog;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, st === 'fog' ? 0.25 : 0.42, 6), MAT.fog); stem.position.y = (st === 'fog' ? 0.25 : 0.42) / 2; root.add(stem);
      const head = new THREE.Mesh(st === 'fog' ? new THREE.OctahedronGeometry(0.07) : new THREE.SphereGeometry(0.085, 16, 10), mat);
      head.position.y = st === 'fog' ? 0.29 : 0.48; root.add(head);
      if (st === 'done') {
        const rec = opts.run && opts.run.done[l.id];
        const medal = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 20), new THREE.MeshStandardMaterial({ color: medalCol[rec && rec.medal] || 0xf2c84a, metalness: 0.9, roughness: 0.25 }));
        medal.rotation.x = Math.PI / 2; medal.position.y = 0.48; root.add(medal); head.visible = false;
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.1), MAT.green); flag.position.set(0.08, 0.36, 0); root.add(flag);
      }
      const rg = new THREE.Mesh(ring, st === 'avail' ? MAT.ring.clone() : MAT.ring); rg.position.y = 0.02; rg.visible = st === 'avail'; root.add(rg);
      const sel = new THREE.Mesh(ring, MAT.sel); sel.scale.setScalar(1.5); sel.position.y = 0.025; sel.visible = false; root.add(sel);
      const lab = st === 'fog' ? label('?', '', '#8a8e94') : label(l.name.replace(/^(The )?Battle (of|for) (the )?/i, '').replace(/^Attack on /i, '').toUpperCase().slice(0, 17), l.date ? String(l.date).slice(0, 18) : '', st === 'done' ? '#9fe07a' : '#f5d77a');
      if (st === 'fog') lab.scale.set(0.5, 0.125, 1);
      lab.position.y = st === 'fog' ? 0.5 : 0.85; root.add(lab);
      const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 1.0, 8), new THREE.MeshBasicMaterial({ visible: false })); hit.position.y = 0.4; hit.userData.idx = i; root.add(hit);
      pinGroup.add(root);
      pins.push({ i, st, root, pos, head, rg, sel, lab, hit });
    });
    rebuildArcs();
  }
  const arcMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  {
    const auv = uv();
    const dash = step(0.45, fract(auv.x.mul(18.0).sub(uTimeN.mul(0.8))));
    arcMat.colorNode = vec3(1.0, 0.847, 0.439);
    arcMat.opacityNode = dash.mul(0.85).mul(smoothstep(0.0, 0.05, auv.x)).mul(smoothstep(1.0, 0.95, auv.x));
  }
  function rebuildArcs() {
    if (!opts) return;
    while (arcGroup.children.length) { const c = arcGroup.children[0]; c.geometry.dispose(); arcGroup.remove(c); }
    const byId = {}; opts.levels.forEach((l, i) => { byId[l.id] = i; });
    opts.levels.forEach((l, i) => {
      const st = opts.state(i); if (st === 'fog') return;
      const pre = l.after ? (Array.isArray(l.after) ? l.after : [l.after]) : [];
      for (const a of pre) {
        const j = byId[a]; if (j === undefined || opts.state(j) !== 'done') continue;
        const A = pins[j].root.position.clone(), B = pins[i].root.position.clone(); A.y += 0.1; B.y += 0.1;
        const mid = A.clone().add(B).multiplyScalar(0.5); mid.y += 0.5 + A.distanceTo(B) * 0.18;
        const curve = new THREE.QuadraticBezierCurve3(A, mid, B);
        arcGroup.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.02, 5, false), arcMat));
      }
    });
  }
  function paintFog() {
    const g = fogC.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, fogC.width, fogC.height);
    g.globalCompositeOperation = 'destination-out';
    for (const p of pins) {
      if (p.st === 'fog') continue;
      const x = (p.pos.x + MW / 2) / MW * fogC.width, y = (p.pos.z + MH / 2) / MH * fogC.height, r = p.st === 'done' ? 64 : 46;
      const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.9)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    fogT.needsUpdate = true;
  }

  // ---- camera: target point on the chart + distance; drag pans, wheel / pinch zooms
  const cam = { x: 6, z: 0, dist: 15, tx: 6, tz: 0, td: 15 };
  function placeCam() {
    const tilt = 0.95; // ~54 deg down
    camera.position.set(cam.x, Math.sin(tilt) * cam.dist, cam.z + Math.cos(tilt) * cam.dist);
    camera.lookAt(cam.x, 0, cam.z);
  }
  const ptrs = new Map(); let dragged = 0, pinch0 = 0;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function onDown(e) { canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); dragged = 0; if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); } }
  function onMove(e) {
    const p = ptrs.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch0) cam.td = THREE.MathUtils.clamp(cam.td * pinch0 / d, 4, 26); pinch0 = d; dragged += 10; return; }
    dragged += Math.abs(dx) + Math.abs(dy);
    const k = cam.dist / Math.max(200, canvas.clientHeight) * 1.1;
    cam.tx = THREE.MathUtils.clamp(cam.tx - dx * k, -MW / 2, MW / 2); cam.tz = THREE.MathUtils.clamp(cam.tz - dy * k, -MH / 2, MH / 2);
  }
  function onUp(e) {
    const p = ptrs.get(e.pointerId); ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch0 = 0;
    if (!p || dragged > 8 || !opts) return;
    const r = canvas.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(pins.map((q) => q.hit), false);
    if (hits.length && opts.onPick) { const i = hits[0].object.userData.idx; M.select(i); opts.onPick(i); }
  }
  function onWheel(e) { e.preventDefault(); cam.td = THREE.MathUtils.clamp(cam.td * Math.exp(e.deltaY * 0.0015), 4, 26); }

  let selIdx = -1;
  function frameLoop(now) {
    raf = 0;
    if (!mounted || !canvas || !canvas.isConnected) { stop(); return; }
    lastTick = now;
    // One throw used to end the chart for good: the re-arm is the last line of the frame, so an
    // exception anywhere above it left raf at 0 with nobody to notice. Count them instead.
    try { drawFrame(now); errs = 0; } catch (e) { if (++errs === 1) console.warn('map frame failed', e); if (errs >= 3) rebuildRenderer('frame threw'); }
    raf = requestAnimationFrame(frameLoop);
  }
  function drawFrame(now) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w && h) {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { renderer.setPixelRatio(dpr); renderer.setSize(w, h, false); }
      camera.aspect = w / h; camera.fov = w / h < 0.9 ? 46 : 38; camera.updateProjectionMatrix();
    }
    const t = now / 1000; U.uTime.value = t;
    const k = 0.12; cam.x += (cam.tx - cam.x) * k; cam.z += (cam.tz - cam.z) * k; cam.dist += (cam.td - cam.dist) * k; placeCam();
    for (const p of pins) {
      if (p.st === 'avail') { const s = 1 + (t * 1.3 % 1) * 1.6; p.rg.scale.setScalar(s); p.rg.material.opacity = 0.9 * (1 - (t * 1.3 % 1)); p.head.position.y = 0.48 + Math.sin(t * 3 + p.i) * 0.03; }
      if (p.st === 'done') p.root.children[2].rotation.z = t * 1.5;
      p.sel.visible = p.i === selIdx; if (p.sel.visible) p.sel.rotation.y = t;
      const sc = cam.dist / 15; p.lab.scale.set((p.st === 'fog' ? 0.5 : 1.9) * sc, (p.st === 'fog' ? 0.125 : 0.475) * sc, 1);
      p.lab.visible = p.st !== 'fog' || cam.dist < 12;
    }
    if (rInit) { renderer.render(scene, camera); lastDraw = now; }
    // a chart that has run clean for half a minute has earned its retries back
    if (rebuilds && now - lastRebuild > 30000) { rebuilds = 0; lastRebuild = 0; }
  }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
  function initRenderer() {
    if (renderer) return;
    renderer = new THREE.WebGPURenderer({ canvas, antialias: true, alpha: false, powerPreference: 'low-power' });
    rInit = false; renderer.init().then(() => { rInit = true; }).catch((e) => console.warn('map renderer init failed', e));
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
    renderer.setClearColor(0x1a140c, 1);
  }
  // A fresh canvas and a fresh renderer, in place of whatever is there now. Everything on screen
  // is scene data, so the new renderer uploads it again on its first frame.
  function newSurface(host) {
    const oldCv = canvas, oldR = renderer, where = host || oldCv.parentNode;
    canvas = makeCanvas();
    if (where) {                                     // in the document before init, or not at all
      if (oldCv.parentNode === where) where.insertBefore(canvas, oldCv);
      else where.insertBefore(canvas, where.firstChild);
    }
    if (oldCv.parentNode) oldCv.parentNode.removeChild(oldCv);
    renderer = null; rInit = false; errs = 0; lastTick = lastDraw = 0;
    initRenderer();
    retire(oldR);
  }
  // Disposing a WebGPURenderer destroys the device under it, so the order matters: dispose first
  // and the replacement comes up on that destroyed device and paints nothing at all - a black
  // canvas with render() returning cleanly, which is a worse lie than the stale frame all of this
  // exists to cure. Wait until the new one has a frame on the screen, then let the old one go.
  function retire(old) {
    if (!old || !old.dispose) return;
    let waited = 0;
    const t = setInterval(() => {
      if (!(lastDraw || (waited += 150) > 3000)) return;
      clearInterval(t);
      try { old.dispose(); } catch (e) {}
    }, 150);
  }
  let rebuilding = false, rebuilds = 0, lastRebuild = 0;
  const REBUILD_CAP = 4;
  function rebuildRenderer(why) {
    if (rebuilding) return;
    if (rebuilds >= REBUILD_CAP) { giveUp(); return; }   // a chart that will not come back must not spin
    rebuilding = true; rebuilds++; lastRebuild = clock();
    console.warn('map chart restarting:', why, '(' + rebuilds + ')');
    stop();
    newSurface(null);
    mountedAt = clock();
    if (canvas.isConnected) raf = requestAnimationFrame(frameLoop);
    rebuilding = false;
  }
  // Out of tries. Rather than leave a dead chart on screen pretending to be the campaign, hand
  // the panel back the plain mission list it shows when there is no WebGL at all - .nomap hides
  // the view and un-hides the list, which is the one that works on a phone.
  function giveUp() {
    mounted = false; stop(); if (wdT) { clearTimeout(wdT); wdT = 0; }
    const host = canvas.parentNode;
    if (host) { host.classList.add('nomap'); host.removeChild(canvas); }
    M.ok = false;
    console.warn('map chart disabled; falling back to the battle list');
  }
  // named clock, not now: frameLoop and drawFrame both take `now` as the frame timestamp
  const clock = () => (window.performance && performance.now ? performance.now() : Date.now());
  // The chart is the one part of this screen that can fail silently - a dead renderer leaves the
  // last good frame sitting there looking like live information. So it gets checked rather than
  // trusted: a loop that has stopped ticking is restarted, and a loop that ticks without drawing
  // is a renderer that has lost its context and needs replacing.
  function watchdog() {
    wdT = 0;
    if (!mounted || !canvas || !canvas.isConnected) return;   // chart is not on screen; nothing to police
    // A hidden page gets no animation frames at all, which is not a fault and must not be
    // mistaken for one - the kick on visibilitychange is what picks it back up.
    if (document.hidden) { wdT = setTimeout(watchdog, 1500); return; }
    // Generous thresholds on purpose. A phone that has just built this panel can lose a couple of
    // seconds to one long frame, and that is not a dead chart - it is a busy one. Waiting costs a
    // few seconds of staleness in a case that fixes itself; not waiting costs a restart every
    // time the machine is briefly under load.
    const t = clock();
    if (lastTick && t - lastTick > 2500) {
      if (++loopRevives >= 3) rebuildRenderer('loop will not stay up');
      else { stop(); raf = requestAnimationFrame(frameLoop); }
    } else if (t - lastTick < 2500) loopRevives = 0;
    if (rInit && lastDraw && t - lastDraw > 5000) rebuildRenderer('renderer stopped drawing');
    else if (!rInit && mountedAt && t - mountedAt > 10000) rebuildRenderer('renderer never started');
    wdT = setTimeout(watchdog, 1500);
  }
  // Coming back from the background: the clocks restart from here, so the gap the page spent
  // hidden is not read as a stall the moment the watchdog next runs.
  function kick() {
    if (!mounted || !canvas || !canvas.isConnected) return;
    const t = clock(); if (lastTick) lastTick = t; if (lastDraw) lastDraw = t; mountedAt = mountedAt ? t : 0; loopRevives = 0;
    if (!raf) raf = requestAnimationFrame(frameLoop);
    if (!wdT) wdT = setTimeout(watchdog, 1500);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });

  // host is the .mapview box the panel builds; the chart moves into it for as long as it is open
  M.mount = function (host, o) {
    opts = o;
    // Every visit after the first gets a new canvas and a new renderer. A chart that has been
    // put away and brought back does not come back to life: the surface the renderer presents to
    // is destroyed when the canvas leaves the document, and nothing anywhere says so - the loop
    // runs, render() returns cleanly, and the canvas goes on showing the frame the last visit
    // ended on. That is the stale chart: a campaign three battles further along still drawn with
    // a finished mission pulsing as the one to fly next, while the card and the buttons beside it
    // were right all along. There is no way to hand the old renderer a new surface, so it is the
    // renderer that gets replaced.
    if (visited) newSurface(host);
    else if (canvas.parentNode !== host) host.insertBefore(canvas, host.firstChild);   // behind the legend
    visited = true;
    initRenderer();
    // Nothing in the build is allowed to stop the loop from starting below - a chart that is a
    // pin short is still a chart, a chart that never gets a frame is last week's news.
    try { buildPins(); paintFog(); } catch (e) { console.warn('map pins failed', e); }
    const next = pins.find((p) => p.st === 'avail') || pins[0];
    if (next) { cam.tx = cam.x = next.pos.x; cam.tz = cam.z = next.pos.z + 0.6; }
    cam.td = cam.dist = 13;
    // always restart the loop rather than leaving one that may be running: the chain clears
    // `raf` at the top of every frame and drops it entirely when the chart is not on screen
    mounted = true; mountedAt = clock(); lastTick = lastDraw = 0; loopRevives = 0; errs = 0;
    stop(); raf = requestAnimationFrame(frameLoop);
    if (wdT) clearTimeout(wdT);
    wdT = setTimeout(watchdog, 1500);
  };
  // leaving the map stops the loop and takes the canvas out of the panel; the next visit brings
  // a new one, because this one's surface does not survive the trip - see M.mount
  M.detach = function () { mounted = false; stop(); if (wdT) { clearTimeout(wdT); wdT = 0; } ptrs.clear(); if (canvas.parentNode) canvas.parentNode.removeChild(canvas); };
  M.unmount = M.detach;
  M.select = function (i) { selIdx = i; };
  // `snap` jumps the camera instead of gliding - for opening the chart, where a glide would be a
  // long slide across the Pacific from wherever it was left last time.
  M.focus = function (i, snap) {
    const p = pins[i]; if (!p) return;
    selIdx = i; cam.tx = p.pos.x; cam.tz = p.pos.z + 0.6; cam.td = Math.min(cam.td, 11);
    if (snap) { cam.x = cam.tx; cam.z = cam.tz; cam.dist = cam.td; }
  };
  M.isReady = () => ready;
  M.coords = COORD; M._fog = fogC; M._pins = () => pins; M._cam = cam;
  M._diag = () => ({ rInit, raf: !!raf, wd: !!wdT, errs, rebuilds, loopRevives, sinceTick: lastTick ? Math.round(clock() - lastTick) : -1, sinceDraw: lastDraw ? Math.round(clock() - lastDraw) : -1, canvas, renderer });
  // for testing the recovery paths from the console: _break('loop') kills the frame loop,
  // _break('throw') makes rendering fail, _break() leaves the renderer uninitialised
  M._break = (how) => { if (how === 'loop') { stop(); } else if (how === 'throw') { renderer = { render() { throw new Error('test'); } }; } else { rInit = false; } };
  return M;
}
